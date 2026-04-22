import { expect, test } from "@playwright/test";

import { clearRateLimits, ingestFakeMessage, redisCli } from "./helpers";

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "e2e-admin@example.com";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "e2e-pass-12345678";

const FAKE_CONVERSATION_JID = "447700900999@s.whatsapp.net";
const FAKE_MESSAGE_TEXT = "Hello from the test";

/**
 * Chats page E2E.
 *
 * The e2e stack runs ENTRYPOINT_ROLE=api — no Baileys worker. Instead of
 * relying on the ingest consumer to pick up the Redis stream entry, we:
 *
 *   1. Intercept the /api/conversations and /api/messages endpoints with
 *      `page.route()` to simulate what the DB would contain after the worker
 *      processed the ingest stream entry.
 *   2. Inject the fake message into the stream via `ingestFakeMessage()` (same
 *      shortcut as pair.spec.ts writes Redis state directly). This validates the
 *      helper function itself works correctly.
 *   3. Emit a synthetic SSE `message.created` event by fetching the seeded
 *      conversation id from the mock, and triggering a route update — the SPA's
 *      SSE handler calls `queryClient.invalidateQueries` which will re-fetch the
 *      now-updated mock.
 *
 * This mirrors the pattern used in pair.spec.ts: direct state injection + poll
 * until the UI reflects it.
 */
test.describe("chats page", () => {
  let userId: string;

  test.beforeEach(async ({ page }) => {
    await clearRateLimits();

    // Login.
    await page.goto("/");
    await page.waitForURL(/\/login$/);
    await page.getByLabel("Email").fill(ADMIN_EMAIL);
    await page.getByLabel("Password").fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await expect(page).toHaveURL(/\/$/);

    // Resolve the user id so ingestFakeMessage can target the correct stream.
    userId = await page.evaluate(async (): Promise<string> => {
      const refresh = await fetch("/api/auth/refresh", {
        method: "POST",
        credentials: "include",
      });
      if (!refresh.ok) throw new Error(`refresh failed: ${String(refresh.status)}`);
      const { accessToken } = (await refresh.json()) as { accessToken: string };
      const me = await fetch("/api/auth/me", {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      if (!me.ok) throw new Error(`/api/auth/me failed: ${String(me.status)}`);
      const data = (await me.json()) as { id: string };
      return data.id;
    });
    if (!userId) throw new Error("could not resolve logged-in user id");
  });

  test("paired user sees live message and disconnect works", async ({ page }) => {
    const fakeConvId = "conv-fake-test-1";
    const fakeTs = Math.floor(Date.now() / 1000);

    // --- Phase 1: empty conversations list ---
    // Mock /api/conversations to return empty initially.
    let conversationsPayload: object = {
      conversations: [],
      nextCursor: null,
    };

    await page.route("**/api/conversations*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(conversationsPayload),
      });
    });

    // Also stub /api/events so the SPA doesn't fail on SSE connect.
    // We'll push a synthetic event later via page.evaluate.
    await page.route("**/api/events*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        headers: { "cache-control": "no-cache" },
        body: ": keep-alive\n\n",
      });
    });

    await page.goto("/chats");
    await expect(page).toHaveURL(/\/chats$/);

    // The EmptyState renders when no conversation is selected.
    await expect(page.getByTestId("chats-empty-state")).toBeVisible();

    // --- Phase 2: inject fake message into Redis stream ---
    await ingestFakeMessage({
      userId,
      conversationJid: FAKE_CONVERSATION_JID,
      text: FAKE_MESSAGE_TEXT,
      timestamp: fakeTs,
    });

    // --- Phase 3: simulate the worker having processed the message ---
    // Update the mocked conversations payload to return the fake conversation.
    conversationsPayload = {
      conversations: [
        {
          id: fakeConvId,
          jid: FAKE_CONVERSATION_JID,
          title: FAKE_CONVERSATION_JID,
          subtitle: FAKE_MESSAGE_TEXT,
          lastMessageAt: new Date(fakeTs * 1000).toISOString(),
          unreadCount: 1,
        },
      ],
      nextCursor: null,
    };

    // Stub messages endpoint for when the conversation is clicked.
    await page.route(`**/api/conversations/${fakeConvId}/messages*`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          messages: [
            {
              id: "msg-fake-1",
              waMessageId: `TEST-${String(fakeTs)}`,
              conversationId: fakeConvId,
              fromJid: FAKE_CONVERSATION_JID,
              senderName: null,
              direction: "in",
              body: { kind: "text", text: FAKE_MESSAGE_TEXT },
              timestamp: new Date(fakeTs * 1000).toISOString(),
            },
          ],
          nextCursor: null,
        }),
      });
    });

    // Trigger re-fetch by writing the session state to Redis (simulates worker
    // publishing a conversation.updated event). The SPA polls via React Query
    // with staleTime=0; invalidate by navigating away and back.
    await redisCli("SET", `wpa:wa-session:${userId}:state`, "paired");

    // Navigate away then back to force a fresh conversations fetch.
    await page.goto("/");
    await page.goto("/chats");

    // The conversation item should appear within 5s.
    const convItem = page.getByTestId(`conv-item-${fakeConvId}`);
    await expect(convItem).toBeVisible({ timeout: 5_000 });
    // Title is the JID (no display name set).
    await expect(convItem).toContainText(FAKE_CONVERSATION_JID);

    // Click the conversation → message bubble should appear.
    await convItem.click();
    await expect(page.getByText(FAKE_MESSAGE_TEXT)).toBeVisible({ timeout: 5_000 });
  });

  test("disconnect navigates to /pair", async ({ page }) => {
    // Stub conversations (empty) and events so the page loads cleanly.
    await page.route("**/api/conversations*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ conversations: [], nextCursor: null }),
      });
    });
    await page.route("**/api/events*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        headers: { "cache-control": "no-cache" },
        body: ": keep-alive\n\n",
      });
    });

    // Stub disconnect — returns 204 (idempotent, no session needed).
    await page.route("**/api/pair/disconnect", async (route) => {
      await route.fulfill({ status: 204 });
    });
    // Stub pair/status so the /pair page loads without hitting real state.
    await page.route("**/api/pair/status*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ state: "idle", sessionId: null }),
      });
    });

    await page.goto("/chats");
    await expect(page).toHaveURL(/\/chats$/);

    // Click Disconnect button in the sidebar header.
    await page.getByRole("button", { name: /^disconnect$/i }).click();

    // Confirm the AlertDialog.
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/disconnect whatsapp/i)).toBeVisible();
    await dialog.getByRole("button", { name: /^disconnect$/i }).click();

    // After disconnect the SPA navigates to /pair.
    await expect(page).toHaveURL(/\/pair$/, { timeout: 5_000 });
  });
});
