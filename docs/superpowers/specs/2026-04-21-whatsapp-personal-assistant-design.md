# WhatsApp Personal Assistant — Product Vision & High-Level Design

**Status:** Draft for review
**Date:** 2026-04-21
**Scope:** Vision, principles, phase roadmap, and high-level architecture for the overall product. Each phase has its own downstream spec + implementation plan; this document intentionally stays at the HLD level.

---

## 1. Product Vision

> The durable, CEO-level product vision lives in [`docs/VISION.md`](../../VISION.md) and is re-read at the start of every phase spec. This section is the one-page summary for HLD readers.

An open-source, self-hosted personal AI assistant for WhatsApp. The assistant reads every conversation the user participates in, understands context, surfaces what matters (@-mentions, action items, extracted events, suggested replies), and — with explicit per-conversation consent — replies on the user's behalf. The user runs it on their own box; their phone, their data, their keys.

**One-line pitch:** "A calm, trustworthy co-pilot for my WhatsApp — it reads everything so I don't have to scroll, and it only speaks when I've told it to."

### Target users (priority order)

1. **The author + family (≤10 people on one install).** The reason the project exists. Each family member logs in, pairs their own number, sees only their own conversations.
2. **Other self-hosters.** Technically comfortable people who want the same thing. `git clone` → `/wpa:init` → `/wpa:start` → pairing QR. Target **≤5 minutes** from fresh VPS to paired.
3. **Contributors.** People who read the code before running it. Code must be legible, typed, tested, secure.

### Core value loop

Pair once → silent ingestion → live dashboard (summaries, mentions, action items, suggested replies) → user configures per-conversation rules → graduates trusted conversations to auto-reply.

### Product principles (non-negotiable)

- **Silent until consented.** Auto-reply is opt-in per-conversation. Global kill switch always one click away. First-run defaults are the safest defaults.
- **Every AI action is visible.** Assistant replies are highlighted in the dashboard with the matched rule, the reasoning, and a one-click "disable this rule" escape.
- **Your data stays on your box.** Message bodies encrypted at rest with an app master key the user supplies. Per-user DEKs derived from it. No phone-home telemetry by default.
- **Bring your own Anthropic API key.** No proxy, no shared key, no lock-in.
- **Generative UI.** Backend emits json-render specs; frontend renders. New capabilities = new block types, not new screens.
- **ToS risk is real and disclosed.** `README.md` leads with the disclosure. Baileys violates WhatsApp ToS; numbers can be banned; project takes no responsibility for the user's number. Built-in rate limiting + humanized reply timing + one-click session eject.
- **Security posture is a feature.** Pinned deps, CodeQL, Dependabot, SECURITY.md, signed container images, redact-by-default logs, CSP on the SPA.

### Product-level success criteria

- A stranger who has never seen the repo can go from `git clone` to paired-and-capturing in under 5 minutes on a fresh VPS.
- All supported deploy targets (docker-compose, Railway, Fly.io, Render, AWS Lightsail Containers) work from a template button or link.
- CI green: lint, typecheck, test, CodeQL. Backend coverage ≥70 %.
- Family of 5 all paired on one install, each sees only their own chats, 0 cross-account data leakage in a manual red-team pass.
- User with 20+ active chats can open the dashboard and know what needs attention in under 30 seconds.

---

## 2. Phased Roadmap

Each phase is its own spec + implementation plan + review checkpoint. Brainstorming for this document ends at HLD approval; implementation planning happens per-phase.

| Phase | Goal | Exit criteria |
|---|---|---|
| **P0 — Foundation & Install** | A repo a stranger can clone, `/wpa:init`, `/wpa:start`, and reach a login screen in <5 min. | docker-compose works; `.claude/` commands (`init`, `start`, `stop`, `status`, `logs`, `help`, `kill`) work; CI green (lint/typecheck/test/codeql); login + register + JWT work; empty dashboard loads; SECURITY.md + INSTALL.md written. **No WhatsApp yet.** |
| **P1 — Ingest (silent)** | User pairs QR, messages flow in, dashboard shows conversation list + message history. No AI. | QR pairing works end-to-end; Baileys session auth state durable across restarts (Redis AOF + Postgres snapshot); messages encrypted in DB; sidebar + chat viewer live via SSE; disconnect/reconnect survives restart **without re-scan**; `/wpa:pair` command works. |
| **P2 — Understand (read-only)** | Per-conversation AI summaries, @-mention detection, action items, suggested replies (drafts only, never sent). | Anthropic SDK wired with per-user API key; rolling summaries with context compaction; json-render catalog live (SummaryCard, ActionItem, SuggestedReply, EventCard, Quote, Timeline, PeopleChipList, Insight); cost cap per user enforced. |
| **P3 — Rules & Auto-reply** | Per-conversation rules; three modes (Silent / Assist / Auto); humanized reply timing; full audit trail; kill switch. | Rule editor UI; mode toggle per conversation; rate-limit + typing-indicator + randomized delay; every auto-reply logged with matched rule + reasoning; `/wpa:kill` detaches sockets instantly. |
| **P4 — Integrations** | Google Calendar + Gmail connectors. Event cards become real bookings. | OAuth flows working; one extracted event → one real calendar event; email drafts compose from summaries. |
| **P5+** | Mobile app (Expo/React Native), optional household views, notification channels (email/push). | Deferred. |

---

## 3. High-Level Architecture

```
                       ┌──────────────────────────────────────────┐
                       │  Host (VPS / home server / Railway / Fly) │
                       │                                           │
   [User's phone] ─────┼──► WhatsApp (multi-device)                │
                       │         │                                 │
                       │         │ WebSocket (Baileys)             │
                       │         ▼                                 │
                       │  ┌──────────────┐                         │
                       │  │   worker     │ Node.js + Baileys       │
                       │  │              │ N sockets (one per user)│
                       │  └──────┬───────┘                         │
                       │         │ Redis stream: messages.raw      │
                       │         ▼                                 │
                       │  ┌──────────────┐                         │
                       │  │    agent     │ Node.js + Claude SDK    │
                       │  │              │ summarize / extract /   │
                       │  │              │ draft replies / rules   │
                       │  └──────┬───────┘                         │
                       │         │ writes enriched events          │
                       │         ▼                                 │
                       │  ┌──────────────┐     ┌─────────────┐     │
                       │  │     api      │◄───►│  postgres   │     │
                       │  │  (Express)   │     │ encrypted   │     │
                       │  │  REST + SSE  │     │ msgs/state  │     │
                       │  └──────┬───────┘     └─────────────┘     │
                       │         │                                 │
                       │         │            ┌─────────────┐      │
                       │         │◄──────────►│    redis    │      │
                       │         │            │ AOF hot     │      │
                       │         │            │ state +     │      │
                       │         │            │ pub/sub     │      │
                       │         │            └─────────────┘      │
                       │         ▼                                 │
                       │  ┌──────────────┐                         │
                       │  │  web (SPA)   │ React + Vite + Tailwind │
                       │  │              │ shadcn + json-render    │
                       │  └──────────────┘                         │
                       │                                           │
                       │  Default: ONE image runs api+worker+agent │
                       │  via supervisord. Postgres + Redis as     │
                       │  sidecars. Split mode available via       │
                       │  ENTRYPOINT_ROLE env var.                 │
                       └──────────────────────────────────────────┘
```

### Component responsibilities

- **`worker`** — owns N long-lived Baileys WebSockets (one per paired user). Writes raw message envelopes to the `messages.raw` Redis stream. Loads encrypted auth state from Redis (with Postgres fallback) on boot. The only component that touches WhatsApp.
- **`agent`** — consumes `messages.raw`, batches into per-conversation context, calls Claude, writes enriched data (summaries, action items, suggested replies, json-render panels) to Postgres. Owns Claude session state and compaction.
- **`api`** — Express. Auth, REST endpoints, SSE for live dashboard events, rule CRUD, settings. Reads/writes Postgres; publishes UI events to Redis.
- **`web`** — React SPA. Built to static assets, served by the `api` container at non-`/api/*` paths.
- **Postgres 16** — users, sessions, contacts, groups, conversations, messages (body encrypted), summaries, action_items, suggested_replies, rules, audit_log, api_keys. Cold backup of Baileys auth state.
- **Redis 7** (AOF on, `appendfsync everysec`, persistent volume) — hot Baileys auth state, agent session state, streams (`messages.raw`, `ui.events`), cache (JWTs, rate-limit counters, Claude cost counters).

### Session durability & auto-reconnect

Baileys mutates auth state (Signal pre-keys) constantly. Hot path is Redis:

- Auth state stored at `wpa:auth:{user_id}`, encrypted with per-user DEK.
- Every significant change snapshotted to Postgres `whatsapp_sessions.auth_state` (encrypted).
- Redis AOF + docker volume = durability across container restarts. Max data loss window: ~1 s (WhatsApp re-syncs unacked messages on reconnect).

**Worker boot sequence:**
1. Load every `whatsapp_sessions` row where `auto_reconnect=true`, `connection_status ∈ {online, connecting}`, `status != banned`.
2. Read auth state from Redis; if absent (cold start after wipe), rehydrate from Postgres snapshot.
3. Open Baileys socket with preserved state — **no QR re-scan**.
4. If credentials rejected (truly expired), set `connection_status='needs_repair'`; dashboard prompts re-pair.

**Health loop:** 30 s ping per socket; stale sockets close and re-init from state; exponential backoff on repeated failures; events written to `audit_log`.

**Graceful shutdown (SIGTERM):** close sockets → flush state → exit 0. Unclean crash: AOF covers it.

### Deployment modes

- **Default (single image):** one image, three in-container processes (api+worker+agent) via supervisord. Simplest for self-host, Railway, Fly, Lightsail.
- **Split:** same image, three services with different `ENTRYPOINT_ROLE`. `docker-compose.split.yml` for power users wanting independent scaling or crash isolation.

---

## 4. Data Model

Encrypted columns marked 🔒 (AES-256-GCM with per-user DEK). Plaintext columns hold only what's needed for indexing/filtering.

```
users
  id PK, email UNIQUE, password_hash (argon2id), role (admin|user),
  encrypted_dek 🔒 (wrapped by MASTER_KEY), anthropic_api_key 🔒,
  cost_cap_usd_monthly, created_at, last_login_at

invitations
  id PK, invited_by FK users.id, email, token_hash, expires_at, used_at

whatsapp_sessions
  id PK, user_id FK, phone_number, display_name,
  auth_state 🔒 (Baileys creds blob, cold snapshot),
  connection_status (connecting|online|offline|needs_repair|banned),
  auto_reconnect bool, last_seen_at, paired_at

contacts
  id PK, user_id FK, jid, display_name, push_name, is_business, avatar_url, created_at
  UNIQUE(user_id, jid)

groups
  id PK, user_id FK, jid, subject, description, avatar_url, participant_count, created_at
  UNIQUE(user_id, jid)

group_participants
  group_id FK, contact_id FK, is_admin, joined_at
  PRIMARY KEY(group_id, contact_id)

conversations
  id PK, user_id FK, jid, type (dm|group),
  last_message_at, unread_count,
  reply_mode (silent|assist|auto),   -- default silent
  created_at
  UNIQUE(user_id, jid)

messages
  id PK, conversation_id FK, wa_message_id (unique within jid),
  from_jid, sender_contact_id FK nullable, timestamp,
  direction (in|out), is_assistant bool,
  body 🔒 (json: {text, quoted, mentions, media_meta}),
  media_ref nullable (local path OR S3 key),
  reply_to_id FK nullable

summaries
  id PK, conversation_id FK, window_start_msg_id, window_end_msg_id,
  body 🔒 (json: {text, bullets, tone, key_people}),
  tokens_used, model, created_at

action_items
  id PK, user_id FK, conversation_id FK, source_message_id FK,
  body 🔒 (json: {text, due_at, confidence, category}),
  status (pending|done|dismissed|snoozed), created_at, resolved_at

suggested_replies
  id PK, conversation_id FK,
  body 🔒 (json: {draft, intent, tone, alt_drafts[]}),
  status (pending|accepted|edited|rejected|sent),
  sent_message_id FK nullable, created_at

rules
  id PK, user_id FK, conversation_id FK nullable (null = global),
  name, condition 🔒 (json DSL), action 🔒 (json DSL),
  enabled, priority, created_at, updated_at

audit_log
  id PK, user_id FK,
  type (ai_reply|rule_fired|decrypt|login|setting_change|kill|pair|unpair),
  target_ref (polymorphic), details 🔒 (json), created_at
  INDEX (user_id, created_at DESC)

api_keys
  id PK, user_id FK, name, token_hash, scopes[], last_used_at, created_at
```

**Design notes:**
- Message body is always encrypted; timestamps, conversation membership, and counters stay plaintext so the dashboard can render skeletons without decrypting everything — we only decrypt what's on screen.
- `messages.is_assistant` + `suggested_replies.sent_message_id` provide full provenance for AI-sent messages.
- `audit_log.details` is encrypted because it can contain message quotes.

---

## 5. Security Model

### Key hierarchy

```
MASTER_KEY  (32 bytes, env var, NEVER logged, NEVER in DB)
   │  AES-256-GCM wraps
   ▼
user.encrypted_dek  (per-user, 32 bytes, in users table)
   │  AES-256-GCM encrypts
   ▼
message.body / summary.body / audit.details / etc.
```

### Defenses

- **Passwords:** argon2id (64 MB memory, 3 iterations, 4 lanes). Password reset via email magic link lands in P3+.
- **Registration:** invite-only by default; first user = admin. `OPEN_REGISTRATION=true` env flag for single-user installs.
- **JWT:** 256-bit signing key, 15-min access + 7-day refresh, rotation on use.
- **Cookies:** `httpOnly`, `SameSite=Lax`, `Secure` when HTTPS detected.
- **Rate limits:** auth endpoints `5/15min/IP`; pairing `3/hour/user`; Claude calls gated by `cost_cap_usd_monthly`.
- **Log redaction:** pino redact list covers `password`, `token`, `auth_state`, `ciphertext`, `master_key`, `anthropic_api_key`. CI asserts no sensitive fields leak in fixture logs.
- **HTTP headers:** helmet defaults + strict CSP + HSTS when HTTPS.
- **Container hardening:** non-root user, read-only rootfs where possible, healthcheck on every service.
- **Supply chain:** Renovate + Dependabot; CodeQL workflow; signed images via cosign on release tags; pinned `package-lock.json`; `npm audit --audit-level=high` gates CI.
- **Secrets at first run:** `/wpa:init` generates `MASTER_KEY`, `JWT_SECRET`, Postgres password, Redis password via `crypto.randomBytes(32)`. Writes `.env` with `0600` perms. Prints the master key once with backup instructions. **Losing the master key = all encrypted data is unrecoverable.**
- **Key rotation:** `/wpa:rotate-key` re-wraps every user's DEK under a new master key. Seconds of downtime at family scale.
- **Audit trail:** every AI reply, rule firing, decrypt call, pairing event, and kill-switch invocation appears in `audit_log` with an encrypted details payload.
- **Kill switch (`/wpa:kill`):** (1) worker closes all sockets, (2) flips `connection_status=offline` for all sessions, (3) sets global `ASSISTANT_REPLY_ENABLED=false` in Redis, (4) writes audit entry. Dashboard shows red "ASSISTANT MUTED" banner until re-enabled.

### Threat model (documented in SECURITY.md)

**Defends against:** DB snapshot theft, log file leak, backup theft, Redis dump leak. All encrypted columns remain ciphertext without the master key.

**Does NOT defend against:** a compromised host, a malicious operator of the self-hosted instance (the user). That is an explicit tradeoff of self-hosting.

---

## 6. AI Layer

- **SDKs:** `@anthropic-ai/sdk` + `@anthropic-ai/claude-agent-sdk` for session/memory.
- **Models:** Haiku 4.5 for cheap classification (mention, action-item candidate, event candidate, noise); Sonnet 4.6 for summarization and reply drafting. Per-user overrides in settings.
- **Prompt caching is mandatory.** Catalog Zod schemas, system prompt, user context, and per-conversation rolling summary are cache-eligible blocks. Target ≥70 % cache hit on steady state.
- **Context compaction:** rolling summary per conversation. Trigger when (a) 50 new messages since last compact OR (b) context window exceeds 40 k tokens. Agent prompt = latest compact summary + last 20 raw messages.
- **Session state per conversation:** Redis `wpa:agent:{conv_id}` (hot, 24 h TTL); snapshots to Postgres `summaries` (cold, encrypted).

### Flows

- `ClassifyFlow` — Haiku. Runs on every inbound. Tags: `{mention, action_item_candidate, event_candidate, noise}`.
- `SummarizeFlow` — Sonnet. On-demand when user opens a conversation, or when new-activity threshold crosses. Emits `SummaryCard`.
- `ActionItemFlow` — Sonnet. Runs on `action_item_candidate`. Emits `ActionItem` with source quote + confidence.
- `SuggestedReplyFlow` — Sonnet. Runs on `mention` when conversation is in Assist/Auto. Emits `SuggestedReply`.
- `RuleMatchFlow` — evaluates per-conversation rules; triggers downstream flows (event extraction, calendar booking in P4, custom replies).

### Guardrails

- Per-user `cost_cap_usd_monthly`, enforced in Redis counter `wpa:cost:{user_id}:{yyyymm}`. 50 / 80 / 100 % alerts; 100 % = hard stop, UI banner, Claude calls refused.
- Every call logs `{flow, model, input_tokens, cached_tokens, output_tokens, cost_usd, latency_ms}` to `audit_log`.

---

## 7. Frontend + json-render

**Stack:** Vite + React 19 + TypeScript + Tailwind 4 + shadcn + Zustand + TanStack Query + react-router 7. Deployed as static assets served by the `api` container (non-`/api/*` paths).

**Rendering model:** every main panel is a json-render spec returned by the API. Frontend ships the block catalog; the API emits specs. **No UI code per feature.**

**Custom block catalog (typed by Zod):**
- `SummaryCard { title, bullets[], tone, key_people[] }`
- `ActionItem { text, due_at?, confidence, source_message_id, quick_actions[] }`
- `SuggestedReply { draft, intent, tone, alt_drafts[], rule_name?, one_click_send }`
- `EventCard { title, when, where, rsvp_state, quick_actions[] }`
- `Quote { text, author, timestamp, message_id }`
- `Timeline { items[] }`
- `PeopleChipList { people[], limit? }`
- `Insight { text, severity, link? }`
- Plus `@json-render/shadcn` primitives for layout (Card, Tabs, Badge, etc.).

**Routes:**
- `/login`, `/register` (only if open registration)
- `/` — dashboard: top action items, recent conversations, today's events, insights
- `/c/:conversationId` — conversation viewer (history + live AI panel)
- `/rules` — per-conversation rule editor
- `/settings` — pair WhatsApp, per-conversation mode, cost cap, API keys, danger zone
- `/audit` — audit log viewer

**Layout:** top bar (logo, user menu, **kill switch always visible**), left sidebar (conversations with unread + mode badges), main content (json-render).

**Real-time:** SSE stream `/api/events`. Events update a Zustand store; affected panels refetch. WebSocket upgrade path documented for later.

**Design language:** minimal, elegant, neutral slate palette, dark mode default, strong typographic hierarchy, motion only to communicate state changes. WCAG AA contrast.

---

## 8. Install, CI/CD, and the Claude Code Layer

### Containerization

- Single multi-stage Dockerfile builds all packages → one image, three processes via supervisord.
- `ENTRYPOINT_ROLE=api|worker|agent|all` env var picks which process(es) run. Default `all`.
- `docker-compose.yml`: app container + `postgres:16` + `redis:7-alpine` (AOF) + optional `caddy:2` for HTTPS (auto Let's Encrypt when `DOMAIN` set).
- `docker-compose.override.yml.example`: hot reload, source mounts, debug ports.

### GitHub Actions

- `ci.yml` — pnpm turbo: lint, typecheck, test (Vitest + React Testing Library), coverage gate (≥70 % backend).
- `codeql.yml` — weekly + on PR.
- `release.yml` — on tag `v*`: build multi-arch image (amd64 + arm64), cosign sign, push `ghcr.io/<owner>/whatsapp-personal-assistant:<tag>`, create GitHub release with changelog.
- Dependabot + Renovate configured from P0.

### One-click deploy targets (`deploy/` folder)

| Target | File | Path |
|---|---|---|
| Railway | `railway.json` | `deploy/railway/` |
| Fly.io | `fly.toml` | `deploy/flyio/` |
| Render | `render.yaml` | `deploy/render/` |
| AWS Lightsail Containers | `containers.json` + quick-create link | `deploy/aws-lightsail/` |
| Vercel (frontend only) | `vercel.json` + README explaining the backend split | `deploy/vercel/` |
| Self-host | `docker-compose.yml` at repo root | (primary path) |

### Claude Code layer (`.claude/`)

```
.claude/
  CLAUDE.md                      stack conventions, safety rules, command ref, never-do list
  commands/wpa/
    init.md   start.md   stop.md    status.md
    logs.md   help.md    deploy.md  update.md
    backup.md restore.md pair.md    kill.md
    rotate-key.md
  skills/
    wpa-deploying/SKILL.md       interactive deploy walkthrough
    wpa-troubleshooting/SKILL.md common-failures playbook
    wpa-upgrading/SKILL.md       upgrade + rollback
  agents/
    wpa-deploy-assistant.md      subagent for deploy skill
```

### Docs (plain Markdown for non-Claude users)

- `README.md` — deliberately short, two paths ("With Claude Code" / "Manual"), ToS disclosure up front.
- `docs/INSTALL.md` — manual install for every deploy target.
- `docs/ARCHITECTURE.md` — generated from this HLD.
- `docs/SECURITY.md` — threat model + responsible disclosure.
- `docs/CONTRIBUTING.md`.
- `CODE_OF_CONDUCT.md` — Contributor Covenant v2.1.
- `SUPPORT.md` — where to ask questions (Discussions) vs report bugs (Issues).
- `LICENSE` — MIT (default; confirm).

---

## 8a. GitHub Platform Usage

The repo is public from day one. We use GitHub as the full product platform: code, docs, website, community, security, releases. All of this is configured in P0 (minus content that depends on later phases).

### Repository settings (configured via Terraform `github` provider or a one-time `gh` CLI script in `scripts/bootstrap-github.sh`)

- Public visibility
- Description + topics (`whatsapp`, `baileys`, `claude`, `anthropic`, `self-hosted`, `typescript`, `docker`)
- License: MIT (file + GitHub-detected)
- Default branch: `main`
- Features enabled: **Wiki**, **Discussions**, **Projects**, **Issues**, **Sponsors (off by default)**, **Preserve this repository** (Arctic Vault: off for a WhatsApp project)
- Merge settings: squash-merge only; auto-delete head branches; PR title becomes squash commit
- Allow auto-merge: yes

### Branch protection for `main`

- Require pull request reviews: **1 approving review**, dismiss stale reviews on new commits
- Require status checks to pass before merge:
  - `ci / lint` `ci / typecheck` `ci / test` `ci / build`
  - `codeql / analyze`
  - `secret-scan / gitleaks`
  - `container-scan / trivy` (only when Dockerfile changed)
  - `licenses / check`
- Require branches up-to-date before merge
- Require **signed commits**
- Require **linear history**
- Block force pushes and deletions
- Restrict who can push to `main` (admins only, enforced even for admins)
- `CODEOWNERS` file — repo owner reviews security, infra, `.claude/`, and release paths

### Security features (all enabled in `.github/` or via `gh api`)

- **Private vulnerability reporting** enabled (GitHub tab → Security → Reporting)
- **Dependabot alerts** and **security updates** enabled
- **Secret scanning** + **push protection** enabled (free on public repos — blocks pushes containing known secret patterns)
- **Code scanning** via CodeQL workflow (weekly + on PR) — JavaScript/TypeScript queries
- Extra secret-scan in CI via **gitleaks** — catches patterns GitHub doesn't flag, runs on every PR and on push to `main`
- **Trivy** image scan on every container build; blocks release tag if HIGH/CRITICAL CVEs detected
- **SBOM generation** with `@cyclonedx/cyclonedx-npm` — attached to every release
- **Pre-commit hook** (husky + lint-staged + gitleaks) — prevents secret commits locally before they reach a push
- Cosign signs every released container image; verification instructions in `docs/SECURITY.md`
- Signed git tags for releases (`git tag -s`)

### Issue / PR templates (`.github/`)

- `ISSUE_TEMPLATE/bug_report.yml`
- `ISSUE_TEMPLATE/feature_request.yml`
- `ISSUE_TEMPLATE/config.yml` — routes "security vulnerability" to private advisory form, "question" to Discussions
- `PULL_REQUEST_TEMPLATE.md` — checklist (tests, docs, SECURITY impact, migration notes)

### GitHub Actions (expanded from §8)

| Workflow | Trigger | Purpose |
|---|---|---|
| `ci.yml` | PR + push main | lint, typecheck, test, build |
| `codeql.yml` | Weekly + PR | CodeQL static analysis |
| `secret-scan.yml` | PR + push main | gitleaks full-history scan |
| `container-scan.yml` | PR touching Dockerfile, release | trivy CVE scan |
| `licenses.yml` | PR touching package.json | license allow-list (MIT/Apache-2.0/ISC/BSD-*) |
| `sbom.yml` | On release tag | generate + attach CycloneDX SBOM |
| `release.yml` | On tag `v*` | multi-arch image build, cosign sign, GHCR push, GH release with changelog |
| `docs-site.yml` | Push main to `/docs/**` | build + deploy GitHub Pages site |
| `wiki-sync.yml` | Push main to `/wiki/**` | sync `wiki/` folder to the GitHub Wiki repo |
| `stale.yml` | Daily | close stale issues/PRs with friendly messaging |
| `pr-labeler.yml` | PR opened | auto-label by changed paths (`area:api`, `area:worker`, `area:web`, `area:claude`, `area:deploy`, `area:docs`) |
| `link-check.yml` | Weekly + PR touching docs | markdown-link-check across repo |

### GitHub Pages (project website)

- Source: `main` branch, `/website` folder (Astro Starlight or VitePress — TBD in P0 plan; likely VitePress for TS consistency)
- Published to `https://<owner>.github.io/whatsapp-personal-assistant` (or custom domain when the user points one)
- Content: landing page (what this is + screenshots), quickstart, "deploy anywhere" targets, architecture diagrams, FAQ, roadmap (generated from GitHub Projects)
- Build in `docs-site.yml`; deploy via `actions/deploy-pages`

### GitHub Wiki

- Seeded from `wiki/` folder in repo (kept in sync via `wiki-sync.yml` so wiki content is still PR-reviewable)
- Pages:
  - `Home` — orientation
  - `Installation-Deep-Dive` — each deploy target's gotchas
  - `Architecture` — longer-form than docs/
  - `Claude-Code-Commands` — full `/wpa:*` reference
  - `Rule-Cookbook` — example rules (school group, work, family)
  - `Troubleshooting-Compendium` — expanded failure modes
  - `Security-FAQ` — explains threat model in plain language
  - `Contributing-Guide-Long-Form`

### GitHub Discussions

Categories:
- `Announcements` (maintainer-only)
- `Q&A` (default for support questions — routed here from issue template)
- `Ideas` (feature requests before they become issues)
- `Show and tell` (rule recipes, cool setups)
- `General`

### GitHub Projects (v2)

- Board name: **Roadmap**
- Columns: `Backlog`, `P0`, `P1`, `P2`, `P3`, `P4`, `In progress`, `Review`, `Done`
- Auto-add issues labelled `roadmap`
- Milestones map 1:1 to phases P0–P5

### Releases

- Created by `release.yml` on `v*` tags
- Auto-generated release notes (via GitHub's release notes config)
- Assets attached: multi-arch docker manifest, cosign signature, SBOM
- Homebrew / Scoop / apt packaging: deferred (maybe P5+)

### Community health files

- `CODE_OF_CONDUCT.md` — Contributor Covenant v2.1
- `SECURITY.md` (repo root) — reporting process, supported versions, PGP key (optional)
- `SUPPORT.md` — "bugs → Issues, questions → Discussions, security → private advisory"
- `.github/FUNDING.yml` — skipped by default (add only if user wants sponsors)

---

## 9. Repository Layout

```
whatsapp-personal-assistant/
├── .claude/                   see §8
├── .github/
│   ├── workflows/             ci, codeql, release
│   ├── ISSUE_TEMPLATE/
│   ├── dependabot.yml
│   └── SECURITY.md
├── docs/
│   ├── VISION.md              CEO-level north star, re-read each phase
│   ├── INSTALL.md             manual install for every deploy target
│   ├── ARCHITECTURE.md        generated from HLD
│   ├── SECURITY.md            threat model + disclosure
│   ├── CONTRIBUTING.md
│   └── superpowers/
│       ├── specs/             dated design docs per phase
│       └── plans/             implementation plans per phase
├── wiki/                      PR-reviewable wiki source; synced to GH Wiki
├── website/                   VitePress site, published to GitHub Pages
├── deploy/                    per-target templates
├── packages/
│   ├── api/                   Express + Prisma client
│   ├── worker/                Baileys socket manager
│   ├── agent/                 Claude SDK orchestrator
│   ├── shared/                types, Zod schemas, json-render catalog
│   └── web/                   React SPA
├── prisma/
│   └── schema.prisma
├── .env.example
├── docker-compose.yml
├── docker-compose.override.yml.example
├── docker-compose.split.yml   optional, split processes
├── Dockerfile                 multi-stage
├── package.json               pnpm workspaces + turbo
├── turbo.json
├── tsconfig.base.json
├── LICENSE
└── README.md
```

---

## 10. Key Decisions Locked In

| Area | Decision |
|---|---|
| WhatsApp client | Baileys (direct integration in our worker; no CLI wrapper) |
| Model | Open source, self-hosted, single-host, family-scale (≤10 users) |
| Tenancy | Multi-user on one install; each user pairs own number; data isolated per user |
| Encryption | AES-256-GCM, MASTER_KEY in env, per-user DEK wrapped by master; no cloud KMS |
| Infra | Docker Compose default; Railway/Fly/Render/AWS Lightsail templates; no CDK |
| Backend | Node.js + Express + Prisma + Postgres 16 + Redis 7 (AOF) |
| Frontend | React + Vite + TS + Tailwind + shadcn + json-render + Zustand + TanStack Query |
| Session durability | Redis AOF (hot) + Postgres (cold). Auto-reconnect on restart without QR re-scan. |
| AI | Anthropic SDK + claude-agent-sdk; Haiku for classify, Sonnet for summarize/reply; mandatory prompt caching |
| UI generation | Backend emits json-render specs; frontend renders. Typed Zod catalog. |
| Auth MVP | Email + password + JWT (access 15 min + refresh 7 day); invite-only by default |
| Install UX | Claude Code first (`/wpa:*` commands); manual path in docs/INSTALL.md |
| CI/CD | GitHub Actions: ci, codeql, release. Multi-arch images signed with cosign on tag. |
| License | MIT (default, confirm) |

---

## 11. Deferred / Open Items

- **License:** MIT default; confirm.
- **Password reset:** email magic link — P3.
- **Real-time transport:** SSE in P1; WebSocket upgrade path if bi-directional needed.
- **Observability bundle:** pino stdout + optional Sentry DSN in P0. Loki/Grafana/Prometheus opt-in P3+.
- **Media storage:** local bind mount in P1. S3 optional in P3+.
- **i18n:** English only MVP; keys externalized for later.
- **Cost guard action:** warn-only vs hard-stop — per-user config.
- **Reply timing humanization parameters:** default ranges in P3; per-user override later.

---

## 12. What Happens Next

1. **User reviews this document** and requests changes or approves.
2. On approval, invoke the `superpowers:writing-plans` skill to produce the **P0 implementation plan**.
3. Execute P0 (foundation + install story + Claude-Code layer + GitHub-platform setup). Review. Ship.
4. Repeat the spec → plan → implement cycle for P1, P2, P3, P4.

Each phase gets its own design doc in `docs/superpowers/specs/` and its own implementation plan in `docs/superpowers/plans/`.

**Vision review cadence:** at the start of each new phase spec, [`docs/VISION.md`](../../VISION.md) is re-read; the phase spec's §1 links back to it instead of re-stating. A dated review note is appended to VISION.md's review log at every phase boundary, even if nothing changed — evidence that we looked.
