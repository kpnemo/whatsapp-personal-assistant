import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface Ciphertext {
  iv: Buffer;
  tag: Buffer;
  ciphertext: Buffer;
}

export function generateKey(): Buffer {
  return randomBytes(KEY_BYTES);
}

function assertKey(key: Buffer): void {
  if (key.length !== KEY_BYTES) {
    throw new Error(`key must be ${KEY_BYTES.toString()} bytes`);
  }
}

export function encryptWithKey(key: Buffer, plaintext: string | Buffer): Ciphertext {
  assertKey(key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const pt = typeof plaintext === "string" ? Buffer.from(plaintext, "utf8") : plaintext;
  const ciphertext = Buffer.concat([cipher.update(pt), cipher.final()]);
  const tag = cipher.getAuthTag();
  if (tag.length !== TAG_BYTES) {
    throw new Error("unexpected GCM tag length");
  }
  return { iv, tag, ciphertext };
}

export function decryptWithKey(key: Buffer, ct: Ciphertext): string {
  assertKey(key);
  const decipher = createDecipheriv(ALGO, key, ct.iv);
  decipher.setAuthTag(ct.tag);
  const pt = Buffer.concat([decipher.update(ct.ciphertext), decipher.final()]);
  return pt.toString("utf8");
}

export function wrapDek(master: Buffer, dek: Buffer): Ciphertext {
  assertKey(master);
  assertKey(dek);
  return encryptWithKey(master, dek);
}

export function unwrapDek(master: Buffer, wrapped: Ciphertext): Buffer {
  assertKey(master);
  const decipher = createDecipheriv(ALGO, master, wrapped.iv);
  decipher.setAuthTag(wrapped.tag);
  return Buffer.concat([decipher.update(wrapped.ciphertext), decipher.final()]);
}

export function serializeCiphertext(ct: Ciphertext): string {
  return [
    ct.iv.toString("base64"),
    ct.tag.toString("base64"),
    ct.ciphertext.toString("base64"),
  ].join(".");
}

export function parseCiphertext(s: string): Ciphertext {
  const parts = s.split(".");
  if (parts.length !== 3) {
    throw new Error("malformed ciphertext");
  }
  return {
    iv: Buffer.from(parts[0]!, "base64"),
    tag: Buffer.from(parts[1]!, "base64"),
    ciphertext: Buffer.from(parts[2]!, "base64"),
  };
}
