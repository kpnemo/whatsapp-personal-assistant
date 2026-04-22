/**
 * Integration tests for persist() — uses testcontainers (real Postgres + Redis).
 *
 * These tests are intentionally sequential (describe.sequential) because they
 * share a single DB + Redis instance to cut container startup time.
 */
import { generateKey, decryptWithKey, parseCiphertext } from "@wpa/shared";
import { makeTestDb, makeTestRedis, seedUser, type TestDb, type TestRedis } from "@wpa/test-utils";
import { pino } from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { type NormalizedMessage } from "./normalize.js";
import { persist } from "./persist.js";

const silentLogger = pino({ level: "silent" });
void silentLogger; // satisfy unused-var lint

const TEST_DEK = generateKey();

function makeNormalized(overrides: Partial<NormalizedMessage> = {}): NormalizedMessage {
  return {
    conversationJid: "5551234567@s.whatsapp.net",
    conversationType: "dm",
    waMessageId: "test-msg-id-1",
    fromJid: "5551234567@s.whatsapp.net",
    direction: "in",
    timestamp: new Date("2024-01-01T12:00:00Z"),
    body: { kind: "text", text: "hello world" },
    ...overrides,
  };
}

describe.sequential("persist — integration", () => {
  let testDb: TestDb;
  let testRedis: TestRedis;
  let userId: string;

  beforeAll(async () => {
    testDb = await makeTestDb();
    testRedis = await makeTestRedis();
  }, 180_000);

  afterAll(async () => {
    if (testDb) await testDb.teardown();
    if (testRedis) await testRedis.teardown();
  }, 60_000);

  beforeEach(async () => {
    // Clean tables but keep containers running.
    await testDb.prisma.message.deleteMany();
    await testDb.prisma.conversation.deleteMany();
    await testDb.prisma.waContact.deleteMany();
    await testDb.prisma.waGroup.deleteMany();
    await testDb.prisma.auditLog.deleteMany();
    await testDb.prisma.user.deleteMany();
    await testRedis.client.flushdb();

    const user = await seedUser(testDb.prisma, {
      email: "persist-test@example.com",
      role: "user",
      password: "password1234567890",
    });
    userId = user.id;
  });

  it("round-trip: persists message with encrypted body; decrypt verifies JSON", async () => {
    const normalized = makeNormalized();
    await persist(userId, normalized, {
      prisma: testDb.prisma,
      dek: TEST_DEK,
      redis: testRedis.client,
    });

    const messages = await testDb.prisma.message.findMany();
    expect(messages).toHaveLength(1);

    const msg = messages[0]!;
    const bodyStr = Buffer.from(msg.body).toString("utf8");
    const ct = parseCiphertext(bodyStr);
    const decrypted = decryptWithKey(TEST_DEK, ct);
    const body = JSON.parse(decrypted) as NormalizedMessage["body"];
    expect(body.kind).toBe("text");
    expect(body.text).toBe("hello world");
  }, 60_000);

  it("contact upsert: first message creates WaContact; second message reuses it", async () => {
    const normalized = makeNormalized({ waMessageId: "msg-a" });
    await persist(userId, normalized, {
      prisma: testDb.prisma,
      dek: TEST_DEK,
      redis: testRedis.client,
    });

    const normalized2 = makeNormalized({
      waMessageId: "msg-b",
      body: { kind: "text", text: "second" },
    });
    await persist(userId, normalized2, {
      prisma: testDb.prisma,
      dek: TEST_DEK,
      redis: testRedis.client,
    });

    const contacts = await testDb.prisma.waContact.findMany({ where: { userId } });
    expect(contacts).toHaveLength(1);
    expect(contacts[0]!.jid).toBe("5551234567@s.whatsapp.net");

    const messages = await testDb.prisma.message.findMany({ where: { conversation: { userId } } });
    expect(messages).toHaveLength(2);
  }, 60_000);

  it("conversation upsert: lastMessageAt bumped on each message", async () => {
    const t1 = new Date("2024-01-01T10:00:00Z");
    const t2 = new Date("2024-01-01T11:00:00Z");

    await persist(userId, makeNormalized({ waMessageId: "msg-t1", timestamp: t1 }), {
      prisma: testDb.prisma,
      dek: TEST_DEK,
      redis: testRedis.client,
    });
    await persist(userId, makeNormalized({ waMessageId: "msg-t2", timestamp: t2 }), {
      prisma: testDb.prisma,
      dek: TEST_DEK,
      redis: testRedis.client,
    });

    const conv = await testDb.prisma.conversation.findFirst({ where: { userId } });
    expect(conv?.lastMessageAt?.toISOString()).toBe(t2.toISOString());
  }, 60_000);

  it("idempotency: calling persist twice with same waMessageId is a no-op", async () => {
    const normalized = makeNormalized();
    await persist(userId, normalized, {
      prisma: testDb.prisma,
      dek: TEST_DEK,
      redis: testRedis.client,
    });
    // Second call — same waMessageId.
    await persist(userId, normalized, {
      prisma: testDb.prisma,
      dek: TEST_DEK,
      redis: testRedis.client,
    });

    const messages = await testDb.prisma.message.findMany();
    expect(messages).toHaveLength(1);
  }, 60_000);

  it("media: if mediaMeta present, enqueueMedia spy is called with correct args", async () => {
    const normalized = makeNormalized({
      body: {
        kind: "image",
        text: "photo",
        mediaMeta: { mimeType: "image/jpeg", width: 800, height: 600 },
      },
    });

    const enqueueMedia = vi.fn();
    await persist(userId, normalized, {
      prisma: testDb.prisma,
      dek: TEST_DEK,
      redis: testRedis.client,
      enqueueMedia,
    });

    expect(enqueueMedia).toHaveBeenCalledOnce();
    const call = enqueueMedia.mock.calls[0]![0] as {
      messageId: string;
      userId: string;
      normalized: NormalizedMessage;
    };
    expect(call.userId).toBe(userId);
    expect(call.normalized.body.kind).toBe("image");
    expect(typeof call.messageId).toBe("string");
  }, 60_000);

  it("pubsub: message.created published to ui:events:<userId>", async () => {
    // Subscribe BEFORE persisting.
    const subClient = testRedis.client.duplicate();
    const received: string[] = [];
    await subClient.subscribe(`ui:events:${userId}`);
    subClient.on("message", (_ch: string, msg: string) => {
      received.push(msg);
    });

    const normalized = makeNormalized();
    await persist(userId, normalized, {
      prisma: testDb.prisma,
      dek: TEST_DEK,
      redis: testRedis.client,
    });

    // Give a brief moment for the Pub/Sub message to arrive.
    await new Promise((r) => setTimeout(r, 100));
    await subClient.unsubscribe();
    subClient.disconnect();

    expect(received).toHaveLength(1);
    const event = JSON.parse(received[0]!) as {
      type: string;
      conversationId: string;
      messageId: string;
      timestamp: string;
    };
    expect(event.type).toBe("message.created");
    expect(typeof event.conversationId).toBe("string");
    expect(typeof event.messageId).toBe("string");
    expect(typeof event.timestamp).toBe("string");
  }, 60_000);

  it("drops duplicate waMessageId idempotently (P2002 race)", async () => {
    // Simulate the TOCTOU race: pre-insert a message directly so the row
    // exists in DB, then call persist() with the same waMessageId — the
    // findUnique guard returns early, no error thrown.
    const normalized = makeNormalized({ waMessageId: "race-test-msg-id" });

    const enqueueMedia = vi.fn();
    await persist(userId, normalized, {
      prisma: testDb.prisma,
      dek: TEST_DEK,
      redis: testRedis.client,
      enqueueMedia,
    });

    // Second call — same waMessageId. findUnique returns existing row → early return.
    const enqueueMedia2 = vi.fn();
    await expect(
      persist(userId, normalized, {
        prisma: testDb.prisma,
        dek: TEST_DEK,
        redis: testRedis.client,
        enqueueMedia: enqueueMedia2,
      }),
    ).resolves.toBeUndefined();

    // Only one row in DB.
    const messages = await testDb.prisma.message.findMany({
      where: { waMessageId: "race-test-msg-id" },
    });
    expect(messages).toHaveLength(1);

    // Second call must not have enqueued media or published again.
    expect(enqueueMedia2).not.toHaveBeenCalled();
  }, 60_000);

  it("P2002 on create is caught as idempotent (direct race simulation)", async () => {
    // Simulate a genuine TOCTOU race by building a fake PrismaClient where
    // findUnique always returns null (guard bypassed) but create throws P2002.
    // persist() must catch P2002 and return cleanly without enqueuing or publishing.
    const { Prisma } = await import("@wpa/db");

    // Seed a real conversation + contact so our fake prisma can return a
    // real conversationId (otherwise conversation.upsert would also need faking).
    const normalizedFirst = makeNormalized({ waMessageId: "p2002-seed-msg" });
    await persist(userId, normalizedFirst, {
      prisma: testDb.prisma,
      dek: TEST_DEK,
      redis: testRedis.client,
    });
    const conv = await testDb.prisma.conversation.findFirst({ where: { userId } });
    expect(conv).not.toBeNull();

    // Build a minimal fake prisma that mimics the race-loser path:
    //   - waContact/waGroup upsert succeeds
    //   - conversation upsert returns the real conv id
    //   - message.findUnique returns null (guard bypassed)
    //   - message.create throws P2002 (race loser arrives after winner committed)
    const p2002 = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "5.0.0",
    });
    const fakePrisma = {
      waContact: { upsert: vi.fn().mockResolvedValue({}) },
      waGroup: { upsert: vi.fn().mockResolvedValue({}) },
      conversation: { upsert: vi.fn().mockResolvedValue({ id: conv!.id }) },
      message: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockRejectedValue(p2002),
      },
    } as unknown as typeof testDb.prisma;

    const enqueueMedia = vi.fn();
    const normalized = makeNormalized({ waMessageId: "p2002-race-victim" });

    // Must not throw — P2002 is silently treated as idempotent.
    await expect(
      persist(userId, normalized, {
        prisma: fakePrisma,
        dek: TEST_DEK,
        redis: testRedis.client,
        enqueueMedia,
      }),
    ).resolves.toBeUndefined();

    // Media was NOT enqueued by the race loser.
    expect(enqueueMedia).not.toHaveBeenCalled();
  }, 60_000);

  it("group conversation: upserts WaGroup instead of WaContact", async () => {
    const normalized = makeNormalized({
      conversationJid: "112233445566-123456@g.us",
      conversationType: "group",
      fromJid: "5551234567@s.whatsapp.net",
    });

    await persist(userId, normalized, {
      prisma: testDb.prisma,
      dek: TEST_DEK,
      redis: testRedis.client,
    });

    const groups = await testDb.prisma.waGroup.findMany({ where: { userId } });
    expect(groups).toHaveLength(1);
    expect(groups[0]!.jid).toBe("112233445566-123456@g.us");

    const contacts = await testDb.prisma.waContact.findMany({ where: { userId } });
    expect(contacts).toHaveLength(0);
  }, 60_000);
});
