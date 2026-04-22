import type { WAMessage } from "@whiskeysockets/baileys";
import { describe, expect, it } from "vitest";

import { shouldIngest } from "./filter.js";

/**
 * Build a minimal WAMessage fixture for filter tests.
 */
function makeMsg(overrides: Partial<WAMessage> = {}): WAMessage {
  const base: WAMessage = {
    key: {
      remoteJid: "1234567890@s.whatsapp.net",
      fromMe: false,
      id: "msg-id-1",
    },
    message: { conversation: "hello" },
    messageTimestamp: 1_700_000_000,
    ...overrides,
  };
  return base;
}

describe("shouldIngest", () => {
  it("accepts a text DM", () => {
    const msg = makeMsg();
    expect(shouldIngest(msg)).toBe(true);
  });

  it("accepts a group message", () => {
    const msg = makeMsg({
      key: {
        remoteJid: "112233445566-1234567890@g.us",
        fromMe: false,
        id: "msg-group-1",
        participant: "9876543210@s.whatsapp.net",
      },
    });
    expect(shouldIngest(msg)).toBe(true);
  });

  it("rejects a status/broadcast message", () => {
    const msg = makeMsg({
      key: {
        remoteJid: "status@broadcast",
        fromMe: false,
        id: "msg-broadcast-1",
      },
    });
    expect(shouldIngest(msg)).toBe(false);
  });

  it("rejects a protocol/system message with messageStubType set", () => {
    // messageStubType 1 = REVOKE, 2 = CIPHERTEXT, etc. — any non-null value.
    // Build via spread on a plain object to bypass exactOptionalPropertyTypes.
    const msg = { ...makeMsg(), messageStubType: 1 } as unknown as WAMessage;
    expect(shouldIngest(msg)).toBe(false);
  });

  it("rejects a message with null message payload", () => {
    const msg = makeMsg({ message: null });
    expect(shouldIngest(msg)).toBe(false);
  });

  it("rejects a message with undefined message payload", () => {
    // Cast to WAMessage to bypass exactOptionalPropertyTypes for test purposes.
    const msg = { ...makeMsg(), message: undefined } as unknown as WAMessage;
    expect(shouldIngest(msg)).toBe(false);
  });

  it("rejects a message with empty message object", () => {
    const msg = makeMsg({ message: {} });
    expect(shouldIngest(msg)).toBe(false);
  });

  it("accepts an outgoing message (fromMe=true)", () => {
    const msg = makeMsg({
      key: {
        remoteJid: "1234567890@s.whatsapp.net",
        fromMe: true,
        id: "msg-out-1",
      },
    });
    expect(shouldIngest(msg)).toBe(true);
  });

  // Regression: before this, system-only payloads were persisted as
  // kind=unknown outgoing messages and polluted /chats with empty bubbles
  // after every pair (initial sync dumps app-state, history, key shares).
  it("rejects a protocolMessage payload (APP_STATE_SYNC_KEY_SHARE etc.)", () => {
    const msg = makeMsg({
      key: { remoteJid: "1@s.whatsapp.net", fromMe: true, id: "p1" },
      message: {
        protocolMessage: {
          type: 6 /* APP_STATE_SYNC_KEY_SHARE */ as never,
        },
      } as unknown as WAMessage["message"],
    });
    expect(shouldIngest(msg)).toBe(false);
  });

  it("rejects a HISTORY_SYNC_NOTIFICATION protocolMessage", () => {
    const msg = makeMsg({
      key: { remoteJid: "1@s.whatsapp.net", fromMe: true, id: "p2" },
      message: {
        protocolMessage: {
          type: 5 /* HISTORY_SYNC_NOTIFICATION */ as never,
          historySyncNotification: { fileLength: "1000" } as never,
        },
      } as unknown as WAMessage["message"],
    });
    expect(shouldIngest(msg)).toBe(false);
  });

  it("rejects a senderKeyDistributionMessage-only payload", () => {
    const msg = makeMsg({
      key: { remoteJid: "grp-1@g.us", fromMe: false, id: "skdm-1" },
      message: {
        senderKeyDistributionMessage: {
          groupId: "grp-1@g.us",
          axolotlSenderKeyDistributionMessage: Buffer.from([1, 2, 3]) as never,
        },
      } as unknown as WAMessage["message"],
    });
    expect(shouldIngest(msg)).toBe(false);
  });

  it("rejects a messageContextInfo-only payload", () => {
    const msg = makeMsg({
      message: {
        messageContextInfo: { deviceListMetadataVersion: 2 } as never,
      } as unknown as WAMessage["message"],
    });
    expect(shouldIngest(msg)).toBe(false);
  });

  it("accepts a payload with both senderKeyDistributionMessage AND conversation (group text)", () => {
    // Real group text messages ride alongside a skdm envelope on the first
    // message after a rekey. We MUST keep these.
    const msg = makeMsg({
      key: { remoteJid: "grp-1@g.us", fromMe: false, id: "mix-1" },
      message: {
        senderKeyDistributionMessage: {
          groupId: "grp-1@g.us",
        } as never,
        conversation: "hello group",
      } as unknown as WAMessage["message"],
    });
    expect(shouldIngest(msg)).toBe(true);
  });

  it("accepts a deviceSentMessage payload (outgoing echo)", () => {
    const msg = makeMsg({
      key: { remoteJid: "peer@s.whatsapp.net", fromMe: true, id: "dsm-1" },
      message: {
        deviceSentMessage: {
          destinationJid: "peer@s.whatsapp.net",
          message: { conversation: "sent from my phone" },
        } as never,
      } as unknown as WAMessage["message"],
    });
    expect(shouldIngest(msg)).toBe(true);
  });
});
