---
description: One-shot turnkey — boot the stack on a free port, create admin, open browser.
argument-hint: "[--dry-run] [--smoke] [--port N] [--skip-admin]"
---

# /wpa:start-local

Zero-to-running local install: picks a free port, ensures `.env`, brings up the
full stack via docker-compose, waits healthy, creates the first-user admin
account, and opens the dashboard in your browser.

Run:

```bash
bash scripts/wpa/start-local.sh $ARGUMENTS
```

If exit code is non-zero, summarize the last ~40 lines of output for the user
and suggest `docker compose logs --tail=200 app` as the next step.

On success, the script prints admin credentials ONCE and also writes them to
`~/.wpa-admin-YYYY-MM-DD.txt` (chmod 600). The MASTER_KEY backup lands at
`~/wpa-master-key-YYYY-MM-DD.txt`. Remind the user to copy both into a
password manager.

Known limitations:

- If the browser doesn't open (e.g. on a headless server or in a container),
  the URL is still printed — open it manually from another machine. The script
  does not currently surface failures from the underlying `open` / `xdg-open`
  call; see the printed URL as the authoritative reference.
- Re-running `/wpa:start-local` on a healthy stack is a no-op: it probes
  `/healthz` on the port recorded in `.env` and, if it answers, reuses the
  existing stack and opens the browser. If you need a clean rebuild, stop the
  stack first (`/wpa:stop` or `docker compose down`).
