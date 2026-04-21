---
description: Show container health, worker state, and last-seen message summary.
---

# /wpa:status

1. Run `docker compose ps --format json` and summarize the health of `app`, `postgres`, `redis`.
2. Hit `http://localhost:3000/healthz` and `/readyz` with curl.
3. If any container is unhealthy, fetch `docker compose logs --tail=80 <svc>` and report.
4. (P1+) Report `whatsapp_sessions` connection_status breakdown. (Skip in P0.)
