# 本地评分器

这个目录是课程的本地 judge。它只检查行为，不提供实现，也不包含可直接提交的答案。

## 用法

```bash
./judge/run.sh --list
./judge/run.sh infra01 lab1
./judge/run.sh --all --quick
./judge/run.sh infra01 lab3 --verbose
./judge/run.sh infra01 lab1 --json
```

`--quick` 只跑每个 lab 的一小部分测试，是冒烟检查，**不会**被报告为通过；完整跑用默认模式。quick 模式的单个 lab 超时上限是 300 秒。

`--json` 输出机器可读结果，退出码仍然有效：全部 PASS 返回 0，否则返回 1（包括 SKIP/PARTIAL/ERROR）。

## INFRA 01

judge 调用你本地的 MIT 6.5840 仓库，不复制它的测试代码。默认路径是 `~/labs/6.5840`；也可以指定：

```bash
LAB_ROOT=~/code/study/6.5840 ./judge/run.sh infra01 lab1
```

要求：

- `$LAB_ROOT/src/Makefile` 存在；
- Go 工具链可用；
- 你已经在 `src/mr`、`src/kvsrv1`、`src/raft1` 等目录里实现了对应 lab。

`lab1.sh` 跑 `make mr`；`lab2.sh` 跑 `make kvsrv1` 和 `make lock1`；`lab3.sh` 按 3A–3D 分组；`lab4.sh` 按 4A–4C；`lab5.sh` 按 5A–5C。

MIT 的 Makefile 默认带 `RACE=-race`，所以这些 `make` 目标默认会用 race detector 跑；自己调试时可以临时 `RACE=`，提交前用默认值。

## INFRA 02 / 03

目前只有 CN1 有可运行的黑盒测试。接口见 `contracts/infra02.md`：

```bash
SUBMISSION=~/labs/cn1/cn1 CN1_ROOTFS=~/labs/cn1-rootfs \
  ./judge/run.sh infra02 cn1
```

CN1 的检查覆盖命令执行、退出码、stderr、PID/mount/network/IPC namespace、rootfs 切换、容器本地 `/proc`（宿主 PID 不可见）、hostname、`--memory` 参数、运行期间是否真的存在 `memory.max=64M` 的 cgroup，以及有 `lsns` 时的残留 PID namespace 检查；内存上限的实际执行（OOM kill）仍是人工验收项。相对路径的 `SUBMISSION` / `CN1_ROOTFS` 按调用者的当前目录解析。

其他实验的接口还没冻结；测试脚本按 `tests/infra02/cn1.sh` 的格式补。没有 `SUBMISSION` 或 `CN1_ROOTFS` 时，judge 会显示 `SKIP`，不会假装通过。

INFRA 03 的 `courses/infra03.json` 标记为 `manual`：`--list` 会显示它，`--all` 默认跳过；显式运行 `./judge/run.sh infra03 aos1` 时，占位测试只输出 `SKIP`。验收按 `content/agent-os.md` 人工进行。

## 评分规则

- `courses/*.json` 定义 lab 列表、权重、超时。
- `tests/<course>/<lab>.sh` 定义检查项，输出：

  ```text
  CHECK PASS "make mr"
  CHECK FAIL "make raft1" "exit 2"
  SCORE 3/4
  ```

- `judge.py` 把 `SCORE` 按 lab 权重缩放；没有 `SCORE` 时按 `CHECK` 的通过比例算。
- 全部检查通过才算 PASS；`--quick` 最高只能是 PARTIAL。
- PASS 只代表自动检查通过；课程通过条件还包括 300 字复盘（见 `content/grading.md`）。
- 超时会终止整个进程组，已打印的 `CHECK` 保留用于定位，但该 lab 记 ERROR、0 分。

## 加一个 lab

1. 在 `courses/infra02.json` 里加 lab，指定 `script`、`weight`、`timeout`。
2. 在 `tests/infra02/` 下写脚本，`source ../common.sh`，用 `check` / `finish` 输出。
3. 把接口写进 `contracts/infra02.md`。
4. 跑一次 `./judge/run.sh infra02 <lab>`，确认没有 `SUBMISSION` 时是 `SKIP`，有实现时能给出 PASS/FAIL。

## 边界

- 这是自测工具，不是防作弊系统；它不验证你的实现是否原创。
- 测试通过不等于设计正确；还要能解释失败模式。
- 不要为了让 judge 通过而修改测试脚本；改测试等于改评分标准。
