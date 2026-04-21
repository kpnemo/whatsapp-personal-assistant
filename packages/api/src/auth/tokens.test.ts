import { describe, expect, it } from "vitest";

import {
  hashRefreshToken,
  issueAccessToken,
  issueRefreshToken,
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
    const tampered = jwt.slice(0, -1) + (jwt.endsWith("a") ? "b" : "a");
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
    const tampered = jwt.slice(0, -1) + (jwt.endsWith("a") ? "b" : "a");
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
