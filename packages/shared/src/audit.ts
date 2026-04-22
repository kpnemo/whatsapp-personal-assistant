import type { AuditType, PrismaClient } from "@wpa/db";

import { decryptWithKey, encryptWithKey, parseCiphertext, serializeCiphertext } from "./crypto.js";

/**
 * Encode arbitrary audit `details` into encrypted Bytes for storage in
 * `AuditLog.details`. AES-256-GCM with the system MASTER_KEY (NOT a per-user
 * DEK) — audit rows must be decryptable without the user's session.
 */
export function encodeAuditDetails(key: Buffer, details: unknown): Buffer | undefined {
  if (details === undefined) return undefined;
  const ct = encryptWithKey(key, JSON.stringify(details));
  return Buffer.from(serializeCiphertext(ct));
}

/**
 * Inverse of {@link encodeAuditDetails}. Throws on tampered/unparseable bytes.
 */
export function decodeAuditDetails(key: Buffer, bytes: Buffer): unknown {
  const s = bytes.toString("utf8");
  const ct = parseCiphertext(s);
  return JSON.parse(decryptWithKey(key, ct));
}

export interface WriteAuditParams {
  prisma: PrismaClient;
  masterKey: Buffer;
  userId?: string;
  type: AuditType;
  targetRef?: string;
  details?: unknown;
  /** Optional logger — if provided, failures are logged here. Otherwise silently swallowed. */
  logger?: { error: (obj: unknown, msg?: string) => void };
}

/**
 * Insert a row into `AuditLog`. Details are AES-GCM encrypted with
 * `masterKey` before storage.
 *
 * Audit writes must NEVER throw into the caller's flow — an audit failure is
 * loggable but not a reason to reject a user's action. If the `prisma.create`
 * call rejects, the error is logged (when a logger is supplied) and swallowed.
 */
export async function writeAudit(params: WriteAuditParams): Promise<void> {
  const { prisma, masterKey, userId, type, targetRef, details, logger } = params;
  try {
    await prisma.auditLog.create({
      data: {
        userId: userId ?? null,
        type,
        targetRef: targetRef ?? null,
        details: encodeAuditDetails(masterKey, details) ?? null,
      },
    });
  } catch (err) {
    logger?.error({ err, type }, "audit write failed");
  }
}
