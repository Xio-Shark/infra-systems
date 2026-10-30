#!/usr/bin/env bash
# AOS2: two writers on the same base — exactly one wins, none is lost silently.
#
# Usage: ./tests/conflict.sh
#
# Expected output contract from the lab page: ok=1 conflict=1 lost_update=0.
# "lost_update=0" means the loser did not overwrite the winner's file.

set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
source "$here/../common.sh"

AOS_BIN="${AOS_BIN:-./aos2}"
[ -x "$AOS_BIN" ] || { skip "找不到可执行的 $AOS_BIN（AOS_BIN= 指定）"; summary; exit 0; }

ROOT="$(mktemp -d)"
WS="$ROOT/ws"
trap 'rm -rf "$ROOT"' EXIT
mkdir -p "$WS"

"$AOS_BIN" init --ws "$WS" >/dev/null 2>&1 || {
  fail "conflict: init 失败"; summary; exit 0; }
printf 'base\n' >"$ROOT/base.txt"
"$AOS_BIN" commit --ws "$WS" --base 0 --put base.txt="$ROOT/base.txt" >/dev/null 2>&1 || {
  fail "conflict: 基线提交失败"; summary; exit 0; }

# Two writers, same base, different payloads, launched together.
printf 'from-A\n' >"$ROOT/a.txt"
printf 'from-B\n' >"$ROOT/b.txt"

"$AOS_BIN" commit --ws "$WS" --base 1 --put x.txt="$ROOT/a.txt" \
  >"$ROOT/outA" 2>&1 &
pa=$!
"$AOS_BIN" commit --ws "$WS" --base 1 --put x.txt="$ROOT/b.txt" \
  >"$ROOT/outB" 2>&1 &
pb=$!
wait "$pa"; rcA=$?
wait "$pb"; rcB=$?

okc=0
conflict=0
[ "$rcA" -eq 0 ] && okc=$((okc + 1)) || conflict=$((conflict + 1))
[ "$rcB" -eq 0 ] && okc=$((okc + 1)) || conflict=$((conflict + 1))

expect_eq "conflict: 成功数" "$okc" "1"
expect_eq "conflict: 冲突数" "$conflict" "1"

# The rejection must be a conflict, not an arbitrary error.
loser_out=$([ "$rcA" -ne 0 ] && cat "$ROOT/outA" || cat "$ROOT/outB")
if printf '%s' "$loser_out" | grep -qiE 'conflict|stale|E_STALE_BASE'; then
  ok "conflict: 失败方报的是 conflict/stale"
else
  fail "conflict: 失败方没有报 conflict（输出：$(printf '%s' "$loser_out" | head -1)）"
fi

# No lost update: the committed file must equal exactly one writer's payload.
cur=$(readlink -f "$WS/current")
got=$(cat "$cur/x.txt" 2>/dev/null)
winner=$([ "$rcA" -eq 0 ] && cat "$ROOT/a.txt" || cat "$ROOT/b.txt")
expect_eq "conflict: 最终内容是赢家的写（lost_update=0）" "$got" "$winner"

summary
