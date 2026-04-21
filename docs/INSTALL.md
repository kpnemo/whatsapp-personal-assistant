# Installation

Goal: from a fresh VPS to a reachable login screen in under 5 minutes.

## Prerequisites

- Docker + Docker Compose v2
- Bash + OpenSSL
- (Recommended) a domain with DNS pointing at your host + HTTPS

## Local install (any Linux or macOS)

```bash
git clone https://github.com/<owner>/whatsapp-personal-assistant.git
cd whatsapp-personal-assistant
bash scripts/first-run.sh       # generates .env, secrets, prints MASTER_KEY once
docker compose up -d
curl -fsS http://localhost:3000/healthz
open http://localhost:3000
```

**Back up `MASTER_KEY` now.** Without it, your encrypted data is unrecoverable.

## Deploy to Railway

See [`deploy/railway/`](../deploy/railway/) and the "Deploy to Railway" button in the README.

## Deploy to Fly.io

See [`deploy/flyio/`](../deploy/flyio/).

## Deploy to Render

See [`deploy/render/`](../deploy/render/).

## Deploy to AWS Lightsail Containers

See [`deploy/aws-lightsail/`](../deploy/aws-lightsail/).

## Vercel (frontend only)

Vercel can host the SPA, but **not the backend** (Baileys requires a long-lived WebSocket). See [`deploy/vercel/`](../deploy/vercel/) for how to split — the SPA on Vercel, the API + worker + agent on any of the targets above.

## After install

1. Open the dashboard; the first registered user becomes admin.
2. Create invitation tokens via `POST /api/invitations` for family members.
3. Phase 1 adds QR pairing. For P0, there is no WhatsApp integration.
