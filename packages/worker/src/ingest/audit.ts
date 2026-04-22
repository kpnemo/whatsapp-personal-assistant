import type { AuditPrismaClient } from "@wpa/shared";
import { writeAudit } from "@wpa/shared";
import type { Logger } from "pino";

export type IngestAuditSubtype = "ingest.poison_message" | "ingest.consume_error";

/**
 * Thin wrapper around `writeAudit` with type="ingest".
 */
export function makeIngestAudit(prisma: AuditPrismaClient, masterKey: Buffer, logger: Logger) {
  return (params: {
    userId: string;
    subtype: IngestAuditSubtype;
    details?: Record<string, unknown>;
  }): Promise<void> => {
    return writeAudit({
      prisma,
      masterKey,
      userId: params.userId,
      type: "ingest",
      details: params.details
        ? { subtype: params.subtype, ...params.details }
        : { subtype: params.subtype },
      logger,
    });
  };
}
