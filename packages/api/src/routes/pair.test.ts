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

// NB: decodeAuditDetails is imported dynamically inside the audit-assertion
// test. Importing it at the top level would transitively load ../env.js BEFORE
// bootstrap() gets a chance to set DATABASE_URL/REDIS_URL, causing the app to
// connect to the test-setup defaults instead of the testcontainer.

interface StatusBody {
  state: string;
  sessionId: string | null;
  phoneNumber: string | null;
  updatedAt: string | null;
}

/**
 * End-to-end tests against a real Postgres + Redis testcontainer, mirroring
 * the pattern used by auth.test.ts / kill.test.ts / invitations.test.ts.
 */
async function bootstrap(): Promise<{
  app: Express;
  db: TestDb;
  redis: TestRedis;
}> {
  const db = await makeTestDb();
  const redis = await makeTestRedis();
  process.env.DATABASE_URL = db.url;
  process.env.REDIS_URL = redis.url;
  const { createApp } = await import("../app.js");
  return { app: createApp(), db, redis };
}

/** Seed an encrypted phoneNumber onto an existing WhatsappSession row. */
async function setEncryptedPhone(db: TestDb, userId: string, plaintext: string): Promise<void> {
  const user = await db.prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { encryptedDek: true },
  });
  const wrapped = parseCiphertext(Buffer.from(user.encryptedDek).toString("utf8"));
  const dek = unwrapDek(TEST_MASTER_KEY, wrapped);
  const ct = encryptWithKey(dek, plaintext);
  const phoneBytes = Buffer.from(serializeCiphertext(ct));
  await db.prisma.whatsappSession.update({
    where: { userId },
    data: { phoneNumber: phoneBytes },
  });
}

describe("pair routes — /api/pair/{init,status,qr}", () => {
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

  async function clearRlKey(userId: string): Promise<void> {
    await redis.client.del(`rl:pair:init:${userId}`);
  }

  // -------- POST /pair/init --------

  it("POST /api/pair/init returns 401 without a bearer token", async () => {
    const res = await request(app).post("/api/pair/init");
    expect(res.status).toBe(401);
  });

  it("POST /api/pair/init upserts session, publishes XADD command, audits, and returns sessionId", async () => {
    const user = await seedUser(db.prisma, {
      email: "pair-init@example.com",
      role: "user",
      password: "correct-horse-battery-staple",
    });
    await clearRlKey(user.id);

    // Capture stream length so we can assert exactly one command was appended.
    const beforeLen = await redis.client.xlen("wpa:pair-cmd");
    const auditBefore = await db.prisma.auditLog.count({
      where: { userId: user.id, type: "pair" },
    });

    const agent = await withAuth(app, { user: { id: user.id, role: "user" } });
    const res = await agent.post("/api/pair/init");

    expect(res.status).toBe(201);
    const initBody = res.body as { sessionId: string };
    expect(typeof initBody.sessionId).toBe("string");
    expect(initBody.sessionId.length).toBeGreaterThan(0);

    // Session row exists with status=pairing.
    const session = await db.prisma.whatsappSession.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(session.status).toBe("pairing");
    expect(session.id).toBe(initBody.sessionId);

    // Stream grew by exactly one; message shape matches the worker contract.
    const afterLen = await redis.client.xlen("wpa:pair-cmd");
    expect(afterLen).toBe(beforeLen + 1);
    const entries = await redis.client.xrevrange("wpa:pair-cmd", "+", "-", "COUNT", 1);
    expect(entries).toHaveLength(1);
    const fields = entries[0]![1];
    // fields is a flat [k, v, k, v] array; convert to object for stable asserts.
    const obj: Record<string, string> = {};
    for (let i = 0; i < fields.length; i += 2) obj[fields[i]!] = fields[i + 1]!;
    expect(obj).toMatchObject({ type: "init", userId: user.id });

    // Exactly one new audit row of type=pair with subtype=init in encrypted details.
    const audits = await db.prisma.auditLog.findMany({
      where: { userId: user.id, type: "pair" },
      orderBy: { createdAt: "desc" },
    });
    expect(audits.length).toBe(auditBefore + 1);
    const { decodeAuditDetails } = await import("../audit/writeAudit.js");
    const decoded = audits[0]!.details
      ? (decodeAuditDetails(TEST_MASTER_KEY, Buffer.from(audits[0]!.details)) as {
          subtype?: string;
        })
      : null;
    expect(decoded).toMatchObject({ subtype: "init" });
  });

  it("POST /api/pair/init is rate-limited per user (4th request in window → 429); other users unaffected", async () => {
    const userA = await seedUser(db.prisma, {
      email: "pair-rl-a@example.com",
      role: "user",
      password: "correct-horse-battery-staple",
    });
    const userB = await seedUser(db.prisma, {
      email: "pair-rl-b@example.com",
      role: "user",
      password: "correct-horse-battery-staple",
    });
    await clearRlKey(userA.id);
    await clearRlKey(userB.id);

    const agentA = await withAuth(app, { user: { id: userA.id, role: "user" } });
    for (let i = 0; i < 3; i += 1) {
      const res = await agentA.post("/api/pair/init");
      expect(res.status).toBe(201);
    }
    const fourth = await agentA.post("/api/pair/init");
    expect(fourth.status).toBe(429);
    expect(fourth.headers["retry-after"]).toBeDefined();
    expect(fourth.body).toMatchObject({ error: "rate_limited" });

    // Per-user key isolation: user B still has a fresh bucket.
    const agentB = await withAuth(app, { user: { id: userB.id, role: "user" } });
    const bFirst = await agentB.post("/api/pair/init");
    expect(bFirst.status).toBe(201);
  });

  // -------- GET /pair/status --------

  it("GET /api/pair/status returns 401 without a bearer token", async () => {
    const res = await request(app).get("/api/pair/status");
    expect(res.status).toBe(401);
  });

  it("GET /api/pair/status returns {state:none,...null} when no session exists", async () => {
    const user = await seedUser(db.prisma, {
      email: "pair-status-none@example.com",
      role: "user",
      password: "correct-horse-battery-staple",
    });
    const agent = await withAuth(app, { user: { id: user.id, role: "user" } });
    const res = await agent.get("/api/pair/status");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      state: "none",
      sessionId: null,
      phoneNumber: null,
      updatedAt: null,
    });
  });

  it("GET /api/pair/status returns state=paired + decrypted phoneNumber when session is paired", async () => {
    const user = await seedUser(db.prisma, {
      email: "pair-status-paired@example.com",
      role: "user",
      password: "correct-horse-battery-staple",
    });
    await db.prisma.whatsappSession.create({
      data: { userId: user.id, status: "paired" },
    });
    await setEncryptedPhone(db, user.id, "1234567890");
    await redis.client.set(`wpa:wa-session:${user.id}:state`, "paired");

    const agent = await withAuth(app, { user: { id: user.id, role: "user" } });
    const res = await agent.get("/api/pair/status");
    expect(res.status).toBe(200);
    const body = res.body as StatusBody;
    expect(body.state).toBe("paired");
    expect(body.phoneNumber).toBe("1234567890");
    expect(typeof body.sessionId).toBe("string");
    expect(typeof body.updatedAt).toBe("string");
  });

  it("GET /api/pair/status with state=generating does NOT decrypt phoneNumber (returns null even if stored)", async () => {
    const user = await seedUser(db.prisma, {
      email: "pair-status-gen@example.com",
      role: "user",
      password: "correct-horse-battery-staple",
    });
    await db.prisma.whatsappSession.create({
      data: { userId: user.id, status: "pairing" },
    });
    await setEncryptedPhone(db, user.id, "5555550000");
    await redis.client.set(`wpa:wa-session:${user.id}:state`, "generating");

    const agent = await withAuth(app, { user: { id: user.id, role: "user" } });
    const res = await agent.get("/api/pair/status");
    expect(res.status).toBe(200);
    const body = res.body as StatusBody;
    expect(body.state).toBe("generating");
    expect(body.phoneNumber).toBeNull();
  });

  it("GET /api/pair/status returns phoneNumber=null when the stored ciphertext is corrupt (decrypt error is swallowed, never leaked)", async () => {
    const user = await seedUser(db.prisma, {
      email: "pair-status-corrupt@example.com",
      role: "user",
      password: "correct-horse-battery-staple",
    });
    await db.prisma.whatsappSession.create({
      data: {
        userId: user.id,
        status: "paired",
        // Garbage bytes — parseCiphertext will throw on the ".".split(3) check.
        phoneNumber: Buffer.from("not-a-valid-ciphertext"),
      },
    });
    await redis.client.set(`wpa:wa-session:${user.id}:state`, "paired");

    const agent = await withAuth(app, { user: { id: user.id, role: "user" } });
    const res = await agent.get("/api/pair/status");
    expect(res.status).toBe(200);
    const body = res.body as StatusBody;
    expect(body.state).toBe("paired");
    expect(body.phoneNumber).toBeNull();
  });

  // -------- GET /pair/qr --------

  it("GET /api/pair/qr returns 401 without a bearer token", async () => {
    const res = await request(app).get("/api/pair/qr");
    expect(res.status).toBe(401);
  });

  it("GET /api/pair/qr returns 404 when no QR is cached in Redis", async () => {
    const user = await seedUser(db.prisma, {
      email: "pair-qr-none@example.com",
      role: "user",
      password: "correct-horse-battery-staple",
    });
    await redis.client.del(`wpa:pair:${user.id}:qr`);
    const agent = await withAuth(app, { user: { id: user.id, role: "user" } });
    const res = await agent.get("/api/pair/qr");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "no_qr_available" });
  });

  it("GET /api/pair/qr returns base64 JSON with no-store Cache-Control when cached", async () => {
    const user = await seedUser(db.prisma, {
      email: "pair-qr-present@example.com",
      role: "user",
      password: "correct-horse-battery-staple",
    });
    // We return JSON (not binary image/png) so the SPA can attach the bearer
    // token via fetch() — browsers won't attach Authorization headers to
    // <img src="..."> requests. The SPA renders <img src="data:image/png;base64,...">.
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const base64 = pngBytes.toString("base64");
    await redis.client.set(`wpa:pair:${user.id}:qr`, base64, "EX", 30);

    const agent = await withAuth(app, { user: { id: user.id, role: "user" } });
    const res = await agent.get("/api/pair/qr");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.headers["cache-control"]).toContain("no-store");
    expect(res.body).toEqual({ qrPng: base64 });
  });

  // -------- origin-guard defence-in-depth --------

  it("POST /api/pair/init with a mismatched Origin header is rejected (403) by origin-guard", async () => {
    const user = await seedUser(db.prisma, {
      email: "pair-origin@example.com",
      role: "user",
      password: "correct-horse-battery-staple",
    });
    await clearRlKey(user.id);
    const agent = await withAuth(app, { user: { id: user.id, role: "user" } });
    const res = await agent.post("/api/pair/init").set("Origin", "https://evil.test");
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "forbidden_origin" });
  });
});
