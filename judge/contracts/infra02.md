# INFRA 02 · submission contracts

评分脚本通过命令行调用你的实现，不读源码。你只需要遵守下面的接口。

## CN1 · container

`SUBMISSION` 指向一个可执行文件，支持：

```text
$SUBMISSION run --rootfs DIR [--memory 64M] -- CMD [ARG...]
```

要求：

- 在新的 PID、mount、UTS、IPC、network namespace 里运行 `CMD`。
- 把根目录切换到 `DIR`，并挂好 `/proc`。
- 给了 `--memory` 时，用 cgroup v2 设置 `memory.max`。
- 退出码等于 `CMD` 的退出码。
- stdout/stderr 原样透传。

judge 的自动检查覆盖：命令执行、退出码、stderr、PID/mount/network/IPC namespace、rootfs 切换（在 `CN1_ROOTFS` 写一个 marker，要求容器内 `/<marker>` 可见）、容器本地 `/proc`（宿主 PID 不可见）、hostname、`--memory` 参数，以及有 `lsns` 时的残留 PID namespace 检查。因此 `CN1_ROOTFS` 必须可写；marker 在测试结束后删除。内存上限的实际执行（OOM）仍是人工验收项。

`SUBMISSION` 和 `CN1_ROOTFS` 的相对路径按调用者的当前目录解析；也可以直接给绝对路径。

judge 会设置：

| 变量 | 含义 |
|---|---|
| `SUBMISSION` | 你的可执行文件 |
| `CN1_ROOTFS` | 一个包含 `/bin/sh`、`hostname`、`cat`、`readlink` 的 rootfs（busybox-static 即可），目录需可写 |

运行：

```bash
SUBMISSION=~/labs/cn1/cn1 CN1_ROOTFS=~/labs/cn1-rootfs \
  ./judge/run.sh infra02 cn1
```

## CN2–CN5

接口还没冻结。先把实现放在 `submission/` 下，并在 `judge/tests/infra02/` 里按 `cn1.sh` 的格式补测试。
测试只检查可观察行为，不检查源码，也不提供实现。
