---
description: Stream filtered logs for a service.
argument-hint: "<service> — one of: app | postgres | redis (later: worker, agent when split mode)"
---

# /wpa:logs $ARGUMENTS

Run:

```bash
docker compose logs --tail=200 -f $ARGUMENTS
```

Always warn the user before displaying logs that they may contain limited metadata (but not message bodies — those are redacted).
