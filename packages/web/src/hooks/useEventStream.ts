import { useCallback, useEffect, useRef, useState } from "react";

import { getAccessToken } from "../api/client.js";

export type EventStreamStatus = "connecting" | "connected" | "disconnected";

type EventHandler = (data: unknown) => void;

interface EventStreamOptions {
  /** Base URL for the SSE endpoint, defaults to /api/events */
  url?: string;
}

interface EventStreamReturn {
  status: EventStreamStatus;
  subscribe: (type: string, handler: EventHandler) => () => void;
  disconnect: () => void;
}

const MIN_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 30_000;

function buildUrl(base: string): string {
  const token = getAccessToken();
  if (!token) return base;
  const u = new URL(base, window.location.href);
  u.searchParams.set("token", token);
  return u.toString();
}

export function useEventStream(options: EventStreamOptions = {}): EventStreamReturn {
  const { url = "/api/events" } = options;

  const [status, setStatus] = useState<EventStreamStatus>("connecting");
  const esRef = useRef<EventSource | null>(null);
  const handlersRef = useRef<Map<string, Set<EventHandler>>>(new Map());
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);

  // Keep url in a ref so connect() can always use the latest url without
  // being listed as a dependency (avoids reconnecting on url reference changes).
  const urlRef = useRef(url);
  useEffect(() => {
    urlRef.current = url;
  }, [url]);

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current !== null) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    if (unmountedRef.current) return;

    setStatus("connecting");

    const es = new EventSource(buildUrl(urlRef.current));
    esRef.current = es;

    es.addEventListener("open", () => {
      if (unmountedRef.current) return;
      retryCountRef.current = 0;
      setStatus("connected");
    });

    // Generic message handler — the server sends named events with JSON data.
    const dispatchEvent = (eventType: string, rawData: string) => {
      if (unmountedRef.current) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawData) as unknown;
      } catch {
        parsed = rawData;
      }
      const handlers = handlersRef.current.get(eventType);
      if (handlers) {
        handlers.forEach((h) => {
          h(parsed);
        });
      }
    };

    // Forward named event types that the server emits.
    const KNOWN_TYPES = ["message.created", "message.media_ready", "conversation.updated"];
    for (const type of KNOWN_TYPES) {
      es.addEventListener(type, (e: MessageEvent) => {
        dispatchEvent(type, (e as MessageEvent<string>).data);
      });
    }

    // Fallback: unnamed "message" events.
    es.addEventListener("message", (e: MessageEvent) => {
      try {
        const parsed = JSON.parse((e as MessageEvent<string>).data) as { type?: string };
        if (parsed.type) {
          dispatchEvent(parsed.type, (e as MessageEvent<string>).data);
        }
      } catch {
        // ignore malformed
      }
    });

    es.addEventListener("error", () => {
      if (unmountedRef.current) return;
      es.close();
      esRef.current = null;
      setStatus("disconnected");

      // Exponential backoff: 2s, 4s, 8s, … capped at 30s.
      const delay = Math.min(MIN_BACKOFF_MS * Math.pow(2, retryCountRef.current), MAX_BACKOFF_MS);
      retryCountRef.current += 1;

      retryTimerRef.current = setTimeout(() => {
        if (!unmountedRef.current) connect();
      }, delay);
    });
  }, []); // no url dep — reads via urlRef

  useEffect(() => {
    unmountedRef.current = false;
    connect();

    return () => {
      unmountedRef.current = true;
      clearRetryTimer();
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
    };
  }, [connect, clearRetryTimer]);

  const subscribe = useCallback((type: string, handler: EventHandler): (() => void) => {
    if (!handlersRef.current.has(type)) {
      handlersRef.current.set(type, new Set());
    }
    handlersRef.current.get(type)!.add(handler);

    return () => {
      handlersRef.current.get(type)?.delete(handler);
    };
  }, []);

  const disconnect = useCallback(() => {
    clearRetryTimer();
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    setStatus("disconnected");
  }, [clearRetryTimer]);

  return { status, subscribe, disconnect };
}
