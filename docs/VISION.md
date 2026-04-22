# WhatsApp Personal Assistant — Product Vision

> This is the north star. It explains **why** this project exists, **who** it is for, and **what cannot be compromised**. It does not describe how to build anything — the `docs/superpowers/specs/` documents do that, one phase at a time.
>
> **Cadence:** re-read at the start of every phase spec. Revised only when reality forces it. Revisions are PRs with rationale; the commit history is the history of the product's convictions.

**Owner:** @mikeb
**Status:** Living document
**Last reviewed:** 2026-04-22 (post-P1-B)

---

## The problem

Everyday WhatsApp life is a split-attention tax. A person's phone holds dozens of active chats — family, school, co-workers, community groups — each of which feels urgent-enough to open and mostly isn't. Important @-mentions drown in group-chat noise. Events and action items decay in the scroll. Replying well takes more time than reading, so people either over-invest attention or silently miss things that matter.

WhatsApp itself is not going to fix this. It is a messaging layer, not an attention layer. What's missing is a **co-pilot** that reads every conversation the user is part of, understands what matters to them specifically, and surfaces only the things worth their time — without ever speaking unless invited.

## Why now

Two things became true at once:

1. **Claude is now good enough** to summarize long casual conversations, detect intent, and draft replies in the user's tone — all with prompt caching cheap enough to run continuously on family-scale traffic.
2. **Multi-device WhatsApp libraries (Baileys)** exposed the personal-account protocol reliably enough to integrate with, accepting the ToS tradeoff honestly.

Neither piece existed at a usable quality before. Together they make a self-hosted, bring-your-own-key personal assistant for the world's most-used messenger actually buildable by one person over a series of evenings.

## Who this is for

**In priority order:**

1. **The author and his family (≤10 people on one install).** The reason the project exists. Each family member logs in, pairs their own number, sees only their own conversations. If nobody else ever uses it, it was still worth building.
2. **Other self-hosters** who want the same thing for themselves. Technically comfortable individuals running a VPS, home server, Raspberry Pi, or a cheap managed container host. They want to own their data and bring their own Anthropic key.
3. **Contributors** who read the code before running it. The repo is designed to be read: typed, tested, documented, with a clear threat model.

**Who this is NOT for:**
- Businesses running customer support (use WhatsApp Business API, not this).
- People who want a hosted SaaS with no ops burden (product doesn't exist; and a commercial offering would be impossible given WhatsApp's ToS).
- Anyone who wants the assistant to reply without explicit per-conversation consent (the product principles forbid it).

## The core value loop

1. **Pair once.** Scan a QR code from the dashboard. The user's phone stays the source of truth for their identity on WhatsApp.
2. **Silent ingestion by default.** The assistant reads everything, writes nothing, until the user explicitly enables it for a specific conversation.
3. **Open the dashboard.** A live summary of each active conversation, @-mention action items with quoted source, extracted events, and — when enabled — suggested replies. All rendered from AI-emitted UI specs; no feature requires new hand-coded screens.
4. **Configure per-conversation rules.** "In the school group, whenever there's an event, propose a calendar booking." "In the work team, if my name is mentioned, draft a reply and ping me." Plain-English rules with concrete behaviors.
5. **Graduate trusted conversations to auto-reply.** Move from Silent → Assist (drafts only) → Auto (sends with humanized timing, always audited). Reverse any of these in one click.

## Product principles (non-negotiable)

These define the product's identity. Violating one of them is a refactor-the-whole-product-level decision.

1. **Silent until consented.** Auto-reply is opt-in *per conversation*, never a global toggle. The global default is Silent. The kill switch is always one click away, always visible in the top bar.
2. **Every AI action is visible.** Any assistant-sent message is highlighted in the dashboard with the matched rule, the reasoning, and a one-click "disable this rule" escape.
3. **Your data stays on your box.** Message bodies encrypted at rest with a master key the user supplies. Per-user DEKs derived from it. No cloud dependency for the core product. No phone-home telemetry by default.
4. **Bring your own Anthropic API key.** No proxy, no shared key, no vendor lock-in. Claude usage is on the user's account.
5. **Generative UI.** The backend emits json-render specs. The frontend renders them. New capabilities become new block types and new prompts, not new hand-coded screens. This is an engineering principle AND a product principle — it prevents UI debt from slowing down feature velocity.
6. **ToS risk is disclosed and owned by the user.** Baileys violates WhatsApp ToS; numbers can be banned. The README leads with this. We do not pretend otherwise, and we do not accept responsibility for the user's WhatsApp account.
7. **Security posture is a feature.** Public repo with pinned deps, signed container images, CodeQL + secret scanning + SBOMs, redact-by-default logs, CSP, and a documented threat model. This product handles the most personal chat history a person has; we act like it.
8. **Installation must feel magical.** `git clone` → `/wpa:init` → `/wpa:start` → paired, in under 5 minutes on a fresh VPS. If we ever need a 15-step README, we've lost.

## What success looks like

**Short term (through P3):**
- The author runs this daily on his own WhatsApp with his family paired, for at least three months, without it breaking in ways that embarrass him.
- A stranger who never saw the repo can clone it, run `/wpa:init`, `/wpa:start`, and reach a login screen on a fresh VPS in under 5 minutes.
- At least one auto-reply rule runs in a real family or school group for a week without the assistant saying anything the user regrets.
- No cross-account data leakage in a manual red-team pass on a family-of-5 install.

**Long term (through P5 and beyond):**
- A self-hoster anywhere in the world can deploy this in 1 click to Railway, Fly, Render, or Lightsail, pair, and get value in the first 10 minutes.
- The assistant routinely saves the user 20+ minutes a day of scroll-and-triage.
- A small community contributes rule recipes, block types, and integrations; the repo has active Discussions and a Wiki full of real-world setups.
- Extracted events land in Google Calendar; drafted replies become a trusted daily interaction.

## Anti-goals (what this will NOT become)

- **Not a SaaS.** No hosted commercial version. The ToS risk and the trust model (your keys, your box) both forbid it.
- **Not a chatbot platform.** The assistant does not have a personality, a mascot, or a conversational UX. It is a co-pilot, not a character.
- **Not a WhatsApp clone.** The message viewer is functional, not pretty; the real product is the summary/action-item/rule layer on top.
- **Not an enterprise product.** No SSO, no audit-export-for-compliance, no SOC 2. Family scale forever.
- **Not "set it and forget it" auto-reply.** Every auto-reply requires per-conversation consent, and every reply is auditable.
- **Not a general-purpose agent.** The assistant only does what's explicitly modeled: classify, summarize, extract actions/events, suggest/send replies, match rules. It is not a "do anything you ask in chat" tool.

## The roadmap at a glance

*(Phase-by-phase exit criteria live in the dated design spec. This is just the arc.)*

- **P0 — Foundation & Install.** The repo a stranger can clone and bring up.
- **P1 — Ingest (silent).** QR pair, messages flow in, dashboard shows them. No AI.
  - [x] QR pairing works end-to-end (P1-A shipped)
  - [x] Message ingest + encrypted storage (P1-B shipped)
  - [x] Conversation sidebar + message viewer (P1-B shipped)
  - [x] SSE live updates (P1-B shipped)
  - [x] Unpair flow / disconnect (P1-B shipped)
  - [ ] `/wpa:pair` slash command
- **P2 — Understand (read-only).** AI summaries, @-mentions, action items, suggested replies — never sent.
- **P3 — Rules & Auto-reply.** Per-conversation rules, three modes, humanized timing, audit trail.
- **P4 — Integrations.** Google Calendar + Gmail. Extracted events become real bookings.
- **P5+ — Mobile, household views, notification channels.** Deferred.

## Constraints we have accepted

- **WhatsApp ToS:** Baileys violates it. We accept the risk, document it clearly, mitigate through rate limits and humanization, and provide a clean kill-switch and re-pair flow.
- **Single-host, family-scale:** No horizontal scaling by design. If we ever need it, we have lost focus.
- **User-managed master key:** Losing it means all encrypted data is unrecoverable. This is an explicit tradeoff against cloud KMS convenience, and the install flow makes backup mandatory.
- **Self-hosting tax:** The user is responsible for uptime, backups, HTTPS, and domain. We minimize the tax with docker-compose, one-click templates, Caddy for auto-HTTPS, and Claude-Code-driven ops — but we do not pretend the tax is zero.

## How this document is maintained

- **Re-read at the start of every phase spec.** The phase spec's §1 links back here instead of re-stating the vision.
- **Revised via PR only, with rationale in the PR body.** Commit history tells the story of how convictions changed.
- **Reviewed explicitly at phase boundaries** — at the end of P0, P1, P2, etc., the vision doc gets a dated review note in the `Last reviewed` header. If nothing changed, the review note still goes in — evidence that we looked.
- **Anti-goals are as important as goals.** New ideas get tested against the Anti-goals section first.

## Review log

| Date | Phase boundary | Reviewer | Changes |
|---|---|---|---|
| 2026-04-21 | Pre-P0 (initial) | @mikeb | Document created. |
| 2026-04-22 | Post-P1-B | @mikeb | Struck P1-B items: message ingest, chat viewer, SSE, unpair/disconnect. |
