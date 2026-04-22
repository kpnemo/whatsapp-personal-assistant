import { useInfiniteQuery } from "@tanstack/react-query";
import { type JSX, useEffect, useRef } from "react";

import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";

import { chats, type MessageRecord } from "../api/client.js";

import { MessageBubble } from "./MessageBubble.js";

interface MessageListProps {
  conversationId: string;
}

export function MessageList({ conversationId }: MessageListProps): JSX.Element {
  const { data, isLoading, hasNextPage, fetchNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ["messages", conversationId],
    queryFn: ({ pageParam }) => chats.messages(conversationId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => {
      if (!lastPage.hasMore) return undefined;
      const oldest = lastPage.messages[lastPage.messages.length - 1];
      return oldest ? oldest.timestamp : undefined;
    },
  });

  // All messages in chronological order (pages are newest-first, reversed).
  const allMessages: MessageRecord[] = (data?.pages ?? [])
    .flatMap((p) => p.messages)
    .slice()
    .reverse();

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const prevLengthRef = useRef(0);

  // Scroll to bottom only when new messages arrive (not when loading older ones).
  useEffect(() => {
    if (allMessages.length > prevLengthRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    prevLengthRef.current = allMessages.length;
  }, [allMessages.length]);

  return (
    <div className="flex h-full flex-col">
      <ScrollArea className="flex-1 px-4 py-2">
        {/* Load-older button at the top */}
        {hasNextPage ? (
          <div className="flex justify-center py-2">
            <button
              type="button"
              onClick={() => {
                void fetchNextPage();
              }}
              disabled={isFetchingNextPage}
              className="rounded px-3 py-1 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50"
              data-testid="load-older"
            >
              {isFetchingNextPage ? "Loading…" : "Load older messages"}
            </button>
          </div>
        ) : null}

        {isLoading ? (
          <div className="flex flex-col gap-2 py-4">
            <Skeleton className="ml-auto h-10 w-3/4 rounded-2xl" />
            <Skeleton className="h-10 w-2/3 rounded-2xl" />
            <Skeleton className="ml-auto h-8 w-1/2 rounded-2xl" />
          </div>
        ) : (
          <div className="flex flex-col gap-1 py-2" data-testid="message-list">
            {allMessages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} pageMessages={allMessages} />
            ))}
          </div>
        )}

        <div ref={bottomRef} />
      </ScrollArea>
    </div>
  );
}
