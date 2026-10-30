# Capstone · Minimal Agent OS

> **课程**：[INFRA 03 · Agent OS](agent-os.html) · **结课项目**
>
> **先读**：[第 11 讲](agent-os.html#aos11) · [第 12 讲](agent-os.html#aos12) · **验收**：人工验收 + 报告
>
> [返回作业](labs.html) · [上一个：AOS5](aos5.html)
>
> **难度** ★★★★★ · **先修** AOS1–AOS5 中至少三个 · **时间** 20–30 小时 · **最小通过** 8 个顶层操作 + 2 类混沌；**完整通过** 全部 11 个顶层操作 + 报告 + demo

## 你将完成什么

Capstone 不做一个“全能 agent 平台”，只做一个能证明原子性、权限边界和证据的最小系统：一个 Unix socket daemon，暴露 10 个类型化操作；一个脚本化 planner 调用它完成多步骤任务；一套混沌测试；一份 10 页以内的报告。端到端场景建议选“改 Markdown、跑链接检查、提交 artifact”，全程离线，不接真实凭证。

最终 demo 能重复跑出同一结果：

```bash
cd ~/labs/aos-capstone
./demo/run.sh --task demo-42 --seed 7
./chaos/run.sh --seed 7
```

第一条输出任务 ID、每步的 `status`、最终 manifest hash 和 `audit_id`；第二条跑完混沌矩阵，失败场景也要有结构化错误和证据。验收看四件事：原子性是否真的成立、权限是否真的限制住、失败是否可解释、证据是否可验证。

## 开始之前

先读完第 11、12 讲，并完成 AOS1–AOS5 中至少三个；没有 AOS2 的 commit 和 AOS5 的 lease，Capstone 会变成一堆没有语义的 shell 包装。环境与前面相同：单机 Linux 或 WSL2，2 vCPU、4 GB 内存、20 GB 磁盘，root 只在一次性环境里用。

目录建议按机制分，不要把全部逻辑塞进 `main.go`：

```text
~/labs/aos-capstone/
  cmd/aosd/            # Unix socket daemon
  internal/abi/        # 操作表、信封、错误分类
  internal/sandbox/    # namespace/cgroup/seccomp/Landlock
  internal/workspace/  # staging、manifest、commit/rollback
  internal/snapshot/   # freeze、快照、restore
  internal/lease/      # lease + epoch
  internal/audit/      # append-only、hash chain、query、replay
  planner/             # 脚本化 planner，不用真模型也能跑
  chaos/               # 故障注入和断言
  tools/audit-verify   # 独立验证器
  demo/                # 10 分钟演示脚本
```

`abi` 信封、`audit` 字段名、`rename` + `fsync` 顺序不要改；混沌测试只从外部注入，不直接改内部状态。

时间预算 20–30 小时。不要先写报告；每个里程碑的测试和原始输出存到 `runs/<seed>/`，否则最后拼不出证据。

## 操作表：先定 10 个，再删

先按 11 个做，做完可以删到 8 个；删的时候要说明删掉了哪个性质。每个操作都必须有类型、前置条件、幂等键、错误分类和证据。

| # | 操作 | 原子性来源 | 关键失败 | 证据 |
|---|---|---|---|---|
| 1 | `spawn` | `clone3(CLONE_PIDFD)` + namespace + cgroup | 创建到一半失败 | pidfd、cgroup 路径 |
| 2 | `exec` | fork/exec + cgroup + 幂等表 | 超时、`indeterminate` | `execve` 事件、退出码 |
| 3 | `status` | 无（只读） | 任务不存在 | pidfd 可读、退出码 |
| 4 | `terminate` | `SIGTERM` → `cgroup.kill` | 孤儿、僵尸 | `populated=0`、`waitid` |
| 5 | `commit` | staging + `rename` + manifest `fsync` | 崩溃、冲突 | 版本号、manifest hash |
| 6 | `rollback` | 丢弃 staging / 切 manifest | 旧版本丢失 | 旧 hash |
| 7 | `snapshot.create` | freeze + `fsync` + clone/reflink | 不一致、冻结超时 | `frozen=1`、snapshot id |
| 8 | `snapshot.restore` | 版本目录 + symlink `rename` | 读者看到半版本 | 新 hash、旧版本保留 |
| 9 | `lease.acquire` | lease 服务 + 持久 epoch | 双主、epoch 回退 | epoch、`fenced` 记录 |
| 10 | `budget.reserve` | 预留表 + 父配额求和 | 超额、重试绕过 | 预留 id、剩余额度 |
| 11 | `audit.query` | append-only + hash chain | 链断、尾部截断 | `verified_until`、首个坏 `seq` |

表里有 11 个。第 8 讲要求把 token 预算做成一等资源，`budget.reserve` 就是它的落点；`budget.charge`（结算）不单列，作为 `budget.reserve` 的子路径：一次 reserve 返回预留 id，charge 用这个 id 结算；`quota.set` 改的是 `spawn` 时传的父配额，也不是独立操作。`lease.renew` 同理，作为 `lease.acquire` 的 heartbeat 子路径。所以表里是 11 个顶层操作，加 `budget.charge` 和 `lease.renew` 两条子路径共 13 个可调用入口；删到 8 个时，先砍 `snapshot.restore` 和 `status`，再砍 `rollback`，每次说明丢了哪条不变量。

数据流只有一条主路径：

```text
planner ──unix socket──> aosd
                         ├─ abi：类型、cap、预算、幂等键
                         ├─ sandbox：namespace/cgroup/seccomp
                         ├─ workspace：staging → manifest → rename
                         ├─ snapshot：freeze → fsync → clone
                         ├─ lease：epoch → fence
                         └─ audit：append → fsync → hash chain
```

看图时问一句：每个操作的 `evidence` 是哪一层产生的？如果答案来自 planner 的文本或模型自述，这条证据不算数。`commit` 的多文件版本不是内核级原子，只做到“可恢复”；单文件 `rename` 才是严格原子。报告里要把这两者分开写。

至少要守住六条不变量，报告里的每条主张都要落到其中一条：

1. `commit` 返回后，先从 `current` 拿目录 fd、再按该版本读的读者，只会看到旧版本或新版本，不会看到混合版本。
2. 同一个 task 的同一个幂等键只产生一次效果，响应可以重复。
3. `terminate` 返回后，cgroup 的 `populated` 为 0，没有孤儿进程还在写工作区。
4. 同一个 workspace 同时最多一个 epoch 能写，旧 epoch 被存储端拒绝。
5. 审计链可验证，每个成功操作的 `evidence` 都能在链上找到。
6. `restore` 后文件 hash 与快照 manifest 一致，未快照的状态在返回值里列出。

## 阶段拆解

### M1：ABI 和 fake tool

只加“类型化信封”和 `spawn`/`exec`。工具先不隔离，用 `echo` 或一个只写文件的 fake tool。目标是让 planner 通过 Unix socket 跑通“启动 → 执行 → 拿结果”，错误用 `invalid`、`denied`、`conflict`、`retryable`、`indeterminate`、`internal` 六类表达。

通过标志：重复发送同一个幂等键，fake tool 只写一次文件；`exec` 超时返回 `indeterminate`，planner 不盲重试。

### M2：隔离

只加 namespace、cgroup、seccomp 或 Landlock，不改 ABI。工具放进新的 PID/mount namespace，写 `cgroup.procs`，设 `memory.max` 和 `pids.max`；用 `openat2(RESOLVE_BENEATH)` 限制路径。

通过标志：工具读不到 `~/.ssh`；超过 `memory.max` 被 OOM kill，`memory.events` 的 `oom_kill` 增加；`pids.max` 挡住 fork 炸弹。

### M3：工作区事务

只加 `commit`/`rollback`。先做单文件临时文件 + `rename` + `fsync`，再做多文件 manifest。崩溃注入点放在 `rename` 前后、manifest `fsync` 前后。

通过标志：持续读的进程零次看到半行；`kill -9` 后重启，状态是旧版本或新版本，不混合；`rollback` 后 hash 与基线一致。

### M4：快照和恢复

只加 `snapshot.create`/`snapshot.restore`。从同一基线开三个分支，各改不同文件；用 freeze + `fsync` 做一致快照，对比直接复制。恢复用版本目录 + symlink 切换，旧版本延迟清理。

通过标志：三个分支互不污染；restore 后 hash 正确；报告列出至少 6 类不能快照的状态，尤其是 fd、socket、cgroup、时钟和外部副作用。

### M5：租约和栅栏

只加 `lease.acquire` 和写路径的 epoch 检查。epoch 按 workspace 持久化、单调递增；存储端记住 `max_epoch`，低于它的写返回 `fenced`。用 `SIGSTOP` 暂停旧 owner，等 TTL 过期，让新 owner 接管，再恢复旧 owner。

通过标志：20 次双主场景里旧 owner 一次都写不进去；租约服务重启后 epoch 不回退。

### M6：审计和重放

只加 append-only 日志、hash chain、`audit.query` 和 replay。字段固定为 `seq, ts, actor, task, op, args_hash, result, epoch, prev_hash, hash`；写入 `fsync` 后再确认。查询前先验证链，重放时只读记录，不重新执行外部调用。

通过标志：中间篡改被定位到 `seq`；重放后的文件 hash 与当时 manifest 一致；报告明确写出尾部截断和“没发生的事件”无法证明。

### M7：混沌、demo 和报告

只加测试和文档，不再加机制。混沌矩阵每条至少跑一次，结果写进 `runs/<seed>/report.json`；demo 控制在 10 分钟，从空工作区开始，跑到审计查询结束。

通过标志：`./chaos/run.sh --seed 7` 一条命令跑完；失败场景有结构化错误和证据；demo 不依赖网络。

## 混沌测试矩阵

| 注入 | 时点 | 期望 | 证据 |
|---|---|---|---|
| `kill -9` daemon | commit 的 `rename` 前后 | 旧或新，不混合 | 重启后 manifest/hash |
| `kill -9` daemon | 审计 append/`fsync` 前后 | 事件完整或不存在，无半条 | `verify` 首个坏 `seq` |
| 重复请求 | 客户端超时后重发 | 同幂等键只一次效果 | 两次响应、`effects` 一条 |
| 两个 agent | 无租约并发 commit | 一个成功或串行化 | `fenced`/`conflict` 记录 |
| lease 过期 + `SIGCONT` | 旧 owner 恢复 | 旧写被拒 | `max_epoch` |
| 权限逃逸 | `..`、symlink、`/proc/self/fd`、bind mount | 全部 `denied` | 审计中的拒绝事件 |
| 孤儿进程 | `setsid`、双 fork | `terminate` 后 `populated=0` | `cgroup.events`、`waitid` |
| 磁盘满 | staging 或审计写入 | 结构化错误，manifest 不坏 | `ENOSPC`、`verify` |
| 审计篡改 | 中间改一条、尾部截断 | 中间可定位；尾部需锚点 | `verify` 输出 |
| 时钟跳变 | wall clock 前后跳、`SIGSTOP` | 不出现双主 | epoch 单调 |

矩阵里最容易被跳过的是“时点”：只在操作前后注入，抓不到 `fsync` 和 `rename` 之间的窗口。每个崩溃测试至少选三个时点，并用固定 seed 复现。

## 报告写什么

报告不是功能清单，是论证。建议七节，10 页以内：

1. **主张**：5–7 条可证伪的性质，每条一句话，编号对应上面的不变量。
2. **边界与威胁模型**：谁可信，哪些副作用在系统外，哪些状态不快照。
3. **设计**：操作表、状态机、每个操作的原子性来源。
4. **证据**：每条性质对应哪个测试、哪条命令、哪段原始输出；失败注入点写清楚。
5. **未证明的部分**：hash chain 不能证明“没有发生”；多文件 commit 不是内核级原子；外部副作用只能补偿；时钟假设。
6. **失败复盘**：至少一个真实 bug 的现象、根因、修复和回归测试。
7. **复现**：一条命令跑完 chaos，环境版本，10 分钟 demo 步骤。

## 常见错误

| 现象 | 原因 | 处理 |
|---|---|---|
| 10 个操作都是 shell 包装 | 没有原子性来源，只是换了个名字 | 每个操作写清“哪个内核原语保证” |
| 审计里只有模型说“完成了” | 记录的是自述，不是系统调用或文件变更 | 记录 `execve`、commit、fence 拒绝等内核侧事件 |
| 旧 owner 偶发写成功 | 租约只在客户端检查 | 把 epoch 检查放进存储端临界区 |
| 混沌测试都通过 | 只测了操作前后，没测中间窗口 | 在 `rename`、`fsync`、manifest 切换前后各注入一次 |
| 报告像 README | 列功能，没有可证伪的性质 | 每条主张配测试、证据和未证明部分 |
| demo 依赖网络 | 外部 API 一断就演不了 | 用 fake tool，离线跑完 |
| 快照里有凭证 | 把环境变量和配置目录一起拍了 | 排除 secrets，审计只记 hash |

## 调试手册

一次混沌运行应该是一个目录：

```bash
./chaos/run.sh --seed 7
ls runs/7
# audit.jsonl  events/  manifest/  report.json  stderr.log
```

先看 `report.json` 里哪条性质失败，再看对应 `events/` 的时间线；不要从 `stderr.log` 第一行开始读。固定 seed 能复现注入顺序，换 seed 只用于找偶发问题。

单个场景用 `strace` 看 syscall，但只开一个：

```bash
strace -ff -tt -e trace=clone,clone3,execve,openat,renameat2,fsync,pidfd_open,pidfd_send_signal \
  ./aosd --config runs/7/config.json 2> runs/7/strace.log
```

`strace` 会拖慢程序，不能当性能证据；它只用来确认 `rename`、`fsync`、`cgroup.kill` 的先后顺序。

审计对不上，先跑独立验证器，不要相信 daemon 自己的 `verify`：

```bash
./tools/audit-verify runs/7/audit.jsonl
# first bad seq: 42 (prev_hash mismatch)
```

`seq` 缺口说明丢事件；`prev_hash` 不匹配说明中间被改；整条链通过但尾部少了，说明需要锚点。三种情况报告里要分开写。

`terminate` 后还有残留，先看 cgroup：

```bash
CGROUP=/sys/fs/cgroup/aos/<task>
cat "$CGROUP/cgroup.events"
cat "$CGROUP/cgroup.procs"
```

`populated 1` 说明还有活进程；`cgroup.procs` 为空但目录还在，说明还要 `rmdir`，不是有进程。不要用 `ps | grep` 判断孤儿，PID 会复用，应该用 pidfd 和 cgroup。

## 提交前检查

- [ ] 顶层操作都有类型、幂等键、错误分类和证据（含 `budget.reserve`）；删到 8 个时写清删掉的性质。
- [ ] 混沌矩阵 10 条全部有结果，失败也有解释。
- [ ] 报告里的每条主张都能指到一条测试和一段原始输出。
- [ ] 没有真实凭证、生产 API 或用户数据进入工作区和审计。
- [ ] 一条命令能从空目录跑到 demo 结束。

## 自测问题

1. 如果 daemon 在 manifest `fsync` 之后、`rename` 之前崩溃，重启后应该看到哪个版本？为什么？
2. `exec` 为什么做不到严格的 exactly-once？幂等键覆盖的是哪一层？
3. 租约服务丢掉 epoch 计数器会发生什么？你怎么在系统层面防住？
4. 快照恢复后，哪些状态一定回不来？agent 怎么知道要重连？
5. 哪条混沌测试能抓住“commit 只对单文件原子”的实现？

### 答案要点

1. 应该看到旧版本；`rename` 还没发生，新 manifest 即使落盘也不可见。恢复逻辑要丢弃未切换的 staging。
2. 外部进程的副作用不在内核事务里；幂等键覆盖“重复请求只执行一次”，覆盖不了进程内部写到一半的状态。
3. token 回退，旧 owner 的写可能重新变成最大；要在授予前持久化 epoch，并在存储端保留 `max_epoch` 的单调性。
4. fd、socket、cgroup 归属、时钟、租约和外部副作用都回不来；`restore` 的返回值和审计要列出 `gaps`，planner 据此重连。
5. 两个文件、两个 reader、一个 commit 的并发测试；如果实现只保证单文件 `rename`，reader 会看到一新一旧。
