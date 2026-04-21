#!/usr/bin/env bash
# Cross-platform "open a URL in the default browser" helper.
#
# Source-only. Stays silent unless an error occurs; never blocks.

# -----------------------------------------------------------------------------
# open_browser <url>
#   Opens the URL in the user's default browser. No-op on platforms we can't
#   detect (e.g., bare-metal servers with no DISPLAY). Set WPA_BROWSER_DRY_RUN=1
#   to print the command that would be executed without spawning anything —
#   handy for tests and for commands that want to display the URL instead of
#   launching it when running over SSH.
# -----------------------------------------------------------------------------
open_browser() {
  local url="${1:-}"
  if [ -z "$url" ]; then
    echo "open_browser: URL required" >&2
    return 1
  fi

  local opener=""
  case "$(uname -s)" in
    Darwin)
      opener="open"
      ;;
    Linux)
      if command -v xdg-open >/dev/null 2>&1; then
        opener="xdg-open"
      elif command -v gnome-open >/dev/null 2>&1; then
        opener="gnome-open"
      fi
      ;;
    MINGW*|MSYS*|CYGWIN*)
      opener="start"
      ;;
  esac

  if [ -z "$opener" ]; then
    echo "open_browser: no known opener on $(uname -s); URL: $url" >&2
    return 1
  fi

  if [ -n "${WPA_BROWSER_DRY_RUN:-}" ]; then
    printf 'would run: %s %s\n' "$opener" "$url"
    return 0
  fi

  # Don't propagate our stdio — most openers print nothing on success but
  # chatty on Linux. Run detached so we don't block the caller.
  "$opener" "$url" >/dev/null 2>&1 &
  return 0
}
