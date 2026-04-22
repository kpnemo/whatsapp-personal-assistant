import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MessageList } from "./MessageList.js";

// ---------------------------------------------------------------------------
// Mock the API client so tests don't make real HTTP requests.
// ---------------------------------------------------------------------------

const fetchMock = vi.fn<typeof fetch>();

// Build a messages response object.
function makeMessagesResponse(ids: string[]) {
  return {
    messages: ids.map((id) => ({
      id,
      waMessageId: `w${id}`,
      fromJid: "1@s.whatsapp.net",
      direction: "in" as const,
      timestamp: new Date().toISOString(),
      body: { kind: "text" as const, text: `Message ${id}` },
      hasMedia: false,
    })),
    hasMore: false,
  };
}

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

function Providers({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupFetchWithMessages(ids: string[]) {
  fetchMock.mockImplementation(() =>
    Promise.resolve(
      new Response(JSON.stringify(makeMessagesResponse(ids)), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MessageList", () => {
  it("renders messages from the API", async () => {
    setupFetchWithMessages(["m1", "m2"]);

    render(
      <Providers>
        <MessageList conversationId="c1" />
      </Providers>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("message-list")).toBeInTheDocument();
    });
    expect(screen.getByText("Message m1")).toBeInTheDocument();
    expect(screen.getByText("Message m2")).toBeInTheDocument();
  });

  it("auto-scrolls to bottom on initial load when already at bottom", async () => {
    setupFetchWithMessages(["m1"]);

    const scrollIntoViewSpy = vi.spyOn(HTMLElement.prototype, "scrollIntoView");

    render(
      <Providers>
        <MessageList conversationId="c1" />
      </Providers>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("message-list")).toBeInTheDocument();
    });

    // scrollIntoView should have been called (initial message arrival from length 0 → 1).
    expect(scrollIntoViewSpy).toHaveBeenCalled();
    scrollIntoViewSpy.mockRestore();
  });

  it("does NOT auto-scroll when user has scrolled up", async () => {
    setupFetchWithMessages(["m1"]);

    const scrollIntoViewSpy = vi.spyOn(HTMLElement.prototype, "scrollIntoView");

    const { rerender } = render(
      <Providers>
        <MessageList conversationId="c1" />
      </Providers>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("message-list")).toBeInTheDocument();
    });

    // Clear calls from initial load.
    scrollIntoViewSpy.mockClear();

    // Simulate the user scrolling up in the viewport.
    const viewport = screen.getByTestId("message-list-viewport");

    // jsdom doesn't implement real scroll geometry, so we set properties
    // manually to put the viewport "far from the bottom".
    Object.defineProperty(viewport, "scrollHeight", { value: 2000, configurable: true });
    Object.defineProperty(viewport, "clientHeight", { value: 400, configurable: true });
    Object.defineProperty(viewport, "scrollTop", { value: 0, configurable: true });

    act(() => {
      fireEvent.scroll(viewport, { target: viewport });
    });

    // Now simulate a new message arriving by re-fetching with an extra message.
    // We force a re-render with a different queryKey to trigger the length change guard.
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify(makeMessagesResponse(["m1", "m2_new"])), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    // Re-render with the same conversation — the query cache will treat the
    // already-resolved data as fresh; we directly manipulate the component
    // via a new conversationId to force a fresh query with the new message count.
    rerender(
      <Providers>
        <MessageList conversationId="c1-v2" />
      </Providers>,
    );

    await waitFor(() => {
      expect(screen.getByText("Message m2_new")).toBeInTheDocument();
    });

    // Because the viewport scroll position is near the top (scrollHeight 2000,
    // scrollTop 0, clientHeight 400 → distance from bottom = 1600 > 50),
    // auto-scroll should NOT have fired.
    expect(scrollIntoViewSpy).not.toHaveBeenCalled();

    scrollIntoViewSpy.mockRestore();
  });
});
