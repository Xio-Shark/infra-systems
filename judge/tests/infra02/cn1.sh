#!/usr/bin/env bash
# CN1 contract tests. See judge/contracts/infra02.md.
#
# The checks are deliberately black-box: they only call the submission's
# documented CLI. They verify namespace identity, rootfs switching, /proc,
# stdout/stderr and exit-code propagation; memory.max enforcement is still a
# manual acceptance item (a minimal rootfs has no portable allocator).
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
source "$here/../common.sh"

if [ -z "${SUBMISSION:-}" ]; then
  skip_all "CN1 submission" "set SUBMISSION to an executable implementing judge/contracts/infra02.md"
fi
if [ ! -e "$SUBMISSION" ]; then
  skip_all "CN1 submission" "not found: $SUBMISSION"
fi
if [ ! -x "$SUBMISSION" ]; then
  skip_all "CN1 submission" "not executable: $SUBMISSION"
fi

if [ -z "${CN1_ROOTFS:-}" ]; then
  skip_all "CN1 rootfs" "set CN1_ROOTFS to a rootfs containing /bin/sh"
fi
if [ ! -d "$CN1_ROOTFS" ]; then
  skip_all "CN1 rootfs" "not a directory: $CN1_ROOTFS"
fi
if [ ! -e "$CN1_ROOTFS/bin/sh" ]; then
  skip_all "CN1 rootfs" "$CN1_ROOTFS does not contain /bin/sh"
fi

run_sub() {
  "$SUBMISSION" run --rootfs "$CN1_ROOTFS" "$@"
}

# 1. Run a command and see its stdout.
out=$(run_sub -- /bin/sh -c 'echo cn1-ok' 2>&1)
rc=$?
if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q 'cn1-ok'; then
  check PASS "run a command inside the rootfs"
else
  check FAIL "run a command inside the rootfs" "exit $rc"
fi

# 2. Propagate the command's exit code.
run_sub -- /bin/sh -c 'exit 7' >/dev/null 2>&1
rc=$?
if [ "$rc" -eq 7 ]; then
  check PASS "propagate the command exit code"
else
  check FAIL "propagate the command exit code" "expected 7, got $rc"
fi

# 3. Pass stderr through.
out=$(run_sub -- /bin/sh -c 'echo cn1-stderr >&2' 2>&1)
rc=$?
if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q 'cn1-stderr'; then
  check PASS "pass stderr through"
else
  check FAIL "pass stderr through" "exit $rc"
fi

# 4. New PID namespace: the namespace inode must differ from the host's.
inner_pid_ns=$(run_sub -- /bin/sh -c 'readlink /proc/self/ns/pid' 2>/dev/null)
outer_pid_ns=$(readlink /proc/self/ns/pid 2>/dev/null)
if [ -n "$inner_pid_ns" ] && [ -n "$outer_pid_ns" ] && [ "$inner_pid_ns" != "$outer_pid_ns" ]; then
  check PASS "create a new PID namespace"
else
  check FAIL "create a new PID namespace" "inner='$inner_pid_ns' outer='$outer_pid_ns'"
fi

# 5. New mount namespace.
inner_mnt_ns=$(run_sub -- /bin/sh -c 'readlink /proc/self/ns/mnt' 2>/dev/null)
outer_mnt_ns=$(readlink /proc/self/ns/mnt 2>/dev/null)
if [ -n "$inner_mnt_ns" ] && [ -n "$outer_mnt_ns" ] && [ "$inner_mnt_ns" != "$outer_mnt_ns" ]; then
  check PASS "create a new mount namespace"
else
  check FAIL "create a new mount namespace" "inner='$inner_mnt_ns' outer='$outer_mnt_ns'"
fi

# 6. New network namespace.
inner_net_ns=$(run_sub -- /bin/sh -c 'readlink /proc/self/ns/net' 2>/dev/null)
outer_net_ns=$(readlink /proc/self/ns/net 2>/dev/null)
if [ -n "$inner_net_ns" ] && [ -n "$outer_net_ns" ] && [ "$inner_net_ns" != "$outer_net_ns" ]; then
  check PASS "create a new network namespace"
else
  check FAIL "create a new network namespace" "inner='$inner_net_ns' outer='$outer_net_ns'"
fi

# 7. New IPC namespace.
inner_ipc_ns=$(run_sub -- /bin/sh -c 'readlink /proc/self/ns/ipc' 2>/dev/null)
outer_ipc_ns=$(readlink /proc/self/ns/ipc 2>/dev/null)
if [ -n "$inner_ipc_ns" ] && [ -n "$outer_ipc_ns" ] && [ "$inner_ipc_ns" != "$outer_ipc_ns" ]; then
  check PASS "create a new IPC namespace"
else
  check FAIL "create a new IPC namespace" "inner='$inner_ipc_ns' outer='$outer_ipc_ns'"
fi

# 8. Rootfs switch: a marker created in CN1_ROOTFS must be visible at /.
marker=".cn1-judge-$$"
printf 'cn1-rootfs-ok\n' > "$CN1_ROOTFS/$marker"
trap 'rm -f "$CN1_ROOTFS/$marker"' EXIT
out=$(run_sub -- /bin/sh -c "cat /$marker" 2>&1)
rc=$?
if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q 'cn1-rootfs-ok'; then
  check PASS "switch to the supplied rootfs"
else
  check FAIL "switch to the supplied rootfs" "marker not visible at /$marker"
fi

# 9. /proc is a container-local procfs: it must be readable, and the host
# test script's PID must not be visible (a host-procfs bind mount would show it).
host_pid=$$
out=$(run_sub -- /bin/sh -c "test -r /proc/self/status && test ! -e /proc/$host_pid && echo proc-ok" 2>&1)
rc=$?
if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q 'proc-ok'; then
  check PASS "mount a container-local /proc"
else
  check FAIL "mount a container-local /proc" "exit $rc; host pid $host_pid visible?"
fi

# 10. Best-effort: no leaked PID namespace after the container exits.
# Without root (or with a hardened procfs) `lsns` returns nothing, and "0 <= 0"
# would silently pass a submission that leaks namespaces. Treat that as SKIP.
if command -v lsns >/dev/null 2>&1; then
  before=$(lsns -t pid -n 2>/dev/null | wc -l | tr -d ' ')
  run_sub -- /bin/sh -c 'true' >/dev/null 2>&1
  after=$(lsns -t pid -n 2>/dev/null | wc -l | tr -d ' ')
  if [ -z "$before" ] || [ "$before" -eq 0 ] || [ -z "$after" ]; then
    check SKIP "leave no extra PID namespace" "lsns 读不到 PID namespace（需要 root 或未受限的 /proc）"
  elif [ "$after" -le "$before" ]; then
    check PASS "leave no extra PID namespace"
  else
    check FAIL "leave no extra PID namespace" "before=$before after=$after"
  fi
fi

# 11. Separate UTS namespace / hostname.
inner_host=$(run_sub -- hostname 2>/dev/null)
outer_host=$(hostname 2>/dev/null)
if [ -n "$inner_host" ] && [ "$inner_host" != "$outer_host" ]; then
  check PASS "set a separate hostname"
else
  check FAIL "set a separate hostname" "rootfs needs hostname; inner='$inner_host' outer='$outer_host'"
fi

# 12. Accept --memory.
out=$(run_sub --memory 64M -- /bin/sh -c 'echo mem-ok' 2>&1)
rc=$?
if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q 'mem-ok'; then
  check PASS "accept a memory limit"
else
  check FAIL "accept a memory limit" "exit $rc"
fi

# 13. The limit must actually exist while the container runs. Black-box: count
# cgroups whose memory.max equals 64M before and during a run. Enforcement
# (an OOM kill) stays a manual item, but "never set memory.max at all" is
# mechanically detectable. SKIP when the caller cannot read the cgroup tree.
mem_limit=67108864  # 64M in bytes
cgroup_base="/sys/fs/cgroup"
if [ -r "$cgroup_base/cgroup.controllers" ]; then
  count_limited() {
    find "$cgroup_base" -maxdepth 8 -name memory.max -type f 2>/dev/null |
      while IFS= read -r f; do
        [ "$(cat "$f" 2>/dev/null)" = "$mem_limit" ] && echo "$f"
      done | wc -l | tr -d ' '
  }
  before=$(count_limited)
  run_sub --memory 64M -- /bin/sh -c 'sleep 1' >/dev/null 2>&1 &
  bg=$!
  saw_limit=0
  i=0
  while [ "$i" -lt 40 ]; do
    if [ "$(count_limited)" -gt "$before" ]; then
      saw_limit=1
      break
    fi
    sleep 0.05
    i=$((i + 1))
  done
  wait "$bg" 2>/dev/null
  if [ "$saw_limit" -eq 1 ]; then
    check PASS "set memory.max while running"
  else
    check FAIL "set memory.max while running" "运行期间没有出现 memory.max=$mem_limit 的 cgroup"
  fi
else
  check SKIP "set memory.max while running" "$cgroup_base 不可读（需要 cgroup v2 且能访问 host 的 cgroup 树）"
fi

finish
