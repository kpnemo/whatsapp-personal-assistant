import type { NextFunction, Request, Response } from "express";

import { type AccessClaims, verifyAccessToken } from "../auth/tokens.js";

export interface AuthLocals {
  user?: AccessClaims & { exp: number };
}

export type AuthedResponse = Response<unknown, AuthLocals>;

export async function requireAuth(
  req: Request,
  res: AuthedResponse,
  next: NextFunction,
): Promise<void> {
  const header = req.header("authorization");
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  try {
    const claims = await verifyAccessToken(header.slice("Bearer ".length));
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
