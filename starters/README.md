# 起步骨架

这里放 INFRA 02/03 的起步代码。它们**只搭结构和脚手架，不含实验核心逻辑**——核心步骤都留成 `TODO(n)`，作业页的“阶段拆解”对应这些编号。

| 实验 | 骨架 | 能直接跑吗 |
|---|---|---|
| CN1 | `cn1/` | 能编译，用法和退出码正确；namespace、切根、cgroup 共 7 处 `TODO(2)`–`TODO(8)` 待实现 |
| 其余 | 无 | 按任务书从空目录自己搭。这是有意的：这些实验的重点是设计取舍，给完整骨架会替你做掉判断 |

`aos/` 下不是骨架，是**验收脚本和测试 fixture**：

| 目录 | 内容 |
|---|---|
| `aos/common.sh` | 脚本共用的断言与 JSON 解析 |
| `aos/aos1/` | `tests/run.sh`（abi/idem/spawn/ssh-denied/oom/terminate/lifecycle）、`testdata/fake-tool/` |
| `aos/aos2/` | `read-loop.sh`、`crash-matrix.sh`、`rollback.sh`、`conflict.sh`、`effects.sh`、`testdata/fake-api/` |
| `aos/aos3/` | `cap.sh`、`escape.sh`、`revoke.sh`、`probe-landlock`、`testdata/escape/` |
| `aos/aos4/` | `tests/snapshot.sh`、`scripts/torn-write.sh` |
| `aos/aos5/` | `dual-owner.sh`、`tamper.sh`、`fence-stress.sh` |

它们只通过任务书写明的 CLI 和文件系统观察，不 import 你的代码。用法、边界和"能证明什么、不能证明什么"见 [`aos/README.md`](aos/README.md)。

## 用 CN1 骨架

```bash
cd starters/cn1
go build -o ~/labs/cn1/cn1 .
sudo ~/labs/cn1/cn1 run --rootfs ~/labs/cn1-rootfs -- /bin/sh -c 'echo hi'
```

在 Linux/WSL2 上按 `content/cn1.md` 的“阶段拆解”填 TODO，每填一组就跑一次 judge：

```bash
SUBMISSION=~/labs/cn1/cn1 CN1_ROOTFS=~/labs/cn1-rootfs ./judge/run.sh infra02 cn1
```

填之前 judge 会显示 `FAIL` 或 `SKIP`，这是预期的——骨架只保证“能编译、能启动子进程、能透传退出码”，不保证隔离。

## 为什么骨架要按平台分文件

`procattr_linux.go` 和 `procattr_other.go` 用 build tag 分隔：namespace 相关的常量只有 Linux 有，非 Linux 平台留一个空实现，这样你在 macOS 上也能 `go build` 确认语法正确，只是跑不起来。INFRA 02/03 的实验必须在 Linux 或 WSL2 里做。

CI 会对骨架跑 `gofmt -l`、`go vet` 和两个平台的构建，所以它不会悄悄腐烂。
