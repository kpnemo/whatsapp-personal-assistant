---
description: Generate .env, random secrets, and prompt for first-run configuration.
argument-hint: ""
---

# /wpa:init

Run first-run setup for this WhatsApp Personal Assistant install.

Steps for you (Claude):

1. Verify the user is at the repo root. If `package.json` does not have `"name": "whatsapp-personal-assistant"`, stop and tell the user to `cd` into the clone.
2. Run:
   ```bash
   bash scripts/first-run.sh
   ```
3. Read the generated `.env`. Do NOT echo the values back. Confirm that `MASTER_KEY`, `JWT_SECRET`, `POSTGRES_PASSWORD`, `REDIS_PASSWORD` are all non-empty.
4. If `MASTER_KEY` was just generated on this run (the script prints a banner), remind the user to copy it to a password manager immediately. Quote the banner verbatim.
5. Offer `OPEN_REGISTRATION` tradeoff:
   - `false` (default) — invite-only; first user will be admin.
   - `true` — anyone with the URL can register. Only set this if the service is on a private network or single-user install.
     Ask which they prefer and, if `true`, edit `.env` to set `OPEN_REGISTRATION=true`.
6. Confirm `PUBLIC_ORIGIN` in `.env`. Default `http://localhost:3000` is fine for local; ask for the real domain if deploying.
7. Tell the user to run `/wpa:start` next.
