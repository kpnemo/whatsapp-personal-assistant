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

export interface InvitationRecord {
  id: string;
  email: string;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
}

export interface InvitationCreatedResponse {
  id: string;
  email: string;
  expiresAt: string;
  createdAt: string;
  token: string;
}

export const invitations = {
  create: (body: { email: string; expiresInDays?: number }) =>
    postJson<InvitationCreatedResponse>("/invitations", body),
  list: () => apiFetch<InvitationRecord[]>("/invitations"),
};

/**
 * PairState mirrors the set published by the worker onto
 * `wpa:wa-session:{uid}:state` and surfaced by GET /api/pair/status.
 *
 * Note: the backend also publishes "idle" (treated as equivalent to "none"
 * on the UI — no active pairing flow), but the /pair screen derives its own
 * local UI state machine from this value + in-flight mutations, so callers
 * should handle "idle" and "none" identically.
 */
export type PairState =
  | "none"
  | "idle"
  | "generating"
  | "awaiting_scan"
  | "paired"
  | "error"
  | "expired";

export interface PairStatusResponse {
  state: PairState;
  sessionId: string | null;
  phoneNumber: string | null;
  updatedAt: string | null;
}

export interface PairInitResponse {
  sessionId: string;
}

/**
 * Parse the `retryAfterSeconds` field out of a 429 `ApiError` body. The API
 * stamps this alongside the `Retry-After` header (see middleware/rate-limit.ts).
 * Falls back to `null` if the body isn't the expected shape.
 */
export function parseRateLimitRetryAfter(err: ApiError): number | null {
  try {
    const body = JSON.parse(err.message.slice(err.message.indexOf("{"))) as {
      retryAfterSeconds?: number;
    };
    if (typeof body.retryAfterSeconds === "number" && body.retryAfterSeconds > 0) {
      return Math.ceil(body.retryAfterSeconds);
    }
  } catch {
    // fall through
  }
  return null;
}

export interface PairQrResponse {
  qrPng: string; // base64-encoded PNG
}

export const pair = {
  init: () => postJson<PairInitResponse>("/pair/init", {}),
  status: () => apiFetch<PairStatusResponse>("/pair/status"),
  // Fetches the current QR as JSON via the authenticated apiFetch pathway
  // (bearer token attached). Browsers cannot send Authorization headers on
  // `<img src="...">` requests, so we must fetch + render as a data URL.
  qr: () => apiFetch<PairQrResponse>("/pair/qr"),
  disconnect: () => apiFetch<void>("/pair/disconnect", { method: "POST" }),
};

// ---------------------------------------------------------------------------
// Conversations + Messages (P1-B IB5 API)
// ---------------------------------------------------------------------------

export interface ConversationSummary {
  id: string;
  jid: string;
  type: string;
  lastMessageAt: string | null;
  title: string;
  subtitle?: string;
}

export interface ConversationListResponse {
  conversations: ConversationSummary[];
  nextCursor: string | null;
}

export interface MessageBody {
  kind: string;
  text?: string;
  quotedMsgId?: string;
  mentions?: string[];
  mediaMeta?: Record<string, unknown>;
}

export interface MessageRecord {
  id: string;
  waMessageId: string;
  fromJid: string;
  senderName?: string;
  direction: "in" | "out";
  timestamp: string;
  body: MessageBody;
  hasMedia: boolean;
}

export interface MessageListResponse {
  messages: MessageRecord[];
  hasMore: boolean;
}

export const chats = {
  list: (cursor?: string) =>
    apiFetch<ConversationListResponse>(
      `/conversations${cursor ? `?limit=50&cursor=${encodeURIComponent(cursor)}` : "?limit=50"}`,
    ),
  messages: (conversationId: string, before?: string) =>
    apiFetch<MessageListResponse>(
      `/conversations/${encodeURIComponent(conversationId)}/messages${before ? `?limit=50&before=${encodeURIComponent(before)}` : "?limit=50"}`,
    ),
};

export const media = {
  /** Returns the URL for fetching raw media bytes. Used as <img src> / <video src> etc. */
  url: (messageId: string): string => {
    const token = getAccessToken();
    const base = `/api/media/${encodeURIComponent(messageId)}`;
    return token ? `${base}?token=${encodeURIComponent(token)}` : base;
  },
};
