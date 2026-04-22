import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unit test for packages/db/src/index.ts factory semantics:
 *   - getPrisma() lazily constructs a PrismaClient once
 *   - subsequent calls return the same instance (reference equality)
 *   - disconnectPrisma() calls $disconnect and clears the cache, so the next
 *     getPrisma() call produces a fresh instance
 *
 * We mock @prisma/client so no real DB is required (this file is about the
 * factory, not persistence — schema.test.ts covers real DB behavior).
 */

const disconnectMock = vi.fn<() => Promise<void>>();
let nextInstanceId = 0;

vi.mock("@prisma/client", () => {
  class PrismaClientMock {
    public readonly id: number;
    public readonly args: unknown;
    constructor(args?: unknown) {
      nextInstanceId += 1;
      this.id = nextInstanceId;
      this.args = args;
    }
    $disconnect = disconnectMock;
  }
  return { PrismaClient: PrismaClientMock };
});

beforeEach(() => {
  disconnectMock.mockReset();
  disconnectMock.mockResolvedValue(undefined);
  nextInstanceId = 0;
  // Reset the module so `instance` starts undefined for every test.
  vi.resetModules();
});

afterEach(() => {
  vi.resetModules();
});

describe("getPrisma()", () => {
  it("returns the same instance on repeated calls (singleton)", async () => {
    const { getPrisma } = await import("./index.js");
    const a = getPrisma();
    const b = getPrisma();
    expect(a).toBe(b);
    // Only one construction => id stayed at 1.
    expect((a as unknown as { id: number }).id).toBe(1);
  });

  it("constructs the client with log: ['warn', 'error']", async () => {
    const { getPrisma } = await import("./index.js");
    const client = getPrisma() as unknown as { args: { log: string[] } };
    expect(client.args).toEqual({ log: ["warn", "error"] });
  });
});

describe("disconnectPrisma()", () => {
  it("is a noop when getPrisma has never been called", async () => {
    const { disconnectPrisma } = await import("./index.js");
    await expect(disconnectPrisma()).resolves.toBeUndefined();
    expect(disconnectMock).not.toHaveBeenCalled();
  });

  it("calls $disconnect and clears the cache so getPrisma returns a new instance", async () => {
    const { getPrisma, disconnectPrisma } = await import("./index.js");
    const first = getPrisma();
    await disconnectPrisma();
    expect(disconnectMock).toHaveBeenCalledTimes(1);

    const second = getPrisma();
    expect(second).not.toBe(first);
    expect((second as unknown as { id: number }).id).toBe(2);
  });

  it("awaits $disconnect before clearing (return value is awaited)", async () => {
    const { getPrisma, disconnectPrisma } = await import("./index.js");
    getPrisma();
    let resolved = false;
    disconnectMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            resolved = true;
            resolve();
          }, 5);
        }),
    );
    await disconnectPrisma();
    expect(resolved).toBe(true);
  });
});
