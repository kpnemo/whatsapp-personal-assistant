#!/usr/bin/env bash
# Preflight helpers for /wpa:* slash commands.
#
# Exit codes follow a shared convention across all helpers:
#   0 — ok
#   1 — fail (caller should abort)
#   2 — fix available (caller may prompt / auto-remediate, then retry)
#
# This file is meant to be *sourced*, not executed. Each function is
# self-contained — no top-level side effects — so sourcing is cheap.
#
# Target shells: bash 3.2+ (macOS default) and bash 5.x (Linux). Avoid
# bash-4-only features like associative arrays and `readarray -t`.

# -----------------------------------------------------------------------------
# require_docker
#   Verifies `docker` is on PATH and the daemon is reachable.
#   0 = ok, 1 = missing binary or unreachable daemon.
# -----------------------------------------------------------------------------
require_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "docker not found on PATH — install Docker Desktop or the engine." >&2
    return 1
  fi
  if ! docker info >/dev/null 2>&1; then
    echo "docker daemon not reachable — is Docker running?" >&2
    return 1
  fi
  return 0
}

# -----------------------------------------------------------------------------
# find_free_port
#   Prints a free TCP port on 127.0.0.1 in the non-privileged range.
#   Portable across macOS and Linux (no `ss`, uses a python one-liner).
# -----------------------------------------------------------------------------
find_free_port() {
  # Prefer python3 since it ships on macOS (as `python3`) and every Linux distro.
  if command -v python3 >/dev/null 2>&1; then
    python3 -c 'import socket;s=socket.socket();s.bind(("",0));print(s.getsockname()[1]);s.close()'
    return 0
  fi
  # Fallback: try a range of ephemeral ports with bash's /dev/tcp.
  local p
  for p in $(seq 40000 40200); do
    if ! (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null; then
      echo "$p"
      return 0
    fi
    exec 3<&- 3>&- 2>/dev/null || true
  done
  echo "could not find a free port in 40000-40200" >&2
  return 1
}

# -----------------------------------------------------------------------------
# ensure_env_file <target> <template>
#   If <target> is missing, copy <template> to <target>. If both are missing,
#   fail. If <target> exists, leave it alone.
#   0 = ok, 1 = neither exists.
# -----------------------------------------------------------------------------
ensure_env_file() {
  local target="${1:?ensure_env_file: target path required}"
  local template="${2:?ensure_env_file: template path required}"

  if [ -f "$target" ]; then
    return 0
  fi
  if [ ! -f "$template" ]; then
    echo "neither $target nor $template exists — cannot bootstrap env." >&2
    return 1
  fi
  cp "$template" "$target"
  echo "created $target from $template" >&2
  return 0
}

# -----------------------------------------------------------------------------
# ensure_master_key_backup <env_file> <backup_file>
#   Guards against silent master-key loss, which would make all encrypted
#   data unrecoverable.
#     0 = backup exists and matches
#     1 = backup exists but disagrees with current MASTER_KEY (DANGER)
#     2 = backup missing but env has a MASTER_KEY (caller should offer to create one)
# -----------------------------------------------------------------------------
ensure_master_key_backup() {
  local env_file="${1:?ensure_master_key_backup: env file required}"
  local backup_file="${2:?ensure_master_key_backup: backup file required}"

  if [ ! -f "$env_file" ]; then
    echo "$env_file missing — cannot check MASTER_KEY." >&2
    return 1
  fi

  local current
  current="$(grep -E '^MASTER_KEY=' "$env_file" | head -n1 | cut -d= -f2-)"
  if [ -z "$current" ]; then
    echo "$env_file has no MASTER_KEY set — nothing to back up yet." >&2
    return 1
  fi

  if [ ! -f "$backup_file" ]; then
    echo "MASTER_KEY backup missing at $backup_file — create one before starting." >&2
    return 2
  fi

  local backed_up
  backed_up="$(grep -E '^MASTER_KEY=' "$backup_file" | head -n1 | cut -d= -f2-)"
  if [ "$current" != "$backed_up" ]; then
    echo "MASTER_KEY mismatch between $env_file and $backup_file — refusing to proceed." >&2
    return 1
  fi
  return 0
}

# -----------------------------------------------------------------------------
# wait_for_healthz <url> [timeout_seconds]
#   Polls <url> until HTTP 2xx, up to timeout (default 60s).
#   0 = healthy, 1 = timed out.
# -----------------------------------------------------------------------------
wait_for_healthz() {
  local url="${1:?wait_for_healthz: url required}"
  local timeout="${2:-60}"

  local deadline
  deadline=$(( $(date +%s) + timeout ))

  while [ "$(date +%s)" -lt "$deadline" ]; do
    # --max-time caps a single request; keeps us responsive even on short timeouts.
    if curl -fsS --max-time 2 -o /dev/null "$url" 2>/dev/null; then
      return 0
    fi
    sleep 0.5
  done
  echo "$url did not respond healthy within ${timeout}s" >&2
  return 1
}

# -----------------------------------------------------------------------------
# check_git_clean [dir]
#   Verifies the git working tree (current dir or <dir>) has no uncommitted
#   changes or untracked files.
#     0 = clean, 1 = dirty or not a repo.
# -----------------------------------------------------------------------------
check_git_clean() {
  local dir="${1:-.}"
  if ! git -C "$dir" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "$dir is not a git repository" >&2
    return 1
  fi
  if [ -n "$(git -C "$dir" status --porcelain)" ]; then
    echo "git working tree has uncommitted changes or untracked files" >&2
    return 1
  fi
  return 0
}
