import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { type JSX, type ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setAccessToken } from "../api/client";
import { useAuth } from "../stores/auth";

import { Dashboard } from "./Dashboard";

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

function renderDashboard(): void {
  render(
    <Providers>
      <Dashboard />
    </Providers>,
  );
}

const fetchMock = vi.fn<typeof fetch>();

function mockStatus(body: {
  state: string;
  sessionId?: string | null;
  phoneNumber?: string | null;
  updatedAt?: string | null;
}): void {
  fetchMock.mockResolvedValue(
    new Response(
      JSON.stringify({
        sessionId: null,
        phoneNumber: null,
        updatedAt: null,
        ...body,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  setAccessToken("test-token");
  useAuth.setState({
    me: { id: "u-1", email: "user@example.com", role: "user" },
    loading: false,
    error: null,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
  useAuth.setState({ me: null, loading: false, error: null });
});

describe("Dashboard", () => {
  it("renders the Welcome card with user email", () => {
    mockStatus({ state: "none" });
    renderDashboard();
    // CardTitle renders as a <div data-slot="card-title"> not a heading.
    expect(screen.getByText(/^welcome$/i)).toBeInTheDocument();
    expect(screen.getByText(/user@example.com/i)).toBeInTheDocument();
  });

  it("renders a Pair WhatsApp CTA linking to /pair when not paired", async () => {
    mockStatus({ state: "none" });
    renderDashboard();
    expect(screen.getByText(/^pair whatsapp$/i)).toBeInTheDocument();
    const cta = screen.getByRole("link", { name: /start pairing/i });
    expect(cta).toHaveAttribute("href", "/pair");
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
  });

  it("renders a Recent activity card with skeleton placeholders", () => {
    mockStatus({ state: "none" });
    renderDashboard();
    expect(screen.getByText(/^recent activity$/i)).toBeInTheDocument();
    // Skeletons get data-slot=skeleton from the primitive.
    const skeletons = document.querySelectorAll('[data-slot="skeleton"]');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it("shows the linked phone instead of the CTA when /pair/status returns paired", async () => {
    mockStatus({
      state: "paired",
      sessionId: "sess-1",
      phoneNumber: "15551234567",
      updatedAt: new Date().toISOString(),
    });
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByTestId("dashboard-paired")).toBeInTheDocument();
    });
    expect(screen.getByText(/whatsapp linked:/i)).toBeInTheDocument();
    expect(screen.getByText(/\+15551234567/)).toBeInTheDocument();
    // CTA should be gone once paired.
    expect(screen.queryByRole("link", { name: /start pairing/i })).not.toBeInTheDocument();
  });
});
