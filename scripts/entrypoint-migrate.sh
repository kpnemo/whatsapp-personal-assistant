#!/usr/bin/env sh
# Entrypoint — runs Prisma migrate deploy, then hands off to supervisord.
#
# Safe recovery: if `migrate deploy` fails due to a previously-failed
# migration that never touched the schema (applied_steps_count = 0), we
# mark it rolled-back and retry. This keeps the image self-healing in
# the common case of an IB-iteration dev DB without masking real
# partial-apply failures (which have applied_steps_count > 0 and remain
# blocked for human review).
set -eu
cd /app

run_migrate() {
  pnpm --filter @wpa/db exec prisma migrate deploy
}

if run_migrate; then
  exec /usr/bin/supervisord -c /etc/supervisord.conf
fi

echo "entrypoint-migrate: initial migrate deploy failed — checking for safe recovery"

# Postgres connection strings land in DATABASE_URL. Use psql via the
# installed libpq tools if present; otherwise fall back to prisma CLI.
FAILED="$(pnpm --filter @wpa/db exec -- node -e '
import("@prisma/client").then(async ({ PrismaClient }) => {
  const p = new PrismaClient();
  const rows = await p.$queryRawUnsafe(
    `SELECT migration_name FROM _prisma_migrations
     WHERE finished_at IS NULL
       AND rolled_back_at IS NULL
       AND applied_steps_count = 0
     ORDER BY started_at DESC`,
  );
  for (const r of rows) console.log(r.migration_name);
  await p.$disconnect();
}).catch(e => { console.error(e); process.exit(1); });
' 2>/dev/null)"

if [ -z "$FAILED" ]; then
  echo "entrypoint-migrate: no auto-recoverable migrations (applied_steps_count>0 or no failures); refusing to heal"
  exit 1
fi

for MIGRATION in $FAILED; do
  echo "entrypoint-migrate: marking $MIGRATION as rolled back (applied_steps_count=0, safe to retry)"
  pnpm --filter @wpa/db exec prisma migrate resolve --rolled-back "$MIGRATION"
done

echo "entrypoint-migrate: retrying migrate deploy after recovery"
if run_migrate; then
  exec /usr/bin/supervisord -c /etc/supervisord.conf
fi

echo "entrypoint-migrate: retry failed; manual intervention required"
exit 1
