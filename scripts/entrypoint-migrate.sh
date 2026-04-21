#!/usr/bin/env sh
set -eu
cd /app
pnpm --filter @wpa/db exec prisma migrate deploy
exec /usr/bin/supervisord -c /etc/supervisord.conf
