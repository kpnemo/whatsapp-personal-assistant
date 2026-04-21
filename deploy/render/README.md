# Render deploy template

Deploy WPA to [Render](https://render.com) using a single Blueprint (`render.yaml`).

## Deploy button

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/<owner>/whatsapp-personal-assistant)

Replace `<owner>` with your GitHub org/user before sharing the button.

## What the Blueprint provisions

- **`wpa-app`** — web service, built from the repo `Dockerfile`, health-checked at `/healthz`.
- **`wpa-db`** — managed Postgres 16 (Starter plan).
- **`wpa-redis`** — managed Redis (Starter plan, no IP allowlist — service-to-service only).

`DATABASE_URL` and `REDIS_URL` are wired into the web service automatically via Render's `fromDatabase` / `fromService` references.

## Secrets you must set after import

Render marks these with `sync: false`, meaning they will NOT be copied from blueprint changes — you set them once per environment via the dashboard:

- `MASTER_KEY` — 32-byte hex (`openssl rand -hex 32`)
- `JWT_SECRET` — 32-byte hex
- `PUBLIC_APP_ORIGIN` — your Render HTTPS URL (e.g. `https://wpa-app.onrender.com`)

## Notes

- The `wpa-app` web service runs all three processes (api + worker + agent) under supervisord. To split, deploy the image three times with different `ENTRYPOINT_ROLE` values.
- The entrypoint applies Prisma migrations on boot; there is no separate migrate step.
- Render Starter Postgres includes daily backups; upgrade plans for PITR.
- First registered user becomes admin (single-tenant install, see root README).
