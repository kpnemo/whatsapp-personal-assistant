import { useInfiniteQuery } from "@tanstack/react-query";
import { type JSX } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";

import { chats, type ConversationSummary } from "../api/client.js";

import { DisconnectDialog } from "./DisconnectDialog.js";

interface ConversationListProps {
  selectedId: string | null;
  onSelect: (id: string) => void;
  reconnecting?: boolean;
}

function formatRelative(ts: string | null): string {
  if (!ts) return "";
  try {
    const d = new Date(ts);
    const now = Date.now();
    const diff = now - d.getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return "now";
    if (mins < 60) return `${String(mins)}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${String(hours)}h`;
    const days = Math.floor(hours / 24);
    return `${String(days)}d`;
  } catch {
    return "";
  }
}

function ConversationItem({
  conv,
  isSelected,
  onSelect,
}: {
  conv: ConversationSummary;
  isSelected: boolean;
  onSelect: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full flex-col gap-0.5 rounded-lg px-3 py-2 text-left transition-colors hover:bg-accent ${
        isSelected ? "bg-accent" : ""
      }`}
      data-testid={`conv-item-${conv.id}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium">{conv.title}</span>
        {conv.lastMessageAt ? (
          <span className="shrink-0 text-xs text-muted-foreground">
            {formatRelative(conv.lastMessageAt)}
          </span>
        ) : null}
      </div>
      {conv.subtitle ? (
        <span className="truncate text-xs text-muted-foreground">{conv.subtitle}</span>
      ) : null}
    </button>
  );
}

export function ConversationList({
  selectedId,
  onSelect,
  reconnecting = false,
}: ConversationListProps): JSX.Element {
  const { data, isLoading, hasNextPage, fetchNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ["conversations"],
    queryFn: ({ pageParam }) => chats.list(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const conversations: ConversationSummary[] = data?.pages.flatMap((p) => p.conversations) ?? [];

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-border">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">Chats</span>
          {reconnecting ? (
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              Reconnecting…
            </Badge>
          ) : null}
        </div>
        <DisconnectDialog renderTrigger />
      </div>

      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-0.5 p-2">
          {isLoading ? (
            <>
              <Skeleton className="h-12 w-full rounded-lg" />
              <Skeleton className="h-12 w-full rounded-lg" />
              <Skeleton className="h-12 w-full rounded-lg" />
            </>
          ) : conversations.length === 0 ? null : (
            conversations.map((conv) => (
              <ConversationItem
                key={conv.id}
                conv={conv}
                isSelected={conv.id === selectedId}
                onSelect={() => {
                  onSelect(conv.id);
                }}
              />
            ))
          )}

          {hasNextPage ? (
            <Button
              variant="ghost"
              size="sm"
              className="mt-1 w-full text-xs"
              onClick={() => {
                void fetchNextPage();
              }}
              disabled={isFetchingNextPage}
            >
              {isFetchingNextPage ? "Loading…" : "Load more"}
            </Button>
          ) : null}
        </div>
      </ScrollArea>
    </aside>
  );
}
