import { type AuditType, getPrisma } from "@wpa/db";
import { decryptWithKey, encryptWithKey, parseCiphertext, serializeCiphertext } from "@wpa/shared";

import { env } from "../env.js";
import { logger } from "../logger.js";

export function encodeAuditDetails(key: Buffer, details: unknown): Buffer | undefined {
  if (details === undefined) return undefined;
  const ct = encryptWithKey(key, JSON.stringify(details));
  return Buffer.from(serializeCiphertext(ct));
}

export function decodeAuditDetails(key: Buffer, bytes: Buffer): unknown {
  const s = bytes.toString("utf8");
  const ct = parseCiphertext(s);
  return JSON.parse(decryptWithKey(key, ct));
}

export async function writeAudit(params: {
  userId?: string;
  type: AuditType;
  targetRef?: string;
  details?: unknown;
}): Promise<void> {
  try {
    const prisma = getPrisma();
    await prisma.auditLog.create({
      data: {
        userId: params.userId ?? null,
        type: params.type,
        targetRef: params.targetRef ?? null,
        details: encodeAuditDetails(env.MASTER_KEY_BYTES, params.details) ?? null,
      },
    });
  } catch (err) {
    logger.error({ err, type: params.type }, "audit write failed");
  }
}
