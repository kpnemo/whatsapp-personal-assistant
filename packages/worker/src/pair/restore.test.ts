import { initAuthCreds, type AuthenticationState } from "@whiskeysockets/baileys";
import { generateKey, serializeCiphertext, wrapDek } from "@wpa/shared";
import {
  makeTestDb,
  makeTestRedis,
  seedUser,
  TEST_MASTER_KEY,
  type TestDb,
  type TestRedis,
} from "@wpa/test-utils";
import { pino } from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { makeAuthStore, type EncryptedAuthStore } from "./authStore.js";
import { restorePairedSessions } from "./restore.js";
import type { SnapshotBlob, SnapshotScheduler } from "./snapshot.js";
import type { PairMachine } from "./state.js";

const silentLogger = pino({ level: "silent" });

interface FakeScheduler extends SnapshotScheduler {
  started: string[];
}

function makeFakeScheduler(): FakeScheduler {
  const started: string[] = [];
  return {
    started,
    start: (userId: string) => {
      started.push(userId);
    },
    stop: () => undefined,
    flushNow: () => Promise.resolve(),
    shutdown: () => Promise.resolve(),
  };
}

interface FakePairMachine {
  machine: PairMachine;
  starts: { userId: string; authState: AuthenticationState | null }[];
  resumes: { userId: string; authState: AuthenticationState }[];
}

function makeFakePairMachine(): FakePairMachine {
  const starts: { userId: string; authState: AuthenticationState | null }[] = [];
  const resumes: { userId: string; authState: AuthenticationState }[] = [];
  const stub = {
    start: vi.fn((userId: string, authState: AuthenticationState | null) => {
      starts.push({ userId, authState });
      return Promise.resolve();
    }),
    resumePaired: vi.fn((userId: string, authState: AuthenticationState) => {
      resumes.push({ userId, authState });
      return Promise.resolve();
    }),
    stop: vi.fn(() => Promise.resolve()),
    getState: () => "paired",
  };
  return {
    machine: stub as unknown as PairMachine,
    starts,
    resumes,
  };
}

describe("restorePairedSessions (real Redis + real Postgres)", () => {
  let testDb: TestDb;
  let testRedis: TestRedis;
  let authStore: EncryptedAuthStore;

  beforeAll(async () => {
    testDb = await makeTestDb();
    testRedis = await makeTestRedis();
    authStore = makeAuthStore(testRedis.client, silentLogger);
  }, 180_000);

  afterAll(async () => {
    if (testDb) await testDb.teardown();
    if (testRedis) await testRedis.teardown();
  }, 60_000);

  beforeEach(async () => {
    await testRedis.client.flushdb();
    await testDb.prisma.whatsappSession.deleteMany();
    await testDb.prisma.auditLog.deleteMany();
    await testDb.prisma.user.deleteMany();
  });

  /**
   * Seed a paired WhatsappSession with a valid encrypted snapshot.
   * Returns the userId + dek used to encrypt.
   */
  async function seedPairedSession(email: string): Promise<{ userId: string; dek: Buffer }> {
    // seedUser uses TEST_MASTER_KEY to wrap a fresh DEK, we can't recover it,
    // so we overwrite encryptedDek with a known one instead.
    const user = await seedUser(testDb.prisma, {
      email,
      role: "user",
      password: "password1234567890",
    });
    const knownDek = generateKey();
    const wrapped = wrapDek(TEST_MASTER_KEY, knownDek);
    const encryptedDek = Buffer.from(serializeCiphertext(wrapped));
    await testDb.prisma.user.update({
      where: { id: user.id },
      data: { encryptedDek },
    });

    // Populate Redis with encrypted creds + key, then capture the blob.
    const creds = initAuthCreds();
    await authStore.saveCreds(user.id, knownDek, creds);
    const state = await authStore.loadState(user.id, knownDek);
    await state.keys.set({
      session: { "sess-a": Buffer.from([9, 8, 7]) },
    });
    const credsCt = await authStore.readCredsRaw(user.id);
    const keyRaws = await authStore.readAllKeysRaw(user.id);
    const blob: SnapshotBlob = {
      v: 1,
      credsCt,
      keys: keyRaws.map((k) => ({ type: k.type, id: k.id, ct: k.serializedCt })),
    };
    await testDb.prisma.whatsappSession.create({
      data: {
        userId: user.id,
        status: "paired",
        authState: Buffer.from(JSON.stringify(blob)),
      },
    });
    // Clear Redis so we can verify hydration actually happens.
    await testRedis.client.flushdb();
    return { userId: user.id, dek: knownDek };
  }

  it("restores every paired session: hydrates Redis, calls pairMachine.start, writes audit", async () => {
    const { userId, dek } = await seedPairedSession("restore-happy@example.com");

    const pair = makeFakePairMachine();
    const snap = makeFakeScheduler();
    const audits: { userId: string; subtype: string; details?: Record<string, unknown> }[] = [];

    const summary = await restorePairedSessions({
      prisma: testDb.prisma,
      authStore,
      pairMachine: pair.machine,
      snapshotter: snap,
      masterKey: TEST_MASTER_KEY,
      logger: silentLogger,
      writeAudit: (u, subtype, details) => {
        audits.push({
          userId: u,
          subtype,
          ...(details !== undefined ? { details } : {}),
        });
        return Promise.resolve();
      },
    });

    expect(summary).toEqual({ restored: 1, failed: 0 });
    // resumePaired must be called (not start) on the happy path.
    expect(pair.resumes).toHaveLength(1);
    expect(pair.resumes[0]!.userId).toBe(userId);
    // authState should be reconstructed with creds restored.
    const authState = pair.resumes[0]!.authState;
    expect(authState).toBeTruthy();
    expect(authState.creds.registrationId).toBeTypeOf("number");
    // start must NOT be called on the restore happy path.
    expect(pair.starts).toHaveLength(0);

    expect(snap.started).toEqual([userId]);

    // Redis hot state was hydrated.
    const credsCt = await testRedis.client.get(`wpa:wa-session:${userId}:creds`);
    expect(credsCt).toBeTruthy();
    const keyIndex = await testRedis.client.smembers(`wpa:wa-session:${userId}:keys-index`);
    expect(keyIndex).toContain("session:sess-a");

    // Audit written.
    expect(audits).toHaveLength(1);
    expect(audits[0]!.subtype).toBe("pair.restored");
    expect(audits[0]!.details).toMatchObject({ keys: 1 });

    // Confirm the restored keys can actually be decrypted with the original DEK.
    const reloaded = await authStore.loadState(userId, dek);
    const k = await reloaded.keys.get("session", ["sess-a"]);
    expect(Buffer.isBuffer(k["sess-a"] as unknown as Buffer)).toBe(true);
  });

  it("skips + records pair.failed on corrupt authState blob", async () => {
    const user = await seedUser(testDb.prisma, {
      email: "restore-corrupt@example.com",
      role: "user",
      password: "correct-horse-battery-staple",
    });
    const dek = generateKey();
    const wrapped = wrapDek(TEST_MASTER_KEY, dek);
    await testDb.prisma.user.update({
      where: { id: user.id },
      data: { encryptedDek: Buffer.from(serializeCiphertext(wrapped)) },
    });
    await testDb.prisma.whatsappSession.create({
      data: {
        userId: user.id,
        status: "paired",
        authState: Buffer.from("not a valid json blob", "utf8"),
      },
    });

    const pair = makeFakePairMachine();
    const snap = makeFakeScheduler();
    const audits: { userId: string; subtype: string; details?: Record<string, unknown> }[] = [];

    const summary = await restorePairedSessions({
      prisma: testDb.prisma,
      authStore,
      pairMachine: pair.machine,
      snapshotter: snap,
      masterKey: TEST_MASTER_KEY,
      logger: silentLogger,
      writeAudit: (u, subtype, details) => {
        audits.push({
          userId: u,
          subtype,
          ...(details !== undefined ? { details } : {}),
        });
        return Promise.resolve();
      },
    });

    expect(summary).toEqual({ restored: 0, failed: 1 });
    expect(pair.starts).toHaveLength(0);
    expect(snap.started).toEqual([]);

    // Session row marked disconnected.
    const row = await testDb.prisma.whatsappSession.findUnique({ where: { userId: user.id } });
    expect(row!.status).toBe("disconnected");

    // pair.failed audit written with error message.
    expect(audits).toHaveLength(1);
    expect(audits[0]!.subtype).toBe("pair.failed");
    expect(audits[0]!.details).toMatchObject({ error: expect.any(String) as string });
  });

  it("paired row with missing authState is treated as failure", async () => {
    const user = await seedUser(testDb.prisma, {
      email: "restore-missing@example.com",
      role: "user",
      password: "correct-horse-battery-staple",
    });
    await testDb.prisma.whatsappSession.create({
      data: { userId: user.id, status: "paired", authState: null },
    });
    const pair = makeFakePairMachine();
    const snap = makeFakeScheduler();

    const summary = await restorePairedSessions({
      prisma: testDb.prisma,
      authStore,
      pairMachine: pair.machine,
      snapshotter: snap,
      masterKey: TEST_MASTER_KEY,
      logger: silentLogger,
      writeAudit: () => Promise.resolve(),
    });
    expect(summary).toEqual({ restored: 0, failed: 1 });
  });

  it("ignores sessions that are not status='paired'", async () => {
    const u = await seedUser(testDb.prisma, {
      email: "restore-pairing@example.com",
      role: "user",
      password: "correct-horse-battery-staple",
    });
    await testDb.prisma.whatsappSession.create({
      data: { userId: u.id, status: "pairing" },
    });
    const pair = makeFakePairMachine();
    const snap = makeFakeScheduler();
    const summary = await restorePairedSessions({
      prisma: testDb.prisma,
      authStore,
      pairMachine: pair.machine,
      snapshotter: snap,
      masterKey: TEST_MASTER_KEY,
      logger: silentLogger,
      writeAudit: () => Promise.resolve(),
    });
    expect(summary).toEqual({ restored: 0, failed: 0 });
    expect(pair.starts).toHaveLength(0);
  });

  it("returns zero counts when no paired sessions exist", async () => {
    const pair = makeFakePairMachine();
    const snap = makeFakeScheduler();
    const summary = await restorePairedSessions({
      prisma: testDb.prisma,
      authStore,
      pairMachine: pair.machine,
      snapshotter: snap,
      masterKey: TEST_MASTER_KEY,
      logger: silentLogger,
      writeAudit: () => Promise.resolve(),
    });
    expect(summary).toEqual({ restored: 0, failed: 0 });
  });

  it("handles mixed success + failure in the same run", async () => {
    const good = await seedPairedSession("restore-mix-good@example.com");
    // Bad one: corrupt blob.
    const badUser = await seedUser(testDb.prisma, {
      email: "restore-mix-bad@example.com",
      role: "user",
      password: "password1234567890",
    });
    await testDb.prisma.whatsappSession.create({
      data: {
        userId: badUser.id,
        status: "paired",
        authState: Buffer.from("{}", "utf8"),
      },
    });

    const pair = makeFakePairMachine();
    const snap = makeFakeScheduler();
    const audits: { userId: string; subtype: string }[] = [];
    const summary = await restorePairedSessions({
      prisma: testDb.prisma,
      authStore,
      pairMachine: pair.machine,
      snapshotter: snap,
      masterKey: TEST_MASTER_KEY,
      logger: silentLogger,
      writeAudit: (u, subtype) => {
        audits.push({ userId: u, subtype });
        return Promise.resolve();
      },
    });
    expect(summary).toEqual({ restored: 1, failed: 1 });
    expect(audits.map((a) => a.subtype).sort()).toEqual(["pair.failed", "pair.restored"]);
    expect(pair.resumes.map((s) => s.userId)).toEqual([good.userId]);
    expect(pair.starts).toHaveLength(0);
  });
});
