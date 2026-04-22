/**
 * End-to-end integration test for the ingest pipeline (Epic IB3).
 *
 * Flow under test:
 *   fake socket emits messages.upsert
 *   → subscribe() XADDs to wpa:msg:ingest:<userId>
 *   → startConsumer() normalizes + persists
 *   → Message row in DB + Pub/Sub event on ui:events:<userId>
 */
import { EventEmitter } from "node:events";

import type { WASocket } from "@whiskeysockets/baileys";
import {
  generateKey,
  parseCiphertext,
  decryptWithKey,
  serializeCiphertext,
  wrapDek,
} from "@wpa/shared";
import {
  makeTestDb,
  makeTestRedis,
  seedUser,
  TEST_MASTER_KEY,
  type TestDb,
  type TestRedis,
} from "@wpa/test-utils";
import { pino } from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { startConsumer } from "./consume.js";
import { subscribe } from "./subscribe.js";

const silentLogger = pino({ level: "silent" });

const TEST_DEK = generateKey();

/**
 * Build a minimal fake WASocket whose `ev` is a simple EventEmitter.
 * Matches the subset of WASocket that subscribe() and tests need.
 */
function makeFakeSocket(): WASocket {
  const emitter = new EventEmitter();
  return {
    ev: {
      on: (event: string, handler: (...args: unknown[]) => void) => {
        emitter.on(event, handler);
        return emitter as unknown as WASocket["ev"];
      },
      off: (event: string, handler: (...args: unknown[]) => void) => {
        emitter.off(event, handler);
        return emitter as unknown as WASocket["ev"];
      },
      emit: (event: string, ...args: unknown[]) => {
        return emitter.emit(event, ...args);
      },
    },
    // Minimal stubs — subscribe only touches ev
  } as unknown as WASocket;
}

describe.sequential("ingest pipeline — end-to-end integration", () => {
  let testDb: TestDb;
  let testRedis: TestRedis;
  let userId: string;

  beforeAll(async () => {
    testDb = await makeTestDb();
    testRedis = await makeTestRedis();
  }, 180_000);

  afterAll(async () => {
    if (testDb) await testDb.teardown();
    if (testRedis) await testRedis.teardown();
  }, 60_000);

  beforeEach(async () => {
    await testDb.prisma.message.deleteMany();
    await testDb.prisma.conversation.deleteMany();
    await testDb.prisma.waContact.deleteMany();
    await testDb.prisma.waGroup.deleteMany();
    await testDb.prisma.auditLog.deleteMany();
    await testDb.prisma.whatsappSession.deleteMany();
    await testDb.prisma.user.deleteMany();
    await testRedis.client.flushdb();

    const user = await seedUser(testDb.prisma, {
      email: "integration-ingest@example.com",
      role: "user",
      password: "password1234567890",
    });
    userId = user.id;

    // Store the known DEK (overwrite the one from seedUser with our test DEK).
    const wrapped = wrapDek(TEST_MASTER_KEY, TEST_DEK);
    await testDb.prisma.user.update({
      where: { id: userId },
      data: { encryptedDek: Buffer.from(serializeCiphertext(wrapped)) },
    });
  });

  it("text DM: fake socket emit → Message row in DB + Pub/Sub event", async () => {
    const fakeSock = makeFakeSocket();

    // Subscribe to Pub/Sub BEFORE emitting.
    const subClient = testRedis.client.duplicate();
    const received: string[] = [];
    await subClient.subscribe(`ui:events:${userId}`);
    subClient.on("message", (_ch: string, msg: string) => {
      received.push(msg);
    });

    // Wire the ingest subscription.
    subscribe(userId, fakeSock, testRedis.client, silentLogger);

    // Start the consumer.
    const consumer = await startConsumer({
      userId,
      prisma: testDb.prisma,
      redis: testRedis.client,
      dek: TEST_DEK,
      masterKey: TEST_MASTER_KEY,
      logger: silentLogger,
    });

    // Emit a raw messages.upsert event on the fake socket.
    fakeSock.ev.emit("messages.upsert", {
      messages: [
        {
          key: {
            remoteJid: "5559876543@s.whatsapp.net",
            fromMe: false,
            id: "e2e-test-msg-001",
          },
          message: { conversation: "end to end test message" },
          messageTimestamp: 1_700_000_000,
        },
      ],
      type: "notify",
    });

    // Poll for the message row to appear (consumer loop has up to 5s BLOCK).
    // Give up to 15s total before stopping the consumer.
    const deadline = Date.now() + 15_000;
    let found = false;
    while (Date.now() < deadline) {
      const rows = await testDb.prisma.message.findMany({
        where: { waMessageId: "e2e-test-msg-001" },
      });
      if (rows.length > 0) {
        found = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 200));
    }

    consumer.stop();
    await consumer.done;

    await subClient.unsubscribe();
    subClient.disconnect();

    // Assert Message row exists in DB.
    expect(found).toBe(true);
    const messages = await testDb.prisma.message.findMany({
      where: { waMessageId: "e2e-test-msg-001" },
    });
    expect(messages).toHaveLength(1);

    // Verify body is encrypted and decryptable.
    const msg = messages[0]!;
    const bodyStr = Buffer.from(msg.body).toString("utf8");
    const ct = parseCiphertext(bodyStr);
    const decrypted = decryptWithKey(TEST_DEK, ct);
    const body = JSON.parse(decrypted) as { kind: string; text: string };
    expect(body.kind).toBe("text");
    expect(body.text).toBe("end to end test message");

    // Assert Pub/Sub notification was received.
    expect(received.length).toBeGreaterThanOrEqual(1);
    const event = JSON.parse(received[0]!) as {
      type: string;
      conversationId: string;
      messageId: string;
    };
    expect(event.type).toBe("message.created");
    expect(typeof event.conversationId).toBe("string");
    expect(event.messageId).toBe(msg.id);
  }, 90_000);

  it("broadcast messages are silently dropped (not persisted)", async () => {
    const fakeSock = makeFakeSocket();
    subscribe(userId, fakeSock, testRedis.client, silentLogger);

    const consumer = await startConsumer({
      userId,
      prisma: testDb.prisma,
      redis: testRedis.client,
      dek: TEST_DEK,
      masterKey: TEST_MASTER_KEY,
      logger: silentLogger,
    });

    // Emit a broadcast message — shouldIngest rejects these before XADD.
    fakeSock.ev.emit("messages.upsert", {
      messages: [
        {
          key: {
            remoteJid: "status@broadcast",
            fromMe: false,
            id: "broadcast-msg-001",
          },
          message: { conversation: "status update" },
          messageTimestamp: 1_700_000_001,
        },
      ],
      type: "notify",
    });

    await new Promise((r) => setTimeout(r, 300));

    consumer.stop();
    await consumer.done;

    const messages = await testDb.prisma.message.findMany();
    expect(messages).toHaveLength(0);
  }, 60_000);
});
