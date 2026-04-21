# Contributing (long form)

This is the detailed contributor guide. The short version lives at the repo root: [`CONTRIBUTING.md`](../CONTRIBUTING.md).

## Table of contents

- [Development setup](#development-setup)
- [Branch policy](#branch-policy)
- [Commit style](#commit-style)
- [Tests required](#tests-required)
- [How to run locally](#how-to-run-locally)
- [How to add a json-render block type](#how-to-add-a-json-render-block-type)
- [How to add a `/wpa:<command>`](#how-to-add-a-wpacommand)
- [Docs changes](#docs-changes)

## Development setup

- Node.js 22+ (see `.nvmrc`).
- pnpm 9+ (see `package.json#packageManager`).
- Docker + Docker Compose v2 (for the DB + Redis stack locally).

```bash
pnpm install
cp .env.example .env
bash scripts/first-run.sh   # generates MASTER_KEY, JWT_SECRET, DB password
pnpm dev
```

`scripts/first-run.sh` prints the `MASTER_KEY` **once**. Back it up. Losing it = all encrypted data is unrecoverable.

## Branch policy

- `main` is always shippable. PRs require green CI.
- Feature branches: `feat/<short-slug>`. Fix branches: `fix/<short-slug>`. Docs: `docs/<short-slug>`.
- Rebase (or squash-merge) onto `main`. Keep history linear; no merge commits on `main`.
- Never force-push `main`. Force-pushing your own feature branch is fine.

## Commit style

[Conventional Commits](https://www.conventionalcommits.org/). Common types used here:

- `feat:` — user-visible new capability
- `fix:` — bug fix
- `docs:` — docs-only change
- `chore:` — tooling, deps, non-user-visible
- `refactor:` — behavior-preserving code change
- `test:` — add/adjust tests only
- `security:` — security-sensitive change (may be paired with a private advisory)
- `ci:` — CI workflow changes

Scope is optional and usually a package name: `feat(api): …`, `docs(security): …`.

Breaking changes: add `!` (`feat!:`) and a `BREAKING CHANGE:` footer.

## Tests required

- Every `feat` and `fix` needs tests, unless the change is pure docs or configuration. The PR description should say why if a test is impractical.
- Unit tests live next to the code as `*.test.ts`.
- Integration tests run against real Postgres/Redis in CI. Do **not** mock the database.
- Run the full suite locally before requesting review:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## How to run locally

```bash
pnpm dev
# API:    http://localhost:3000
# Web:    http://localhost:3000 (served by API in prod, separate dev server otherwise)
# DB:     docker compose up -d postgres redis
```

Health check: `curl -fsS http://localhost:3000/healthz`.

## How to add a json-render block type

The frontend renders UI from AI-emitted specs. Adding a capability is usually a new **block type**, not a new screen.

1. Add the block schema to `packages/shared` (zod schema + TS type). Every block has a `type` discriminator and a stable `id`.
2. Extend the renderer in `packages/web/src/render/` with a case for the new `type`. Keep render components pure — no data fetching inside them.
3. Add a Vitest test that renders the block with a fixture spec and asserts on the output.
4. Update the agent prompt in `packages/agent` so the model knows it may emit the new type. Include a one-line example in the system prompt.
5. Document the block under `wiki/Block-Types.md` (one section per type: purpose, schema, example).

The principle: **new feature = new block + new prompt, not a new screen.**

## How to add a `/wpa:<command>`

Claude Code slash commands live under `.claude/commands/`.

1. Create `.claude/commands/wpa/<name>.md`. Front-matter declares `description:` and optional `argument-hint:`. Body is the prompt Claude runs.
2. Keep the prompt terse and action-oriented; commands should perform one clear operation.
3. If the command shells out, allow-list the specific tool invocations you need in `.claude/settings.json` (not in user settings).
4. Smoke-test in a fresh clone: `claude` → `/wpa:<name>` → verify it does what the description says with zero surprise.
5. Add an entry to the command index in `CLAUDE.md` (one line per command).

## Docs changes

- Product north star lives in `docs/VISION.md`. Don't restate it elsewhere — link to it.
- Per-deploy-target details live in `deploy/<target>/`. `docs/INSTALL.md` links to them.
- The project website (`website/`) and the GitHub Wiki (`wiki/`) both source-of-truth from this repo. Docs PRs that affect the website also bump the VitePress sidebar in `website/.vitepress/config.ts`.
