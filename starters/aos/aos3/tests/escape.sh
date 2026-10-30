#!/usr/bin/env bash
# AOS3: the escape matrix. Every case must be denied by the kernel.
#
# Usage:
#   ./tests/escape.sh --all
#   ./tests/escape.sh --cases dotdot,abs,symlink,magic
#   ./tests/escape.sh --case fchdir
#
# Each case runs ./testdata/escape/<case> with the capability directory fd on
# fd 3, and requires the tool's single stdout line to start with DENIED.
# ESCAPED is a failure; ERROR is a failure too (it means the sandbox produced
# neither a denial nor an escape, usually a broken filter rather than a missing
# capability).

set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
source "$here/../common.sh"

ESCAPE_BIN="${AOS_ESCAPE:-./testdata/escape}"
[ -x "$ESCAPE_BIN" ] || {
  skip "escape: 没有 $ESCAPE_BIN（AOS_ESCAPE= 指定；先 go build -o testdata/escape ./testdata/escape）"
  summary; exit 0
}

CASES=()
MODE=all
while [ $# -gt 0 ]; do
  case "$1" in
    --all) MODE=all; shift ;;
    --case) MODE=case; CASES+=("$2"); shift 2 ;;
    --cases) MODE=case; IFS=, read -r -a CASES <<<"$2"; shift 2 ;;
    *) fail "未知参数 $1"; summary; exit 0 ;;
  esac
done

if [ "$MODE" = all ]; then
  CASES=(dotdot abs symlink magic procfd fchdir chroot bind handle ptrace processvm uring leak)
fi

ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT

# A capability directory that the tool can legitimately open, plus a symlink
# that points out of it and a sibling directory it must not reach.
CAP="$ROOT/cap"
SIB="$ROOT/sibling"
mkdir -p "$CAP/inner" "$SIB"
printf 'inside\n' >"$CAP/inner/ok.txt"
printf 'sibling\n' >"$SIB/secret.txt"
ln -sfn "$SIB/secret.txt" "$CAP/link"

denied=0
escaped=0
errors=0

for c in "${CASES[@]}"; do
  [ -x "$ESCAPE_BIN" ] || { fail "$c: 可执行文件消失"; continue; }
  out=$("$ESCAPE_BIN" "$c" 3<"$CAP" 2>"$ROOT/err"); rc=$?
  line=$(printf '%s' "$out" | head -1)
  case "$line" in
    DENIED*)
      denied=$((denied + 1))
      ok "$c: $line"
      ;;
    ESCAPED*)
      escaped=$((escaped + 1))
      fail "$c: ESCAPED — $line"
      ;;
    SKIP*)
      skip "$c: ${line#SKIP }"
      ;;
    *)
      errors=$((errors + 1))
      fail "$c: 既不是 DENIED 也不是 ESCAPED（exit $rc, out='$line'）"
      ;;
  esac
done

printf 'summary denied=%d escaped=%d errors=%d\n' "$denied" "$escaped" "$errors"
[ "$escaped" -eq 0 ] || { fail "有 $escaped 个用例逃逸"; summary; }
[ "$errors" -eq 0 ] || { fail "有 $errors 个用例结果不可判定"; summary; }
summary
