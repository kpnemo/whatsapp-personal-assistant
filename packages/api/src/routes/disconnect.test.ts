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

describe("POST /api/pair/disconnect", () => {
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

  it("returns 401 without auth", async () => {
    const res = await request(app).post("/api/pair/disconnect");
    expect(res.status).toBe(401);
  });

  it("204 happy path: updates session status, writes audit row, publishes to Redis stream", async () => {
    const user = await seedUser(db.prisma, {
      email: "disconnect-happy@example.com",
      role: "user",
      password: "correct-horse-battery-staple",
    });

    // Create a whatsapp session to disconnect.
    await db.prisma.whatsappSession.create({
      data: { userId: user.id, status: "paired" },
    });

    const streamLenBefore = await redis.client.xlen("wpa:pair-cmd");
    const auditBefore = await db.prisma.auditLog.count({
      where: { userId: user.id, type: "unpair" },
    });

    const agent = await withAuth(app, { user: { id: user.id, role: "user" } });
    const res = await agent.post("/api/pair/disconnect");
    expect(res.status).toBe(204);

    // Session status changed to disconnected.
    const session = await db.prisma.whatsappSession.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(session.status).toBe("disconnected");

    // Audit row written with type=unpair.
    const audits = await db.prisma.auditLog.findMany({
      where: { userId: user.id, type: "unpair" },
      orderBy: { createdAt: "desc" },
    });
    expect(audits.length).toBe(auditBefore + 1);

    // Decrypt details and assert subtype=soft.
    const { decodeAuditDetails } = await import("../audit/writeAudit.js");
    const decoded = audits[0]!.details
      ? (decodeAuditDetails(TEST_MASTER_KEY, Buffer.from(audits[0]!.details)) as {
          subtype?: string;
        })
      : null;
    expect(decoded).toMatchObject({ subtype: "soft" });

    // Redis stream received a disconnect command.
    const streamLenAfter = await redis.client.xlen("wpa:pair-cmd");
    expect(streamLenAfter).toBe(streamLenBefore + 1);

    const entries = await redis.client.xrevrange("wpa:pair-cmd", "+", "-", "COUNT", 1);
    expect(entries).toHaveLength(1);
    const fields = entries[0]![1];
    const obj: Record<string, string> = {};
    for (let i = 0; i < fields.length; i += 2) obj[fields[i]!] = fields[i + 1]!;
    expect(obj).toMatchObject({ type: "disconnect", userId: user.id });
  });
});
