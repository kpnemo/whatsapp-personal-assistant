import argon2 from "argon2";
import { SignJWT, jwtVerify } from "jose";

/**
 * Deterministic 32-byte master key for test encryption / DEK wrapping.
 * All-ones so fixture ciphertext is stable across test runs.
 *
 * NEVER use this value outside tests. It is not a secret.
 */
export const TEST_MASTER_KEY: Buffer = Buffer.alloc(32, 1);

/**
 * Fixed 64-char JWT secret for tests. Mirrors @wpa/shared's env.ts min-length
 * constraint (32+ chars). Tests that want independence from this default can
 * pass their own secret into issueAccessToken / verifyAccessToken.
 *
 * NEVER use this value outside tests.
 */
export const TEST_JWT_SECRET = "a".repeat(64);

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 64 * 1024,
  timeCost: 3,
  parallelism: 4,
} as const;

/**
 * Hash a password with the same argon2id parameters as @wpa/api.
 * Duplicated here (vs. importing from @wpa/api) so test-utils stays below
 * @wpa/api in the dep graph and is usable by any package.
 */
export async function hashPassword(password: string): Promise<string> {
  if (!password) throw new Error("password must not be empty");
  return argon2.hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export interface AccessClaims {
  sub: string;
  role: "admin" | "user";
}

const ACCESS_TTL_SECONDS = 60 * 15;

/**
 * Issue a JWT matching @wpa/api's shape (iss=wpa, aud=wpa-web, HS256, 15min TTL).
 * Takes the secret explicitly so tests can pin it or rotate per-case.
 */
export async function issueAccessToken(secret: string, claims: AccessClaims): Promise<string> {
  const encoded = new TextEncoder().encode(secret);
  return new SignJWT({ role: claims.role })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TTL_SECONDS.toString()}s`)
    .setIssuer("wpa")
    .setAudience("wpa-web")
    .sign(encoded);
}

export async function verifyAccessToken(
  secret: string,
  token: string,
): Promise<AccessClaims & { exp: number }> {
  const encoded = new TextEncoder().encode(secret);
  const { payload } = await jwtVerify(token, encoded, { issuer: "wpa", audience: "wpa-web" });
  if (typeof payload.sub !== "string" || (payload.role !== "admin" && payload.role !== "user")) {
    throw new Error("invalid claims");
  }
  return { sub: payload.sub, role: payload.role, exp: payload.exp ?? 0 };
}
