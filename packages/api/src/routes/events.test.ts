import http from "node:http";

import {
  TEST_JWT_SECRET,
  issueAccessToken,
  makeTestDb,
  makeTestRedis,
  seedUser,
  type TestDb,
  type TestRedis,
} from "@wpa/test-utils";
import type { Express } from "express";
import { Redis } from "ioredis";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// ── Bootstrap ─────────────────────────────────────────────────────────────────

/**
 * Heartbeat is overridden to 200 ms before the events module is imported so
 * heartbeat tests don't need to wait 30 s.
 */
const TEST_HEARTBEAT_MS = 200;

async function bootstrap(): Promise<{ app: Express; db: TestDb; redis: TestRedis }> {
  const db = await makeTestDb();
  const redis = await makeTestRedis();
  process.env.DATABASE_URL = db.url;
  process.env.REDIS_URL = redis.url;

  // Patch heartbeat interval before the route module is loaded.
  const eventsModule = await import("./events.js");
  eventsModule.setHeartbeatMs(TEST_HEARTBEAT_MS);

  const { createApp } = await import("../app.js");
  return { app: createApp(), db, redis };
}

// ── SSE helper ────────────────────────────────────────────────────────────────

/**
 * Open a raw HTTP connection to the SSE endpoint, collect chunks for
 * `durationMs` milliseconds, then destroy the socket and return the raw body.
 */
function listenSse(
  server: http.Server,
  path: string,
  authHeader: string,
  durationMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    let raw = "";
    let settled = false;

    const req = http.request(
      {
        host: "127.0.0.1",
        port: addr.port,
        path,
        method: "GET",
        headers: { Accept: "text/event-stream", Authorization: authHeader },
      },
      (res) => {
        res.on("data", (chunk: Buffer) => {
          raw += chunk.toString();
        });
        res.on("end", () => {
          if (!settled) {
            settled = true;
            resolve(raw);
          }
        });
        res.on("error", (err) => {
          if (!settled) {
            settled = true;
            reject(err);
          }
        });
      },
    );
    req.on("error", (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
    req.end();

    setTimeout(() => {
      if (!settled) {
        settled = true;
        req.destroy();
        resolve(raw);
      }
    }, durationMs);
  });
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe("GET /api/events — SSE stream", () => {
  let app: Express;
  let db: TestDb;
  let redis: TestRedis;
  let server: http.Server;

  beforeAll(async () => {
    const b = await bootstrap();
    app = b.app;
    db = b.db;
    redis = b.redis;

    // Bind to a free port so the raw http helper can connect by address.
    server = http.createServer(app);
    await new Promise<void>((res) => server.listen(0, "127.0.0.1", res));
  }, 180_000);

  afterAll(async () => {
    await new Promise<void>((res) => server.close(() => res()));
    const { disconnectPrisma } = await import("@wpa/db");
    const { disconnectRedis } = await import("../redis.js");
    await disconnectPrisma();
    await disconnectRedis();
    if (db) await db.teardown();
    if (redis) await redis.teardown();
  }, 60_000);

  // 1. 401 without auth ───────────────────────────────────────────────────────
  it("returns 401 when no auth header is supplied", async () => {
    const res = await request(app).get("/api/events");
    expect(res.status).toBe(401);
  });

  // 2. 429 on concurrent stream cap ──────────────────────────────────────────
  it("returns 429 and decrements counter when concurrent cap is exceeded", async () => {
    const user = await seedUser(db.prisma, {
      email: "sse-cap@example.com",
      role: "user",
      password: "correct-horse-battery-staple",
    });

    // Pre-seed the counter to the default cap (3) to simulate 3 existing open
    // streams.  The env constant is already parsed at startup so we cannot
    // override it via process.env in this test; instead we simply saturate the
    // counter at its known default value.
    const cap = 3;
    const counterKey = `wpa:sse:count:${user.id}`;
    await redis.client.set(counterKey, String(cap));

    const token = await issueAccessToken(TEST_JWT_SECRET, { sub: user.id, role: "user" });

    // Use raw http so the connection closes as soon as the 429 response ends
    // (unlike SSE 200 streams which stay open indefinitely).
    // A 5 s safety timeout guards against hung connections.
    const result = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const addr = server.address() as { port: number };
      let statusCode = 0;
      let body = "";
      let settled = false;

      const settle = (val: { status: number; body: string }) => {
        if (!settled) {
          settled = true;
          resolve(val);
        }
      };

      const bail = (err: Error) => {
        if (!settled) {
          settled = true;
          reject(err);
        }
      };

      const safety = setTimeout(() => {
        req.destroy();
        settle({ status: statusCode, body });
      }, 5_000);

      const req = http.request(
        {
          host: "127.0.0.1",
          port: addr.port,
          path: "/api/events",
          method: "GET",
          headers: { Accept: "text/event-stream", Authorization: `Bearer ${token}` },
        },
        (res) => {
          statusCode = res.statusCode ?? 0;
          res.on("data", (chunk: Buffer) => {
            body += chunk.toString();
          });
          res.on("end", () => {
            clearTimeout(safety);
            settle({ status: statusCode, body });
          });
          res.on("error", bail);
        },
      );
      req.on("error", (err) => {
        clearTimeout(safety);
        bail(err);
      });
      req.end();
    });

    // Counter must have been decremented back to cap after the 429.
    const counterAfter = await redis.client.get(counterKey);
    await redis.client.del(counterKey);

    expect(result.status).toBe(429);
    expect(JSON.parse(result.body)).toMatchObject({ error: "too_many_streams" });
    expect(Number(counterAfter)).toBe(cap);
  });

  // 3. Published event arrives as data: line ─────────────────────────────────
  it("forwards a Redis pub/sub payload as an SSE data: line within 2 s", async () => {
    const user = await seedUser(db.prisma, {
      email: "sse-event@example.com",
      role: "user",
      password: "correct-horse-battery-staple",
    });

    // Issue the access token directly so we can pass it to the raw http helper.
    const token = await issueAccessToken(TEST_JWT_SECRET, { sub: user.id, role: "user" });

    // Start listening before publishing so subscription is active.
    const collectPromise = listenSse(server, "/api/events", `Bearer ${token}`, 2000);

    // Allow the SSE subscription to be established.
    await new Promise((r) => setTimeout(r, 300));

    const payload = JSON.stringify({
      type: "message.created",
      conversationId: "conv-1",
      messageId: "msg-1",
      timestamp: Date.now(),
    });

    const publisher = new Redis(redis.url);
    await publisher.publish(`ui:events:${user.id}`, payload);
    await publisher.quit();

    const raw = await collectPromise;
    expect(raw).toContain(`data: ${payload}\n\n`);
  });

  // 3b. Multi-line payload is framed correctly ───────────────────────────────
  it("reconstructs a payload containing a literal \\n via multiple data: lines", async () => {
    const user = await seedUser(db.prisma, {
      email: "sse-multiline@example.com",
      role: "user",
      password: "correct-horse-battery-staple",
    });

    const token = await issueAccessToken(TEST_JWT_SECRET, { sub: user.id, role: "user" });

    const collectPromise = listenSse(server, "/api/events", `Bearer ${token}`, 2000);

    // Allow the SSE subscription to be established.
    await new Promise((r) => setTimeout(r, 300));

    const payload = JSON.stringify({ type: "message.created", text: "line1\nline2" });
    // payload contains a literal \n inside the JSON string value

    const publisher = new Redis(redis.url);
    await publisher.publish(`ui:events:${user.id}`, payload);
    await publisher.quit();

    const raw = await collectPromise;

    // The SSE frame should contain two `data:` lines followed by the blank line.
    // Split the raw SSE body into individual event blocks (separated by \n\n).
    const events = raw.split("\n\n").filter(Boolean);
    // Find the event block that contains our type field.
    const eventBlock = events.find((e) => e.includes("message.created"));
    expect(eventBlock).toBeDefined();

    // Re-join the data: lines to recover the original payload.
    const lines = eventBlock!
      .split("\n")
      .filter((l) => l.startsWith("data: "))
      .map((l) => l.slice("data: ".length));
    const reconstructed = lines.join("\n");
    expect(reconstructed).toBe(payload);
  });

  // 4. Heartbeat comment arrives on interval ─────────────────────────────────
  it("emits :heartbeat comment lines at HEARTBEAT_MS interval", async () => {
    const user = await seedUser(db.prisma, {
      email: "sse-heartbeat@example.com",
      role: "user",
      password: "correct-horse-battery-staple",
    });

    const token = await issueAccessToken(TEST_JWT_SECRET, { sub: user.id, role: "user" });

    // Listen for 3× the interval so we expect at least 2 heartbeats.
    const raw = await listenSse(
      server,
      "/api/events",
      `Bearer ${token}`,
      TEST_HEARTBEAT_MS * 3 + 100,
    );

    const heartbeatCount = (raw.match(/:heartbeat\n\n/g) ?? []).length;
    expect(heartbeatCount).toBeGreaterThanOrEqual(1);
  });

  // 5. Clean shutdown — counter DECRs on disconnect ──────────────────────────
  it("decrements the SSE counter when the client disconnects", async () => {
    const user = await seedUser(db.prisma, {
      email: "sse-cleanup@example.com",
      role: "user",
      password: "correct-horse-battery-staple",
    });

    const counterKey = `wpa:sse:count:${user.id}`;
    const token = await issueAccessToken(TEST_JWT_SECRET, { sub: user.id, role: "user" });

    // Open the stream for a short window then let listenSse destroy the socket.
    await listenSse(server, "/api/events", `Bearer ${token}`, 400);

    // Allow the cleanup coroutine (req.on("close") handler) time to finish.
    await new Promise((r) => setTimeout(r, 400));

    const counter = await redis.client.get(counterKey);
    // After disconnect, counter should be 0 (or key absent — del'd by DECR to 0).
    expect(Number(counter ?? "0")).toBe(0);
  });

  // 5b. Rate-limit on connect attempts ─────────────────────────────────────
  it("returns 429 after exceeding 10 connect attempts per minute on GET /api/events", async () => {
    const user = await seedUser(db.prisma, {
      email: "sse-ratelimit@example.com",
      role: "user",
      password: "correct-horse-battery-staple",
    });

    const token = await issueAccessToken(TEST_JWT_SECRET, { sub: user.id, role: "user" });
    const authHeader = `Bearer ${token}`;

    // Open 10 SSE streams quickly (each consumes 1 point). Each is destroyed
    // after 50 ms so they don't pile up as live connections.
    for (let i = 0; i < 10; i++) {
      await listenSse(server, "/api/events", authHeader, 50);
    }

    // 11th connection attempt must be rate-limited.
    // The 429 response is a non-streaming JSON reply, so listenSse resolves
    // immediately when the server closes the response after sending the JSON body.
    const over = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const addr = server.address() as { port: number };
      let statusCode = 0;
      let body = "";
      let settled = false;

      const settle = (val: { status: number; body: string }) => {
        if (!settled) {
          settled = true;
          resolve(val);
        }
      };
      const bail = (err: Error) => {
        if (!settled) {
          settled = true;
          reject(err);
        }
      };

      const safety = setTimeout(() => {
        req.destroy();
        settle({ status: statusCode, body });
      }, 5_000);

      const req = http.request(
        {
          host: "127.0.0.1",
          port: addr.port,
          path: "/api/events",
          method: "GET",
          headers: { Accept: "text/event-stream", Authorization: authHeader },
        },
        (res) => {
          statusCode = res.statusCode ?? 0;
          res.on("data", (chunk: Buffer) => {
            body += chunk.toString();
          });
          res.on("end", () => {
            clearTimeout(safety);
            settle({ status: statusCode, body });
          });
          res.on("error", bail);
        },
      );
      req.on("error", (err) => {
        clearTimeout(safety);
        bail(err);
      });
      req.end();
    });

    expect(over.status).toBe(429);
    const parsed = JSON.parse(over.body) as { error: string };
    expect(parsed.error).toBe("rate_limited");
  });

  // 6. Cross-user isolation ──────────────────────────────────────────────────
  it("does not deliver events published on another user's channel", async () => {
    const userA = await seedUser(db.prisma, {
      email: "sse-iso-a@example.com",
      role: "user",
      password: "correct-horse-battery-staple",
    });
    const userB = await seedUser(db.prisma, {
      email: "sse-iso-b@example.com",
      role: "user",
      password: "correct-horse-battery-staple",
    });

    const tokenA = await issueAccessToken(TEST_JWT_SECRET, { sub: userA.id, role: "user" });

    const collectPromise = listenSse(server, "/api/events", `Bearer ${tokenA}`, 1500);

    // Allow user A's stream to subscribe before publishing.
    await new Promise((r) => setTimeout(r, 300));

    // Publish to user B's channel — must NOT appear on user A's stream.
    const payloadB = JSON.stringify({ type: "message.created", conversationId: "conv-b" });
    const publisher = new Redis(redis.url);
    await publisher.publish(`ui:events:${userB.id}`, payloadB);
    await publisher.quit();

    const raw = await collectPromise;
    expect(raw).not.toContain(`data: ${payloadB}\n\n`);
  });
});
