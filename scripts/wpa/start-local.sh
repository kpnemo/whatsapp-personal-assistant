#!/usr/bin/env bash
# /wpa:start-local — zero-to-running turnkey local install.
#
# Brings up the full stack on a free port, creates a first-user admin account,
# and opens the dashboard in the default browser. Designed so a clean clone
# reaches a usable dashboard in one command.
#
# Flags:
#   --dry-run       Print the commands that would run; skip Docker/curl/browser.
#   --smoke         Boot the stack and wait healthy, then exit (no admin, no browser).
#   --port N        Use this TCP port on the host instead of auto-detecting.
#   --skip-admin    Skip the admin-registration step (still opens the browser).
#   --help          Print this help and exit 0.
#
# Env overrides:
#   WPA_ADMIN_EMAIL          Default "admin@local.wpa".
#   WPA_BROWSER_DRY_RUN=1    Print the browser command instead of launching.
#   WPA_NO_AUTO_START_DOCKER Skip the "offer to start Docker" remediation.
#
# Exit codes:
#   0 = success (stack up, admin created, browser opened)
#   1 = user-facing failure (docker down, port unavailable, healthz timeout)
#   2 = internal/wrapper error (missing helpers, bad args)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=./_lib/colors.sh
. "$SCRIPT_DIR/_lib/colors.sh"
# shellcheck source=./_lib/preflight.sh
. "$SCRIPT_DIR/_lib/preflight.sh"
# shellcheck source=./_lib/env.sh
. "$SCRIPT_DIR/_lib/env.sh"
# shellcheck source=./_lib/compose.sh
. "$SCRIPT_DIR/_lib/compose.sh"
# shellcheck source=./_lib/browser.sh
. "$SCRIPT_DIR/_lib/browser.sh"

# ---------------------------------------------------------------------------
# Defaults (may be overridden by flags/env)
# ---------------------------------------------------------------------------
DRY_RUN=0
SMOKE=0
SKIP_ADMIN=0
REQUESTED_PORT=""
ADMIN_EMAIL="${WPA_ADMIN_EMAIL:-admin@local.wpa}"
STACK_ALREADY_UP=0

usage() {
  cat <<'USAGE'
Usage: scripts/wpa/start-local.sh [OPTIONS]

Bring up the full WhatsApp Personal Assistant stack locally on a free port,
create a first-user admin account, and open the dashboard.

Options:
  --dry-run        Print commands that would run; skip Docker, HTTP, browser.
  --smoke          Boot the stack, wait healthy, exit (no admin, no browser).
  --port N         Host TCP port to bind (default: auto-detect 3000..3003).
  --skip-admin     Skip admin registration (still opens the browser).
  --help           Show this help.

Env overrides:
  WPA_ADMIN_EMAIL          Default "admin@local.wpa".
  WPA_BROWSER_DRY_RUN=1    Echo the browser command instead of launching.
  WPA_NO_AUTO_START_DOCKER Don't offer to start the Docker daemon.

Examples:
  # Fresh clone, Docker running:
  bash scripts/wpa/start-local.sh

  # Show what it would do:
  bash scripts/wpa/start-local.sh --dry-run

  # Headless smoke test (CI):
  bash scripts/wpa/start-local.sh --smoke
USAGE
}

# ---------------------------------------------------------------------------
# Arg parser
# ---------------------------------------------------------------------------
parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --dry-run)    DRY_RUN=1; shift ;;
      --smoke)      SMOKE=1; shift ;;
      --skip-admin) SKIP_ADMIN=1; shift ;;
      --port)
        REQUESTED_PORT="${2:?--port needs a value}"
        shift 2
        ;;
      --port=*)
        REQUESTED_PORT="${1#--port=}"
        shift
        ;;
      -h|--help)    usage; exit 0 ;;
      *)
        echo "unknown flag: $1" >&2
        usage >&2
        exit 2
        ;;
    esac
  done
}

# ---------------------------------------------------------------------------
# Step 1 — Preflight Docker
# ---------------------------------------------------------------------------
step_preflight_docker() {
  if [ "$DRY_RUN" = "1" ]; then
    log_info "[dry-run] skipping docker preflight"
    return 0
  fi

  if require_docker; then
    return 0
  fi

  # Offer to start Docker automatically (macOS/Linux). Skippable via env for tests.
  if [ -n "${WPA_NO_AUTO_START_DOCKER:-}" ]; then
    log_error "docker daemon not reachable — start Docker and retry."
    exit 1
  fi

  log_warn "docker daemon not reachable — attempting to start it..."
  case "$(uname -s)" in
    Darwin)
      if command -v open >/dev/null 2>&1; then
        open -a Docker || log_warn "open -a Docker failed (is Docker Desktop installed?); will poll for the daemon anyway"
      fi
      ;;
    Linux)
      if command -v systemctl >/dev/null 2>&1; then
        sudo systemctl start docker || log_warn "sudo systemctl start docker failed (need sudo?); will poll for the daemon anyway"
      fi
      ;;
  esac

  # Wait up to 60s for the daemon
  local deadline=$(( $(date +%s) + 60 ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    if docker info >/dev/null 2>&1; then
      log_info "docker is up."
      return 0
    fi
    sleep 2
  done

  log_error "docker daemon did not come up within 60s — please start it manually and retry."
  exit 1
}

# ---------------------------------------------------------------------------
# Step 1b — Detect an already-running healthy stack.
#   Idempotency guard: if .env records an API_PORT and /healthz on that port
#   answers 200, reuse the existing stack instead of bootstrapping a second
#   one on a different port (which would trip admin-registration 409s and
#   stamp a new port over the running one).
# ---------------------------------------------------------------------------
step_detect_existing() {
  STACK_ALREADY_UP=0
  if [ ! -f "$WPA_WORK_DIR/.env" ]; then
    return 0
  fi

  local existing_port
  existing_port="$(read_env_var "$WPA_WORK_DIR/.env" API_PORT 2>/dev/null || true)"
  if [ -z "$existing_port" ]; then
    return 0
  fi

  # Probe the recorded port even in --dry-run — the probe has no side effects,
  # and we need an accurate answer so dry-run output reflects what the real
  # run would do. If no server is listening, curl fails fast and we proceed
  # with the normal setup flow.
  if curl -sSf -m 3 "http://localhost:$existing_port/healthz" >/dev/null 2>&1; then
    API_PORT="$existing_port"
    STACK_ALREADY_UP=1
    log_info "existing stack detected on port $existing_port — reusing (skipping setup steps)"
  fi
  return 0
}

# ---------------------------------------------------------------------------
# Step 2 — Select a port
#   Prefers 3000..3003 in order (matches plan spec). Falls back to
#   find_free_port (ephemeral) if all are busy.
# ---------------------------------------------------------------------------
port_is_free() {
  local p="$1"
  # /dev/tcp is bash built-in; redirect both ends so connect is tested.
  if (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null; then
    exec 3<&- 3>&- 2>/dev/null || true
    return 1
  fi
  return 0
}

step_select_port() {
  if [ -n "$REQUESTED_PORT" ]; then
    API_PORT="$REQUESTED_PORT"
    log_info "using requested port $API_PORT"
    return 0
  fi
  local p
  for p in 3000 3001 3002 3003; do
    if port_is_free "$p"; then
      API_PORT="$p"
      log_info "selected port $API_PORT (free on 127.0.0.1)"
      return 0
    fi
    log_info "port $p busy, trying next..."
  done
  API_PORT="$(find_free_port)"
  log_info "all candidates busy; using ephemeral port $API_PORT"
}

# ---------------------------------------------------------------------------
# Step 3 — Ensure .env exists, with MASTER_KEY backup written.
# ---------------------------------------------------------------------------
step_ensure_env() {
  cd "$WPA_WORK_DIR"
  if [ ! -f .env ]; then
    log_info ".env missing — running scripts/first-run.sh"
    bash scripts/first-run.sh
  fi
  if [ ! -f .env ]; then
    log_error "first-run.sh did not produce a .env — aborting."
    exit 1
  fi

  # MASTER_KEY must be present after first-run (or from the user's pre-seeded
  # .env). Silently proceeding with an empty MASTER_KEY violates CLAUDE.md
  # safety rule #8 — the stack would fail to decrypt at-rest data at runtime
  # but we'd have already wasted the user's time bringing it up.
  local master_key
  master_key="$(read_env_var .env MASTER_KEY)"
  if [ -z "$master_key" ]; then
    log_error "MASTER_KEY is missing from .env; the stack cannot decrypt at-rest data."
    log_error "fix: run 'bash scripts/first-run.sh' to generate one, or set MASTER_KEY manually in .env."
    return 1
  fi

  # Back up MASTER_KEY to the user's home (idempotent; only created on first run).
  local backup="${HOME:-/tmp}/wpa-master-key-$(date +%Y-%m-%d).txt"
  if [ ! -f "$backup" ]; then
    # Scope umask to a subshell so later steps don't inherit 077 file creation.
    ( umask 077 && printf 'MASTER_KEY=%s\n' "$master_key" >"$backup" )
    chmod 600 "$backup"
    log_info "wrote MASTER_KEY backup to $backup (chmod 600)"
  fi
}

# ---------------------------------------------------------------------------
# Step 4 — Stamp port + origin into .env.
# ---------------------------------------------------------------------------
step_stamp_port() {
  cd "$WPA_WORK_DIR"
  write_env_var .env API_PORT "$API_PORT"
  write_env_var .env PUBLIC_ORIGIN "http://localhost:$API_PORT"
  log_info "stamped API_PORT=$API_PORT and PUBLIC_ORIGIN=http://localhost:$API_PORT into .env"
}

# ---------------------------------------------------------------------------
# Step 5 — docker compose up -d --build.
#   The compose file reads ${API_HOST_PORT:-3000} for the host-side port, so
#   we pass it through the environment.
# ---------------------------------------------------------------------------
step_compose_up() {
  cd "$WPA_WORK_DIR"
  export API_HOST_PORT="$API_PORT"
  if [ "$DRY_RUN" = "1" ]; then
    printf 'would run: API_HOST_PORT=%s docker compose up -d --build\n' "$API_PORT"
    return 0
  fi
  local cmd
  cmd="$(compose_cmd)"
  # shellcheck disable=SC2086  # intentional word split on compose_cmd
  $cmd up -d --build
}

# ---------------------------------------------------------------------------
# Step 6 — Wait for healthz.
# ---------------------------------------------------------------------------
step_wait_healthy() {
  local url="http://localhost:$API_PORT/healthz"
  if [ "$DRY_RUN" = "1" ]; then
    printf 'would run: wait_for_healthz %s 90\n' "$url"
    return 0
  fi
  log_info "waiting for $url (up to 90s)..."
  if ! wait_for_healthz "$url" 90; then
    log_error "stack did not become healthy — try: docker compose logs --tail=200 app"
    exit 1
  fi
  log_info "stack is healthy."
}

# ---------------------------------------------------------------------------
# Step 7 — Create admin account via POST /api/auth/register.
#   First user becomes admin automatically (P0 Epic 7 behavior).
# ---------------------------------------------------------------------------
generate_admin_password() {
  # Plan spec: openssl rand -base64 18 | strip non-alnum | cut -c1-24
  openssl rand -base64 18 | tr -d '=+/' | cut -c1-24
}

step_create_admin() {
  if [ "$SKIP_ADMIN" = "1" ] || [ "$SMOKE" = "1" ]; then
    return 0
  fi

  local url="http://localhost:$API_PORT/api/auth/register"
  local pw
  pw="$(generate_admin_password)"

  if [ "$DRY_RUN" = "1" ]; then
    printf 'would run: curl -X POST %s (email=%s)\n' "$url" "$ADMIN_EMAIL"
    return 0
  fi

  log_info "creating admin account at $url"
  local body body_file http_code
  body=$(printf '{"email":"%s","password":"%s"}' "$ADMIN_EMAIL" "$pw")
  body_file="$(mktemp -t wpa-admin-reg.XXXXXX)"
  # -s suppresses progress; -w prints ONLY %{http_code} to stdout. Capture
  # the body in a temp file so stdout is clean.
  http_code="$(curl -sS -o "$body_file" -w '%{http_code}' \
    -X POST "$url" \
    -H 'content-type: application/json' \
    -d "$body" || echo "000")"
  rm -f "$body_file"

  if [ "$http_code" != "201" ]; then
    log_warn "admin registration returned HTTP $http_code — the stack is up, but you'll need to register manually at http://localhost:$API_PORT"
    return 0
  fi

  # Persist creds to home so the user can retrieve them later (matches MASTER_KEY pattern).
  # Scope umask to a subshell so later shell steps don't inherit 077 file creation.
  local creds_file="${HOME:-/tmp}/.wpa-admin-$(date +%Y-%m-%d).txt"
  ( umask 077 && cat >"$creds_file" <<EOF
# WhatsApp Personal Assistant — local admin credentials
# Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
# URL:       http://localhost:$API_PORT

ADMIN_EMAIL=$ADMIN_EMAIL
ADMIN_PASSWORD=$pw
EOF
)
  chmod 600 "$creds_file"

  echo ""
  c_bold "============================================================"
  c_green "  Admin account created."
  echo ""
  echo "  URL:      http://localhost:$API_PORT"
  echo "  Email:    $ADMIN_EMAIL"
  echo "  Password: $pw"
  echo ""
  echo "  Saved to: $creds_file (chmod 600)"
  c_bold "============================================================"
  echo ""
}

# ---------------------------------------------------------------------------
# Step 8 — Open browser.
# ---------------------------------------------------------------------------
step_open_browser() {
  if [ "$SMOKE" = "1" ]; then
    return 0
  fi
  local url="http://localhost:$API_PORT"
  if [ "$DRY_RUN" = "1" ]; then
    # open_browser honors WPA_BROWSER_DRY_RUN=1 which the tests set; but for
    # --dry-run without that env, still force it via subshell.
    WPA_BROWSER_DRY_RUN=1 open_browser "$url"
    return 0
  fi
  log_info "opening $url in your default browser..."
  open_browser "$url"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
  parse_args "$@"

  # Where to operate. Cwd of invocation — matches first-run.sh convention.
  # Tests cd into $TEST_TMP before invoking; real users run from repo root.
  WPA_WORK_DIR="$(pwd)"

  step_preflight_docker
  step_detect_existing

  if [ "$STACK_ALREADY_UP" = "1" ]; then
    # Idempotent re-run: stack is already healthy on $API_PORT. Skip everything
    # that would mutate the running instance (port pick, .env stamp, compose up,
    # admin registration — user already exists, would 409) and go straight to
    # the browser.
    step_open_browser
    if [ "$SMOKE" = "1" ]; then
      log_info "smoke mode: existing stack is up at http://localhost:$API_PORT — exiting."
    elif [ "$DRY_RUN" = "1" ]; then
      log_info "dry-run complete. No side effects performed."
    else
      log_info "already up at http://localhost:$API_PORT — nothing to do."
    fi
    return 0
  fi

  step_select_port
  step_ensure_env
  step_stamp_port
  step_compose_up
  step_wait_healthy
  step_create_admin
  step_open_browser

  if [ "$SMOKE" = "1" ]; then
    log_info "smoke mode: stack is up at http://localhost:$API_PORT — exiting."
  elif [ "$DRY_RUN" = "1" ]; then
    log_info "dry-run complete. No side effects performed."
  fi
}

main "$@"
