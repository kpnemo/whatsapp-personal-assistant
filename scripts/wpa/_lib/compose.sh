#!/usr/bin/env bash
# docker compose helpers — abstract over v2 ('docker compose') vs legacy
# ('docker-compose') and expose a few common queries the /wpa:* commands use.
#
# Source-only. Each function shells out on call; no cached state.

# -----------------------------------------------------------------------------
# compose_cmd
#   Prints the compose command to invoke. Prefers `docker compose` (v2),
#   falls back to `docker-compose` (v1, legacy). Exits non-zero if neither
#   exists so callers can fail fast.
# -----------------------------------------------------------------------------
compose_cmd() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    printf 'docker compose'
    return 0
  fi
  if command -v docker-compose >/dev/null 2>&1; then
    printf 'docker-compose'
    return 0
  fi
  echo "no docker compose available (tried 'docker compose' and 'docker-compose')" >&2
  return 1
}

# -----------------------------------------------------------------------------
# compose_ps [compose_file]
#   Prints `ps --format json` output for the compose project. Callers pipe
#   into jq for structured checks. Uses --project-directory if compose_file
#   is outside the cwd.
# -----------------------------------------------------------------------------
compose_ps() {
  local compose_file="${1:-docker-compose.yml}"
  local cmd
  cmd="$(compose_cmd)" || return 1
  # shellcheck disable=SC2086  # intentional word split on compose_cmd
  $cmd -f "$compose_file" ps --format json
}

# -----------------------------------------------------------------------------
# compose_service_healthy <service> [compose_file]
#   Returns 0 if the named service is running AND (if it has a healthcheck)
#   reports healthy. Returns 1 otherwise.
# -----------------------------------------------------------------------------
compose_service_healthy() {
  local service="${1:?compose_service_healthy: service name required}"
  local compose_file="${2:-docker-compose.yml}"
  local cmd
  cmd="$(compose_cmd)" || return 1

  # `inspect --format` uses Go templates; the Health struct is nil for services
  # without a healthcheck, so we fall back to State.Status == "running".
  local container_id
  # shellcheck disable=SC2086
  container_id="$($cmd -f "$compose_file" ps -q "$service" 2>/dev/null | head -n1)"
  if [ -z "$container_id" ]; then
    return 1
  fi

  local status health
  status="$(docker inspect --format '{{.State.Status}}' "$container_id" 2>/dev/null || true)"
  health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$container_id" 2>/dev/null || true)"

  if [ "$status" != "running" ]; then
    return 1
  fi
  # If there's a healthcheck, require "healthy". Otherwise "running" is enough.
  if [ -n "$health" ] && [ "$health" != "healthy" ]; then
    return 1
  fi
  return 0
}
