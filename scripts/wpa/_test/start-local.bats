#!/usr/bin/env bats
# Tests for scripts/wpa/start-local.sh
#
# Strategy: use --dry-run mode for most tests so we don't need a real Docker
# daemon or live HTTP server. Where we do need to shim `docker`, `curl`, or
# `open`, we prepend a scratch directory full of fake binaries to PATH.

setup() {
  load "bats-helpers/bats-support/load"
  load "bats-helpers/bats-assert/load"
  load "bats-helpers/bats-file/load"

  SCRIPT_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
  SCRIPT="$SCRIPT_DIR/start-local.sh"
  REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

  TEST_TMP="$(temp_make)"

  # Default env: keep the script from trying to talk to anything real.
  export WPA_BROWSER_DRY_RUN=1
  export NO_COLOR=1
  # Redirect HOME so tests never pollute the real user's ~ with master-key
  # backups or admin cred files.
  export HOME="$TEST_TMP/home"
  mkdir -p "$HOME"
}

teardown() {
  temp_del "$TEST_TMP"
}

# Build a scratch directory with a minimal working "repo" layout so the
# script's preflight checks pass without needing the whole monorepo.
seed_fake_repo() {
  local dir="$1"
  mkdir -p "$dir/scripts"
  # Minimal .env.example for ensure_env_file fallback
  cat >"$dir/.env.example" <<'EOF'
MASTER_KEY=
JWT_SECRET=
POSTGRES_PASSWORD=
POSTGRES_USER=wpa
POSTGRES_DB=wpa
REDIS_PASSWORD=
PUBLIC_ORIGIN=http://localhost:3000
API_PORT=3000
EOF
  # Pretend docker-compose.yml exists so preflight knows we're in a repo root
  cat >"$dir/docker-compose.yml" <<'EOF'
services:
  app:
    ports: ["${API_HOST_PORT:-3000}:3000"]
EOF
  # Stub first-run.sh so the "missing .env" path doesn't need openssl tricks
  cat >"$dir/scripts/first-run.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
ENV_FILE="${ENV_FILE:-.env}"
: >"$ENV_FILE"
chmod 600 "$ENV_FILE"
echo "MASTER_KEY=Zm9vYmFyZm9vYmFyZm9vYmFyZm9vYmFyZm9vYmFyZm9vYmFyZg==" >>"$ENV_FILE"
echo "JWT_SECRET=jwtsecretjwtsecretjwtsecretjwtsecret" >>"$ENV_FILE"
echo "POSTGRES_PASSWORD=pgpw" >>"$ENV_FILE"
echo "REDIS_PASSWORD=rdpw" >>"$ENV_FILE"
echo "API_PORT=3000" >>"$ENV_FILE"
echo "PUBLIC_ORIGIN=http://localhost:3000" >>"$ENV_FILE"
echo "FIRSTRUN_STUB_RAN=1" >>"$ENV_FILE"
EOF
  chmod +x "$dir/scripts/first-run.sh"
}

# Create a fake `docker` on PATH that records its argv to a log file.
# $1 = output log path
# $2 = exit-code mode: "info_ok" (docker info succeeds) | "info_fail" (daemon down)
# $3 = "compose_ok" | "compose_fail"
install_fake_docker() {
  local bindir="$1" mode="${2:-info_ok}" compose_mode="${3:-compose_ok}"
  mkdir -p "$bindir"
  cat >"$bindir/docker" <<EOF
#!/usr/bin/env bash
# Fake docker shim installed by bats
echo "docker \$*" >>"$bindir/_docker.log"
if [ "\$1" = "info" ]; then
  if [ "$mode" = "info_ok" ]; then exit 0; else exit 1; fi
fi
if [ "\$1" = "compose" ]; then
  if [ "\$2" = "version" ]; then exit 0; fi
  if [ "$compose_mode" = "compose_ok" ]; then exit 0; else exit 1; fi
fi
exit 0
EOF
  chmod +x "$bindir/docker"
}

# ============================================================================
# Flag parsing
# ============================================================================

@test "--help prints usage and exits 0" {
  run bash "$SCRIPT" --help
  assert_success
  assert_output --partial "Usage"
  assert_output --partial "--dry-run"
  assert_output --partial "--smoke"
  assert_output --partial "--port"
  assert_output --partial "--skip-admin"
}

@test "unknown flag exits non-zero with a helpful message" {
  run bash "$SCRIPT" --totally-not-a-flag
  assert_failure
  assert_output --partial "unknown"
}

# ============================================================================
# Dry-run mode (no Docker/curl/browser side effects)
# ============================================================================

@test "--dry-run: prints the compose command it would run, does not exec docker" {
  seed_fake_repo "$TEST_TMP"
  cd "$TEST_TMP"
  run bash "$SCRIPT" --dry-run
  assert_success
  assert_output --partial "docker compose up"
  # No docker log file was created (no fake docker installed; real docker not called)
  assert_file_not_exists "$TEST_TMP/_docker.log"
}

@test "--dry-run: mentions healthz URL with the chosen port" {
  seed_fake_repo "$TEST_TMP"
  cd "$TEST_TMP"
  run bash "$SCRIPT" --dry-run --port 3456
  assert_success
  assert_output --partial "http://localhost:3456/healthz"
}

@test "--dry-run: prints browser command without launching" {
  seed_fake_repo "$TEST_TMP"
  cd "$TEST_TMP"
  run bash "$SCRIPT" --dry-run
  assert_success
  # open_browser in dry-run prints "would run: open <url>" (or xdg-open on Linux)
  assert_output --partial "http://localhost:"
}

# ============================================================================
# Port selection (Step 2)
# ============================================================================

@test "--port N: uses the given port verbatim and stamps it into .env" {
  seed_fake_repo "$TEST_TMP"
  cd "$TEST_TMP"
  run bash "$SCRIPT" --dry-run --port 3456
  assert_success
  # The script stamps API_PORT in .env
  assert_file_exists "$TEST_TMP/.env"
  run grep '^API_PORT=' "$TEST_TMP/.env"
  assert_output "API_PORT=3456"
}

@test "--port N: also stamps PUBLIC_ORIGIN with the chosen port" {
  seed_fake_repo "$TEST_TMP"
  cd "$TEST_TMP"
  run bash "$SCRIPT" --dry-run --port 3456
  assert_success
  run grep '^PUBLIC_ORIGIN=' "$TEST_TMP/.env"
  assert_output "PUBLIC_ORIGIN=http://localhost:3456"
}

@test "no --port: auto-detection picks a free port above 1024" {
  seed_fake_repo "$TEST_TMP"
  cd "$TEST_TMP"
  run bash "$SCRIPT" --dry-run
  assert_success
  local port
  port="$(grep '^API_PORT=' "$TEST_TMP/.env" | cut -d= -f2-)"
  [ -n "$port" ]
  [ "$port" -gt 1024 ]
  [ "$port" -lt 65536 ]
}

# ============================================================================
# Missing-.env path (Step 3) — must invoke first-run.sh
# ============================================================================

@test "missing .env: invokes scripts/first-run.sh and populates .env" {
  seed_fake_repo "$TEST_TMP"
  cd "$TEST_TMP"
  # .env is absent on a fresh clone
  assert_file_not_exists ".env"
  run bash "$SCRIPT" --dry-run
  assert_success
  assert_file_exists ".env"
  # Our stub first-run.sh leaves a marker
  run grep '^FIRSTRUN_STUB_RAN=1' ".env"
  assert_output "FIRSTRUN_STUB_RAN=1"
}

@test "existing .env: does not re-run first-run.sh" {
  seed_fake_repo "$TEST_TMP"
  cd "$TEST_TMP"
  # Pre-populate .env WITHOUT the first-run marker; ensure it stays that way
  cat >".env" <<'EOF'
MASTER_KEY=existingkey
JWT_SECRET=existingsecret
POSTGRES_PASSWORD=existingpg
REDIS_PASSWORD=existingrd
API_PORT=3000
PUBLIC_ORIGIN=http://localhost:3000
EOF
  chmod 600 ".env"
  run bash "$SCRIPT" --dry-run --port 3000
  assert_success
  run grep -c '^FIRSTRUN_STUB_RAN=' ".env"
  assert_output "0"
  # MASTER_KEY preserved
  run grep '^MASTER_KEY=' ".env"
  assert_output "MASTER_KEY=existingkey"
}

# ============================================================================
# Docker-down path (Step 1)
# ============================================================================

@test "docker-down (real): non-dry-run asks to start Docker and exits 1" {
  seed_fake_repo "$TEST_TMP"
  cd "$TEST_TMP"
  install_fake_docker "$TEST_TMP/bin" "info_fail" "compose_ok"
  PATH="$TEST_TMP/bin:$PATH" WPA_NO_AUTO_START_DOCKER=1 run bash "$SCRIPT" --skip-admin
  assert_failure
  # The error message should mention docker being down or not reachable
  [[ "$output" == *"docker"* || "$output" == *"Docker"* ]]
}

@test "docker-down (dry-run): still reports the intent without exec" {
  # Dry-run path should NOT fail on docker-down because we never actually
  # contact the daemon — it should still print the commands it would run.
  seed_fake_repo "$TEST_TMP"
  cd "$TEST_TMP"
  run bash "$SCRIPT" --dry-run
  assert_success
}

# ============================================================================
# Port-conflict path (Step 2) — when --port is not given and a port is busy
# ============================================================================

@test "port-conflict: shifts to next free port when 3000 is busy" {
  seed_fake_repo "$TEST_TMP"
  cd "$TEST_TMP"
  # Hold port 3000 with a python listener so find_free_port's preference ladder
  # has to skip it. Background, capture pid, clean up.
  python3 -c '
import socket, sys, time
s = socket.socket()
s.bind(("127.0.0.1", 3000))
s.listen(1)
sys.stdout.write("bound\n"); sys.stdout.flush()
time.sleep(5)
' >"$TEST_TMP/listener.out" 2>&1 &
  local pid=$!
  # Wait for it to bind
  for _ in $(seq 1 20); do
    if grep -q bound "$TEST_TMP/listener.out" 2>/dev/null; then break; fi
    sleep 0.1
  done

  run bash "$SCRIPT" --dry-run
  kill "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true

  assert_success
  local port
  port="$(grep '^API_PORT=' "$TEST_TMP/.env" | cut -d= -f2-)"
  # Must NOT have picked 3000 since we held it
  [ "$port" != "3000" ]
  [ "$port" -gt 1024 ]
}

# ============================================================================
# --smoke mode (future H12 uses this)
# ============================================================================

@test "--smoke: skips admin creation and browser launch" {
  seed_fake_repo "$TEST_TMP"
  cd "$TEST_TMP"
  run bash "$SCRIPT" --dry-run --smoke
  assert_success
  # Must not attempt admin registration in smoke mode
  refute_output --partial "auth/register"
  # Must not attempt to open the browser
  refute_output --partial "would run: open"
  refute_output --partial "would run: xdg-open"
}

# ============================================================================
# --skip-admin
# ============================================================================

@test "--skip-admin: opens browser but skips admin creation" {
  seed_fake_repo "$TEST_TMP"
  cd "$TEST_TMP"
  run bash "$SCRIPT" --dry-run --skip-admin
  assert_success
  refute_output --partial "auth/register"
  # Browser still launches (dry-run prints "would run:")
  assert_output --partial "http://localhost:"
}

# ============================================================================
# Admin creation: credentials are printed AND persisted to ~/.wpa-admin-*.txt
# ============================================================================

@test "admin creation (dry-run): prints email and registers intent" {
  seed_fake_repo "$TEST_TMP"
  cd "$TEST_TMP"
  # Override HOME so we don't pollute the real ~/.wpa-admin-*.txt
  HOME="$TEST_TMP/home" mkdir -p "$TEST_TMP/home"
  run env HOME="$TEST_TMP/home" bash "$SCRIPT" --dry-run
  assert_success
  # Default admin email is documented
  assert_output --partial "admin@local.wpa"
  # Would-register message mentions the register endpoint
  assert_output --partial "auth/register"
}

@test "WPA_ADMIN_EMAIL overrides default email" {
  seed_fake_repo "$TEST_TMP"
  cd "$TEST_TMP"
  mkdir -p "$TEST_TMP/home"
  WPA_ADMIN_EMAIL="custom@example.com" run env HOME="$TEST_TMP/home" \
    WPA_ADMIN_EMAIL="custom@example.com" bash "$SCRIPT" --dry-run
  assert_success
  assert_output --partial "custom@example.com"
}

# ============================================================================
# Idempotency: pre-existing healthy stack short-circuits setup
# ============================================================================

@test "idempotent re-run: existing healthy stack on recorded port is reused" {
  seed_fake_repo "$TEST_TMP"
  cd "$TEST_TMP"

  # Pick an ephemeral-ish port that's unlikely to collide with anything else.
  # We bind it first from Python (inside the helper) to keep the test hermetic.
  local healthz_port
  healthz_port="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')"

  # Seed .env with the chosen port so the script believes a stack is running there.
  cat >".env" <<EOF
MASTER_KEY=existingkey
JWT_SECRET=existingsecret
POSTGRES_PASSWORD=existingpg
REDIS_PASSWORD=existingrd
API_PORT=$healthz_port
PUBLIC_ORIGIN=http://localhost:$healthz_port
EOF
  chmod 600 ".env"

  # Stand up a fake healthy server on $healthz_port that answers /healthz with
  # HTTP 200. We write a marker file AFTER the server is actually listening to
  # remove timing flakiness on slow hosts.
  python3 -u -c "
import http.server, socketserver, sys, threading, time

class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/healthz':
            self.send_response(200); self.end_headers(); self.wfile.write(b'ok')
        else:
            self.send_response(404); self.end_headers()
    def log_message(self, *a, **kw): pass

srv = socketserver.TCPServer(('127.0.0.1', $healthz_port), H)
t = threading.Thread(target=srv.serve_forever); t.daemon = True; t.start()
open('$TEST_TMP/server.ready', 'w').write('ready')
time.sleep(10)
srv.shutdown()
" >"$TEST_TMP/server.out" 2>&1 &
  local pid=$!

  # Wait for server to be fully listening. First the ready-marker, then a
  # real HTTP probe so we know curl will succeed when the script runs.
  local ready=0
  for _ in $(seq 1 100); do
    if [ -f "$TEST_TMP/server.ready" ] \
       && curl -sSf -m 1 "http://127.0.0.1:$healthz_port/healthz" >/dev/null 2>&1; then
      ready=1; break
    fi
    sleep 0.1
  done

  run bash "$SCRIPT" --dry-run
  kill "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true

  [ "$ready" = "1" ]  # sanity: the fake server really did bind
  assert_success
  # Stack-up detection message is present
  assert_output --partial "existing stack detected on port $healthz_port"
  # No first-run invocation (would say "missing — running scripts/first-run.sh")
  refute_output --partial "running scripts/first-run.sh"
  # No port selection ladder
  refute_output --partial "selected port"
  refute_output --partial "busy, trying next"
  # No compose up intent
  refute_output --partial "docker compose up"
  # No admin registration
  refute_output --partial "auth/register"
}

# ============================================================================
# Safety: missing MASTER_KEY in .env must fail loudly, not silently proceed
# ============================================================================

@test "missing MASTER_KEY in .env: exits non-zero with a clear message" {
  seed_fake_repo "$TEST_TMP"
  cd "$TEST_TMP"

  # Pre-seed .env WITHOUT a MASTER_KEY value (simulates a partial manual bootstrap).
  # Must not trigger first-run.sh (file exists) AND must not trigger the
  # idempotency detector (nothing listening on 3000).
  cat >".env" <<'EOF'
MASTER_KEY=
JWT_SECRET=existingsecret
POSTGRES_PASSWORD=existingpg
REDIS_PASSWORD=existingrd
API_PORT=3000
PUBLIC_ORIGIN=http://localhost:3000
EOF
  chmod 600 ".env"

  run bash "$SCRIPT" --dry-run --port 3000
  assert_failure
  assert_output --partial "MASTER_KEY"
  # Must mention the remediation so the user isn't stuck
  [[ "$output" == *"first-run.sh"* || "$output" == *"manually"* ]]
}
