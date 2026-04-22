import type { NextFunction, Request, Response } from "express";

import { logger } from "../logger.js";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export interface OriginGuardOpts {
  /** Allowed origins — usually `env.PUBLIC_ORIGIN` plus dev overrides. */
  allowedOrigins: readonly string[];
}

/**
 * Defence-in-depth against CSRF for cookie-bearing endpoints.
 *
 * SameSite=Strict on the refresh cookie is the primary mitigation; this guard
 * additionally rejects unsafe-method requests whose Origin header is missing
 * or not in the allow-list. GETs are skipped (they should be idempotent and
 * must not mutate state).
 *
 * Requests without an Origin header (e.g. server-to-server curl, same-origin
 * form submit in some legacy browsers) are allowed through — SameSite handles
 * the browser-cross-site case.
 */
export function originGuard(opts: OriginGuardOpts) {
  const allowed = new Set(opts.allowedOrigins);
  return function originGuardMiddleware(req: Request, res: Response, next: NextFunction): void {
    if (!UNSAFE_METHODS.has(req.method)) {
      next();
      return;
    }
    const origin = req.get("origin");
    if (origin === undefined) {
      next();
      return;
    }
    if (allowed.has(origin)) {
      next();
      return;
    }
    logger.warn({ origin, method: req.method, path: req.path }, "origin rejected");
    res.status(403).json({ error: "forbidden_origin" });
  };
}
