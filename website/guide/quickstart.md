# Quickstart

Get from zero to a reachable login screen in under 5 minutes.

The authoritative step-by-step guide lives in the repo: [`docs/INSTALL.md`](https://github.com/<owner>/whatsapp-personal-assistant/blob/main/docs/INSTALL.md).

## TL;DR with Claude Code

```bash
git clone https://github.com/<owner>/whatsapp-personal-assistant.git
cd whatsapp-personal-assistant
claude
> /wpa:init
> /wpa:start
```

## TL;DR manual

```bash
cp .env.example .env
bash scripts/first-run.sh
docker compose up -d
open http://localhost:3000
```

**Back up `MASTER_KEY`** — without it, your encrypted data is unrecoverable.

The first user registered becomes admin. See [Deploy](./deploy) for cloud targets.
