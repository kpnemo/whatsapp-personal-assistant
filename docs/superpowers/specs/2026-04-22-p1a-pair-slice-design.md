# P1-A — Pair Slice — Design Spec

## Goal

User opens `/pair` in the dashboard, scans a QR code with WhatsApp on their phone, and sees a "Connected ✓ +\<phone-number\>" confirmation. The Baileys session survives container restarts without re-scan.

**Out of scope** for P1-A: message ingestion, chat viewer, SSE streaming, `/wpa:pair` CLI command. Those land in P1-B.

## North star

Carves the minimum vertical slice out of [P1 — Ingest (silent)](./2026-04-21-whatsapp-personal-assistant-design.md#phasing-what-each-release-opens-up) so the user can validate the core flow without waiting for the full ingest pipeline.

## Exit criteria

- `POST /api/pair/init` returns a session id; worker begins generating a QR.
- `GET /api/pair/status` returns `{state, qrPng?, phoneNumber?}` with state ∈ `{generating, awaiting_scan, paired, error, expired}`.
- Scanning the QR from the WhatsApp mobile app transitions state to `paired`.
- A container restart (`docker compose restart app`) keeps the session paired — no QR re-scan required.
- Rate limit: `3 pair inits / hour / user` enforced server-side with 429 + `Retry-After`.
- Every pair attempt + outcome writes an `AuditLog` row of type `pair` (encrypted details: `phoneNumber`, `result`).
- Pair UI shows the WhatsApp ToS reminder block from `README.md` before kicking off.

## Architecture

```
┌──────────────────────── container: @wpa/api ────────────────────┐
│  POST /api/pair/init     → enqueues `wpa:pair-cmd` stream       │
│  GET  /api/pair/status   → reads `wpa:wa-session:{userId}:*`    │
│  GET  /api/pair/qr       → reads `wpa:pair:{userId}:qr` (TTL)   │
└─────────────────────────────────────┬───────────────────────────┘
                                      │ Redis                    
┌──────────────────────── container: @wpa/worker ─────────────────┐
│  Subscribes wpa:pair-cmd, runs Baileys makeWASocket             │
│  On QR event  → SET wpa:pair:{userId}:qr (TTL 30s)              │
│  On creds/keys update → SET wpa:wa-session:{userId}:* (AOF)     │
│  Every 15s    → snapshot Redis state to Postgres WhatsappSession│
│  On connection open → encrypted phoneNumber into session row,   │
│                       status=paired, audit pair success         │
└─────────────────────────────────────────────────────────────────┘
```

Why Redis-primary: Baileys mutates Signal pre-keys on every message — writing straight to Postgres each time kills throughput. Redis AOF gives ~1 s durability; Postgres is the warm backup.

## Data model

New Prisma model in `packages/db/prisma/schema.prisma`:

```prisma
enum WhatsappSessionStatus {
  pairing
  paired
  disconnected
  expired
}

model WhatsappSession {
  id               String                 @id @default(cuid())
  userId           String                 @unique  // one session per user in P1-A
  user             User                   @relation(fields: [userId], references: [id], onDelete: Cascade)
  status           WhatsappSessionStatus  @default(pairing)
  phoneNumber      Bytes?                 // encrypted with user DEK; nullable until paired
  authState        Bytes?                 // encrypted with user DEK; latest cold snapshot
  lastConnectedAt  DateTime?
  createdAt        DateTime               @default(now())
  updatedAt        DateTime               @updatedAt

  @@map("whatsapp_sessions")
}
```

- `phoneNumber` is encrypted because it's PII; display decrypts per-request.
- `authState` is a JSON-serialized Baileys `AuthenticationState` (creds + keys) encrypted with the user's DEK.
- `@@unique` on `userId` enforces the P1-A "one session per user" simplification. Multi-device / multi-session is a P5+ concern.

## Crypto

- Authentication state bytes encrypted with the user's per-user DEK (already built in P0: `packages/shared/src/crypto.ts`). DEK is wrapped by `MASTER_KEY`; unwrapped in memory only while the worker holds an active session.
- QR bytes are **not** encrypted in Redis (they're ephemeral, 30-second TTL, and aren't secrets once shown to the user's screen anyway — WhatsApp's QR is a short-lived pairing token).
- No plaintext `authState` ever written to Postgres or logs.

## Redis keys

| Key | Type | TTL | Writer | Purpose |
|---|---|---|---|---|
| `wpa:pair-cmd` | stream | — | api | Pair command queue |
| `wpa:pair:{userId}:qr` | string | 30 s | worker | Base64 PNG QR |
| `wpa:wa-session:{userId}:creds` | hash | — (AOF) | worker | Baileys creds hot state (encrypted) |
| `wpa:wa-session:{userId}:keys:{id}` | hash | — (AOF) | worker | Baileys signal keys (encrypted) |
| `wpa:wa-session:{userId}:state` | string | — | worker | Current state enum |
| `wpa:pair-rate:{userId}` | counter | 1 h | api | Pair-init rate-limit window |

## Baileys integration details

- Version pin: `@whiskeysockets/baileys` at a known-good tag (6.7.x series). Pinned exact, not `^`.
- Disable logging: inject a pino child logger so Baileys' verbose output flows into our log stream + can be dropped at `level: "error"` in production.
- Use `makeCacheableSignalKeyStore` over our custom key store to minimize Redis round-trips during Signal session state updates.
- `browser: ["wpa", "Safari", "1.0"]` — identifies our client on the "Linked devices" screen.
- `printQRInTerminal: false`, `generateHighQualityLinkPreview: false`, `syncFullHistory: false` (we don't want initial-pair history sync flooding our pipeline yet).
- Connection events: on `connection: "open"`, read phone number from `state.creds.me.id` (format `1234567890@s.whatsapp.net`), strip suffix, encrypt, write to `WhatsappSession.phoneNumber`.

## API contract

### `POST /api/pair/init`
- Auth: bearer required.
- Rate limit: 3/hour/user. Returns `429` + `Retry-After` header when hit.
- Side effects: upsert `WhatsappSession` with status=`pairing`, push `{type:"pair", userId}` onto `wpa:pair-cmd` stream.
- Response: `201 {sessionId: string}`.

### `GET /api/pair/status`
- Auth: bearer required.
- Reads `wpa:wa-session:{userId}:state` + joins `WhatsappSession` row.
- Response: `200 {state, sessionId, phoneNumber?, updatedAt}` where `state ∈ {none, generating, awaiting_scan, paired, error, expired}` and `phoneNumber` is already-decrypted (only returned when state=`paired`).

### `GET /api/pair/qr`
- Auth: bearer required.
- Reads `wpa:pair:{userId}:qr`. Returns 404 if missing/expired.
- Response: `200 image/png` with the latest QR, or `200 application/json {state}` if not ready.

## Rate limiting

Pair init is **3/hour/user** via Redis `INCR` on `wpa:pair-rate:{userId}` with `EXPIRE 3600` on first increment. Status + QR reads are unlimited (they're idempotent and don't cause WhatsApp-side side effects).

## Audit

Every pair lifecycle event writes an `AuditLog` of type `pair`:
- `pair.init` — user clicked Initialize Pairing.
- `pair.qr_scanned` — Baileys reported `connection.update` with `receivedPendingNotifications`.
- `pair.success` — phone number captured, session persisted.
- `pair.failed` — worker error or timeout (>2 min without scan).
- `pair.restored` — session loaded from cold snapshot on worker boot.

`AuditLog.details` (encrypted) carries `{subtype, phoneNumber?, errorCode?}`.

## Failure modes + recovery

| Symptom | Cause | Recovery |
|---|---|---|
| QR never appears | Worker down; Baileys init threw | Status returns `error` after 30 s; UI shows retry button |
| QR expires before scan | Normal WhatsApp behavior (~30 s) | Worker re-emits; UI polls and re-renders |
| User scans but state stays `awaiting_scan` | Baileys connection handshake stalled | 2-min timeout → state=`expired`, session row status=`expired` |
| Container restart mid-pair | Ephemeral QR lost | On worker boot, restore cold snapshot if `status=paired`; if `status=pairing`, drop and require re-init |
| Worker crashes after `paired` | Baileys auth state not flushed | AOF replay covers last 1 s; background snapshot every 15 s covers broader window |

## Test discipline

Per the TDD memory rule: every Epic ships tests alongside code.

- `packages/db/src/*.test.ts` — schema migration smoke.
- `packages/worker/src/pair/*.test.ts` — pair state machine with a fake Baileys client.
- `packages/api/src/routes/pair.test.ts` — supertest against the three endpoints incl. rate-limit hits.
- `packages/web/src/routes/Pair.test.tsx` — RTL + msw; all five states render; QR polling fetches `/qr`; retry button hits `/init`.
- `scripts/smoke-test.sh` — extended with a pair-init happy-path assertion (no phone scan; just verifies QR payload returns).

Coverage targets: ≥ 80 statements / 75 branches per package, ≥ 90 for `packages/api/src/routes/pair.ts` + `packages/worker/src/pair/state.ts` (critical paths).

## ToS reminder

The `/pair` UI shows this banner above the Initialize button (exactly, so legal review lands once):

> **⚠️ Terms-of-service notice.** Pairing uses [Baileys](https://github.com/WhiskeySockets/Baileys), an unofficial library that speaks WhatsApp's multi-device protocol. Connecting this number **violates WhatsApp's Terms of Service**. Your number can be banned. This is an open-source, self-hosted project for personal use — you bear the risk of pairing your own number.

User must click **"I understand, initialize pairing"** (not just "Initialize") to advance. Click is audited.
