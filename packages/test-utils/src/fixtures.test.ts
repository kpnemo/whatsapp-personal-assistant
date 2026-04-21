import { describe, expect, it } from "vitest";

import {
  TEST_JWT_SECRET,
  TEST_MASTER_KEY,
  hashPassword,
  issueAccessToken,
  verifyAccessToken,
  verifyPassword,
} from "./fixtures.js";

describe("TEST_MASTER_KEY", () => {
  it("is a 32-byte Buffer", () => {
    expect(Buffer.isBuffer(TEST_MASTER_KEY)).toBe(true);
    expect(TEST_MASTER_KEY.length).toBe(32);
  });

  it("is deterministic so tests can decrypt fixture data", () => {
    const firstByte = TEST_MASTER_KEY[0];
    const allSame = TEST_MASTER_KEY.every((b) => b === firstByte);
    expect(allSame).toBe(true);
  });
});

describe("TEST_JWT_SECRET", () => {
  it("is a string of at least 32 characters (matches env.ts constraint)", () => {
    expect(typeof TEST_JWT_SECRET).toBe("string");
    expect(TEST_JWT_SECRET.length).toBeGreaterThanOrEqual(32);
  });
});

describe("hashPassword / verifyPassword", () => {
  it("hashes with argon2id and verifies the same password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(hash, "correct horse battery staple")).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword(hash, "wrong")).toBe(false);
  });
});

describe("issueAccessToken / verifyAccessToken", () => {
  it("round-trips user/role claims", async () => {
    const token = await issueAccessToken(TEST_JWT_SECRET, { sub: "user_123", role: "admin" });
    const claims = await verifyAccessToken(TEST_JWT_SECRET, token);
    expect(claims.sub).toBe("user_123");
    expect(claims.role).toBe("admin");
  });

  it("rejects tokens signed with a different secret", async () => {
    const token = await issueAccessToken(TEST_JWT_SECRET, { sub: "user_123", role: "user" });
    await expect(verifyAccessToken("x".repeat(64), token)).rejects.toThrow();
  });
});
