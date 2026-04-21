type Json = Record<string, unknown> | unknown[];

let accessToken: string | null = null;

export function setAccessToken(t: string | null): void {
  accessToken = t;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    body: string,
  ) {
    super(`${String(status)}: ${body}`);
  }
}

async function tryRefresh(): Promise<boolean> {
  try {
    const res = await fetch("/api/auth/refresh", {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { accessToken: string };
    accessToken = data.accessToken;
    return true;
  } catch {
    return false;
  }
}

export async function apiFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  if (accessToken) headers.set("authorization", `Bearer ${accessToken}`);

  const res = await fetch(`/api${path}`, { ...init, headers, credentials: "include" });

  if (res.status === 401) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      headers.set("authorization", `Bearer ${accessToken!}`);
      const retry = await fetch(`/api${path}`, { ...init, headers, credentials: "include" });
      if (!retry.ok) throw new ApiError(retry.status, await retry.text());
      if (retry.status === 204) return undefined as T;
      return (await retry.json()) as T;
    }
  }

  if (!res.ok) throw new ApiError(res.status, await res.text());
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function postJson<T>(path: string, body: Json): Promise<T> {
  return apiFetch<T>(path, { method: "POST", body: JSON.stringify(body) });
}
