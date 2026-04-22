import { getPrisma } from "@wpa/db";
import { generateKey, serializeCiphertext, wrapDek } from "@wpa/shared";
import { Router } from "express";
import { z } from "zod";

import { writeAudit } from "../audit/writeAudit.js";
import { AuthError, login, registerUser, revokeRefresh, rotateRefresh } from "../auth/service.js";
import {
  REFRESH_COOKIE_NAME,
  REFRESH_COOKIE_PATH,
  hashRefreshToken,
  refreshCookieOptions,
  verifyAccessTokenForAudit,
} from "../auth/tokens.js";
import { env } from "../env.js";
import { type AuthedResponse, requireAuth } from "../middleware/auth.js";
import { createRateLimiter } from "../middleware/rate-limit.js";
import { getRedis } from "../redis.js";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(12).max(256),
  invitationToken: z.string().optional(),
});

export function authRouter(): Router {
  const r = Router();
  const redis = getRedis();

  const loginLimiter = createRateLimiter({
    redis,
    keyPrefix: "rl:auth:login",
    points: 5,
    duration: 15 * 60,
    keyBy: "ip",
  });

  const registerLimiter = createRateLimiter({
    redis,
    keyPrefix: "rl:auth:register",
    points: 3,
    duration: 60 * 60,
    keyBy: "ip",
  });

  const refreshLimiter = createRateLimiter({
    redis,
    keyPrefix: "rl:auth:refresh",
    points: 30,
    duration: 60 * 60,
    keyBy: "ip",
  });

  const logoutLimiter = createRateLimiter({
    redis,
    keyPrefix: "rl:auth:logout",
    points: 60,
    duration: 60 * 60,
    keyBy: "ip+user",
  });

  r.post("/auth/login", loginLimiter, async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_input" });
      return;
    }
    try {
      const result = await login(parsed.data.email, parsed.data.password, {
        ip: req.ip,
        userAgent: req.header("user-agent") ?? undefined,
      });
      res.cookie(
        REFRESH_COOKIE_NAME,
        result.refreshToken,
        refreshCookieOptions({ secureRequest: req.secure, nodeEnv: env.NODE_ENV }),
      );
      await writeAudit({ userId: result.userId, type: "login" });
      res.json({ accessToken: result.accessToken, userId: result.userId, role: result.role });
    } catch (err) {
      if (err instanceof AuthError) {
        await writeAudit({ type: "login_failed", targetRef: parsed.data.email });
        res.status(401).json({ error: "invalid_credentials" });
        return;
      }
      throw err;
    }
  });

  r.post("/auth/refresh", refreshLimiter, async (req, res) => {
    const cookies = req.cookies as Record<string, unknown> | undefined;
    const token = cookies?.[REFRESH_COOKIE_NAME];
    if (typeof token !== "string") {
      res.status(401).json({ error: "no_refresh" });
      return;
    }
    const rotated = await rotateRefresh(token, {
      ip: req.ip,
      userAgent: req.header("user-agent") ?? undefined,
    });
    if (!rotated) {
      res.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
      res.status(401).json({ error: "invalid_refresh" });
      return;
    }
    res.cookie(
      REFRESH_COOKIE_NAME,
      rotated.refreshToken,
      refreshCookieOptions({ secureRequest: req.secure, nodeEnv: env.NODE_ENV }),
    );
    res.json({ accessToken: rotated.accessToken });
  });

  r.post("/auth/logout", logoutLimiter, async (req, res: AuthedResponse) => {
    const cookies = req.cookies as Record<string, unknown> | undefined;
    const token = cookies?.[REFRESH_COOKIE_NAME];
    if (typeof token === "string") await revokeRefresh(token);
    res.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });

    // Best-effort audit attribution: /auth/logout is public (no requireAuth),
    // so res.locals.user is unset. Recover sub from the bearer if present,
    // tolerating expired tokens (signature still verified). Log the event
    // either way — null userId still tells us a logout attempt occurred.
    let userId: string | undefined = res.locals.user?.sub;
    if (!userId) {
      const header = req.header("authorization");
      if (header?.startsWith("Bearer ")) {
        const claims = await verifyAccessTokenForAudit(header.slice("Bearer ".length));
        userId = claims?.sub;
      }
    }
    await writeAudit({ type: "logout", ...(userId ? { userId } : {}) });
    res.status(204).end();
  });

  r.get("/auth/me", requireAuth, async (_req, res: AuthedResponse) => {
    const sub = res.locals.user?.sub;
    if (!sub) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const prisma = getPrisma();
    const user = await prisma.user.findUnique({
      where: { id: sub },
      select: { id: true, email: true, role: true, createdAt: true, lastLoginAt: true },
    });
    if (!user) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json(user);
  });

  r.post("/auth/register", registerLimiter, async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_input" });
      return;
    }
    const prisma = getPrisma();
    const anyUserExists = (await prisma.user.count()) > 0;
    const isFirstUser = !anyUserExists;

    if (!isFirstUser && !env.OPEN_REGISTRATION) {
      if (!parsed.data.invitationToken) {
        res.status(403).json({ error: "invite_required" });
        return;
      }
      const tokenHash = hashRefreshToken(parsed.data.invitationToken);
      const inv = await prisma.invitation.findUnique({ where: { tokenHash } });
      if (!inv || inv.usedAt || inv.expiresAt < new Date() || inv.email !== parsed.data.email) {
        res.status(403).json({ error: "invalid_invite" });
        return;
      }
      const dek = generateKey();
      const wrapped = wrapDek(env.MASTER_KEY_BYTES, dek);
      const user = await registerUser({
        email: parsed.data.email,
        password: parsed.data.password,
        encryptedDek: Buffer.from(serializeCiphertext(wrapped)),
        role: "user",
      });
      await prisma.invitation.update({
        where: { id: inv.id },
        data: { usedAt: new Date(), consumedByUserId: user.id },
      });
      await writeAudit({ userId: user.id, type: "register" });
      res.status(201).json({ id: user.id });
      return;
    }

    const dek = generateKey();
    const wrapped = wrapDek(env.MASTER_KEY_BYTES, dek);
    const user = await registerUser({
      email: parsed.data.email,
      password: parsed.data.password,
      encryptedDek: Buffer.from(serializeCiphertext(wrapped)),
      role: isFirstUser ? "admin" : "user",
    });
    await writeAudit({ userId: user.id, type: "register" });
    res.status(201).json({ id: user.id, role: isFirstUser ? "admin" : "user" });
  });

  return r;
}
