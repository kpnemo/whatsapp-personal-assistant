# P1-B — Ingest + Chat Viewer + SSE — Design Spec

## Goal

After pairing, the user opens `/chats` in the dashboard and sees a live mirror of their WhatsApp conversations — DMs and groups — read-only. New messages arrive without refreshing. A working "Disconnect WhatsApp" button ends the Baileys session cleanly. No AI, no auto-reply, no approval flow.

**Out of scope** for P1-B (explicit): unread badges, message composer / sending, media thumbnails in the list, search, pinning, archiving, read receipts, typing indicators, history backfill from WhatsApp, auto-summary, AI anything, approval inbox, `/wpa:pair` CLI. Those belong to P1-C, P2, P3, P4, or never.

## North star

Carves the second vertical slice out of [P1 — Ingest (silent)](./2026-04-21-whatsapp-personal-assistant-design.md#phasing-what-each-release-opens-up) on top of [P1-A](./2026-04-22-p1a-pair-slice-design.md). Also folds in the PA3 session-restore bug that shipped broken in P1-A — the fix lives on the same worker boot path P1-B rewrites.

## Exit criteria

- User pairs → opens `/chats` → list is initially empty (see "first-pair experience" below).
- Someone sends the user a WhatsApp message → within ~2 seconds a row appears in the conversation list, and if the user has that conversation open, the message bubble renders in place.
- Click a conversation → see the last 50 messages; scroll up triggers pagination back through history.
- Click `[photo]` / `[video]` / `[voice message]` → media loads inline from `/api/media/:id`.
- Click "Disconnect" → confirm dialog → Baileys socket closes, `/pair` reports `disconnected`, `/chats` is empty but message history is preserved encrypted at rest. Re-pair restores access.
- `docker compose restart app` on a paired user resumes ingest automatically with **no re-scan** (closes the PA3 bug).
- All message bodies and contact/group names are AES-GCM encrypted at rest in Postgres with the per-user DEK. Media files on disk are DEK-encrypted too.
- CI green: unit + integration tests for every Epic, Playwright E2E spec for the `/chats` happy path, bats smoke for ingest.

## Non-goals that matter

- **No history backfill.** Users will see an empty list on first pair. When someone messages them, that conversation appears. This is intentional MVP behavior; revisit in P1-C.
- **No "send message" path.** Even though Baileys supports it, we deliberately do not wire a composer. Replies come in P1-C or later.
- **No S3** for media. Local Docker volume only. The `MediaStore` interface is abstracted so a future swap is a config flip, not a rewrite.
- **No retention policy implementation yet.** An env var `MESSAGE_RETENTION_DAYS` is reserved for P1-C; MVP stores indefinitely.
- **No read receipts sent to WA.** Baileys will default to not marking messages read. We never want to leak "I saw this at 03:14".

## First-pair user experience

1. User completes P1-A pair flow, sees Connected ✓, navigates to `/chats`.
2. Empty state: _"No conversations yet — send yourself a WhatsApp message to test it out."_
3. User sends themselves a message (from another contact) → worker ingests → SSE pushes → conversation + message appear in UI.
4. No "history loading…" spinner. The user's phone is the source of truth for old messages; we don't try to fetch them.

## Data model (Prisma)

Six new things: two tables for contacts/groups, two enums, one conversation join table, one message table.

```prisma
enum ConversationType { dm group }
enum MessageDirection { in out }

model WaContact {
  id         String   @id @default(cuid())
  userId     String
  jid        String   // e.g. "447700900123@s.whatsapp.net"
  name       Bytes?   // DEK-encrypted display name from WA
  isBusiness Boolean  @default(false)
  avatarUrl  String?  // plaintext https URL from WA if present
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([userId, jid])
}

model WaGroup {
  id          String   @id @default(cuid())
  userId      String
  jid         String   // e.g. "1234567890-5678@g.us"
  subject     Bytes    // DEK-encrypted group name
  description Bytes?   // DEK-encrypted
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([userId, jid])
}

model Conversation {
  id             String   @id @default(cuid())
  userId         String
  jid            String   // points to a contact jid OR a group jid
  type           ConversationType
  lastMessageAt  DateTime?
  createdAt      DateTime @default(now())
  user           User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  messages       Message[]
  @@unique([userId, jid])
  @@index([userId, lastMessageAt])
}

model Message {
  id             String   @id @default(cuid())
  conversationId String
  waMessageId    String   // Baileys key.id — the WA-side stable id
  fromJid        String   // plaintext — used for indexing + sender resolution
  direction      MessageDirection
  timestamp      DateTime // from Baileys messageTimestamp (seconds → ms)
  body           Bytes    // DEK-encrypted JSON: {kind, text?, quotedMsgId?, mentions?, mediaMeta?}
  mediaRef       String?  // relative path under MEDIA_DIR/<userId>/ — null if text-only
  mediaMime      String?  // plaintext, for Content-Type on serve
  createdAt      DateTime @default(now())
  conversation   Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  @@unique([conversationId, waMessageId])
  @@index([conversationId, timestamp])
}
```

### body JSON shape (encrypted blob contents)

```ts
type MessageBody = {
  kind: "text" | "image" | "video" | "audio" | "document" | "sticker" | "location" | "contact" | "reaction" | "unknown";
  text?: string;                             // present for kind=text, or caption for media
  quotedMsgId?: string;                      // waMessageId of the quoted msg (if quote)
  mentions?: string[];                       // jids mentioned in text
  mediaMeta?: { fileName?: string; mimeType?: string; seconds?: number; width?: number; height?: number };
};
```

Unknown kinds (reactions, stickers, edits) are ingested as `kind=unknown` with a short `text` description; we don't lose them but don't render beyond a neutral bubble.

### Encryption posture

- `body`, `WaContact.name`, `WaGroup.subject`, `WaGroup.description` → `encryptWithKey(dek, plaintext)` / `decryptWithKey(dek, ciphertext)` from `@wpa/shared/crypto.ts`. DEK is unwrapped from `User.encryptedDek` via `unwrapDek(masterKey, encryptedDek)` once per worker session and held in memory for the lifetime of that user's Baileys socket.
- Media bytes → same primitive, written to disk as `<encrypted-blob>.bin`. File permissions `0600`, parent dir `0700`.
- `fromJid`, timestamps, conversation jids, `waMessageId` → plaintext. Needed for indexing. WA jids are not secrets.

## Data flow

```
WhatsApp mobile
      │
      ▼
Baileys socket  (packages/worker/src/pair/baileys.ts — already exists)
      │  ev.on("messages.upsert", ...)
      ▼
packages/worker/src/ingest/subscribe.ts
      │  filter (shouldIngest)  →  XADD wpa:msg:ingest:<userId>
      ▼
packages/worker/src/ingest/consume.ts  (XREADGROUP loop)
      │  normalize → encrypt body → upsert Contact/Group/Conversation → insert Message
      ▼  ┌──────────────────────────────┐
         │ if mediaMeta: enqueue media  │──▶ packages/worker/src/ingest/media.ts
         └──────────────────────────────┘      (download → encrypt → write to MEDIA_DIR)
      │
      ▼
Redis Pub/Sub  "ui:events:<userId>"
      │
      ▼
packages/api/src/routes/events.ts  (SSE — subscribes per request)
      │  data: {"type":"message.created", ...}\n\n
      ▼
packages/web/src/hooks/useEventStream.ts
      │  invalidate TanStack Query cache
      ▼
/chats UI re-renders with fresh data
```

### Backpressure / reliability

- `wpa:msg:ingest:<userId>` is a Redis stream with a consumer group per worker instance. Crashed consumer → unacked entries get redelivered on restart.
- After 3 unacked redelivers, entry is XADD'd to `wpa:msg:dlq:<userId>` and audit `ingest.poison_message` is written. Never block the stream on a bad message.
- Media queue is per-process, bounded at 10 concurrent global / 3 per user. Overflow (>100 queued for a user) → audit `ingest.media_skipped_overload` and `mediaRef` stays null; text still ingests.

### Baileys event filter

`shouldIngest(raw)` accepts only:
- `raw.message` present (non-empty).
- `raw.key.remoteJid` does NOT end in `@broadcast` (status / broadcast list).
- `raw.messageStubType` is null (filters protocol / system messages like "so-and-so joined").

Everything else ignored silently (no audit noise).

## API

### Existing routes — unchanged

`/api/auth/*`, `/api/pair/{init,status,qr}`, `/api/kill`, `/api/invitations`, `/api/auth/me`. No shape changes.

### New routes

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/conversations` | List user's conversations (paginated, newest first) |
| GET | `/api/conversations/:id/messages` | Paginated message history for one conversation |
| GET | `/api/messages/:id` | Single message by id (ownership-checked) |
| GET | `/api/media/:messageId` | Serve decrypted media bytes with correct Content-Type |
| GET | `/api/events` | SSE stream of user's events (message.created, media_ready, conversation.updated) |
| POST | `/api/pair/disconnect` | Soft unpair — close socket, keep data encrypted at rest |

All routes go through existing `requireAuth` + `origin-guard` + `rate-limit` middleware stack. SSE gets a per-user concurrent-stream cap (3).

### Response shapes

```ts
// GET /api/conversations?limit=50&cursor=<ISO8601>
type ConversationsResponse = {
  conversations: Array<{
    id: string;
    jid: string;
    type: "dm" | "group";
    lastMessageAt: string | null;   // ISO8601
    title: string;                   // decrypted — contact name or group subject or fallback
    subtitle?: string;               // "6 members" for groups, "not in contacts" for unknown DMs
  }>;
  nextCursor: string | null;
};

// GET /api/conversations/:id/messages?limit=50&before=<ISO8601>
type MessagesResponse = {
  messages: Array<{
    id: string;
    waMessageId: string;
    fromJid: string;
    senderName?: string;            // decrypted contact name — undefined for own outgoing + unknowns
    direction: "in" | "out";
    timestamp: string;               // ISO8601
    body: {                          // decrypted
      kind: string;
      text?: string;
      quotedMsgId?: string;
      mentions?: string[];
      mediaMeta?: { fileName?: string; mimeType?: string; seconds?: number; width?: number; height?: number };
    };
    hasMedia: boolean;               // true if mediaRef is non-null
  }>;
  hasMore: boolean;
};

// SSE events on GET /api/events
type SseEvent =
  | { type: "message.created"; conversationId: string; messageId: string; timestamp: string }
  | { type: "message.media_ready"; messageId: string }
  | { type: "conversation.updated"; conversationId: string };
```

### SSE wire format

```
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache, no-transform
X-Accel-Buffering: no

data: {"type":"message.created","conversationId":"cxxx","messageId":"mxxx","timestamp":"2026-04-22T09:14:03Z"}

:heartbeat

data: {"type":"message.media_ready","messageId":"mxxx"}
```

Heartbeat (`:heartbeat\n\n`) every 30s keeps proxies from dropping the connection. `EventSource` treats comment lines as no-ops.

## Worker boot + PA3 fix

The P1-A PA3 Epic shipped claiming sessions survive restart. They don't. Fix rolled into P1-B Epic 1:

```
worker.start():
  loadPairedSessions()       → reads whatsapp_sessions WHERE status='paired'
  for each session:
    decrypt authState
    hydrate Redis keys (pair/authStore.ts semantics)
    pairMachine.resumePaired(userId, authState)
      → opens Baileys socket with restored creds
      → transitions state = paired (no QR, no expire timer)
    ingest.subscribe(userId, socket)   ← P1-B new
    audit.pair.restored(userId)
  ingest.consumer.start()    → per-user XREADGROUP loops
  snapshot.scheduler.start() → existing 15s cadence — unchanged
  media.downloader.start()   → bounded queue worker
```

Key bug in P1-A as shipped: `restore.ts` writes audit rows but doesn't actually call a "resume" path on `pairMachine`. We add `pairMachine.resumePaired(userId, authState)` as an explicit state transition (idle → paired directly with socket up).

## Web UI

### Routes
- `/chats` — two-pane layout (conversations left, active conversation right). Added to router under `RequireAuth`.
- `/pair` — unchanged except the disabled "Disconnect" button is now wired.

### Components
- `Chats.tsx` — page component, handles selected-conversation state in URL (`/chats?c=<id>`).
- `ConversationList.tsx` — left pane, infinite scroll via TanStack Query.
- `MessageList.tsx` — right pane, messages in chronological order (oldest at top, newest at bottom), infinite scroll up.
- `MessageBubble.tsx` — one message. Renders text, inline media (expand on click), quoted preview, mention highlights.
- `DisconnectDialog.tsx` — shadcn `AlertDialog`: "Disconnect WhatsApp — message history stays safe, stored encrypted. Re-pair anytime to resume." / Confirm / Cancel.

### Hooks
- `useEventStream()` — wraps `EventSource`, exposes `.subscribe(type, handler)`, handles reconnect, cleans up on unmount. Singleton per auth session.
- `useConversations()`, `useMessages(id)` — TanStack Query wrappers. Invalidated by `useEventStream` on matching events.

### Empty/error states
- `/chats` with no conversations → friendly hint + link to `/pair`.
- SSE disconnected for >15s → badge in the UI: "Reconnecting…" (non-blocking).
- API 401 during fetch → existing refresh-token flow handles; if refresh fails, redirect to `/login`.

## Non-functional requirements

- **Performance**: the `/chats` page must render under 200ms for the initial paint (no data yet), and under 800ms for the first full list with 100 conversations. Chasing this means: index on `(userId, lastMessageAt)`; limit=50 default; no N+1 on the join to contacts/groups.
- **Security**:
  - No message body, contact name, or group subject logged — ever. `pino` redaction extended to cover `body`, `text`, `subject`, `name`, `description` paths.
  - Ownership check on every route (404, not 403, on wrong user — don't leak existence).
  - Media serve path re-reads the file on every request; no in-memory cache of decrypted bytes. Acceptable perf given personal scale.
  - SSE per-user connection cap (3 concurrent) prevents runaway consumers.
- **Accessibility**: message list uses `role="log"` + `aria-live="polite"`; conversation list uses `role="listbox"`. Keyboard navigation (↑↓ to scroll conversation list, Enter to open).
- **Internationalization**: not required for MVP (English strings inline). A follow-up can pull them into a locale file.

## Testing

Every Epic must include tests before or alongside implementation (TDD discipline from memory). CI gate: coverage ≥ 75% statements per package, no drop from current `main`.

### Unit
- `normalize.test.ts` — table of fixture Baileys messages → expected normalized rows. Cover every `kind`.
- `shouldIngest.test.ts` — broadcast, stubType, empty-message, happy-path cases.
- `persist.test.ts` — mocked Redis + real Postgres (testcontainers). Covers contact/group upsert, message insert, media queue enqueue.
- `media.test.ts` — bounded-concurrency queue, retry policy, overflow → audit.
- `routes/conversations.test.ts`, `routes/messages.test.ts`, `routes/events.test.ts`, `routes/media.test.ts`, `routes/disconnect.test.ts`.

### Integration
- Full boot path: testcontainers (Postgres + Redis) → seed a paired session → start worker → publish a fake Baileys message via the test harness → assert Message row + SSE event.

### E2E (Playwright)
- `chats.spec.ts`: login → open `/chats` → simulate a message via the test harness (writes to Redis directly, as P1-A does for pair) → assert the conversation appears + message bubble renders + SSE badge shows connected.
- Disconnect flow: open `/chats` → click Disconnect → confirm → assert redirect to `/pair` + session status=disconnected in DB.

### Smoke (bats + scripts/smoke-test.sh)
- After pair: `curl -X POST /api/pair/init` then simulate one message via Redis XADD and assert `GET /api/conversations` returns 1 row.

## Observability

- `AuditType` enum gets one new value in migration: `ingest`. Existing pattern keeps the top-level `type` short and discriminates fine-grained events via `subtype` (string, stored in the encrypted `details` JSON). Audit events emitted:
  - `type=ingest`, `subtype=message_received` — details: `{ messageId, conversationId, kind }`
  - `type=ingest`, `subtype=media_ready` — details: `{ messageId }`
  - `type=ingest`, `subtype=media_failed` — details: `{ messageId, reason }`
  - `type=ingest`, `subtype=poison_message` — details: `{ streamEntryId, reason }`
  - `type=ingest`, `subtype=media_skipped_overload` — details: `{ messageId, queueDepth }`
  - `type=unpair`, `subtype=soft` — details: `{ sessionId }` (from `POST /api/pair/disconnect`)
  - `type=pair`, `subtype=restored` — already exists; wire gets exercised on worker boot after PA3 fix.
- Worker logs structured pino: `{ userId, conversationId, messageId, kind }`. No message content. No contact names.
- New metric (pino-prometheus or just counters logged): `ingest_lag_ms` = now - messageTimestamp at persist time. We want p95 under 3s.

## Env / config surface

New env vars (added to `@wpa/shared/env.ts` Zod schema):

| Var | Default | Purpose |
|---|---|---|
| `MEDIA_DIR` | `/app/media` | Root for encrypted media files |
| `MEDIA_MAX_BYTES` | `33554432` (32 MB) | Cap per-media. Bigger → skip. |
| `INGEST_DLQ_MAX_DELIVERIES` | `3` | Redeliveries before → DLQ |
| `MEDIA_CONCURRENCY_USER` | `3` | Parallel downloads per user |
| `MEDIA_CONCURRENCY_GLOBAL` | `10` | Parallel downloads process-wide |
| `SSE_MAX_STREAMS_PER_USER` | `3` | Concurrent SSE streams per user |
| `MESSAGE_RETENTION_DAYS` | `0` (unlimited) | Reserved — P1-C will wire cleanup |

## Migration

Single Prisma migration, additive only: add `wa_contacts`, `wa_groups`, `conversations`, `messages` tables + the two enums. No changes to existing tables. Standard `prisma migrate dev --name p1b_ingest`; generated SQL committed verbatim.

Docker compose gets one new volume:
```yaml
volumes:
  media-data:
```
mounted at `/app/media` on the `app` service. Existing `.env` gets two new lines appended by `/wpa:init` if missing.

## Rollout plan

All behind a single release (P1-B) — no feature flags, no phased ramp. Users who pair after the release see the chat viewer; users who were paired before the release will re-pair (because the PA3 fix in P1-A Epic 1 will re-validate their auth state on boot; a broken restore is already forcing re-scan today, so this isn't a regression). Explicit release-notes callout.

## Risks + mitigations

- **WhatsApp protocol changes break Baileys** — existing risk from P1-A, not new. Mitigation unchanged: pin Baileys version, watch upstream release notes, fail loud in worker logs on unexpected error shapes.
- **Media storage grows unbounded** — MVP posture is "the user's problem", same as any WhatsApp backup tool. Followup: retention enforcement (P1-C).
- **Group metadata drift** — if a group is renamed on WA, our `WaGroup.subject` goes stale. Re-upsert on each message we see from that group (cheap).
- **PA3 restore regression** — the thing we're fixing. Mitigation: explicit integration test (pair → stop worker → start worker → assert session active without user action), run in CI.

## Open questions — deferred for P1-C

- Unread badges + last-message previews in the list.
- Search across messages.
- Retention (`MESSAGE_RETENTION_DAYS` > 0) with a nightly cleanup job.
- Typing/online/presence — intentionally excluded forever.
- Compose + send — probably the first P1-C Epic.

---

_Next step: `superpowers:writing-plans` turns this spec into an implementation plan with concrete Epics, file lists, and test-first checkboxes._
