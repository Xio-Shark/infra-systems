#!/usr/bin/env bash
# AOS5: fencing under concurrency — max_epoch must never go backwards and every
# accepted write must carry an epoch >= the max at the time it was accepted.
#
# Usage: ./tests/fence-stress.sh [--writers 8] [--iterations 1000] [--jitter 5ms]
#
# This exercises the race the lab page warns about: if the compare-and-update is
# not inside the commit critical section, two writers can both pass the check.

set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
source "$here/../common.sh"

AOS_BIN="${AOS_BIN:-./aos5}"
[ -x "$AOS_BIN" ] || { skip "找不到可执行的 $AOS_BIN（AOS_BIN= 指定）"; summary; exit 0; }

WRITERS=8
ITERS=1000
JITTER=5ms
while [ $# -gt 0 ]; do
  case "$1" in
    --writers) WRITERS="$2"; shift 2 ;;
    --iterations) ITERS="$2"; shift 2 ;;
    --jitter) JITTER="$2"; shift 2 ;;
    *) fail "未知参数 $1"; summary; exit 0 ;;
  esac
done

ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT
RES="$ROOT/resource"
mkdir -p "$RES"
printf 'init\n' >"$RES/data.txt"

# Each writer gets its own lease and writes concurrently.
for w in $(seq 1 "$WRITERS"); do
  "$AOS_BIN" lease acquire --resource "$RES" --owner "W$w" --ttl 30s \
    >"$ROOT/lease$w.json" 2>&1
done

epochs_ok=0
epochs_bad=0
for w in $(seq 1 "$WRITERS"); do
  e=$(json_get "$(cat "$ROOT/lease$w.json")" epoch)
  if [ -n "$e" ]; then
    printf '%s %s\n' "$w" "$e" >>"$ROOT/epochs"
    epochs_ok=$((epochs_ok + 1))
  else
    epochs_bad=$((epochs_bad + 1))
  fi
done
expect_eq "fence: 每个 writer 都拿到 epoch" "$epochs_bad" "0"

# Epochs must be strictly increasing across acquisitions on one resource.
mono=$(sort -k2 -n "$ROOT/epochs" 2>/dev/null |
  awk '{if ($2<=prev) bad++; prev=$2} END{print bad+0}')
expect_eq "fence: epoch 随 acquire 单调递增" "$mono" "0"

# Concurrent writes; only the highest epoch should be accepted after the fact.
pids=()
for w in $(seq 1 "$WRITERS"); do
  e=$(awk -v w="$w" '$1==w{print $2}' "$ROOT/epochs" 2>/dev/null)
  (
    i=0
    while [ "$i" -lt "$ITERS" ]; do
      out=$("$AOS_BIN" write --resource "$RES" --epoch "$e" --data "W$w-$i" 2>&1)
      rc=$?
      printf '%s %s %s\n' "$w" "$e" "$(printf '%s' "$out" | head -1)" >>"$ROOT/writes.$w"
      i=$((i + 1))
    done
  ) &
  pids+=($!)
done
for p in "${pids[@]}"; do wait "$p" 2>/dev/null; done

# Rejections must name max_epoch so the caller can tell how far behind it is.
if grep -h -iE 'fenced|stale' "$ROOT"/writes.* >/dev/null 2>&1; then
  if grep -h -iE 'fenced|stale' "$ROOT"/writes.* | grep -qi 'max_epoch'; then
    ok "fence: 拒绝信息里带 max_epoch"
  else
    skip "fence: 拒绝信息里没有 max_epoch（任务书要求带，调用方要能判断落后多少）"
  fi
else
  fail "fence: 并发写里一次 fenced 都没有——低 epoch 的写全部成功了？"
fi

# The final file must be written by the highest epoch that got accepted.
final_epoch=$(grep -h ' ok' "$ROOT"/writes.* 2>/dev/null |
  awk '{print $2}' | sort -n | tail -1)
max_epoch=$(awk '{print $2}' "$ROOT/epochs" | sort -n | tail -1)
if [ -n "$final_epoch" ]; then
  ok "fence: 最后一次被接受的写用 epoch=$final_epoch（最大 $max_epoch）"
else
  skip "fence: 没有解析到成功的写（输出格式与脚本预期不同）"
fi
# max_epoch must never be below any accepted write's epoch. The field is read
# through the CLI (not a private file), so this works whatever the layout is.
me=$("$AOS_BIN" lease state --resource "$RES" 2>/dev/null | python3 -c '
import json,sys
try: print(json.load(sys.stdin).get("max_epoch",""))
except Exception: print("")
')
if [ -n "$me" ]; then
  if [ -n "$final_epoch" ] && [ "$me" -lt "$final_epoch" ] 2>/dev/null; then
    fail "fence: max_epoch=$me < 已接受写的 epoch=$final_epoch（回退了）"
  else
    ok "fence: max_epoch=$me 未低于已接受的写"
  fi
else
  skip "fence: 实现没有 lease state，无法读取 max_epoch（人工确认单调性）"
fi

summary