import { encryptWithKey, parseCiphertext, serializeCiphertext, unwrapDek } from "@wpa/shared";
import {
  TEST_MASTER_KEY,
  makeTestDb,
  makeTestRedis,
  seedUser,
  withAuth,
  type TestDb,
  type TestRedis,
} from "@wpa/test-utils";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

async function bootstrap(): Promise<{ app: Express; db: TestDb; redis: TestRedis }> {
  const db = await makeTestDb();
  const redis = await makeTestRedis();
  process.env.DATABASE_URL = db.url;
  process.env.REDIS_URL = redis.url;
  const { createApp } = await import("../app.js");
  return { app: createApp(), db, redis };
}

/** Encrypt a string with a DEK and return Prisma-ready Bytes. */
function encryptField(dek: Buffer, value: string): Buffer {
  return Buffer.from(serializeCiphertext(encryptWithKey(dek, value)));
}

function getUserDek(encryptedDek: Buffer): Buffer {
  const wrapped = parseCiphertext(encryptedDek.toString("utf8"));
  return unwrapDek(TEST_MASTER_KEY, wrapped);
}

describe("messages routes", () => {
  let app: Express;
  let db: TestDb;
  let redis: TestRedis;

  beforeAll(async () => {
    const b = await bootstrap();
    app = b.app;
    db = b.db;
    redis = b.redis;
  }, 180_000);

  afterAll(async () => {
    const { disconnectPrisma } = await import("@wpa/db");
    const { disconnectRedis } = await import("../redis.js");
    await disconnectPrisma();
    await disconnectRedis();
    if (db) await db.teardown();
    if (redis) await redis.teardown();
  }, 60_000);

  // ---- GET /api/conversations/:id/messages ----

  it("GET /api/conversations/:id/messages returns 401 without auth", async () => {
    const res = await request(app).get("/api/conversations/some-id/messages");
    expect(res.status).toBe(401);
  });

  it("GET /api/conversations/:id/messages returns 404 for a conversation owned by another user", async () => {
    const userA = await seedUser(db.prisma, {
      email: "msg-404-a@example.com",
      role: "user",
      password: "correct-horse-battery-staple",
    });
    const userB = await seedUser(db.prisma, {
      email: "msg-404-b@example.com",
      role: "user",
      password: "correct-horse-battery-staple",
    });

    const conv = await db.prisma.conversation.create({
      data: { userId: userB.id, jid: "404jid@s.whatsapp.net", type: "dm" },
    });

    const agentA = await withAuth(app, { user: { id: userA.id, role: "user" } });
    const res = await agentA.get(`/api/conversations/${conv.id}/messages`);
    expect(res.status).toBe(404);
  });

  it("GET /api/conversations/:id/messages returns 404 for a non-existent conversation", async () => {
    const user = await seedUser(db.prisma, {
      email: "msg-404-missing@example.com",
      role: "user",
      password: "correct-horse-battery-staple",
    });

    const agent = await withAuth(app, { user: { id: user.id, role: "user" } });
    const res = await agent.get("/api/conversations/nonexistent-id/messages");
    expect(res.status).toBe(404);
  });

  it("returns messages ordered by timestamp DESC with default limit 50", async () => {
    const user = await seedUser(db.prisma, {
      email: "msg-order@example.com",
      role: "user",
      password: "correct-horse-battery-staple",
    });
    const dek = getUserDek(user.encryptedDek);

    const conv = await db.prisma.conversation.create({
      data: { userId: user.id, jid: "order@s.whatsapp.net", type: "dm" },
    });

    const t1 = new Date("2026-01-01T10:00:00.000Z");
    const t2 = new Date("2026-01-02T10:00:00.000Z");

    await db.prisma.message.createMany({
      data: [
        {
          conversationId: conv.id,
          waMessageId: "wamsg1",
          fromJid: "order@s.whatsapp.net",
          direction: "in",
          timestamp: t1,
          body: encryptField(dek, JSON.stringify({ kind: "text", text: "Hello" })),
        },
        {
          conversationId: conv.id,
          waMessageId: "wamsg2",
          fromJid: "order@s.whatsapp.net",
          direction: "in",
          timestamp: t2,
          body: encryptField(dek, JSON.stringify({ kind: "text", text: "World" })),
        },
      ],
    });

    const agent = await withAuth(app, { user: { id: user.id, role: "user" } });
    const res = await agent.get(`/api/conversations/${conv.id}/messages`);
    expect(res.status).toBe(200);

    const body = res.body as { messages: { timestamp: string }[]; hasMore: boolean };
    expect(body.messages).toHaveLength(2);
    expect(new Date(body.messages[0]!.timestamp).getTime()).toBeGreaterThan(
      new Date(body.messages[1]!.timestamp).getTime(),
    );
    expect(body.hasMore).toBe(false);
  });

  it("paginates with the `before` cursor", async () => {
    const user = await seedUser(db.prisma, {
      email: "msg-before@example.com",
      role: "user",
      password: "correct-horse-battery-staple",
    });
    const dek = getUserDek(user.encryptedDek);

    const conv = await db.prisma.conversation.create({
      data: { userId: user.id, jid: "before@s.whatsapp.net", type: "dm" },
    });

    const times = [
      new Date("2026-04-01T01:00:00.000Z"),
      new Date("2026-04-02T02:00:00.000Z"),
      new Date("2026-04-03T03:00:00.000Z"),
    ];

    for (let i = 0; i < 3; i++) {
      await db.prisma.message.create({
        data: {
          conversationId: conv.id,
          waMessageId: `before-msg-${i.toString()}`,
          fromJid: "before@s.whatsapp.net",
          direction: "in",
          timestamp: times[i]!,
          body: encryptField(dek, JSON.stringify({ kind: "text", text: `msg ${i.toString()}` })),
        },
      });
    }

    const agent = await withAuth(app, { user: { id: user.id, role: "user" } });

    // Page 1: newest 2
    const page1 = await agent.get(`/api/conversations/${conv.id}/messages?limit=2`);
    expect(page1.status).toBe(200);
    const body1 = page1.body as { messages: { timestamp: string }[]; hasMore: boolean };
    expect(body1.messages).toHaveLength(2);
    expect(body1.hasMore).toBe(true);

    // Page 2: before the oldest on page 1
    const beforeTs = body1.messages[1]!.timestamp;
    const page2 = await agent.get(
      `/api/conversations/${conv.id}/messages?limit=2&before=${encodeURIComponent(beforeTs)}`,
    );
    expect(page2.status).toBe(200);
    const body2 = page2.body as { messages: { timestamp: string }[]; hasMore: boolean };
    expect(body2.messages).toHaveLength(1);
    expect(body2.hasMore).toBe(false);
    // No overlap
    const ts1 = body1.messages.map((m) => m.timestamp);
    const ts2 = body2.messages.map((m) => m.timestamp);
    expect(ts1.every((t) => !ts2.includes(t))).toBe(true);
  });

  it("returns decrypted body JSON", async () => {
    const user = await seedUser(db.prisma, {
      email: "msg-body@example.com",
      role: "user",
      password: "correct-horse-battery-staple",
    });
    const dek = getUserDek(user.encryptedDek);

    const conv = await db.prisma.conversation.create({
      data: { userId: user.id, jid: "body@s.whatsapp.net", type: "dm" },
    });

    const bodyPayload = { kind: "text", text: "Secret message" };
    await db.prisma.message.create({
      data: {
        conversationId: conv.id,
        waMessageId: "body-wamsg",
        fromJid: "body@s.whatsapp.net",
        direction: "in",
        timestamp: new Date(),
        body: encryptField(dek, JSON.stringify(bodyPayload)),
      },
    });

    const agent = await withAuth(app, { user: { id: user.id, role: "user" } });
    const res = await agent.get(`/api/conversations/${conv.id}/messages`);
    expect(res.status).toBe(200);

    const { messages } = res.body as { messages: { body: { kind: string; text: string } }[] };
    expect(messages[0]!.body).toEqual(bodyPayload);
  });

  it("hasMedia is true when mediaRef is non-null", async () => {
    const user = await seedUser(db.prisma, {
      email: "msg-media@example.com",
      role: "user",
      password: "correct-horse-battery-staple",
    });
    const dek = getUserDek(user.encryptedDek);

    const conv = await db.prisma.conversation.create({
      data: { userId: user.id, jid: "media-flag@s.whatsapp.net", type: "dm" },
    });

    await db.prisma.message.create({
      data: {
        conversationId: conv.id,
        waMessageId: "media-wamsg",
        fromJid: "media-flag@s.whatsapp.net",
        direction: "in",
        timestamp: new Date(),
        body: encryptField(dek, JSON.stringify({ kind: "image" })),
        mediaRef: "some/path/to/file.enc",
        mediaMime: "image/jpeg",
      },
    });

    const agent = await withAuth(app, { user: { id: user.id, role: "user" } });
    const res = await agent.get(`/api/conversations/${conv.id}/messages`);
    expect(res.status).toBe(200);

    const { messages } = res.body as { messages: { hasMedia: boolean }[] };
    expect(messages[0]!.hasMedia).toBe(true);
  });

  // ---- GET /api/messages/:id ----

  it("returns 429 after exceeding 120 req/min on GET /api/conversations/:id/messages", async () => {
    const user = await seedUser(db.prisma, {
      email: "msg-list-ratelimit@example.com",
      role: "user",
      password: "correct-horse-battery-staple",
    });

    const conv = await db.prisma.conversation.create({
      data: { userId: user.id, jid: "rl-list@s.whatsapp.net", type: "dm" },
    });

    const agent = await withAuth(app, { user: { id: user.id, role: "user" } });

    // Exhaust the 120-point bucket.
    for (let i = 0; i < 120; i++) {
      const res = await agent.get(`/api/conversations/${conv.id}/messages`);
      expect(res.status).toBe(200);
    }

    // 121st request must be rate-limited.
    const over = await agent.get(`/api/conversations/${conv.id}/messages`);
    expect(over.status).toBe(429);
    expect(over.headers["retry-after"]).toBeDefined();
    const body = over.body as { error: string };
    expect(body.error).toBe("rate_limited");
  });

  it("GET /api/messages/:id returns 401 without auth", async () => {
    const res = await request(app).get("/api/messages/some-id");
    expect(res.status).toBe(401);
  });

  it("GET /api/messages/:id returns 404 for a message owned by another user", async () => {
    const userA = await seedUser(db.prisma, {
      email: "single-msg-iso-a@example.com",
      role: "user",
      password: "correct-horse-battery-staple",
    });
    const userB = await seedUser(db.prisma, {
      email: "single-msg-iso-b@example.com",
      role: "user",
      password: "correct-horse-battery-staple",
    });
    const dekB = getUserDek(userB.encryptedDek);

    const conv = await db.prisma.conversation.create({
      data: { userId: userB.id, jid: "iso-single@s.whatsapp.net", type: "dm" },
    });

    const msg = await db.prisma.message.create({
      data: {
        conversationId: conv.id,
        waMessageId: "iso-single-wamsg",
        fromJid: "iso-single@s.whatsapp.net",
        direction: "in",
        timestamp: new Date(),
        body: encryptField(dekB, JSON.stringify({ kind: "text", text: "private" })),
      },
    });

    const agentA = await withAuth(app, { user: { id: userA.id, role: "user" } });
    const res = await agentA.get(`/api/messages/${msg.id}`);
    expect(res.status).toBe(404);
  });

  it("GET /api/messages/:id returns 404 for non-existent message", async () => {
    const user = await seedUser(db.prisma, {
      email: "single-msg-missing@example.com",
      role: "user",
      password: "correct-horse-battery-staple",
    });
    const agent = await withAuth(app, { user: { id: user.id, role: "user" } });
    const res = await agent.get("/api/messages/nonexistent-id");
    expect(res.status).toBe(404);
  });

  it("returns 429 after exceeding 120 req/min on GET /api/messages/:id", async () => {
    const user = await seedUser(db.prisma, {
      email: "msg-get-ratelimit@example.com",
      role: "user",
      password: "correct-horse-battery-staple",
    });
    const dek = getUserDek(user.encryptedDek);

    const conv = await db.prisma.conversation.create({
      data: { userId: user.id, jid: "rl-get@s.whatsapp.net", type: "dm" },
    });

    const msg = await db.prisma.message.create({
      data: {
        conversationId: conv.id,
        waMessageId: "rl-get-wamsg",
        fromJid: "rl-get@s.whatsapp.net",
        direction: "in",
        timestamp: new Date(),
        body: encryptField(dek, JSON.stringify({ kind: "text", text: "rate limit test" })),
      },
    });

    const agent = await withAuth(app, { user: { id: user.id, role: "user" } });

    // Exhaust the 120-point bucket.
    for (let i = 0; i < 120; i++) {
      const res = await agent.get(`/api/messages/${msg.id}`);
      expect(res.status).toBe(200);
    }

    // 121st request must be rate-limited.
    const over = await agent.get(`/api/messages/${msg.id}`);
    expect(over.status).toBe(429);
    expect(over.headers["retry-after"]).toBeDefined();
    const body = over.body as { error: string };
    expect(body.error).toBe("rate_limited");
  });

  it("GET /api/messages/:id returns the correct message with decrypted body", async () => {
    const user = await seedUser(db.prisma, {
      email: "single-msg-ok@example.com",
      role: "user",
      password: "correct-horse-battery-staple",
    });
    const dek = getUserDek(user.encryptedDek);

    const conv = await db.prisma.conversation.create({
      data: { userId: user.id, jid: "single-ok@s.whatsapp.net", type: "dm" },
    });

    const bodyPayload = { kind: "text", text: "Single message content" };
    const msg = await db.prisma.message.create({
      data: {
        conversationId: conv.id,
        waMessageId: "single-ok-wamsg",
        fromJid: "single-ok@s.whatsapp.net",
        direction: "out",
        timestamp: new Date(),
        body: encryptField(dek, JSON.stringify(bodyPayload)),
      },
    });

    const agent = await withAuth(app, { user: { id: user.id, role: "user" } });
    const res = await agent.get(`/api/messages/${msg.id}`);
    expect(res.status).toBe(200);

    const result = res.body as {
      id: string;
      direction: string;
      body: { kind: string; text: string };
      hasMedia: boolean;
    };
    expect(result.id).toBe(msg.id);
    expect(result.direction).toBe("out");
    expect(result.body).toEqual(bodyPayload);
    expect(result.hasMedia).toBe(false);
  });
});
