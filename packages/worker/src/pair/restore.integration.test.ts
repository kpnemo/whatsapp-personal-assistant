/**
 * Integration test: worker boot session restore (IB2 — PA3 gap fix).
 *
 * Boots real Postgres + Redis via @wpa/test-utils (testcontainers), seeds a
 * paired WhatsappSession with an encrypted Baileys snapshot, calls
 * restorePairedSessions, and asserts that:
 *   1. pairMachine.resumePaired is called with the correct userId + authState.
 *   2. pairMachine.start is NOT called (old broken path).
 *   3. A `pair.restored` audit is written.
 *   4. Redis was hydrated with the encrypted creds.
 */
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

function makeFakeScheduler(): SnapshotScheduler {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    flushNow: vi.fn(() => Promise.resolve()),
    shutdown: vi.fn(() => Promise.resolve()),
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
    getState: () => "paired" as const,
  };
  return { machine: stub as unknown as PairMachine, starts, resumes };
}

describe.sequential("restorePairedSessions — integration (IB2 PA3 gap fix)", () => {
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

  async function seedPairedSession(email: string): Promise<{ userId: string; dek: Buffer }> {
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

    // Build snapshot blob with real Baileys creds.
    const creds = initAuthCreds();
    await authStore.saveCreds(user.id, knownDek, creds);
    const state = await authStore.loadState(user.id, knownDek);
    await state.keys.set({
      session: { "sess-x": Buffer.from([1, 2, 3]) },
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
    // Flush Redis so we can verify hydration happens during restore.
    await testRedis.client.flushdb();
    return { userId: user.id, dek: knownDek };
  }

  it("resumePaired is called with correct userId + valid authState on the restore happy path", async () => {
    const { userId } = await seedPairedSession("ib2-resume@example.com");
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

    expect(summary).toEqual({ restored: 1, failed: 0 });

    // resumePaired must be invoked — not the old start() path.
    expect(pair.resumes).toHaveLength(1);
    expect(pair.resumes[0]!.userId).toBe(userId);
    expect(pair.starts).toHaveLength(0);

    // authState passed to resumePaired must carry valid Baileys creds.
    const authState = pair.resumes[0]!.authState;
    expect(authState).toBeTruthy();
    expect(authState.creds.registrationId).toBeTypeOf("number");
    expect(authState.keys).toBeTruthy();

    // pair.restored audit written.
    expect(audits).toHaveLength(1);
    expect(audits[0]!.subtype).toBe("pair.restored");

    // Redis was hydrated.
    const credsCt = await testRedis.client.get(`wpa:wa-session:${userId}:creds`);
    expect(credsCt).toBeTruthy();
  }, 60_000);

  it("resumePaired is NOT called when authState blob is corrupt (error path unchanged)", async () => {
    const user = await seedUser(testDb.prisma, {
      email: "ib2-corrupt@example.com",
      role: "user",
      password: "password1234567890",
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
        authState: Buffer.from("not-valid-json", "utf8"),
      },
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
    expect(pair.resumes).toHaveLength(0);
    expect(pair.starts).toHaveLength(0);
  }, 60_000);
});
