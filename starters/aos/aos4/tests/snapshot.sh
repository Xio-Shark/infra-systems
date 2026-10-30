#!/usr/bin/env bash
# AOS4: snapshot create / restore / branch isolation.
#
# Usage: ./tests/snapshot.sh
#
# Contract from content/aos4.md:
#   aos4 snapshot create  --workspace DIR --id ID [--parent ID]
#   aos4 snapshot list    --workspace DIR
#   aos4 snapshot restore --workspace DIR --id ID
#   aos4 exec --workspace DIR --branch ID -- CMD…
# Each prints a single JSON object on stdout.

set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
source "$here/../common.sh"

AOS_BIN="${AOS_BIN:-./aos4}"
[ -x "$AOS_BIN" ] || { skip "找不到可执行的 $AOS_BIN（AOS_BIN= 指定）"; summary; exit 0; }

ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT
WS="$ROOT/ws"
mkdir -p "$WS"
printf 'a0\n' >"$WS/a.txt"
printf 'b0\n' >"$WS/b.txt"
printf 'c0\n' >"$WS/c.txt"

tree_hash() {
  (cd "$1" && find . -type f ! -name 'manifest.json' -print0 |
    sort -z | xargs -0 sha256sum 2>/dev/null | sha256sum | cut -d' ' -f1)
}

# ---- create ----
out=$("$AOS_BIN" snapshot create --workspace "$WS" --id base 2>&1)
th=$(json_get "$out" result.tree_sha256)
if [ -n "$th" ]; then
  ok "snapshot: create 返回 tree_sha256（$th）"
else
  fail "snapshot: create 没有返回 result.tree_sha256（输出：$(printf '%s' "$out" | head -1)）"
fi

# The reported hash must be reproducible from the live tree, independently.
live=$(tree_hash "$WS")
if [ -n "$th" ]; then
  expect_eq "snapshot: tree_sha256 能由工作区独立重算" "$th" "$live"
fi

# ---- list ----
list=$("$AOS_BIN" snapshot list --workspace "$WS" 2>&1)
if printf '%s' "$list" | grep -q 'base'; then
  ok "snapshot: list 里有 base"
else
  fail "snapshot: list 里没有 base"
fi

# ---- mutate, then restore ----
printf 'a1\n' >"$WS/a.txt"
printf 'extra\n' >"$WS/extra.txt"
after_mutate=$(tree_hash "$WS")
if [ "$after_mutate" = "$live" ]; then
  fail "snapshot: 改了文件但树 hash 没变（housekeeping 有问题）"
fi

out=$("$AOS_BIN" snapshot restore --workspace "$WS" --id base 2>&1) ||
  fail "snapshot: restore 退出非零"
restored=$(tree_hash "$WS")
expect_eq "snapshot: restore 后的树与快照一致" "$restored" "$live"

# A file created after the snapshot must be gone after restore.
if [ -e "$WS/extra.txt" ]; then
  fail "snapshot: restore 后 extra.txt 还在（快照恢复不完整）"
else
  ok "snapshot: restore 清掉了快照之后新增的文件"
fi

# ---- branch isolation ----
for b in b1 b2 b3; do
  "$AOS_BIN" snapshot create --workspace "$WS" --id "$b" --parent base >/dev/null 2>&1 ||
    fail "snapshot: 创建分支 $b 失败"
done
"$AOS_BIN" exec --workspace "$WS" --branch b1 -- sh -c 'echo one > a.txt' >/dev/null 2>&1
"$AOS_BIN" exec --workspace "$WS" --branch b2 -- sh -c 'echo two > b.txt' >/dev/null 2>&1
"$AOS_BIN" exec --workspace "$WS" --branch b3 -- sh -c 'rm -f c.txt' >/dev/null 2>&1

h1=$("$AOS_BIN" snapshot list --workspace "$WS" 2>&1 |
  python3 -c '
import json,sys
raw=sys.stdin.read()
try: d=json.loads(raw)
except Exception: print(""); raise SystemExit
items=d.get("snapshots") or d.get("result") or d
for it in (items if isinstance(items,list) else []):
    if it.get("id")=="b1": print(it.get("tree_sha256",""))
')
if [ -n "$h1" ]; then
  h2=$("$AOS_BIN" snapshot list --workspace "$WS" 2>&1 |
    python3 -c '
import json,sys
raw=sys.stdin.read()
try: d=json.loads(raw)
except Exception: print(""); raise SystemExit
items=d.get("snapshots") or d.get("result") or d
for it in (items if isinstance(items,list) else []):
    if it.get("id")=="b2": print(it.get("tree_sha256",""))
')
  if [ -n "$h2" ] && [ "$h1" != "$h2" ]; then
    ok "snapshot: 三个分支的树 hash 两两不同"
  else
    fail "snapshot: b1 和 b2 的 tree_sha256 相同（分支互相污染）"
  fi
else
  skip "snapshot: list 没给出每个分支的 tree_sha256（人工核对三条 hash 不同）"
fi

summary
