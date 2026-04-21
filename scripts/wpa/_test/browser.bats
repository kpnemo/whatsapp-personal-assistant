#!/usr/bin/env bats
# Tests for scripts/wpa/_lib/browser.sh

setup() {
  load "bats-helpers/bats-support/load"
  load "bats-helpers/bats-assert/load"

  LIB_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/../_lib" && pwd)"
}

@test "browser.sh exports open_browser" {
  source "$LIB_DIR/browser.sh"
  type open_browser >/dev/null
}

@test "open_browser: dry-run mode prints the command but does not spawn" {
  source "$LIB_DIR/browser.sh"
  WPA_BROWSER_DRY_RUN=1 run open_browser "https://example.com"
  assert_success
  assert_output --partial "https://example.com"
}

@test "open_browser: fails when no URL is provided" {
  source "$LIB_DIR/browser.sh"
  WPA_BROWSER_DRY_RUN=1 run open_browser
  assert_failure
}
