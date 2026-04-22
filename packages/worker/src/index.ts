import { downloadMediaMessage } from "@whiskeysockets/baileys";
import type { WAMessage } from "@whiskeysockets/baileys";
import { getPrisma, type PrismaClient } from "@wpa/db";
import {
  encryptWithKey,
  parseCiphertext,
  serializeCiphertext,
  unwrapDek,
  writeAudit,
} from "@wpa/shared";
import { Redis } from "ioredis";
import { pino, type Logger } from "pino";

import { env } from "./env.js";
import {
  startConsumer,
  subscribe,
  type ConsumerHandle,
  MediaDownloader,
  makeLocalDiskMediaStore,
} from "./ingest/index.js";
import { makeAuthStore } from "./pair/authStore.js";
import type { SocketHandle } from "./pair/baileys.js";
import { startPairWorker } from "./pair/index.js";
import { restorePairedSessions } from "./pair/restore.js";
import { makeSnapshotScheduler, type SnapshotScheduler } from "./pair/snapshot.js";
import { PairMachine } from "./pair/state.js";

const logger = pino({ level: env.LOG_LEVEL, name: "worker" });

let running = true;

/** Convenience wrapper bound to the worker's prisma + master key + logger. */
function makeWorkerAudit(prisma: PrismaClient, masterKey: Buffer, log: Logger) {
  return (params: {
    userId?: string;
    type: "pair" | "unpair";
    subtype?: string;
    targetRef?: string;
    details?: Record<string, unknown>;
  }): Promise<void> => {
    const mergedDetails: Record<string, unknown> | undefined =
      params.subtype !== undefined || params.details !== undefined
        ? {
            ...(params.subtype !== undefined ? { subtype: params.subtype } : {}),
            ...(params.details ?? {}),
          }
        : undefined;
    return writeAudit({
      prisma,
      masterKey,
      ...(params.userId !== undefined ? { userId: params.userId } : {}),
      type: params.type,
      ...(params.targetRef !== undefined ? { targetRef: params.targetRef } : {}),
      ...(mergedDetails !== undefined ? { details: mergedDetails } : {}),
      logger: log,
    });
  };
}

async function main(): Promise<void> {
  const redis = new Redis(env.REDIS_URL, { lazyConnect: false, maxRetriesPerRequest: 3 });
  const prisma = getPrisma();

  // Fail-fast on dep outage (safety rule #8) — no silent partial boot.
  try {
    await redis.ping();
  } catch (err) {
    logger.fatal({ err }, "redis unavailable at startup; exiting");
    process.exit(1);
  }
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    logger.fatal({ err }, "postgres unavailable at startup; exiting");
    process.exit(1);
  }

  const authStore = makeAuthStore(redis, logger);
  const snapshotter: SnapshotScheduler = makeSnapshotScheduler(prisma, authStore, logger);
  const audit = makeWorkerAudit(prisma, env.MASTER_KEY_BYTES, logger);

  // Socket registry: keyed by userId so enqueueMedia adapters can look up the
  // live WASocket to call downloadMediaMessage on the raw Baileys message.
  const socketRegistry = new Map<string, SocketHandle["sock"]>();

  // Media downloader — shared singleton across all users.
  const mediaStore = makeLocalDiskMediaStore(env.MEDIA_DIR);
  const mediaDownloader = new MediaDownloader({
    mediaStore,
    redis,
    getPrisma: () => prisma,
    logger,
    perUserConcurrency: env.MEDIA_CONCURRENCY_USER,
    globalConcurrency: env.MEDIA_CONCURRENCY_GLOBAL,
    maxBytes: env.MEDIA_MAX_BYTES,
    queuePerUserMax: env.MEDIA_QUEUE_PER_USER,
    audit: (userId, subtype, details) =>
      writeAudit({
        prisma,
        masterKey: env.MASTER_KEY_BYTES,
        userId,
        type: "ingest",
        details: details ? { subtype, ...details } : { subtype },
        logger,
      }),
  });

  // Track per-user ingest teardown handles.
  const ingestUnsubscribers = new Map<string, () => void>();
  const ingestConsumers = new Map<string, ConsumerHandle>();

  // In-flight guard: prevents a concurrent second onSocketReady call for the
  // same userId from passing the map-based guard before the first await resolves.
  const startingIngest = new Map<string, Promise<void>>();

  async function _startIngest(userId: string, handle: SocketHandle): Promise<void> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { encryptedDek: true },
      });
      if (!user) {
        logger.error({ userId }, "startIngest: user not found");
        return;
      }
      const wrapped = parseCiphertext(Buffer.from(user.encryptedDek).toString("utf8"));
      const dek = unwrapDek(env.MASTER_KEY_BYTES, wrapped);

      // Register the socket so the enqueueMedia adapter can call downloadMediaMessage.
      socketRegistry.set(userId, handle.sock);

      const { unsubscribe } = subscribe(userId, handle.sock, redis, logger);
      ingestUnsubscribers.set(userId, unsubscribe);

      const consumer = await startConsumer({
        userId,
        prisma,
        redis,
        dek,
        masterKey: env.MASTER_KEY_BYTES,
        logger,
        // Adapter: consume.ts threads the raw WAMessage alongside the normalized
        // input so we can call Baileys' downloadMediaMessage here.
        enqueueMedia: (input) => {
          const sock = socketRegistry.get(userId);
          if (!sock) {
            logger.warn({ userId }, "enqueueMedia: no socket registered for user; skipping");
            return;
          }
          const rawMsg: WAMessage = input.raw;
          mediaDownloader.enqueue({
            userId,
            messageId: input.messageId,
            dek,
            mimeType: input.normalized.body.mediaMeta?.mimeType,
            download: () => downloadMediaMessage(rawMsg, "buffer", {}),
          });
        },
      });
      ingestConsumers.set(userId, consumer);
    } catch (err) {
      // Partial-start cleanup — prevents subsequent onSocketReady from hitting the guard
      // with a dangling unsubscriber that has no consumer behind it.
      socketRegistry.delete(userId);
      ingestUnsubscribers.get(userId)?.();
      ingestUnsubscribers.delete(userId);
      ingestConsumers.get(userId)?.stop();
      ingestConsumers.delete(userId);
      logger.error({ err, userId }, "startIngest failed");
    }
  }

  async function startIngest(userId: string, handle: SocketHandle): Promise<void> {
    // Avoid double-wiring if already active or in-flight.
    if (
      ingestUnsubscribers.has(userId) ||
      ingestConsumers.has(userId) ||
      startingIngest.has(userId)
    ) {
      return;
    }
    const p = _startIngest(userId, handle);
    startingIngest.set(userId, p);
    try {
      await p;
    } finally {
      startingIngest.delete(userId);
    }
  }

  function stopIngest(userId: string): void {
    socketRegistry.delete(userId);
    const unsub = ingestUnsubscribers.get(userId);
    if (unsub) {
      unsub();
      ingestUnsubscribers.delete(userId);
    }
    const consumer = ingestConsumers.get(userId);
    if (consumer) {
      consumer.stop();
      ingestConsumers.delete(userId);
    }
  }

  const pairMachine = new PairMachine(
    {
      onStateChange: (userId, next) => {
        redis
          .set(`wpa:wa-session:${userId}:state`, next)
          .catch((err: unknown) => logger.error({ err, userId }, "redis set state failed"));
        const dbStatus =
          next === "paired"
            ? "paired"
            : next === "expired"
              ? "expired"
              : next === "error"
                ? "disconnected"
                : "pairing";
        prisma.whatsappSession
          .update({ where: { userId }, data: { status: dbStatus } })
          // Session row may not exist on first-ever pair — init happens in API.
          .catch((err: unknown) => {
            logger.debug({ err, userId, dbStatus }, "session status update skipped (row missing?)");
          });
      },
      onQr: (userId, png) => {
        redis
          .set(`wpa:pair:${userId}:qr`, png, "EX", 30)
          .catch((err: unknown) => logger.error({ err, userId }, "redis set qr failed"));
      },
      onPaired: (userId, info) => {
        void (async () => {
          try {
            const user = await prisma.user.findUnique({
              where: { id: userId },
              select: { encryptedDek: true },
            });
            if (!user) {
              logger.error({ userId }, "onPaired: user not found");
              return;
            }
            const wrapped = parseCiphertext(Buffer.from(user.encryptedDek).toString("utf8"));
            const dek = unwrapDek(env.MASTER_KEY_BYTES, wrapped);
            const encryptedPhone = Buffer.from(
              serializeCiphertext(encryptWithKey(dek, info.phoneNumber)),
            );
            await prisma.whatsappSession.update({
              where: { userId },
              data: {
                phoneNumber: encryptedPhone,
                status: "paired",
                lastConnectedAt: new Date(),
              },
            });
            snapshotter.start(userId, dek);
            // Immediate flush so the first restart survives even without the
            // 15s interval firing yet.
            await snapshotter.flushNow(userId, dek);
            await audit({
              userId,
              type: "pair",
              subtype: "success",
              details: { platform: info.platform },
            });
          } catch (err) {
            logger.error({ err, userId }, "onPaired handler failed");
          }
        })();
      },
      onCredsUpdate: (userId, creds) => {
        void (async () => {
          try {
            const user = await prisma.user.findUnique({
              where: { id: userId },
              select: { encryptedDek: true },
            });
            if (!user) {
              logger.error({ userId }, "onCredsUpdate: user not found");
              return;
            }
            const wrapped = parseCiphertext(Buffer.from(user.encryptedDek).toString("utf8"));
            const dek = unwrapDek(env.MASTER_KEY_BYTES, wrapped);
            await authStore.saveCreds(userId, dek, creds);
          } catch (err) {
            logger.error({ err, userId }, "onCredsUpdate handler failed");
          }
        })();
      },
      onError: (userId, err) => {
        logger.error({ userId, err }, "pair error");
        redis
          .set(`wpa:wa-session:${userId}:state`, "error")
          .catch((e: unknown) => logger.error({ err: e, userId }, "redis set error state failed"));
        snapshotter.stop(userId);
        stopIngest(userId);
        authStore
          .clear(userId)
          .catch((e: unknown) => logger.error({ err: e, userId }, "authStore clear failed"));
        void audit({
          userId,
          type: "pair",
          subtype: "failed",
          details: { error: err.message },
        });
      },
      onSocketReady: (userId, handle) => {
        void startIngest(userId, handle);
      },
    },
    { logger },
  );

  // Boot-time restore BEFORE starting the command subscriber so restored
  // sessions are online before the API starts dispatching new pair commands.
  try {
    const summary = await restorePairedSessions({
      prisma,
      authStore,
      pairMachine,
      snapshotter,
      masterKey: env.MASTER_KEY_BYTES,
      logger,
      writeAudit: (userId, subtype, details) =>
        audit({
          userId,
          type: "pair",
          subtype,
          ...(details !== undefined ? { details } : {}),
        }),
    });
    logger.info(summary, "restored paired sessions on boot");
  } catch (err) {
    logger.error({ err }, "restore pass failed (continuing — individual sessions are skipped)");
  }

  const stopPair = await startPairWorker({ redis, pairMachine, logger });
  logger.info(
    "worker started (pair flow + encrypted persistence + media download ready; P1-B IB4)",
  );

  const shutdown = async (): Promise<void> => {
    if (!running) return;
    running = false;
    logger.info("shutdown: flushing snapshots + closing pair worker");
    // Stop all ingest consumers and unsubscribe from socket events.
    for (const userId of Array.from(ingestUnsubscribers.keys())) {
      stopIngest(userId);
    }
    // Wait for in-flight consumer loops to exit.
    await Promise.allSettled(Array.from(ingestConsumers.values()).map((c) => c.done));
    // Drain media downloader (in-flight downloads complete; queued jobs dropped).
    try {
      await mediaDownloader.stop();
    } catch (err) {
      logger.warn({ err }, "mediaDownloader.stop failed during shutdown");
    }
    try {
      await snapshotter.shutdown();
    } catch (err) {
      logger.warn({ err }, "snapshotter.shutdown failed");
    }
    try {
      await stopPair();
    } catch (err) {
      logger.warn({ err }, "stopPair failed during shutdown");
    }
    try {
      await redis.quit();
    } catch (err) {
      logger.warn({ err }, "redis.quit failed during shutdown");
    }
    try {
      await prisma.$disconnect();
    } catch (err) {
      logger.warn({ err }, "prisma.$disconnect failed during shutdown");
    }
    process.exit(0);
  };
  process.on("SIGTERM", () => {
    void shutdown();
  });
  process.on("SIGINT", () => {
    void shutdown();
  });

  while (running) {
    await new Promise((r) => setTimeout(r, 30_000));
    logger.debug("heartbeat");
  }
}

void main();
