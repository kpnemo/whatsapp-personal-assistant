import type { WAMessage } from "@whiskeysockets/baileys";

/**
 * Determine whether a raw Baileys WAMessage should enter the ingest pipeline.
 *
 * Returns true only when:
 *  - raw.message is present (not null/undefined/empty object)
 *  - raw.key.remoteJid does NOT end with "@broadcast"
 *  - raw.messageStubType is null/undefined (not a protocol/system message)
 *
 * All other cases are silent drops — no audit, no error.
 */
export function shouldIngest(raw: WAMessage): boolean {
  // Must have a non-empty message payload.
  if (!raw.message || Object.keys(raw.message).length === 0) {
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

  return true;
}
