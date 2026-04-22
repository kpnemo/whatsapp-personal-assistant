import { initAuthCreds } from "@whiskeysockets/baileys";
import { generateKey } from "@wpa/shared";
import { makeTestRedis, type TestRedis } from "@wpa/test-utils";
import { pino } from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { makeAuthStore, type EncryptedAuthStore } from "./authStore.js";

const silentLogger = pino({ level: "silent" });

describe("EncryptedAuthStore (real Redis + real crypto)", () => {
  let testRedis: TestRedis;
  let store: EncryptedAuthStore;

  beforeAll(async () => {
    testRedis = await makeTestRedis();
    store = makeAuthStore(testRedis.client, silentLogger);
  }, 180_000);

  afterAll(async () => {
    if (testRedis) await testRedis.teardown();
  }, 60_000);

  beforeEach(async () => {
    // Clean slate per test — no cross-contamination.
    await testRedis.client.flushdb();
  });

  it("loadState on empty Redis returns initAuthCreds + empty key store", async () => {
    const dek = generateKey();
    const state = await store.loadState("userA", dek);
    // Shape check: creds from initAuthCreds has a signedIdentityKey + registrationId.
    expect(state.creds).toBeDefined();
    expect(state.creds.registrationId).toBeTypeOf("number");
    expect(state.creds.signedIdentityKey).toBeDefined();
    // keys.get with no stored data returns an empty object.
    const got = await state.keys.get("session", ["session-1"]);
    expect(got).toEqual({});
  });

  it("saveCreds + loadState round-trips buffer-containing creds through encryption", async () => {
    const dek = generateKey();
    const creds = initAuthCreds();
    // Tag some known bytes in a Buffer field so we can verify buffer preservation.
    const tag = Buffer.from([0xde, 0xad, 0xbe, 0xef, 0x01, 0x02]);
    (creds.noiseKey.private as Buffer) = tag;

    await store.saveCreds("userA", dek, creds);

    // Verify Redis actually holds ciphertext (not plaintext).
    const raw = await testRedis.client.get("wpa:wa-session:userA:creds");
    expect(raw).toBeTruthy();
    expect(raw!.includes("deadbeef")).toBe(false);
    // Ciphertext format is "iv.tag.ciphertext" base64 joined by dots.
    expect(raw!.split(".").length).toBe(3);

    const reloaded = await store.loadState("userA", dek);
    expect(Buffer.isBuffer(reloaded.creds.noiseKey.private)).toBe(true);
    expect(Buffer.compare(reloaded.creds.noiseKey.private as Buffer, tag)).toBe(0);
  });

  it("key store set + get round-trips through Redis", async () => {
    const dek = generateKey();
    const state = await store.loadState("userB", dek);
    // Session entries in Baileys' SignalDataTypeMap are Uint8Array / Buffer-ish
    // blobs; we use a recognisable buffer.
    const session = Buffer.from([1, 2, 3, 4, 5]);
    await state.keys.set({ session: { "sess-1": session } });

    // A fresh loadState must see the stored key.
    const state2 = await store.loadState("userB", dek);
    const got = await state2.keys.get("session", ["sess-1"]);
    const v = got["sess-1"] as unknown as Buffer;
    expect(Buffer.isBuffer(v)).toBe(true);
    expect(Buffer.compare(v, session)).toBe(0);

    // Verify the index has the tuple.
    const members = await testRedis.client.smembers("wpa:wa-session:userB:keys-index");
    expect(members).toContain("session:sess-1");

    // Verify raw-read returns the serialized ciphertext too.
    const raws = await store.readAllKeysRaw("userB");
    expect(raws).toHaveLength(1);
    expect(raws[0]!.type).toBe("session");
    expect(raws[0]!.id).toBe("sess-1");
    expect(raws[0]!.serializedCt.split(".").length).toBe(3);
  });

  it("key store set with null value deletes the entry", async () => {
    const dek = generateKey();
    const state = await store.loadState("userC", dek);
    await state.keys.set({
      session: { sessX: Buffer.from([9, 9]) },
    });
    // Delete it.
    await state.keys.set({ session: { sessX: null } });

    const reloaded = await store.loadState("userC", dek);
    const got = await reloaded.keys.get("session", ["sessX"]);
    expect(got).toEqual({});

    const members = await testRedis.client.smembers("wpa:wa-session:userC:keys-index");
    expect(members).not.toContain("session:sessX");
  });

  it("clear removes all user state", async () => {
    const dek = generateKey();
    const creds = initAuthCreds();
    await store.saveCreds("userD", dek, creds);
    const state = await store.loadState("userD", dek);
    await state.keys.set({
      session: {
        s1: Buffer.from([1]),
        s2: Buffer.from([2]),
      },
    });

    await store.clear("userD");

    expect(await testRedis.client.get("wpa:wa-session:userD:creds")).toBeNull();
    expect(await testRedis.client.smembers("wpa:wa-session:userD:keys-index")).toEqual([]);
    expect(await testRedis.client.get("wpa:wa-session:userD:keys:session:s1")).toBeNull();
    expect(await testRedis.client.get("wpa:wa-session:userD:keys:session:s2")).toBeNull();
  });

  it("decryption failure with the wrong DEK surfaces as a thrown error on load", async () => {
    const dek1 = generateKey();
    const dek2 = generateKey();
    const creds = initAuthCreds();
    await store.saveCreds("userE", dek1, creds);

    await expect(store.loadState("userE", dek2)).rejects.toThrow();
  });

  it("hydrateCredsRaw + hydrateKeyRaw rehydrate state from already-encrypted blobs", async () => {
    const dek = generateKey();
    const creds = initAuthCreds();
    await store.saveCreds("userF", dek, creds);
    const state = await store.loadState("userF", dek);
    await state.keys.set({
      session: { ses: Buffer.from([7, 8]) },
    });
    // Snapshot the raw ciphertexts out.
    const credsCt = await store.readCredsRaw("userF");
    const keyRaws = await store.readAllKeysRaw("userF");
    expect(credsCt).toBeTruthy();
    expect(keyRaws).toHaveLength(1);

    // Wipe, then hydrate from the raw ciphertexts (no decrypt step).
    await store.clear("userF");
    await store.hydrateCredsRaw("userF", credsCt!);
    await store.hydrateKeyRaw("userF", keyRaws[0]!.type, keyRaws[0]!.id, keyRaws[0]!.serializedCt);

    const restored = await store.loadState("userF", dek);
    expect(restored.creds.registrationId).toBe(creds.registrationId);
    const got = await restored.keys.get("session", ["ses"]);
    const v = got.ses as unknown as Buffer;
    expect(Buffer.isBuffer(v)).toBe(true);
    expect(Buffer.compare(v, Buffer.from([7, 8]))).toBe(0);
  });

  it("isolates users: userX's keys are invisible to userY", async () => {
    const dek = generateKey();
    const stateX = await store.loadState("userX", dek);
    await stateX.keys.set({
      session: { s: Buffer.from([42]) },
    });

    const stateY = await store.loadState("userY", dek);
    const got = await stateY.keys.get("session", ["s"]);
    expect(got).toEqual({});
  });

  it("set with empty ids + get with empty ids are no-ops", async () => {
    const dek = generateKey();
    const state = await store.loadState("userG", dek);
    await state.keys.set({});
    const got = await state.keys.get("session", []);
    expect(got).toEqual({});
  });
});
