#!/usr/bin/env bash
# Shared helpers for the INFRA 03 contract tests.
#
# Every test script sources this file. It keeps the assertions honest: a check
# only passes when the *submission* produced the expected observable, never
# because the script itself succeeded at something unrelated.

set -uo pipefail

OK=0
FAIL=0
SKIP=0
CASE=""

ok() {
  OK=$((OK + 1))
  printf 'OK   %s\n' "$*"
}

fail() {
  FAIL=$((FAIL + 1))
  printf 'FAIL %s\n' "$*"
}

skip() {
  SKIP=$((SKIP + 1))
  printf 'SKIP %s\n' "$*"
}

summary() {
  printf 'summary ok=%d fail=%d skip=%d\n' "$OK" "$FAIL" "$SKIP"
  [ "$FAIL" -eq 0 ] || exit 1
}

need_root() {
  if [ "$(id -u)" -ne 0 ]; then
    skip "$1: 需要 root"
    summary
    exit 0
  fi
}

# need_cmd <name> <why>
need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    skip "$2: 缺少 $1"
    summary
    exit 0
  }
}

# json_get <json> <dotted.path> — print a scalar from JSON, empty if absent.
json_get() {
  printf '%s' "$1" | python3 -c '
import json,sys
path=sys.argv[1].split(".")
try:
    v=json.load(sys.stdin)
except Exception:
    print(""); raise SystemExit(0)
for p in path:
    if isinstance(v,list):
        try: v=v[int(p)]
        except Exception: print(""); raise SystemExit(0)
    elif isinstance(v,dict):
        v=v.get(p)
    else:
        print(""); raise SystemExit(0)
    if v is None:
        print(""); raise SystemExit(0)
print(v if not isinstance(v,(dict,list)) else json.dumps(v,ensure_ascii=False))
' "$2"
}

# expect_eq <label> <actual> <expected>
expect_eq() {
  if [ "$2" = "$3" ]; then
    ok "$1 ($2)"
  else
    fail "$1: got '$2', want '$3'"
  fi
}

# expect_true <label> <condition-result>
expect_true() {
  if [ "$2" = "0" ]; then
    ok "$1"
  else
    fail "$1"
  fi
}

# expect_nonempty <label> <value>
expect_nonempty() {
  if [ -n "$2" ]; then
    ok "$1 ($2)"
  else
    fail "$1: 空值"
  fi
}
