import { describe, expect, it } from "vitest";

import { decryptWithKey, encryptWithKey, generateKey, unwrapDek, wrapDek } from "./crypto.js";

describe("encryptWithKey / decryptWithKey", () => {
  const key = generateKey();

  it("round-trips a utf-8 string", () => {
    const ct = encryptWithKey(key, "hello world");
    expect(decryptWithKey(key, ct)).toBe("hello world");
  });

  it("produces distinct ciphertexts for the same plaintext (unique IV)", () => {
    const a = encryptWithKey(key, "same");
    const b = encryptWithKey(key, "same");
    expect(a.iv).not.toEqual(b.iv);
    expect(a.ciphertext).not.toEqual(b.ciphertext);
  });

  it("fails authentication when ciphertext is tampered", () => {
    const ct = encryptWithKey(key, "secret");
    const tampered = {
      ...ct,
      ciphertext: Buffer.concat([
        ct.ciphertext.subarray(0, 1).map((b) => b ^ 0xff),
        ct.ciphertext.subarray(1),
      ]),
    };
    expect(() => decryptWithKey(key, tampered)).toThrow();
  });

  it("fails authentication with a wrong key", () => {
    const ct = encryptWithKey(key, "secret");
    const other = generateKey();
    expect(() => decryptWithKey(other, ct)).toThrow();
  });

  it("rejects keys that are not 32 bytes", () => {
    expect(() => encryptWithKey(Buffer.alloc(16), "x")).toThrow(/32 bytes/);
  });
});

describe("wrapDek / unwrapDek", () => {
  const master = generateKey();

  it("round-trips a DEK", () => {
    const dek = generateKey();
    const wrapped = wrapDek(master, dek);
    const unwrapped = unwrapDek(master, wrapped);
    expect(unwrapped.equals(dek)).toBe(true);
  });

  it("unwrap fails with a wrong master key", () => {
    const dek = generateKey();
    const wrapped = wrapDek(master, dek);
    expect(() => unwrapDek(generateKey(), wrapped)).toThrow();
  });
});
