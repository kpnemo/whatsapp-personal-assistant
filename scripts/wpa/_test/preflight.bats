#!/usr/bin/env bats
# Tests for scripts/wpa/_lib/preflight.sh

setup() {
  load "bats-helpers/bats-support/load"
  load "bats-helpers/bats-assert/load"
  load "bats-helpers/bats-file/load"

  # Absolute path to the lib under test, derived from this file's location.
  LIB_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/../_lib" && pwd)"

  # Per-test scratch dir — bats-file provides temp_make
  TEST_TMP="$(temp_make)"
}

teardown() {
  temp_del "$TEST_TMP"
}

# ---- require_docker ---------------------------------------------------------

@test "require_docker: succeeds when docker is on PATH and daemon reachable" {
  source "$LIB_DIR/preflight.sh"
  run require_docker
  assert_success
}

@test "require_docker: fails (exit 1) when docker binary is not on PATH" {
  source "$LIB_DIR/preflight.sh"
  # Hide docker by setting PATH to an empty scratch dir
  PATH="$TEST_TMP" run require_docker
  assert_failure 1
  assert_output --partial "docker"
}

# ---- find_free_port --------------------------------------------------------

@test "find_free_port: emits an integer in the ephemeral range" {
  source "$LIB_DIR/preflight.sh"
  run find_free_port
  assert_success
  # Must be a positive integer
  [[ "$output" =~ ^[0-9]+$ ]]
  # Must be above 1024 (non-privileged) and below 65536
  [ "$output" -gt 1024 ]
  [ "$output" -lt 65536 ]
}

# ---- ensure_env_file -------------------------------------------------------

@test "ensure_env_file: copies .env.example to .env when .env is missing" {
  source "$LIB_DIR/preflight.sh"
  cd "$TEST_TMP"
  echo "FOO=bar" > .env.example
  run ensure_env_file .env .env.example
  assert_success
  assert_file_exists .env
  run cat .env
  assert_output "FOO=bar"
}

@test "ensure_env_file: is a no-op when .env already exists" {
  source "$LIB_DIR/preflight.sh"
  cd "$TEST_TMP"
  echo "EXISTING=1" > .env
  echo "TEMPLATE=1" > .env.example
  run ensure_env_file .env .env.example
  assert_success
  run cat .env
  # Original content preserved — not overwritten from the template
  assert_output "EXISTING=1"
}

@test "ensure_env_file: fails when neither target nor template exists" {
  source "$LIB_DIR/preflight.sh"
  cd "$TEST_TMP"
  run ensure_env_file .env .env.example
  assert_failure 1
}

# ---- ensure_master_key_backup ----------------------------------------------

@test "ensure_master_key_backup: returns 2 (fix-available) when backup file is missing" {
  source "$LIB_DIR/preflight.sh"
  cd "$TEST_TMP"
  printf 'MASTER_KEY=abc123\nJWT_SECRET=def456\n' > .env
  run ensure_master_key_backup .env .env.backup
  [ "$status" -eq 2 ]
  assert_output --partial "backup"
}

@test "ensure_master_key_backup: returns 0 when backup matches current key" {
  source "$LIB_DIR/preflight.sh"
  cd "$TEST_TMP"
  printf 'MASTER_KEY=abc123\n' > .env
  printf 'MASTER_KEY=abc123\n' > .env.backup
  run ensure_master_key_backup .env .env.backup
  assert_success
}

@test "ensure_master_key_backup: returns 1 (fail) when backup disagrees with .env" {
  source "$LIB_DIR/preflight.sh"
  cd "$TEST_TMP"
  printf 'MASTER_KEY=current\n' > .env
  printf 'MASTER_KEY=stale\n' > .env.backup
  run ensure_master_key_backup .env .env.backup
  assert_failure 1
  assert_output --partial "mismatch"
}

# ---- wait_for_healthz ------------------------------------------------------

@test "wait_for_healthz: returns 0 when URL responds 200 quickly" {
  source "$LIB_DIR/preflight.sh"
  # Spin up a trivial one-shot HTTP 200 server with nc (bsd nc on macOS).
  # Use a random high port; background it; clean up on teardown.
  port=$(( (RANDOM % 20000) + 30000 ))
  (
    printf 'HTTP/1.0 200 OK\r\nContent-Length: 2\r\n\r\nok' | nc -l "$port" >/dev/null 2>&1
  ) &
  pid=$!
  # Give nc 200ms to bind
  sleep 0.2
  run wait_for_healthz "http://127.0.0.1:${port}/" 5
  kill "$pid" 2>/dev/null || true
  assert_success
}

@test "wait_for_healthz: returns 1 when URL never responds within timeout" {
  source "$LIB_DIR/preflight.sh"
  # Port 1 is reliably closed on all OSes
  run wait_for_healthz "http://127.0.0.1:1/" 1
  assert_failure 1
}

# ---- check_git_clean -------------------------------------------------------

@test "check_git_clean: succeeds in a clean repo" {
  source "$LIB_DIR/preflight.sh"
  cd "$TEST_TMP"
  git init -q
  git config user.email "t@t"
  git config user.name "t"
  echo x > a
  git add a
  git commit -qm init
  run check_git_clean
  assert_success
}

@test "check_git_clean: fails (exit 1) when repo has uncommitted changes" {
  source "$LIB_DIR/preflight.sh"
  cd "$TEST_TMP"
  git init -q
  git config user.email "t@t"
  git config user.name "t"
  echo x > a
  git add a
  git commit -qm init
  echo dirty >> a
  run check_git_clean
  assert_failure 1
  assert_output --partial "uncommitted"
}
