import type { PrismaClient } from "@wpa/db";
import type { Logger } from "pino";

import type { EncryptedAuthStore } from "./authStore.js";

/**
 * Shape of the snapshot blob written to `WhatsappSession.authState`. The
 * ciphertexts are the per-user-DEK encrypted blobs already sitting in Redis —
 * we don't add a second encryption layer. On restore, these blobs are
 * re-hydrated into Redis verbatim, where the Baileys keystore picks them up
 * again.
 */
export interface SnapshotBlob {
  v: 1;
  credsCt: string | null;
  keys: { type: string; id: string; ct: string }[];
}

export interface SnapshotScheduler {
  start(userId: string, dek: Buffer): void;
  stop(userId: string): void;
  /** Trigger an immediate flush. `dek` is required to read from the store. */
  flushNow(userId: string, dek: Buffer): Promise<void>;
  shutdown(): Promise<void>;
}

export interface MakeSnapshotSchedulerOpts {
  intervalMs?: number;
}

const DEFAULT_INTERVAL_MS = 15_000;

export function makeSnapshotScheduler(
  prisma: PrismaClient,
  authStore: EncryptedAuthStore,
  logger: Logger,
  opts: MakeSnapshotSchedulerOpts = {},
): SnapshotScheduler {
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  const log = logger.child({ name: "snapshot" });
  const timers = new Map<string, NodeJS.Timeout>();
  const inFlight = new Map<string, Promise<void>>();

  const flushNow = async (userId: string, _dek: Buffer): Promise<void> => {
    // `_dek` is accepted to keep the interface stable — today's copy-ciphertext
    // flow doesn't need to decrypt (the ciphertexts stored in Redis already
    // use the user's DEK). Future Rotate/Verify passes will use it.
    try {
      const credsCt = await authStore.readCredsRaw(userId);
      const keys = await authStore.readAllKeysRaw(userId);
      const blob: SnapshotBlob = {
        v: 1,
        credsCt,
        keys: keys.map((k) => ({ type: k.type, id: k.id, ct: k.serializedCt })),
      };
      if (credsCt === null && keys.length === 0) {
        // Nothing to snapshot — skip to avoid overwriting a previously good
        // row with empty state (e.g. Redis flush between sessions).
        log.debug({ userId }, "skipping snapshot: empty redis state");
        return;
      }
      await prisma.whatsappSession.update({
        where: { userId },
        data: {
          authState: Buffer.from(JSON.stringify(blob)),
          lastConnectedAt: new Date(),
        },
      });
      log.debug({ userId, keyCount: keys.length }, "snapshot flushed");
    } catch (err) {
      // Never crash the scheduler — log + continue. A transient Prisma error
      // shouldn't take down the whole worker.
      log.error({ err, userId }, "snapshot flush failed");
    }
  };

  const flushTracked = (userId: string, dek: Buffer): void => {
    const p = flushNow(userId, dek);
    inFlight.set(userId, p);
    void p.finally(() => {
      if (inFlight.get(userId) === p) {
        inFlight.delete(userId);
      }
    });
  };

  const start = (userId: string, dek: Buffer): void => {
    // Replace any existing timer so start() is idempotent + safe across
    // reconnects.
    const existing = timers.get(userId);
    if (existing) clearInterval(existing);
    const timer = setInterval(() => {
      flushTracked(userId, dek);
    }, intervalMs);
    // Don't block process exit on the heartbeat.
    timer.unref?.();
    timers.set(userId, timer);
    log.info({ userId, intervalMs }, "snapshot scheduler started");
  };

  const stop = (userId: string): void => {
    const t = timers.get(userId);
    if (t) {
      clearInterval(t);
      timers.delete(userId);
      log.info({ userId }, "snapshot scheduler stopped");
    }
  };

  const shutdown = async (): Promise<void> => {
    log.info({ active: timers.size }, "snapshot scheduler shutting down");
    for (const t of timers.values()) {
      clearInterval(t);
    }
    timers.clear();
    // Await any in-flight flushes.
    const pending = Array.from(inFlight.values());
    if (pending.length > 0) {
      await Promise.allSettled(pending);
    }
  };

  return { start, stop, flushNow, shutdown };
}
