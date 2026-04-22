import { beforeEach, describe, expect, it, vi } from "vitest";

// Module-mock values must be hoisted so `vi.mock`'s factory — itself hoisted
// to the top of the file — can reach them.
const hoisted = vi.hoisted(() => {
  const lastCall: { opts: unknown } = { opts: null };
  const listeners: Record<string, ((x: unknown) => void)[]> = {};
  const wsClose = vi.fn();
  const sockEnd = vi.fn();
  const cacheableSentinel: unknown = { __cacheable: true };
  const cacheableSpy = vi.fn(() => cacheableSentinel);
  const fakeVersion: [number, number, number] = [2, 3000, 1025000000];
  const fetchVersionSpy = vi.fn(() => Promise.resolve({ version: fakeVersion, isLatest: true }));
  const makeWASocketSpy = vi.fn((opts: unknown) => {
    lastCall.opts = opts;
    return {
      ev: {
        on: (event: string, fn: (x: unknown) => void) => {
          listeners[event] = listeners[event] ?? [];
          listeners[event].push(fn);
        },
      },
      ws: { close: wsClose },
      end: sockEnd,
    };
  });
  return {
    lastCall,
    listeners,
    wsClose,
    sockEnd,
    cacheableSentinel,
    cacheableSpy,
    fakeVersion,
    fetchVersionSpy,
    makeWASocketSpy,
  };
});

vi.mock("@whiskeysockets/baileys", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    default: hoisted.makeWASocketSpy,
    makeWASocket: hoisted.makeWASocketSpy,
    makeCacheableSignalKeyStore: hoisted.cacheableSpy,
    fetchLatestBaileysVersion: hoisted.fetchVersionSpy,
    // Preserve the real Browsers helper so we can still compare values.
    Browsers: (actual as { Browsers?: unknown }).Browsers,
    initAuthCreds: () => ({ registered: false, platform: undefined }),
  };
});

// Import AFTER the mock registration so the wrapper picks up the stubs.
import { makeSocket } from "./baileys.js";

const fakeLogger = {
  level: "info",
  child: () => fakeLogger,
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  fatal: vi.fn(),
} as unknown as Parameters<typeof makeSocket>[0]["logger"];

describe("makeSocket (baileys wrapper)", () => {
  beforeEach(() => {
    hoisted.lastCall.opts = null;
    for (const k of Object.keys(hoisted.listeners)) delete hoisted.listeners[k];
    hoisted.wsClose.mockReset();
    hoisted.sockEnd.mockReset();
    hoisted.cacheableSpy.mockClear();
    hoisted.makeWASocketSpy.mockClear();
    hoisted.fetchVersionSpy.mockClear();
  });

  it("passes hardened options through to makeWASocket", async () => {
    await makeSocket({
      userId: "u1",
      authState: null,
      onUpdate: vi.fn(),
      onCredsUpdate: vi.fn(),
      logger: fakeLogger,
    });
    expect(hoisted.lastCall.opts).toBeTruthy();
    const opts = hoisted.lastCall.opts as Record<string, unknown>;
    expect(opts.printQRInTerminal).toBe(false);
    // Browsers.macOS("Chrome") returns ["Mac OS", "Chrome", "<version>"]; we
    // don't care about the version string, only that we stopped advertising
    // the rejected ["wpa","Safari","1.0"] triple.
    expect(Array.isArray(opts.browser)).toBe(true);
    expect(opts.browser).not.toEqual(["wpa", "Safari", "1.0"]);
    const browser = opts.browser as [string, string, string];
    expect(browser[0]).toMatch(/Mac/i);
    expect(browser[1]).toBe("Chrome");
    expect(opts.syncFullHistory).toBe(false);
    expect(opts.generateHighQualityLinkPreview).toBe(false);
    expect(opts.markOnlineOnConnect).toBe(false);
    expect(opts.logger).toBe(fakeLogger);
  });

  it("fetches the latest WhatsApp Web version and passes it to makeWASocket", async () => {
    await makeSocket({
      userId: "u1",
      authState: null,
      onUpdate: vi.fn(),
      onCredsUpdate: vi.fn(),
      logger: fakeLogger,
    });
    expect(hoisted.fetchVersionSpy).toHaveBeenCalledTimes(1);
    const opts = hoisted.lastCall.opts as { version: [number, number, number] };
    expect(opts.version).toEqual(hoisted.fakeVersion);
  });

  it("wraps state.keys in makeCacheableSignalKeyStore", async () => {
    await makeSocket({
      userId: "u1",
      authState: null,
      onUpdate: vi.fn(),
      onCredsUpdate: vi.fn(),
      logger: fakeLogger,
    });
    expect(hoisted.cacheableSpy).toHaveBeenCalledTimes(1);
    const opts = hoisted.lastCall.opts as { auth: { keys: unknown } };
    expect(opts.auth.keys).toBe(hoisted.cacheableSentinel);
  });

  it("attaches listeners for connection.update and creds.update", async () => {
    const onUpdate = vi.fn();
    const onCredsUpdate = vi.fn();
    await makeSocket({
      userId: "u1",
      authState: null,
      onUpdate,
      onCredsUpdate,
      logger: fakeLogger,
    });
    expect(hoisted.listeners["connection.update"]).toHaveLength(1);
    expect(hoisted.listeners["creds.update"]).toHaveLength(1);
    hoisted.listeners["connection.update"]?.[0]?.({ qr: "x" });
    expect(onUpdate).toHaveBeenCalledWith({ qr: "x" });
    hoisted.listeners["creds.update"]?.[0]?.({});
    expect(onCredsUpdate).toHaveBeenCalledTimes(1);
  });

  it("dispose() calls ws.close() and end(undefined)", async () => {
    const handle = await makeSocket({
      userId: "u1",
      authState: null,
      onUpdate: vi.fn(),
      onCredsUpdate: vi.fn(),
      logger: fakeLogger,
    });
    await handle.dispose();
    expect(hoisted.wsClose).toHaveBeenCalledTimes(1);
    expect(hoisted.sockEnd).toHaveBeenCalledWith(undefined);
  });

  it("uses initAuthCreds when authState is null", async () => {
    await makeSocket({
      userId: "u1",
      authState: null,
      onUpdate: vi.fn(),
      onCredsUpdate: vi.fn(),
      logger: fakeLogger,
    });
    const opts = hoisted.lastCall.opts as { auth: { creds: { registered?: boolean } } };
    expect(opts.auth.creds.registered).toBe(false);
  });
});
