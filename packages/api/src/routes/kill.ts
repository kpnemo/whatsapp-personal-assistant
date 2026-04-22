import { Router } from "express";

import { writeAudit } from "../audit/writeAudit.js";
import { requireAuth } from "../middleware/auth.js";
import { createRateLimiter } from "../middleware/rate-limit.js";
import { getRedis } from "../redis.js";

export function killRouter(): Router {
  const r = Router();
  const redis = getRedis();

  const killLimiter = createRateLimiter({
    redis,
    keyPrefix: "rl:kill:mute",
    points: 20,
    duration: 60 * 60,
    keyBy: "user",
  });

  const restoreLimiter = createRateLimiter({
    redis,
    keyPrefix: "rl:kill:restore",
    points: 20,
    duration: 60 * 60,
    keyBy: "user",
  });

  r.post("/kill", requireAuth, killLimiter, async (_req, res) => {
    await redis.set("wpa:global:assistant_reply_enabled", "false");
    await writeAudit({ userId: res.locals.user!.sub, type: "kill" });
    res.json({ muted: true });
  });
  r.post("/kill/restore", requireAuth, restoreLimiter, async (_req, res) => {
    await redis.set("wpa:global:assistant_reply_enabled", "true");
    await writeAudit({
      userId: res.locals.user!.sub,
      type: "setting_change",
      targetRef: "kill_restore",
    });
    res.json({ muted: false });
  });
  return r;
}
