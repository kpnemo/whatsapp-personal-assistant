---
description: Start the full stack locally via docker-compose and open the dashboard.
---

# /wpa:start

Bring up the application locally.

1. Verify `.env` exists. If not, tell the user to run `/wpa:init` first.
2. Run:
   ```bash
   docker compose up -d --build
   ```
3. Poll `http://localhost:3000/healthz` with curl for up to 90 seconds. Expected: `{"status":"ok"}`.
4. On success, tell the user: "Open http://localhost:3000 and register. The first account becomes admin."
5. On failure, run `docker compose logs --tail=100 app` and summarize the cause.
