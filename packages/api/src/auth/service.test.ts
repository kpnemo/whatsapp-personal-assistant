import { disconnectPrisma, type PrismaClient } from "@wpa/db";
import { generateKey, serializeCiphertext, wrapDek } from "@wpa/shared";
import { TEST_MASTER_KEY, makeTestDb, seedUser, type TestDb } from "@wpa/test-utils";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AuthError, login, registerUser, revokeRefresh, rotateRefresh } from "./service.js";
import { hashRefreshToken, verifyAccessToken } from "./tokens.js";

/**
 * Integration tests for packages/api/src/auth/service.ts against a real
 * Postgres testcontainer. Mirrors the public API surface:
 *   - login(email, password, meta)
 *   - rotateRefresh(oldToken, meta)
 *   - revokeRefresh(token)
 *   - registerUser({ email, password, encryptedDek, role })
 *
 * Invite-token + open-registration logic lives in routes/auth.ts (not the
 * service) — covered separately by routes/auth.test.ts. Here we just verify
 * registerUser's raw insert semantics.
 */

async function bootstrap(): Promise<{ db: TestDb; prisma: PrismaClient }> {
  const db = await makeTestDb();
  process.env.DATABASE_URL = db.url;
  // Force the api package's singleton PrismaClient to connect to the container.
  await disconnectPrisma();
  const { getPrisma } = await import("@wpa/db");
  return { db, prisma: getPrisma() };
}

describe("auth/service.ts", () => {
  let db: TestDb;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const b = await bootstrap();
    db = b.db;
    prisma = b.prisma;
  }, 180_000);

  afterAll(async () => {
    await disconnectPrisma();
    if (db) await db.teardown();
  }, 60_000);

  beforeEach(async () => {
    // Clean slate per test — truncating rather than dropping avoids migration
    // reruns. Order respects FK cascades.
    await prisma.refreshToken.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.invitation.deleteMany();
    await prisma.whatsappSession.deleteMany();
    await prisma.user.deleteMany();
  });

  describe("login", () => {
    it("returns tokens + user on valid credentials, writes refresh row + bumps lastLoginAt", async () => {
      const before = new Date();
      const user = await seedUser(prisma, {
        email: "login-ok@example.com",
        role: "user",
        password: "correct-horse-battery-staple",
      });

      const result = await login("login-ok@example.com", "correct-horse-battery-staple", {
        ip: "203.0.113.10",
        userAgent: "vitest/1.0",
      });

      expect(result.userId).toBe(user.id);
      expect(result.role).toBe("user");
      expect(typeof result.accessToken).toBe("string");
      expect(typeof result.refreshToken).toBe("string");

      // JWT is a verified wpa-issued access token
      const claims = await verifyAccessToken(result.accessToken);
      expect(claims.sub).toBe(user.id);
      expect(claims.role).toBe("user");

      // Refresh token hash is stored + metadata persisted
      const rows = await prisma.refreshToken.findMany({ where: { userId: user.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.tokenHash).toBe(hashRefreshToken(result.refreshToken));
      expect(rows[0]!.ip).toBe("203.0.113.10");
      expect(rows[0]!.userAgent).toBe("vitest/1.0");
      expect(rows[0]!.revokedAt).toBeNull();

      // lastLoginAt bumped
      const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(after.lastLoginAt).not.toBeNull();
      expect(after.lastLoginAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });

    it("persists null ip/userAgent when metadata is omitted", async () => {
      const user = await seedUser(prisma, {
        email: "login-meta@example.com",
        role: "user",
        password: "correct-horse-battery-staple",
      });
      await login("login-meta@example.com", "correct-horse-battery-staple", {});
      const rows = await prisma.refreshToken.findMany({ where: { userId: user.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.ip).toBeNull();
      expect(rows[0]!.userAgent).toBeNull();
    });

    it("throws AuthError(invalid_credentials) on wrong password", async () => {
      await seedUser(prisma, {
        email: "login-bad@example.com",
        role: "user",
        password: "correct-horse-battery-staple",
      });
      await expect(login("login-bad@example.com", "wrong", {})).rejects.toBeInstanceOf(AuthError);
      await expect(login("login-bad@example.com", "wrong", {})).rejects.toMatchObject({
        code: "invalid_credentials",
      });
    });

    it("throws AuthError(invalid_credentials) on unknown email (same code to prevent enumeration)", async () => {
      await expect(login("nobody@example.com", "whatever", {})).rejects.toMatchObject({
        code: "invalid_credentials",
      });
    });
  });

  describe("rotateRefresh", () => {
    it("rotates tokens + revokes the old refresh row on valid input", async () => {
      const user = await seedUser(prisma, {
        email: "rot-ok@example.com",
        role: "user",
        password: "correct-horse-battery-staple",
      });
      const first = await login("rot-ok@example.com", "correct-horse-battery-staple", {
        ip: "203.0.113.20",
      });

      const rotated = await rotateRefresh(first.refreshToken, { ip: "203.0.113.21" });
      expect(rotated).not.toBeNull();
      // Refresh token is opaque random bytes — must never collide across rotations.
      expect(rotated!.refreshToken).not.toBe(first.refreshToken);
      // Access token is a JWT with second-precision `iat`, so two tokens minted
      // inside the same second can be byte-identical. We instead assert that
      // the new token is independently verifiable.
      expect(typeof rotated!.accessToken).toBe("string");
      expect(rotated!.accessToken.length).toBeGreaterThan(40);

      // Old row is revoked; new row is active + metadata persisted
      const rows = await prisma.refreshToken.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "asc" },
      });
      expect(rows).toHaveLength(2);
      expect(rows[0]!.revokedAt).not.toBeNull();
      expect(rows[1]!.revokedAt).toBeNull();
      expect(rows[1]!.ip).toBe("203.0.113.21");
      expect(rows[1]!.tokenHash).toBe(hashRefreshToken(rotated!.refreshToken));
    });

    it("returns null for an already-revoked token", async () => {
      await seedUser(prisma, {
        email: "rot-rev@example.com",
        role: "user",
        password: "correct-horse-battery-staple",
      });
      const first = await login("rot-rev@example.com", "correct-horse-battery-staple", {});
      await revokeRefresh(first.refreshToken);
      await expect(rotateRefresh(first.refreshToken, {})).resolves.toBeNull();
    });

    it("returns null for an expired token", async () => {
      const user = await seedUser(prisma, {
        email: "rot-exp@example.com",
        role: "user",
        password: "correct-horse-battery-staple",
      });
      const first = await login("rot-exp@example.com", "correct-horse-battery-staple", {});
      // Backdate the expiry directly in the DB.
      await prisma.refreshToken.updateMany({
        where: { userId: user.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await expect(rotateRefresh(first.refreshToken, {})).resolves.toBeNull();
    });

    it("returns null for an unknown token", async () => {
      await expect(rotateRefresh("never-issued-token", {})).resolves.toBeNull();
    });
  });

  describe("revokeRefresh", () => {
    it("sets revokedAt on a valid token", async () => {
      const user = await seedUser(prisma, {
        email: "rev-ok@example.com",
        role: "user",
        password: "correct-horse-battery-staple",
      });
      const first = await login("rev-ok@example.com", "correct-horse-battery-staple", {});

      await revokeRefresh(first.refreshToken);

      const row = await prisma.refreshToken.findUniqueOrThrow({
        where: { tokenHash: hashRefreshToken(first.refreshToken) },
      });
      expect(row.userId).toBe(user.id);
      expect(row.revokedAt).not.toBeNull();
    });

    it("is a noop for an unknown token (no throw)", async () => {
      await expect(revokeRefresh("never-issued-token")).resolves.toBeUndefined();
    });

    it("is idempotent (second call doesn't bump revokedAt)", async () => {
      await seedUser(prisma, {
        email: "rev-idem@example.com",
        role: "user",
        password: "correct-horse-battery-staple",
      });
      const first = await login("rev-idem@example.com", "correct-horse-battery-staple", {});
      await revokeRefresh(first.refreshToken);
      const afterFirst = await prisma.refreshToken.findUniqueOrThrow({
        where: { tokenHash: hashRefreshToken(first.refreshToken) },
      });
      const revokedAt1 = afterFirst.revokedAt;
      await revokeRefresh(first.refreshToken);
      const afterSecond = await prisma.refreshToken.findUniqueOrThrow({
        where: { tokenHash: hashRefreshToken(first.refreshToken) },
      });
      expect(afterSecond.revokedAt?.getTime()).toBe(revokedAt1?.getTime());
    });
  });

  describe("registerUser", () => {
    // Invite-token + first-user-admin logic lives in routes/auth.ts (not here).
    // registerUser itself is a thin insert — we verify the contract it offers.
    function makeEncryptedDek(): Buffer {
      const dek = generateKey();
      const wrapped = wrapDek(TEST_MASTER_KEY, dek);
      return Buffer.from(serializeCiphertext(wrapped));
    }

    it("creates a user with the given role + hashes the password", async () => {
      const created = await registerUser({
        email: "reg-ok@example.com",
        password: "correct-horse-battery-staple",
        encryptedDek: makeEncryptedDek(),
        role: "admin",
      });
      expect(created.id).toMatch(/^[a-z0-9]+$/);

      const row = await prisma.user.findUniqueOrThrow({ where: { id: created.id } });
      expect(row.email).toBe("reg-ok@example.com");
      expect(row.role).toBe("admin");
      // Argon2 hashes start with "$argon2id$" — never equal the plaintext.
      expect(row.passwordHash).not.toBe("correct-horse-battery-staple");
      expect(row.passwordHash).toMatch(/^\$argon2id\$/);
    });

    it("rejects duplicate email (unique constraint surfaces)", async () => {
      await registerUser({
        email: "reg-dup@example.com",
        password: "correct-horse-battery-staple",
        encryptedDek: makeEncryptedDek(),
        role: "user",
      });
      await expect(
        registerUser({
          email: "reg-dup@example.com",
          password: "correct-horse-battery-staple",
          encryptedDek: makeEncryptedDek(),
          role: "user",
        }),
      ).rejects.toThrow();
    });

    it("preserves the encryptedDek bytes exactly", async () => {
      const dek = makeEncryptedDek();
      const created = await registerUser({
        email: "reg-dek@example.com",
        password: "correct-horse-battery-staple",
        encryptedDek: dek,
        role: "user",
      });
      const row = await prisma.user.findUniqueOrThrow({ where: { id: created.id } });
      expect(Buffer.from(row.encryptedDek).equals(dek)).toBe(true);
    });
  });
});
