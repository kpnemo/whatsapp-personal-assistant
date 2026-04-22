import { Redis } from "ioredis";
import { pino } from "pino";

import { env } from "./env.js";
import { startPairWorker } from "./pair/index.js";
import { PairMachine } from "./pair/state.js";

const logger = pino({ level: env.LOG_LEVEL, name: "worker" });

let running = true;

async function main(): Promise<void> {
  const redis = new Redis(env.REDIS_URL, { lazyConnect: false, maxRetriesPerRequest: 3 });

  // PA2 writes minimal Redis state directly in the event callbacks. PA3 will
  // wrap these to flush encrypted snapshots into Postgres.
  const pairMachine = new PairMachine(
    {
      onStateChange: (userId, next) => {
        redis
          .set(`wpa:wa-session:${userId}:state`, next)
          .catch((err: unknown) => logger.error({ err, userId }, "redis set state failed"));
      },
      onQr: (userId, png) => {
        redis
          .set(`wpa:pair:${userId}:qr`, png, "EX", 30)
          .catch((err: unknown) => logger.error({ err, userId }, "redis set qr failed"));
      },
      onPaired: (userId, info) => {
        redis
          .hset(`wpa:wa-session:${userId}:creds`, {
            phoneNumber: info.phoneNumber,
            platform: info.platform,
          })
          .catch((err: unknown) => logger.error({ err, userId }, "redis hset creds failed"));
      },
      onError: (userId, err) => {
        logger.error({ userId, err }, "pair error");
        redis
          .set(`wpa:wa-session:${userId}:state`, "error")
          .catch((e: unknown) => logger.error({ err: e, userId }, "redis set error state failed"));
      },
    },
    { logger },
  );

  const stopPair = await startPairWorker({ redis, pairMachine, logger });
  logger.info("worker started (pair flow ready; P1-A PA2)");

  const shutdown = async (): Promise<void> => {
    if (!running) return;
    running = false;
    logger.info("shutdown");
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
