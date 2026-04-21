import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { makeTestRedis, type TestRedis } from "./redis.js";

describe("makeTestRedis", () => {
  let redis: TestRedis;

  beforeAll(async () => {
    redis = await makeTestRedis();
  }, 120_000);

  afterAll(async () => {
    await redis.teardown();
  }, 30_000);

  it("returns a redis connection URL", () => {
    expect(redis.url).toMatch(/^redis:\/\//);
  });

  it("can SET and GET a key", async () => {
    await redis.client.set("hello", "world");
    const value = await redis.client.get("hello");
    expect(value).toBe("world");
  });

  it("runs with appendonly enabled (AOF durability)", async () => {
    const info = await redis.client.config("GET", "appendonly");
    // ioredis returns [key, value]
    expect(info).toEqual(["appendonly", "yes"]);
  });
});
