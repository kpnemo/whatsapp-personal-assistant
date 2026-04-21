#!/usr/bin/env bash
# Start the stack fresh, wait healthy, assert login page reachable and auth flow works.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

trap 'docker compose logs --tail=200 || true; docker compose down -v' ERR

# Clean slate
docker compose down -v --remove-orphans >/dev/null 2>&1 || true
rm -f .env.smoke
ENV_FILE=.env.smoke bash scripts/first-run.sh >/dev/null
cp .env.smoke .env

docker compose up -d --build
# Wait for healthz up to 120s
for i in $(seq 1 120); do
  if curl -fsS http://localhost:3000/healthz >/dev/null 2>&1; then
    echo "healthy after ${i}s"; break
  fi
  sleep 1
done

# Register first user (becomes admin)
RESP="$(curl -fsS -X POST http://localhost:3000/api/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"smoke@example.com","password":"correct-horse-battery-staple"}')"
echo "register: $RESP"

# Login
TOKEN_RESP="$(curl -fsS -X POST http://localhost:3000/api/auth/login \
  -H 'content-type: application/json' \
  -c cookies.txt \
  -d '{"email":"smoke@example.com","password":"correct-horse-battery-staple"}')"
echo "login: $TOKEN_RESP"

ACCESS="$(echo "$TOKEN_RESP" | python3 -c 'import json,sys;print(json.loads(sys.stdin.read())["accessToken"])')"

# /auth/me
ME="$(curl -fsS http://localhost:3000/api/auth/me -H "authorization: Bearer $ACCESS")"
echo "me: $ME"

# SPA reachable
curl -fsS http://localhost:3000/ | grep -q '<div id="root">' && echo "SPA index ok"

docker compose down -v
rm -f .env .env.smoke cookies.txt
echo "SMOKE PASS"
