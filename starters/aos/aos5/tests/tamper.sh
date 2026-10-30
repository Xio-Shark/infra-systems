#!/usr/bin/env bash
# AOS5: tamper detection inside the audit hash chain.
#
# Usage: ./tests/tamper.sh --log FILE [--mode middle|delete|truncate|all]
#
# Modes:
#   middle   改掉中间一条事件的 result —— 必须在第一个坏掉的 seq 处失败
#   delete   删掉中间一条事件 —— 必须在第一个坏掉的 seq 处失败
#   truncate 截断尾部 —— hash chain 本身检测不到；仍然通过才是正确行为
#   all      依次跑前三种
#
# The script works on a copy: the original log is never modified.

set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
source "$here/../common.sh"

AOS_BIN="${AOS_BIN:-./aos5}"
LOG=""
MODE="all"
while [ $# -gt 0 ]; do
  case "$1" in
    --log) LOG="$2"; shift 2 ;;
    --mode) MODE="$2"; shift 2 ;;
    *) fail "未知参数 $1"; summary; exit 0 ;;
  esac
done

[ -n "$LOG" ] && [ -f "$LOG" ] || { skip "tamper: 找不到日志（--log FILE）"; summary; exit 0; }
[ -x "$AOS_BIN" ] || { skip "找不到可执行的 $AOS_BIN（AOS_BIN= 指定）"; summary; exit 0; }
need_cmd python3 "tamper"

lines=$(wc -l <"$LOG" | tr -d ' ')
if [ "$lines" -lt 5 ]; then
  skip "tamper: 日志只有 $lines 行，至少需要 5 条事件才能改中间那条"
  summary; exit 0
fi
mid=$((lines / 2))

verify_log() {
  "$AOS_BIN" audit verify --log "$1" 2>&1
}

case_middle() {
  local copy="$1" out rc bad_seq
  cp "$LOG" "$copy"
  python3 - "$copy" "$mid" <<'PY'
import json, sys
path, idx = sys.argv[1], int(sys.argv[2])
lines = open(path, encoding="utf-8").read().splitlines()
# Re-serialise with a different result value; keep key order so the only
# difference is the tampered field.
ev = json.loads(lines[idx])
ev["result"] = "tampered"
lines[idx] = json.dumps(ev, ensure_ascii=False, separators=(",", ":"))
open(path, "w", encoding="utf-8").write("\n".join(lines) + "\n")
PY
  out=$(verify_log "$copy"); rc=$?
  # The expected seq is the seq field of the line we touched.
  bad_seq=$(python3 -c '
import json,sys
lines=open(sys.argv[1],encoding="utf-8").read().splitlines()
print(json.loads(lines[int(sys.argv[2])]).get("seq",""))
' "$LOG" "$mid")
  if [ "$rc" -eq 0 ]; then
    fail "tamper/middle: 改了一条事件后 verify 仍然通过"
  elif printf '%s' "$out" | grep -q "$bad_seq"; then
    ok "tamper/middle: 定位到 seq=$bad_seq"
  else
    fail "tamper/middle: verify 失败了，但没指出 seq=$bad_seq（输出：$(printf '%s' "$out" | head -1)）"
  fi
}

case_delete() {
  local copy="$1" out rc bad_seq
  cp "$LOG" "$copy"
  bad_seq=$(python3 -c '
import json,sys
lines=open(sys.argv[1],encoding="utf-8").read().splitlines()
print(json.loads(lines[int(sys.argv[2])]).get("seq",""))
' "$LOG" "$mid")
  python3 - "$copy" "$mid" <<'PY'
import sys
path, idx = sys.argv[1], int(sys.argv[2])
lines = open(path, encoding="utf-8").read().splitlines()
del lines[idx]
open(path, "w", encoding="utf-8").write("\n".join(lines) + "\n")
PY
  out=$(verify_log "$copy"); rc=$?
  if [ "$rc" -eq 0 ]; then
    fail "tamper/delete: 删了一条事件后 verify 仍然通过"
  elif printf '%s' "$out" | grep -q "$bad_seq"; then
    ok "tamper/delete: 定位到 seq=$bad_seq"
  else
    fail "tamper/delete: verify 失败了，但没指出 seq=$bad_seq"
  fi
}

case_truncate() {
  local copy="$1" out rc
  cp "$LOG" "$copy"
  head -n $((lines - 1)) "$LOG" >"$copy"
  out=$(verify_log "$copy"); rc=$?
  if [ "$rc" -eq 0 ]; then
    ok "tamper/truncate: 尾部截断未被检测（这是 hash chain 的边界，报告里要写明）"
  else
    # Detecting truncation is *better* than the lab claims; accept it, but say
    # so, because it means the implementation uses an anchor.
    ok "tamper/truncate: 截断被检测到（说明实现用了外部锚点，比任务书要求更强）"
  fi
}

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

case "$MODE" in
  middle)   case_middle "$tmpdir/m.log" ;;
  delete)   case_delete "$tmpdir/d.log" ;;
  truncate) case_truncate "$tmpdir/t.log" ;;
  all)
    case_middle "$tmpdir/m.log"
    case_delete "$tmpdir/d.log"
    case_truncate "$tmpdir/t.log"
    ;;
  *) fail "未知模式 $MODE" ;;
esac

summary
