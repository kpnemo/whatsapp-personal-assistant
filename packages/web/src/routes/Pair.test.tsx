import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type JSX, type ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import type * as SonnerModule from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setAccessToken } from "../api/client";
import { useAuth } from "../stores/auth";

import { Pair } from "./Pair";

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

// Simple sink that exposes the current URL location to the test. Rendered
// inside the same MemoryRouter so navigation triggered by the component is
// observable.
function LocationProbe(): JSX.Element {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname}</div>;
}

interface ProvidersProps {
  children: ReactNode;
  initialEntries?: string[];
}

function Providers({ children, initialEntries = ["/pair"] }: ProvidersProps): JSX.Element {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route path="/pair" element={children} />
          <Route path="/" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function renderPair(): void {
  render(
    <Providers>
      <Pair />
    </Providers>,
  );
}

const fetchMock = vi.fn<typeof fetch>();

function urlOf(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/**
 * Route-based fetch mock. Keeps each test from having to track call order
 * and gives us a single spot to assert against.
 */
interface MockRoutes {
  init?: { status: number; body: unknown; headers?: Record<string, string> };
  status?: { state: string; phoneNumber?: string | null };
  statusSequence?: { state: string; phoneNumber?: string | null }[];
  qr?: { status?: number; qrPng?: string };
}

function installFetchMock(routes: MockRoutes): {
  statusCalls: number;
  initCalls: number;
  qrCalls: number;
} {
  const counters = { statusCalls: 0, initCalls: 0, qrCalls: 0 };
  let statusIndex = 0;

  fetchMock.mockImplementation((input, init) => {
    const url = urlOf(input);
    const method = init?.method ?? "GET";

    if (url === "/api/pair/init" && method === "POST") {
      counters.initCalls += 1;
      const r = routes.init ?? { status: 201, body: { sessionId: "sess-xyz" } };
      return Promise.resolve(
        new Response(JSON.stringify(r.body), {
          status: r.status,
          headers: { "content-type": "application/json", ...(r.headers ?? {}) },
        }),
      );
    }

    if (url === "/api/pair/status" && method === "GET") {
      counters.statusCalls += 1;
      let payload: { state: string; phoneNumber?: string | null };
      if (routes.statusSequence && routes.statusSequence.length > 0) {
        payload = routes.statusSequence[Math.min(statusIndex, routes.statusSequence.length - 1)]!;
        statusIndex += 1;
      } else {
        payload = routes.status ?? { state: "none" };
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            state: payload.state,
            sessionId: "sess-xyz",
            phoneNumber: payload.phoneNumber ?? null,
            updatedAt: new Date().toISOString(),
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    }

    if (url === "/api/pair/qr" && method === "GET") {
      counters.qrCalls += 1;
      // Default to a tiny fake PNG base64 (8-byte PNG signature).
      const defaultPng = "iVBORw0KGgo=";
      const status = routes.qr?.status ?? 200;
      if (status === 404) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: "no_qr_available" }), {
            status: 404,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ qrPng: routes.qr?.qrPng ?? defaultPng }), {
          status,
          headers: { "content-type": "application/json" },
        }),
      );
    }

    return Promise.resolve(new Response("not found", { status: 404 }));
  });

  return counters;
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
  vi.useRealTimers();
});

describe("Pair page", () => {
  it("renders the ToS gate with destructive alert and initialize button", () => {
    installFetchMock({ status: { state: "none" } });
    renderPair();
    expect(screen.getByRole("alert")).toHaveTextContent(/terms-of-service notice/i);
    expect(screen.getByRole("alert")).toHaveTextContent(/violates whatsapp's terms of service/i);
    expect(
      screen.getByRole("button", { name: /i understand, initialize pairing/i }),
    ).toBeInTheDocument();
  });

  it("skips the ToS gate and jumps to Connected when /status reports already-paired on mount", async () => {
    installFetchMock({
      status: { state: "paired", phoneNumber: "972525797093" },
    });
    renderPair();

    // No ToS alert, no "I understand" button.
    await waitFor(() => {
      expect(screen.getByTestId("pair-check")).toBeInTheDocument();
    });
    expect(screen.getByText(/connected/i)).toBeInTheDocument();
    expect(screen.getByTestId("pair-phone")).toHaveTextContent("+972525797093");
    expect(
      screen.queryByRole("button", { name: /i understand, initialize pairing/i }),
    ).not.toBeInTheDocument();
    // Refresh + Disconnect + Go to dashboard visible.
    expect(screen.getByTestId("pair-refresh")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /disconnect/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /go to dashboard/i })).toBeInTheDocument();
  });

  it("clicking Refresh on the paired screen triggers another /status fetch", async () => {
    const counters = installFetchMock({
      status: { state: "paired", phoneNumber: "15551234567" },
    });
    renderPair();
    await waitFor(() => {
      expect(screen.getByTestId("pair-check")).toBeInTheDocument();
    });
    const initialCalls = counters.statusCalls;

    const user = userEvent.setup();
    await user.click(screen.getByTestId("pair-refresh"));

    await waitFor(() => {
      expect(counters.statusCalls).toBeGreaterThan(initialCalls);
    });
  });

  it("clicking 'I understand' posts /api/pair/init and transitions to generating", async () => {
    const counters = installFetchMock({
      init: { status: 201, body: { sessionId: "sess-xyz" } },
      status: { state: "generating" },
    });
    renderPair();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /i understand/i }));

    await waitFor(() => {
      expect(counters.initCalls).toBeGreaterThanOrEqual(1);
    });
    // Skeleton + spinner text should appear once we transition to `generating`.
    await screen.findByTestId("pair-generating");
    expect(screen.getByText(/preparing qr code/i)).toBeInTheDocument();
  });

  it("renders the QR image as a data URL when /status reports awaiting_scan", async () => {
    installFetchMock({
      init: { status: 201, body: { sessionId: "sess-xyz" } },
      status: { state: "awaiting_scan" },
      qr: { qrPng: "iVBORw0KGgo=" },
    });
    renderPair();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /i understand/i }));

    const qr = await screen.findByTestId<HTMLImageElement>("pair-qr");
    expect(qr).toBeInstanceOf(HTMLImageElement);
    // Data URL — bearer-auth-safe way to render a protected image.
    expect(qr.src).toBe("data:image/png;base64,iVBORw0KGgo=");
    expect(screen.getByText(/open whatsapp on your phone/i)).toBeInTheDocument();
    expect(screen.getByText(/link a device/i)).toBeInTheDocument();
  });

  it("shows 'Connected' + phone + Go to dashboard when /status reports paired", async () => {
    installFetchMock({
      init: { status: 201, body: { sessionId: "sess-xyz" } },
      status: { state: "paired", phoneNumber: "15551234567" },
    });
    renderPair();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /i understand/i }));

    await waitFor(() => {
      expect(screen.getByTestId("pair-check")).toBeInTheDocument();
    });
    expect(screen.getByText(/^connected$/i)).toBeInTheDocument();
    expect(screen.getByTestId("pair-phone")).toHaveTextContent("+15551234567");
    expect(screen.getByRole("button", { name: /go to dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /disconnect/i })).toBeInTheDocument();
  });

  it("'Go to dashboard' navigates to /", async () => {
    installFetchMock({
      init: { status: 201, body: { sessionId: "sess-xyz" } },
      status: { state: "paired", phoneNumber: "15551234567" },
    });
    renderPair();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /i understand/i }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /go to dashboard/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /go to dashboard/i }));
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent("/");
    });
  });

  it("shows expired state with Retry that resets to ToS gate", async () => {
    installFetchMock({
      init: { status: 201, body: { sessionId: "sess-xyz" } },
      statusSequence: [{ state: "expired" }, { state: "expired" }],
    });
    renderPair();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /i understand/i }));

    await waitFor(() => {
      expect(screen.getByText(/pairing expired/i)).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /retry/i }));
    expect(
      screen.getByRole("button", { name: /i understand, initialize pairing/i }),
    ).toBeInTheDocument();
  });

  it("shows error state with Retry when /status reports error", async () => {
    installFetchMock({
      init: { status: 201, body: { sessionId: "sess-xyz" } },
      status: { state: "error" },
    });
    renderPair();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /i understand/i }));

    await waitFor(() => {
      expect(screen.getByText(/pairing failed/i)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("renders rate_limited state with countdown when /init returns 429", async () => {
    installFetchMock({
      init: {
        status: 429,
        body: { error: "rate_limited", retryAfterSeconds: 60 },
        headers: { "retry-after": "60" },
      },
    });
    renderPair();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /i understand/i }));

    await waitFor(() => {
      expect(screen.getByText(/too many attempts/i)).toBeInTheDocument();
    });
    // Initial countdown should reflect the Retry-After value (60s => 01:00).
    expect(screen.getByTestId("pair-retry-countdown")).toHaveTextContent("01:00");
    // Retry is disabled while the countdown is non-zero.
    const retry = screen.getByRole("button", { name: /retry/i });
    expect(retry).toBeDisabled();
  });

  it("rate_limit countdown advances as time passes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    installFetchMock({
      init: {
        status: 429,
        body: { error: "rate_limited", retryAfterSeconds: 5 },
        headers: { "retry-after": "5" },
      },
    });
    renderPair();
    const user = userEvent.setup({
      advanceTimers: (ms) => {
        vi.advanceTimersByTime(ms);
      },
    });
    await user.click(screen.getByRole("button", { name: /i understand/i }));

    await waitFor(() => {
      expect(screen.getByTestId("pair-retry-countdown")).toHaveTextContent("00:05");
    });

    act(() => {
      vi.advanceTimersByTime(6_000);
    });

    await waitFor(() => {
      expect(screen.queryByTestId("pair-retry-countdown")).not.toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /retry/i })).toBeEnabled();
  });

  it("refetches the QR PNG via authenticated apiFetch every QR_REFRESH_MS", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // Two different QR payloads so we can verify the `<img src>` updates
    // when the new polling fetch resolves.
    let qrCall = 0;
    fetchMock.mockImplementation((input, init) => {
      const url = urlOf(input);
      const method = init?.method ?? "GET";
      if (url === "/api/pair/init" && method === "POST") {
        return Promise.resolve(
          new Response(JSON.stringify({ sessionId: "sess-xyz" }), {
            status: 201,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      if (url === "/api/pair/status" && method === "GET") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              state: "awaiting_scan",
              sessionId: "sess-xyz",
              phoneNumber: null,
              updatedAt: new Date().toISOString(),
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      }
      if (url === "/api/pair/qr" && method === "GET") {
        qrCall += 1;
        return Promise.resolve(
          new Response(JSON.stringify({ qrPng: `QRv${qrCall}` }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      return Promise.resolve(new Response("nf", { status: 404 }));
    });

    renderPair();
    const user = userEvent.setup({
      advanceTimers: (ms) => {
        vi.advanceTimersByTime(ms);
      },
    });
    await user.click(screen.getByRole("button", { name: /i understand/i }));

    const qr = await screen.findByTestId<HTMLImageElement>("pair-qr");
    const firstSrc = qr.src;
    expect(firstSrc).toBe("data:image/png;base64,QRv1");

    act(() => {
      // QR refetch interval is 5s — one tick is enough to trigger a new fetch.
      vi.advanceTimersByTime(5_500);
    });

    await waitFor(() => {
      const next = screen.getByTestId<HTMLImageElement>("pair-qr").src;
      expect(next).not.toBe(firstSrc);
      expect(next).toBe("data:image/png;base64,QRv2");
    });
  });
});
