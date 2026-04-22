import { seedUser, makeTestDb, makeTestRedis, type TestDb, type TestRedis } from "@wpa/test-utils";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * End-to-end route tests against real Postgres + Redis testcontainers.
 *
 * We DYNAMICALLY import createApp() after setting DATABASE_URL + REDIS_URL so
 * the api's parseEnv() picks up the container URLs. Vitest isolates modules per
 * test file by default, so these overrides only affect this file.
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
  // Dynamic import so the updated env is read by api's env.ts at first evaluation.
  const { createApp } = await import("../app.js");
  return { app: createApp(), db, redis };
}

describe("auth routes — rate limiting + CSRF cookie", () => {
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

  async function clearRateKeys(prefix: string): Promise<void> {
    const keys = await redis.client.keys(`${prefix}*`);
    if (keys.length > 0) await redis.client.del(...keys);
  }

  it("POST /api/auth/login returns 429 on the 6th attempt within window", async () => {
    await clearRateKeys("rl:auth:login");
    const body = { email: "rl-login@example.com", password: "wrong-password" };
    for (let i = 0; i < 5; i += 1) {
      const res = await request(app)
        .post("/api/auth/login")
        .set("X-Forwarded-For", "198.51.100.1")
        .send(body);
      expect([400, 401]).toContain(res.status);
    }
    const sixth = await request(app)
      .post("/api/auth/login")
      .set("X-Forwarded-For", "198.51.100.1")
      .send(body);
    expect(sixth.status).toBe(429);
    expect(sixth.headers["retry-after"]).toBeDefined();
    expect(sixth.body).toMatchObject({ error: "rate_limited" });
  });

  it("POST /api/auth/register returns 429 on the 4th attempt within window", async () => {
    await clearRateKeys("rl:auth:register");
    for (let i = 0; i < 3; i += 1) {
      const res = await request(app)
        .post("/api/auth/register")
        .set("X-Forwarded-For", "198.51.100.2")
        .send({ email: `x${i.toString()}@example.com`, password: "short" });
      // Zod rejects short passwords with 400; the limiter still decrements.
      expect(res.status).not.toBe(429);
    }
    const fourth = await request(app)
      .post("/api/auth/register")
      .set("X-Forwarded-For", "198.51.100.2")
      .send({ email: "x4@example.com", password: "short" });
    expect(fourth.status).toBe(429);
    expect(fourth.body).toMatchObject({ error: "rate_limited" });
  });

  it("successful /api/auth/login sets wpa_refresh with HttpOnly + SameSite=Strict", async () => {
    await clearRateKeys("rl:auth:login");
    await seedUser(db.prisma, {
      email: "cookie-check@example.com",
      role: "user",
      password: "correct-horse-battery-staple",
    });
    const res = await request(app)
      .post("/api/auth/login")
      .set("X-Forwarded-For", "198.51.100.3")
      .send({ email: "cookie-check@example.com", password: "correct-horse-battery-staple" });
    expect(res.status).toBe(200);
    const setCookieRaw = res.headers["set-cookie"] as string | string[] | undefined;
    expect(setCookieRaw).toBeDefined();
    const cookies: string[] = Array.isArray(setCookieRaw) ? setCookieRaw : [setCookieRaw ?? ""];
    const refresh = cookies.find((c) => c.startsWith("wpa_refresh="));
    expect(refresh).toBeDefined();
    const refreshLower = (refresh ?? "").toLowerCase();
    expect(refreshLower).toContain("httponly");
    expect(refreshLower).toContain("samesite=strict");
    expect(refreshLower).toContain("path=/api/auth");
  });
});
