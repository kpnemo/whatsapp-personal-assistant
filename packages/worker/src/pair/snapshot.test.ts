import { initAuthCreds } from "@whiskeysockets/baileys";
import { generateKey } from "@wpa/shared";
import { makeTestDb, makeTestRedis, seedUser, type TestDb, type TestRedis } from "@wpa/test-utils";
import { pino } from "pino";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { makeAuthStore, type EncryptedAuthStore } from "./authStore.js";
import { makeSnapshotScheduler, type SnapshotBlob, type SnapshotScheduler } from "./snapshot.js";

const silentLogger = pino({ level: "silent" });

describe("SnapshotScheduler (real Redis + real Postgres)", () => {
  let testDb: TestDb;
  let testRedis: TestRedis;
  let store: EncryptedAuthStore;

  beforeAll(async () => {
    testDb = await makeTestDb();
    testRedis = await makeTestRedis();
    store = makeAuthStore(testRedis.client, silentLogger);
  }, 180_000);

  afterAll(async () => {
    if (testDb) await testDb.teardown();
    if (testRedis) await testRedis.teardown();
  }, 60_000);

  beforeEach(async () => {
    await testRedis.client.flushdb();
    await testDb.prisma.whatsappSession.deleteMany();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function seedUserAndSession(email: string): Promise<{ userId: string; dek: Buffer }> {
    const user = await seedUser(testDb.prisma, {
      email,
      role: "user",
      password: "correct-horse-battery-staple",
    });
    await testDb.prisma.whatsappSession.create({
      data: { userId: user.id, status: "pairing" },
    });
    return { userId: user.id, dek: generateKey() };
  }

  it("flushNow writes an encrypted snapshot blob to WhatsappSession.authState", async () => {
    const { userId, dek } = await seedUserAndSession("snapshot-flush@example.com");

    // Populate Redis with encrypted creds + a key entry through the authStore.
    const creds = initAuthCreds();
    await store.saveCreds(userId, dek, creds);
    const loaded = await store.loadState(userId, dek);
    await loaded.keys.set({
      session: { s1: Buffer.from([1, 2, 3]) },
    });

    const snap: SnapshotScheduler = makeSnapshotScheduler(testDb.prisma, store, silentLogger, {
      intervalMs: 99_999,
    });
    await snap.flushNow(userId, dek);

    const row = await testDb.prisma.whatsappSession.findUnique({ where: { userId } });
    expect(row).toBeTruthy();
    expect(row!.authState).toBeTruthy();
    const blob = JSON.parse(Buffer.from(row!.authState!).toString("utf8")) as SnapshotBlob;
    expect(blob.v).toBe(1);
    expect(typeof blob.credsCt).toBe("string");
    expect(blob.keys).toHaveLength(1);
    expect(blob.keys[0]!.type).toBe("session");
    expect(blob.keys[0]!.id).toBe("s1");
    expect(blob.keys[0]!.ct.split(".").length).toBe(3);
    expect(row!.lastConnectedAt).toBeTruthy();

    await snap.shutdown();
  });

  it("flushNow skips update when Redis holds no state (no blob overwrite)", async () => {
    const { userId, dek } = await seedUserAndSession("snapshot-empty@example.com");
    // Pre-seed DB with a marker so we can detect overwrite.
    await testDb.prisma.whatsappSession.update({
      where: { userId },
      data: { authState: Buffer.from("MARKER", "utf8") },
    });

    const snap = makeSnapshotScheduler(testDb.prisma, store, silentLogger);
    await snap.flushNow(userId, dek);

    const row = await testDb.prisma.whatsappSession.findUnique({ where: { userId } });
    expect(row!.authState).toBeTruthy();
    expect(Buffer.from(row!.authState!).toString("utf8")).toBe("MARKER");

    await snap.shutdown();
  });

  it("start() schedules periodic flushes on the given interval", async () => {
    const { userId, dek } = await seedUserAndSession("snapshot-interval@example.com");
    const creds = initAuthCreds();
    await store.saveCreds(userId, dek, creds);

    const snap = makeSnapshotScheduler(testDb.prisma, store, silentLogger, {
      intervalMs: 30,
    });
    snap.start(userId, dek);

    // Wait long enough for at least one flush to occur.
    await new Promise((r) => setTimeout(r, 120));

    const row = await testDb.prisma.whatsappSession.findUnique({ where: { userId } });
    expect(row!.authState).toBeTruthy();

    snap.stop(userId);
    await snap.shutdown();
  });

  it("shutdown clears every active timer and awaits in-flight flushes", async () => {
    const { userId: uA, dek: dekA } = await seedUserAndSession("snapshot-shut-a@example.com");
    const { userId: uB, dek: dekB } = await seedUserAndSession("snapshot-shut-b@example.com");
    const credsA = initAuthCreds();
    const credsB = initAuthCreds();
    await store.saveCreds(uA, dekA, credsA);
    await store.saveCreds(uB, dekB, credsB);

    const snap = makeSnapshotScheduler(testDb.prisma, store, silentLogger, {
      intervalMs: 30,
    });
    snap.start(uA, dekA);
    snap.start(uB, dekB);
    await snap.shutdown();

    // Record the lastConnectedAt after shutdown.
    const rowAStart = await testDb.prisma.whatsappSession.findUnique({ where: { userId: uA } });
    const rowBStart = await testDb.prisma.whatsappSession.findUnique({ where: { userId: uB } });

    // Wait several intervals past shutdown: DB rows must NOT continue to update.
    await new Promise((r) => setTimeout(r, 150));

    const rowAEnd = await testDb.prisma.whatsappSession.findUnique({ where: { userId: uA } });
    const rowBEnd = await testDb.prisma.whatsappSession.findUnique({ where: { userId: uB } });
    expect(rowAEnd!.lastConnectedAt?.getTime()).toBe(rowAStart!.lastConnectedAt?.getTime());
    expect(rowBEnd!.lastConnectedAt?.getTime()).toBe(rowBStart!.lastConnectedAt?.getTime());
  });

  it("Prisma update error is swallowed (scheduler keeps running)", async () => {
    const { userId, dek } = await seedUserAndSession("snapshot-err@example.com");
    const creds = initAuthCreds();
    await store.saveCreds(userId, dek, creds);

    // Delete the session row so the update fails with P2025.
    await testDb.prisma.whatsappSession.delete({ where: { userId } });

    const snap = makeSnapshotScheduler(testDb.prisma, store, silentLogger);
    await expect(snap.flushNow(userId, dek)).resolves.toBeUndefined();
    await snap.shutdown();
  });

  it("start() is idempotent — second start replaces the old timer", async () => {
    const { userId, dek } = await seedUserAndSession("snapshot-idem@example.com");
    const creds = initAuthCreds();
    await store.saveCreds(userId, dek, creds);

    const snap = makeSnapshotScheduler(testDb.prisma, store, silentLogger, {
      intervalMs: 50,
    });
    snap.start(userId, dek);
    snap.start(userId, dek);
    snap.stop(userId);
    // stop() + time passes: no new writes.
    await new Promise((r) => setTimeout(r, 120));
    await snap.shutdown();
  });
});
