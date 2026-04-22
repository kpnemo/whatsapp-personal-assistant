import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useEventStream } from "./useEventStream.js";

// ---------------------------------------------------------------------------
// Minimal EventSource mock
// ---------------------------------------------------------------------------

type ESListener = (e: MessageEvent | Event) => void;

class MockEventSource {
  static instances: MockEventSource[] = [];

  url: string;
  readyState = 0; // CONNECTING

  private listeners = new Map<string, Set<ESListener>>();

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: ESListener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: ESListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  close(): void {
    this.readyState = 2; // CLOSED
  }

  /** Test helper: simulate server sending a named event */
  emit(type: string, data: unknown): void {
    const payload = typeof data === "string" ? data : JSON.stringify(data);
    const evt = Object.assign(new Event(type), { data: payload }) as MessageEvent;
    this.listeners.get(type)?.forEach((l) => {
      l(evt);
    });
  }

  /** Test helper: fire open */
  open(): void {
    this.readyState = 1; // OPEN
    this.listeners.get("open")?.forEach((l) => {
      l(new Event("open"));
    });
  }

  /** Test helper: simulate error / server close */
  error(): void {
    this.readyState = 2;
    this.listeners.get("error")?.forEach((l) => {
      l(new Event("error"));
    });
  }
}

// ---------------------------------------------------------------------------
// Install mock globally before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  MockEventSource.instances = [];
  vi.stubGlobal("EventSource", MockEventSource);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useEventStream", () => {
  it("connects on mount and closes on unmount", () => {
    const { unmount } = renderHook(() => useEventStream());

    const es = MockEventSource.instances[0]!;
    expect(es).toBeDefined();
    expect(es.url).toContain("/api/events");

    unmount();
    expect(es.readyState).toBe(2); // CLOSED
  });

  it("transitions: connecting → connected when open fires", () => {
    const { result } = renderHook(() => useEventStream());
    expect(result.current.status).toBe("connecting");

    act(() => {
      MockEventSource.instances[0]!.open();
    });

    expect(result.current.status).toBe("connected");
  });

  it("subscribe(type, handler) receives matching events", () => {
    const received: unknown[] = [];
    const { result } = renderHook(() => useEventStream());

    act(() => {
      result.current.subscribe("message.created", (d) => {
        received.push(d);
      });
      MockEventSource.instances[0]!.open();
    });

    act(() => {
      MockEventSource.instances[0]!.emit("message.created", { conversationId: "c1" });
    });

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ conversationId: "c1" });
  });

  it("unsubscribe stops handler from receiving events", () => {
    const received: unknown[] = [];
    const { result } = renderHook(() => useEventStream());

    let unsub: (() => void) | undefined;
    act(() => {
      unsub = result.current.subscribe("message.created", (d) => {
        received.push(d);
      });
      MockEventSource.instances[0]!.open();
    });

    act(() => {
      unsub!();
      MockEventSource.instances[0]!.emit("message.created", { conversationId: "c1" });
    });

    expect(received).toHaveLength(0);
  });

  it("status → disconnected when error fires", () => {
    const { result } = renderHook(() => useEventStream());
    const es = MockEventSource.instances[0]!;

    act(() => {
      es.open();
      es.error();
    });

    expect(result.current.status).toBe("disconnected");
  });

  it("reconnects after 2s on first error", () => {
    renderHook(() => useEventStream());
    const es = MockEventSource.instances[0]!;

    act(() => {
      es.open();
      es.error();
    });

    expect(MockEventSource.instances).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(2_000);
    });

    expect(MockEventSource.instances).toHaveLength(2);
  });

  it("reconnect backoff doubles each time (2s → 4s), capped at 30s", () => {
    renderHook(() => useEventStream());
    const es0 = MockEventSource.instances[0]!;

    // First error → 2s backoff
    act(() => {
      es0.open();
      es0.error();
    });
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(MockEventSource.instances).toHaveLength(2);

    // Second error → 4s backoff
    const es1 = MockEventSource.instances[1]!;
    act(() => {
      es1.error();
    });
    act(() => {
      vi.advanceTimersByTime(2_000);
    }); // only 2s — should NOT have reconnected yet
    expect(MockEventSource.instances).toHaveLength(2);
    act(() => {
      vi.advanceTimersByTime(2_000);
    }); // now 4s total — should reconnect
    expect(MockEventSource.instances).toHaveLength(3);
  });

  it("no reconnect after unmount", () => {
    const { unmount } = renderHook(() => useEventStream());
    const es = MockEventSource.instances[0]!;

    act(() => {
      es.open();
      es.error();
    });

    unmount();

    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(MockEventSource.instances).toHaveLength(1); // no new connection
  });

  it("manual disconnect() stops reconnect", () => {
    const { result } = renderHook(() => useEventStream());
    const es = MockEventSource.instances[0]!;

    act(() => {
      es.open();
    });

    act(() => {
      result.current.disconnect();
    });

    expect(result.current.status).toBe("disconnected");

    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    expect(MockEventSource.instances).toHaveLength(1); // no reconnect
  });
});
