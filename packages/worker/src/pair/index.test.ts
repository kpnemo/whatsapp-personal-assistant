import type { Redis } from "ioredis";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PairMachine } from "./state.js";

import { PAIR_CMD_GROUP, PAIR_CMD_STREAM, startPairWorker } from "./index.js";

const fakeLogger = {
  level: "info",
  child: () => fakeLogger,
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  fatal: vi.fn(),
} as unknown as Parameters<typeof startPairWorker>[0]["logger"];

interface StreamEntry {
  id: string;
  fields: string[];
}

/**
 * Hand-rolled in-memory Redis stub covering the subset of commands used by
 * `startPairWorker`: xgroup, xreadgroup, xack, xadd, xpending summary, and
 * quit. ioredis-mock@8 does not implement the streams consumer-group API
 * despite what its compat table suggests, so we model exactly what we call.
 */
interface GroupState {
  lastDeliveredId: string;
  pending: Map<string, string>;
}

class FakeRedis {
  /** entries per stream, ordered by append */
  private streams = new Map<string, StreamEntry[]>();
  /** consumer groups per stream: stream → group name → { lastDeliveredId, pending: msgId→consumer } */
  private groups = new Map<string, Map<string, GroupState>>();
  private seq = 0;
  private quitted = false;

  private nextId(): string {
    this.seq += 1;
    return `${Date.now().toString()}-${this.seq.toString()}`;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async xgroup(
    cmd: string,
    stream: string,
    group: string,
    id: string,
    mkStream?: string,
  ): Promise<string> {
    if (cmd !== "CREATE") throw new Error(`unsupported xgroup subcommand: ${cmd}`);
    const existing = this.groups.get(stream);
    if (existing?.has(group)) {
      throw new Error("BUSYGROUP Consumer Group name already exists");
    }
    if (!this.streams.has(stream)) {
      if (mkStream === "MKSTREAM") {
        this.streams.set(stream, []);
      } else {
        throw new Error("ERR no such key");
      }
    }
    const groupMap: Map<string, GroupState> = existing ?? new Map<string, GroupState>();
    groupMap.set(group, {
      lastDeliveredId: id === "$" ? this.lastId(stream) : id,
      pending: new Map(),
    });
    this.groups.set(stream, groupMap);
    return "OK";
  }

  private lastId(stream: string): string {
    const entries = this.streams.get(stream) ?? [];
    return entries.length === 0 ? "0-0" : (entries.at(-1)?.id ?? "0-0");
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async xadd(stream: string, id: string, ...fieldPairs: string[]): Promise<string> {
    const realId = id === "*" ? this.nextId() : id;
    const arr = this.streams.get(stream) ?? [];
    arr.push({ id: realId, fields: fieldPairs });
    this.streams.set(stream, arr);
    return realId;
  }

  /**
   * Simplified signature matching ioredis-mock: positional args in the order
   * GROUP, <group>, <consumer>, COUNT, <n>, BLOCK, <ms>, STREAMS, <stream>, >
   * Returns null if nothing pending for the group (never blocks — tests sleep
   * with real timers to simulate block behavior).
   */
  async xreadgroup(...args: (string | number)[]): Promise<unknown> {
    // parse: GROUP, g, c, COUNT, n, BLOCK, b, STREAMS, stream, >
    const argMap: Record<string, string | number> = {};
    for (let i = 0; i < args.length; i += 1) {
      const tok = args[i];
      if (tok === "GROUP") {
        argMap.GROUP = String(args[i + 1]);
        argMap.CONSUMER = String(args[i + 2]);
        i += 2;
      } else if (tok === "COUNT") {
        argMap.COUNT = Number(args[i + 1]);
        i += 1;
      } else if (tok === "BLOCK") {
        argMap.BLOCK = Number(args[i + 1]);
        i += 1;
      } else if (tok === "STREAMS") {
        argMap.STREAM = String(args[i + 1]);
        // argMap.LASTID = String(args[i + 2]); // always ">" for new msgs
        i += 2;
      }
    }
    const stream = String(argMap.STREAM);
    const groupName = String(argMap.GROUP);
    const consumer = String(argMap.CONSUMER);
    const count = Number(argMap.COUNT ?? 10);
    const blockMs = Number(argMap.BLOCK ?? 0);

    const groupMap = this.groups.get(stream);
    const group = groupMap?.get(groupName);
    if (!group) throw new Error("NOGROUP");

    const entries = this.streams.get(stream) ?? [];
    // Pick entries with id > lastDeliveredId (string compare works for same-
    // digit-width timestamp-seq ids used in xadd here).
    const fresh: StreamEntry[] = [];
    for (const e of entries) {
      if (this.compareIds(e.id, group.lastDeliveredId) > 0) {
        fresh.push(e);
        if (fresh.length >= count) break;
      }
    }
    if (fresh.length === 0) {
      // Simulate BLOCK — sleep briefly then return null.
      if (blockMs > 0) {
        await new Promise((r) => setTimeout(r, Math.min(blockMs, 20)));
      }
      return null;
    }
    for (const e of fresh) {
      group.lastDeliveredId = e.id;
      group.pending.set(e.id, consumer);
    }
    return [[stream, fresh.map((e) => [e.id, e.fields])]];
  }

  private compareIds(a: string, b: string): number {
    const [aMs, aSeq] = a.split("-").map(Number) as [number, number];
    const [bMs, bSeq] = b.split("-").map(Number) as [number, number];
    if (aMs !== bMs) return aMs - bMs;
    return aSeq - bSeq;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async xack(stream: string, groupName: string, ...msgIds: string[]): Promise<number> {
    const g = this.groups.get(stream)?.get(groupName);
    if (!g) return 0;
    let acked = 0;
    for (const id of msgIds) {
      if (g.pending.delete(id)) acked += 1;
    }
    return acked;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async xpending(stream: string, groupName: string): Promise<unknown> {
    const g = this.groups.get(stream)?.get(groupName);
    if (!g || g.pending.size === 0) return [0, null, null, null];
    return [g.pending.size, "0-0", "0-0", []];
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async xinfo(_sub: string, stream: string): Promise<unknown> {
    const groupMap = this.groups.get(stream);
    if (!groupMap) return [];
    return Array.from(groupMap.keys()).map((g) => ["name", g]);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async quit(): Promise<"OK"> {
    this.quitted = true;
    return "OK";
  }

  isQuitted(): boolean {
    return this.quitted;
  }
}

function makeFakePairMachine(): PairMachine & {
  starts: string[];
  stops: string[];
} {
  const starts: string[] = [];
  const stops: string[] = [];
  return {
    starts,
    stops,
    start: vi.fn((userId: string) => {
      starts.push(userId);
      return Promise.resolve();
    }),
    stop: vi.fn((userId: string) => {
      stops.push(userId);
      return Promise.resolve();
    }),
    getState: () => "idle",
  } as unknown as PairMachine & { starts: string[]; stops: string[] };
}

async function waitFor(check: () => boolean, timeoutMs = 2_000, pollMs = 10): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error("waitFor timed out");
}

describe("startPairWorker", () => {
  let redis: FakeRedis;

  beforeEach(() => {
    redis = new FakeRedis();
  });

  afterEach(async () => {
    await redis.quit();
  });

  it("creates the consumer group on first run", async () => {
    const pairMachine = makeFakePairMachine();
    const stop = await startPairWorker({
      redis: redis as unknown as Redis,
      pairMachine,
      logger: fakeLogger,
      blockMs: 10,
    });
    const info = (await redis.xinfo("GROUPS", PAIR_CMD_STREAM)) as unknown[];
    expect(info.length).toBeGreaterThanOrEqual(1);
    await stop();
  });

  it("is idempotent on re-entry (BUSYGROUP ignored)", async () => {
    const pairMachine = makeFakePairMachine();
    const stop1 = await startPairWorker({
      redis: redis as unknown as Redis,
      pairMachine,
      logger: fakeLogger,
      blockMs: 10,
    });
    await stop1();
    const stop2 = await startPairWorker({
      redis: redis as unknown as Redis,
      pairMachine,
      logger: fakeLogger,
      blockMs: 10,
    });
    await stop2();
  });

  it("dispatches { type: 'init' } commands to pairMachine.start", async () => {
    const pairMachine = makeFakePairMachine();
    const stop = await startPairWorker({
      redis: redis as unknown as Redis,
      pairMachine,
      logger: fakeLogger,
      blockMs: 10,
    });
    await redis.xadd(PAIR_CMD_STREAM, "*", "type", "init", "userId", "u1");
    await waitFor(() => pairMachine.starts.includes("u1"));
    expect(pairMachine.starts).toEqual(["u1"]);
    await stop();
  });

  it("dispatches { type: 'stop' } commands to pairMachine.stop", async () => {
    const pairMachine = makeFakePairMachine();
    const stop = await startPairWorker({
      redis: redis as unknown as Redis,
      pairMachine,
      logger: fakeLogger,
      blockMs: 10,
    });
    await redis.xadd(PAIR_CMD_STREAM, "*", "type", "stop", "userId", "u2");
    await waitFor(() => pairMachine.stops.includes("u2"));
    expect(pairMachine.stops).toEqual(["u2"]);
    await stop();
  });

  it("XACKs messages after dispatch (pending is cleared)", async () => {
    const pairMachine = makeFakePairMachine();
    const stop = await startPairWorker({
      redis: redis as unknown as Redis,
      pairMachine,
      logger: fakeLogger,
      blockMs: 10,
    });
    const msgId = await redis.xadd(PAIR_CMD_STREAM, "*", "type", "init", "userId", "u3");
    await waitFor(() => pairMachine.starts.includes("u3"));
    // Let the loop do one more tick so the XACK completes.
    await new Promise((r) => setTimeout(r, 50));
    const pending = (await redis.xpending(PAIR_CMD_STREAM, PAIR_CMD_GROUP)) as unknown[];
    expect(pending[0]).toBe(0);
    expect(msgId).toMatch(/^\d+-\d+$/);
    await stop();
  });

  it("malformed messages are dropped and ACK'd, no dispatch", async () => {
    const pairMachine = makeFakePairMachine();
    const stop = await startPairWorker({
      redis: redis as unknown as Redis,
      pairMachine,
      logger: fakeLogger,
      blockMs: 10,
    });
    await redis.xadd(PAIR_CMD_STREAM, "*", "garbage", "true");
    await new Promise((r) => setTimeout(r, 100));
    expect(pairMachine.starts).toHaveLength(0);
    expect(pairMachine.stops).toHaveLength(0);
    const pending = (await redis.xpending(PAIR_CMD_STREAM, PAIR_CMD_GROUP)) as unknown[];
    expect(pending[0]).toBe(0);
    await stop();
  });

  it("stop function halts the loop and stops active pair machines", async () => {
    const pairMachine = makeFakePairMachine();
    const stop = await startPairWorker({
      redis: redis as unknown as Redis,
      pairMachine,
      logger: fakeLogger,
      blockMs: 10,
    });
    await redis.xadd(PAIR_CMD_STREAM, "*", "type", "init", "userId", "userActive");
    await waitFor(() => pairMachine.starts.includes("userActive"));
    await stop();
    expect(pairMachine.stops).toContain("userActive");
  });
});
