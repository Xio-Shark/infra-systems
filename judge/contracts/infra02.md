# INFRA 02 · submission contracts

评分脚本通过命令行调用你的实现，不读源码。你只需要遵守下面的接口。

## CN1 · container

`SUBMISSION` 指向一个可执行文件，支持：

```text
$SUBMISSION run --rootfs DIR [--memory 64M] -- CMD [ARG...]
```

要求：

- 在新的 PID、mount、UTS、IPC namespace 里运行 `CMD`。
- 把根目录切换到 `DIR`，并挂好 `/proc`。
- 给了 `--memory` 时，用 cgroup v2 设置 `memory.max`。
- 退出码等于 `CMD` 的退出码。
- stdout/stderr 原样透传。

judge 会设置：

| 变量 | 含义 |
|---|---|
| `SUBMISSION` | 你的可执行文件 |
| `CN1_ROOTFS` | 一个包含 `/bin/sh`、`hostname` 的 rootfs |

运行：

```bash
SUBMISSION=./cn1 CN1_ROOTFS=/path/to/rootfs \
  ./judge/run.sh infra02 cn1
```

## CN2–CN5

接口还没冻结。先把实现放在 `submission/` 下，并在 `judge/tests/infra02/` 里按 `cn1.sh` 的格式补测试。
测试只检查可观察行为，不检查源码，也不提供实现。
