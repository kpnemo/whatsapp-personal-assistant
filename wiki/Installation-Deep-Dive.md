# Installation Deep Dive

The short, up-to-date install guide lives in the repo: [`docs/INSTALL.md`](https://github.com/kpnemo/whatsapp-personal-assistant/blob/main/docs/INSTALL.md). This page is a longer companion for ops-curious readers.

## What you actually need

- A single Linux or macOS host with **Docker + Docker Compose v2**. 1 vCPU / 1 GB RAM is enough for a family install.
- **Bash + OpenSSL** for `scripts/first-run.sh`.
- (Recommended) a domain with DNS pointing at your host, and HTTPS — Caddy handles the cert automatically.

## The MASTER_KEY, in depth

`MASTER_KEY` is the root of the key hierarchy. It wraps per-user DEKs; DEKs encrypt message bodies, summaries, and audit details. **If you lose it, everything encrypted-at-rest is unrecoverable.**

- Generate it once with `scripts/first-run.sh` — never commit it.
- Back it up to your password manager or a hardware key immediately after first boot.
- Rotation is a P2+ topic; for now, treat the key as permanent per install.

## After first boot

1. The first account you register becomes admin. Everyone else joins via invitation tokens (P0 has the admin routes; the UI lands in P1).
2. `GET /healthz` should return 200 from inside and outside the container.
3. Check `docker compose logs -f` for migration output; Prisma runs `migrate deploy` before supervisord brings the three processes up.

## Troubleshooting

Common issues and their fixes will accumulate here through P0–P2. If you hit something not covered, ask in **Discussions → Q&A**.
