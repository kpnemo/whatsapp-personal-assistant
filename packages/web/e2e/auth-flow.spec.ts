import { expect, test } from "@playwright/test";

import { clearRateLimits } from "./helpers";

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "e2e-admin@example.com";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "e2e-pass-12345678";

/**
 * Auth flow E2E — exercises register-then-login-then-refresh end-to-end against
 * the real API + SPA.
 *
 * Note: global-setup already registered the admin via POST /api/auth/register,
 * so we hit /login first and sign in with those credentials (the SPA's Register
 * route returns a 409 on duplicate email which would fail the spec).
 *
 * What we care about:
 * - Login form POSTs /api/auth/login, the SPA stashes the access token, and
 *   redirects to `/`.
 * - The user-menu Sign out button calls /api/auth/logout and returns to /login.
 * - A page reload re-authenticates via /api/auth/refresh (httpOnly cookie) so
 *   the user stays signed in.
 */
test.describe("auth flow", () => {
  test.beforeEach(async () => {
    // Reset the /auth/login rate-limit bucket so spec re-runs don't trip the
    // 5/15min/IP ceiling. See helpers.ts for the rationale.
    await clearRateLimits();
  });

  test("login, refresh-persists, sign out", async ({ page, baseURL }) => {
    if (!baseURL) throw new Error("baseURL not configured");

    // 1) Login via the UI. Visit `/` rather than `/login` directly — the SPA
    // bootstraps auth via `RequireAuth` which lives on the `/` tree; hitting
    // `/login` directly leaves `useAuth.loading = true` forever (no bootstrap
    // path), and the page renders only skeletons. Starting at `/` lets the
    // refresh-cookie probe resolve, then Navigate redirects us to `/login`
    // with the store in a usable state.
    await page.goto("/");
    await page.waitForURL(/\/login$/);
    await expect(page.getByText(/sign in/i).first()).toBeVisible();

    await page.getByLabel("Email").fill(ADMIN_EMAIL);
    await page.getByLabel("Password").fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: /^sign in$/i }).click();

    // 2) Lands on dashboard.
    await expect(page).toHaveURL(/\/$/);
    // Shell should render the header with the app title + user menu.
    await expect(page.getByRole("heading", { name: /WhatsApp Personal Assistant/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /user menu/i })).toBeVisible();

    // 3) Refresh the page — should stay authenticated via the refresh cookie.
    await page.reload();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("button", { name: /user menu/i })).toBeVisible();

    // 4) Sign out via user menu → back to /login.
    await page.getByRole("button", { name: /user menu/i }).click();
    await page.getByRole("menuitem", { name: /sign out/i }).click();
    await expect(page).toHaveURL(/\/login$/);
    // CardTitle renders as a div[data-slot=card-title], not a heading — match
    // on the "Sign in" text itself (covers both the title and the button).
    await expect(page.getByText(/sign in/i).first()).toBeVisible();

    // 5) Sign back in → lands on dashboard again (proves the round-trip).
    await page.getByLabel("Email").fill(ADMIN_EMAIL);
    await page.getByLabel("Password").fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("button", { name: /user menu/i })).toBeVisible();
  });

  test("invalid credentials surfaces inline error", async ({ page }) => {
    await page.goto("/");
    await page.waitForURL(/\/login$/);
    await page.getByLabel("Email").fill(ADMIN_EMAIL);
    await page.getByLabel("Password").fill("not-the-right-password");
    await page.getByRole("button", { name: /^sign in$/i }).click();

    await expect(page.getByRole("alert")).toContainText(/invalid email or password/i);
    // Still on /login — no redirect on auth failure.
    await expect(page).toHaveURL(/\/login$/);
  });
});
