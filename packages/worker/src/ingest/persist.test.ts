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
