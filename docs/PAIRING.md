# Pairing your WhatsApp number

> **ToS disclosure (repeated because it matters).** Pairing uses [Baileys](https://github.com/WhiskeySockets/Baileys), which speaks WhatsApp's multi-device protocol. Using it violates WhatsApp's Terms of Service, and your number can be banned. Only pair numbers you are willing to lose.

## Overview

Pairing links your phone to the self-hosted assistant using the same QR-code flow that WhatsApp Web uses. Once paired, the assistant can read messages in the conversations it's allowed to see. P1-A ships the pairing flow only — ingest, summaries, and auto-reply land in later phases. The global default is Silent: nothing is sent on your behalf until you explicitly consent per-conversation.

## Prerequisites

- The stack is running locally (`bash scripts/wpa/start-local.sh` or `docker compose up -d`).
- You have an admin account registered on the dashboard. First user to register becomes admin automatically.
- Your phone has WhatsApp installed and you can open **Settings → Linked Devices** on it.

## Step-by-step walkthrough

1. **Log in.** Open `http://localhost:$API_HOST_PORT` (default `3000`) and sign in.
2. **Click "Start pairing"** from the Dashboard, or navigate directly to `/pair`.
3. **Accept the ToS disclosure.** The gate reminds you what pairing does and what you're agreeing to. You can't skip it on a fresh pair — it's a deliberate speed bump.
4. **Click "Initialize pairing."** The backend publishes a command onto the `wpa:pair-cmd` Redis stream; the worker opens a Baileys socket and starts generating QR codes. State transitions are surfaced in the UI via polling: `idle → generating → awaiting_scan → paired`.
5. **Scan the QR with your phone.** Open WhatsApp → **Settings → Linked Devices → Link a device**, then point your camera at the QR shown in the dashboard. Each QR is valid for about 20 seconds; the worker rotates them automatically while you're scanning.
6. **Wait for "Connected."** Once WhatsApp acknowledges the pair, the worker receives a `515` close, reconnects with the persisted creds, and the dashboard flips to **Connected ✓ +&lt;your phone&gt;**.

## What happens behind the scenes

When you click Initialize, the API writes a `WhatsappSession` row (`status = pairing`) and publishes onto the `wpa:pair-cmd` stream. The worker's pair state machine picks up the command, opens a Baileys socket with fresh creds, and emits QR frames into Redis at `wpa:pair:<userId>:qr` (base64 PNG, 30-second TTL). The SPA polls `/api/pair/qr` and renders the image. After you scan, Baileys forces a `515` (restart) close; the worker reconnects with the new creds, marks the session `paired`, encrypts the full auth state (noise keys, sender-key store, app-state) with your per-user DEK, and persists it as a hot copy in Redis (AOF on) plus a cold snapshot in Postgres so the pair survives container restarts.

## Troubleshooting

### "QR code expired" / QR never turns into Connected

The worker rotates QRs every ~20 seconds. If no scan lands within two minutes, the state machine transitions to `expired` and the UI shows a Retry button. Causes: phone camera occluded, WhatsApp app needs an update, or the worker's Baileys socket dropped. Click **Retry**; it republishes `init`.

### "Pairing failed" or state stuck in `error`

Look at the worker logs for the real Baileys error:

```bash
docker compose logs app | grep pair-machine
```

Common culprits: your number already has the maximum linked devices (remove one in the WhatsApp Linked Devices screen), or WhatsApp temporarily blocked the device registration. Wait 10 minutes and retry.

### Rate limited (`429 Too Many Requests` on `/api/pair/init`)

SEC1 caps `/pair/init` at 3 requests per user per hour. If you hit the ceiling during debugging, clear the bucket manually:

```bash
docker compose exec redis redis-cli DEL "rl:pair:init:<userId>"
```

Replace `<userId>` with your own user UUID — you can read it from `/api/auth/me`.

### Session disappears after container restart

The encrypted auth state is persisted to both Redis AOF and a Postgres snapshot. Check that your session is still `paired` in the DB:

```bash
docker compose exec postgres psql -U wpa -d wpa \
  -c "SELECT id, user_id, status, updated_at FROM whatsapp_sessions;"
```

If `status = paired` but the worker isn't reconnecting on boot, check worker logs for `session-restore` entries. If the row is missing entirely, the cold snapshot failed — re-pair.

## Unpair / re-pair

A first-class disconnect flow lands in **P1-B**. For P1-A, re-pairing is a manual SQL + re-init:

```bash
# 1. Delete the session row (replace <userId> with your user UUID):
docker compose exec postgres psql -U wpa -d wpa \
  -c "DELETE FROM whatsapp_sessions WHERE user_id = '<userId>';"

# 2. Clear any stale Redis state:
docker compose exec redis redis-cli DEL "wpa:wa-session:<userId>:state" \
                                        "wpa:pair:<userId>:qr"

# 3. Re-open /pair in the dashboard and click Initialize.
```

If you want to pair a _different_ phone to the same user, also remove the linked device from WhatsApp's **Linked Devices** screen on the old phone before re-initializing — otherwise you'll hit WhatsApp's per-account device cap.
