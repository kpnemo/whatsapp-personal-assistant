import { type AuditType, getPrisma } from "@wpa/db";
import {
  writeAudit as writeAuditShared,
  decodeAuditDetails as decodeShared,
  encodeAuditDetails as encodeShared,
} from "@wpa/shared";

import { env } from "../env.js";
import { logger } from "../logger.js";

/**
 * Thin API-side wrapper around `@wpa/shared`'s `writeAudit` that binds the
 * shared prisma client + master key + pino logger. Route handlers stay
 * unchanged (`await writeAudit({ userId, type })`).
 *
 * The encode/decode helpers are re-exported for tests and any other consumer
 * that previously imported them from this module.
 */
export const encodeAuditDetails = encodeShared;
export const decodeAuditDetails = decodeShared;

export async function writeAudit(params: {
  userId?: string;
  type: AuditType;
  targetRef?: string;
  details?: unknown;
}): Promise<void> {
  await writeAuditShared({
    prisma: getPrisma(),
    masterKey: env.MASTER_KEY_BYTES,
    ...(params.userId !== undefined ? { userId: params.userId } : {}),
    type: params.type,
    ...(params.targetRef !== undefined ? { targetRef: params.targetRef } : {}),
    ...(params.details !== undefined ? { details: params.details } : {}),
    logger,
  });
}
