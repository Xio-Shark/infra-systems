#!/usr/bin/env bash
# AOS3: revocation semantics — the broker path closes immediately, but an
# already-transferred fd keeps working. Both facts must be reported honestly.
#
# Usage: ./tests/revoke.sh
#
# Expected summary line from the lab page: broker_denied=1 fd_still_reads=1 killed=1
#
# The fd case is deliberately stated as a negative result: POSIX says a dup'd or
# passed fd keeps the file alive, so a capability system cannot revoke it. The
# correct behaviour is to record it and kill the holder, not to pretend the
# revocation covered it.

set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
source "$here/../common.sh"

AOS_BIN="${AOS_BIN:-./aos3}"
[ -x "$AOS_BIN" ] || { skip "找不到可执行的 $AOS_BIN（AOS_BIN= 指定）"; summary; exit 0; }

ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT
WS="$ROOT/ws"
mkdir -p "$WS"
printf 'secret\n' >"$WS/f.txt"

# ---- 1. broker path: revoke must apply to the next call, not eventually ----
out=$("$AOS_BIN" cap grant --subject agent-1 --path "$WS" --rights read --ttl 10m 2>&1)
cap=$(json_get "$out" cap_id)
if [ -z "$cap" ]; then
  fail "revoke: grant 失败，无法继续：$(printf '%s' "$out" | head -1)"
  summary; exit 0
fi

# ---- 2. fd path: hand a real fd to a long-running holder ----
holder_pid=""
fd_out=$("$AOS_BIN" open --cap "$cap" --path "$WS/f.txt" --hold 5s 2>&1 &
  echo $!)
holder_pid=$(printf '%s' "$fd_out" | tail -1)
sleep 1

"$AOS_BIN" cap revoke --cap "$cap" >/dev/null 2>&1

out=$("$AOS_BIN" open --cap "$cap" --path "$WS/f.txt" 2>&1)
if printf '%s' "$out" | grep -qiE 'denied|revoked|EACCES|EPERM'; then
  ok "revoke: broker_denied=1"
else
  fail "revoke: 撤销后 broker 仍然放行"
fi

# ---- 3. the holder may still read through the fd it already has ----
if [ -n "$holder_pid" ] && kill -0 "$holder_pid" 2>/dev/null; then
  # Ask the implementation to report whether its held fd still reads.
  out=$("$AOS_BIN" cap probe --pid "$holder_pid" 2>&1)
  if printf '%s' "$out" | grep -qiE 'fd_still_reads.*1|readable.*true'; then
    ok "revoke: fd_still_reads=1（如实记录残余 fd）"
  elif printf '%s' "$out" | grep -qiE 'fd_still_reads.*0|readable.*false'; then
    fail "revoke: 报告 fd 已失效，但内核语义不允许——这条负结果被掩盖了"
  else
    skip "revoke: 实现没有 cap probe，无法确认残余 fd 状态（人工确认）"
  fi

  # ---- 4. the holder must be killed, and the cgroup drained ----
  "$AOS_BIN" kill --pid "$holder_pid" >/dev/null 2>&1 || kill -9 "$holder_pid" 2>/dev/null
  sleep 0.5
  if kill -0 "$holder_pid" 2>/dev/null; then
    fail "revoke: 持有进程仍在运行（$holder_pid）"
  else
    ok "revoke: killed=1（持有进程已结束）"
  fi
else
  skip "revoke: 实现没有 --hold，跳过 fd 残余用例"
fi

summary
