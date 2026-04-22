import type { PrismaClient } from "@wpa/db";
import { parseCiphertext, unwrapDek } from "@wpa/shared";
import type { Logger } from "pino";

import type { EncryptedAuthStore } from "./authStore.js";
import type { SnapshotBlob, SnapshotScheduler } from "./snapshot.js";
import type { PairMachine } from "./state.js";

/**
 * Audit writer callback shape. Kept narrow so the worker's restore path
 * doesn't transitively pull in the api's logger / env.
 */
export type RestoreAuditWriter = (
  userId: string,
  subtype: "pair.restored" | "pair.failed",
  details?: Record<string, unknown>,
) => Promise<void>;

export interface RestorePairedSessionsOpts {
  prisma: PrismaClient;
  authStore: EncryptedAuthStore;
  pairMachine: PairMachine;
  snapshotter: SnapshotScheduler;
  masterKey: Buffer;
  logger: Logger;
  writeAudit: RestoreAuditWriter;
}

export interface RestoreSummary {
  restored: number;
  failed: number;
}

/**
 * Parse + validate a snapshot blob read from the DB. Throws on anything
 * structurally wrong.
 */
function parseSnapshotBlob(bytes: Buffer): SnapshotBlob {
  const json = JSON.parse(bytes.toString("utf8")) as unknown;
  if (typeof json !== "object" || json === null) {
    throw new Error("snapshot blob is not an object");
  }
  const j = json as Record<string, unknown>;
  if (j.v !== 1) {
    throw new Error(`snapshot blob version mismatch: got ${String(j.v)}, expected 1`);
  }
  const credsCt = j.credsCt;
  if (credsCt !== null && typeof credsCt !== "string") {
    throw new Error("snapshot blob credsCt must be string or null");
  }
  if (!Array.isArray(j.keys)) {
    throw new Error("snapshot blob keys must be an array");
  }
  const keys: { type: string; id: string; ct: string }[] = [];
  for (const entry of j.keys) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof (entry as Record<string, unknown>).type !== "string" ||
      typeof (entry as Record<string, unknown>).id !== "string" ||
      typeof (entry as Record<string, unknown>).ct !== "string"
    ) {
      throw new Error("snapshot blob key entry malformed");
    }
    const e = entry as { type: string; id: string; ct: string };
    keys.push(e);
  }
  return { v: 1, credsCt, keys };
}

/**
 * Hydrate Redis + reopen Baileys sockets for every user with a `paired`
 * WhatsappSession row. Called once at worker boot.
 *
 * Per-user errors (corrupt blob, unwrap failure, socket reopen failure) mark
 * that session as `disconnected`, write a `pair.failed` audit, and move on.
 * Postgres/Redis being fully down is Safety-Rule-#8 territory — the caller is
 * expected to let the top-level main() die in that case.
 */
export async function restorePairedSessions(
  opts: RestorePairedSessionsOpts,
): Promise<RestoreSummary> {
  const { prisma, authStore, pairMachine, snapshotter, masterKey, logger, writeAudit } = opts;
  const log = logger.child({ name: "restore" });

  const sessions = await prisma.whatsappSession.findMany({
    where: { status: "paired" },
    include: { user: { select: { encryptedDek: true } } },
  });

  let restored = 0;
  let failed = 0;

  for (const session of sessions) {
    const userId = session.userId;
    try {
      if (!session.authState) {
        throw new Error("paired session has no authState blob");
      }
      const blob = parseSnapshotBlob(Buffer.from(session.authState));
      const wrapped = parseCiphertext(Buffer.from(session.user.encryptedDek).toString("utf8"));
      const dek = unwrapDek(masterKey, wrapped);

      if (blob.credsCt !== null) {
        await authStore.hydrateCredsRaw(userId, blob.credsCt);
      }
      for (const k of blob.keys) {
        await authStore.hydrateKeyRaw(userId, k.type, k.id, k.ct);
      }

      // Decrypt the hydrated state into a fully-formed Baileys
      // AuthenticationState and re-open the Baileys socket with the restored
      // creds. resumePaired transitions idle → paired without emitting onPaired
      // (which is a first-time-link event); restoration writes its own audit.
      // NOTE: the worker's `onPaired` handler ALSO starts the snapshot
      // scheduler. We still call snapshotter.start here explicitly because
      // resumePaired does not emit onPaired — and the snapshot heartbeat must
      // run even for an in-progress restore.
      const authState = await authStore.loadState(userId, dek);
      await pairMachine.resumePaired(userId, authState);
      snapshotter.start(userId, dek);

      restored += 1;
      await writeAudit(userId, "pair.restored", { keys: blob.keys.length });
      log.info({ userId, keys: blob.keys.length }, "session restored");
    } catch (err) {
      failed += 1;
      const message = err instanceof Error ? err.message : String(err);
      log.error({ err, userId }, "restore failed");
      try {
        await prisma.whatsappSession.update({
          where: { userId },
          data: { status: "disconnected" },
        });
      } catch (dbErr) {
        log.error(
          { err: dbErr, userId },
          "failed to mark session disconnected after restore error",
        );
      }
      try {
        await writeAudit(userId, "pair.failed", { error: message });
      } catch (auditErr) {
        log.error({ err: auditErr, userId }, "failed to write pair.failed audit");
      }
    }
  }

  log.info({ restored, failed }, "restore summary");
  return { restored, failed };
}
