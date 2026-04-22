import { describe, expect, it } from "vitest";

import {
  REFRESH_COOKIE_NAME,
  REFRESH_COOKIE_PATH,
  hashRefreshToken,
  issueAccessToken,
  issueRefreshToken,
  refreshCookieOptions,
  verifyAccessToken,
  verifyAccessTokenForAudit,
} from "./tokens.js";

describe("access tokens", () => {
  it("round-trips claims", async () => {
    const jwt = await issueAccessToken({ sub: "u1", role: "user" });
    const decoded = await verifyAccessToken(jwt);
    expect(decoded.sub).toBe("u1");
    expect(decoded.role).toBe("user");
  });

  it("rejects tampered tokens", async () => {
    const jwt = await issueAccessToken({ sub: "u1", role: "user" });
    // Flip several trailing signature chars so the tamper can't coincidentally
    // round-trip through base64url's trailing-bit padding. A single-char flip
    // sometimes lands on a codepoint with equivalent decoded bits.
    const tampered = jwt.slice(0, -8) + "AAAAAAAA";
    await expect(verifyAccessToken(tampered)).rejects.toThrow();
  });
});

describe("verifyAccessTokenForAudit (audit-only, expiry-tolerant)", () => {
  it("returns claims for a valid token", async () => {
    const jwt = await issueAccessToken({ sub: "u-audit-1", role: "user" });
    const claims = await verifyAccessTokenForAudit(jwt);
    expect(claims).toEqual({ sub: "u-audit-1", role: "user" });
  });

  it("returns null for a tampered token (signature still verified)", async () => {
    const jwt = await issueAccessToken({ sub: "u-audit-2", role: "user" });
    // 8-char flip — see "rejects tampered tokens" above for rationale.
    const tampered = jwt.slice(0, -8) + "AAAAAAAA";
    await expect(verifyAccessTokenForAudit(tampered)).resolves.toBeNull();
  });

  it("returns null for garbage input", async () => {
    await expect(verifyAccessTokenForAudit("not-a-jwt")).resolves.toBeNull();
    await expect(verifyAccessTokenForAudit("")).resolves.toBeNull();
  });
});

describe("refresh tokens", () => {
  it("produces opaque tokens plus verifiable hashes", () => {
    const { token, tokenHash } = issueRefreshToken();
    expect(token.length).toBeGreaterThan(40);
    expect(hashRefreshToken(token)).toBe(tokenHash);
  });

  it("different calls produce different tokens", () => {
    const a = issueRefreshToken();
    const b = issueRefreshToken();
    expect(a.token).not.toBe(b.token);
  });
});

describe("refresh cookie options", () => {
  it("uses the wpa_refresh name and /api/auth path", () => {
    expect(REFRESH_COOKIE_NAME).toBe("wpa_refresh");
    expect(REFRESH_COOKIE_PATH).toBe("/api/auth");
  });

  it("is HttpOnly + SameSite=Strict (CSRF mitigation)", () => {
    const opts = refreshCookieOptions({ secureRequest: false, nodeEnv: "development" });
    expect(opts.httpOnly).toBe(true);
    expect(opts.sameSite).toBe("strict");
  });

  it("forces Secure in production even when the request isn't TLS-terminated here", () => {
    const opts = refreshCookieOptions({ secureRequest: false, nodeEnv: "production" });
    expect(opts.secure).toBe(true);
  });

  it("allows insecure cookies in development when the request isn't secure", () => {
    const opts = refreshCookieOptions({ secureRequest: false, nodeEnv: "development" });
    expect(opts.secure).toBe(false);
  });

  it("honours req.secure in development (behind a TLS-terminating proxy)", () => {
    const opts = refreshCookieOptions({ secureRequest: true, nodeEnv: "development" });
    expect(opts.secure).toBe(true);
  });
});
