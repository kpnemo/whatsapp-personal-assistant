import type {
  AuthenticationCreds,
  AuthenticationState,
  ConnectionState,
} from "@whiskeysockets/baileys";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SocketHandle } from "./baileys.js";
import { PairMachine, type PairMachineEvents, type SocketFactory } from "./state.js";

interface FakeSocket {
  handle: SocketHandle;
  emit: (update: Partial<ConnectionState>) => void;
  dispose: ReturnType<typeof vi.fn>;
}

function makeFakeCreds(me?: { id: string; platform?: string }): AuthenticationCreds {
  const platform = me?.platform;
  return {
    ...(me ? { me: { id: me.id, name: "test", lid: "" } } : {}),
    ...(platform !== undefined ? { platform } : {}),
  } as unknown as AuthenticationCreds;
}

function makeFakeSocket(initialCreds: AuthenticationCreds = makeFakeCreds()): FakeSocket {
  let onUpdate: ((update: Partial<ConnectionState>) => void) | null = null;
  const dispose = vi.fn(() => Promise.resolve());
  const creds = { ...initialCreds } as AuthenticationCreds;
  // Minimal SignalKeyStore stub — PA2 tests never call keys.get/set; only the
  // 515-reconnect path reads `.keys` as an opaque reference to hand back to
  // the next makeSocket call.
  const keys = {
    get: () => ({}),
    set: () => {
      /* no-op */
    },
  } as unknown as SocketHandle["keys"];
  const handle: SocketHandle = {
    userId: "", // overwritten when bound
    creds,
    keys,
    dispose,
  };
  const emit = (update: Partial<ConnectionState>): void => {
    onUpdate?.(update);
  };
  // bound later via setOnUpdate
  (handle as unknown as { __setOnUpdate: typeof setOnUpdate }).__setOnUpdate = setOnUpdate;

  function setOnUpdate(fn: (update: Partial<ConnectionState>) => void): void {
    onUpdate = fn;
  }

  return { handle, emit, dispose };
}

function makeFactory(socket: FakeSocket): SocketFactory {
  return async ({ userId, onUpdate }) => {
    // wire the fake's emit
    (socket.handle as unknown as { __setOnUpdate: (fn: typeof onUpdate) => void }).__setOnUpdate(
      onUpdate,
    );
    (socket.handle as { userId: string }).userId = userId;
    return Promise.resolve(socket.handle);
  };
}

function makeEvents(): PairMachineEvents & {
  stateChanges: { userId: string; next: string; prev: string }[];
  qrs: { userId: string; qrPng: string }[];
  paireds: { userId: string; info: { phoneNumber: string; platform: string } }[];
  errors: { userId: string; error: Error }[];
} {
  const stateChanges: { userId: string; next: string; prev: string }[] = [];
  const qrs: { userId: string; qrPng: string }[] = [];
  const paireds: {
    userId: string;
    info: { phoneNumber: string; platform: string };
  }[] = [];
  const errors: { userId: string; error: Error }[] = [];
  return {
    stateChanges,
    qrs,
    paireds,
    errors,
    onStateChange: (userId, next, prev) => {
      stateChanges.push({ userId, next, prev });
    },
    onQr: (userId, qrPng) => {
      qrs.push({ userId, qrPng });
    },
    onPaired: (userId, info) => {
      paireds.push({ userId, info });
    },
    onError: (userId, error) => {
      errors.push({ userId, error });
    },
  };
}

async function flushMicrotasks(): Promise<void> {
  // `qrcode.toBuffer` → pngjs → zlib (libuv). Real timers run through that;
  // we only fake setTimeout/clearTimeout so this await loop still ticks.
  for (let i = 0; i < 5; i += 1) {
    await new Promise<void>((r) => setImmediate(r));
  }
  for (let i = 0; i < 20; i += 1) {
    await Promise.resolve();
  }
  await new Promise<void>((r) => setImmediate(r));
}

describe("PairMachine", () => {
  beforeEach(() => {
    // Only fake setTimeout/clearTimeout so the expire timer is controllable;
    // leave microtasks and setImmediate real so `qrcode.toBuffer` resolves.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("start(userId, null) transitions idle → generating", async () => {
    const events = makeEvents();
    const socket = makeFakeSocket();
    const m = new PairMachine(events, { socketFactory: makeFactory(socket) });
    expect(m.getState("u1")).toBe("idle");
    await m.start("u1", null);
    expect(m.getState("u1")).toBe("generating");
    expect(events.stateChanges).toEqual([{ userId: "u1", next: "generating", prev: "idle" }]);
  });

  it("start(userId, authState) transitions idle → paired directly and fires onPaired", async () => {
    const events = makeEvents();
    const socket = makeFakeSocket();
    const m = new PairMachine(events, { socketFactory: makeFactory(socket) });
    const authState = {
      creds: makeFakeCreds({ id: "1234567890@s.whatsapp.net", platform: "smb" }),
      keys: { get: () => ({}), set: () => undefined },
    } as unknown as AuthenticationState;
    await m.start("u1", authState);
    expect(m.getState("u1")).toBe("paired");
    expect(events.stateChanges).toEqual([{ userId: "u1", next: "paired", prev: "idle" }]);
    expect(events.paireds).toEqual([
      { userId: "u1", info: { phoneNumber: "1234567890", platform: "smb" } },
    ]);
  });

  it("generating receives qr → awaiting_scan + onQr fires", async () => {
    const events = makeEvents();
    const socket = makeFakeSocket();
    const m = new PairMachine(events, { socketFactory: makeFactory(socket) });
    await m.start("u1", null);
    socket.emit({ qr: "qr-payload-1" });
    await flushMicrotasks();
    expect(m.getState("u1")).toBe("awaiting_scan");
    expect(events.qrs).toHaveLength(1);
    expect(events.qrs[0]?.userId).toBe("u1");
    // base64 PNG signature starts with "iVBORw0KGgo" (decoded header 0x89 0x50 0x4E 0x47…)
    expect(events.qrs[0]?.qrPng).toMatch(/^iVBORw0KGgo/);
  });

  it("awaiting_scan receives another qr → stays awaiting_scan but re-emits onQr", async () => {
    const events = makeEvents();
    const socket = makeFakeSocket();
    const m = new PairMachine(events, { socketFactory: makeFactory(socket) });
    await m.start("u1", null);
    socket.emit({ qr: "qr-1" });
    socket.emit({ qr: "qr-2" });
    // Wait for BOTH qrcode.toBuffer async encodes to resolve. The PNG encode
    // goes through pngjs→zlib on libuv and is not microtask-synchronous, so a
    // fixed `flushMicrotasks` count can race on slow CI. Poll instead.
    await vi.waitFor(() => expect(events.qrs).toHaveLength(2), { timeout: 5_000 });
    expect(m.getState("u1")).toBe("awaiting_scan");
    // No duplicate state change (only one awaiting_scan transition).
    expect(events.stateChanges.filter((s) => s.next === "awaiting_scan")).toHaveLength(1);
  });

  it("awaiting_scan receives connection open → paired + onPaired with extracted phone", async () => {
    const events = makeEvents();
    const socket = makeFakeSocket();
    const m = new PairMachine(events, { socketFactory: makeFactory(socket) });
    await m.start("u1", null);
    socket.emit({ qr: "qr-1" });
    await flushMicrotasks();
    // Simulate Baileys populating creds.me right before emitting open
    Object.assign(socket.handle.creds, {
      me: { id: "447700900123@s.whatsapp.net", name: "me" },
      platform: "android",
    });
    socket.emit({ connection: "open" });
    expect(m.getState("u1")).toBe("paired");
    expect(events.paireds).toEqual([
      { userId: "u1", info: { phoneNumber: "447700900123", platform: "android" } },
    ]);
  });

  it("extracts phone number by stripping @s.whatsapp.net and :<device>", async () => {
    const events = makeEvents();
    const socket = makeFakeSocket();
    const m = new PairMachine(events, { socketFactory: makeFactory(socket) });
    await m.start("u1", null);
    Object.assign(socket.handle.creds, {
      me: { id: "1234567890:5@s.whatsapp.net", name: "me" },
    });
    socket.emit({ connection: "open" });
    expect(events.paireds[0]?.info.phoneNumber).toBe("1234567890");
  });

  it("awaiting_scan + 2min timeout → expired, socket disposed", async () => {
    const events = makeEvents();
    const socket = makeFakeSocket();
    const m = new PairMachine(events, { socketFactory: makeFactory(socket) });
    await m.start("u1", null);
    socket.emit({ qr: "qr-1" });
    await flushMicrotasks();
    expect(m.getState("u1")).toBe("awaiting_scan");
    vi.advanceTimersByTime(2 * 60 * 1000);
    await flushMicrotasks();
    expect(m.getState("u1")).toBe("expired");
    expect(socket.dispose).toHaveBeenCalled();
  });

  it("generating + timeout fires → expired even without qr", async () => {
    const events = makeEvents();
    const socket = makeFakeSocket();
    const m = new PairMachine(events, { socketFactory: makeFactory(socket) });
    await m.start("u1", null);
    expect(m.getState("u1")).toBe("generating");
    vi.advanceTimersByTime(2 * 60 * 1000);
    await flushMicrotasks();
    expect(m.getState("u1")).toBe("expired");
  });

  it("generating receives connection close(error) → error + onError fires", async () => {
    const events = makeEvents();
    const socket = makeFakeSocket();
    const m = new PairMachine(events, { socketFactory: makeFactory(socket) });
    await m.start("u1", null);
    const boomErr = new Error("boom");
    socket.emit({
      connection: "close",
      lastDisconnect: { error: boomErr, date: new Date() },
    });
    expect(m.getState("u1")).toBe("error");
    expect(events.errors).toHaveLength(1);
    expect(events.errors[0]?.error.message).toBe("boom");
  });

  it("awaiting_scan receives connection close(error) → error", async () => {
    const events = makeEvents();
    const socket = makeFakeSocket();
    const m = new PairMachine(events, { socketFactory: makeFactory(socket) });
    await m.start("u1", null);
    socket.emit({ qr: "qr-1" });
    await flushMicrotasks();
    socket.emit({
      connection: "close",
      lastDisconnect: { error: new Error("lost"), date: new Date() },
    });
    expect(m.getState("u1")).toBe("error");
    expect(events.errors).toHaveLength(1);
  });

  it("paired + stop → idle, disposes socket, cancels timer", async () => {
    const events = makeEvents();
    const socket = makeFakeSocket();
    const m = new PairMachine(events, { socketFactory: makeFactory(socket) });
    await m.start("u1", null);
    Object.assign(socket.handle.creds, {
      me: { id: "1111111111@s.whatsapp.net", name: "me" },
    });
    socket.emit({ connection: "open" });
    expect(m.getState("u1")).toBe("paired");
    await m.stop("u1");
    expect(m.getState("u1")).toBe("idle");
    expect(socket.dispose).toHaveBeenCalled();
  });

  it("paired + close(error) keeps state paired (PA3 reconnect handles it)", async () => {
    const events = makeEvents();
    const socket = makeFakeSocket();
    const m = new PairMachine(events, { socketFactory: makeFactory(socket) });
    await m.start("u1", null);
    Object.assign(socket.handle.creds, {
      me: { id: "2222222222@s.whatsapp.net", name: "me" },
    });
    socket.emit({ connection: "open" });
    socket.emit({
      connection: "close",
      lastDisconnect: { error: new Error("drop"), date: new Date() },
    });
    expect(m.getState("u1")).toBe("paired");
    expect(events.errors).toHaveLength(0);
  });

  it("expired + start again → generating (retry is allowed)", async () => {
    const events = makeEvents();
    const socket1 = makeFakeSocket();
    const socket2 = makeFakeSocket();
    const socketsQueue = [socket1, socket2];
    const factory: SocketFactory = async ({ userId, onUpdate }) => {
      const s = socketsQueue.shift();
      if (!s) throw new Error("no more sockets");
      (s.handle as unknown as { __setOnUpdate: (fn: typeof onUpdate) => void }).__setOnUpdate(
        onUpdate,
      );
      (s.handle as { userId: string }).userId = userId;
      return Promise.resolve(s.handle);
    };
    const m = new PairMachine(events, { socketFactory: factory });
    await m.start("u1", null);
    vi.advanceTimersByTime(2 * 60 * 1000);
    await flushMicrotasks();
    expect(m.getState("u1")).toBe("expired");
    await m.start("u1", null);
    expect(m.getState("u1")).toBe("generating");
  });

  it("multiple concurrent userIds — machines isolated", async () => {
    const events = makeEvents();
    const socketA = makeFakeSocket();
    const socketB = makeFakeSocket();
    const pending = new Map([
      ["userA", socketA],
      ["userB", socketB],
    ]);
    const factory: SocketFactory = async ({ userId, onUpdate }) => {
      const s = pending.get(userId);
      if (!s) throw new Error(`no socket for ${userId}`);
      (s.handle as unknown as { __setOnUpdate: (fn: typeof onUpdate) => void }).__setOnUpdate(
        onUpdate,
      );
      (s.handle as { userId: string }).userId = userId;
      return Promise.resolve(s.handle);
    };
    const m = new PairMachine(events, { socketFactory: factory });
    await m.start("userA", null);
    await m.start("userB", null);
    // userA scans
    socketA.emit({ qr: "qrA" });
    await flushMicrotasks();
    // userB remains generating
    expect(m.getState("userA")).toBe("awaiting_scan");
    expect(m.getState("userB")).toBe("generating");
    Object.assign(socketA.handle.creds, {
      me: { id: "111@s.whatsapp.net", name: "a" },
    });
    socketA.emit({ connection: "open" });
    expect(m.getState("userA")).toBe("paired");
    expect(m.getState("userB")).toBe("generating");
    expect(events.paireds.map((p) => p.userId)).toEqual(["userA"]);
  });

  it("stop during pairing cancels expire timer", async () => {
    const events = makeEvents();
    const socket = makeFakeSocket();
    const m = new PairMachine(events, { socketFactory: makeFactory(socket) });
    await m.start("u1", null);
    await m.stop("u1");
    expect(m.getState("u1")).toBe("idle");
    // Advancing past 2 min must not flip us back to expired.
    vi.advanceTimersByTime(5 * 60 * 1000);
    await flushMicrotasks();
    expect(m.getState("u1")).toBe("idle");
  });

  it("stop on unknown userId is a no-op", async () => {
    const events = makeEvents();
    const socket = makeFakeSocket();
    const m = new PairMachine(events, { socketFactory: makeFactory(socket) });
    await m.stop("ghost");
    expect(events.stateChanges).toHaveLength(0);
  });

  it("onCredsUpdate passes through to the events callback", async () => {
    const credsSeen: { userId: string; creds: AuthenticationCreds }[] = [];
    const baseEvents = makeEvents();
    const events: PairMachineEvents = {
      ...baseEvents,
      onCredsUpdate: (userId, creds) => {
        credsSeen.push({ userId, creds });
      },
    };
    const captured: { fn: ((creds: AuthenticationCreds) => void) | null } = { fn: null };
    const socket = makeFakeSocket();
    const factory: SocketFactory = async ({ userId, onUpdate, onCredsUpdate }) => {
      captured.fn = onCredsUpdate;
      (socket.handle as unknown as { __setOnUpdate: (fn: typeof onUpdate) => void }).__setOnUpdate(
        onUpdate,
      );
      (socket.handle as { userId: string }).userId = userId;
      return Promise.resolve(socket.handle);
    };
    const m = new PairMachine(events, { socketFactory: factory });
    await m.start("u1", null);
    expect(captured.fn).toBeTypeOf("function");
    const newCreds = makeFakeCreds({ id: "9@s.whatsapp.net" });
    captured.fn?.(newCreds);
    expect(credsSeen).toHaveLength(1);
    expect(credsSeen[0]?.userId).toBe("u1");
  });

  it("socketFactory throwing → error state + onError called", async () => {
    const events = makeEvents();
    const factory: SocketFactory = () => {
      return Promise.reject(new Error("factory-failed"));
    };
    const m = new PairMachine(events, { socketFactory: factory });
    await m.start("u1", null);
    expect(m.getState("u1")).toBe("error");
    expect(events.errors).toHaveLength(1);
    expect(events.errors[0]?.error.message).toBe("factory-failed");
  });

  it("logs but does not throw when socket dispose fails on expire", async () => {
    const events = makeEvents();
    const socket = makeFakeSocket();
    socket.dispose.mockRejectedValueOnce(new Error("dispose-boom"));
    const m = new PairMachine(events, {
      socketFactory: makeFactory(socket),
      expireMs: 1_000,
    });
    await m.start("u1", null);
    socket.emit({ qr: "q" });
    await flushMicrotasks();
    vi.advanceTimersByTime(1_000);
    // Allow the rejected dispose promise's catch handler to run.
    await flushMicrotasks();
    expect(m.getState("u1")).toBe("expired");
  });

  it("honors custom expireMs", async () => {
    const events = makeEvents();
    const socket = makeFakeSocket();
    const m = new PairMachine(events, {
      socketFactory: makeFactory(socket),
      expireMs: 1_000,
    });
    await m.start("u1", null);
    vi.advanceTimersByTime(500);
    expect(m.getState("u1")).toBe("generating");
    vi.advanceTimersByTime(600);
    await flushMicrotasks();
    expect(m.getState("u1")).toBe("expired");
  });
});
