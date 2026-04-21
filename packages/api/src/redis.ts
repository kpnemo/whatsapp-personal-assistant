import { Redis } from "ioredis";

import { env } from "./env.js";

let client: Redis | undefined;

export function getRedis(): Redis {
  client ??= new Redis(env.REDIS_URL, { lazyConnect: false, maxRetriesPerRequest: 3 });
  return client;
}

export async function disconnectRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = undefined;
  }
}
