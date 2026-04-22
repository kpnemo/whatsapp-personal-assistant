import { Redis } from "ioredis";

import { env } from "./env.js";

let client: Redis | undefined;

const REDIS_OPTS = { lazyConnect: false, maxRetriesPerRequest: 3 } as const;

export function getRedis(): Redis {
  client ??= new Redis(env.REDIS_URL, REDIS_OPTS);
  return client;
}

/**
 * Return a new, independent Redis client suitable for subscribe-mode use.
 *
 * ioredis connections that have called subscribe() can no longer issue regular
 * commands, so SSE route handlers construct a dedicated client per stream via
 * this helper rather than sharing the main client.  We export the factory so
 * tests can also exercise subscriber lifecycle without touching the main client.
 */
export function createSubscriberClient(): Redis {
  return new Redis(env.REDIS_URL, REDIS_OPTS);
}

export async function disconnectRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = undefined;
  }
}
