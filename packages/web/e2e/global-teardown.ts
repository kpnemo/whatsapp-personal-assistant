import { execFile } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import type { FullConfig } from "@playwright/test";

const execFileP = promisify(execFile);

const __dirname = dirname(fileURLToPath(import.meta.url));

interface StackBreadcrumb {
  project: string;
  envFile: string;
  port: number;
  repoRoot: string;
}

/**
 * Tear down whatever `wpa-e2e` compose project global-setup stood up. We read
 * the breadcrumb written by global-setup rather than relying on module-level
 * state — Playwright sometimes re-imports the teardown file in a fresh Node
 * context, and closure-based state would be lost.
 *
 * `-v` wipes the volumes so the next run starts with a clean Postgres + Redis.
 */
export default async function globalTeardown(_config: FullConfig): Promise<void> {
  const breadcrumbPath = resolve(__dirname, ".state", "stack.json");
  let breadcrumb: StackBreadcrumb;
  try {
    breadcrumb = JSON.parse(await readFile(breadcrumbPath, "utf8")) as StackBreadcrumb;
  } catch {
    // eslint-disable-next-line no-console
    console.warn(
      "[e2e] global-teardown: no breadcrumb found at",
      breadcrumbPath,
      "- nothing to tear down.",
    );
    return;
  }

  // Keep the stack up across local re-runs if E2E_KEEP_STACK=1 is set — speeds
  // up iterative spec development (no need to re-pull images every time).
  if (process.env.E2E_KEEP_STACK === "1") {
    // eslint-disable-next-line no-console
    console.log("[e2e] global-teardown: E2E_KEEP_STACK=1 — leaving stack running.");
    return;
  }

  // eslint-disable-next-line no-console
  console.log(`[e2e] global-teardown: tearing down project=${breadcrumb.project}`);

  try {
    await execFileP(
      "docker",
      [
        "compose",
        "-f",
        "docker-compose.yml",
        "-f",
        "docker-compose.e2e.yml",
        "-p",
        breadcrumb.project,
        "--env-file",
        breadcrumb.envFile,
        "down",
        "-v",
      ],
      {
        cwd: breadcrumb.repoRoot,
        env: {
          ...process.env,
          COMPOSE_PROJECT_NAME: breadcrumb.project,
          API_HOST_PORT: String(breadcrumb.port),
        },
        timeout: 120_000,
        maxBuffer: 16 * 1024 * 1024,
      },
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[e2e] global-teardown: docker compose down warned:", err);
  }

  // Remove the temp env file + breadcrumb so a stale run doesn't confuse the
  // next setup pass.
  try {
    await rm(breadcrumb.envFile, { force: true });
    await rm(resolve(__dirname, ".state"), { recursive: true, force: true });
  } catch {
    // Non-fatal — the next global-setup overwrites `.env.e2e` anyway.
  }
}
