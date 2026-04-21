import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { makeTestDb, seedInvitation, seedUser, type TestDb } from "./db.js";

describe("makeTestDb", () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await makeTestDb();
  }, 180_000);

  afterAll(async () => {
    await db.teardown();
  }, 60_000);

  it("returns a postgres connection URL", () => {
    expect(db.url).toMatch(/^postgres(?:ql)?:\/\//);
  });

  it("has the User table materialized (migrations ran)", async () => {
    // empty DB, so count is 0 — but the query working proves the table exists
    const count = await db.prisma.user.count();
    expect(count).toBe(0);
  });

  it("seedUser creates a user with argon2id hash + wrapped DEK", async () => {
    const user = await seedUser(db.prisma, {
      email: "alice@example.com",
      role: "user",
      password: "correct horse battery staple",
    });

    expect(user.id).toMatch(/^[a-z0-9]+$/);
    expect(user.email).toBe("alice@example.com");
    expect(user.role).toBe("user");
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user.encryptedDek.length).toBeGreaterThan(0);
  });

  it("seedUser writes a register audit row", async () => {
    const user = await seedUser(db.prisma, {
      email: "bob@example.com",
      role: "admin",
      password: "correct horse battery staple",
    });
    const audits = await db.prisma.auditLog.findMany({ where: { userId: user.id } });
    expect(audits).toHaveLength(1);
    expect(audits[0]!.type).toBe("register");
  });

  it("seedInvitation creates a row and returns the plaintext token", async () => {
    const inviter = await seedUser(db.prisma, {
      email: "inviter@example.com",
      role: "admin",
      password: "correct horse battery staple",
    });
    const inv = await seedInvitation(db.prisma, {
      email: "invitee@example.com",
      expiresIn: 60_000,
      invitedBy: inviter.id,
    });

    expect(inv.id).toMatch(/^[a-z0-9]+$/);
    expect(inv.token).toMatch(/^[A-Za-z0-9_-]+$/); // base64url
    expect(inv.token.length).toBeGreaterThanOrEqual(40);

    const row = await db.prisma.invitation.findUnique({ where: { id: inv.id } });
    expect(row).not.toBeNull();
    expect(row?.email).toBe("invitee@example.com");
    expect(row?.invitedById).toBe(inviter.id);
    // tokenHash is the sha256 of the plaintext, never the plaintext itself
    expect(row?.tokenHash).not.toBe(inv.token);
    expect(row?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
