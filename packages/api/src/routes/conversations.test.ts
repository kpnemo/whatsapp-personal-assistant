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

/** Encrypt a string with a user's DEK and return a Buffer ready for Prisma Bytes columns. */
function encryptField(dek: Buffer, value: string): Buffer {
  return Buffer.from(serializeCiphertext(encryptWithKey(dek, value)));
}

/** Get a user's DEK from their encryptedDek column. */
function getUserDek(encryptedDek: Buffer): Buffer {
  const wrapped = parseCiphertext(encryptedDek.toString("utf8"));
  return unwrapDek(TEST_MASTER_KEY, wrapped);
}

describe("GET /api/conversations", () => {
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

  it("returns 401 when no auth header", async () => {
    const res = await request(app).get("/api/conversations");
    expect(res.status).toBe(401);
  });

  it("returns 200 + empty array for a user with no conversations", async () => {
    const user = await seedUser(db.prisma, {
      email: "conv-empty@example.com",
      role: "user",
      password: "correct-horse-battery-staple",
    });
    const agent = await withAuth(app, { user: { id: user.id, role: "user" } });
    const res = await agent.get("/api/conversations");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ conversations: [], nextCursor: null });
  });

  it("returns conversations ordered by lastMessageAt DESC", async () => {
    const user = await seedUser(db.prisma, {
      email: "conv-order@example.com",
      role: "user",
      password: "correct-horse-battery-staple",
    });

    const t1 = new Date("2026-01-01T10:00:00.000Z");
    const t2 = new Date("2026-01-02T10:00:00.000Z");

    await db.prisma.conversation.create({
      data: {
        userId: user.id,
        jid: "111@s.whatsapp.net",
        type: "dm",
        lastMessageAt: t1,
      },
    });
    await db.prisma.conversation.create({
      data: {
        userId: user.id,
        jid: "222@s.whatsapp.net",
        type: "dm",
        lastMessageAt: t2,
      },
    });

    const agent = await withAuth(app, { user: { id: user.id, role: "user" } });
    const res = await agent.get("/api/conversations");
    expect(res.status).toBe(200);

    const { conversations } = res.body as { conversations: { jid: string }[] };
    expect(conversations).toHaveLength(2);
    expect(conversations[0]!.jid).toBe("222@s.whatsapp.net");
    expect(conversations[1]!.jid).toBe("111@s.whatsapp.net");
  });

  it("respects limit and sets nextCursor on overflow", async () => {
    const user = await seedUser(db.prisma, {
      email: "conv-limit@example.com",
      role: "user",
      password: "correct-horse-battery-staple",
    });

    // Create 3 conversations; request limit=2 → expect nextCursor set.
    for (let i = 0; i < 3; i++) {
      await db.prisma.conversation.create({
        data: {
          userId: user.id,
          jid: `limit-${i.toString()}@s.whatsapp.net`,
          type: "dm",
          lastMessageAt: new Date(Date.now() - i * 1000).toISOString(),
        },
      });
    }

    const agent = await withAuth(app, { user: { id: user.id, role: "user" } });
    const res = await agent.get("/api/conversations?limit=2");
    expect(res.status).toBe(200);

    const body = res.body as { conversations: unknown[]; nextCursor: string | null };
    expect(body.conversations).toHaveLength(2);
    expect(body.nextCursor).not.toBeNull();
  });

  it("cursor continues pagination correctly", async () => {
    const user = await seedUser(db.prisma, {
      email: "conv-cursor@example.com",
      role: "user",
      password: "correct-horse-battery-staple",
    });

    const times = [
      new Date("2026-03-03T03:00:00.000Z"),
      new Date("2026-03-02T02:00:00.000Z"),
      new Date("2026-03-01T01:00:00.000Z"),
    ];

    for (let i = 0; i < 3; i++) {
      await db.prisma.conversation.create({
        data: {
          userId: user.id,
          jid: `cursor-${i.toString()}@s.whatsapp.net`,
          type: "dm",
          lastMessageAt: times[i]!,
        },
      });
    }

    const agent = await withAuth(app, { user: { id: user.id, role: "user" } });

    // Page 1
    const page1 = await agent.get("/api/conversations?limit=2");
    expect(page1.status).toBe(200);
    const body1 = page1.body as {
      conversations: { jid: string }[];
      nextCursor: string;
    };
    expect(body1.conversations).toHaveLength(2);
    expect(body1.nextCursor).not.toBeNull();

    // Page 2
    const page2 = await agent.get(
      `/api/conversations?limit=2&cursor=${encodeURIComponent(body1.nextCursor)}`,
    );
    expect(page2.status).toBe(200);
    const body2 = page2.body as {
      conversations: { jid: string }[];
      nextCursor: string | null;
    };
    expect(body2.conversations).toHaveLength(1);
    expect(body2.nextCursor).toBeNull();

    // No overlap
    const jids1 = body1.conversations.map((c) => c.jid);
    const jids2 = body2.conversations.map((c) => c.jid);
    expect(jids1.every((j) => !jids2.includes(j))).toBe(true);
  });

  it("DM: shows decrypted contact name as title", async () => {
    const user = await seedUser(db.prisma, {
      email: "conv-dm-contact@example.com",
      role: "user",
      password: "correct-horse-battery-staple",
    });
    const dek = getUserDek(user.encryptedDek);
    const jid = "44770@s.whatsapp.net";

    await db.prisma.conversation.create({
      data: { userId: user.id, jid, type: "dm" },
    });
    await db.prisma.waContact.create({
      data: {
        userId: user.id,
        jid,
        name: encryptField(dek, "Mom"),
      },
    });

    const agent = await withAuth(app, { user: { id: user.id, role: "user" } });
    const res = await agent.get("/api/conversations");
    expect(res.status).toBe(200);

    const { conversations } = res.body as { conversations: { title: string; subtitle?: string }[] };
    expect(conversations).toHaveLength(1);
    expect(conversations[0]!.title).toBe("Mom");
    expect(conversations[0]!.subtitle).toBeUndefined();
  });

  it("returns subtitle 'not in contacts' for a DM with no WaContact row", async () => {
    const user = await seedUser(db.prisma, {
      email: "conv-dm-unknown@example.com",
      role: "user",
      password: "correct-horse-battery-staple",
    });

    await db.prisma.conversation.create({
      data: {
        userId: user.id,
        jid: "999888777@s.whatsapp.net",
        type: "dm",
        lastMessageAt: new Date(),
      },
    });

    const agent = await withAuth(app, { user: { id: user.id, role: "user" } });
    const res = await agent.get("/api/conversations");
    expect(res.status).toBe(200);

    const { conversations } = res.body as {
      conversations: { jid: string; title: string; subtitle?: string }[];
    };
    const conv = conversations.find((c) => c.jid === "999888777@s.whatsapp.net");
    expect(conv).toBeDefined();
    expect(conv!.subtitle).toBe("not in contacts");
    // title fallback should be the formatted jid ("+999888777")
    expect(conv!.title).toMatch(/^\+/);
  });

  it("Group: shows decrypted group subject as title", async () => {
    const user = await seedUser(db.prisma, {
      email: "conv-group@example.com",
      role: "user",
      password: "correct-horse-battery-staple",
    });
    const dek = getUserDek(user.encryptedDek);
    const jid = "999@g.us";

    await db.prisma.conversation.create({
      data: { userId: user.id, jid, type: "group" },
    });
    await db.prisma.waGroup.create({
      data: {
        userId: user.id,
        jid,
        subject: encryptField(dek, "Family Chat"),
      },
    });

    const agent = await withAuth(app, { user: { id: user.id, role: "user" } });
    const res = await agent.get("/api/conversations");
    expect(res.status).toBe(200);

    const { conversations } = res.body as { conversations: { title: string }[] };
    expect(conversations).toHaveLength(1);
    expect(conversations[0]!.title).toBe("Family Chat");
  });

  it("user B's conversations never appear for user A", async () => {
    const userA = await seedUser(db.prisma, {
      email: "conv-iso-a@example.com",
      role: "user",
      password: "correct-horse-battery-staple",
    });
    const userB = await seedUser(db.prisma, {
      email: "conv-iso-b@example.com",
      role: "user",
      password: "correct-horse-battery-staple",
    });

    await db.prisma.conversation.create({
      data: { userId: userA.id, jid: "aaa@s.whatsapp.net", type: "dm" },
    });
    await db.prisma.conversation.create({
      data: { userId: userB.id, jid: "bbb@s.whatsapp.net", type: "dm" },
    });

    const agentA = await withAuth(app, { user: { id: userA.id, role: "user" } });
    const res = await agentA.get("/api/conversations");
    expect(res.status).toBe(200);

    const { conversations } = res.body as { conversations: { jid: string }[] };
    expect(conversations.some((c) => c.jid === "bbb@s.whatsapp.net")).toBe(false);
    expect(conversations.some((c) => c.jid === "aaa@s.whatsapp.net")).toBe(true);
  });
});
