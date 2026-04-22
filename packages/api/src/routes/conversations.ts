import { getPrisma } from "@wpa/db";
import { decryptWithKey, parseCiphertext, unwrapDek } from "@wpa/shared";
import { type Request, Router } from "express";
import { z } from "zod";

import { env } from "../env.js";
import { logger } from "../logger.js";
import { type AuthedResponse, requireAuth } from "../middleware/auth.js";
import { createRateLimiter } from "../middleware/rate-limit.js";
import { getRedis } from "../redis.js";

/** Opaque base64url compound cursor — encodes { ts, id } for tie-safe pagination. */
interface DecodedCursor {
  ts: string | null;
  id: string;
}

function encodeCursor(ts: Date | null, id: string): string {
  const payload = JSON.stringify({ ts: ts?.toISOString() ?? null, id });
  return Buffer.from(payload).toString("base64url");
}

function decodeCursor(raw: string): DecodedCursor | null {
  try {
    const payload = Buffer.from(raw, "base64url").toString("utf8");
    const parsed = JSON.parse(payload) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("id" in parsed) ||
      typeof (parsed as Record<string, unknown>).id !== "string"
    ) {
      return null;
    }
    const obj = parsed as Record<string, unknown>;
    const rawTs = obj.ts;
    const ts =
      rawTs === null || rawTs === undefined ? null : typeof rawTs === "string" ? rawTs : null;
    return { ts, id: obj.id as string };
  } catch {
    return null;
  }
}

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

export function conversationsRouter(): Router {
  const r = Router();

  const listLimiter = createRateLimiter({
    redis: getRedis(),
    keyPrefix: "rl:conversations:list",
    points: 60,
    duration: 60,
    keyBy: "user",
  });

  r.get("/conversations", requireAuth, listLimiter, async (req: Request, res: AuthedResponse) => {
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

    const { limit, cursor: rawCursor } = parsed.data;

    // Decode compound cursor if provided.
    let cursor: DecodedCursor | null = null;
    if (rawCursor !== undefined) {
      cursor = decodeCursor(rawCursor);
      if (cursor === null) {
        res.status(400).json({ error: "invalid_cursor" });
        return;
      }
    }

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
    // The compound cursor encodes both lastMessageAt and id for tie-safe pagination.
    // Order is DESC nulls-last on lastMessageAt, then ASC on id for ties.
    // Cursor WHERE: rows that come AFTER the cursor in that ordering.
    const rows = await prisma.conversation.findMany({
      where: {
        userId,
        ...(cursor
          ? {
              OR: [
                // Rows with a strictly older lastMessageAt (null comes last so excluded here).
                ...(cursor.ts !== null ? [{ lastMessageAt: { lt: new Date(cursor.ts) } }] : []),
                // Rows tied on lastMessageAt with a higher id (tie-break by id ASC).
                ...(cursor.ts !== null
                  ? [
                      {
                        AND: [
                          { lastMessageAt: { equals: new Date(cursor.ts) } },
                          { id: { gt: cursor.id } },
                        ],
                      },
                    ]
                  : []),
                // When cursor.ts is null, only null rows with higher id remain.
                ...(cursor.ts === null ? [{ lastMessageAt: null, id: { gt: cursor.id } }] : []),
              ],
            }
          : {}),
      },
      orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }, { id: "asc" }],
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

    const lastRow = page[page.length - 1];
    const nextCursor =
      hasMore && lastRow ? encodeCursor(lastRow.lastMessageAt ?? null, lastRow.id) : null;

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
