import { useQueryClient } from "@tanstack/react-query";
import { MessageSquare } from "lucide-react";
import { type JSX, useEffect } from "react";
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

  // Wire up SSE → query invalidation.
  useEffect(() => {
    const unsub1 = subscribe("message.created", (data) => {
      const evt = data as SseMessageCreated;
      void queryClient.invalidateQueries({ queryKey: ["conversations"] });
      if (selectedId && evt.conversationId === selectedId) {
        void queryClient.invalidateQueries({ queryKey: ["messages", selectedId] });
      }
    });

    const unsub2 = subscribe("message.media_ready", (data) => {
      const evt = data as SseMediaReady;
      if (evt.conversationId) {
        void queryClient.invalidateQueries({ queryKey: ["messages", evt.conversationId] });
      } else if (selectedId) {
        // If the event doesn't carry conversationId, invalidate the open one.
        void queryClient.invalidateQueries({ queryKey: ["messages", selectedId] });
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
  }, [subscribe, queryClient, selectedId]);

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
