#!/usr/bin/env bash
# AOS2: rollback produces a tree identical to the target version.
#
# Usage: ./tests/rollback.sh
#
# Two cases:
#   1. rollback before commit  -> staging is discarded, current unchanged
#   2. rollback after commit   -> a NEW generation whose tree equals the target
# In both, the reported tree hash must match a hash computed independently here.

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
  fail "rollback: init 失败"; summary; exit 0; }

printf 'v0\n' >"$ROOT/a.txt"
"$AOS_BIN" commit --ws "$WS" --base 0 --put a.txt="$ROOT/a.txt" >/dev/null 2>&1 || {
  fail "rollback: 基线提交失败"; summary; exit 0; }

v0_tree=$(readlink -f "$WS/current")
v0_hash=$(cd "$v0_tree" && find . -type f ! -name '.manifest' -print0 |
  sort -z | xargs -0 sha256sum | sha256sum | cut -d' ' -f1)

# ---- case 1: rollback before commit ----
printf 'v1\n' >"$ROOT/b.txt"
"$AOS_BIN" begin --ws "$WS" >/dev/null 2>&1
"$AOS_BIN" write --ws "$WS" --put b.txt="$ROOT/b.txt" >/dev/null 2>&1
"$AOS_BIN" rollback --ws "$WS" >/dev/null 2>&1 || fail "rollback(pre): rollback 退出非零"

now=$(readlink -f "$WS/current")
if [ "$now" = "$v0_tree" ]; then
  ok "rollback(pre): current 没变"
else
  fail "rollback(pre): current 变成了 $now，应为 $v0_tree"
fi
if [ -e "$WS/.staging" ] && [ -n "$(ls -A "$WS/.staging" 2>/dev/null)" ]; then
  fail "rollback(pre): .staging 里还有残留文件"
else
  ok "rollback(pre): .staging 已清空"
fi

# ---- case 2: rollback after commit ----
printf 'v2\n' >"$ROOT/c.txt"
"$AOS_BIN" commit --ws "$WS" --base 1 --put c.txt="$ROOT/c.txt" >/dev/null 2>&1 || {
  fail "rollback(post): 第二次提交失败"; summary; exit 0; }

"$AOS_BIN" rollback --ws "$WS" --to 1 >/dev/null 2>&1 ||
  "$AOS_BIN" rollback --ws "$WS" --to "$v0_tree" >/dev/null 2>&1 ||
  { fail "rollback(post): 回滚到版本 1 的命令失败（试过 --to 1 / --to <path>）"; summary; exit 0; }

now_tree=$(readlink -f "$WS/current")
now_hash=$(cd "$now_tree" && find . -type f ! -name '.manifest' -print0 |
  sort -z | xargs -0 sha256sum | sha256sum | cut -d' ' -f1)

expect_eq "rollback(post): 树的 sha256 与目标版本一致" "$now_hash" "$v0_hash"

# History must not be rewritten: the rolled-back-from generation still exists.
if [ "$now_tree" = "$v0_tree" ]; then
  fail "rollback(post): 直接切回了旧目录；任务书要求产生新版本、历史不改写"
else
  ok "rollback(post): 产生了新代而不是复用旧目录"
fi

st=$("$AOS_BIN" status --ws "$WS" 2>/dev/null)
if printf '%s' "$st" | grep -q 'rolled_back_from'; then
  ok "rollback(post): status/manifest 记录了 rolled_back_from"
else
  skip "rollback(post): 没看到 rolled_back_from 字段（任务书要求 manifest 里记）"
fi

summary
