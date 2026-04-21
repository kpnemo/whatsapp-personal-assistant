import type { Express } from "express";
import request from "supertest";
import type TestAgent from "supertest/lib/agent.js";

import { TEST_JWT_SECRET, issueAccessToken } from "./fixtures.js";

/** Matches the REFRESH_COOKIE name in @wpa/api's auth router. */
const REFRESH_COOKIE = "wpa_refresh";

export interface WithAuthOptions {
  user: { id: string; role: "admin" | "user" };
  /** Override the JWT signing secret. Defaults to TEST_JWT_SECRET. */
  jwtSecret?: string;
  /** Plaintext refresh token to set as the wpa_refresh cookie. Omit to skip. */
  refreshToken?: string;
}

/**
 * Build a supertest agent pre-authenticated as the given user.
 *
 * Returns a Promise because issueAccessToken is async (jose HS256 sign).
 * Await the promise, then use the agent normally:
 *
 *   const agent = await withAuth(app, { user: { id: "u1", role: "admin" } });
 *   const res = await agent.get("/api/auth/me");
 *
 * The returned agent has:
 *   - Authorization: Bearer <access-token>
 *   - Cookie: wpa_refresh=<refreshToken>  (only if refreshToken provided)
 */
export async function withAuth(app: Express, opts: WithAuthOptions): Promise<TestAgent> {
  const secret = opts.jwtSecret ?? TEST_JWT_SECRET;
  const token = await issueAccessToken(secret, { sub: opts.user.id, role: opts.user.role });

  const agent = request.agent(app);
  agent.set("Authorization", `Bearer ${token}`);
  if (opts.refreshToken !== undefined) {
    agent.set("Cookie", `${REFRESH_COOKIE}=${opts.refreshToken}`);
  }
  return agent;
}
