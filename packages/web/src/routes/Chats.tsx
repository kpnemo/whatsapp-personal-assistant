import { useQueryClient } from "@tanstack/react-query";
import { MessageSquare } from "lucide-react";
import { type JSX, useEffect, useRef } from "react";
import { Link, useSearchParams } from "react-router";

import { ConversationList } from "../components/ConversationList.js";
import { MessageList } from "../components/MessageList.js";
import { useEventStream } from "../hooks/useEventStream.js";

interface SseMessageCreated {
  type: "message.created";
  conversationId: string;
  messageId: string;
  timestamp: string;
}

interface SseMediaReady {
  type: "message.media_ready";
  messageId: string;
  conversationId?: string;
}

export function Chats(): JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get("c");
  const queryClient = useQueryClient();

  const { status, subscribe } = useEventStream();

  // Keep a ref so the SSE effect can always read the current selectedId
  // without being listed as a dependency (avoids reconnect on conversation switch).
  const selectedIdRef = useRef(selectedId);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  // Wire up SSE → query invalidation.
  // This effect runs once on mount (subscribe and queryClient are stable).
  // selectedId is read via ref so switching conversations does NOT tear down
  // and recreate subscriptions, preventing dropped events during the gap.
  useEffect(() => {
    const unsub1 = subscribe("message.created", (data) => {
      const evt = data as SseMessageCreated;
      void queryClient.invalidateQueries({ queryKey: ["conversations"] });
      const sid = selectedIdRef.current;
      if (sid && evt.conversationId === sid) {
        void queryClient.invalidateQueries({ queryKey: ["messages", sid] });
      }
    });

    const unsub2 = subscribe("message.media_ready", (data) => {
      const evt = data as SseMediaReady;
      if (evt.conversationId) {
        void queryClient.invalidateQueries({ queryKey: ["messages", evt.conversationId] });
      } else {
        const sid = selectedIdRef.current;
        if (sid) {
          // If the event doesn't carry conversationId, invalidate the open one.
          void queryClient.invalidateQueries({ queryKey: ["messages", sid] });
        }
      }
    });

    const unsub3 = subscribe("conversation.updated", () => {
      void queryClient.invalidateQueries({ queryKey: ["conversations"] });
    });

    return () => {
      unsub1();
      unsub2();
      unsub3();
    };
  }, [subscribe, queryClient]);

  function handleSelect(id: string): void {
    setSearchParams({ c: id });
  }

  const reconnecting = status === "disconnected";

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden">
      <ConversationList
        selectedId={selectedId}
        onSelect={handleSelect}
        reconnecting={reconnecting}
      />

      <main className="flex flex-1 flex-col overflow-hidden">
        {selectedId ? <MessageList conversationId={selectedId} /> : <EmptyState />}
      </main>
    </div>
  );
}

function EmptyState(): JSX.Element {
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center gap-4 text-center text-muted-foreground"
      data-testid="chats-empty-state"
    >
      <MessageSquare className="size-12 opacity-30" aria-hidden="true" />
      <div className="flex flex-col gap-1">
        <p className="text-sm">
          No conversations yet — send yourself a WhatsApp message to test it out.
        </p>
        <Link to="/pair" className="text-xs underline underline-offset-2 hover:text-foreground">
          Go to pairing
        </Link>
      </div>
    </div>
  );
}
