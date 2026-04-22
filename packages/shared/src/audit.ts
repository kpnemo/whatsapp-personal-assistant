import { decryptWithKey, encryptWithKey, parseCiphertext, serializeCiphertext } from "./crypto.js";

/**
 * AuditType mirrors the Prisma enum in packages/db/prisma/schema.prisma.
 * Declared here as a literal union (instead of `import type { AuditType } from "@wpa/db"`)
 * so @wpa/shared has no build-time dependency on @wpa/db — that dependency
 * was causing a turbo build-graph cycle. Callers may cast a Prisma-generated
 * AuditType to this union (value-level identical).
 */
export type AuditType =
  | "ai_reply"
  | "rule_fired"
  | "decrypt"
  | "ingest"
  | "login"
  | "login_failed"
  | "logout"
  | "register"
  | "invite_create"
  | "invite_consume"
  | "setting_change"
  | "kill"
  | "pair"
  | "unpair";

/**
 * Minimal structural contract for the Prisma client passed to writeAudit.
 * Keeping this an inline interface (instead of `import type { PrismaClient } from "@wpa/db"`)
 * avoids the @wpa/shared → @wpa/db build-graph cycle. Any real Prisma client
 * satisfies this shape by construction.
 */
export interface AuditPrismaClient {
  auditLog: {
    create: (args: {
      data: {
        userId: string | null;
        type: AuditType;
        targetRef: string | null;
        details: Buffer | null;
      };
    }) => Promise<unknown>;
  };
}

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
  prisma: AuditPrismaClient;
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
