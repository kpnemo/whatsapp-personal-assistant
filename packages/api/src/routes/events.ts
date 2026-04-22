import type { Request } from "express";
import { Router } from "express";

import { env } from "../env.js";
import { logger } from "../logger.js";
import { requireAuth, type AuthedResponse } from "../middleware/auth.js";
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

  r.get("/events", requireAuth, async (req: Request, res: AuthedResponse) => {
    const userId = res.locals.user!.sub;
    const redis = getRedis();
    const counterKey = `${SSE_COUNTER_PREFIX}${userId}`;

    // --- Concurrent stream cap ---
    const count = await redis.incr(counterKey);
    // Always refresh the TTL on every new connection so the window slides.
    await redis.expire(counterKey, COUNTER_TTL_SECONDS);

    const maxStreams = env.SSE_MAX_STREAMS_PER_USER;
    if (count > maxStreams) {
      await redis.decr(counterKey);
      res.status(429).json({ error: "too_many_streams" });
      return;
    }

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
    // fully cleaned up in the "close" handler below.
    const subscriber = createSubscriberClient();
    const channel = `ui:events:${userId}`;

    void subscriber.subscribe(channel, (err) => {
      if (err) {
        logger.error({ err, userId }, "SSE subscriber failed to subscribe");
      }
    });

    subscriber.on("message", (_chan: string, payload: string) => {
      res.write(`data: ${payload}\n\n`);
    });

    // --- Heartbeat ---
    const heartbeat = setInterval(() => {
      res.write(":heartbeat\n\n");
    }, HEARTBEAT_MS);

    // --- Cleanup on disconnect ---
    const cleanup = async () => {
      clearInterval(heartbeat);
      try {
        await subscriber.unsubscribe(channel);
        await subscriber.quit();
      } catch (err) {
        logger.warn({ err, userId }, "SSE subscriber quit error during cleanup");
        subscriber.disconnect();
      }
      await redis.decr(counterKey);
      res.end();
    };

    req.on("close", () => {
      cleanup().catch((cleanupErr: unknown) => {
        logger.warn({ err: cleanupErr, userId }, "SSE cleanup error");
      });
    });
  });

  return r;
}
