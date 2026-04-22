import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..", "..");

const E2E_COMPOSE_PROJECT = process.env.E2E_COMPOSE_PROJECT ?? "wpa-e2e";

let cachedRedisPassword: string | null = null;
function readRedisPassword(): string {
  if (cachedRedisPassword !== null) return cachedRedisPassword;
  const envFile = resolve(REPO_ROOT, ".env.e2e");
  const contents = readFileSync(envFile, "utf8");
  const match = /^REDIS_PASSWORD=(.+)$/m.exec(contents);
  if (!match?.[1]) {
    throw new Error(`Could not read REDIS_PASSWORD from ${envFile} — did global-setup run?`);
  }
  cachedRedisPassword = match[1].trim();
  return cachedRedisPassword;
}

/**
 * Run a redis-cli command against the e2e Redis container. Uses `docker exec`
 * so tests don't need a redis-cli binary on the host. We pass REDIS_PASSWORD
 * explicitly because the redis container doesn't receive it as an env var
 * (only the app service does via env_file).
 */
export async function redisCli(...args: string[]): Promise<string> {
  const container = `${E2E_COMPOSE_PROJECT}-redis-1`;
  const password = readRedisPassword();
  const { stdout } = await execFileP(
    "docker",
    ["exec", container, "redis-cli", "-a", password, "--no-auth-warning", ...args],
    { maxBuffer: 8 * 1024 * 1024 },
  );
  return stdout.trim();
}

/**
 * Clear all rate-limit keys so successive specs don't step on each other. The
 * auth login limiter is 5/15min per IP — running 3 specs that each log in
 * via the UI blows past the ceiling. Flushing `rl:*` between tests is the
 * cheapest reset that doesn't require reconfiguring the server.
 *
 * NOTE: avoid the temptation to wire env-based rate-limit overrides into
 * `@wpa/api` just for tests. That would add production code to serve a test
 * concern and violate the "tests exercise real code" principle.
 */
export async function clearRateLimits(): Promise<void> {
  // `--no-raw` would help debug but isn't necessary. The EVAL pattern is
  // atomic-ish: SCAN+DEL in a single round trip, avoiding the race where a
  // key is created between SCAN and DEL.
  await redisCli(
    "EVAL",
    'local keys = redis.call("KEYS", "rl:*"); for i=1,#keys do redis.call("DEL", keys[i]) end; return #keys',
    "0",
  );
}
