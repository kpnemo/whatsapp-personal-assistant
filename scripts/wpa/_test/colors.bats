#!/usr/bin/env bats
# Tests for scripts/wpa/_lib/colors.sh

setup() {
  load "bats-helpers/bats-support/load"
  load "bats-helpers/bats-assert/load"

  LIB_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/../_lib" && pwd)"
}

@test "colors.sh exports wrapper functions for each named color" {
  source "$LIB_DIR/colors.sh"
  # These should exist after sourcing
  type c_red   >/dev/null
  type c_green >/dev/null
  type c_yellow >/dev/null
  type c_blue  >/dev/null
  type c_bold  >/dev/null
  type c_dim   >/dev/null
  type c_reset >/dev/null
}

@test "c_green prints the message with ANSI codes when NO_COLOR is unset" {
  source "$LIB_DIR/colors.sh"
  unset NO_COLOR
  # Force colored output even when stdout isn't a tty (bats captures it)
  WPA_FORCE_COLOR=1 run c_green "ok"
  assert_success
  # \e[32m green, \e[0m reset
  [[ "$output" == *$'\e[32m'*"ok"*$'\e[0m'* ]]
}

@test "c_green emits plain text when NO_COLOR is set (respects standard)" {
  source "$LIB_DIR/colors.sh"
  NO_COLOR=1 run c_green "ok"
  assert_success
  assert_output "ok"
}

@test "log_info / log_warn / log_error prefix their level" {
  source "$LIB_DIR/colors.sh"
  NO_COLOR=1 run log_info "hello"
  assert_success
  assert_output --partial "INFO"
  assert_output --partial "hello"

  NO_COLOR=1 run log_warn "careful"
  assert_output --partial "WARN"

  NO_COLOR=1 run log_error "boom"
  assert_output --partial "ERROR"
}
