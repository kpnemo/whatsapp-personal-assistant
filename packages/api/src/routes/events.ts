/**
 * MVP SSE route.
 *
 * Known trade-offs accepted for P1-B MVP:
 * 1. setHeartbeatMs module-level mutation: safe because vitest runs each
 *    test file in an isolated worker. If parallel test threads are ever
 *    enabled, refactor to accept heartbeatMs via eventsRouter({heartbeatMs}).
 * 2. DECR-after-cleanup race: under sustained churn the counter can drift
 *    slightly — e.g. 4 concurrent streams when cap is 3 if disconnects
 *    race new connects. Acceptable for a personal tool; full atomicity
 *    would require a Lua EVAL script.
 */

import type { Request } from "express";
import { Router } from "express";
import type { Redis } from "ioredis";

import { env } from "../env.js";
import { logger } from "../logger.js";
import { requireAuth, type AuthedResponse } from "../middleware/auth.js";
import { createRateLimiter } from "../middleware/rate-limit.js";
import { getRedis, createSubscriberClient } from "../redis.js";

/**
 * Heartbeat interval in milliseconds.  Exported so tests can override it via
 * dependency injection rather than waiting 30 s in CI.
 */
export let HEARTBEAT_MS = 30_000;

/** Allow tests to override the heartbeat interval before the route module is used. */
export function setHeartbeatMs(ms: number): void {
  HEARTBEAT_MS = ms;
}

const SSE_COUNTER_PREFIX = "wpa:sse:count:";
/** Counter TTL — belt-and-braces against crashed clients that never fire "close". */
const COUNTER_TTL_SECONDS = 65 * 60; // 65 min

export function eventsRouter(): Router {
  const r = Router();

  const connectLimiter = createRateLimiter({
    redis: getRedis(),
    keyPrefix: "rl:events:connect",
    points: 10,
    duration: 60,
    keyBy: "user",
  });

  r.get("/events", requireAuth, connectLimiter, async (req: Request, res: AuthedResponse) => {
    const userId = res.locals.user!.sub;
    const redis = getRedis();
    const counterKey = `${SSE_COUNTER_PREFIX}${userId}`;

    // --- Concurrent stream cap ---
    // Pipeline INCR + EXPIRE in a single round-trip to minimise the window
    // where a crash could leave a TTL-less key.  Not fully atomic (that would
    // require a Lua EVAL), but the crash window is reduced to microseconds —
    // acceptable for MVP.
    const [incr, _expire] = (await redis
      .pipeline()
      .incr(counterKey)
      .expire(counterKey, COUNTER_TTL_SECONDS)
      .exec()) as [[Error | null, number], [Error | null, number]];
    if (incr[0]) throw incr[0];
    const count = incr[1];

    const maxStreams = env.SSE_MAX_STREAMS_PER_USER;
    if (count > maxStreams) {
      await redis.decr(counterKey);
      res.status(429).json({ error: "too_many_streams" });
      return;
    }

    // --- Register cleanup BEFORE flushHeaders ---
    // This guarantees the counter is decremented even if the client
    // disconnects during header flush or before the subscriber is ready.
    // Subscriber and heartbeat may not exist yet; the cleanup function checks
    // for null before touching them.
    let subscriber: Redis | null = null;
    let heartbeat: NodeJS.Timeout | null = null;
    let cleanedUp = false;
    const channel = `ui:events:${userId}`;

    const cleanup = async () => {
      if (cleanedUp) return;
      cleanedUp = true;
      if (heartbeat) clearInterval(heartbeat);
      if (subscriber) {
        try {
          await subscriber.unsubscribe(channel);
          await subscriber.quit();
        } catch {
          try {
            subscriber.disconnect();
          } catch {
            /* ignore */
          }
        }
      }
      try {
        await redis.decr(counterKey);
      } catch {
        /* best effort */
      }
      try {
        res.end();
      } catch {
        /* ignore */
      }
    };

    req.on("close", () => {
      void cleanup();
    });

    // --- SSE headers ---
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("X-Accel-Buffering", "no");
    // Keep the connection open and flush headers immediately so the client
    // sees a 200 before any data arrives.
    res.flushHeaders();

    // --- Per-request subscriber client ---
    // ioredis connections that have entered subscribe mode cannot issue regular
    // commands, so we allocate a fresh client per SSE stream.  Each client is
    // fully cleaned up in the cleanup handler above.
    subscriber = createSubscriberClient();

    void subscriber.subscribe(channel, (err) => {
      if (err) {
        logger.error({ err, userId }, "SSE subscriber failed to subscribe");
      }
    });

    subscriber.on("message", (ch: string, payload: string) => {
      if (ch !== channel) return;
      // Split payload on newlines and emit one `data:` line per segment so
      // that the browser EventSource reconstructs the original string.
      // A naive `data: ${payload}\n\n` would break if payload contains \n
      // (EventSource would see two fields and silently mangle the message).
      const lines = payload
        .split("\n")
        .map((l) => `data: ${l}`)
        .join("\n");
      res.write(`${lines}\n\n`);
    });

    // --- Heartbeat ---
    heartbeat = setInterval(() => {
      res.write(":heartbeat\n\n");
    }, HEARTBEAT_MS);
  });

  return r;
}
