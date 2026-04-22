import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { Redis } from "ioredis";
import { RateLimiterRedis, RateLimiterRes } from "rate-limiter-flexible";

import { logger } from "../logger.js";

export type RateLimitKeyBy = "ip" | "user" | "ip+user";

export interface RateLimitOpts {
  /** ioredis client shared across limiters; we use a single Redis connection per process. */
  redis: Redis;
  /** Used to namespace Redis keys; must be unique per limiter (e.g. "rl:auth:login"). */
  keyPrefix: string;
  /** Max requests permitted per duration window. */
  points: number;
  /** Length of the sliding window, in seconds. */
  duration: number;
  /** How the rate-limit bucket key is derived from the request. */
  keyBy: RateLimitKeyBy;
  /**
   * After points are exhausted, block subsequent attempts for this many seconds.
   * Defaults to `duration` (i.e. wait out the window before trying again).
   */
  blockDuration?: number;
}

interface AuthLocalsLike {
  user?: { sub?: string };
}

function resolveKey(req: Request, res: Response, keyBy: RateLimitKeyBy): string {
  const locals = res.locals as AuthLocalsLike;
  const sub = locals.user?.sub;
  const ip = req.ip ?? "unknown";
  switch (keyBy) {
    case "ip":
      return ip;
    case "user":
      return sub ?? ip;
    case "ip+user":
      return `${ip}|${sub ?? "anon"}`;
  }
}

/**
 * Create an Express middleware that enforces a Redis-backed rate limit.
 *
 * Semantics:
 *  - On success: resolves, calls next().
 *  - On rate-limit hit: responds 429 with Retry-After header and a stable body
 *    `{ error: "rate_limited", retryAfterSeconds }`. Logs at warn level.
 *  - On Redis/storage error: propagates via next(err) so the global error handler
 *    surfaces a 500. Deliberately neither fail-open (security risk) nor
 *    fail-closed (availability risk — up to the caller via error-handler policy).
 */
export function createRateLimiter(opts: RateLimitOpts): RequestHandler {
  const limiter = new RateLimiterRedis({
    storeClient: opts.redis,
    keyPrefix: opts.keyPrefix,
    points: opts.points,
    duration: opts.duration,
    blockDuration: opts.blockDuration ?? opts.duration,
  });

  return function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
    const key = resolveKey(req, res, opts.keyBy);
    limiter
      .consume(key)
      .then(() => {
        next();
      })
      .catch((err: unknown) => {
        if (err instanceof RateLimiterRes) {
          const retryAfterSeconds = Math.max(1, Math.ceil(err.msBeforeNext / 1000));
          logger.warn({ keyPrefix: opts.keyPrefix, key, retryAfterSeconds }, "rate limit exceeded");
          res.setHeader("Retry-After", String(retryAfterSeconds));
          res.status(429).json({ error: "rate_limited", retryAfterSeconds });
          return;
        }
        // Storage/Redis error — propagate so the global error handler can decide.
        next(err instanceof Error ? err : new Error(String(err)));
      });
  };
}
