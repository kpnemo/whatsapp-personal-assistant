import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { encryptWithKey, parseCiphertext, serializeCiphertext, unwrapDek } from "@wpa/shared";
import {
  TEST_MASTER_KEY,
  makeTestDb,
  makeTestRedis,
  seedUser,
  withAuth,
  type TestDb,
  type TestRedis,
} from "@wpa/test-utils";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let tmpMediaDir: string;

async function bootstrap(): Promise<{ app: Express; db: TestDb; redis: TestRedis }> {
  const db = await makeTestDb();
  const redis = await makeTestRedis();
  tmpMediaDir = await fs.mkdtemp(path.join(os.tmpdir(), "wpa-media-test-"));
  process.env.DATABASE_URL = db.url;
  process.env.REDIS_URL = redis.url;
  process.env.MEDIA_DIR = tmpMediaDir;
  const { createApp } = await import("../app.js");
  return { app: createApp(), db, redis };
}

/** Encrypt a string with a DEK and return Prisma-ready Bytes. */
function encryptField(dek: Buffer, value: string): Buffer {
  return Buffer.from(serializeCiphertext(encryptWithKey(dek, value)));
}

function getUserDek(encryptedDek: Buffer): Buffer {
  const wrapped = parseCiphertext(encryptedDek.toString("utf8"));
  return unwrapDek(TEST_MASTER_KEY, wrapped);
}

describe("GET /api/media/:messageId", () => {
  let app: Express;
  let db: TestDb;
  let redis: TestRedis;

  beforeAll(async () => {
    const b = await bootstrap();
    app = b.app;
    db = b.db;
    redis = b.redis;
  }, 180_000);

  afterAll(async () => {
    const { disconnectPrisma } = await import("@wpa/db");
    const { disconnectRedis } = await import("../redis.js");
    await disconnectPrisma();
    await disconnectRedis();
    if (db) await db.teardown();
    if (redis) await redis.teardown();
    if (tmpMediaDir) await fs.rm(tmpMediaDir, { recursive: true, force: true });
  }, 60_000);

  it("returns 401 without auth", async () => {
    const res = await request(app).get("/api/media/some-id");
    expect(res.status).toBe(401);
  });

  it("returns 404 for a message owned by another user", async () => {
    const userA = await seedUser(db.prisma, {
      email: "media-iso-a@example.com",
      role: "user",
      password: "correct-horse-battery-staple",
    });
    const userB = await seedUser(db.prisma, {
      email: "media-iso-b@example.com",
      role: "user",
      password: "correct-horse-battery-staple",
    });
    const dekB = getUserDek(userB.encryptedDek);

    const conv = await db.prisma.conversation.create({
      data: { userId: userB.id, jid: "media-iso@s.whatsapp.net", type: "dm" },
    });

    const msg = await db.prisma.message.create({
      data: {
        conversationId: conv.id,
        waMessageId: "media-iso-wamsg",
        fromJid: "media-iso@s.whatsapp.net",
        direction: "in",
        timestamp: new Date(),
        body: encryptField(dekB, JSON.stringify({ kind: "image" })),
        mediaRef: "media-iso-file.enc",
        mediaMime: "image/png",
      },
    });

    const agentA = await withAuth(app, { user: { id: userA.id, role: "user" } });
    const res = await agentA.get(`/api/media/${msg.id}`);
    expect(res.status).toBe(404);
  });

  it("returns 404 when message has no mediaRef", async () => {
    const user = await seedUser(db.prisma, {
      email: "media-nomedia@example.com",
      role: "user",
      password: "correct-horse-battery-staple",
    });
    const dek = getUserDek(user.encryptedDek);

    const conv = await db.prisma.conversation.create({
      data: { userId: user.id, jid: "nomedia@s.whatsapp.net", type: "dm" },
    });

    const msg = await db.prisma.message.create({
      data: {
        conversationId: conv.id,
        waMessageId: "nomedia-wamsg",
        fromJid: "nomedia@s.whatsapp.net",
        direction: "in",
        timestamp: new Date(),
        body: encryptField(dek, JSON.stringify({ kind: "text", text: "no media" })),
        // No mediaRef
      },
    });

    const agent = await withAuth(app, { user: { id: user.id, role: "user" } });
    const res = await agent.get(`/api/media/${msg.id}`);
    expect(res.status).toBe(404);
  });

  it("returns 200 with correct Content-Type from mediaMime", async () => {
    const user = await seedUser(db.prisma, {
      email: "media-ct@example.com",
      role: "user",
      password: "correct-horse-battery-staple",
    });
    const dek = getUserDek(user.encryptedDek);

    // Convention: base64-encode bytes before encrypting (mirrors worker ingest/media.ts).
    const rawBytes = Buffer.from("fake-jpeg-bytes");
    const encryptedBlob = Buffer.from(
      serializeCiphertext(encryptWithKey(dek, rawBytes.toString("base64"))),
    );
    const mediaRef = "media-ct-file.enc";
    await fs.writeFile(path.join(tmpMediaDir, mediaRef), encryptedBlob);

    const conv = await db.prisma.conversation.create({
      data: { userId: user.id, jid: "media-ct@s.whatsapp.net", type: "dm" },
    });

    const msg = await db.prisma.message.create({
      data: {
        conversationId: conv.id,
        waMessageId: "media-ct-wamsg",
        fromJid: "media-ct@s.whatsapp.net",
        direction: "in",
        timestamp: new Date(),
        body: encryptField(dek, JSON.stringify({ kind: "image" })),
        mediaRef,
        mediaMime: "image/jpeg",
      },
    });

    const agent = await withAuth(app, { user: { id: user.id, role: "user" } });
    const res = await agent.get(`/api/media/${msg.id}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("image/jpeg");
  });

  it("response body matches original plaintext (round-trip encrypt → write → route → decrypt)", async () => {
    const user = await seedUser(db.prisma, {
      email: "media-roundtrip@example.com",
      role: "user",
      password: "correct-horse-battery-staple",
    });
    const dek = getUserDek(user.encryptedDek);

    // Convention: base64-encode bytes before encrypting (mirrors worker ingest/media.ts).
    const originalBytes = Buffer.from("round-trip-test-payload");
    const encryptedBlob = Buffer.from(
      serializeCiphertext(encryptWithKey(dek, originalBytes.toString("base64"))),
    );
    const mediaRef = "media-roundtrip-file.enc";
    await fs.writeFile(path.join(tmpMediaDir, mediaRef), encryptedBlob);

    const conv = await db.prisma.conversation.create({
      data: { userId: user.id, jid: "roundtrip@s.whatsapp.net", type: "dm" },
    });

    const msg = await db.prisma.message.create({
      data: {
        conversationId: conv.id,
        waMessageId: "roundtrip-wamsg",
        fromJid: "roundtrip@s.whatsapp.net",
        direction: "in",
        timestamp: new Date(),
        body: encryptField(dek, JSON.stringify({ kind: "document" })),
        mediaRef,
        mediaMime: "text/plain",
      },
    });

    const agent = await withAuth(app, { user: { id: user.id, role: "user" } });
    const res = await agent
      .get(`/api/media/${msg.id}`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(Buffer.from(res.body as Buffer)).toEqual(originalBytes);
  });

  it("Cache-Control includes 'private'", async () => {
    const user = await seedUser(db.prisma, {
      email: "media-cc@example.com",
      role: "user",
      password: "correct-horse-battery-staple",
    });
    const dek = getUserDek(user.encryptedDek);

    // Convention: base64-encode bytes before encrypting (mirrors worker ingest/media.ts).
    const encryptedBlob = Buffer.from(
      serializeCiphertext(
        encryptWithKey(dek, Buffer.from("cache-control-test").toString("base64")),
      ),
    );
    const mediaRef = "media-cc-file.enc";
    await fs.writeFile(path.join(tmpMediaDir, mediaRef), encryptedBlob);

    const conv = await db.prisma.conversation.create({
      data: { userId: user.id, jid: "cache-cc@s.whatsapp.net", type: "dm" },
    });

    const msg = await db.prisma.message.create({
      data: {
        conversationId: conv.id,
        waMessageId: "cc-wamsg",
        fromJid: "cache-cc@s.whatsapp.net",
        direction: "in",
        timestamp: new Date(),
        body: encryptField(dek, JSON.stringify({ kind: "audio" })),
        mediaRef,
        mediaMime: "audio/ogg",
      },
    });

    const agent = await withAuth(app, { user: { id: user.id, role: "user" } });
    const res = await agent.get(`/api/media/${msg.id}`);
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toContain("private");
  });

  it("round-trips binary bytes (base64 convention)", async () => {
    const user = await seedUser(db.prisma, {
      email: "media-binary@example.com",
      role: "user",
      password: "correct-horse-battery-staple",
    });
    const dek = getUserDek(user.encryptedDek);

    // 10 bytes spanning 0x00 - 0xFF — proves base64 round-trip works for binary data.
    const binaryBytes = Buffer.from([0, 127, 128, 200, 255, 10, 20, 30, 40, 50]);
    const encryptedBlob = Buffer.from(
      serializeCiphertext(encryptWithKey(dek, binaryBytes.toString("base64"))),
    );
    const mediaRef = "media-binary-file.enc";
    await fs.writeFile(path.join(tmpMediaDir, mediaRef), encryptedBlob);

    const conv = await db.prisma.conversation.create({
      data: { userId: user.id, jid: "binary@s.whatsapp.net", type: "dm" },
    });

    const msg = await db.prisma.message.create({
      data: {
        conversationId: conv.id,
        waMessageId: "binary-wamsg",
        fromJid: "binary@s.whatsapp.net",
        direction: "in",
        timestamp: new Date(),
        body: encryptField(dek, JSON.stringify({ kind: "image" })),
        mediaRef,
        mediaMime: "image/png",
      },
    });

    const agent = await withAuth(app, { user: { id: user.id, role: "user" } });
    const res = await agent
      .get(`/api/media/${msg.id}`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(Buffer.from(res.body as Buffer)).toEqual(binaryBytes);
  });
});
