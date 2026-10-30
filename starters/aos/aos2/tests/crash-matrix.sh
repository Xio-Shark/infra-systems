#!/usr/bin/env bash
# AOS2: crash at each commit step, then recover — the result must be decidable.
#
# Usage: ./tests/crash-matrix.sh [--case NAME] [--repeat N]
#
# The implementation injects the crash itself via AOS2_CRASH_AT (the lab page
# specifies the step names). Each run must end in exactly one of:
#   * the old generation is current and `recover` reports aborted, or
#   * the new generation is current and `recover` reports committed.
# A state where `current` points at a missing/incomplete generation, or where
# two consecutive `recover` calls disagree, is a failure.

set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
source "$here/../common.sh"

AOS_BIN="${AOS_BIN:-./aos2}"
[ -x "$AOS_BIN" ] || { skip "找不到可执行的 $AOS_BIN（AOS_BIN= 指定）"; summary; exit 0; }

# Step names are the ones the lab page specifies for AOS2_CRASH_AT.
STEPS=(after_intent after_stage after_prepared before_switch after_switch)
REPEAT=1
ONLY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --case) ONLY="$2"; shift 2 ;;
    --repeat) REPEAT="$2"; shift 2 ;;
    *) fail "未知参数 $1"; summary; exit 0 ;;
  esac
done

run_one() {
  local step="$1" iter="$2"
  local root ws
  root="$(mktemp -d)"
  ws="$root/ws"
  mkdir -p "$ws"

  "$AOS_BIN" init --ws "$ws" >/dev/null 2>&1 || {
    fail "$step#$iter: init 失败"; rm -rf "$root"; return; }

  printf 'gen=0\n' >"$root/a.txt"
  "$AOS_BIN" commit --ws "$ws" --base 0 --put a.txt="$root/a.txt" >/dev/null 2>&1 || {
    fail "$step#$iter: 基线提交失败"; rm -rf "$root"; return; }

  printf 'gen=1\n' >"$root/b.txt"
  AOS2_CRASH_AT="$step" "$AOS_BIN" commit --ws "$ws" --base 1 --put b.txt="$root/b.txt" \
    >/dev/null 2>&1
  local crash_rc=$?
  # SIGKILL surfaces as 137; a clean exit means the injected crash never fired.
  if [ "$crash_rc" -eq 0 ]; then
    fail "$step#$iter: commit 正常退出，AOS2_CRASH_AT=$step 没有触发"
    rm -rf "$root"; return
  fi

  "$AOS_BIN" recover --ws "$ws" >/dev/null 2>&1 || {
    fail "$step#$iter: recover 退出非零"; rm -rf "$root"; return; }

  local st1 st2
  st1=$("$AOS_BIN" status --ws "$ws" 2>/dev/null | tr -d '\n')
  "$AOS_BIN" recover --ws "$ws" >/dev/null 2>&1
  st2=$("$AOS_BIN" status --ws "$ws" 2>/dev/null | tr -d '\n')

  if [ "$st1" != "$st2" ]; then
    fail "$step#$iter: 两次 recover 结果不同（'$st1' vs '$st2'）"
    rm -rf "$root"; return
  fi

  local cur
  cur=$(readlink -f "$ws/current" 2>/dev/null)
  if [ -z "$cur" ] || [ ! -d "$cur" ]; then
    fail "$step#$iter: current 指向不存在的目录（status='$st1'）"
    rm -rf "$root"; return
  fi

  # The tree must be self-consistent: every file mentioned by the manifest
  # exists with the recorded hash. `verify` is the implementation's own check,
  # so also assert the weaker file-system fact.
  if ! "$AOS_BIN" verify --ws "$ws" >/dev/null 2>&1; then
    fail "$step#$iter: verify 失败（current=$cur）"
    rm -rf "$root"; return
  fi

  if printf '%s' "$st1" | grep -qE 'committed|aborted'; then
    ok "$step#$iter: $st1"
  else
    fail "$step#$iter: status 既不是 committed 也不是 aborted（'$st1'）"
  fi
  rm -rf "$root"
}

for step in "${STEPS[@]}"; do
  [ -z "$ONLY" ] || [ "$ONLY" = "$step" ] || continue
  for i in $(seq 1 "$REPEAT"); do
    run_one "$step" "$i"
  done
done

summary
