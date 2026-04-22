import { getPrisma } from "@wpa/db";
import { decryptWithKey, parseCiphertext, unwrapDek } from "@wpa/shared";
import { type Request, Router } from "express";
import { z } from "zod";

import { env } from "../env.js";
import { logger } from "../logger.js";
import { type AuthedResponse, requireAuth } from "../middleware/auth.js";

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.string().datetime({ offset: true }).optional(),
});

interface MessageShape {
  id: string;
  waMessageId: string;
  fromJid: string;
  senderName?: string;
  direction: "in" | "out";
  timestamp: string;
  body: unknown;
  hasMedia: boolean;
}

/**
 * Unwrap the DEK for a given userId. Throws on failure.
 */
async function getUserDek(userId: string): Promise<Buffer> {
  const prisma = getPrisma();
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { encryptedDek: true },
  });
  const wrapped = parseCiphertext(Buffer.from(user.encryptedDek).toString("utf8"));
  return unwrapDek(env.MASTER_KEY_BYTES, wrapped);
}

/**
 * Decrypt a message body Bytes field into the JSON object it encodes.
 */
function decryptBody(dek: Buffer, bodyBytes: Buffer): unknown {
  const plain = decryptWithKey(dek, parseCiphertext(bodyBytes.toString("utf8")));
  return JSON.parse(plain) as unknown;
}

/**
 * Build the API message shape from a raw DB row + optional dek.
 */
function shapeMessage(
  row: {
    id: string;
    waMessageId: string;
    fromJid: string;
    direction: "in" | "out";
    timestamp: Date;
    body: Buffer;
    mediaRef: string | null;
  },
  dek: Buffer,
  senderName?: string,
): MessageShape {
  let body: unknown;
  try {
    body = decryptBody(dek, Buffer.from(row.body));
  } catch {
    body = null;
  }

  const msg: MessageShape = {
    id: row.id,
    waMessageId: row.waMessageId,
    fromJid: row.fromJid,
    direction: row.direction,
    timestamp: row.timestamp.toISOString(),
    body,
    hasMedia: row.mediaRef !== null,
  };
  if (senderName !== undefined) msg.senderName = senderName;
  return msg;
}

export function messagesRouter(): Router {
  const r = Router();

  /**
   * GET /conversations/:id/messages
   * Paginated list of messages for a conversation.
   */
  r.get("/conversations/:id/messages", requireAuth, async (req: Request, res: AuthedResponse) => {
    const userId = res.locals.user?.sub;
    if (!userId) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_query" });
      return;
    }

    const { limit, before } = parsed.data;
    const conversationId = req.params.id as string;

    const prisma = getPrisma();

    // Ownership check — 404 on wrong user (don't leak existence via 403).
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, userId },
    });
    if (!conversation) {
      res.status(404).json({ error: "not_found" });
      return;
    }

    let dek: Buffer;
    try {
      dek = await getUserDek(userId);
    } catch (err) {
      logger.error({ err, userId }, "messages list: DEK unwrap failed");
      res.status(500).json({ error: "internal_error" });
      return;
    }

    const rows = await prisma.message.findMany({
      where: {
        conversationId,
        ...(before ? { timestamp: { lt: new Date(before) } } : {}),
      },
      orderBy: { timestamp: "desc" },
      take: limit + 1,
      select: {
        id: true,
        waMessageId: true,
        fromJid: true,
        direction: true,
        timestamp: true,
        body: true,
        mediaRef: true,
      },
    });

    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);

    // Batch-fetch contact names for fromJids in this page.
    const fromJids = [...new Set(page.map((m) => m.fromJid))];
    const contacts = await prisma.waContact.findMany({
      where: { userId, jid: { in: fromJids } },
      select: { jid: true, name: true },
    });
    const contactMap = new Map(contacts.map((c) => [c.jid, c]));

    const messages = page.map((row) => {
      let senderName: string | undefined;
      const contact = contactMap.get(row.fromJid);
      if (contact?.name) {
        try {
          senderName = decryptWithKey(
            dek,
            parseCiphertext(Buffer.from(contact.name).toString("utf8")),
          );
        } catch {
          // Omit senderName on decrypt failure
        }
      }
      return shapeMessage(
        { ...row, body: Buffer.from(row.body), mediaRef: row.mediaRef },
        dek,
        senderName,
      );
    });

    res.json({ messages, hasMore });
  });

  /**
   * GET /messages/:id
   * Single message by id.
   */
  r.get("/messages/:id", requireAuth, async (req: Request, res: AuthedResponse) => {
    const userId = res.locals.user?.sub;
    if (!userId) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    const messageId = req.params.id as string;
    const prisma = getPrisma();

    // Ownership check via join: messages → conversations → userId.
    const row = await prisma.message.findFirst({
      where: {
        id: messageId,
        conversation: { userId },
      },
      select: {
        id: true,
        waMessageId: true,
        fromJid: true,
        direction: true,
        timestamp: true,
        body: true,
        mediaRef: true,
      },
    });

    if (!row) {
      res.status(404).json({ error: "not_found" });
      return;
    }

    let dek: Buffer;
    try {
      dek = await getUserDek(userId);
    } catch (err) {
      logger.error({ err, userId }, "messages get: DEK unwrap failed");
      res.status(500).json({ error: "internal_error" });
      return;
    }

    // Try to resolve sender name.
    let senderName: string | undefined;
    const contact = await prisma.waContact.findUnique({
      where: { userId_jid: { userId, jid: row.fromJid } },
      select: { name: true },
    });
    if (contact?.name) {
      try {
        senderName = decryptWithKey(
          dek,
          parseCiphertext(Buffer.from(contact.name).toString("utf8")),
        );
      } catch {
        // Omit senderName on decrypt failure
      }
    }

    res.json(
      shapeMessage(
        { ...row, body: Buffer.from(row.body), mediaRef: row.mediaRef },
        dek,
        senderName,
      ),
    );
  });

  return r;
}
