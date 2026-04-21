import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { Redis } from "ioredis";

export interface TestRedis {
  url: string;
  client: Redis;
  teardown: () => Promise<void>;
}

/**
 * Spin up a disposable redis:7-alpine container with AOF durability on
 * (matches production config in docker-compose.yml).
 *
 * Teardown quits the client and stops the container — call it in afterAll/finally.
 */
export async function makeTestRedis(): Promise<TestRedis> {
  const container: StartedRedisContainer = await new RedisContainer("redis:7-alpine")
    .withCommand(["redis-server", "--appendonly", "yes"])
    .start();

  const url = container.getConnectionUrl();
  const client = new Redis(url, { lazyConnect: false, maxRetriesPerRequest: 3 });

  return {
    url,
    client,
    teardown: async () => {
      // quit() waits for pending commands to drain; disconnect() is harder.
      try {
        await client.quit();
      } catch {
        client.disconnect();
      }
      await container.stop();
    },
  };
}
