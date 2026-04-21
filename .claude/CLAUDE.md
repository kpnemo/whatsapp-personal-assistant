# WhatsApp Personal Assistant — Project Context for Claude Code

This repo is the open-source, self-hosted WhatsApp Personal Assistant. It exists to be read before run.

## North star

[`docs/VISION.md`](../docs/VISION.md) — product principles, anti-goals, roadmap. Re-read at the start of every phase.

## Stack

- Node.js 22 + TypeScript 5.6 (strict) across backend packages.
- pnpm workspaces + turbo.
- `packages/api` (Express), `packages/worker` (Baileys from P1), `packages/agent` (Claude SDK from P2), `packages/shared` (types, crypto, env), `packages/db` (Prisma), `packages/web` (Vite + React 19 + Tailwind 4 + shadcn + json-render).
- Postgres 16, Redis 7 (AOF on), docker-compose default deploy.

## Safety rules (NEVER violate)

1. Never commit `.env` or any secret material.
2. Never log decrypted message bodies. pino redaction covers the usual suspects but you must still think.
3. Never auto-reply in Silent mode, even for testing.
4. Never call `prisma migrate dev --name …` on production DB.
5. Never disable `gitleaks` or the secret-scanning workflow.
6. Never change MASTER_KEY handling without reviewing `packages/shared/src/crypto.ts` tests.
7. Never remove or weaken `argon2id` parameters.
8. Never introduce a fallback that silently proceeds when a critical dependency (Postgres / Redis / master key) is unavailable.

## Commands

Prefix is `wpa` (namespaced to avoid collisions with Claude Code built-ins):

- `/wpa:init` — generate secrets, write `.env`, prompt for Anthropic key (manual paste into settings UI after start).
- `/wpa:start` — `docker compose up -d`, wait healthy, open browser.
- `/wpa:stop` — `docker compose down`.
- `/wpa:status` — container health, worker state, last-seen message.
- `/wpa:logs <service>` — tail logs for api|worker|agent|postgres|redis.
- `/wpa:help` — command index with examples.
- `/wpa:kill` — emergency: detach sockets + mute assistant globally.

## Conventions

- Conventional commits. Signed commits required post-Epic 20.
- Every task closes with a commit.
- Tests beside code (`foo.ts` + `foo.test.ts`).
- ESM everywhere (`type: "module"`); import with `.js` suffix.
- Zod for all external input (env, API bodies, LLM outputs).
- No `console.log` in packages — use the pino `logger` from `@wpa/api` or equivalent.

## Before starting new work

1. Re-read VISION.md.
2. Read the current phase's design spec in `docs/superpowers/specs/`.
3. Read the current phase's implementation plan in `docs/superpowers/plans/`.
4. Prefer editing the checklist in the plan over re-deriving steps.
