#!/usr/bin/env bash
# CI smoke: boot the full stack via /wpa:start-local (--smoke: no browser,
# deterministic healthz wait), then assert auth + pair endpoints respond.
#
# Everything infra-side (preflight, port pick, .env bootstrap, docker compose
# up, healthz wait) is delegated to scripts/wpa/start-local.sh so the smoke
# test stays focused on HTTP contract checks and doesn't duplicate setup.
#
# Exit 0 on success, non-zero on any failure. Always tears down the stack.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PORT="${API_HOST_PORT:-3000}"
BASE="http://localhost:$PORT"
EMAIL="smoke@example.com"
PASS="correct-horse-battery-staple"
COOKIES="$(mktemp -t wpa-smoke-cookies.XXXXXX)"

cleanup() {
  local rc=$?
  if [ "$rc" -ne 0 ]; then
    docker compose logs --tail=200 || true
  fi
  docker compose down --remove-orphans --volumes >/dev/null 2>&1 || true
  rm -f "$COOKIES" .env.smoke
  exit "$rc"
}
trap cleanup EXIT INT TERM

# ---------------------------------------------------------------------------
# Clean slate — remove any stale stack/volumes from a previous run.
# start-local will recreate .env via first-run.sh if needed.
# ---------------------------------------------------------------------------
docker compose down -v --remove-orphans >/dev/null 2>&1 || true

# ---------------------------------------------------------------------------
# Delegate boot + healthz to /wpa:start-local. --smoke skips admin + browser.
# WPA_NO_AUTO_START_DOCKER keeps CI deterministic — we assume the daemon is
# already up on GitHub runners.
# ---------------------------------------------------------------------------
WPA_NO_AUTO_START_DOCKER=1 \
  bash scripts/wpa/start-local.sh --smoke --port "$PORT"

# ---------------------------------------------------------------------------
# Assertion 1 — SPA index is reachable.
# ---------------------------------------------------------------------------
curl -fsS "$BASE/" | grep -q '<div id="root">' \
  && echo "smoke: SPA index ok"

# ---------------------------------------------------------------------------
# Assertion 2 — register first user (becomes admin on a fresh DB).
# ---------------------------------------------------------------------------
REG="$(curl -fsS -X POST "$BASE/api/auth/register" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}")"
echo "smoke: register ok ($(echo "$REG" | jq -r '.user.email // "no-email"'))"

# ---------------------------------------------------------------------------
# Assertion 3 — login returns an accessToken and sets the refresh cookie.
# ---------------------------------------------------------------------------
LOGIN="$(curl -fsS -X POST "$BASE/api/auth/login" \
  -H 'content-type: application/json' \
  -c "$COOKIES" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}")"
TOKEN="$(echo "$LOGIN" | jq -r '.accessToken')"
[ -n "$TOKEN" ] && [ "$TOKEN" != "null" ] || { echo "smoke: login missing accessToken"; exit 1; }
echo "smoke: login ok"

# ---------------------------------------------------------------------------
# Assertion 4 — /auth/me round-trips the bearer token.
# ---------------------------------------------------------------------------
curl -fsS "$BASE/api/auth/me" -H "authorization: Bearer $TOKEN" | jq -e '.email' >/dev/null
echo "smoke: /auth/me ok"

# ---------------------------------------------------------------------------
# Assertion 5 — /pair/init returns 201 + sessionId. Validates route wiring,
# rate-limit plumbing, and Redis stream publish without needing a real phone.
# ---------------------------------------------------------------------------
curl -fsS -X POST "$BASE/api/pair/init" \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{}' | jq -e '.sessionId' >/dev/null
echo "smoke: /pair/init ok"

echo "SMOKE PASS"
