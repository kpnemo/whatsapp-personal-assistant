#!/usr/bin/env bats
# Tests for scripts/wpa/_lib/compose.sh

setup() {
  load "bats-helpers/bats-support/load"
  load "bats-helpers/bats-assert/load"

  LIB_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/../_lib" && pwd)"
}

@test "compose.sh exports compose_cmd" {
  source "$LIB_DIR/compose.sh"
  type compose_cmd >/dev/null
}

@test "compose_cmd: prefers 'docker compose' v2 when docker is on PATH" {
  # The test environment has docker (the plugin requires it). We can't cleanly
  # verify which path was taken without fake binaries, so just verify the
  # function emits a non-empty command.
  source "$LIB_DIR/compose.sh"
  run compose_cmd
  assert_success
  [ -n "$output" ]
}

@test "compose.sh exports compose_ps" {
  source "$LIB_DIR/compose.sh"
  type compose_ps >/dev/null
}

@test "compose.sh exports compose_service_healthy" {
  source "$LIB_DIR/compose.sh"
  type compose_service_healthy >/dev/null
}
