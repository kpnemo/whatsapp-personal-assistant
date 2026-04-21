# Deploy

This project is designed to run on a single host. One-click templates for Railway, Fly.io, Render, and AWS Lightsail arrive in Epic 22.

Per-target step-by-step guides live in the repo: [`docs/INSTALL.md`](https://github.com/<owner>/whatsapp-personal-assistant/blob/main/docs/INSTALL.md).

## Supported targets

- **Local** — Docker Compose on any Linux or macOS host
- **Railway** — managed containers
- **Fly.io** — managed VMs, near-user regions
- **Render** — managed containers
- **AWS Lightsail Containers** — fixed-price managed containers
- **Vercel (frontend only)** — the SPA can live on Vercel, but the backend needs a long-lived WebSocket (Baileys), so API + worker + agent go elsewhere

## Self-hosting tax

You're responsible for uptime, backups, HTTPS, and domain. We minimize that tax with docker-compose, one-click templates, Caddy for auto-HTTPS, and Claude-Code-driven ops — but we don't pretend it's zero.

See [the product vision](https://github.com/<owner>/whatsapp-personal-assistant/blob/main/docs/VISION.md#constraints-we-have-accepted) for why.
