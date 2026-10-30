#!/usr/bin/env bash
# AOS5: a paused owner must not be able to write after its lease expired.
#
# Usage: ./tests/dual-owner.sh [--ttl 2s] [--pause 3s] [--iterations 20]
#
# Expected summary line from the lab page: all A writes after resume are
# `fenced`, all B writes succeed, and the final file holds B's value. The script
# also prints a time-ordered trace so the report can point at the exact window.
#
# Mechanism being tested: TTL expiry only hands ownership to B on the *server*.
# It cannot stop A from issuing writes after it resumes, so the storage layer
# must reject A by comparing the epoch.

set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
source "$here/../common.sh"

AOS_BIN="${AOS_BIN:-./aos5}"
[ -x "$AOS_BIN" ] || { skip "找不到可执行的 $AOS_BIN（AOS_BIN= 指定）"; summary; exit 0; }

TTL=2s
PAUSE=3s
ITERS=20
while [ $# -gt 0 ]; do
  case "$1" in
    --ttl) TTL="$2"; shift 2 ;;
    --pause) PAUSE="$2"; shift 2 ;;
    --iterations) ITERS="$2"; shift 2 ;;
    *) fail "未知参数 $1"; summary; exit 0 ;;
  esac
done

ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT
RES="$ROOT/resource"
mkdir -p "$RES"
DATA="$RES/data.txt"
printf 'init\n' >"$DATA"
LOG="$ROOT/trace.log"

# A must outlive the lease: run it in the background, stop it, let B take over.
"$AOS_BIN" lease acquire --resource "$RES" --owner A --ttl "$TTL" >"$ROOT/a1.json" 2>&1
epochA=$(json_get "$(cat "$ROOT/a1.json")" epoch)
expect_nonempty "dual-owner: A 拿到 epoch" "$epochA"
[ -n "$epochA" ] || { summary; exit 0; }

# A runs a write loop in the background, recording each result.
(
  i=0
  while [ "$i" -lt "$ITERS" ]; do
    ts=$(date +%s.%N)
    out=$("$AOS_BIN" write --resource "$RES" --epoch "$epochA" --data "A-$i" 2>&1)
    printf '%s A %s %s\n' "$ts" "$i" "$(printf '%s' "$out" | head -1)" >>"$LOG"
    sleep 0.05
    i=$((i + 1))
  done
) &
apid=$!

sleep 0.3
kill -STOP "$apid" 2>/dev/null
state=$(grep '^State:' "/proc/$apid/status" 2>/dev/null | awk '{print $2}')
[ "$state" = "T" ] || skip "dual-owner: A 未能进入 T 状态（state=${state:-?}），暂停不可靠"

# Let the lease expire, then B acquires; its epoch must be greater.
# The pause must be at least the TTL, and the TTL parser below is deliberately
# crude: only the "<N>s" form used in the lab page is supported.
pause_s="${PAUSE%s}"
case "$pause_s" in
  ''|*[!0-9]*) fail "dual-owner: --pause 只支持 \"<N>s\" 形式（收到 $PAUSE）"; summary; exit 0 ;;
esac
sleep "$pause_s"
"$AOS_BIN" lease acquire --resource "$RES" --owner B --ttl 10s >"$ROOT/b1.json" 2>&1
epochB=$(json_get "$(cat "$ROOT/b1.json")" epoch)
if [ -n "$epochB" ] && [ "$epochB" -gt "$epochA" ] 2>/dev/null; then
  ok "dual-owner: B 拿到更大的 epoch（$epochA → $epochB）"
else
  fail "dual-owner: B 的 epoch 没有变大（A=$epochA B=${epochB:-无}）"
fi

# B writes must succeed.
if "$AOS_BIN" write --resource "$RES" --epoch "$epochB" --data "B-wins" >/dev/null 2>&1; then
  ok "dual-owner: B 写成功"
else
  fail "dual-owner: B 写失败"
fi

# Resume A; every write after this point must be fenced.
printf '%s resume\n' "$(date +%s.%N)" >>"$LOG"
kill -CONT "$apid" 2>/dev/null
wait "$apid" 2>/dev/null

resumed=$(grep -c ' resume$' "$LOG" 2>/dev/null || echo 0)
a_ok_after=$(awk '/ resume$/{seen=1; next} seen && $2=="A" && $4=="ok"{n++} END{print n+0}' "$LOG")
a_fenced=$(awk '/ resume$/{seen=1; next} seen && $2=="A" && $4 ~ /fenced|reject|stale/{n++} END{print n+0}' "$LOG")

if [ "$a_ok_after" -eq 0 ]; then
  ok "dual-owner: 恢复后 A 没有一次写成功"
else
  fail "dual-owner: 恢复后 A 成功了 $a_ok_after 次（fencing 没生效）"
fi
[ "$a_fenced" -gt 0 ] && ok "dual-owner: A 的写被 fenced 拒绝（$a_fenced 次）" ||
  skip "dual-owner: 日志里没看到 A 的 fenced（A 可能还没写到下一次就被结束了）"

final=$(cat "$DATA" 2>/dev/null | tr -d '\n')
expect_eq "dual-owner: 最终内容是 B 的值" "$final" "B-wins"

summary
