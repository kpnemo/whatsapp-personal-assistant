import { expect, test } from "@playwright/test";

import { clearRateLimits, redisCli } from "./helpers";

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "e2e-admin@example.com";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "e2e-pass-12345678";

/**
 * Minimal 1x1 transparent PNG, base64-encoded. Stands in for the real QR PNG
 * the worker would publish to `wpa:pair:{userId}:qr`. The SPA doesn't validate
 * the PNG contents — it just renders the base64 into a `data:image/png;base64,...`
 * URL.
 */
const FAKE_QR_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

/**
 * Pair flow E2E.
 *
 * The e2e stack runs ENTRYPOINT_ROLE=api — no worker. Baileys would try to
 * dial WhatsApp on /pair/init, which is both unreliable in CI and actively
 * undesirable (fake pairing sessions shouldn't hit WA's infra). Instead, we
 * fake the worker by writing state + QR directly into Redis after /pair/init
 * fires. This covers the full UI flow: ToS gate → Initialize → Generating →
 * AwaitingScan with rendered QR.
 */
test.describe("pair flow", () => {
  test.beforeEach(async ({ page }) => {
    // Reset rate-limit state so the login + /pair/init buckets are fresh on
    // every run. The pair-init limiter is 3/hr/user — without a reset, a
    // second test run within the hour would fail with 429.
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

  test("ToS gate → initialize → QR renders", async ({ page, baseURL }) => {
    if (!baseURL) throw new Error("baseURL not configured");

    // Navigate to the pair route. The SPA uses client-side routing, so click
    // the nav link rather than a full page load — exercises the Shell too.
    await page.getByRole("link", { name: /pair whatsapp/i }).click();
    await expect(page).toHaveURL(/\/pair$/);

    // ToS gate should be the first thing the user sees (no existing session).
    await expect(page.getByText(/terms-of-service notice/i)).toBeVisible();
    await expect(page.getByText(/violates whatsapp's terms of service/i)).toBeVisible();

    // Wait for POST /api/pair/init to fire + resolve, then inject the "worker
    // did its thing" Redis state before the SPA's 1s status poll hits.
    const initResponsePromise = page.waitForResponse(
      (res) => res.url().endsWith("/api/pair/init") && res.request().method() === "POST",
      { timeout: 15_000 },
    );

    await page.getByRole("button", { name: /I understand, initialize pairing/i }).click();
    const initResponse = await initResponsePromise;
    expect(initResponse.status()).toBe(201);

    // Look up our user id so we can target the right Redis keys. The API
    // returns `userId` from /api/auth/login, but we logged in via the UI —
    // easier to grab from /api/auth/me with the refresh cookie.
    const myId = await page.evaluate(async () => {
      const refresh = await fetch("/api/auth/refresh", {
        method: "POST",
        credentials: "include",
      });
      if (!refresh.ok) return null;
      const { accessToken } = (await refresh.json()) as { accessToken: string };
      const me = await fetch("/api/auth/me", {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      if (!me.ok) return null;
      const data = (await me.json()) as { id: string };
      return data.id;
    });
    if (!myId) throw new Error("could not resolve logged-in user id via /api/auth/me");

    // Simulate the worker:
    //   wpa:wa-session:{uid}:state = "awaiting_scan"
    //   wpa:pair:{uid}:qr         = <base64 png>, EX 30
    await redisCli("SET", `wpa:wa-session:${myId}:state`, "awaiting_scan");
    await redisCli("SET", `wpa:pair:${myId}:qr`, FAKE_QR_PNG_BASE64, "EX", "60");

    // The SPA polls /pair/status every 1s; give it up to ~10s to pick up the
    // new state and render the QR.
    const qrImg = page.getByTestId("pair-qr");
    await expect(qrImg).toBeVisible({ timeout: 10_000 });
    const src = await qrImg.getAttribute("src");
    expect(src).toMatch(/^data:image\/png;base64,/);
    expect(src).toContain(FAKE_QR_PNG_BASE64);

    // Kill switch should still be clickable/rendered while pairing — sanity
    // check that the shell is usable at this point. We don't need to confirm.
    await expect(page.getByRole("button", { name: /kill switch/i })).toBeVisible();
  });
});
