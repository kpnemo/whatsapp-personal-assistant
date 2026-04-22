import type { WAMessage } from "@whiskeysockets/baileys";
import { describe, expect, it } from "vitest";

import { normalize } from "./normalize.js";

function makeBase(overrides: Partial<WAMessage> = {}): WAMessage {
  return {
    key: {
      remoteJid: "1234567890@s.whatsapp.net",
      fromMe: false,
      id: "msg-001",
    },
    message: { conversation: "hello" },
    messageTimestamp: 1_700_000_000,
    ...overrides,
  };
}

describe("normalize", () => {
  it("normalizes a text DM incoming message", () => {
    const result = normalize(makeBase());
    expect(result.conversationJid).toBe("1234567890@s.whatsapp.net");
    expect(result.conversationType).toBe("dm");
    expect(result.waMessageId).toBe("msg-001");
    expect(result.fromJid).toBe("1234567890@s.whatsapp.net");
    expect(result.direction).toBe("in");
    expect(result.timestamp).toEqual(new Date(1_700_000_000 * 1000));
    expect(result.body.kind).toBe("text");
    expect(result.body.text).toBe("hello");
  });

  it("normalizes a text group incoming message with participant set", () => {
    const result = normalize(
      makeBase({
        key: {
          remoteJid: "112233445566-1234567890@g.us",
          fromMe: false,
          id: "msg-group-1",
          participant: "9876543210@s.whatsapp.net",
        },
        message: { conversation: "group message" },
      }),
    );
    expect(result.conversationType).toBe("group");
    expect(result.fromJid).toBe("9876543210@s.whatsapp.net");
    expect(result.direction).toBe("in");
    expect(result.body.kind).toBe("text");
    expect(result.body.text).toBe("group message");
  });

  it("sets direction=out for outgoing (fromMe=true) messages", () => {
    const result = normalize(
      makeBase({
        key: {
          remoteJid: "1234567890@s.whatsapp.net",
          fromMe: true,
          id: "msg-out-1",
        },
      }),
    );
    expect(result.direction).toBe("out");
    expect(result.fromJid).toBe("self");
  });

  it("normalizes an image message with caption and mediaMeta", () => {
    const result = normalize(
      makeBase({
        message: {
          imageMessage: {
            caption: "look at this",
            mimetype: "image/jpeg",
            width: 1080,
            height: 720,
          },
        },
      }),
    );
    expect(result.body.kind).toBe("image");
    expect(result.body.text).toBe("look at this");
    expect(result.body.mediaMeta?.mimeType).toBe("image/jpeg");
    expect(result.body.mediaMeta?.width).toBe(1080);
    expect(result.body.mediaMeta?.height).toBe(720);
  });

  it("normalizes an audio (voice note) message with seconds extracted", () => {
    const result = normalize(
      makeBase({
        message: {
          audioMessage: {
            mimetype: "audio/ogg; codecs=opus",
            seconds: 42,
            ptt: true,
          },
        },
      }),
    );
    expect(result.body.kind).toBe("audio");
    expect(result.body.mediaMeta?.mimeType).toBe("audio/ogg; codecs=opus");
    expect(result.body.mediaMeta?.seconds).toBe(42);
  });

  it("extracts quotedMsgId from extendedTextMessage contextInfo", () => {
    const result = normalize(
      makeBase({
        message: {
          extendedTextMessage: {
            text: "reply text",
            contextInfo: {
              stanzaId: "quoted-msg-id",
              participant: "9876543210@s.whatsapp.net",
            },
          },
        },
      }),
    );
    expect(result.body.kind).toBe("text");
    expect(result.body.text).toBe("reply text");
    expect(result.body.quotedMsgId).toBe("quoted-msg-id");
  });

  it("extracts mentions from extendedTextMessage contextInfo", () => {
    const result = normalize(
      makeBase({
        message: {
          extendedTextMessage: {
            text: "hey @alice and @bob",
            contextInfo: {
              mentionedJid: ["alice@s.whatsapp.net", "bob@s.whatsapp.net"],
            },
          },
        },
      }),
    );
    expect(result.body.mentions).toEqual(["alice@s.whatsapp.net", "bob@s.whatsapp.net"]);
  });

  it("falls back to kind=unknown for unrecognised message types", () => {
    const result = normalize(
      makeBase({
        message: {
          // pollCreationMessage is valid Baileys but not in our switch
          pollCreationMessage: { name: "what's for lunch?", options: [] },
        },
      }),
    );
    expect(result.body.kind).toBe("unknown");
  });

  it("normalizes a document message extracting title and mediaMeta", () => {
    const result = normalize(
      makeBase({
        message: {
          documentMessage: {
            mimetype: "application/pdf",
            title: "Report Q1",
            fileName: "report_q1.pdf",
          },
        },
      }),
    );
    expect(result.body.kind).toBe("document");
    expect(result.body.text).toBe("Report Q1");
    expect(result.body.mediaMeta?.mimeType).toBe("application/pdf");
    expect(result.body.mediaMeta?.fileName).toBe("report_q1.pdf");
  });

  it("normalizes a reaction message", () => {
    const result = normalize(
      makeBase({
        message: {
          reactionMessage: {
            key: { remoteJid: "1234567890@s.whatsapp.net", id: "orig-id" },
            text: "👍",
          },
        },
      }),
    );
    expect(result.body.kind).toBe("reaction");
    expect(result.body.text).toBe("👍");
  });

  it("uses remoteJid as fromJid for group messages without participant", () => {
    const result = normalize(
      makeBase({
        key: {
          remoteJid: "112233445566-1234567890@g.us",
          fromMe: false,
          id: "msg-group-no-part",
          // participant intentionally omitted
        },
      }),
    );
    expect(result.fromJid).toBe("112233445566-1234567890@g.us");
  });
});
