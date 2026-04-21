import { Router } from "express";

import { writeAudit } from "../audit/writeAudit.js";
import { requireAuth } from "../middleware/auth.js";
import { getRedis } from "../redis.js";

export function killRouter(): Router {
  const r = Router();
  r.post("/kill", requireAuth, async (_req, res) => {
    await getRedis().set("wpa:global:assistant_reply_enabled", "false");
    await writeAudit({ userId: res.locals.user!.sub, type: "kill" });
    res.json({ muted: true });
  });
  r.post("/kill/restore", requireAuth, async (_req, res) => {
    await getRedis().set("wpa:global:assistant_reply_enabled", "true");
    await writeAudit({
      userId: res.locals.user!.sub,
      type: "setting_change",
      targetRef: "kill_restore",
    });
    res.json({ muted: false });
  });
  return r;
}
