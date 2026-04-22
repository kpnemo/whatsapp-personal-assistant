import { Prisma, type PrismaClient } from "@wpa/db";
import { encryptWithKey, serializeCiphertext } from "@wpa/shared";
import type { Redis } from "ioredis";

import type { NormalizedMessage } from "./normalize.js";

export interface PersistDeps {
  prisma: PrismaClient;
  dek: Buffer;
  redis: Redis;
  enqueueMedia?: (input: {
    messageId: string;
    userId: string;
    normalized: NormalizedMessage;
  }) => void;
}

/**
 * Persist a normalized message to Postgres and publish a Pub/Sub notification.
 *
 * Idempotent on (conversationId, waMessageId): if the message already exists
 * in the DB, returns without creating a duplicate.
 *
 * Flow:
 * 1. Upsert WaContact (DM) or WaGroup (group).
 * 2. Upsert Conversation, bump lastMessageAt.
 * 3. Encrypt body JSON with DEK.
 * 4. Check idempotency — bail early if message already exists.
 * 5. Create Message row.
 * 6. Call enqueueMedia if mediaMeta present.
 * 7. Publish to `ui:events:<userId>`.
 */
export async function persist(
  userId: string,
  normalized: NormalizedMessage,
  deps: PersistDeps,
): Promise<void> {
  const { prisma, dek, redis, enqueueMedia } = deps;

  // 1. Upsert contact or group
  if (normalized.conversationType === "dm") {
    await prisma.waContact.upsert({
      where: { userId_jid: { userId, jid: normalized.conversationJid } },
      create: { userId, jid: normalized.conversationJid },
      update: {},
    });
  } else {
    await prisma.waGroup.upsert({
      where: { userId_jid: { userId, jid: normalized.conversationJid } },
      create: {
        userId,
        jid: normalized.conversationJid,
        subject: Buffer.from(""),
      },
      update: {},
    });
  }

  // 2. Upsert Conversation
  const conversation = await prisma.conversation.upsert({
    where: { userId_jid: { userId, jid: normalized.conversationJid } },
    create: {
      userId,
      jid: normalized.conversationJid,
      type: normalized.conversationType === "group" ? "group" : "dm",
      lastMessageAt: normalized.timestamp,
    },
    update: {
      lastMessageAt: normalized.timestamp,
    },
    select: { id: true },
  });

  // 3. Encrypt body JSON
  const bodyJson = JSON.stringify(normalized.body);
  const encryptedBody = Buffer.from(serializeCiphertext(encryptWithKey(dek, bodyJson)));

  // 4. Idempotency check
  const existing = await prisma.message.findUnique({
    where: {
      conversationId_waMessageId: {
        conversationId: conversation.id,
        waMessageId: normalized.waMessageId,
      },
    },
    select: { id: true },
  });
  if (existing) {
    return;
  }

  // 5. Create Message (with TOCTOU race guard: catch P2002 as idempotent duplicate)
  let message: { id: string };
  try {
    message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        waMessageId: normalized.waMessageId,
        fromJid: normalized.fromJid,
        direction: normalized.direction,
        timestamp: normalized.timestamp,
        body: encryptedBody,
      },
      select: { id: true },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      // Duplicate — another worker already inserted this waMessageId concurrently.
      // Treat as idempotent success; don't re-enqueue media or double-publish.
      return;
    }
    throw err;
  }

  // 6. Media enqueue
  if (normalized.body.mediaMeta && enqueueMedia) {
    enqueueMedia({ messageId: message.id, userId, normalized });
  }

  // 7. Publish Pub/Sub notification
  const event = JSON.stringify({
    type: "message.created",
    conversationId: conversation.id,
    messageId: message.id,
    timestamp: normalized.timestamp.toISOString(),
  });
  await redis.publish(`ui:events:${userId}`, event);
}
