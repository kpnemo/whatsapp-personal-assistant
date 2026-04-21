---
description: Stop all containers without removing volumes.
---

# /wpa:stop

Run:

```bash
docker compose down
```

If the user passes `--volumes` as argument, run `docker compose down --volumes` after confirming they understand this destroys the encrypted DB and Redis data.
