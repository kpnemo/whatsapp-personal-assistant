# Claude Code Commands

This project ships with `/wpa:*` slash commands for [Claude Code](https://claude.com/claude-code). They automate the install, start, diagnose, and kill flows.

Authoritative list lives in the repo: [`CLAUDE.md`](https://github.com/<owner>/whatsapp-personal-assistant/blob/main/CLAUDE.md) (published in Epic 16).

## The commands

> Command details land in Epic 16; this page is a stub. Expected set:

- **`/wpa:init`** — first-time install from a fresh clone. Generates secrets, writes `.env`, prints the `MASTER_KEY` once.
- **`/wpa:start`** — bring the stack up (`docker compose up -d`), wait for healthz, open the dashboard.
- **`/wpa:stop`** — bring it down without destroying data.
- **`/wpa:kill`** — emergency kill switch. Stops the three backend processes via the API kill route; WhatsApp goes silent immediately.
- **`/wpa:diagnose`** — print versions, health checks, recent logs, DB status. Paste-friendly for bug reports.

## Adding your own

See [`docs/CONTRIBUTING.md`](https://github.com/<owner>/whatsapp-personal-assistant/blob/main/docs/CONTRIBUTING.md#how-to-add-a-wpacommand) for the step-by-step.
