# Fly.io deploy template

Deploy WPA to [Fly.io](https://fly.io) using this `fly.toml`.

## Quick start

```bash
# Install CLI — https://fly.io/docs/hands-on/install-flyctl/
brew install flyctl   # macOS
flyctl auth login

# From the repo root:
cd deploy/flyio
fly launch --copy-config --no-deploy
```

`--copy-config` uses this `fly.toml` as-is. `--no-deploy` pauses before first deploy so you can set secrets.

## Provisioning managed services

### Postgres

```bash
fly postgres create --name wpa-db --region iad
fly postgres attach --app whatsapp-personal-assistant wpa-db
```

This sets `DATABASE_URL` as a secret on the app automatically.

### Redis (Upstash)

Fly proxies Upstash under `fly redis`. Create one:

```bash
fly redis create --name wpa-redis --region iad --plan free
```

The command prints a `REDIS_URL` — add it to secrets (see below).

## Setting secrets

```bash
fly secrets set \
  MASTER_KEY="$(openssl rand -hex 32)" \
  JWT_SECRET="$(openssl rand -hex 32)" \
  REDIS_URL="redis://default:<token>@<host>:6379" \
  PUBLIC_APP_ORIGIN="https://whatsapp-personal-assistant.fly.dev"
```

Secrets are injected into the container at runtime and never appear in `fly.toml`.

## Deploy

```bash
fly deploy
```

The supervisord entrypoint runs Prisma migrations then starts api + worker + agent in a single VM.

## Notes

- Fly VMs sleep when idle. For continuous Baileys connectivity, scale with `fly scale count 1 --min-machines-running 1`.
- The `fly.toml` uses `ENTRYPOINT_ROLE=all` (single-VM deploy). For horizontal scaling split into three apps (`*-api`, `*-worker`, `*-agent`) each with a different role.
- Region `iad` is a default; change `primary_region` to anything from `fly platform regions`.
