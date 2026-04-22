import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

/**
 * Abstraction for persisting encrypted media blobs.
 *
 * `put` writes `bytes` and returns an opaque `ref` string that can later be
 * passed to `get` to retrieve the same bytes. The ref is intentionally
 * relative so that the root directory can change between deployments without
 * invalidating stored references.
 */
export interface MediaStore {
  put(userId: string, messageId: string, bytes: Buffer): Promise<string>;
  get(ref: string): Promise<Buffer>;
}

/**
 * Local-disk implementation.
 *
 * Layout: `<rootDir>/<userId>/<messageId>.bin`
 *
 * - Parent directory is created with mode 0700 (owner-only).
 * - File is written with mode 0600 (owner-only read/write).
 * - Returns the relative path `"<userId>/<messageId>.bin"` as the ref.
 */
export class LocalDiskMediaStore implements MediaStore {
  readonly #rootDir: string;

  constructor(rootDir: string) {
    this.#rootDir = rootDir;
  }

  async put(userId: string, messageId: string, bytes: Buffer): Promise<string> {
    const userDir = join(this.#rootDir, userId);
    await mkdir(userDir, { recursive: true, mode: 0o700 });

    const filePath = join(userDir, `${messageId}.bin`);
    await writeFile(filePath, bytes, { mode: 0o600 });

    return `${userId}/${messageId}.bin`;
  }

  async get(ref: string): Promise<Buffer> {
    const filePath = resolve(this.#rootDir, ref);
    const rootResolved = resolve(this.#rootDir);
    if (filePath !== rootResolved && !filePath.startsWith(rootResolved + sep)) {
      throw new Error("invalid media ref: path traversal detected");
    }
    return readFile(filePath);
  }
}

/** Convenience factory — reads `MEDIA_DIR` env, defaults to `/app/media`. */
export function makeLocalDiskMediaStore(rootDir?: string): LocalDiskMediaStore {
  const dir = rootDir ?? process.env.MEDIA_DIR ?? "/app/media";
  return new LocalDiskMediaStore(dir);
}
