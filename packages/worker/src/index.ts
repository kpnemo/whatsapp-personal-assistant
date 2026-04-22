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
import { makeAuthStore } from "./pair/authStore.js";
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
  logger.info("worker started (pair flow + encrypted persistence ready; P1-A PA3)");

  const shutdown = async (): Promise<void> => {
    if (!running) return;
    running = false;
    logger.info("shutdown: flushing snapshots + closing pair worker");
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
