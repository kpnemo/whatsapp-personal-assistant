#!/usr/bin/env bash
# .env file and secret generation helpers.
#
# Source-only. No side effects at load time.

# -----------------------------------------------------------------------------
# generate_random_secret [bytes]
#   Emits a random hex string. Default is 32 bytes (64 hex chars), which
#   satisfies @wpa/shared env.ts's JWT_SECRET.min(32).
# -----------------------------------------------------------------------------
generate_random_secret() {
  local bytes="${1:-32}"
  # `openssl rand -hex N` is the most portable: BoringSSL/LibreSSL both support it.
  openssl rand -hex "$bytes"
}

# -----------------------------------------------------------------------------
# generate_master_key
#   Emits a base64-encoded 32-byte value. Matches @wpa/shared's MASTER_KEY
#   validation (must decode to exactly 32 bytes).
# -----------------------------------------------------------------------------
generate_master_key() {
  # `openssl rand -base64 32` is 44 chars with `=` padding — exactly what we want.
  openssl rand -base64 32
}

# -----------------------------------------------------------------------------
# read_env_var <env_file> <key>
#   Prints the raw value of KEY= in <env_file>. Empty string if the key is
#   absent. Handles values that contain '=' by splitting on the FIRST '='.
#   Does NOT do quoting/escaping — callers that need shell-safe values should
#   run the output through their own escaping.
# -----------------------------------------------------------------------------
read_env_var() {
  local env_file="${1:?read_env_var: env file required}"
  local key="${2:?read_env_var: key required}"
  if [ ! -f "$env_file" ]; then
    return 0
  fi
  # grep ^KEY= — -m1 stops at the first match (portable: BSD and GNU).
  local line
  line="$(grep -m1 "^${key}=" "$env_file" 2>/dev/null || true)"
  if [ -z "$line" ]; then
    return 0
  fi
  # Strip the KEY= prefix. Using parameter expansion keeps everything after
  # the first '=', including later '=' characters (e.g. URLs with query strings).
  printf '%s' "${line#${key}=}"
}

# -----------------------------------------------------------------------------
# write_env_var <env_file> <key> <value>
#   Sets KEY=VALUE in <env_file>. If the key already exists, replaces the line
#   in place. Otherwise appends. Creates the file if missing.
#
#   Does NOT perform shell-quoting — callers responsible for pre-escaping
#   values that contain newlines or backslashes. For typical secret formats
#   (hex, base64) this is safe.
# -----------------------------------------------------------------------------
write_env_var() {
  local env_file="${1:?write_env_var: env file required}"
  local key="${2:?write_env_var: key required}"
  local value="${3-}"

  # Ensure file exists
  if [ ! -f "$env_file" ]; then
    : > "$env_file"
  fi

  if grep -q "^${key}=" "$env_file" 2>/dev/null; then
    # Portable in-place edit: write to temp, then mv. Avoids sed -i portability
    # headaches between macOS (BSD sed) and Linux (GNU sed).
    local tmp
    tmp="$(mktemp)"
    # Use awk so the replacement value is treated as a literal (no regex metachars).
    awk -v k="$key" -v v="$value" '
      BEGIN { FS = OFS = "=" }
      $1 == k { print k "=" v; next }
      { print }
    ' "$env_file" > "$tmp"
    mv "$tmp" "$env_file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$env_file"
  fi
}
