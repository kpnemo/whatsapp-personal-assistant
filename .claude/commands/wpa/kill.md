---
description: Emergency mute — assistant will not reply until restored. P3 also closes sockets.
---

# /wpa:kill

1. Prompt user to confirm. Say: "This sets the global assistant_reply_enabled flag to false. In P3 this also closes all WhatsApp sockets."
2. On confirm, curl:
   ```bash
   curl -X POST -H "Authorization: Bearer $WPA_ADMIN_TOKEN" http://localhost:3000/api/kill
   ```
3. If `$WPA_ADMIN_TOKEN` is not set, ask the user to paste an access token (from DevTools → /api/auth/me) or log in via web.
4. Report success. Remind user: to restore, call `POST /api/kill/restore`.
