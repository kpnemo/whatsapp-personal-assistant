import { getPrisma } from "@wpa/db";
import { decryptWithKey, parseCiphertext, unwrapDek } from "@wpa/shared";
import { type Request, Router } from "express";

import { writeAudit } from "../audit/writeAudit.js";
import { env } from "../env.js";
import { type AuthedResponse, requireAuth } from "../middleware/auth.js";
import { createRateLimiter } from "../middleware/rate-limit.js";
import { getRedis } from "../redis.js";

/**
 * Redis keys (must stay in lock-step with @wpa/worker):
 *   - wpa:pair-cmd              XSTREAM, consumed by worker
 *   - wpa:wa-session:{uid}:state  GET/SET string (PairState)
 *   - wpa:pair:{uid}:qr           GET/SET base64 PNG, EX 30
 */
const PAIR_CMD_STREAM = "wpa:pair-cmd";
const STATE_KEY = (userId: string): string => `wpa:wa-session:${userId}:state`;
const QR_KEY = (userId: string): string => `wpa:pair:${userId}:qr`;

/**
 * The set of states the worker publishes to `STATE_KEY(userId)`. Mirrors
 * `PairState` in @wpa/worker — kept as a local list so the API doesn't take a
 * dependency on the worker package.
 */
const PAIR_STATES = [
  "none",
  "idle",
  "generating",
  "awaiting_scan",
  "paired",
  "error",
  "expired",
] as const;
type PairStateValue = (typeof PAIR_STATES)[number];

function isPairState(s: string | null): s is PairStateValue {
  return s !== null && (PAIR_STATES as readonly string[]).includes(s);
}

export function pairRouter(): Router {
  const r = Router();
  const redis = getRedis();

  // Rate-limit /init only — status + qr are idempotent reads.
  const initLimiter = createRateLimiter({
    redis,
    keyPrefix: "rl:pair:init",
    points: 3,
    duration: 60 * 60,
    keyBy: "user",
    blockDuration: 60 * 60,
  });

  r.use("/pair", requireAuth);

  r.post("/pair/init", initLimiter, async (_req: Request, res: AuthedResponse) => {
    const userId = res.locals.user?.sub;
    if (!userId) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const prisma = getPrisma();

    // One session row per user (@@unique on userId). Upsert so /init is
    // idempotent at the DB level; the worker owns subsequent status transitions.
    await prisma.whatsappSession.upsert({
      where: { userId },
      update: { status: "pairing" },
      create: { userId, status: "pairing" },
    });

    // Publish the command onto the Redis stream the worker consumes.
    await redis.xadd(PAIR_CMD_STREAM, "*", "type", "init", "userId", userId);

    // subtype goes in encrypted details (matches worker's convention — see
    // makeWorkerAudit in @wpa/worker). targetRef is reserved for entity IDs.
    await writeAudit({ userId, type: "pair", details: { subtype: "init" } });

    const session = await prisma.whatsappSession.findUniqueOrThrow({
      where: { userId },
      select: { id: true },
    });
    res.status(201).json({ sessionId: session.id });
  });

  r.get("/pair/status", async (req: Request, res: AuthedResponse) => {
    const userId = res.locals.user?.sub;
    if (!userId) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const prisma = getPrisma();

    const [redisStateRaw, session] = await Promise.all([
      redis.get(STATE_KEY(userId)),
      prisma.whatsappSession.findUnique({
        where: { userId },
        select: { id: true, status: true, phoneNumber: true, updatedAt: true },
      }),
    ]);

    if (!session) {
      res.json({ state: "none", sessionId: null, phoneNumber: null, updatedAt: null });
      return;
    }

    const state: PairStateValue = isPairState(redisStateRaw) ? redisStateRaw : "none";

    // Only ever surface plaintext phone when the session is actually paired —
    // avoids leaking a phone number for a session that has since disconnected.
    let phoneNumber: string | null = null;
    if (session.phoneNumber && state === "paired") {
      try {
        const user = await prisma.user.findUniqueOrThrow({
          where: { id: userId },
          select: { encryptedDek: true },
        });
        const wrapped = parseCiphertext(Buffer.from(user.encryptedDek).toString("utf8"));
        const dek = unwrapDek(env.MASTER_KEY_BYTES, wrapped);
        const ct = parseCiphertext(Buffer.from(session.phoneNumber).toString("utf8"));
        phoneNumber = decryptWithKey(dek, ct);
      } catch (err) {
        // Log + swallow — never leak crypto errors to the client.
        req.log?.error({ err, userId }, "pair/status: phoneNumber decrypt failed");
      }
    }

    res.json({
      state,
      sessionId: session.id,
      phoneNumber,
      updatedAt: session.updatedAt.toISOString(),
    });
  });

  r.get("/pair/qr", async (_req: Request, res: AuthedResponse) => {
    const userId = res.locals.user?.sub;
    if (!userId) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const png = await redis.get(QR_KEY(userId));
    if (!png) {
      res.status(404).json({ error: "no_qr_available" });
      return;
    }
    // Return base64 JSON (not binary image/png) so the SPA can request it with
    // an `Authorization: Bearer <jwt>` header via `fetch()`. Browsers do not
    // attach the Authorization header to `<img src="...">` requests (only
    // cookies), so the previous binary response 401'd for the logged-in UI.
    // The SPA renders `<img src="data:image/png;base64,...">` from this payload.
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ qrPng: png });
  });

  return r;
}
