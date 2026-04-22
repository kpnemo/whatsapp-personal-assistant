import {
  makeTestDb,
  makeTestRedis,
  seedUser,
  withAuth,
  type TestDb,
  type TestRedis,
} from "@wpa/test-utils";
import type { Express } from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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

describe("invitations route — rate limiting", () => {
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

  it("POST /api/invitations returns 429 on the 11th attempt within window (per user)", async () => {
    const admin = await seedUser(db.prisma, {
      email: "admin-rl@example.com",
      role: "admin",
      password: "correct-horse-battery-staple",
    });
    // Fresh bucket for this user.
    await redis.client.del(`rl:invitations:create:${admin.id}`);

    const agent = await withAuth(app, { user: { id: admin.id, role: "admin" } });
    for (let i = 0; i < 10; i += 1) {
      const res = await agent
        .post("/api/invitations")
        .send({ email: `inv${i.toString()}@example.com` });
      // Some may succeed (201) or fail Prisma uniqueness (500) — we only need to observe that the limiter lets them through.
      expect(res.status).not.toBe(429);
    }
    const eleventh = await agent.post("/api/invitations").send({ email: "inv-limit@example.com" });
    expect(eleventh.status).toBe(429);
    expect(eleventh.body).toMatchObject({ error: "rate_limited" });
  });
});
