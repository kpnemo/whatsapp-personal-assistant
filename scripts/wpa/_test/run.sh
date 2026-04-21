#!/usr/bin/env bash
# Runs all *.bats tests under scripts/wpa/_test/.
# Uses the workspace-local bats installed via pnpm (node_modules/.bin/bats).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
BATS="$REPO_ROOT/node_modules/.bin/bats"

if [ ! -x "$BATS" ]; then
  echo "bats not found at $BATS — run 'pnpm install' first." >&2
  exit 127
fi

# Discover *.bats files next to this script (not recursively — keep layout flat
# for now; we can revisit if per-command test dirs ever appear).
shopt -s nullglob
tests=("$SCRIPT_DIR"/*.bats)
shopt -u nullglob

if [ ${#tests[@]} -eq 0 ]; then
  echo "no .bats files found in $SCRIPT_DIR" >&2
  exit 1
fi

exec "$BATS" --print-output-on-failure "${tests[@]}"
