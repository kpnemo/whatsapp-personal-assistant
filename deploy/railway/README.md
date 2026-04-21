# Railway deploy template

One-click deploy of the WhatsApp Personal Assistant (WPA) to [Railway](https://railway.app).

## Deploy button

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template?template=https%3A%2F%2Fgithub.com%2F%3Cowner%3E%2Fwhatsapp-personal-assistant&referralCode=wpa)

Replace `<owner>` with your GitHub org/user before using the button in your fork.

## What this template does

- Builds from the repository `Dockerfile` (multi-stage, produces a supervisord-managed three-process image: api + worker + agent).
- Runs `entrypoint-migrate.sh` on start so Prisma migrations are applied before the app boots.
- Exposes HTTP health checks at `/healthz` with a 90 s startup timeout.
- Restarts on failure only (no infinite loops).

## Plugins you must provision

Railway does not provision databases automatically. In your project, add:

1. **Postgres plugin** — Railway will expose `DATABASE_URL`. Copy it into the service env (or reference it via the plugin variable reference).
2. **Redis plugin** — Railway will expose `REDIS_URL`. Same as above.

## Required env vars

Set these via the Railway service _Variables_ tab. Generate secrets locally (`openssl rand -hex 32`) before pasting:

| Variable            | Example / purpose                                              |
| ------------------- | -------------------------------------------------------------- |
| `NODE_ENV`          | `production`                                                   |
| `ENTRYPOINT_ROLE`   | `all` (single-service deploy; runs api + worker + agent)       |
| `MASTER_KEY`        | 32-byte hex — envelope-encryption root key                     |
| `JWT_SECRET`        | 32-byte hex — JWT signing secret                               |
| `DATABASE_URL`      | From Postgres plugin                                           |
| `REDIS_URL`         | From Redis plugin                                              |
| `PUBLIC_APP_ORIGIN` | Your Railway-assigned HTTPS URL (used for CORS + cookie scope) |

## Notes

- Railway sleeps free-tier services; use the **Hobby** plan or higher for the always-on Baileys WebSocket.
- The Dockerfile's supervisord config runs all three processes in one container when `ENTRYPOINT_ROLE=all`; for multi-service splits, deploy the same image three times with `ENTRYPOINT_ROLE=api|worker|agent`.
- First user to register becomes admin — see root `README.md`.
