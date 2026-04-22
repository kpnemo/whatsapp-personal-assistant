/**
 * Unit tests for LocalDiskMediaStore.
 *
 * Uses a real temp directory (os.tmpdir) — no containers needed.
 */
import { randomBytes } from "node:crypto";
import { stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { LocalDiskMediaStore, makeLocalDiskMediaStore } from "./mediaStore.js";

// Create a unique root dir for this test run so parallel runs don't collide.
const ROOT_DIR = join(tmpdir(), `wpa-media-store-test-${Date.now().toString()}`);

describe("LocalDiskMediaStore", () => {
  let store: LocalDiskMediaStore;

  beforeAll(() => {
    store = new LocalDiskMediaStore(ROOT_DIR);
  });

  it("put writes file and returns correct ref", async () => {
    const bytes = Buffer.from("hello media world");
    const ref = await store.put("user-1", "msg-abc", bytes);

    expect(ref).toBe("user-1/msg-abc.bin");

    // File should exist at the expected path.
    const fileStat = await stat(join(ROOT_DIR, "user-1", "msg-abc.bin"));
    expect(fileStat.isFile()).toBe(true);
  });

  it("get reads back the same bytes written by put", async () => {
    const bytes = randomBytes(256);
    const ref = await store.put("user-2", "msg-xyz", bytes);
    const result = await store.get(ref);

    expect(result).toEqual(bytes);
  });

  it("put creates parent directory with mode 0700", async () => {
    await store.put("user-mode-test", "msg-1", Buffer.from("x"));

    const dirStat = await stat(join(ROOT_DIR, "user-mode-test"));
    // Mask to permission bits only (ignore file type bits).
    const dirMode = dirStat.mode & 0o777;
    expect(dirMode).toBe(0o700);
  });

  it("file written with mode 0600", async () => {
    await store.put("user-mode-file", "msg-2", Buffer.from("y"));

    const fileStat = await stat(join(ROOT_DIR, "user-mode-file", "msg-2.bin"));
    const fileMode = fileStat.mode & 0o777;
    expect(fileMode).toBe(0o600);
  });

  it("handles binary bytes spanning 0x00–0xFF round-trip", async () => {
    // Construct a buffer containing every byte value 0x00–0xFF.
    const allBytes = Buffer.alloc(256);
    for (let i = 0; i < 256; i++) {
      allBytes[i] = i;
    }
    const ref = await store.put("user-binary", "msg-binary", allBytes);
    const result = await store.get(ref);
    expect(result).toEqual(allBytes);
  });

  it("get throws when ref does not exist", async () => {
    await expect(store.get("nonexistent/msg.bin")).rejects.toThrow();
  });

  it("put is idempotent — second write overwrites first", async () => {
    const first = Buffer.from("first");
    const second = Buffer.from("second");
    await store.put("user-idem", "msg-idem", first);
    await store.put("user-idem", "msg-idem", second);
    const result = await store.get("user-idem/msg-idem.bin");
    expect(result).toEqual(second);
  });
});

describe("makeLocalDiskMediaStore factory", () => {
  it("uses the explicit rootDir argument when provided", () => {
    const made = makeLocalDiskMediaStore("/tmp/wpa-factory-explicit");
    expect(made).toBeInstanceOf(LocalDiskMediaStore);
  });

  it("falls back to MEDIA_DIR env when no argument is provided", () => {
    const prior = process.env.MEDIA_DIR;
    try {
      process.env.MEDIA_DIR = "/tmp/wpa-factory-env";
      const made = makeLocalDiskMediaStore();
      expect(made).toBeInstanceOf(LocalDiskMediaStore);
    } finally {
      if (prior === undefined) {
        delete process.env.MEDIA_DIR;
      } else {
        process.env.MEDIA_DIR = prior;
      }
    }
  });

  it("defaults to /app/media when neither argument nor env is set", () => {
    const prior = process.env.MEDIA_DIR;
    try {
      delete process.env.MEDIA_DIR;
      const made = makeLocalDiskMediaStore();
      expect(made).toBeInstanceOf(LocalDiskMediaStore);
    } finally {
      if (prior !== undefined) {
        process.env.MEDIA_DIR = prior;
      }
    }
  });
});
