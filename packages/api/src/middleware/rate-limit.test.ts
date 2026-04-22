import { makeTestRedis, type TestRedis } from "@wpa/test-utils";
import express, { type ErrorRequestHandler, type NextFunction, type Request } from "express";
import { Redis } from "ioredis";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type AuthedResponse } from "./auth.js";
import { createRateLimiter } from "./rate-limit.js";

describe("createRateLimiter", () => {
  let redis: TestRedis;

  beforeAll(async () => {
    redis = await makeTestRedis();
  }, 120_000);

  afterAll(async () => {
    await redis.teardown();
  }, 30_000);

  function makeApp(mw: express.RequestHandler): express.Express {
    const app = express();
    app.set("trust proxy", true);
    // Inject res.locals.user from a query param so tests can drive keyBy:"user".
    app.use((req, res: AuthedResponse, next) => {
      const sub = req.header("x-test-user");
      if (sub) res.locals.user = { sub, role: "user", exp: 0 };
      next();
    });
    app.post("/probe", mw, (_req, res) => {
      res.json({ ok: true });
    });
    app.use(((err: Error, _req, res, _next) => {
      res.status(500).json({ error: "internal_error", message: err.message });
    }) as ErrorRequestHandler);
    return app;
  }

  it("rejects the 6th request inside the window with 429 + Retry-After", async () => {
    const mw = createRateLimiter({
      redis: redis.client,
      keyPrefix: "rl:test:burst",
      points: 5,
      duration: 60,
      keyBy: "ip",
    });
    const app = makeApp(mw);

    for (let i = 0; i < 5; i += 1) {
      const res = await request(app).post("/probe").set("X-Forwarded-For", "10.0.0.1");
      expect(res.status).toBe(200);
    }

    const sixth = await request(app).post("/probe").set("X-Forwarded-For", "10.0.0.1");
    expect(sixth.status).toBe(429);
    expect(sixth.headers["retry-after"]).toBeDefined();
    const retryAfter = Number(sixth.headers["retry-after"]);
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    const body = sixth.body as { error: string; retryAfterSeconds: number };
    expect(body.error).toBe("rate_limited");
    expect(typeof body.retryAfterSeconds).toBe("number");
    expect(body.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it("isolates buckets per IP (different IPs don't share state)", async () => {
    const mw = createRateLimiter({
      redis: redis.client,
      keyPrefix: "rl:test:per-ip",
      points: 2,
      duration: 60,
      keyBy: "ip",
    });
    const app = makeApp(mw);

    // Exhaust IP A (2 requests).
    for (let i = 0; i < 2; i += 1) {
      const r = await request(app).post("/probe").set("X-Forwarded-For", "10.1.0.1");
      expect(r.status).toBe(200);
    }
    const blocked = await request(app).post("/probe").set("X-Forwarded-For", "10.1.0.1");
    expect(blocked.status).toBe(429);

    // IP B should still have a fresh bucket.
    const otherIp = await request(app).post("/probe").set("X-Forwarded-For", "10.1.0.2");
    expect(otherIp.status).toBe(200);
  });

  it("keyBy:'user' uses res.locals.user.sub when present", async () => {
    const mw = createRateLimiter({
      redis: redis.client,
      keyPrefix: "rl:test:per-user",
      points: 2,
      duration: 60,
      keyBy: "user",
    });
    const app = makeApp(mw);

    // Two different IPs but same user — user bucket should exhaust.
    const r1 = await request(app)
      .post("/probe")
      .set("X-Forwarded-For", "10.2.0.1")
      .set("x-test-user", "user-a");
    const r2 = await request(app)
      .post("/probe")
      .set("X-Forwarded-For", "10.2.0.2")
      .set("x-test-user", "user-a");
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);

    const r3 = await request(app)
      .post("/probe")
      .set("X-Forwarded-For", "10.2.0.3")
      .set("x-test-user", "user-a");
    expect(r3.status).toBe(429);

    // Different user — fresh bucket.
    const other = await request(app)
      .post("/probe")
      .set("X-Forwarded-For", "10.2.0.3")
      .set("x-test-user", "user-b");
    expect(other.status).toBe(200);
  });

  it("keyBy:'user' falls back to IP when unauthenticated", async () => {
    const mw = createRateLimiter({
      redis: redis.client,
      keyPrefix: "rl:test:user-fallback",
      points: 2,
      duration: 60,
      keyBy: "user",
    });
    const app = makeApp(mw);

    // No x-test-user header — should key by IP instead.
    for (let i = 0; i < 2; i += 1) {
      const r = await request(app).post("/probe").set("X-Forwarded-For", "10.3.0.1");
      expect(r.status).toBe(200);
    }
    const blocked = await request(app).post("/probe").set("X-Forwarded-For", "10.3.0.1");
    expect(blocked.status).toBe(429);

    // Different IP, still no user — own bucket.
    const other = await request(app).post("/probe").set("X-Forwarded-For", "10.3.0.2");
    expect(other.status).toBe(200);
  });

  it("keyBy:'ip+user' combines both signals", async () => {
    const mw = createRateLimiter({
      redis: redis.client,
      keyPrefix: "rl:test:ip-user",
      points: 1,
      duration: 60,
      keyBy: "ip+user",
    });
    const app = makeApp(mw);

    const ok = await request(app)
      .post("/probe")
      .set("X-Forwarded-For", "10.4.0.1")
      .set("x-test-user", "user-a");
    expect(ok.status).toBe(200);

    // Same IP+user — blocked.
    const blocked = await request(app)
      .post("/probe")
      .set("X-Forwarded-For", "10.4.0.1")
      .set("x-test-user", "user-a");
    expect(blocked.status).toBe(429);

    // Same IP, different user — fresh bucket.
    const diffUser = await request(app)
      .post("/probe")
      .set("X-Forwarded-For", "10.4.0.1")
      .set("x-test-user", "user-b");
    expect(diffUser.status).toBe(200);

    // Different IP, same user — fresh bucket.
    const diffIp = await request(app)
      .post("/probe")
      .set("X-Forwarded-For", "10.4.0.2")
      .set("x-test-user", "user-a");
    expect(diffIp.status).toBe(200);
  });

  it("propagates Redis errors via next(err) — does not fail open", async () => {
    // Point the limiter at a disconnected Redis client to simulate storage failure.
    const brokenRedis = new Redis("redis://127.0.0.1:1", {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 200,
      enableOfflineQueue: false,
      retryStrategy: () => null,
    });

    const mw = createRateLimiter({
      redis: brokenRedis,
      keyPrefix: "rl:test:redis-err",
      points: 5,
      duration: 60,
      keyBy: "ip",
    });

    const errors: unknown[] = [];
    const app = express();
    app.set("trust proxy", true);
    app.post(
      "/probe",
      mw,
      // If mw calls next(err), this handler captures it via the error handler below.
      (_req, res) => {
        res.json({ ok: true });
      },
    );
    app.use(((err: Error, _req: Request, res, _next: NextFunction) => {
      errors.push(err);
      res.status(500).json({ error: "internal_error" });
    }) as ErrorRequestHandler);

    const res = await request(app).post("/probe").set("X-Forwarded-For", "10.5.0.1");
    expect(res.status).toBe(500);
    expect(errors.length).toBe(1);

    brokenRedis.disconnect();
  });
});
