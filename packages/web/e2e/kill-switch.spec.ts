import { expect, test } from "@playwright/test";

import { clearRateLimits } from "./helpers";

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "e2e-admin@example.com";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "e2e-pass-12345678";

/**
 * Kill-switch E2E — clicking the header button opens an AlertDialog, confirming
 * fires POST /api/kill and shows a success toast.
 *
 * Uses a fresh BrowserContext per test (Playwright default) so cookies from
 * the auth-flow spec don't leak in.
 */
test.describe("kill switch", () => {
  test.beforeEach(async ({ page }) => {
    // Reset rate-limit state so the /auth/login ceiling (5/15min/IP) doesn't
    // trip after a couple of specs.
    await clearRateLimits();
    // Start at `/` so RequireAuth runs bootstrap() — hitting `/login` directly
    // leaves `useAuth.loading` stuck at true and the page renders skeletons.
    await page.goto("/");
    await page.waitForURL(/\/login$/);
    await page.getByLabel("Email").fill(ADMIN_EMAIL);
    await page.getByLabel("Password").fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test("opens dialog, cancel does not call /api/kill", async ({ page }) => {
    // Fail the test if anything POSTs /api/kill while we're cancelling.
    const killRequests: string[] = [];
    await page.route("**/api/kill", (route) => {
      killRequests.push(route.request().method());
      return route.continue();
    });

    await page.getByRole("button", { name: /kill switch/i }).click();

    // AlertDialog has the expected copy.
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/mute the assistant globally/i)).toBeVisible();

    // Cancel → dialog closes, no kill request.
    await dialog.getByRole("button", { name: /^cancel$/i }).click();
    await expect(dialog).toBeHidden();

    expect(killRequests).toEqual([]);
  });

  test("confirm sends POST /api/kill and shows success toast", async ({ page, baseURL }) => {
    if (!baseURL) throw new Error("baseURL not configured");

    const killResponsePromise = page.waitForResponse(
      (res) => res.url().endsWith("/api/kill") && res.request().method() === "POST",
      { timeout: 10_000 },
    );

    await page.getByRole("button", { name: /kill switch/i }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();

    await dialog.getByRole("button", { name: /^mute assistant$/i }).click();

    const killResponse = await killResponsePromise;
    expect(killResponse.status()).toBe(200);
    const body = (await killResponse.json()) as { muted: boolean };
    expect(body.muted).toBe(true);

    // Sonner toast renders via a portal at the body root. The title is
    // "Kill switch armed — assistant muted globally." (see Shell.tsx).
    await expect(page.getByText(/kill switch armed/i)).toBeVisible({ timeout: 5_000 });
  });
});
