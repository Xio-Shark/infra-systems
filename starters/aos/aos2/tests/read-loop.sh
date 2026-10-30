#!/usr/bin/env bash
# AOS2: readers never observe a torn or mixed generation.
#
# Usage: ./tests/read-loop.sh [--files N] [--iters N]
#
# The reader resolves `current` exactly once per iteration and then reads every
# file through that directory, so a correct implementation never shows a mix of
# two generations. Re-resolving `current` per file would show mixed generations
# even on a correct implementation — that is why the test resolves only once.

set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
source "$here/../common.sh"

AOS_BIN="${AOS_BIN:-./aos2}"
[ -x "$AOS_BIN" ] || { skip "找不到可执行的 $AOS_BIN（AOS_BIN= 指定）"; summary; exit 0; }

FILES=100
ITERS=200
while [ $# -gt 0 ]; do
  case "$1" in
    --files) FILES="$2"; shift 2 ;;
    --iters) ITERS="$2"; shift 2 ;;
    *) fail "未知参数 $1"; summary; exit 0 ;;
  esac
done

ROOT="$(mktemp -d)"
WS="$ROOT/ws"
trap 'rm -rf "$ROOT"' EXIT
mkdir -p "$WS"

"$AOS_BIN" init --ws "$WS" >/dev/null 2>&1 || {
  fail "read-loop: init 失败"; summary; exit 0
}

# Put-args for one generation: --put f1.txt=<path> --put f2.txt=<path> …
put_args() {
  local gen="$1" dir="$2" i
  for i in $(seq 1 "$FILES"); do
    printf 'gen=%s\n' "$gen" >"$dir/f$i.txt"
    printf -- '--put f%s.txt=%s ' "$i" "$dir/f$i.txt"
  done
}

seed_dir="$ROOT/seed"
mkdir -p "$seed_dir"
# shellcheck disable=SC2046
"$AOS_BIN" commit --ws "$WS" --base 0 $(put_args 0 "$seed_dir") >/dev/null 2>&1 || {
  fail "read-loop: 初始提交失败（命令：aos2 commit --ws WS --base 0 --put …）"
  summary
  exit 0
}

# Writer: keep committing new generations until the reader is done.
touch "$ROOT/running"
(
  gen=1
  while [ -f "$ROOT/running" ]; do
    d="$ROOT/stage$gen"
    mkdir -p "$d"
    # shellcheck disable=SC2046
    "$AOS_BIN" commit --ws "$WS" --base "$((gen - 1))" $(put_args "$gen" "$d") \
      >/dev/null 2>&1 || break
    rm -rf "$d"
    gen=$((gen + 1))
  done
) &
writer=$!

torn=0
mixed=0
samples=0
for _ in $(seq 1 "$ITERS"); do
  # Resolve `current` exactly once, then read every file from the concrete
  # generation directory. Re-reading through "$WS/current" would re-resolve the
  # symlink on every open and mix generations even on a correct implementation.
  dir=$(readlink -f "$WS/current" 2>/dev/null)
  [ -n "$dir" ] && [ -d "$dir" ] || continue
  samples=$((samples + 1))
  gens=""
  for i in $(seq 1 "$FILES"); do
    line=$(head -1 "$dir/f$i.txt" 2>/dev/null)
    case "$line" in
      gen=*) gens="$gens $line" ;;
      *)     torn=$((torn + 1)) ;;
    esac
  done
  uniq_gens=$(printf '%s\n' $gens | sort -u | wc -l | tr -d ' ')
  [ "$uniq_gens" -le 1 ] || mixed=$((mixed + 1))
done

rm -f "$ROOT/running"
wait "$writer" 2>/dev/null

if [ "$samples" -eq 0 ]; then
  fail "read-loop: 一次都没读到 current（commit 是否真的发布了版本？）"
fi
expect_eq "read-loop: torn（读到半行/缺失）" "$torn" "0"
expect_eq "read-loop: mixed（同一次读跨两代）" "$mixed" "0"
summary
