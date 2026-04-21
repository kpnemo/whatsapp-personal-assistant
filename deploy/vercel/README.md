# Vercel — frontend only

> **⚠️ Vercel cannot run this project end-to-end.** The backend holds a long-lived Baileys WhatsApp WebSocket, schedules BullMQ jobs, and keeps an in-process Claude Agent SDK session. None of these fit Vercel's serverless / edge runtime, which kills functions after a short timeout and provides no persistent process, no outbound long-lived TCP, and no cron beyond Vercel Cron.

This template builds **only the web SPA** and hosts it on Vercel. You **must** run the backend elsewhere — see:

- [`deploy/railway/`](../railway/)
- [`deploy/flyio/`](../flyio/)
- [`deploy/render/`](../render/)
- [`deploy/aws-lightsail/`](../aws-lightsail/)
- Self-hosted via `docker compose up -d` ([manual path](../../README.md))

## Why not the backend?

See [`docs/VISION.md`](../../docs/VISION.md) and [`docs/superpowers/specs/`](../../docs/superpowers/specs/) for the architectural north star. In short:

- **Baileys** needs a persistent WebSocket; Vercel Functions idle out.
- **BullMQ worker** needs a long-running Node process; Vercel has no process model.
- **Agent loop** holds Claude Agent SDK sessions and pub/sub state in-process.

Trying to bolt any of those onto Vercel ends up as a rewrite, not a deploy.

## Deploy the SPA on Vercel

```bash
npm i -g vercel
cd <repo-root>
vercel --prod
```

Vercel will detect `deploy/vercel/vercel.json` if you point the project root to the repo root and set the config path, or you can place a symlink / alternate `vercel.json` at the repo root for a single-project setup.

## Required env vars

Set these in the Vercel project (_Settings → Environment Variables_):

- `VITE_PUBLIC_API_ORIGIN` — the public HTTPS URL of your backend (e.g. `https://wpa.fly.dev`). The SPA calls this origin for all API requests.

Also configure your backend's CORS to allow `https://<your-project>.vercel.app` (and any custom domains).

## Notes

- Build command: `pnpm --filter @wpa/web build`.
- Output directory: `packages/web/dist`.
- Install command: `pnpm install --frozen-lockfile` — uses the repo's pnpm workspace.
- `framework` is `null` because Vercel's Vite preset conflicts with the monorepo filter.
