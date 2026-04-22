import {
  BufferJSON,
  initAuthCreds,
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataSet,
  type SignalDataTypeMap,
  type SignalKeyStore,
} from "@whiskeysockets/baileys";
import { decryptWithKey, encryptWithKey, parseCiphertext, serializeCiphertext } from "@wpa/shared";
import type { Redis, ChainableCommander } from "ioredis";
import type { Logger } from "pino";

/**
 * Encrypted Baileys auth-state store backed by Redis. Every write goes through
 * AES-256-GCM with the user's per-user DEK BEFORE touching Redis. AOF
 * durability (~1s window) is enough: the snapshotter (see `snapshot.ts`) picks
 * up the encrypted blobs every 15s and persists them to Postgres for
 * restart-survivability.
 *
 * Redis key layout (all scoped per userId):
 *   wpa:wa-session:{userId}:creds
 *       → serialized Ciphertext of BufferJSON-stringified creds
 *   wpa:wa-session:{userId}:keys:{type}:{id}
 *       → serialized Ciphertext of an individual SignalDataTypeMap entry
 *   wpa:wa-session:{userId}:keys-index
 *       → SET of "{type}:{id}" tuples for enumeration / bulk clear
 */
export interface EncryptedAuthStore {
  /** Load auth state for `userId`. Returns a fresh `initAuthCreds` + empty key store if Redis has nothing. */
  loadState(userId: string, dek: Buffer): Promise<AuthenticationState>;
  /** Persist `creds` to Redis, encrypted with the user's DEK. */
  saveCreds(userId: string, dek: Buffer, creds: AuthenticationCreds): Promise<void>;
  /** Delete all hot state for `userId` (unpair / error cleanup). */
  clear(userId: string): Promise<void>;
  /**
   * Write a pre-encrypted ciphertext to a specific key+id without going
   * through JSON encode/encrypt again. Used by the restore path to rehydrate
   * Redis from a Postgres snapshot (which stores the already-encrypted blobs).
   */
  hydrateKeyRaw(userId: string, type: string, id: string, serializedCt: string): Promise<void>;
  /**
   * Write a pre-encrypted creds ciphertext. Same rationale as `hydrateKeyRaw`.
   */
  hydrateCredsRaw(userId: string, serializedCt: string): Promise<void>;
  /**
   * Read the raw (still-encrypted) creds ciphertext. Returns `null` if nothing
   * is stored. Used by the snapshotter to copy Redis → Postgres without a
   * decrypt/re-encrypt round-trip.
   */
  readCredsRaw(userId: string): Promise<string | null>;
  /**
   * Read every `{type, id, serializedCt}` tuple currently in the key store
   * for `userId`. Used by the snapshotter and tests.
   */
  readAllKeysRaw(userId: string): Promise<{ type: string; id: string; serializedCt: string }[]>;
}

const CREDS_KEY = (userId: string): string => `wpa:wa-session:${userId}:creds`;
const KEY_ENTRY_KEY = (userId: string, type: string, id: string): string =>
  `wpa:wa-session:${userId}:keys:${type}:${id}`;
const KEYS_INDEX = (userId: string): string => `wpa:wa-session:${userId}:keys-index`;

function encodeForRedis(dek: Buffer, plaintext: string): string {
  return serializeCiphertext(encryptWithKey(dek, plaintext));
}

function decodeFromRedis(dek: Buffer, ciphertext: string): string {
  return decryptWithKey(dek, parseCiphertext(ciphertext));
}

async function runPipeline(pipeline: ChainableCommander): Promise<void> {
  await pipeline.exec();
}

export function makeAuthStore(redis: Redis, logger: Logger): EncryptedAuthStore {
  const log = logger.child({ name: "auth-store" });

  const loadState = async (userId: string, dek: Buffer): Promise<AuthenticationState> => {
    const credsSerialized = await redis.get(CREDS_KEY(userId));
    const creds: AuthenticationCreds = credsSerialized
      ? (JSON.parse(
          decodeFromRedis(dek, credsSerialized),
          BufferJSON.reviver,
        ) as AuthenticationCreds)
      : initAuthCreds();

    const keys: SignalKeyStore = {
      get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
        const out: Record<string, SignalDataTypeMap[T]> = {};
        if (ids.length === 0) return out;
        const redisKeys = ids.map((id) => KEY_ENTRY_KEY(userId, String(type), id));
        const vals = await redis.mget(...redisKeys);
        for (let i = 0; i < ids.length; i += 1) {
          const v = vals[i];
          const id = ids[i];
          if (typeof v === "string" && id !== undefined) {
            try {
              const parsed = JSON.parse(
                decodeFromRedis(dek, v),
                BufferJSON.reviver,
              ) as SignalDataTypeMap[T];
              out[id] = parsed;
            } catch (err) {
              log.warn({ err, userId, type, id }, "failed decoding key entry");
            }
          }
        }
        return out;
      },
      set: async (data: SignalDataSet) => {
        const pipeline = redis.pipeline();
        const indexKey = KEYS_INDEX(userId);
        let touched = false;
        for (const [category, entry] of Object.entries(data)) {
          if (!entry) continue;
          for (const [id, value] of Object.entries(entry)) {
            const entryKey = KEY_ENTRY_KEY(userId, category, id);
            const tuple = `${category}:${id}`;
            if (value === null || value === undefined) {
              pipeline.del(entryKey);
              pipeline.srem(indexKey, tuple);
            } else {
              const serialized = encodeForRedis(dek, JSON.stringify(value, BufferJSON.replacer));
              pipeline.set(entryKey, serialized);
              pipeline.sadd(indexKey, tuple);
            }
            touched = true;
          }
        }
        if (touched) {
          await runPipeline(pipeline);
        }
      },
    };

    return { creds, keys };
  };

  const saveCreds = async (
    userId: string,
    dek: Buffer,
    creds: AuthenticationCreds,
  ): Promise<void> => {
    const serialized = encodeForRedis(dek, JSON.stringify(creds, BufferJSON.replacer));
    await redis.set(CREDS_KEY(userId), serialized);
  };

  const clear = async (userId: string): Promise<void> => {
    const indexKey = KEYS_INDEX(userId);
    const tuples = await redis.smembers(indexKey);
    const pipeline = redis.pipeline();
    for (const t of tuples) {
      const sep = t.indexOf(":");
      if (sep === -1) continue;
      const type = t.slice(0, sep);
      const id = t.slice(sep + 1);
      pipeline.del(KEY_ENTRY_KEY(userId, type, id));
    }
    pipeline.del(indexKey);
    pipeline.del(CREDS_KEY(userId));
    await runPipeline(pipeline);
  };

  const hydrateKeyRaw = async (
    userId: string,
    type: string,
    id: string,
    serializedCt: string,
  ): Promise<void> => {
    const pipeline = redis.pipeline();
    pipeline.set(KEY_ENTRY_KEY(userId, type, id), serializedCt);
    pipeline.sadd(KEYS_INDEX(userId), `${type}:${id}`);
    await runPipeline(pipeline);
  };

  const hydrateCredsRaw = async (userId: string, serializedCt: string): Promise<void> => {
    await redis.set(CREDS_KEY(userId), serializedCt);
  };

  const readCredsRaw = async (userId: string): Promise<string | null> => {
    return redis.get(CREDS_KEY(userId));
  };

  const readAllKeysRaw = async (
    userId: string,
  ): Promise<{ type: string; id: string; serializedCt: string }[]> => {
    const tuples = await redis.smembers(KEYS_INDEX(userId));
    if (tuples.length === 0) return [];
    const redisKeys = tuples.map((t) => {
      const sep = t.indexOf(":");
      const type = sep === -1 ? t : t.slice(0, sep);
      const id = sep === -1 ? "" : t.slice(sep + 1);
      return { type, id, redisKey: KEY_ENTRY_KEY(userId, type, id) };
    });
    const vals = await redis.mget(...redisKeys.map((k) => k.redisKey));
    const out: { type: string; id: string; serializedCt: string }[] = [];
    for (let i = 0; i < redisKeys.length; i += 1) {
      const v = vals[i];
      const entry = redisKeys[i];
      if (typeof v === "string" && entry) {
        out.push({ type: entry.type, id: entry.id, serializedCt: v });
      }
    }
    return out;
  };

  return {
    loadState,
    saveCreds,
    clear,
    hydrateKeyRaw,
    hydrateCredsRaw,
    readCredsRaw,
    readAllKeysRaw,
  };
}
