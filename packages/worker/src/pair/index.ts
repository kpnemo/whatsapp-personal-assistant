import { hostname } from "node:os";

import type { Redis } from "ioredis";
import type { Logger } from "pino";

import type { PairMachine } from "./state.js";

export const PAIR_CMD_STREAM = "wpa:pair-cmd";
export const PAIR_CMD_GROUP = "worker-pair";

const READ_COUNT = 10;
const BLOCK_MS = 5_000;

interface PairCommand {
  type: "init" | "stop";
  userId: string;
}

function parseCommand(fields: string[]): PairCommand | null {
  // Redis returns ["key", "value", "key", "value", …]
  const obj: Record<string, string> = {};
  for (let i = 0; i < fields.length - 1; i += 2) {
    const k = fields[i];
    const v = fields[i + 1];
    if (typeof k === "string" && typeof v === "string") {
      obj[k] = v;
    }
  }
  const { type, userId } = obj;
  if ((type !== "init" && type !== "stop") || typeof userId !== "string" || userId === "") {
    return null;
  }
  return { type, userId };
}

async function ensureGroup(redis: Redis, logger: Logger): Promise<void> {
  try {
    // MKSTREAM lets us create the stream + group in one shot.
    await redis.xgroup("CREATE", PAIR_CMD_STREAM, PAIR_CMD_GROUP, "$", "MKSTREAM");
    logger.info({ stream: PAIR_CMD_STREAM, group: PAIR_CMD_GROUP }, "created pair command group");
  } catch (err) {
    // BUSYGROUP is normal on subsequent boots.
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("BUSYGROUP")) {
      logger.debug({ stream: PAIR_CMD_STREAM, group: PAIR_CMD_GROUP }, "pair group already exists");
      return;
    }
    throw err;
  }
}

export interface StartPairWorkerOpts {
  redis: Redis;
  pairMachine: PairMachine;
  logger: Logger;
  /**
   * Override for tests so they don't spin forever. Defaults to the real
   * subscriber loop; tests may pass `false` to disable blocking reads.
   */
  blockMs?: number;
}

/**
 * Spins up a Redis-stream-based consumer for pair commands and returns a
 * disposer. The disposer halts the read loop and stops all active
 * `PairMachine` sessions.
 */
export async function startPairWorker(opts: StartPairWorkerOpts): Promise<() => Promise<void>> {
  const { redis, pairMachine, logger } = opts;
  const blockMs = opts.blockMs ?? BLOCK_MS;
  const log = logger.child({ name: "pair-worker" });

  await ensureGroup(redis, log);

  const consumer = `worker-${hostname()}-${process.pid.toString()}`;
  log.info({ consumer, stream: PAIR_CMD_STREAM, group: PAIR_CMD_GROUP }, "starting pair worker");

  const activeUsers = new Set<string>();
  let running = true;
  let loopDone: Promise<void> | null = null;

  const runLoop = async (): Promise<void> => {
    while (running) {
      let response: Awaited<ReturnType<Redis["xreadgroup"]>> | null = null;
      try {
        response = await redis.xreadgroup(
          "GROUP",
          PAIR_CMD_GROUP,
          consumer,
          "COUNT",
          READ_COUNT,
          "BLOCK",
          blockMs,
          "STREAMS",
          PAIR_CMD_STREAM,
          ">",
        );
      } catch (err) {
        if (!running) return;
        log.warn({ err }, "xreadgroup failed; backing off");
        await new Promise((r) => setTimeout(r, 1_000));
        continue;
      }

      if (!response) continue;
      // ioredis shape: [[streamName, [[msgId, fields[]], …]], …]
      const arr = response as [string, [string, string[]][]][];
      for (const [, messages] of arr) {
        for (const [msgId, fields] of messages) {
          const cmd = parseCommand(fields);
          if (!cmd) {
            log.warn({ msgId, fields }, "dropping malformed pair command");
            await redis.xack(PAIR_CMD_STREAM, PAIR_CMD_GROUP, msgId);
            continue;
          }
          log.info({ msgId, cmd }, "dispatching pair command");
          try {
            if (cmd.type === "init") {
              activeUsers.add(cmd.userId);
              await pairMachine.start(cmd.userId, null);
            } else {
              activeUsers.delete(cmd.userId);
              await pairMachine.stop(cmd.userId);
            }
          } catch (err) {
            log.error({ err, msgId, cmd }, "pair dispatch failed");
            // Fall through to ack — DLQ is a later concern.
          }
          await redis.xack(PAIR_CMD_STREAM, PAIR_CMD_GROUP, msgId);
        }
      }
    }
  };

  loopDone = runLoop().catch((err: unknown) => {
    log.error({ err }, "pair worker loop exited with error");
  });

  return async () => {
    log.info("stopping pair worker");
    running = false;
    // Draining: wait for the current blocking XREADGROUP to return (up to
    // blockMs) then run user stops.
    if (loopDone !== null) {
      await loopDone;
    }
    for (const userId of Array.from(activeUsers)) {
      try {
        await pairMachine.stop(userId);
      } catch (err) {
        log.warn({ err, userId }, "failed stopping pair machine during shutdown");
      }
    }
    activeUsers.clear();
    log.info("pair worker stopped");
  };
}
