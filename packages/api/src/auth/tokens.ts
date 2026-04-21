import { createHash, randomBytes } from "node:crypto";

import { SignJWT, jwtVerify } from "jose";

import { env } from "../env.js";

const ACCESS_TTL_SECONDS = 60 * 15;

const jwtSecret = new TextEncoder().encode(env.JWT_SECRET);

export interface AccessClaims {
  sub: string;
  role: "admin" | "user";
}

export async function issueAccessToken(claims: AccessClaims): Promise<string> {
  return new SignJWT({ role: claims.role })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TTL_SECONDS.toString()}s`)
    .setIssuer("wpa")
    .setAudience("wpa-web")
    .sign(jwtSecret);
}

export async function verifyAccessToken(token: string): Promise<AccessClaims & { exp: number }> {
  const { payload } = await jwtVerify(token, jwtSecret, { issuer: "wpa", audience: "wpa-web" });
  if (typeof payload.sub !== "string" || (payload.role !== "admin" && payload.role !== "user")) {
    throw new Error("invalid claims");
  }
  return { sub: payload.sub, role: payload.role, exp: payload.exp ?? 0 };
}

/**
 * Signature-verified but expiry-tolerant decode. Use ONLY for best-effort audit
 * attribution (e.g. /auth/logout) where we still want to record the event even if
 * the access token is past its 15-minute window. Never use for authorization.
 */
export async function verifyAccessTokenForAudit(token: string): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, jwtSecret, {
      issuer: "wpa",
      audience: "wpa-web",
      clockTolerance: 60 * 60 * 24 * 365,
    });
    if (typeof payload.sub !== "string" || (payload.role !== "admin" && payload.role !== "user")) {
      return null;
    }
    return { sub: payload.sub, role: payload.role };
  } catch {
    return null;
  }
}

export function issueRefreshToken(): { token: string; tokenHash: string } {
  const token = randomBytes(48).toString("base64url");
  return { token, tokenHash: hashRefreshToken(token) };
}

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export const ACCESS_TTL = ACCESS_TTL_SECONDS;
export const REFRESH_TTL_DAYS = 7;
