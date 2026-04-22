# Chats — WhatsApp mirror in your browser

## What it is

`/chats` is a read-only mirror of your WhatsApp. Every message that arrives on your paired number appears here, decrypted and laid out in a familiar sidebar-plus-thread view. Nothing in `/chats` sends a message, triggers a reply, or changes anything on WhatsApp — it is purely a viewer.

This is P1-B of the roadmap. AI summaries, suggested replies, and rule-based auto-reply come later (P2–P3).

## First time you open /chats

The sidebar will be empty. That is expected.

P1-B does not backfill message history. WhatsApp delivers messages to the Baileys session as they arrive; messages sent before you first paired are not replayed. New messages appear as they come in, typically within two seconds of landing on your phone.

If you just paired and want to verify the stack is working, see the next section.

## Send yourself a test message

The quickest way to confirm everything is wired up:

1. Open WhatsApp on your phone (or another device).
2. Send a message to your own number — "Note to self" threads work perfectly.
3. Switch back to the `/chats` tab in your browser. Within about two seconds the conversation should appear in the left sidebar.
4. Click it. The message bubble should show the text you sent.

If the message does not appear after 10 seconds, check the worker logs:

```
/wpa:logs worker
```

Look for `ingest:consume` log lines. A common cause is the Baileys session going stale; if so, visit `/pair` and re-scan.

## Media

Photos, voice notes, videos, and documents show as `[photo]`, `[voice message]`, `[video]`, or `[document]` until you tap the placeholder. Tapping fetches the media from your local server and renders it inline. Nothing is fetched from WhatsApp's CDN until you explicitly open it.

Media files are stored encrypted on your server under `media-data/`. They are never sent to Anthropic or any third party.

## Disconnect vs the kill switch

**Disconnect** (the button in the sidebar header) is a soft close. It shuts down the Baileys WebSocket and marks your session as disconnected. Your message history stays in the database, encrypted. You can re-pair at any time by visiting `/pair` and scanning a new QR code. Use Disconnect when you want to pause the assistant or switch numbers.

**Kill switch** (the red button in the top navigation bar) is an emergency stop for the AI layer. It mutes the assistant globally — no more auto-replies or draft suggestions from that moment on. It does not close the Baileys socket or affect message ingestion. Your chats keep arriving; the AI just stops acting on them. Use Kill Switch when the assistant does something unexpected and you want to freeze it immediately without losing your session.

## Privacy

- We never send WhatsApp read receipts on your behalf. Opening a message in `/chats` does not mark it as read on your phone.
- Message bodies are encrypted at rest using a per-user data encryption key (DEK) derived from the master key you set during installation. Losing the master key means the stored messages are unrecoverable — keep a backup.
- No message content is sent to Anthropic in P1-B. That changes in P2 when the AI summarisation layer is introduced, and only for conversations where you explicitly enable it.

## Known limits

- **No message composer.** You cannot send messages from `/chats`. That is planned for P1-C.
- **No search.** Full-text search across conversations is on the P2 backlog.
- **No unread badges.** The sidebar does not highlight unread threads. Coming in P2.
- **No group-member list.** Group metadata (participant names, group icon) is not fetched in P1-B.
- **No message backfill.** History before the first pair event is not available.
