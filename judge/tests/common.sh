#!/usr/bin/env bash
# Shared output helpers for judge test scripts.
# A test script prints lines like:
#   CHECK PASS "make mr"
#   CHECK FAIL "make raft1" "exit 2"
#   SCORE 3/4
# judge.py parses stdout and scales SCORE to the lab weight.

set -uo pipefail

CHECKS=0
PASSED=0

check() {
  local status="$1" name="$2" detail="${3:-}"
  CHECKS=$((CHECKS + 1))
  if [ "$status" = "PASS" ]; then
    PASSED=$((PASSED + 1))
  fi
  printf 'CHECK %s "%s" "%s"\n' "$status" "$name" "$detail"
}

finish() {
  if [ "$CHECKS" -eq 0 ]; then
    printf 'SCORE 0/1\n'
  else
    printf 'SCORE %d/%d\n' "$PASSED" "$CHECKS"
  fi
}

skip_all() {
  check SKIP "$1" "$2"
  finish
  exit 0
}

quick() {
  [ "${QUICK:-0}" = "1" ]
}
