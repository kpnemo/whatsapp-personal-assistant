import { describe, expect, it } from "vitest";

import { parseEnv } from "./env.js";

const valid = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://user:pass@db:5432/wpa",
  REDIS_URL: "redis://redis:6379",
  JWT_SECRET: "a".repeat(64),
  MASTER_KEY: Buffer.alloc(32, 1).toString("base64"),
  API_PORT: "3000",
  PUBLIC_ORIGIN: "https://example.com",
  OPEN_REGISTRATION: "false",
};

describe("parseEnv", () => {
  it("accepts a valid env", () => {
    const env = parseEnv(valid);
    expect(env.API_PORT).toBe(3000);
    expect(env.OPEN_REGISTRATION).toBe(false);
    expect(env.MASTER_KEY_BYTES.length).toBe(32);
  });

  it("rejects MASTER_KEY with wrong decoded length", () => {
    expect(() =>
      parseEnv({ ...valid, MASTER_KEY: Buffer.alloc(16, 1).toString("base64") }),
    ).toThrow(/32 bytes/);
  });

  it("rejects short JWT_SECRET", () => {
    expect(() => parseEnv({ ...valid, JWT_SECRET: "short" })).toThrow(/at least 32/);
  });

  it("rejects non-postgres DATABASE_URL", () => {
    expect(() => parseEnv({ ...valid, DATABASE_URL: "mysql://x" })).toThrow(/postgres/);
  });

  it("defaults OPEN_REGISTRATION to false", () => {
    const { OPEN_REGISTRATION: _drop, ...rest } = valid;
    void _drop;
    const env = parseEnv(rest);
    expect(env.OPEN_REGISTRATION).toBe(false);
  });

  it("uses default values for new P1-B env vars", () => {
    const env = parseEnv(valid);
    expect(env.MEDIA_DIR).toBe("/app/media");
    expect(env.MEDIA_MAX_BYTES).toBe(33_554_432);
    expect(env.INGEST_DLQ_MAX_DELIVERIES).toBe(3);
    expect(env.SSE_MAX_STREAMS_PER_USER).toBe(3);
    expect(env.MESSAGE_RETENTION_DAYS).toBe(0);
  });

  it("parses P1-B env overrides from strings", () => {
    const env = parseEnv({
      ...valid,
      MEDIA_MAX_BYTES: "67108864",
      SSE_MAX_STREAMS_PER_USER: "5",
    });
    expect(env.MEDIA_MAX_BYTES).toBe(67_108_864);
    expect(env.SSE_MAX_STREAMS_PER_USER).toBe(5);
  });
});
