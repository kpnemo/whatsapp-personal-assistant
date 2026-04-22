import { useInfiniteQuery } from "@tanstack/react-query";
import { ScrollArea as ScrollAreaPrimitive } from "radix-ui";
import { type JSX, useEffect, useRef } from "react";

import { ScrollBar } from "@/components/ui/scroll-area";
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
  const isAtBottomRef = useRef(true);

  function handleScroll(e: React.UIEvent<HTMLDivElement>): void {
    const el = e.currentTarget;
    // Within ~50px of the bottom counts as "at bottom" (typical tolerance).
    isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
  }

  // Scroll to bottom only when new messages arrive AND the user is already
  // at (or near) the bottom. If they scrolled up to read history, incoming
  // messages arrive silently without yanking their scroll position.
  useEffect(() => {
    if (allMessages.length > prevLengthRef.current && isAtBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    prevLengthRef.current = allMessages.length;
  }, [allMessages.length]);

  return (
    <div className="flex h-full flex-col">
      <ScrollAreaPrimitive.Root data-slot="scroll-area" className="relative flex-1">
        <ScrollAreaPrimitive.Viewport
          data-slot="scroll-area-viewport"
          data-testid="message-list-viewport"
          onScroll={handleScroll}
          className="size-full rounded-[inherit] px-4 py-2"
        >
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
            <div
              className="flex flex-col gap-1 py-2"
              data-testid="message-list"
              role="log"
              aria-live="polite"
            >
              {allMessages.map((msg) => (
                <MessageBubble key={msg.id} message={msg} pageMessages={allMessages} />
              ))}
            </div>
          )}

          <div ref={bottomRef} />
        </ScrollAreaPrimitive.Viewport>
        <ScrollBar />
        <ScrollAreaPrimitive.Corner />
      </ScrollAreaPrimitive.Root>
    </div>
  );
}
