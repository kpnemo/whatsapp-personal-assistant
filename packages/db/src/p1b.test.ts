import { makeTestDb, type TestDb } from "@wpa/test-utils";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("P1-B schema", () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await makeTestDb();
  }, 180_000);

  afterAll(async () => {
    await db.teardown();
  }, 60_000);

  it("round-trips a full conversation + message + contact", async () => {
    const prisma = db.prisma;
    const user = await prisma.user.create({
      data: {
        email: "ingest-test@example.com",
        passwordHash: "x",
        encryptedDek: Buffer.from("not-a-real-dek"),
      },
    });

    const contact = await prisma.waContact.create({
      data: {
        userId: user.id,
        jid: "447700900123@s.whatsapp.net",
        name: Buffer.from("ciphertext-placeholder"),
      },
    });

    const conversation = await prisma.conversation.create({
      data: {
        userId: user.id,
        jid: contact.jid,
        type: "dm",
        lastMessageAt: new Date(),
      },
    });

    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        waMessageId: "WAMSG-001",
        fromJid: contact.jid,
        direction: "in",
        timestamp: new Date(),
        body: Buffer.from("encrypted-body-placeholder"),
      },
    });

    const fetched = await prisma.message.findUnique({ where: { id: message.id } });
    expect(fetched?.waMessageId).toBe("WAMSG-001");
    expect(fetched?.direction).toBe("in");
  });

  it("cascades delete from User → Conversation → Message", async () => {
    const prisma = db.prisma;
    const user = await prisma.user.create({
      data: {
        email: "cascade@example.com",
        passwordHash: "x",
        encryptedDek: Buffer.from("x"),
      },
    });
    const conv = await prisma.conversation.create({
      data: { userId: user.id, jid: "1@g.us", type: "group" },
    });
    await prisma.message.create({
      data: {
        conversationId: conv.id,
        waMessageId: "M1",
        fromJid: "x@s.whatsapp.net",
        direction: "in",
        timestamp: new Date(),
        body: Buffer.from("x"),
      },
    });

    await prisma.user.delete({ where: { id: user.id } });

    const surviving = await prisma.message.findMany({
      where: { conversationId: conv.id },
    });
    expect(surviving).toEqual([]);
  });

  it("enforces unique (userId, jid) on Conversation", async () => {
    const prisma = db.prisma;
    const user = await prisma.user.create({
      data: {
        email: "uniq@example.com",
        passwordHash: "x",
        encryptedDek: Buffer.from("x"),
      },
    });
    await prisma.conversation.create({
      data: { userId: user.id, jid: "dup@s.whatsapp.net", type: "dm" },
    });
    await expect(
      prisma.conversation.create({
        data: { userId: user.id, jid: "dup@s.whatsapp.net", type: "dm" },
      }),
    ).rejects.toThrow(/unique constraint/i);
  });
});
