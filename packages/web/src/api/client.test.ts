import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ApiError,
  apiFetch,
  getAccessToken,
  parseRateLimitRetryAfter,
  postJson,
  setAccessToken,
} from "./client";

/**
 * Covers packages/web/src/api/client.ts: apiFetch, postJson, setAccessToken /
 * getAccessToken, silent-refresh-then-retry semantics on 401, and the ApiError
 * body-parsing helper parseRateLimitRetryAfter.
 *
 * We use vi.stubGlobal("fetch", ...) to match the pattern already in
 * Pair.test.tsx — no msw.
 */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "text/plain" } });
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
  // client.ts keeps a module-level accessToken — reset so tests don't leak.
  setAccessToken(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
});

describe("setAccessToken / getAccessToken", () => {
  it("round-trips the token", () => {
    expect(getAccessToken()).toBeNull();
    setAccessToken("tok-1");
    expect(getAccessToken()).toBe("tok-1");
    setAccessToken(null);
    expect(getAccessToken()).toBeNull();
  });
});

describe("apiFetch — happy path", () => {
  it("resolves parsed JSON on 200 and sends credentials + content-type when body present", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ hello: "world" }));

    const result = await apiFetch<{ hello: string }>("/me", {
      method: "POST",
      body: JSON.stringify({ x: 1 }),
    });
    expect(result).toEqual({ hello: "world" });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(urlOf(url)).toBe("/api/me");
    expect(init!.credentials).toBe("include");
    const headers = new Headers(init!.headers);
    expect(headers.get("content-type")).toBe("application/json");
  });

  it("returns undefined for 204 No Content (doesn't attempt to parse body)", async () => {
    fetchMock.mockResolvedValueOnce(noContentResponse());
    const result = await apiFetch("/noop", { method: "DELETE" });
    expect(result).toBeUndefined();
  });

  it("attaches Authorization: Bearer <token> when setAccessToken was called", async () => {
    setAccessToken("tok-abc");
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    await apiFetch("/me");
    const init = fetchMock.mock.calls[0]![1]!;
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("Bearer tok-abc");
  });

  it("does not attach Authorization when no token is set", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    await apiFetch("/public");
    const init = fetchMock.mock.calls[0]![1]!;
    const headers = new Headers(init.headers);
    expect(headers.has("authorization")).toBe(false);
  });

  it("does not override a caller-supplied content-type header", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    await apiFetch("/upload", {
      method: "POST",
      body: "raw",
      headers: { "content-type": "text/plain" },
    });
    const init = fetchMock.mock.calls[0]![1]!;
    const headers = new Headers(init.headers);
    expect(headers.get("content-type")).toBe("text/plain");
  });
});

describe("apiFetch — 401 silent refresh + retry", () => {
  it("refreshes then retries the original request once on 401; returns JSON on success", async () => {
    fetchMock.mockImplementation((input, init) => {
      const url = urlOf(input);
      const method = init?.method ?? "GET";
      if (url === "/api/me" && method === "GET") {
        // First call => 401; after refresh, second call => 200.
        return Promise.resolve(
          fetchMock.mock.calls.filter((c) => urlOf(c[0]) === "/api/me").length === 1
            ? jsonResponse({ error: "unauthorized" }, 401)
            : jsonResponse({ ok: true, who: "me" }),
        );
      }
      if (url === "/api/auth/refresh" && method === "POST") {
        return Promise.resolve(jsonResponse({ accessToken: "fresh-token" }));
      }
      return Promise.resolve(jsonResponse({ unexpected: true }, 500));
    });

    const result = await apiFetch<{ ok: boolean; who: string }>("/me");
    expect(result).toEqual({ ok: true, who: "me" });

    // Three calls: /me (401), /auth/refresh (200), /me (retry, 200)
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // The refresh response updates the module's accessToken
    expect(getAccessToken()).toBe("fresh-token");
    // The retry attached the fresh token
    const retryInit = fetchMock.mock.calls[2]![1]!;
    expect(new Headers(retryInit.headers).get("authorization")).toBe("Bearer fresh-token");
  });

  it("throws ApiError(401) and does not retry again when refresh itself returns 401", async () => {
    fetchMock.mockImplementation((input, init) => {
      const url = urlOf(input);
      const method = init?.method ?? "GET";
      if (url === "/api/me") return Promise.resolve(jsonResponse({ error: "unauth" }, 401));
      if (url === "/api/auth/refresh" && method === "POST") {
        return Promise.resolve(jsonResponse({ error: "no_refresh" }, 401));
      }
      return Promise.resolve(jsonResponse({ unexpected: true }, 500));
    });

    await expect(apiFetch("/me")).rejects.toBeInstanceOf(ApiError);

    // Must have attempted: /me (401) + /auth/refresh (401). No second /me.
    const meCalls = fetchMock.mock.calls.filter((c) => urlOf(c[0]) === "/api/me");
    expect(meCalls).toHaveLength(1);
  });

  it("throws ApiError(401) when refresh throws (network error)", async () => {
    fetchMock.mockImplementation((input) => {
      const url = urlOf(input);
      if (url === "/api/me") return Promise.resolve(jsonResponse({ error: "unauth" }, 401));
      if (url === "/api/auth/refresh") return Promise.reject(new Error("network"));
      return Promise.resolve(jsonResponse({}, 500));
    });

    const err = await apiFetch("/me").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(401);
  });

  it("throws ApiError with the retry response status when the retry fails", async () => {
    let meCount = 0;
    fetchMock.mockImplementation((input) => {
      const url = urlOf(input);
      if (url === "/api/me") {
        meCount += 1;
        return Promise.resolve(
          jsonResponse({ error: meCount === 1 ? "unauth" : "boom" }, meCount === 1 ? 401 : 500),
        );
      }
      if (url === "/api/auth/refresh") return Promise.resolve(jsonResponse({ accessToken: "t" }));
      return Promise.resolve(jsonResponse({}, 404));
    });

    const err = await apiFetch("/me").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(500);
  });

  it("returns undefined on a 204 retry", async () => {
    let meCount = 0;
    fetchMock.mockImplementation((input) => {
      const url = urlOf(input);
      if (url === "/api/me") {
        meCount += 1;
        if (meCount === 1) return Promise.resolve(jsonResponse({ error: "unauth" }, 401));
        return Promise.resolve(noContentResponse());
      }
      if (url === "/api/auth/refresh") return Promise.resolve(jsonResponse({ accessToken: "t" }));
      return Promise.resolve(jsonResponse({}, 404));
    });
    await expect(apiFetch("/me")).resolves.toBeUndefined();
  });
});

describe("apiFetch — non-401 errors", () => {
  it("throws ApiError(500) with body text", async () => {
    fetchMock.mockResolvedValueOnce(textResponse("boom", 500));
    const err = await apiFetch("/oops").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(500);
    expect((err as ApiError).message).toContain("500");
    expect((err as ApiError).message).toContain("boom");
  });

  it("propagates fetch rejections as-is (not wrapped in ApiError)", async () => {
    const networkErr = new Error("ECONNREFUSED");
    fetchMock.mockRejectedValueOnce(networkErr);
    await expect(apiFetch("/oops")).rejects.toBe(networkErr);
  });
});

describe("postJson", () => {
  it("stringifies the body, POSTs, returns parsed JSON", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: "abc" }, 201));
    const result = await postJson<{ id: string }>("/items", { name: "widget", count: 3 });
    expect(result).toEqual({ id: "abc" });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(urlOf(url)).toBe("/api/items");
    expect(init!.method).toBe("POST");
    expect(init!.body).toBe(JSON.stringify({ name: "widget", count: 3 }));
    const headers = new Headers(init!.headers);
    expect(headers.get("content-type")).toBe("application/json");
  });
});

describe("parseRateLimitRetryAfter", () => {
  it("extracts retryAfterSeconds when present and positive", () => {
    const err = new ApiError(429, JSON.stringify({ retryAfterSeconds: 30 }));
    expect(parseRateLimitRetryAfter(err)).toBe(30);
  });

  it("returns null when the body isn't JSON", () => {
    const err = new ApiError(429, "rate limited");
    expect(parseRateLimitRetryAfter(err)).toBeNull();
  });

  it("returns null when retryAfterSeconds is missing / non-positive", () => {
    expect(parseRateLimitRetryAfter(new ApiError(429, JSON.stringify({})))).toBeNull();
    expect(
      parseRateLimitRetryAfter(new ApiError(429, JSON.stringify({ retryAfterSeconds: 0 }))),
    ).toBeNull();
    expect(
      parseRateLimitRetryAfter(new ApiError(429, JSON.stringify({ retryAfterSeconds: -5 }))),
    ).toBeNull();
  });

  it("ceils fractional seconds", () => {
    const err = new ApiError(429, JSON.stringify({ retryAfterSeconds: 4.2 }));
    expect(parseRateLimitRetryAfter(err)).toBe(5);
  });
});
