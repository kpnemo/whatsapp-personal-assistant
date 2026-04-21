#!/usr/bin/env bats
# Tests for scripts/wpa/_lib/env.sh

setup() {
  load "bats-helpers/bats-support/load"
  load "bats-helpers/bats-assert/load"
  load "bats-helpers/bats-file/load"

  LIB_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/../_lib" && pwd)"
  TEST_TMP="$(temp_make)"
}

teardown() {
  temp_del "$TEST_TMP"
}

# ---- generate_random_secret ------------------------------------------------

@test "generate_random_secret: emits a 64-char hex string by default" {
  source "$LIB_DIR/env.sh"
  run generate_random_secret
  assert_success
  [[ "$output" =~ ^[0-9a-f]{64}$ ]]
}

@test "generate_random_secret: respects requested byte count" {
  source "$LIB_DIR/env.sh"
  run generate_random_secret 16
  assert_success
  # 16 bytes = 32 hex chars
  [[ "$output" =~ ^[0-9a-f]{32}$ ]]
}

# ---- generate_master_key ---------------------------------------------------

@test "generate_master_key: emits a base64 value that decodes to 32 bytes" {
  source "$LIB_DIR/env.sh"
  run generate_master_key
  assert_success
  # Base64 of 32 bytes is 44 chars ending in '='
  [ "${#output}" -ge 43 ]
  [ "${#output}" -le 44 ]
  # Confirm the roundtrip matches length 32
  local len
  len="$(printf '%s' "$output" | base64 -d 2>/dev/null | wc -c | tr -d ' ')"
  [ "$len" -eq 32 ]
}

# ---- read_env_var ----------------------------------------------------------

@test "read_env_var: returns the value for a defined key" {
  source "$LIB_DIR/env.sh"
  cd "$TEST_TMP"
  printf 'FOO=bar\nBAZ=qux\n' > .env
  run read_env_var .env FOO
  assert_success
  assert_output "bar"
}

@test "read_env_var: returns empty string when key is missing" {
  source "$LIB_DIR/env.sh"
  cd "$TEST_TMP"
  printf 'FOO=bar\n' > .env
  run read_env_var .env MISSING
  assert_success
  assert_output ""
}

@test "read_env_var: handles values with = in them" {
  source "$LIB_DIR/env.sh"
  cd "$TEST_TMP"
  printf 'URL=postgres://u:p@h:5432/db?x=y\n' > .env
  run read_env_var .env URL
  assert_success
  assert_output "postgres://u:p@h:5432/db?x=y"
}

# ---- write_env_var ---------------------------------------------------------

@test "write_env_var: appends a new key" {
  source "$LIB_DIR/env.sh"
  cd "$TEST_TMP"
  printf 'EXISTING=1\n' > .env
  run write_env_var .env NEW new_value
  assert_success
  run grep -c '^NEW=new_value$' .env
  assert_output "1"
}

@test "write_env_var: updates an existing key in place (no duplicate)" {
  source "$LIB_DIR/env.sh"
  cd "$TEST_TMP"
  printf 'FOO=old\nBAR=keep\n' > .env
  run write_env_var .env FOO new
  assert_success
  run grep -c '^FOO=' .env
  assert_output "1"
  run grep '^FOO=' .env
  assert_output "FOO=new"
  # Unrelated key untouched
  run grep '^BAR=' .env
  assert_output "BAR=keep"
}
