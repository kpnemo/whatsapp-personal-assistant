import { hostname } from "node:os";

import type { WAMessage } from "@whiskeysockets/baileys";
import type { PrismaClient } from "@wpa/db";
import type { AuditPrismaClient as _AuditPrismaClient } from "@wpa/shared";
import type { Redis } from "ioredis";
import type { Logger } from "pino";

import { makeIngestAudit } from "./audit.js";
import { normalize, type NormalizedMessage } from "./normalize.js";
import { persist } from "./persist.js";
import { ingestStreamKey } from "./subscribe.js";

const CONSUMER_GROUP = "wpa-ingest";
const READ_COUNT = 10;
// BLOCK_MS is the max time xreadgroup will wait for new entries. Lower
// values reduce shutdown latency (stop() resolves within BLOCK_MS) but
// increase idle Redis traffic. 1s is a reasonable balance for MVP.
const BLOCK_MS = 1_000;
const DEFAULT_DLQ_MAX = 3;

/** Redis key for tracking delivery attempts on a poison message entry. */
function retryKey(entryId: string): string {
  return `wpa:ingest:retry:${entryId}`;
}

/** Redis key for the dead-letter queue for a given user. */
function dlqKey(userId: string): string {
  return `wpa:msg:dlq:${userId}`;
}

export interface StartConsumerOpts {
  userId: string;
  prisma: PrismaClient;
  redis: Redis;
  dek: Buffer;
  masterKey: Buffer;
  logger: Logger;
  /** Max delivery attempts before sending to DLQ. Defaults to INGEST_DLQ_MAX_DELIVERIES env or 3. */
  dlqMaxDeliveries?: number;
  enqueueMedia?: (input: {
    messageId: string;
    userId: string;
    normalized: NormalizedMessage;
    /** Raw Baileys WAMessage — used by the media downloader to call downloadMediaMessage. */
    raw: WAMessage;
  }) => void;
}

export interface ConsumerHandle {
  stop: () => void;
  /** Resolves when the loop has fully exited. */
  done: Promise<void>;
}

async function ensureGroup(redis: Redis, streamKey: string, logger: Logger): Promise<void> {
  try {
    await redis.xgroup("CREATE", streamKey, CONSUMER_GROUP, "$", "MKSTREAM");
    logger.debug({ stream: streamKey, group: CONSUMER_GROUP }, "created ingest consumer group");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("BUSYGROUP")) {
      logger.debug({ stream: streamKey, group: CONSUMER_GROUP }, "ingest group already exists");
      return;
    }
    throw err;
  }
}

/**
 * Start an XREADGROUP loop for `userId` that consumes raw messages from
 * `wpa:msg:ingest:<userId>`, normalises and persists them.
 *
 * Returns a `ConsumerHandle` with a `stop()` signal and a `done` promise.
 */
export async function startConsumer(opts: StartConsumerOpts): Promise<ConsumerHandle> {
  const { userId, prisma, redis, dek, masterKey, logger } = opts;
  const dlqMax =
    opts.dlqMaxDeliveries ??
    parseInt(process.env.INGEST_DLQ_MAX_DELIVERIES ?? String(DEFAULT_DLQ_MAX), 10);
  const streamKey = ingestStreamKey(userId);
  const consumer = `ingest-${hostname()}-${process.pid.toString()}`;
  const log = logger.child({ name: "ingest.consumer", userId, consumer });
  // makeIngestAudit takes AuditPrismaClient structurally — PrismaClient satisfies it.
  const audit = makeIngestAudit(prisma, masterKey, log);

  await ensureGroup(redis, streamKey, log);

  let running = true;

  const done = (async () => {
    while (running) {
      let response: Awaited<ReturnType<Redis["xreadgroup"]>> | null = null;
      try {
        response = await redis.xreadgroup(
          "GROUP",
          CONSUMER_GROUP,
          consumer,
          "COUNT",
          READ_COUNT,
          "BLOCK",
          BLOCK_MS,
          "STREAMS",
          streamKey,
          ">",
        );
      } catch (err) {
        if (!running) return;
        log.warn({ err }, "xreadgroup failed; backing off");
        await new Promise((r) => setTimeout(r, 1_000));
        continue;
      }

      if (!response) continue;

      const arr = response as [string, [string, string[]][]][];
      for (const [, messages] of arr) {
        for (const [entryId, fields] of messages) {
          // Parse fields ["raw", "<json>", ...]
          const fieldMap: Record<string, string> = {};
          for (let i = 0; i < fields.length - 1; i += 2) {
            const k = fields[i];
            const v = fields[i + 1];
            if (typeof k === "string" && typeof v === "string") {
              fieldMap[k] = v;
            }
          }

          const rawJson = fieldMap.raw;
          if (!rawJson) {
            log.warn({ entryId }, "ingest entry missing 'raw' field; acking and skipping");
            await redis.xack(streamKey, CONSUMER_GROUP, entryId);
            continue;
          }

          try {
            const rawMsg = JSON.parse(rawJson) as Parameters<typeof normalize>[0];
            const normalized = normalize(rawMsg);
            // Build a closure-based enqueueMedia that captures the raw WAMessage
            // so the media downloader can call downloadMediaMessage on it.
            const persistDeps =
              opts.enqueueMedia !== undefined
                ? {
                    prisma,
                    dek,
                    redis,
                    enqueueMedia: (input: {
                      messageId: string;
                      userId: string;
                      normalized: NormalizedMessage;
                    }) => {
                      opts.enqueueMedia!({ ...input, raw: rawMsg });
                    },
                  }
                : { prisma, dek, redis };
            await persist(userId, normalized, persistDeps);
            // Clean up any retry counter for this entry (handles retry-then-success path).
            await redis.del(retryKey(entryId));
            await redis.xack(streamKey, CONSUMER_GROUP, entryId);
          } catch (err) {
            log.error({ err, entryId }, "failed to process ingest entry");
            // Increment delivery count. On first attempt, set a 24h TTL to
            // prevent orphan keys accumulating indefinitely.
            const attempts = await redis.hincrby(retryKey(entryId), "count", 1);
            if (attempts === 1) {
              await redis.expire(retryKey(entryId), 86_400);
            }
            if (attempts >= dlqMax) {
              log.warn({ entryId, attempts }, "poison message — moving to DLQ");
              await redis.xadd(dlqKey(userId), "*", "entryId", entryId, "raw", rawJson ?? "");
              await redis.xack(streamKey, CONSUMER_GROUP, entryId);
              // Delete the retry counter now that the entry is in DLQ.
              await redis.del(retryKey(entryId));
              await audit({
                userId,
                subtype: "ingest.poison_message",
                details: {
                  entryId,
                  attempts,
                  error: err instanceof Error ? err.message : String(err),
                },
              });
            }
          }
        }
      }
    }
  })();

  return {
    stop: () => {
      running = false;
    },
    done,
  };
}
