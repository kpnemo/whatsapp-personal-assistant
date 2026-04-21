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
