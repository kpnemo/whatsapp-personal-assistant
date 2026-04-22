import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getAccessToken, setAccessToken } from "../api/client";

import { useAuth } from "./auth";

/**
 * Covers packages/web/src/stores/auth.ts (Zustand store).
 *
 * Surface exercised:
 *   - initial state
 *   - bootstrap(): happy path (refresh ok + /me), refresh 401, network error
 *   - login(): happy path, 401 => "Invalid email or password", non-401 error
 *   - logout(): network-ok, network-failure (still clears local state)
 *
 * We use vi.stubGlobal("fetch", ...) and hand-build Response objects so we
 * don't have to run a real server. Store is reset between tests so each case
 * starts from the same ground truth.
 */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function noContentResponse(): Response {
  return new Response(null, { status: 204 });
}

const fetchMock = vi.fn<typeof fetch>();

function urlOf(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  setAccessToken(null);
  // Reset store to a deterministic initial state for each test.
  useAuth.setState({ me: null, loading: true, error: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
  useAuth.setState({ me: null, loading: true, error: null });
});

describe("useAuth — initial state", () => {
  it("starts as me=null, loading=true, error=null", () => {
    const s = useAuth.getState();
    expect(s.me).toBeNull();
    expect(s.loading).toBe(true);
    expect(s.error).toBeNull();
  });
});

describe("useAuth.bootstrap", () => {
  it("refresh 200 + /me 200 => sets me, loading=false", async () => {
    fetchMock.mockImplementation((input) => {
      const url = urlOf(input);
      if (url === "/api/auth/refresh") {
        return Promise.resolve(jsonResponse({ accessToken: "tok-bootstrap" }));
      }
      if (url === "/api/auth/me") {
        return Promise.resolve(
          jsonResponse({ id: "u-1", email: "alice@example.com", role: "admin" }),
        );
      }
      return Promise.resolve(jsonResponse({}, 404));
    });

    await useAuth.getState().bootstrap();

    const s = useAuth.getState();
    expect(s.me).toEqual({ id: "u-1", email: "alice@example.com", role: "admin" });
    expect(s.loading).toBe(false);
    expect(s.error).toBeNull();
    expect(getAccessToken()).toBe("tok-bootstrap");
  });

  it("refresh 401 => me stays null, loading=false, no error string (user just isn't logged in)", async () => {
    fetchMock.mockImplementation((input) => {
      const url = urlOf(input);
      if (url === "/api/auth/refresh") return Promise.resolve(jsonResponse({}, 401));
      return Promise.resolve(jsonResponse({}, 500));
    });

    await useAuth.getState().bootstrap();

    const s = useAuth.getState();
    expect(s.me).toBeNull();
    expect(s.loading).toBe(false);
    expect(s.error).toBeNull();
    expect(getAccessToken()).toBeNull();
  });

  it("refresh throws => me stays null, loading=false, error stays null", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    await useAuth.getState().bootstrap();
    const s = useAuth.getState();
    expect(s.me).toBeNull();
    expect(s.loading).toBe(false);
    expect(s.error).toBeNull();
  });
});

describe("useAuth.login", () => {
  it("success => sets me, error cleared, access token persisted", async () => {
    fetchMock.mockImplementation((input) => {
      const url = urlOf(input);
      if (url === "/api/auth/login") {
        return Promise.resolve(
          jsonResponse({ accessToken: "login-tok", userId: "u-9", role: "user" }),
        );
      }
      if (url === "/api/auth/me") {
        return Promise.resolve(jsonResponse({ id: "u-9", email: "bob@example.com", role: "user" }));
      }
      return Promise.resolve(jsonResponse({}, 404));
    });

    await useAuth.getState().login("bob@example.com", "pw");

    const s = useAuth.getState();
    expect(s.me).toEqual({ id: "u-9", email: "bob@example.com", role: "user" });
    expect(s.error).toBeNull();
    expect(getAccessToken()).toBe("login-tok");
  });

  it("401 credentials => error='Invalid email or password', me stays null", async () => {
    fetchMock.mockImplementation((input) => {
      const url = urlOf(input);
      if (url === "/api/auth/login") return Promise.resolve(jsonResponse({ error: "x" }, 401));
      // apiFetch will also attempt silent refresh on 401; let that 401 too.
      if (url === "/api/auth/refresh") return Promise.resolve(jsonResponse({}, 401));
      return Promise.resolve(jsonResponse({}, 500));
    });

    await useAuth.getState().login("bob@example.com", "wrong");

    const s = useAuth.getState();
    expect(s.me).toBeNull();
    expect(s.error).toBe("Invalid email or password");
  });

  it("non-ApiError (e.g. network) => surfaces its message, me stays null", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));

    await useAuth.getState().login("bob@example.com", "pw");

    const s = useAuth.getState();
    expect(s.me).toBeNull();
    // Error string is the underlying error message for non-ApiError rejections.
    expect(s.error).toBe("ECONNREFUSED");
  });

  it("non-401 ApiError => surfaces the ApiError message, me stays null", async () => {
    fetchMock.mockImplementation((input) => {
      const url = urlOf(input);
      if (url === "/api/auth/login") return Promise.resolve(jsonResponse({ error: "x" }, 500));
      return Promise.resolve(jsonResponse({}, 500));
    });

    await useAuth.getState().login("bob@example.com", "pw");

    const s = useAuth.getState();
    expect(s.me).toBeNull();
    expect(s.error).not.toBe("Invalid email or password");
    // ApiError.message starts with "<status>: ..."
    expect(s.error).toMatch(/^500:/);
  });
});

describe("useAuth.logout", () => {
  it("POSTs /auth/logout and clears me + access token on success (204)", async () => {
    setAccessToken("some-tok");
    useAuth.setState({
      me: { id: "u-1", email: "x@y.com", role: "user" },
      loading: false,
      error: null,
    });

    fetchMock.mockImplementation((input, init) => {
      const url = urlOf(input);
      const method = init?.method ?? "GET";
      if (url === "/api/auth/logout" && method === "POST") {
        return Promise.resolve(noContentResponse());
      }
      return Promise.resolve(jsonResponse({}, 404));
    });

    await useAuth.getState().logout();

    expect(useAuth.getState().me).toBeNull();
    expect(getAccessToken()).toBeNull();
    const logoutCalls = fetchMock.mock.calls.filter((c) => urlOf(c[0]) === "/api/auth/logout");
    expect(logoutCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("still clears local state when the logout request fails (network error)", async () => {
    setAccessToken("some-tok");
    useAuth.setState({
      me: { id: "u-1", email: "x@y.com", role: "user" },
      loading: false,
      error: null,
    });

    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));

    await useAuth.getState().logout();

    expect(useAuth.getState().me).toBeNull();
    expect(getAccessToken()).toBeNull();
  });
});
