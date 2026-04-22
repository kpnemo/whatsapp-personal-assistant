import type { WASocket } from "@whiskeysockets/baileys";
import type { Redis } from "ioredis";
import type { Logger } from "pino";

import { shouldIngest } from "./filter.js";

/**
 * Stream key for the raw ingest stream for a given user.
 * Consumer reads from this; subscriber XADDs to it.
 */
export function ingestStreamKey(userId: string): string {
  return `wpa:msg:ingest:${userId}`;
}

export interface SubscribeResult {
  unsubscribe: () => void;
}

/**
 * Wire `sock.ev.on("messages.upsert", ...)` for `userId`.
 *
 * For each message that passes `shouldIngest`, the raw WAMessage is JSON-
 * serialised and XADD'd to `wpa:msg:ingest:<userId>`.  The stream is
 * capped at 10 000 entries (MAXLEN ~ approximate) to bound Redis memory.
 *
 * Returns an `unsubscribe` function that removes the event listener
 * (Baileys `ev.off`).
 */
export function subscribe(
  userId: string,
  sock: WASocket,
  redis: Redis,
  logger: Logger,
): SubscribeResult {
  const log = logger.child({ name: "ingest.subscribe", userId });
  const streamKey = ingestStreamKey(userId);

  const handler = ({ messages }: { messages: unknown[] }): void => {
    for (const raw of messages) {
      // Narrow type: Baileys guarantees WAMessage here but we can't import
      // the type narrowly without a cast.
      const msg = raw as Parameters<typeof shouldIngest>[0];

      if (!shouldIngest(msg)) {
        continue;
      }

      let payload: string;
      try {
        payload = JSON.stringify(msg);
      } catch (err) {
        log.warn({ err }, "failed to serialize raw message; skipping");
        continue;
      }

      // Fire-and-forget XADD. If Redis is down the message is lost — the
      // retry / reconnect layer is the consumer's concern.
      redis.xadd(streamKey, "MAXLEN", "~", "10000", "*", "raw", payload).catch((err: unknown) => {
        log.error({ err }, "XADD to ingest stream failed");
      });
    }
  };

  // Baileys emits { messages: WAMessage[], type: MessageUpsertType }
  sock.ev.on("messages.upsert", handler);

  log.info({ stream: streamKey }, "subscribed to messages.upsert");

  return {
    unsubscribe: () => {
      sock.ev.off("messages.upsert", handler);
      log.info({ stream: streamKey }, "unsubscribed from messages.upsert");
    },
  };
}
