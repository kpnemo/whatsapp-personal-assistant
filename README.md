# WhatsApp Personal Assistant

> **⚠️ ToS disclosure up front.** This project uses [Baileys](https://github.com/WhiskeySockets/Baileys), an unofficial library that speaks WhatsApp's multi-device protocol. Using it **violates WhatsApp's Terms of Service**. Your number can be banned. We take no responsibility for your WhatsApp account. This is an **open-source, self-hosted** project for personal and family use, not a commercial product.

A self-hosted personal AI assistant for WhatsApp. Reads your chats, summarizes what matters, drafts replies, and (with your per-conversation consent) replies on your behalf. Your phone, your data, your keys.

Why this exists, who it's for, and what it will never become: [`docs/VISION.md`](docs/VISION.md).

## Two ways to run

### 1. With Claude Code (recommended)

```bash
git clone https://github.com/kpnemo/whatsapp-personal-assistant.git
cd whatsapp-personal-assistant
claude
> /wpa:init
> /wpa:start
```

### 2. Manual

```bash
cp .env.example .env
bash scripts/first-run.sh
docker compose up -d
open http://localhost:3000
```

First account registered becomes admin. Subsequent users join via invitation tokens. Once logged in, visit `/pair` to link your WhatsApp number — see [`docs/PAIRING.md`](docs/PAIRING.md) for the walkthrough and troubleshooting.

After pairing, open `/chats` in the same browser session to see your conversations arrive live. See [docs/CHATS.md](docs/CHATS.md) for details.

## Deploy

One-click options for hosted platforms — full config in [`deploy/`](deploy/).

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template?template=https%3A%2F%2Fgithub.com%2Fkpnemo%2Fwhatsapp-personal-assistant&referralCode=wpa)
[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/kpnemo/whatsapp-personal-assistant)

Also supported: [Fly.io](deploy/flyio/) · [AWS Lightsail Containers](deploy/aws-lightsail/) · [Vercel (frontend only)](deploy/vercel/)

> Vercel hosts the SPA only — the backend needs a persistent runtime (Baileys WebSocket, BullMQ, Agent loop). See [`deploy/vercel/README.md`](deploy/vercel/README.md).

## Links

- [`docs/VISION.md`](docs/VISION.md) — product north star
- [`docs/INSTALL.md`](docs/INSTALL.md) — every deploy target, step-by-step
- [`docs/PAIRING.md`](docs/PAIRING.md) — link your WhatsApp number (QR pairing walkthrough + troubleshooting)
- [`docs/SECURITY.md`](docs/SECURITY.md) — threat model + crypto choices
- [`SECURITY.md`](SECURITY.md) — how to report a vulnerability
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — how to contribute
- [`SUPPORT.md`](SUPPORT.md) — where to ask for help
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — architecture overview (links to HLD)
- [`docs/superpowers/specs/`](docs/superpowers/specs/) — design docs, per phase
- [GitHub Wiki](../../wiki) — deeper guides, rule cookbook, troubleshooting
- [Project website](https://kpnemo.github.io/whatsapp-personal-assistant/) — landing + docs

## License

MIT. See [`LICENSE`](LICENSE).
