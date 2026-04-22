import makeWASocket, {
  Browsers,
  fetchLatestBaileysVersion,
  initAuthCreds,
  makeCacheableSignalKeyStore,
  type AuthenticationCreds,
  type AuthenticationState,
  type ConnectionState,
  type SignalDataSet,
  type SignalDataTypeMap,
  type SignalKeyStore,
} from "@whiskeysockets/baileys";
import type { Logger } from "pino";

/**
 * Handle returned from `makeSocket`. `creds` and `keys` are live references
 * into the socket's `authState` so callers (the PairMachine) can:
 *   - read the phone number once Baileys writes `creds.me`
 *   - reuse the full auth state on a 515 reconnect (WhatsApp asks us to
 *     close + reopen the socket after the QR scan; see state.ts).
 * `dispose` closes the underlying websocket gracefully.
 */
export interface SocketHandle {
  userId: string;
  creds: AuthenticationCreds;
  keys: SignalKeyStore;
  dispose: () => Promise<void>;
}

export interface MakeSocketOpts {
  userId: string;
  /**
   * Pre-existing `AuthenticationState` (restore path). When null, a fresh
   * in-memory creds + key store is allocated — that's the "awaiting first
   * pair" path used by PA2. PA3 will supply a persistent store here.
   */
  authState: AuthenticationState | null;
  onUpdate: (update: Partial<ConnectionState>) => void;
  /**
   * PA3 hooks this to encrypted persistence. PA2 callers may no-op.
   */
  onCredsUpdate: (creds: AuthenticationCreds) => void;
  logger: Logger;
}

/**
 * In-memory SignalKeyStore — used only when `authState` is null (PA2's
 * pair-from-scratch path). PA3 swaps this for the Redis-backed store.
 */
function makeInMemoryKeyStore(): SignalKeyStore {
  const store: Record<string, Record<string, unknown>> = {};
  return {
    get: <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
      const bucket = store[type] ?? {};
      const out: Record<string, SignalDataTypeMap[T]> = {};
      for (const id of ids) {
        const v = bucket[id];
        if (v !== undefined) {
          out[id] = v as SignalDataTypeMap[T];
        }
      }
      return out;
    },
    set: (data: SignalDataSet) => {
      for (const category of Object.keys(data) as (keyof SignalDataTypeMap)[]) {
        const entry = data[category];
        if (!entry) continue;
        const bucket = store[category] ?? {};
        store[category] = bucket;
        for (const [id, value] of Object.entries(entry)) {
          if (value === null) {
            delete bucket[id];
          } else {
            bucket[id] = value;
          }
        }
      }
    },
  };
}

/**
 * Thin wrapper around `@whiskeysockets/baileys` — the only place in the worker
 * that talks directly to the library. Centralises the hardened options
 * (printQRInTerminal off, no history sync, no link previews, no auto-online)
 * so we never accidentally ship a variant with the noisy defaults.
 */
export async function makeSocket(opts: MakeSocketOpts): Promise<SocketHandle> {
  const { userId, authState, onUpdate, onCredsUpdate, logger } = opts;

  const creds = authState?.creds ?? initAuthCreds();
  const rawKeys = authState?.keys ?? makeInMemoryKeyStore();
  const keys = makeCacheableSignalKeyStore(rawKeys, logger);

  // Fetch the current WhatsApp Web protocol version at connect-time.
  // Without this, Baileys' built-in default version drifts behind what
  // WhatsApp's servers accept — the handshake fails with HTTP 405
  // "Connection Failure" at `location:"atn"` and pairing dies before
  // a QR is ever rendered. fetchLatestBaileysVersion() resolves via
  // the upstream WA version endpoint and falls back gracefully if the
  // endpoint is unreachable (returns {version, isLatest:false}).
  const { version, isLatest } = await fetchLatestBaileysVersion();
  logger.info({ version, isLatest, userId }, "fetched WhatsApp Web version");

  const sock = makeWASocket({
    version,
    auth: { creds, keys },
    logger,
    printQRInTerminal: false,
    // Browsers.macOS("Chrome") reports as a normal desktop Chrome browser on
    // WhatsApp's "Linked Devices" list — standard, less likely to trip
    // server-side heuristics than the previous ["wpa","Safari","1.0"] triple
    // which some WA server versions reject outright.
    browser: Browsers.macOS("Chrome"),
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
    markOnlineOnConnect: false,
  });

  sock.ev.on("connection.update", (update) => {
    onUpdate(update);
  });
  sock.ev.on("creds.update", () => {
    onCredsUpdate(creds);
  });

  return {
    userId,
    creds,
    keys,
    dispose: async () => {
      try {
        await sock.ws.close();
      } catch {
        // socket may already be closed
      }
      try {
        sock.end(undefined);
      } catch {
        // idempotent
      }
    },
  };
}
