import {
  decryptWithKey,
  encryptWithKey,
  parseCiphertext,
  serializeCiphertext,
  unwrapDek,
} from "@wpa/shared";
import { TEST_MASTER_KEY, makeTestDb, seedUser, type TestDb } from "@wpa/test-utils";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Exercises the WhatsappSession schema end-to-end:
 *   1. Prisma client instantiates and the whatsapp_sessions table exists.
 *   2. Encrypted phoneNumber + authState round-trip through BYTEA columns.
 *   3. Cascade delete from users wipes the session row.
 */
describe("WhatsappSession schema", () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await makeTestDb();
  }, 180_000);

  afterAll(async () => {
    await db.teardown();
  }, 60_000);

  it("has the whatsapp_sessions table materialized (migrations ran)", async () => {
    // Query succeeding proves the table + FK + enum all exist.
    const count = await db.prisma.whatsappSession.count();
    expect(count).toBe(0);
  });

  it("round-trips encrypted phoneNumber + authState through BYTEA columns", async () => {
    const user = await seedUser(db.prisma, {
      email: "pair-rt@example.com",
      role: "user",
      password: "correct horse battery staple",
    });

    // Unwrap the DEK exactly the way @wpa/api will: parse the wrapped ciphertext,
    // then unwrap with the test master key. Mirrors production decrypt path.
    const dek = unwrapDek(TEST_MASTER_KEY, parseCiphertext(user.encryptedDek.toString("utf8")));

    const phonePlaintext = "+15551234567";
    const authStatePlaintext = JSON.stringify({ registered: true, creds: { noise: "abc" } });

    const phoneCt = encryptWithKey(dek, phonePlaintext);
    const authStateCt = encryptWithKey(dek, authStatePlaintext);

    const created = await db.prisma.whatsappSession.create({
      data: {
        userId: user.id,
        status: "paired",
        phoneNumber: Buffer.from(serializeCiphertext(phoneCt)),
        authState: Buffer.from(serializeCiphertext(authStateCt)),
        lastConnectedAt: new Date(),
      },
    });

    expect(created.id).toMatch(/^[a-z0-9]+$/);
    expect(created.userId).toBe(user.id);
    expect(created.status).toBe("paired");

    const read = await db.prisma.whatsappSession.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(read.phoneNumber).not.toBeNull();
    expect(read.authState).not.toBeNull();

    const phoneDecrypted = decryptWithKey(
      dek,
      parseCiphertext(Buffer.from(read.phoneNumber!).toString("utf8")),
    );
    const authStateDecrypted = decryptWithKey(
      dek,
      parseCiphertext(Buffer.from(read.authState!).toString("utf8")),
    );
    expect(phoneDecrypted).toBe(phonePlaintext);
    expect(authStateDecrypted).toBe(authStatePlaintext);
  });

  it("defaults status to 'pairing' and leaves encrypted fields nullable", async () => {
    const user = await seedUser(db.prisma, {
      email: "pair-defaults@example.com",
      role: "user",
      password: "correct horse battery staple",
    });

    const created = await db.prisma.whatsappSession.create({
      data: { userId: user.id },
    });

    expect(created.status).toBe("pairing");
    expect(created.phoneNumber).toBeNull();
    expect(created.authState).toBeNull();
    expect(created.lastConnectedAt).toBeNull();
  });

  it("enforces one session per user (unique userId)", async () => {
    const user = await seedUser(db.prisma, {
      email: "pair-unique@example.com",
      role: "user",
      password: "correct horse battery staple",
    });

    await db.prisma.whatsappSession.create({ data: { userId: user.id } });
    await expect(db.prisma.whatsappSession.create({ data: { userId: user.id } })).rejects.toThrow();
  });

  it("cascades delete from users to whatsapp_sessions", async () => {
    const user = await seedUser(db.prisma, {
      email: "pair-cascade@example.com",
      role: "user",
      password: "correct horse battery staple",
    });

    const session = await db.prisma.whatsappSession.create({
      data: { userId: user.id, status: "paired" },
    });

    await db.prisma.user.delete({ where: { id: user.id } });

    const after = await db.prisma.whatsappSession.findUnique({
      where: { id: session.id },
    });
    expect(after).toBeNull();
  });
});
