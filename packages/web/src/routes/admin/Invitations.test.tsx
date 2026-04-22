import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type JSX, type ReactNode } from "react";
import { MemoryRouter } from "react-router";
import type * as SonnerModule from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setAccessToken } from "../../api/client";
import { useAuth } from "../../stores/auth";

import { AdminInvitations } from "./Invitations";

vi.mock("sonner", async () => {
  const actual = await vi.importActual<typeof SonnerModule>("sonner");
  return {
    ...actual,
    toast: {
      success: () => undefined,
      error: () => undefined,
    },
  };
});

function Providers({ children }: { children: ReactNode }): JSX.Element {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

function renderPage(): void {
  render(
    <Providers>
      <AdminInvitations />
    </Providers>,
  );
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  setAccessToken("test-token");
  useAuth.setState({
    me: { id: "admin-1", email: "admin@example.com", role: "admin" },
    loading: false,
    error: null,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
  useAuth.setState({ me: null, loading: false, error: null });
});

describe("AdminInvitations page", () => {
  it("renders the page title and Invite member button", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    renderPage();
    expect(screen.getByRole("heading", { name: /invitations/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /invite member/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
  });

  it("fetches GET /api/invitations on mount", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    renderPage();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const call = fetchMock.mock.calls[0]!;
    const url = call[0];
    const urlString = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    expect(urlString).toBe("/api/invitations");
    expect(call[1]?.method ?? "GET").toBe("GET");
  });

  it("renders a row per invitation returned by the API", async () => {
    const rows = [
      {
        id: "inv-1",
        email: "alice@example.com",
        expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
        usedAt: null,
        createdAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      },
      {
        id: "inv-2",
        email: "bob@example.com",
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        usedAt: null,
        createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      },
      {
        id: "inv-3",
        email: "carol@example.com",
        expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        usedAt: null,
        createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
      },
    ];
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(rows), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    renderPage();

    expect(await screen.findByText(/alice@example\.com/)).toBeInTheDocument();
    expect(screen.getByText(/bob@example\.com/)).toBeInTheDocument();
    expect(screen.getByText(/carol@example\.com/)).toBeInTheDocument();
  });

  it("clicking Invite member opens the dialog", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /invite member/i }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/invite a family member/i)).toBeInTheDocument();
  });

  it("shows the empty-state text when the list is empty", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    renderPage();
    expect(await screen.findByText(/no invitations yet/i)).toBeInTheDocument();
  });
});
