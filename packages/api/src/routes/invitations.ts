import { randomBytes } from "node:crypto";

import { getPrisma } from "@wpa/db";
import { type Request, Router } from "express";
import { z } from "zod";

import { writeAudit } from "../audit/writeAudit.js";
import { hashRefreshToken } from "../auth/tokens.js";
import { type AuthedResponse, requireAdmin, requireAuth } from "../middleware/auth.js";
import { createRateLimiter } from "../middleware/rate-limit.js";
import { getRedis } from "../redis.js";

const createSchema = z.object({
  email: z.string().email(),
  expiresInDays: z.number().int().min(1).max(30).default(7),
});

export function invitationsRouter(): Router {
  const r = Router();

  const createLimiter = createRateLimiter({
    redis: getRedis(),
    keyPrefix: "rl:invitations:create",
    points: 10,
    duration: 60 * 60,
    keyBy: "user",
  });

  // Path-scope the auth gate so it does NOT fire for unrelated /api/* routes
  // that happen to traverse this router (kill, auth/me, etc).
  r.use("/invitations", requireAuth, requireAdmin);

  r.post("/invitations", createLimiter, async (req: Request, res: AuthedResponse) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_input" });
      return;
    }
    const adminSub = res.locals.user?.sub;
    if (!adminSub) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const token = randomBytes(32).toString("base64url");
    const tokenHash = hashRefreshToken(token);
    const expiresAt = new Date(Date.now() + parsed.data.expiresInDays * 86_400 * 1000);
    const prisma = getPrisma();
    const inv = await prisma.invitation.create({
      data: {
        email: parsed.data.email,
        tokenHash,
        expiresAt,
        invitedById: adminSub,
      },
      select: { id: true, email: true, expiresAt: true, createdAt: true },
    });
    await writeAudit({ userId: adminSub, type: "invite_create", targetRef: inv.id });
    res.status(201).json({ ...inv, token });
  });

  r.get("/invitations", async (_req: Request, res: AuthedResponse) => {
    const prisma = getPrisma();
    const rows = await prisma.invitation.findMany({
      select: { id: true, email: true, expiresAt: true, usedAt: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    res.json(rows);
  });

  return r;
}
