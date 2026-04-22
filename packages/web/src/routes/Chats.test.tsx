import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type JSX, type ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import type * as SonnerModule from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setAccessToken } from "../api/client";

import { Chats } from "./Chats";

// ---------------------------------------------------------------------------
// Mock sonner
// ---------------------------------------------------------------------------
vi.mock("sonner", async () => {
  const actual = await vi.importActual<typeof SonnerModule>("sonner");
  return {
    ...actual,
    toast: { success: () => undefined, error: () => undefined },
  };
});

// ---------------------------------------------------------------------------
// Mock EventSource (SSE)
// ---------------------------------------------------------------------------

type ESListener = (e: MessageEvent | Event) => void;

class MockEventSource {
  static latest: MockEventSource | null = null;
  url: string;
  readyState = 0;
  private listeners = new Map<string, Set<ESListener>>();

  constructor(url: string) {
    this.url = url;
    MockEventSource.latest = this;
  }

  addEventListener(type: string, listener: ESListener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }
  removeEventListener(type: string, listener: ESListener): void {
    this.listeners.get(type)?.delete(listener);
  }
  close(): void {
    this.readyState = 2;
  }

  emit(type: string, data: unknown): void {
    const payload = typeof data === "string" ? data : JSON.stringify(data);
    const evt = Object.assign(new Event(type), { data: payload }) as MessageEvent;
    this.listeners.get(type)?.forEach((l) => {
      l(evt);
    });
  }

  open(): void {
    this.readyState = 1;
    this.listeners.get("open")?.forEach((l) => {
      l(new Event("open"));
    });
  }
}

// ---------------------------------------------------------------------------
// Fetch mock helpers
// ---------------------------------------------------------------------------

const fetchMock = vi.fn<typeof fetch>();

const EMPTY_CONVERSATIONS = { conversations: [], nextCursor: null };
const SOME_CONVERSATIONS = {
  conversations: [
    { id: "c1", jid: "1@s.whatsapp.net", type: "individual", lastMessageAt: null, title: "Alice" },
    { id: "c2", jid: "2@s.whatsapp.net", type: "individual", lastMessageAt: null, title: "Bob" },
  ],
  nextCursor: null,
};
const MESSAGES_C1 = {
  messages: [
    {
      id: "m1",
      waMessageId: "wm1",
      fromJid: "1@s.whatsapp.net",
      direction: "in" as const,
      timestamp: new Date().toISOString(),
      body: { kind: "text", text: "Hello from Alice" },
      hasMedia: false,
    },
  ],
  hasMore: false,
};

function setupFetch(routes: {
  conversations?: unknown;
  messagesC1?: unknown;
  disconnect?: { status: number };
}): void {
  fetchMock.mockImplementation((input) => {
    const url = typeof input === "string" ? input : (input as Request).url;

    if (url.includes("/api/conversations/c1/messages")) {
      return Promise.resolve(
        new Response(JSON.stringify(routes.messagesC1 ?? MESSAGES_C1), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    if (url.includes("/api/conversations")) {
      return Promise.resolve(
        new Response(JSON.stringify(routes.conversations ?? SOME_CONVERSATIONS), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    if (url.includes("/api/pair/disconnect")) {
      return Promise.resolve(new Response(null, { status: routes.disconnect?.status ?? 204 }));
    }
    return Promise.resolve(new Response(null, { status: 404 }));
  });
}

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

function LocationProbe(): JSX.Element {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname}</div>;
}

function Providers({
  children,
  initialEntries,
}: {
  children: ReactNode;
  initialEntries?: string[];
}): JSX.Element {
  const entries = initialEntries ?? ["/chats"];
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={entries}>
        <Routes>
          <Route path="/chats" element={children} />
          <Route path="/pair" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function renderChats(initialEntries?: string[]): void {
  const props = initialEntries ? { initialEntries } : {};
  render(
    <Providers {...props}>
      <Chats />
    </Providers>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  MockEventSource.latest = null;
  vi.stubGlobal("EventSource", MockEventSource);
  vi.stubGlobal("fetch", fetchMock);
  setAccessToken("test-token");
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe("Chats", () => {
  it("renders the empty state when there are no conversations", async () => {
    setupFetch({ conversations: EMPTY_CONVERSATIONS });
    renderChats();

    await waitFor(() => {
      expect(screen.getByTestId("chats-empty-state")).toBeInTheDocument();
    });
    expect(screen.getByText(/No conversations yet/i)).toBeInTheDocument();
  });

  it("renders conversation list from API", async () => {
    setupFetch({});
    renderChats();

    await waitFor(() => {
      expect(screen.getByTestId("conv-item-c1")).toBeInTheDocument();
    });
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("clicking a conversation fetches and renders its messages", async () => {
    setupFetch({});
    const user = userEvent.setup();
    renderChats();

    await waitFor(() => {
      expect(screen.getByTestId("conv-item-c1")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("conv-item-c1"));

    await waitFor(() => {
      expect(screen.getByTestId("message-list")).toBeInTheDocument();
    });
    expect(screen.getByText("Hello from Alice")).toBeInTheDocument();
  });

  it("deep-link ?c=c1 selects conversation on mount", async () => {
    setupFetch({});
    renderChats(["/chats?c=c1"]);

    await waitFor(() => {
      expect(screen.getByTestId("message-list")).toBeInTheDocument();
    });
    expect(screen.getByText("Hello from Alice")).toBeInTheDocument();
  });

  it("SSE message.created invalidates conversations + messages for open conv", async () => {
    setupFetch({});
    renderChats(["/chats?c=c1"]);

    // Wait for initial load.
    await waitFor(() => {
      expect(screen.getByTestId("message-list")).toBeInTheDocument();
    });

    const initialConvCalls = fetchMock.mock.calls.filter(
      (c) =>
        (c[0] as string).includes("/api/conversations") && !(c[0] as string).includes("/messages"),
    ).length;
    const initialMsgCalls = fetchMock.mock.calls.filter((c) =>
      (c[0] as string).includes("/messages"),
    ).length;

    // Simulate SSE event.
    act(() => {
      MockEventSource.latest?.open();
      MockEventSource.latest?.emit("message.created", {
        type: "message.created",
        conversationId: "c1",
        messageId: "m2",
        timestamp: new Date().toISOString(),
      });
    });

    await waitFor(() => {
      const newConvCalls = fetchMock.mock.calls.filter(
        (c) =>
          (c[0] as string).includes("/api/conversations") &&
          !(c[0] as string).includes("/messages"),
      ).length;
      expect(newConvCalls).toBeGreaterThan(initialConvCalls);
    });

    await waitFor(() => {
      const newMsgCalls = fetchMock.mock.calls.filter((c) =>
        (c[0] as string).includes("/messages"),
      ).length;
      expect(newMsgCalls).toBeGreaterThan(initialMsgCalls);
    });
  });

  it("Disconnect button → confirm → POST fires + navigate to /pair", async () => {
    setupFetch({});
    const user = userEvent.setup();
    renderChats();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /disconnect/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /disconnect/i }));

    // AlertDialog confirmation should appear.
    await waitFor(() => {
      expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    });

    // Click the destructive Disconnect action (there may be two buttons with "Disconnect" text)
    const disconnectButtons = screen.getAllByRole("button", { name: /disconnect/i });
    // The one inside the dialog is the last one
    const lastBtn = disconnectButtons[disconnectButtons.length - 1];
    if (!lastBtn) throw new Error("Disconnect button not found");
    await user.click(lastBtn);

    await waitFor(() => {
      const disconnectCalls = fetchMock.mock.calls.filter((c) =>
        (c[0] as string).includes("/pair/disconnect"),
      );
      expect(disconnectCalls.length).toBeGreaterThan(0);
    });

    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent("/pair");
    });
  });
});
