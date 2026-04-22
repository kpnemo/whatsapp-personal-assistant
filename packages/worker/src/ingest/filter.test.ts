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
});
