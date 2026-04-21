#!/usr/bin/env bash
# Generates missing secrets into .env. Idempotent — keeps existing values.
# Usage: scripts/first-run.sh
set -euo pipefail

ENV_FILE="${ENV_FILE:-.env}"
TEMPLATE=".env.example"

if [[ ! -f "$TEMPLATE" ]]; then
  echo "ERROR: $TEMPLATE not found. Run from repo root." >&2
  exit 1
fi

touch "$ENV_FILE"
chmod 600 "$ENV_FILE"

gen_base64() { openssl rand -base64 "$1" | tr -d '\n=' | tr '/+' '_-'; }
gen_32bytes_b64()   { openssl rand -base64 32 | tr -d '\n'; }

ensure_var() {
  local key="$1" default="${2:-}"
  if grep -q "^${key}=" "$ENV_FILE"; then
    local v
    v="$(grep "^${key}=" "$ENV_FILE" | head -n1 | cut -d= -f2-)"
    [[ -n "$v" ]] && return 0
    sed -i.bak "/^${key}=/d" "$ENV_FILE" && rm -f "${ENV_FILE}.bak"
  fi
  echo "${key}=${default}" >> "$ENV_FILE"
}

# Copy missing lines from template (without values)
while IFS= read -r line; do
  if [[ "$line" =~ ^[A-Z_]+= ]]; then
    key="${line%%=*}"
    grep -q "^${key}=" "$ENV_FILE" || echo "${key}=" >> "$ENV_FILE"
  fi
done < "$TEMPLATE"

# Fill secrets
MASTER_KEY_VAL="$(grep '^MASTER_KEY=' "$ENV_FILE" | head -n1 | cut -d= -f2-)"
if [[ -z "$MASTER_KEY_VAL" ]]; then
  NEW_KEY="$(gen_32bytes_b64)"
  sed -i.bak "s|^MASTER_KEY=.*|MASTER_KEY=${NEW_KEY}|" "$ENV_FILE" && rm -f "${ENV_FILE}.bak"
  echo ""
  echo "========================================================================"
  echo "  MASTER_KEY generated. BACK THIS UP OUT-OF-BAND. Losing it means all"
  echo "  encrypted data (message bodies, audit details, DEKs) is UNRECOVERABLE."
  echo ""
  echo "  MASTER_KEY=${NEW_KEY}"
  echo "========================================================================"
  echo ""
fi

ensure_var JWT_SECRET         "$(gen_base64 48)"
ensure_var POSTGRES_PASSWORD  "$(gen_base64 24)"
ensure_var REDIS_PASSWORD     "$(gen_base64 24)"

# Rebuild DATABASE_URL + REDIS_URL consistently
PG_PW="$(grep '^POSTGRES_PASSWORD=' "$ENV_FILE" | head -n1 | cut -d= -f2-)"
PG_USER="$(grep '^POSTGRES_USER=' "$ENV_FILE" | head -n1 | cut -d= -f2-)"
PG_DB="$(grep '^POSTGRES_DB=' "$ENV_FILE" | head -n1 | cut -d= -f2-)"
RD_PW="$(grep '^REDIS_PASSWORD=' "$ENV_FILE" | head -n1 | cut -d= -f2-)"

sed -i.bak "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://${PG_USER:-wpa}:${PG_PW}@postgres:5432/${PG_DB:-wpa}|" "$ENV_FILE" && rm -f "${ENV_FILE}.bak"
sed -i.bak "s|^REDIS_URL=.*|REDIS_URL=redis://:${RD_PW}@redis:6379|" "$ENV_FILE" && rm -f "${ENV_FILE}.bak"

chmod 600 "$ENV_FILE"
echo ".env ready. Next: /wpa:start (or 'docker compose up -d')."
