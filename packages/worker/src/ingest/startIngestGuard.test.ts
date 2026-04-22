/**
 * Unit tests for the startIngest in-flight Promise guard pattern.
 *
 * The guard lives inside main() in index.ts and cannot be imported directly.
 * This test replicates the identical guard logic in isolation so we can assert
 * that two concurrent calls for the same userId result in exactly one wired
 * subscriber and one wired consumer — even when the async body has not yet
 * written to either map.
 */
import { describe, expect, it, vi } from "vitest";

/**
 * Builds a self-contained startIngest implementation with the in-flight guard,
 * mirroring the logic in packages/worker/src/index.ts.
 *
 * Returns the function under test plus the state maps for assertions.
 */
function makeStartIngest(asyncBody: (userId: string) => Promise<void>) {
  const ingestUnsubscribers = new Map<string, () => void>();
  const ingestConsumers = new Map<string, { stop: () => void }>();
  const startingIngest = new Map<string, Promise<void>>();

  async function _startIngest(userId: string): Promise<void> {
    await asyncBody(userId);
  }

  async function startIngest(userId: string): Promise<void> {
    if (
      ingestUnsubscribers.has(userId) ||
      ingestConsumers.has(userId) ||
      startingIngest.has(userId)
    ) {
      return;
    }
    const p = _startIngest(userId);
    startingIngest.set(userId, p);
    try {
      await p;
    } finally {
      startingIngest.delete(userId);
    }
  }

  return { startIngest, ingestUnsubscribers, ingestConsumers, startingIngest };
}

describe("startIngest in-flight guard", () => {
  it("two concurrent calls for the same userId only invoke the body once", async () => {
    const bodyCallCount: Record<string, number> = {};

    const { startIngest } = makeStartIngest(async (userId) => {
      bodyCallCount[userId] = (bodyCallCount[userId] ?? 0) + 1;
      // Simulate an async gap (the first await in the real implementation).
      await Promise.resolve();
    });

    await Promise.all([startIngest("user-1"), startIngest("user-1")]);

    expect(bodyCallCount["user-1"]).toBe(1);
  });

  it("three concurrent calls for the same userId only invoke the body once", async () => {
    let callCount = 0;

    const { startIngest } = makeStartIngest(async (_userId) => {
      callCount++;
      await Promise.resolve();
    });

    await Promise.all([startIngest("user-a"), startIngest("user-a"), startIngest("user-a")]);

    expect(callCount).toBe(1);
  });

  it("concurrent calls for different userIds each invoke the body once", async () => {
    const callCounts: Record<string, number> = {};

    const { startIngest } = makeStartIngest(async (userId) => {
      callCounts[userId] = (callCounts[userId] ?? 0) + 1;
      await Promise.resolve();
    });

    await Promise.all([
      startIngest("user-x"),
      startIngest("user-y"),
      startIngest("user-x"),
      startIngest("user-y"),
    ]);

    expect(callCounts["user-x"]).toBe(1);
    expect(callCounts["user-y"]).toBe(1);
  });

  it("after first call completes, a subsequent call is allowed through", async () => {
    let callCount = 0;

    const { startIngest } = makeStartIngest(async (_userId) => {
      callCount++;
      await Promise.resolve();
    });

    await startIngest("user-seq");
    await startIngest("user-seq");

    // Both sequential calls should go through since the guard resets after completion.
    expect(callCount).toBe(2);
  });

  it("guard is keyed by userId — already-set map entries also block re-entry", async () => {
    let callCount = 0;

    const { startIngest, ingestUnsubscribers } = makeStartIngest(async (userId) => {
      callCount++;
      // Simulate the body writing to ingestUnsubscribers as the real code does.
      ingestUnsubscribers.set(userId, vi.fn());
      await Promise.resolve();
    });

    await startIngest("user-map");
    // At this point ingestUnsubscribers has the userId, so the guard fires.
    await startIngest("user-map");

    expect(callCount).toBe(1);
  });

  it("startingIngest map is cleaned up after body completes", async () => {
    const { startIngest, startingIngest } = makeStartIngest(async (_userId) => {
      await Promise.resolve();
    });

    await startIngest("user-cleanup");
    expect(startingIngest.has("user-cleanup")).toBe(false);
  });

  it("startingIngest map is cleaned up even when body throws", async () => {
    const { startIngest, startingIngest } = makeStartIngest(async (_userId) => {
      await Promise.resolve();
      throw new Error("body error");
    });

    // The real _startIngest catches internally; here we let it throw to verify
    // the finally block still runs.
    await expect(startIngest("user-throws")).rejects.toThrow("body error");
    expect(startingIngest.has("user-throws")).toBe(false);
  });
});
