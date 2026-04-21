#!/usr/bin/env bash
# Lightweight ANSI color + logging helpers for /wpa:* commands.
#
# Respects the NO_COLOR (https://no-color.org/) convention: if the NO_COLOR
# env var is set to a non-empty value, every helper emits plain text.
#
# Also respects TTY detection: non-tty output is plain unless WPA_FORCE_COLOR=1
# (useful for CI logs where colors help humans but break parsers otherwise).
#
# Source-only (no side effects). Safe to source multiple times.

# Return 0 if color should be emitted, 1 otherwise.
_wpa_use_color() {
  if [ -n "${NO_COLOR:-}" ]; then return 1; fi
  if [ -n "${WPA_FORCE_COLOR:-}" ]; then return 0; fi
  [ -t 1 ]
}

# $1 = ANSI sgr code (e.g. 31 for red), $2.. = message
_wpa_wrap() {
  local code="$1"
  shift
  if _wpa_use_color; then
    printf '\e[%sm%s\e[0m\n' "$code" "$*"
  else
    printf '%s\n' "$*"
  fi
}

c_red()    { _wpa_wrap 31 "$@"; }
c_green()  { _wpa_wrap 32 "$@"; }
c_yellow() { _wpa_wrap 33 "$@"; }
c_blue()   { _wpa_wrap 34 "$@"; }
c_bold()   { _wpa_wrap 1  "$@"; }
c_dim()    { _wpa_wrap 2  "$@"; }

# Reset is occasionally useful as a standalone (e.g., after a prompt)
c_reset() {
  if _wpa_use_color; then
    printf '\e[0m'
  fi
}

# Structured loggers — prefix + colored level tag. Always newline-terminated.
log_info() {
  if _wpa_use_color; then
    printf '\e[34mINFO\e[0m  %s\n' "$*"
  else
    printf 'INFO  %s\n' "$*"
  fi
}

log_warn() {
  if _wpa_use_color; then
    printf '\e[33mWARN\e[0m  %s\n' "$*" >&2
  else
    printf 'WARN  %s\n' "$*" >&2
  fi
}

log_error() {
  if _wpa_use_color; then
    printf '\e[31mERROR\e[0m %s\n' "$*" >&2
  else
    printf 'ERROR %s\n' "$*" >&2
  fi
}
