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

# MIT's skeletons mark every spot that needs code with "Your code here".
# Running `make` against an untouched skeleton hangs until the judge timeout
# (20 minutes for lab1), which is a terrible first experience and teaches the
# reader nothing. Fail fast with an actionable message instead.
require_implemented() {
  local dir="$1" label="$2"
  [ -d "$SRC/$dir" ] || return 0
  if grep -rqs "Your code here" "$SRC/$dir"; then
    skip_all "$label 未实现" \
      "$dir 里还有 \"Your code here\" 占位符；先按 $label 页面实现，judge 再跑测试（直接跑会挂到超时）"
  fi
}

# Emit one CHECK per Go test reported by a `make` target, so the score reflects
# how many tests actually pass instead of a single pass/fail for the whole lab.
#
# Usage: run_make_tests <target> [extra make args…]
# CHECK names are "<target>:<TestName>" so that identically named tests in
# different packages (lock1 and kvsrv1 share a few) stay distinguishable.
run_make_tests() {
  local target="$1"
  shift
  local out rc line name status found=0

  out=$(make -C "$SRC" "$@" "$target" 2>&1)
  rc=$?

  while IFS= read -r line; do
    case "$line" in
      "--- PASS: "*|"--- FAIL: "*|"--- SKIP: "*)
        status="${line#--- }"
        status="${status%%:*}"
        name="${line#--- *: }"
        name="${name%% (*}"
        found=1
        case "$status" in
          PASS) check PASS "$target:$name" ;;
          SKIP) check SKIP "$target:$name" "skipped by the test" ;;
          *)    check FAIL "$target:$name" "failed" ;;
        esac
        ;;
    esac
  done <<<"$out"

  if [ "$found" -eq 0 ]; then
    # Build failure, panic before any test ran, or a timeout: the CHECK set is
    # empty, which the judge would report as "no CHECK lines". Make it explicit.
    check FAIL "build ($target)" "make exited $rc; no test results"
    printf '%s\n' "$out" | tail -20 >&2
  fi
}

# Kept for scripts that only need pass/fail of a single command.
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
