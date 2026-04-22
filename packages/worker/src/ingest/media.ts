import { encryptWithKey, serializeCiphertext } from "@wpa/shared";
import type { Redis } from "ioredis";
import type { Logger } from "pino";

import type { MediaStore } from "./mediaStore.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GetPrismaFn = () => {
  message: {
    update(args: {
      where: { id: string };
      data: { mediaRef?: string | null; mediaMime?: string | null };
    }): Promise<unknown>;
  };
};

export interface MediaDownloaderDeps {
  mediaStore: MediaStore;
  redis: Redis;
  getPrisma: GetPrismaFn;
  logger: Logger;
  perUserConcurrency: number;
  globalConcurrency: number;
  maxBytes: number;
  queuePerUserMax: number;
  audit: (userId: string, subtype: string, details?: Record<string, unknown>) => Promise<void>;
}

export interface MediaJob {
  userId: string;
  messageId: string;
  dek: Buffer;
  mimeType: string | undefined;
  download: () => Promise<Buffer>;
}

interface UserQueue {
  queued: MediaJob[];
  active: number;
}

// ---------------------------------------------------------------------------
// MediaDownloader
// ---------------------------------------------------------------------------

/**
 * Bounded-concurrency media downloader.
 *
 * - Per-user concurrency cap: `perUserConcurrency` simultaneous downloads.
 * - Global concurrency cap: `globalConcurrency` total simultaneous downloads.
 * - Per-user queue cap: `queuePerUserMax` pending jobs. Overflow is audited
 *   and silently dropped.
 */
export class MediaDownloader {
  readonly #deps: MediaDownloaderDeps;
  readonly #queues = new Map<string, UserQueue>();
  #activeGlobal = 0;
  #stopped = false;
  readonly #inflight = new Set<Promise<void>>();

  constructor(deps: MediaDownloaderDeps) {
    this.#deps = deps;
  }

  /** Synchronously enqueue a media download job. */
  enqueue(job: MediaJob): void {
    if (this.#stopped) {
      return;
    }

    let q = this.#queues.get(job.userId);
    if (!q) {
      q = { queued: [], active: 0 };
      this.#queues.set(job.userId, q);
    }

    if (q.queued.length >= this.#deps.queuePerUserMax) {
      // Queue overflow — audit and drop.
      void this.#deps.audit(job.userId, "ingest.media_skipped_overload", {
        messageId: job.messageId,
        queueDepth: q.queued.length,
      });
      return;
    }

    q.queued.push(job);
    this.#dispatch();
  }

  /**
   * Stop accepting new work. Awaits all in-flight downloads; drops queued
   * jobs that have not yet started.
   */
  async stop(): Promise<void> {
    this.#stopped = true;

    // Clear all pending queues.
    for (const q of this.#queues.values()) {
      q.queued.length = 0;
    }

    // Await every in-flight worker promise.
    await Promise.allSettled(Array.from(this.#inflight));
  }

  /** Snapshot of active + queued counts for observability. */
  stats(): {
    active: number;
    queued: number;
    perUser: Record<string, { active: number; queued: number }>;
  } {
    let totalQueued = 0;
    const perUser: Record<string, { active: number; queued: number }> = {};
    for (const [userId, q] of this.#queues) {
      totalQueued += q.queued.length;
      perUser[userId] = { active: q.active, queued: q.queued.length };
    }
    return { active: this.#activeGlobal, queued: totalQueued, perUser };
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  /** Fill open worker slots from the ready user queues. */
  #dispatch(): void {
    while (this.#activeGlobal < this.#deps.globalConcurrency) {
      const job = this.#nextJob();
      if (!job) break;
      this.#runJob(job);
    }
  }

  /** Pick the oldest queued job from the first user that has capacity. */
  #nextJob(): MediaJob | undefined {
    for (const [, q] of this.#queues) {
      if (q.queued.length > 0 && q.active < this.#deps.perUserConcurrency) {
        return q.queued.shift();
      }
    }
    return undefined;
  }

  #runJob(job: MediaJob): void {
    const q = this.#queues.get(job.userId);
    if (!q) return;

    q.active++;
    this.#activeGlobal++;

    const promise = this.#execJob(job).finally(() => {
      q.active--;
      this.#activeGlobal--;
      this.#inflight.delete(promise);
      if (!this.#stopped) {
        this.#dispatch();
      }
    });

    this.#inflight.add(promise);
  }

  async #execJob(job: MediaJob): Promise<void> {
    const { mediaStore, redis, getPrisma, logger, maxBytes, audit } = this.#deps;
    const log = logger.child({
      name: "ingest.media",
      userId: job.userId,
      messageId: job.messageId,
    });

    let bytes: Buffer;
    try {
      bytes = await job.download();
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      log.warn({ reason }, "media download failed");
      await audit(job.userId, "ingest.media_failed", { messageId: job.messageId, reason });
      return;
    }

    if (bytes.length > maxBytes) {
      log.warn({ size: bytes.length, maxBytes }, "media exceeds maxBytes — skipping");
      await audit(job.userId, "ingest.media_failed", {
        messageId: job.messageId,
        reason: "exceeds_max_bytes",
        size: bytes.length,
      });
      return;
    }

    // Encrypt: base64-encode first (IB5 convention), then AES-GCM encrypt.
    const b64 = bytes.toString("base64");
    const ciphertext = encryptWithKey(job.dek, b64);
    const encryptedBytes = Buffer.from(serializeCiphertext(ciphertext), "utf8");

    let ref: string;
    try {
      ref = await mediaStore.put(job.userId, job.messageId, encryptedBytes);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      log.error({ reason }, "mediaStore.put failed");
      await audit(job.userId, "ingest.media_failed", { messageId: job.messageId, reason });
      return;
    }

    // Update Message row.
    try {
      const prisma = getPrisma();
      await prisma.message.update({
        where: { id: job.messageId },
        data: {
          mediaRef: ref,
          ...(job.mimeType !== undefined ? { mediaMime: job.mimeType } : {}),
        },
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      log.error({ reason }, "message.update failed after media write");
      // The file has already been written, but we cannot set the ref — treat
      // as a soft failure: message row stays with mediaRef=null.
      await audit(job.userId, "ingest.media_failed", { messageId: job.messageId, reason });
      return;
    }

    // Publish media_ready event.
    const event = JSON.stringify({ type: "message.media_ready", messageId: job.messageId });
    await redis.publish(`ui:events:${job.userId}`, event);

    await audit(job.userId, "ingest.media_ready", { messageId: job.messageId });

    log.debug({ ref }, "media downloaded and stored");
  }
}
