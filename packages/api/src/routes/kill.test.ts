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

describe("kill route — rate limiting", () => {
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

  it("POST /api/kill returns 429 on the 21st attempt within window (per user)", async () => {
    const user = await seedUser(db.prisma, {
      email: "kill-rl@example.com",
      role: "user",
      password: "correct-horse-battery-staple",
    });
    await redis.client.del(`rl:kill:mute:${user.id}`);
    const agent = await withAuth(app, { user: { id: user.id, role: "user" } });

    for (let i = 0; i < 20; i += 1) {
      const res = await agent.post("/api/kill");
      expect(res.status).toBe(200);
    }
    const twentyFirst = await agent.post("/api/kill");
    expect(twentyFirst.status).toBe(429);
    expect(twentyFirst.body).toMatchObject({ error: "rate_limited" });
  });

  it("POST /api/kill/restore returns 429 on the 21st attempt within window (per user)", async () => {
    const user = await seedUser(db.prisma, {
      email: "kill-restore-rl@example.com",
      role: "user",
      password: "correct-horse-battery-staple",
    });
    await redis.client.del(`rl:kill:restore:${user.id}`);
    const agent = await withAuth(app, { user: { id: user.id, role: "user" } });

    for (let i = 0; i < 20; i += 1) {
      const res = await agent.post("/api/kill/restore");
      expect(res.status).toBe(200);
    }
    const twentyFirst = await agent.post("/api/kill/restore");
    expect(twentyFirst.status).toBe(429);
    expect(twentyFirst.body).toMatchObject({ error: "rate_limited" });
  });
});
