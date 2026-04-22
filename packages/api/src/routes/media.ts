import fs from "node:fs/promises";
import path from "node:path";

import { getPrisma } from "@wpa/db";
import { decryptWithKey, parseCiphertext, unwrapDek } from "@wpa/shared";
import { type Request, Router } from "express";

import { env } from "../env.js";
import { logger } from "../logger.js";
import { type AuthedResponse, requireAuth } from "../middleware/auth.js";

export function mediaRouter(): Router {
  const r = Router();

  /**
   * GET /media/:messageId
   * Stream decrypted media bytes for a message the requesting user owns.
   */
  r.get("/media/:messageId", requireAuth, async (req: Request, res: AuthedResponse) => {
    const userId = res.locals.user?.sub;
    if (!userId) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    const messageId = req.params.messageId as string;
    const prisma = getPrisma();

    // Ownership check via join: messages → conversations → userId.
    const row = await prisma.message.findFirst({
      where: {
        id: messageId,
        conversation: { userId },
      },
      select: {
        mediaRef: true,
        mediaMime: true,
      },
    });

    if (!row) {
      res.status(404).json({ error: "not_found" });
      return;
    }

    if (!row.mediaRef) {
      res.status(404).json({ error: "no_media" });
      return;
    }

    // Unwrap DEK.
    let dek: Buffer;
    try {
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { encryptedDek: true },
      });
      const wrapped = parseCiphertext(Buffer.from(user.encryptedDek).toString("utf8"));
      dek = unwrapDek(env.MASTER_KEY_BYTES, wrapped);
    } catch (err) {
      logger.error({ err, userId }, "media: DEK unwrap failed");
      res.status(500).json({ error: "internal_error" });
      return;
    }

    // Read encrypted media file from disk.
    const mediaPath = path.join(env.MEDIA_DIR, row.mediaRef);
    let encryptedBytes: Buffer;
    try {
      encryptedBytes = await fs.readFile(mediaPath);
    } catch (err) {
      logger.error({ err, mediaPath, userId }, "media: file read failed");
      res.status(404).json({ error: "media_not_found" });
      return;
    }

    // Decrypt media.
    // Convention: media bytes on disk are DEK-encrypted base64-encoded blobs.
    // The worker (ingest/media.ts) base64-encodes binary payloads before
    // encryptWithKey; here we reverse: decrypt → base64 → raw bytes.
    let bytes: Buffer;
    try {
      const plaintextBase64 = decryptWithKey(dek, parseCiphertext(encryptedBytes.toString("utf8")));
      bytes = Buffer.from(plaintextBase64, "base64");
    } catch (err) {
      logger.error({ err, userId, mediaPath }, "media: decrypt failed");
      res.status(500).json({ error: "internal_error" });
      return;
    }

    res.setHeader("Content-Type", row.mediaMime ?? "application/octet-stream");
    res.setHeader("Cache-Control", "private, max-age=300");
    res.end(bytes);
  });

  return r;
}
