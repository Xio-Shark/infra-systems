#!/usr/bin/env bash
# CN1 contract tests. See judge/contracts/infra02.md.
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
source "$here/../common.sh"

if [ -z "${SUBMISSION:-}" ] || [ ! -x "$SUBMISSION" ]; then
  skip_all "CN1 submission" "set SUBMISSION to an executable implementing judge/contracts/infra02.md"
fi

if [ -z "${CN1_ROOTFS:-}" ] || [ ! -d "$CN1_ROOTFS" ]; then
  skip_all "CN1 rootfs" "set CN1_ROOTFS to a rootfs containing /bin/sh"
fi

run_sub() {
  "$SUBMISSION" run --rootfs "$CN1_ROOTFS" "$@"
}

out=$(run_sub -- /bin/sh -c 'echo cn1-ok' 2>&1)
rc=$?
if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q 'cn1-ok'; then
  check PASS "run a command inside the rootfs"
else
  check FAIL "run a command inside the rootfs" "exit $rc"
fi

run_sub -- /bin/sh -c 'exit 7' >/dev/null 2>&1
rc=$?
if [ "$rc" -eq 7 ]; then
  check PASS "propagate the command exit code"
else
  check FAIL "propagate the command exit code" "expected 7, got $rc"
fi

inner_host=$(run_sub -- hostname 2>/dev/null)
outer_host=$(hostname 2>/dev/null)
if [ -n "$inner_host" ] && [ "$inner_host" != "$outer_host" ]; then
  check PASS "set a separate hostname"
else
  check FAIL "set a separate hostname" "rootfs needs hostname; inner='$inner_host' outer='$outer_host'"
fi

out=$(run_sub --memory 64M -- /bin/sh -c 'echo mem-ok' 2>&1)
rc=$?
if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q 'mem-ok'; then
  check PASS "accept a memory limit"
else
  check FAIL "accept a memory limit" "exit $rc"
fi

finish
