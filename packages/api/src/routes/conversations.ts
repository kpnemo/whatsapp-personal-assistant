import { getPrisma } from "@wpa/db";
import { decryptWithKey, parseCiphertext, unwrapDek } from "@wpa/shared";
import { type Request, Router } from "express";
import { z } from "zod";

import { env } from "../env.js";
import { logger } from "../logger.js";
import { type AuthedResponse, requireAuth } from "../middleware/auth.js";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().datetime({ offset: true }).optional(),
});

export function conversationsRouter(): Router {
  const r = Router();

  r.get("/conversations", requireAuth, async (req: Request, res: AuthedResponse) => {
    const userId = res.locals.user?.sub;
    if (!userId) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_query" });
      return;
    }

    const { limit, cursor } = parsed.data;

    const prisma = getPrisma();

    // Unwrap user DEK for decrypting contact names / group subjects.
    let dek: Buffer;
    try {
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { encryptedDek: true },
      });
      const wrapped = parseCiphertext(Buffer.from(user.encryptedDek).toString("utf8"));
      dek = unwrapDek(env.MASTER_KEY_BYTES, wrapped);
    } catch (err) {
      logger.error({ err, userId }, "conversations: DEK unwrap failed");
      res.status(500).json({ error: "internal_error" });
      return;
    }

    // Fetch limit+1 to determine if there's a next page.
    const rows = await prisma.conversation.findMany({
      where: {
        userId,
        ...(cursor ? { lastMessageAt: { lt: new Date(cursor) } } : {}),
      },
      orderBy: [{ lastMessageAt: "desc" }, { id: "asc" }],
      take: limit + 1,
    });

    // Fetch WaContact / WaGroup for each conversation in one shot each.
    const jids = rows.map((c) => c.jid);
    const [contacts, groups] = await Promise.all([
      prisma.waContact.findMany({
        where: { userId, jid: { in: jids } },
        select: { jid: true, name: true },
      }),
      prisma.waGroup.findMany({
        where: { userId, jid: { in: jids } },
        select: { jid: true, subject: true },
      }),
    ]);

    const contactMap = new Map(contacts.map((c) => [c.jid, c]));
    const groupMap = new Map(groups.map((g) => [g.jid, g]));

    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);

    const conversations = page.map((conv) => {
      let title: string;
      let subtitle: string | undefined;

      if (conv.type === "dm") {
        const contact = contactMap.get(conv.jid);
        if (contact?.name) {
          try {
            title = decryptWithKey(
              dek,
              parseCiphertext(Buffer.from(contact.name).toString("utf8")),
            );
          } catch {
            // Fallback to jid if decrypt fails
            title = formatJid(conv.jid);
          }
        } else {
          title = formatJid(conv.jid);
          subtitle = "not in contacts";
        }
      } else {
        const group = groupMap.get(conv.jid);
        if (group?.subject) {
          try {
            title = decryptWithKey(
              dek,
              parseCiphertext(Buffer.from(group.subject).toString("utf8")),
            );
          } catch {
            title = "Group";
          }
        } else {
          title = "Group";
        }
        // NOTE: member count is not tracked in the schema (P1-B). Subtitle omitted for groups.
        // Future: subtitle = `"N members"` once member count is stored.
      }

      const result: {
        id: string;
        jid: string;
        type: "dm" | "group";
        lastMessageAt: string | null;
        title: string;
        subtitle?: string;
      } = {
        id: conv.id,
        jid: conv.jid,
        type: conv.type,
        lastMessageAt: conv.lastMessageAt?.toISOString() ?? null,
        title,
      };
      if (subtitle !== undefined) result.subtitle = subtitle;
      return result;
    });

    const nextCursor = hasMore
      ? (page[page.length - 1]?.lastMessageAt?.toISOString() ?? null)
      : null;

    res.json({ conversations, nextCursor });
  });

  return r;
}

/**
 * Format a WhatsApp JID as a human-readable phone number fallback.
 * e.g. "447700900123@s.whatsapp.net" → "+447700900123"
 */
function formatJid(jid: string): string {
  const local = jid.split("@")[0] ?? jid;
  // Only prepend "+" if it looks like a numeric phone number
  if (/^\d+$/.test(local)) {
    return `+${local}`;
  }
  return local;
}
