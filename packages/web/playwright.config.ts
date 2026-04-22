import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for @wpa/web end-to-end tests.
 *
 * Runs a throwaway docker-compose stack in global-setup (see `e2e/global-setup.ts`)
 * on a dedicated port + COMPOSE_PROJECT_NAME so the dev stack (port 3003,
 * project name `wpa`) is untouched.
 *
 * Chromium-only — we aren't shipping a WebKit/Firefox matrix yet. Speed in CI
 * matters more than cross-engine coverage at P0.5.
 */
const E2E_PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${String(E2E_PORT)}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts$/,
  // One worker: the e2e stack is a single shared docker-compose project. Running
  // specs in parallel against the same Postgres/Redis would cause cross-spec
  // state contamination (e.g. register spec creates the admin; pair spec depends
  // on being logged in as that admin).
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    baseURL: BASE_URL,
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    // Playwright's default navigationTimeout of 30s is enough; page.goto() on
    // the SPA entry is instant once the stack is up.
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
