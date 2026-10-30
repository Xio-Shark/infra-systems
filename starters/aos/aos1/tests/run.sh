#!/usr/bin/env bash
# AOS1 acceptance harness: spawn / exec / cgroup / seccomp / lifecycle.
#
# Usage:
#   ./tests/run.sh                 # run everything that the environment supports
#   ./tests/run.sh spawn exec      # run selected cases
#   AOS_BIN=~/labs/aos1/aosctl ./tests/run.sh
#
# Contract (from content/aos1.md): aosctl talks to aosd over $XDG_RUNTIME_DIR/aos1.sock
# and prints one JSON object per call with the fields status/result/effects/evidence.

set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
source "$here/../common.sh"

AOS_BIN="${AOS_BIN:-./aosctl}"
[ -x "$AOS_BIN" ] || { skip "找不到可执行的 $AOS_BIN（AOS_BIN= 指定）"; summary; exit 0; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

call() {
  "$AOS_BIN" "$@" 2>"$WORK/err"
}

case_abi() {
  CASE=abi
  local out
  out=$(call exec --idem "abi/$RANDOM" -- /bin/sh -c 'echo abi-ok') || {
    fail "abi: exec 退出非零: $(tail -1 "$WORK/err")"; return
  }
  local status
  status=$(json_get "$out" status)
  expect_eq "abi: status" "$status" "ok"
  expect_nonempty "abi: result.exec_id" "$(json_get "$out" result.exec_id)"
  expect_eq "abi: exit" "$(json_get "$out" result.exit)" "0"
  expect_nonempty "abi: evidence" "$(json_get "$out" evidence)"
  # result.stdout_sha256 must be the hash of the bytes the command printed.
  local want got
  want=$(printf 'abi-ok\n' | sha256sum | cut -d' ' -f1)
  got=$(json_get "$out" result.stdout_sha256)
  if [ -n "$got" ]; then
    expect_eq "abi: stdout_sha256" "$got" "$want"
  else
    skip "abi: 实现没有返回 stdout_sha256（任务书示例里有；不做硬性要求）"
  fi
}

case_idem() {
  CASE=idem
  local key="idem/$RANDOM" counter="$WORK/counter"
  : >"$counter"
  local a b
  a=$(call exec --idem "$key" -- /bin/sh -c "printf x >> '$counter'; echo once") || {
    fail "idem: 第一次 exec 失败"; return
  }
  b=$(call exec --idem "$key" -- /bin/sh -c "printf x >> '$counter'; echo once") || {
    fail "idem: 第二次 exec 失败"; return
  }
  expect_eq "idem: 同一 exec_id" \
    "$(json_get "$b" result.exec_id)" "$(json_get "$a" result.exec_id)"
  local n
  n=$(wc -c <"$counter" | tr -d ' ')
  expect_eq "idem: 命令只执行一次" "$n" "1"
}

case_spawn() {
  CASE=spawn
  need_root "spawn"
  local out
  out=$(call exec --idem "spawn/$RANDOM" -- /bin/sh -c 'cat /proc/self/status | grep NSpid') || {
    fail "spawn: exec 失败"; return
  }
  local nspid
  nspid=$(printf '%s' "$out" | python3 -c '
import json,sys
try: print(json.load(sys.stdin)["result"].get("stdout",""), end="")
except Exception: print("", end="")
')
  # Two NSpid columns mean the process really entered a new PID namespace.
  local cols
  cols=$(printf '%s' "$nspid" | tr -s '[:space:]' ' ' | wc -w | tr -d ' ')
  if [ "$cols" -ge 3 ]; then
    ok "spawn: NSpid 有两层"
  else
    fail "spawn: NSpid 只有一层（stdout='$nspid'）"
  fi
}

case_ssh_denied() {
  CASE=ssh-denied
  need_root "ssh-denied"
  # The tool must fail on its own; a script that prints an error and exits 0 is
  # not a sandbox. So: non-zero exit AND the syscall was refused.
  local out rc
  out=$(call exec --idem "ssh/$RANDOM" -- /bin/sh -c 'cat ~/.ssh/id_rsa' 2>"$WORK/err")
  rc=$?
  if [ "$rc" -eq 0 ]; then
    fail "ssh-denied: 读 ~/.ssh/id_rsa 竟然成功"
    return
  fi
  ok "ssh-denied: 读失败（exit $rc）"
  local blob
  blob="$(printf '%s' "$out")$(cat "$WORK/err")"
  if printf '%s' "$blob" | grep -qiE 'EACCES|EXDEV|EPERM|permission denied|operation not permitted'; then
    ok "ssh-denied: 错误来自内核（EACCES/EXDEV/EPERM）"
  else
    fail "ssh-denied: 看不到内核 errno，可能是脚本自己打印的假错误"
  fi
}

case_oom() {
  CASE=oom
  need_root "oom"
  local tool="${AOS_TOOL:-./testdata/fake-tool}"
  [ -x "$tool" ] || { skip "oom: 没有 $tool（AOS_TOOL= 指定测试工具）"; return; }
  local out
  out=$(call exec --idem "oom/$RANDOM" --memory 128M -- "$tool" hog 512MiB) || true
  local exit_code
  exit_code=$(json_get "$out" result.exit)
  if [ "$exit_code" = "137" ] || [ "$exit_code" = "-1" ]; then
    ok "oom: 进程被信号杀死（exit $exit_code）"
  else
    fail "oom: exit=$exit_code，期望 137（SIGKILL）"
  fi
}

case_terminate() {
  CASE=terminate
  need_root "terminate"
  local out id
  out=$(call exec --idem "term/$RANDOM" -- /bin/sh -c 'sleep 30') &
  local waiter=$!
  sleep 1
  id=$(json_get "$out" result.exec_id)
  if [ -z "$id" ]; then
    wait "$waiter" 2>/dev/null
    skip "terminate: exec 是同步阻塞的，无法在运行中 terminate"
    return
  fi
  call terminate --exec "$id" >/dev/null || fail "terminate: terminate 调用失败"
  wait "$waiter" 2>/dev/null
  if pgrep -f 'sleep 30' >/dev/null 2>&1; then
    fail "terminate: 还有 sleep 进程残留"
  else
    ok "terminate: 没有残留进程"
  fi
}

case_lifecycle() {
  CASE=lifecycle
  need_root "lifecycle"
  local idem="life/$RANDOM"
  call exec --idem "$idem" -- /bin/sh -c 'echo before-restart' >/dev/null ||
    { fail "lifecycle: 第一次 exec 失败"; return; }
  call daemon restart >/dev/null 2>&1 || {
    skip "lifecycle: 实现没有 daemon restart 子命令（可手动重启后重跑）"; return
  }
  local out
  out=$(call exec --idem "$idem" -- /bin/sh -c 'echo after-restart')
  if [ -n "$(json_get "$out" result.exec_id)" ]; then
    ok "lifecycle: 重启后同一 idem 仍返回结果"
  else
    fail "lifecycle: 重启后同一个 idem 没有命中幂等表"
  fi
}

CASES=("$@")
[ ${#CASES[@]} -gt 0 ] || CASES=(abi idem spawn ssh-denied oom terminate lifecycle)

for c in "${CASES[@]}"; do
  case "$c" in
    abi)         case_abi ;;
    idem)        case_idem ;;
    spawn)       case_spawn ;;
    ssh-denied)  case_ssh_denied ;;
    oom)         case_oom ;;
    terminate)   case_terminate ;;
    lifecycle)   case_lifecycle ;;
    *)           fail "未知用例 $c" ;;
  esac
done

summary
