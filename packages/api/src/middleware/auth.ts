import type { NextFunction, Request, Response } from "express";

import { type AccessClaims, verifyAccessToken } from "../auth/tokens.js";

export interface AuthLocals {
  user?: AccessClaims & { exp: number };
}

export type AuthedResponse = Response<unknown, AuthLocals>;

/**
 * Extract the access token from a request. Primary source is the
 * `Authorization: Bearer <jwt>` header. Fallback for browser contexts
 * that can't set custom headers (SSE `EventSource`, `<img>`, `<video>`,
 * `<audio>` src attributes): `?token=<jwt>` query param. The query
 * fallback is safe because the token is already considered a bearer
 * credential; it is only passed over TLS in production and the app
 * runs on a single origin (CSRF + SameSite=Strict refresh cookie
 * already close the auth-cookie vector).
 */
function extractAccessToken(req: Request): string | null {
  const header = req.header("authorization");
  if (header?.startsWith("Bearer ")) return header.slice("Bearer ".length);
  const queryToken = req.query.token;
  if (typeof queryToken === "string" && queryToken.length > 0) return queryToken;
  return null;
}

export async function requireAuth(
  req: Request,
  res: AuthedResponse,
  next: NextFunction,
): Promise<void> {
  const token = extractAccessToken(req);
  if (!token) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  try {
    const claims = await verifyAccessToken(token);
    res.locals.user = claims;
    next();
  } catch {
    res.status(401).json({ error: "unauthorized" });
  }
}

export function requireAdmin(_req: Request, res: AuthedResponse, next: NextFunction): void {
  if (res.locals.user?.role !== "admin") {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  next();
}
