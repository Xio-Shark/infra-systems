#!/usr/bin/env bash

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$here/../common.sh"

LAB_ROOT="${LAB_ROOT:-$HOME/labs/6.5840}"
SRC="$LAB_ROOT/src"

require_repo() {
  if [ ! -d "$SRC" ]; then
    skip_all "6.5840 repo" "not found at $SRC; set LAB_ROOT to your checkout"
  fi
}

run_check() {
  local name="$1"
  shift
  local out rc
  out=$("$@" 2>&1)
  rc=$?
  if [ "$rc" -eq 0 ]; then
    check PASS "$name"
  else
    check FAIL "$name" "exit $rc"
    printf '%s\n' "$out" | tail -15 >&2
  fi
}
