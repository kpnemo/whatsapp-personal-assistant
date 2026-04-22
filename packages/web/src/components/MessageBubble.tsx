import { type JSX, useState } from "react";

import { media, type MessageRecord } from "../api/client.js";

interface MessageBubbleProps {
  message: MessageRecord;
  /** Messages from the current page — used to look up quotedMsgId */
  pageMessages?: MessageRecord[];
}

function formatTime(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function QuotedPreview({
  quotedMsgId,
  pageMessages,
}: {
  quotedMsgId: string;
  pageMessages: MessageRecord[];
}): JSX.Element | null {
  const quoted = pageMessages.find((m) => m.id === quotedMsgId || m.waMessageId === quotedMsgId);
  if (!quoted) return null;

  const preview = quoted.body.kind === "text" ? (quoted.body.text ?? "") : `[${quoted.body.kind}]`;

  return (
    <div className="mb-1 rounded border-l-2 border-muted-foreground/40 bg-muted/50 px-2 py-1 text-xs text-muted-foreground">
      <span className="font-medium">{quoted.senderName ?? quoted.fromJid}</span>
      <p className="truncate">{preview}</p>
    </div>
  );
}

function MediaBubble({ messageId, kind }: { messageId: string; kind: string }): JSX.Element {
  const [expanded, setExpanded] = useState(false);

  const label =
    kind === "image"
      ? "[photo]"
      : kind === "video"
        ? "[video]"
        : kind === "audio"
          ? "[voice message]"
          : kind === "document"
            ? "[document]"
            : `[${kind}]`;

  if (!expanded) {
    return (
      <button
        type="button"
        className="flex flex-col items-start gap-0.5 text-left"
        onClick={() => {
          setExpanded(true);
        }}
        data-testid={`media-placeholder-${kind}`}
      >
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">(tap to view)</span>
      </button>
    );
  }

  const src = media.url(messageId);

  if (kind === "image") {
    return <img src={src} alt="media" className="max-h-64 max-w-xs rounded" />;
  }
  if (kind === "video") {
    return <video src={src} controls className="max-h-64 max-w-xs rounded" />;
  }
  if (kind === "audio") {
    return <audio src={src} controls className="w-48" />;
  }
  // document
  return (
    <a href={src} download className="text-sm underline underline-offset-2">
      Download {label}
    </a>
  );
}

export function MessageBubble({ message, pageMessages = [] }: MessageBubbleProps): JSX.Element {
  const isOut = message.direction === "out";
  const { body, id, timestamp, senderName, fromJid } = message;

  const bubbleBase = "relative max-w-[75%] rounded-2xl px-3 py-2 text-sm shadow-sm";
  const bubbleVariant = isOut
    ? "bg-primary/10 text-foreground self-end"
    : "bg-muted text-foreground self-start";

  return (
    <div className={`flex ${isOut ? "justify-end" : "justify-start"}`}>
      <div className={`${bubbleBase} ${bubbleVariant} flex flex-col gap-1`}>
        {!isOut && (
          <span className="text-xs font-semibold text-muted-foreground">
            {senderName ?? fromJid}
          </span>
        )}

        {body.quotedMsgId ? (
          <QuotedPreview quotedMsgId={body.quotedMsgId} pageMessages={pageMessages} />
        ) : null}

        {body.kind === "text" ? (
          <p className="whitespace-pre-wrap">{body.text}</p>
        ) : body.kind === "location" ? (
          <p className="text-muted-foreground">[location]{body.text ? ` — ${body.text}` : ""}</p>
        ) : body.kind === "contact" ? (
          <p className="text-muted-foreground">[contact: {body.text ?? ""}]</p>
        ) : body.kind === "reaction" ? (
          <p>{body.text ?? "—"}</p>
        ) : body.kind === "unknown" ? (
          <p className="text-muted-foreground">—</p>
        ) : (
          <MediaBubble messageId={id} kind={body.kind} />
        )}

        <time
          className="ml-auto text-[10px] text-muted-foreground"
          dateTime={timestamp}
          aria-label={formatTime(timestamp)}
        >
          {formatTime(timestamp)}
        </time>
      </div>
    </div>
  );
}
