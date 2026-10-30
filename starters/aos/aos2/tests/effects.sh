#!/usr/bin/env bash
# AOS2: the effects ledger distinguishes indeterminate from failed, and the
# rollback report lists what cannot be undone.
#
# Usage: ./tests/effects.sh   (starts testdata/fake-api itself if it is built)
#
# Expected output contract from the lab page:
#   indeterminate=1 compensated=1 irreversible=1
#
# The important part is not the exact counts but that the three categories are
# distinguishable: a timeout on /charge must NOT be reported as "no effect", and
# a rollback must NOT claim "complete" when a /send already left the building.

set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
source "$here/../common.sh"

AOS_BIN="${AOS_BIN:-./aos2}"
[ -x "$AOS_BIN" ] || { skip "找不到可执行的 $AOS_BIN（AOS_BIN= 指定）"; summary; exit 0; }

need_cmd curl "effects"

API_BIN="${AOS_API:-./testdata/fake-api}"
API_URL="${AOS_API_URL:-http://127.0.0.1:18080}"
started=""
cleanup() { [ -n "$started" ] && kill "$started" 2>/dev/null; }
trap cleanup EXIT

if ! curl -sf "$API_URL/state" >/dev/null 2>&1; then
  if [ -x "$API_BIN" ]; then
    "$API_BIN" -addr "127.0.0.1:$(printf '%s' "$API_URL" | sed 's|.*:||')" \
      >/dev/null 2>&1 &
    started=$!
    sleep 1
  fi
  curl -sf "$API_URL/state" >/dev/null 2>&1 || {
    skip "effects: 没有 fake-api（AOS_API= 指定可执行文件，或先 go build -o testdata/fake-api ./testdata/fake-api）"
    summary; exit 0
  }
fi

ROOT="$(mktemp -d)"
WS="$ROOT/ws"
trap 'cleanup; rm -rf "$ROOT"' EXIT
mkdir -p "$WS"

"$AOS_BIN" init --ws "$WS" >/dev/null 2>&1 || {
  fail "effects: init 失败"; summary; exit 0; }
printf 'base\n' >"$ROOT/base.txt"
"$AOS_BIN" commit --ws "$WS" --base 0 --put base.txt="$ROOT/base.txt" >/dev/null 2>&1 || {
  fail "effects: 基线提交失败"; summary; exit 0; }

before=$(json_get "$(curl -s "$API_URL/state")" charged)
before=${before:-0}

# 1. A charge whose reply is lost: server sleeps past the client's timeout.
out_indet=$("$AOS_BIN" begin --ws "$WS" 2>&1; \
  "$AOS_BIN" effect --ws "$WS" --kind charge --url "$API_URL/charge?delay=3s" \
    --body '{"amount":10,"idem":"eff-1"}' --timeout 1s 2>&1)
rc_indet=$?

# 2. A charge that can be compensated (refund), and a message that cannot.
"$AOS_BIN" effect --ws "$WS" --kind charge --url "$API_URL/charge" \
  --body '{"amount":20,"idem":"eff-2"}' --compensate refund >/dev/null 2>&1
"$AOS_BIN" effect --ws "$WS" --kind send --url "$API_URL/send" \
  --body '{"to":"ops@example.invalid","idem":"msg-1"}' >/dev/null 2>&1

roll_out=$("$AOS_BIN" rollback --ws "$WS" 2>&1)
st_out=$("$AOS_BIN" status --ws "$WS" 2>&1)
blob="$out_indet
$roll_out
$st_out"

# The indeterminate charge: the server-side counter must show it DID run.
after=$(json_get "$(curl -s "$API_URL/state")" charged)
after=${after:-0}
if [ "$after" -gt "$before" ]; then
  ok "effects: 超时的那次 charge 在服务端确实执行了（charged $before→$after）"
else
  skip "effects: 服务端计数没变化，无法验证 indeterminate"
fi

if printf '%s' "$blob" | grep -qiE 'indeterminate|unknown'; then
  ok "effects: 报告区分了 indeterminate"
else
  fail "effects: 超时后没有出现 indeterminate（实现可能把它当成了失败）"
fi

if printf '%s' "$blob" | grep -qiE 'irreversible|不可回滚|cannot.roll.?back'; then
  ok "effects: 报告列出了不可回滚项"
else
  fail "effects: /send 之后 rollback 没有列出不可回滚项（可能谎称 complete）"
fi

if printf '%s' "$blob" | grep -qiE 'status.*complete|"complete"'; then
  if printf '%s' "$blob" | grep -qiE 'irreversible|不可回滚'; then
    ok "effects: 说 complete 时也带了不可回滚清单"
  else
    fail "effects: 只说了 complete，没有列不可回滚项"
  fi
fi

# The compensated charge should have been refunded on the server side.
refunded=$(json_get "$(curl -s "$API_URL/state")" refunded)
if [ "${refunded:-0}" -ge 1 ]; then
  ok "effects: 补偿真的调用了 refund（refunded=$refunded）"
else
  fail "effects: 记账里有补偿项，但服务端没有收到 refund"
fi

summary
