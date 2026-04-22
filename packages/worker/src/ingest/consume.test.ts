/**
 * Unit/integration tests for startConsumer() — retry counter lifecycle (C2).
 *
 * Uses a real Redis testcontainer. Prisma is stubbed so we can control
 * failures without a DB container.
 *
 * Note on delivery semantics: xreadgroup with ">" only delivers new
 * (undelivered) entries added AFTER the consumer group is created with "$".
 * Tests must push entries AFTER startConsumer returns (i.e. after ensureGroup
 * has run) to ensure the consumer picks them up.
 *
 * dlqMaxDeliveries=1 is used for failure tests so the single delivery
 * triggers the DLQ path immediately (re-delivery requires XAUTOCLAIM/"0"
 * sweep, which this consumer does not implement).
 */
import { makeTestRedis, type TestRedis } from "@wpa/test-utils";
import { pino } from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { startConsumer } from "./consume.js";
import { ingestStreamKey } from "./subscribe.js";

const silentLogger = pino({ level: "silent" });

/** Unique userId per test to avoid cross-test key collisions. */
let testCounter = 0;
function nextUserId(): string {
  return `consume-test-user-${(++testCounter).toString()}`;
}

const TEST_DEK = Buffer.alloc(32, 2);
const TEST_MASTER_KEY = Buffer.alloc(32, 1);

/** Build a minimal stub that satisfies PrismaClient structurally for startConsumer. */
function makePrismaStub(messageCreateImpl: () => Promise<{ id: string }>) {
  return {
    waContact: { upsert: vi.fn().mockResolvedValue({}) },
    waGroup: { upsert: vi.fn().mockResolvedValue({}) },
    conversation: { upsert: vi.fn().mockResolvedValue({ id: "stub-conv-id" }) },
    message: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(messageCreateImpl),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
}

/**
 * Push a raw ingest entry onto the stream and return the entry id.
 * Must be called AFTER startConsumer so that ensureGroup has created the
 * group with "$" — entries pushed before the group are invisible to ">".
 */
async function pushEntry(
  client: TestRedis["client"],
  userId: string,
  waMessageId: string,
): Promise<string> {
  const raw = JSON.stringify({
    key: {
      remoteJid: "5551234567@s.whatsapp.net",
      fromMe: false,
      id: waMessageId,
    },
    message: { conversation: "consume test body" },
    messageTimestamp: 1_700_000_000,
  });
  const id = await client.xadd(ingestStreamKey(userId), "*", "raw", raw);
  if (!id) throw new Error("xadd returned null");
  return id;
}

/** Poll condition every 100ms until it returns true or timeoutMs elapses. */
async function waitUntil(condition: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("waitUntil timed out");
}

describe.sequential("consume — retry counter lifecycle (C2)", () => {
  let testRedis: TestRedis;

  beforeAll(async () => {
    testRedis = await makeTestRedis();
  }, 120_000);

  afterAll(async () => {
    if (testRedis) await testRedis.teardown();
  }, 30_000);

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("single failure with dlqMax=1 → DLQ entry added + retry key deleted", async () => {
    const userId = nextUserId();
    const prisma = makePrismaStub(() => {
      throw new Error("simulated persist failure");
    });

    // Start consumer FIRST so ensureGroup creates the group before we push.
    const consumer = await startConsumer({
      userId,
      prisma: prisma as never,
      redis: testRedis.client,
      dek: TEST_DEK,
      masterKey: TEST_MASTER_KEY,
      logger: silentLogger,
      dlqMaxDeliveries: 1,
    });

    // Push entry AFTER the group is created.
    const entryId = await pushEntry(testRedis.client, userId, "dlq-msg-001");
    const rKey = `wpa:ingest:retry:${entryId}`;
    const dKey = `wpa:msg:dlq:${userId}`;

    // Wait for the DLQ entry to appear.
    await waitUntil(async () => {
      const len = await testRedis.client.xlen(dKey);
      return len > 0;
    }, 10_000);

    consumer.stop();
    await consumer.done;

    // DLQ has the entry.
    const dlqEntries = await testRedis.client.xrange(dKey, "-", "+");
    expect(dlqEntries.length).toBeGreaterThanOrEqual(1);

    // Retry key must be gone after DLQ move.
    const retryExists = await testRedis.client.exists(rKey);
    expect(retryExists).toBe(0);
  }, 30_000);

  it("first failure with dlqMax=2 → retry counter incremented + 24h TTL set", async () => {
    const userId = nextUserId();
    // With dlqMax=2 and ">" delivery semantics (single delivery per entry),
    // one failure sets count=1 and TTL but does NOT reach the DLQ threshold.
    const prisma = makePrismaStub(() => {
      throw new Error("transient failure");
    });

    const consumer = await startConsumer({
      userId,
      prisma: prisma as never,
      redis: testRedis.client,
      dek: TEST_DEK,
      masterKey: TEST_MASTER_KEY,
      logger: silentLogger,
      dlqMaxDeliveries: 2,
    });

    const entryId = await pushEntry(testRedis.client, userId, "ttl-msg-001");
    const rKey = `wpa:ingest:retry:${entryId}`;

    // Wait for retry key to appear (count >= 1).
    await waitUntil(async () => {
      const val = await testRedis.client.hget(rKey, "count");
      return val !== null && parseInt(val, 10) >= 1;
    }, 10_000);

    consumer.stop();
    await consumer.done;

    // TTL must be set to ~86400s.
    const ttl = await testRedis.client.ttl(rKey);
    expect(ttl).toBeGreaterThan(86_390);
    expect(ttl).toBeLessThanOrEqual(86_400);

    // Counter is 1 (not DLQ'd — only one delivery, dlqMax=2).
    const count = await testRedis.client.hget(rKey, "count");
    expect(count).toBe("1");
  }, 30_000);

  it("successful persist → retry key del'd (no-op on clean path)", async () => {
    const userId = nextUserId();
    let created = false;
    const prisma = makePrismaStub(() => {
      created = true;
      return Promise.resolve({ id: "stub-msg-id" });
    });

    const consumer = await startConsumer({
      userId,
      prisma: prisma as never,
      redis: testRedis.client,
      dek: TEST_DEK,
      masterKey: TEST_MASTER_KEY,
      logger: silentLogger,
      dlqMaxDeliveries: 3,
    });

    const entryId = await pushEntry(testRedis.client, userId, "success-msg-001");
    const rKey = `wpa:ingest:retry:${entryId}`;

    // Wait until the message has been processed.
    await waitUntil(() => Promise.resolve(created), 10_000);
    // Brief grace period for del + xack to complete.
    await new Promise((r) => setTimeout(r, 300));

    consumer.stop();
    await consumer.done;

    // del(retryKey) is called on the success path — key should not exist.
    const retryExists = await testRedis.client.exists(rKey);
    expect(retryExists).toBe(0);
  }, 30_000);
});
