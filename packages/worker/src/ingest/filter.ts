import type { WAMessage } from "@whiskeysockets/baileys";

/**
 * Baileys fields that are NEVER user-visible content — WhatsApp protocol
 * plumbing (history sync, app-state sync, signal key rotation, metadata
 * envelopes). Messages whose payload consists only of these fields must be
 * dropped: they are not chat content, they do not round-trip through
 * normalize correctly, and persisting them pollutes /chats with empty
 * "unknown" bubbles.
 */
const SYSTEM_ONLY_KEYS = new Set<string>([
  "protocolMessage",
  "senderKeyDistributionMessage",
  "messageContextInfo",
]);

/**
 * Determine whether a raw Baileys WAMessage should enter the ingest pipeline.
 *
 * Returns true only when:
 *  - raw.message is present (not null/undefined/empty object)
 *  - raw.key.remoteJid does NOT end with "@broadcast"
 *  - raw.messageStubType is null/undefined (not a protocol/system message)
 *  - raw.message has at least one key that is NOT in SYSTEM_ONLY_KEYS
 *    (i.e. the payload carries actual user content in addition to any
 *    protocol/signal/context envelopes)
 *
 * All other cases are silent drops — no audit, no error.
 */
export function shouldIngest(raw: WAMessage): boolean {
  // Must have a non-empty message payload.
  if (!raw.message) {
    return false;
  }
  const keys = Object.keys(raw.message);
  if (keys.length === 0) {
    return false;
  }

  // Drop WhatsApp broadcast/status messages.
  const jid = raw.key.remoteJid ?? "";
  if (jid.endsWith("@broadcast")) {
    return false;
  }

  // Drop system/protocol stub messages (delivered receipts, call stubs, etc.)
  if (raw.messageStubType != null) {
    return false;
  }

  // Drop payloads that contain ONLY protocol/system envelopes — e.g. a lone
  // `protocolMessage` carrying APP_STATE_SYNC_KEY_SHARE or
  // HISTORY_SYNC_NOTIFICATION, or a `senderKeyDistributionMessage` emitted
  // during Signal key rotation. These are infrastructure, not chat content,
  // and should never appear in /chats.
  const hasContent = keys.some((k) => !SYSTEM_ONLY_KEYS.has(k));
  if (!hasContent) {
    return false;
  }

  return true;
}
