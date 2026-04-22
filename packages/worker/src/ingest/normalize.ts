import type { WAMessage } from "@whiskeysockets/baileys";

export type NormalizedBodyKind =
  | "text"
  | "image"
  | "video"
  | "audio"
  | "document"
  | "sticker"
  | "location"
  | "contact"
  | "reaction"
  | "unknown";

export interface NormalizedMessage {
  conversationJid: string;
  conversationType: "dm" | "group";
  waMessageId: string;
  fromJid: string;
  direction: "in" | "out";
  timestamp: Date;
  body: {
    kind: NormalizedBodyKind;
    text?: string;
    quotedMsgId?: string;
    mentions?: string[];
    mediaMeta?: {
      fileName?: string;
      mimeType?: string;
      seconds?: number;
      width?: number;
      height?: number;
    };
  };
}

/**
 * Transform a raw Baileys WAMessage into a `NormalizedMessage`.
 *
 * Precondition: `shouldIngest(raw)` must have returned true — callers are
 * expected to filter before normalizing.
 *
 * Throws if the remoteJid or messageId is missing (should never happen for
 * messages that passed the filter, but we guard defensively).
 */
export function normalize(raw: WAMessage): NormalizedMessage {
  const remoteJid = raw.key.remoteJid;
  if (!remoteJid) {
    throw new Error("normalize: missing remoteJid");
  }
  const waMessageId = raw.key.id;
  if (!waMessageId) {
    throw new Error("normalize: missing key.id");
  }

  const isGroup = remoteJid.endsWith("@g.us");
  const conversationType: "dm" | "group" = isGroup ? "group" : "dm";

  const fromMe = raw.key.fromMe === true;
  const direction: "in" | "out" = fromMe ? "out" : "in";

  let fromJid: string;
  if (isGroup) {
    fromJid = raw.key.participant ?? remoteJid;
  } else {
    fromJid = fromMe ? "self" : remoteJid;
  }

  const rawTs = raw.messageTimestamp;
  const tsNum = typeof rawTs === "number" ? rawTs : Number(rawTs ?? 0);
  const timestamp = new Date(tsNum * 1000);

  const msg = raw.message ?? {};

  const body = extractBody(msg);

  return {
    conversationJid: remoteJid,
    conversationType,
    waMessageId,
    fromJid,
    direction,
    timestamp,
    body,
  };
}

type RawMessage = NonNullable<WAMessage["message"]>;

/** Helpers for exactOptionalPropertyTypes: only spread a field when the value is defined. */
function optStr(v: string | null | undefined): { text: string } | Record<string, never> {
  return typeof v === "string" && v !== "" ? { text: v } : {};
}
function optStrKey<K extends string>(
  k: K,
  v: string | null | undefined,
): Record<K, string> | Record<string, never> {
  return typeof v === "string" && v !== "" ? ({ [k]: v } as Record<K, string>) : {};
}

// Baileys uses Long from protobufjs for int64 fields (like seconds, width, height).
// We need to tolerate that type when reading numeric Baileys fields.
interface Long {
  toNumber: () => number;
  low: number;
  high: number;
}

function toLong(v: unknown): number | undefined {
  if (typeof v === "number") return v;
  if (v != null && typeof (v as Long).toNumber === "function") return (v as Long).toNumber();
  return undefined;
}

function optLongKey<K extends string>(k: K, v: unknown): Record<K, number> | Record<string, never> {
  const n = toLong(v);
  return n !== undefined ? ({ [k]: n } as Record<K, number>) : {};
}

function extractBody(msg: RawMessage): NormalizedMessage["body"] {
  // Plain text
  if (typeof msg.conversation === "string") {
    return { kind: "text", text: msg.conversation };
  }

  // Extended text (links, quotes, mentions)
  if (msg.extendedTextMessage) {
    const ext = msg.extendedTextMessage;
    const ctx = ext.contextInfo;
    const mentions = ctx?.mentionedJid?.length ? ctx.mentionedJid : undefined;
    return {
      kind: "text",
      ...optStr(ext.text),
      ...(ctx?.stanzaId != null && typeof ctx.stanzaId === "string"
        ? { quotedMsgId: ctx.stanzaId }
        : {}),
      ...(mentions !== undefined ? { mentions } : {}),
    };
  }

  // Image
  if (msg.imageMessage) {
    const im = msg.imageMessage;
    return {
      kind: "image",
      ...optStr(im.caption),
      mediaMeta: {
        ...optStrKey("mimeType", im.mimetype),
        ...optLongKey("width", im.width),
        ...optLongKey("height", im.height),
      },
    };
  }

  // Video
  if (msg.videoMessage) {
    const vm = msg.videoMessage;
    return {
      kind: "video",
      ...optStr(vm.caption),
      mediaMeta: {
        ...optStrKey("mimeType", vm.mimetype),
        ...optLongKey("seconds", vm.seconds),
      },
    };
  }

  // Audio / voice note
  if (msg.audioMessage) {
    const am = msg.audioMessage;
    return {
      kind: "audio",
      mediaMeta: {
        ...optStrKey("mimeType", am.mimetype),
        ...optLongKey("seconds", am.seconds),
      },
    };
  }

  // Document
  if (msg.documentMessage) {
    const dm = msg.documentMessage;
    const titleText = dm.title ?? dm.fileName;
    return {
      kind: "document",
      ...optStr(titleText),
      mediaMeta: {
        ...optStrKey("mimeType", dm.mimetype),
        ...optStrKey("fileName", dm.fileName),
      },
    };
  }

  // Sticker
  if (msg.stickerMessage) {
    const sm = msg.stickerMessage;
    return {
      kind: "sticker",
      mediaMeta: {
        ...optStrKey("mimeType", sm.mimetype),
      },
    };
  }

  // Location
  if (msg.locationMessage) {
    const lm = msg.locationMessage;
    return {
      kind: "location",
      ...optStr(lm.name),
    };
  }

  // Contact
  if (msg.contactMessage) {
    const cm = msg.contactMessage;
    return {
      kind: "contact",
      ...optStr(cm.displayName),
    };
  }

  // Reaction
  if (msg.reactionMessage) {
    const rm = msg.reactionMessage;
    return {
      kind: "reaction",
      ...optStr(rm.text),
    };
  }

  return { kind: "unknown" };
}
