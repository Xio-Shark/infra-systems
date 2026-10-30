#!/usr/bin/env bash
# AOS3: the capability table — grant, derive (narrow only), expire, revoke.
#
# Usage: ./tests/cap.sh
#
# Contract from content/aos3.md:
#   aos3 cap grant  --subject S --path P --rights read|write --ttl 10m
#   aos3 cap derive --cap CAP --path SUB --rights read|write
#   aos3 cap revoke --cap CAP
#   aos3 cap list
# Each prints a single JSON object on stdout.
#
# Expected summary line from the lab page: derive_ok=1 widen_denied=1 expired_denied=1

set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
source "$here/../common.sh"

AOS_BIN="${AOS_BIN:-./aos3}"
[ -x "$AOS_BIN" ] || { skip "找不到可执行的 $AOS_BIN（AOS_BIN= 指定）"; summary; exit 0; }

ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT
WS="$ROOT/ws"
mkdir -p "$WS/a/b" "$WS/sibling"
printf 'x\n' >"$WS/a/f.txt"
printf 'y\n' >"$WS/sibling/g.txt"

# 1. grant: returns a handle bound to an inode, not to a path string.
out=$("$AOS_BIN" cap grant --subject agent-1 --path "$WS/a" --rights read --ttl 10m 2>"$ROOT/err")
cap=$(json_get "$out" cap_id)
expect_nonempty "cap: grant 返回 cap_id" "$cap"
expect_nonempty "cap: grant 返回 dev/ino" "$(json_get "$out" ino)$(json_get "$out" dev)"
expect_eq "cap: grant 的 subject" "$(json_get "$out" subject)" "agent-1"

if [ -z "$cap" ]; then
  summary; exit 0
fi

# 2. derive narrower: read-only parent -> read-only child directory, must work.
out=$("$AOS_BIN" cap derive --cap "$cap" --path "$WS/a/b" --rights read 2>&1)
sub=$(json_get "$out" cap_id)
if [ -n "$sub" ]; then
  ok "cap: 派生到子目录成功（$sub）"
else
  fail "cap: 派生到子目录失败：$(printf '%s' "$out" | head -1)"
fi

# 3. derive wider: read -> write must be denied, not silently truncated.
out=$("$AOS_BIN" cap derive --cap "$cap" --path "$WS/a" --rights write 2>&1)
if printf '%s' "$out" | grep -qiE 'denied|not permitted|EACCES|EPERM' || \
   [ "$(json_get "$out" status)" = "denied" ]; then
  ok "cap: 派生更大权限被拒绝"
else
  fail "cap: 派生更大权限没有报 denied（输出：$(printf '%s' "$out" | head -1)）"
fi

# 4. a handle derived into a subdirectory must not reach a sibling directory.
if [ -n "$sub" ]; then
  out=$("$AOS_BIN" open --cap "$sub" --path "$WS/sibling/g.txt" 2>&1)
  if printf '%s' "$out" | grep -qiE 'denied|EXDEV|EACCES|EPERM'; then
    ok "cap: 子目录句柄打不开兄弟目录"
  else
    fail "cap: 子目录句柄打开了兄弟目录（输出：$(printf '%s' "$out" | head -1)）"
  fi
fi

# 5. expiry: a 1s TTL must stop working after it elapses.
short=$("$AOS_BIN" cap grant --subject agent-2 --path "$WS/a" --rights read --ttl 1s 2>&1)
short_cap=$(json_get "$short" cap_id)
if [ -n "$short_cap" ]; then
  sleep 2
  out=$("$AOS_BIN" open --cap "$short_cap" --path "$WS/a/f.txt" 2>&1)
  if printf '%s' "$out" | grep -qiE 'denied|expired|EACCES|EPERM'; then
    ok "cap: 过期句柄被拒绝"
  else
    fail "cap: 过期后仍能使用（输出：$(printf '%s' "$out" | head -1)）"
  fi
else
  skip "cap: 实现没有 --ttl 支持，跳过过期用例"
fi

# 6. revoke: immediate effect on the broker path.
"$AOS_BIN" cap revoke --cap "$cap" >/dev/null 2>&1 || fail "cap: revoke 退出非零"
out=$("$AOS_BIN" open --cap "$cap" --path "$WS/a/f.txt" 2>&1)
if printf '%s' "$out" | grep -qiE 'denied|revoked|EACCES|EPERM'; then
  ok "cap: 撤销后立刻 denied"
else
  fail "cap: 撤销后仍能用（输出：$(printf '%s' "$out" | head -1)）"
fi

# 7. list must not leak handles that were revoked.
listing=$("$AOS_BIN" cap list 2>&1)
if printf '%s' "$listing" | grep -q "$cap"; then
  fail "cap: revoke 之后 cap list 里还有 $cap"
else
  ok "cap: revoke 之后 cap list 里没有它"
fi

summary
