# Architecture

A three-process backend (API, worker, agent) plus a React SPA, all in one container. Postgres + Redis are external services.

The authoritative HLD lives in the repo: [`docs/superpowers/specs/2026-04-21-whatsapp-personal-assistant-design.md`](https://github.com/<owner>/whatsapp-personal-assistant/blob/main/docs/superpowers/specs/2026-04-21-whatsapp-personal-assistant-design.md).

## Key points

- **Generative UI.** The backend emits json-render specs; the frontend renders them. New capability = new block type + new prompt, not a new screen.
- **Keys.** `MASTER_KEY` (host env) wraps a per-user DEK. Record-level AES-256-GCM with unique IVs. See [`docs/SECURITY.md`](https://github.com/<owner>/whatsapp-personal-assistant/blob/main/docs/SECURITY.md).
- **Single-host, family-scale.** No horizontal scaling by design.
- **Bring your own Anthropic key.** No proxy, no shared key. Claude usage is on the user's account.

For the why behind each choice, read [`docs/VISION.md`](https://github.com/<owner>/whatsapp-personal-assistant/blob/main/docs/VISION.md).
