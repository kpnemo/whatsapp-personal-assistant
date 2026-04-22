/**
 * Tests for MediaDownloader.
 *
 * Integration tests (happy path, DB update, publish) use real Postgres +
 * Redis containers via makeTestDb / makeTestRedis.
 *
 * Concurrency / queue-overflow tests use a fake in-memory MediaStore and
 * controllable download functions, so they don't need containers and run fast.
 */
import { tmpdir } from "node:os";
import { join } from "node:path";

import { decryptWithKey, generateKey, parseCiphertext } from "@wpa/shared";
import { makeTestDb, makeTestRedis, seedUser, type TestDb, type TestRedis } from "@wpa/test-utils";
import type { Redis } from "ioredis";
import { pino } from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { MediaDownloader, type MediaJob, type GetPrismaFn } from "./media.js";
import { LocalDiskMediaStore, type MediaStore } from "./mediaStore.js";

const silentLogger = pino({ level: "silent" });
const TEST_DEK = generateKey();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAudit() {
  const calls: { userId: string; subtype: string; details?: Record<string, unknown> }[] = [];
  return {
    fn: (userId: string, subtype: string, details?: Record<string, unknown>): Promise<void> => {
      if (details !== undefined) {
        calls.push({ userId, subtype, details });
      } else {
        calls.push({ userId, subtype });
      }
      return Promise.resolve();
    },
    calls,
  };
}

/** In-memory MediaStore for fast unit tests. */
class MemoryMediaStore implements MediaStore {
  readonly data = new Map<string, Buffer>();

  put(userId: string, messageId: string, bytes: Buffer): Promise<string> {
    const ref = `${userId}/${messageId}.bin`;
    this.data.set(ref, bytes);
    return Promise.resolve(ref);
  }

  get(ref: string): Promise<Buffer> {
    const buf = this.data.get(ref);
    if (!buf) return Promise.reject(new Error(`not found: ${ref}`));
    return Promise.resolve(buf);
  }
}

/** Build a fake getPrisma that records update calls. */
function makeFakePrisma() {
  const updates: { id: string; data: Record<string, unknown> }[] = [];
  const getPrisma: GetPrismaFn = () => ({
    message: {
      update: (args: {
        where: { id: string };
        data: { mediaRef?: string | null; mediaMime?: string | null };
      }) => {
        updates.push({ id: args.where.id, data: args.data });
        return Promise.resolve({});
      },
    },
  });
  return { getPrisma, updates };
}

/** Build a fake Redis that records publish calls. */
function makeFakeRedis() {
  const published: { channel: string; message: string }[] = [];
  return {
    redis: {
      publish: (channel: string, message: string): Promise<number> => {
        published.push({ channel, message });
        return Promise.resolve(0);
      },
    } as unknown as Redis,
    published,
  };
}

/** A download function that resolves immediately with the given buffer. */
function immediateDownload(buf: Buffer): () => Promise<Buffer> {
  return () => Promise.resolve(buf);
}

/** A download function controlled by an external resolve. */
function deferredDownload(): {
  download: () => Promise<Buffer>;
  resolve: (buf: Buffer) => void;
  reject: (err: Error) => void;
} {
  let resolve!: (buf: Buffer) => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<Buffer>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { download: () => promise, resolve, reject };
}

// ---------------------------------------------------------------------------
// Unit tests (no containers)
// ---------------------------------------------------------------------------

describe("MediaDownloader — unit", () => {
  const BASE_DEPS = {
    perUserConcurrency: 3,
    globalConcurrency: 10,
    maxBytes: 32 * 1024 * 1024,
    queuePerUserMax: 100,
    logger: silentLogger,
  };

  it("happy path: download → encrypted write → message update → publish → audit", async () => {
    const store = new MemoryMediaStore();
    const { getPrisma, updates } = makeFakePrisma();
    const { redis, published } = makeFakeRedis();
    const audit = makeAudit();

    const downloader = new MediaDownloader({
      ...BASE_DEPS,
      mediaStore: store,
      redis,
      getPrisma,
      audit: audit.fn,
    });

    const payload = Buffer.from("hello media");
    const job: MediaJob = {
      userId: "u1",
      messageId: "msg1",
      dek: TEST_DEK,
      mimeType: "image/jpeg",
      download: immediateDownload(payload),
    };

    downloader.enqueue(job);
    await downloader.stop();

    // Store should have one entry.
    expect(store.data.size).toBe(1);
    const storedRef = "u1/msg1.bin";
    expect(store.data.has(storedRef)).toBe(true);

    // Stored bytes should decrypt back to base64 of original payload.
    const storedBuf = store.data.get(storedRef)!;
    const ct = parseCiphertext(storedBuf.toString("utf8"));
    const decrypted = decryptWithKey(TEST_DEK, ct);
    const recovered = Buffer.from(decrypted, "base64");
    expect(recovered).toEqual(payload);

    // Message row should have been updated.
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      id: "msg1",
      data: { mediaRef: storedRef, mediaMime: "image/jpeg" },
    });

    // Redis publish should have fired.
    expect(published).toHaveLength(1);
    const evt = JSON.parse(published[0]!.message) as { type: string; messageId: string };
    expect(evt.type).toBe("message.media_ready");
    expect(evt.messageId).toBe("msg1");
    expect(published[0]!.channel).toBe("ui:events:u1");

    // Audit should record media_ready.
    const readyAudits = audit.calls.filter((c) => c.subtype === "ingest.media_ready");
    expect(readyAudits).toHaveLength(1);
    expect(readyAudits[0]!.details).toMatchObject({ messageId: "msg1" });
  });

  it("queue overflow: enqueue queuePerUserMax+1 → last one audited as skipped", async () => {
    const store = new MemoryMediaStore();
    const { getPrisma } = makeFakePrisma();
    const { redis } = makeFakeRedis();
    const audit = makeAudit();

    // Use per-user concurrency=1, global=1, queuePerUserMax=5 so the queue fills fast.
    const downloader = new MediaDownloader({
      ...BASE_DEPS,
      mediaStore: store,
      redis,
      getPrisma,
      audit: audit.fn,
      perUserConcurrency: 1,
      globalConcurrency: 1,
      queuePerUserMax: 5,
    });

    // First deferred download blocks the single worker slot.
    const blocker = deferredDownload();
    downloader.enqueue({
      userId: "u2",
      messageId: "msg-block",
      dek: TEST_DEK,
      mimeType: undefined,
      download: blocker.download,
    });

    // Enqueue 5 more (fills the queue to max).
    for (let i = 0; i < 5; i++) {
      downloader.enqueue({
        userId: "u2",
        messageId: `msg-q${i.toString()}`,
        dek: TEST_DEK,
        mimeType: undefined,
        download: immediateDownload(Buffer.from("x")),
      });
    }

    // The 6th enqueue should overflow.
    downloader.enqueue({
      userId: "u2",
      messageId: "msg-overflow",
      dek: TEST_DEK,
      mimeType: undefined,
      download: immediateDownload(Buffer.from("x")),
    });

    const overflowAudits = audit.calls.filter((c) => c.subtype === "ingest.media_skipped_overload");
    expect(overflowAudits).toHaveLength(1);
    expect(overflowAudits[0]!.details).toMatchObject({ messageId: "msg-overflow" });

    // Unblock + drain.
    blocker.resolve(Buffer.from("blocker content"));
    await downloader.stop();
  });

  it("maxBytes cap: download returns oversized buffer → audit media_failed, no write", async () => {
    const store = new MemoryMediaStore();
    const { getPrisma, updates } = makeFakePrisma();
    const { redis } = makeFakeRedis();
    const audit = makeAudit();

    const downloader = new MediaDownloader({
      ...BASE_DEPS,
      mediaStore: store,
      redis,
      getPrisma,
      audit: audit.fn,
      maxBytes: 10, // tiny cap
    });

    const oversized = Buffer.alloc(11, 0xab);
    downloader.enqueue({
      userId: "u3",
      messageId: "msg-big",
      dek: TEST_DEK,
      mimeType: undefined,
      download: immediateDownload(oversized),
    });

    await downloader.stop();

    expect(store.data.size).toBe(0);
    expect(updates).toHaveLength(0);

    const failedAudits = audit.calls.filter((c) => c.subtype === "ingest.media_failed");
    expect(failedAudits).toHaveLength(1);
    expect(failedAudits[0]!.details).toMatchObject({
      messageId: "msg-big",
      reason: "exceeds_max_bytes",
    });
  });

  it("download rejection → audit media_failed, no write", async () => {
    const store = new MemoryMediaStore();
    const { getPrisma, updates } = makeFakePrisma();
    const { redis } = makeFakeRedis();
    const audit = makeAudit();

    const downloader = new MediaDownloader({
      ...BASE_DEPS,
      mediaStore: store,
      redis,
      getPrisma,
      audit: audit.fn,
    });

    downloader.enqueue({
      userId: "u4",
      messageId: "msg-fail",
      dek: TEST_DEK,
      mimeType: undefined,
      download: () => Promise.reject(new Error("download error")),
    });

    await downloader.stop();

    expect(store.data.size).toBe(0);
    expect(updates).toHaveLength(0);

    const failedAudits = audit.calls.filter((c) => c.subtype === "ingest.media_failed");
    expect(failedAudits).toHaveLength(1);
    expect(failedAudits[0]!.details).toMatchObject({
      messageId: "msg-fail",
      reason: "download error",
    });
  });

  it("per-user concurrency cap: at most perUserConcurrency downloads in flight", async () => {
    const PER_USER = 2;
    const store = new MemoryMediaStore();
    const { getPrisma } = makeFakePrisma();
    const { redis } = makeFakeRedis();
    const audit = makeAudit();

    const downloader = new MediaDownloader({
      ...BASE_DEPS,
      mediaStore: store,
      redis,
      getPrisma,
      audit: audit.fn,
      perUserConcurrency: PER_USER,
      globalConcurrency: 20,
    });

    let maxConcurrent = 0;
    let currentConcurrent = 0;
    const resolvers: ((buf: Buffer) => void)[] = [];

    const makeControlled = (): MediaJob => {
      let res!: (buf: Buffer) => void;
      const p = new Promise<Buffer>((r) => {
        res = r;
      });
      resolvers.push(res);
      return {
        userId: "u-concurrency",
        messageId: `msg-${resolvers.length.toString()}`,
        dek: TEST_DEK,
        mimeType: undefined,
        download: async () => {
          currentConcurrent++;
          if (currentConcurrent > maxConcurrent) maxConcurrent = currentConcurrent;
          const buf = await p;
          currentConcurrent--;
          return buf;
        },
      };
    };

    // Enqueue 6 jobs for a single user.
    for (let i = 0; i < 6; i++) {
      downloader.enqueue(makeControlled());
    }

    // Give the event loop a turn so active workers are dispatched.
    await new Promise((r) => setTimeout(r, 10));

    // At most PER_USER should be running concurrently for this user.
    expect(downloader.stats().perUser["u-concurrency"]?.active).toBeLessThanOrEqual(PER_USER);

    // Resolve all.
    for (const res of resolvers) {
      res(Buffer.from("ok"));
    }
    await downloader.stop();

    expect(maxConcurrent).toBeLessThanOrEqual(PER_USER);
  });

  it("global concurrency cap: at most globalConcurrency across all users", async () => {
    const GLOBAL = 5;
    const store = new MemoryMediaStore();
    const { getPrisma } = makeFakePrisma();
    const { redis } = makeFakeRedis();
    const audit = makeAudit();

    const downloader = new MediaDownloader({
      ...BASE_DEPS,
      mediaStore: store,
      redis,
      getPrisma,
      audit: audit.fn,
      perUserConcurrency: 10,
      globalConcurrency: GLOBAL,
    });

    let maxConcurrent = 0;
    let currentConcurrent = 0;
    const resolvers: ((buf: Buffer) => void)[] = [];

    // 5 users × 10 jobs each = 50 total.
    for (let u = 0; u < 5; u++) {
      for (let j = 0; j < 10; j++) {
        let res!: (buf: Buffer) => void;
        const p = new Promise<Buffer>((r) => {
          res = r;
        });
        resolvers.push(res);
        downloader.enqueue({
          userId: `global-user-${u.toString()}`,
          messageId: `msg-${u.toString()}-${j.toString()}`,
          dek: TEST_DEK,
          mimeType: undefined,
          download: async () => {
            currentConcurrent++;
            if (currentConcurrent > maxConcurrent) maxConcurrent = currentConcurrent;
            const buf = await p;
            currentConcurrent--;
            return buf;
          },
        });
      }
    }

    // Settle initial dispatch.
    await new Promise((r) => setTimeout(r, 10));

    expect(downloader.stats().active).toBeLessThanOrEqual(GLOBAL);

    // Resolve all.
    for (const res of resolvers) {
      res(Buffer.from("ok"));
    }
    await downloader.stop();

    expect(maxConcurrent).toBeLessThanOrEqual(GLOBAL);
  });

  it("stop: drains in-flight, drops queued", async () => {
    const store = new MemoryMediaStore();
    const { getPrisma, updates } = makeFakePrisma();
    const { redis } = makeFakeRedis();
    const audit = makeAudit();

    const downloader = new MediaDownloader({
      ...BASE_DEPS,
      mediaStore: store,
      redis,
      getPrisma,
      audit: audit.fn,
      perUserConcurrency: 1,
      globalConcurrency: 1,
    });

    // First job blocks the worker slot.
    const { download, resolve } = deferredDownload();
    downloader.enqueue({
      userId: "u-stop",
      messageId: "msg-inflight",
      dek: TEST_DEK,
      mimeType: undefined,
      download,
    });

    // Queue a second job that should be dropped.
    downloader.enqueue({
      userId: "u-stop",
      messageId: "msg-queued",
      dek: TEST_DEK,
      mimeType: undefined,
      download: immediateDownload(Buffer.from("never")),
    });

    // Stop and simultaneously resolve the in-flight job.
    const stopPromise = downloader.stop();
    resolve(Buffer.from("inflight content"));
    await stopPromise;

    // In-flight job completed → 1 update.
    expect(updates).toHaveLength(1);
    expect(updates[0]!.id).toBe("msg-inflight");

    // Queued job was dropped → still only 1 store entry, 1 update.
    expect(store.data.size).toBe(1);
  });

  it("binary bytes 0x00–0xFF survive base64+encrypt round-trip", async () => {
    const store = new MemoryMediaStore();
    const { getPrisma } = makeFakePrisma();
    const { redis } = makeFakeRedis();
    const audit = makeAudit();

    const downloader = new MediaDownloader({
      ...BASE_DEPS,
      mediaStore: store,
      redis,
      getPrisma,
      audit: audit.fn,
    });

    const allBytes = Buffer.alloc(256);
    for (let i = 0; i < 256; i++) allBytes[i] = i;

    downloader.enqueue({
      userId: "u-binary",
      messageId: "msg-binary",
      dek: TEST_DEK,
      mimeType: undefined,
      download: immediateDownload(allBytes),
    });

    await downloader.stop();

    expect(store.data.size).toBe(1);
    const storedBuf = store.data.get("u-binary/msg-binary.bin")!;
    const ct = parseCiphertext(storedBuf.toString("utf8"));
    const decrypted = decryptWithKey(TEST_DEK, ct);
    const recovered = Buffer.from(decrypted, "base64");
    expect(recovered).toEqual(allBytes);
  });
});

// ---------------------------------------------------------------------------
// Integration tests (real Postgres + Redis)
// ---------------------------------------------------------------------------

describe.sequential("MediaDownloader — integration", () => {
  let testDb: TestDb;
  let testRedis: TestRedis;
  let userId: string;

  const MEDIA_ROOT = join(tmpdir(), `wpa-media-dl-test-${Date.now().toString()}`);

  beforeAll(async () => {
    testDb = await makeTestDb();
    testRedis = await makeTestRedis();
  }, 180_000);

  afterAll(async () => {
    if (testDb) await testDb.teardown();
    if (testRedis) await testRedis.teardown();
  }, 60_000);

  beforeEach(async () => {
    await testDb.prisma.message.deleteMany();
    await testDb.prisma.conversation.deleteMany();
    await testDb.prisma.waContact.deleteMany();
    await testDb.prisma.auditLog.deleteMany();
    await testDb.prisma.user.deleteMany();
    await testRedis.client.flushdb();

    const user = await seedUser(testDb.prisma, {
      email: `media-test-${Date.now().toString()}@example.com`,
      role: "user",
      password: "password1234567890",
    });
    userId = user.id;

    // Create a conversation + message that the downloader will update.
    await testDb.prisma.waContact.create({ data: { userId, jid: "5551234567@s.whatsapp.net" } });
    const conv = await testDb.prisma.conversation.create({
      data: {
        userId,
        jid: "5551234567@s.whatsapp.net",
        type: "dm",
        lastMessageAt: new Date(),
      },
    });
    await testDb.prisma.message.create({
      data: {
        id: "test-message-id",
        conversationId: conv.id,
        waMessageId: "wa-msg-1",
        fromJid: "5551234567@s.whatsapp.net",
        direction: "in",
        timestamp: new Date(),
        body: Buffer.from("placeholder"),
      },
    });
  }, 60_000);

  it("integration happy path: message.mediaRef + mediaMime updated; media_ready published", async () => {
    const store = new LocalDiskMediaStore(MEDIA_ROOT);
    const subscribeRedis = testRedis.client.duplicate();
    const publishedMessages: string[] = [];

    await new Promise<void>((resolveSubscribe) => {
      void subscribeRedis.subscribe(`ui:events:${userId}`, () => {
        resolveSubscribe();
      });
    });
    subscribeRedis.on("message", (_channel: string, msg: string) => {
      publishedMessages.push(msg);
    });

    const audit = makeAudit();
    const downloader = new MediaDownloader({
      mediaStore: store,
      redis: testRedis.client,
      getPrisma: () => testDb.prisma,
      logger: silentLogger,
      perUserConcurrency: 3,
      globalConcurrency: 10,
      maxBytes: 32 * 1024 * 1024,
      queuePerUserMax: 100,
      audit: audit.fn,
    });

    const payload = Buffer.from("integration media content");
    downloader.enqueue({
      userId,
      messageId: "test-message-id",
      dek: TEST_DEK,
      mimeType: "image/png",
      download: immediateDownload(payload),
    });

    await downloader.stop();

    // Verify DB update.
    const msg = await testDb.prisma.message.findUnique({ where: { id: "test-message-id" } });
    expect(msg?.mediaRef).toBeTruthy();
    expect(msg?.mediaMime).toBe("image/png");

    // Verify stored file decrypts correctly.
    const storedBuf = await store.get(msg!.mediaRef!);
    const ct = parseCiphertext(storedBuf.toString("utf8"));
    const decrypted = decryptWithKey(TEST_DEK, ct);
    const recovered = Buffer.from(decrypted, "base64");
    expect(recovered).toEqual(payload);

    // Wait briefly for Redis message to arrive.
    await new Promise((r) => setTimeout(r, 200));

    const readyEvents = publishedMessages
      .map((m) => JSON.parse(m) as { type: string; messageId: string })
      .filter((e) => e.type === "message.media_ready");
    expect(readyEvents.length).toBeGreaterThanOrEqual(1);
    expect(readyEvents[0]!.messageId).toBe("test-message-id");

    subscribeRedis.disconnect();
  }, 60_000);
});
