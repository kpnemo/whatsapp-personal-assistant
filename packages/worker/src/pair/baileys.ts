import makeWASocket, {
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
 * Handle returned from `makeSocket`. `creds` is a live reference into the
 * socket's `authState.creds` so callers (the PairMachine) can read the phone
 * number once Baileys writes `creds.me`. `dispose` closes the underlying
 * websocket gracefully.
 */
export interface SocketHandle {
  userId: string;
  creds: AuthenticationCreds;
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
// eslint-disable-next-line @typescript-eslint/require-await
export async function makeSocket(opts: MakeSocketOpts): Promise<SocketHandle> {
  const { userId, authState, onUpdate, onCredsUpdate, logger } = opts;

  const creds = authState?.creds ?? initAuthCreds();
  const rawKeys = authState?.keys ?? makeInMemoryKeyStore();
  const keys = makeCacheableSignalKeyStore(rawKeys, logger);

  const sock = makeWASocket({
    auth: { creds, keys },
    logger,
    printQRInTerminal: false,
    browser: ["wpa", "Safari", "1.0"],
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
