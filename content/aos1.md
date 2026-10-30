# AOS1 · Typed ABI and sandboxed exec

> **课程**：[INFRA 03 · Agent OS](agent-os.html) · **实验 1/5**
>
> **先读**：[第 1 讲](agent-os.html#aos1)、[第 2 讲](agent-os.html#aos2)、[第 5 讲](agent-os.html#aos5) · **验收**：人工验收，清单见下
>
> [返回作业](labs.html) · [下一个：AOS2](aos2.html)
>
> **难度** ★★★★ · **先修** Linux/Go + INFRA 01 Lab 1–4 + INFRA 02 CN1–CN2 · **时间** 12–20 小时 · **最小通过** `spawn`/`exec` + 一组隔离；**完整通过** ABI 表 + 四组可观察行为

## 你将完成什么

这个实验要做出一个最小的 Agent OS 执行面：一个 Unix socket daemon（叫 `aosd`），加上一个 CLI（叫 `aosctl`）。你用它创建任务、在任务里跑命令、限制命令能用的资源，并且拿到结构化的结果和审计证据。验收不看代码行数，看四组可观察行为。

第一组是 ABI：`aosctl exec` 发出一个带 `abi`、`op`、`idem`、`cap`、`deadline_ms` 的请求，收到 `status`、`result`、`effects`、`evidence` 五个字段齐全的 JSON。第二组是隔离：在任务里运行 `cat ~/.ssh/id_rsa` 必须失败，而且失败来自内核，不是测试工具自己打印的假错误。第三组是资源：一个申请 512 MiB 的测试程序在 `memory.max=128M` 下被 OOM killer 杀掉，退出码 137，`memory.events` 里 `oom_kill` 至少为 1。第四组是幂等：同一个 `idem` 第二次提交，返回同一个结果，测试工具写的计数器仍然只有 1。

跑通的标志是一条命令加一段输出：

```bash
cd ~/labs/aos1
./aosctl exec --idem demo/exec/1 -- /bin/sh -c 'echo hi > out.txt'
```

```json
{"status":"ok","result":{"exec_id":"e-01J8Z3K4M","exit":0,"stdout_sha256":"b1946ac92492d2347c6235b4d2611184"},"effects":[{"kind":"file.write","path":"out.txt"}],"evidence":"audit:9f31"}
```

## 开始之前

先读第 1、2、5 讲。第 1 讲给你操作表的七个字段，第 2 讲让你决定哪些原子性由内核保证，第 5 讲给你进程生命周期和取消协议。seccomp 和 `openat2` 的边界在第 3 讲，做阶段 4 前补一下。做过 INFRA 02 的 CN1–CN2（namespace、cgroup、rootfs），或者在其他地方写过 `clone` 和 `cgroup.procs`，就够用了。

环境是一次性的 Linux VM 或 WSL2（Ubuntu 24.04），有 root。检查命令和预期输出：

```bash
uname -r                                  # 6.8.0-xx-generic 或更新
stat -fc %T /sys/fs/cgroup                # cgroup2fs
cat /sys/fs/cgroup/cgroup.controllers     # cpuset cpu io memory pids
go version                                # go1.22 或更新
cat /proc/sys/kernel/yama/ptrace_scope    # 1（没有这个文件也行）
```

`cgroup.controllers` 至少要有 `memory` 和 `pids`；没有 `cgroup2fs` 说明系统还在 cgroup v1，先换环境。WSL2 的 Landlock 可能不可用，AOS1 不依赖它，用 seccomp 加 `openat2` 即可。目录这样放：

```text
~/labs/aos1/
├── cmd/aosd/            # daemon 入口
├── cmd/aosctl/          # CLI
├── internal/abi/        # 请求/响应类型、操作表
├── internal/daemon/     # 分发、幂等表、审计
├── internal/sandbox/    # clone3、namespace、cgroup、seccomp
├── internal/exec/       # 任务内执行与输出收集
├── testdata/fake-tool/  # 写文件、分配内存、读 ~/.ssh 的测试程序
└── tests/               # 验收脚本，不改
```

时间预算 12–20 小时，分四次做：ABI 与回环 3 小时，`spawn` 与 namespace 4 小时，cgroup 3 小时，seccomp 与生命周期 5 小时。第一次做内核实验通常取上限。

## 代码地图

`internal/abi/ops.go` 是唯一的协议真相源：操作名、参数类型、`Status`、`ErrorClass`、操作表都放这里，daemon 和 CLI 都 import 它。`internal/daemon/server.go` 负责接受连接、解码请求、按 `op` 分发；`idem.go` 是持久化幂等表；`audit.go` 追加写审计事件。`internal/sandbox/spawn_linux.go` 里是创建任务的代码，`cgroup.go` 管控制组，`seccomp.go` 装过滤器，`exec/exec.go` 在任务内跑命令、收 stdout。

仓库 `starters/aos/aos1/tests/` 里有现成的验收脚本，复制到 `~/labs/aos1/tests/` 再用。它们只通过 Unix socket 和 `aosctl` 说话，不 import 你的内部包；socket 路径用 `$XDG_RUNTIME_DIR/aos1.sock`，脚本会设这个变量。`starters/aos/aos1/testdata/fake-tool/` 是同目录配套的测试工具（`hog` 分配内存、`read` 读文件），`go build -o testdata/fake-tool ./testdata/fake-tool` 即可。脚本的契约和边界见 `starters/aos/README.md`。

## CLI 契约 {#cli}

`starters/aos/aos1/tests/run.sh` 只通过下面这些命令和你说话；参数名可以不同，语义必须一致。`aosctl` 的 stdout 是单行 JSON，含 `status`、`result`、`effects`、`evidence` 四个字段。

| 命令 | 语义 |
|---|---|
| `aosctl exec --idem KEY [--memory 128M] -- CMD…` | 执行命令并返回结构化结果；同一个 `KEY` 重复提交返回同一个 `exec_id`，命令不重复执行 |
| `aosctl terminate --exec ID` | 结束一次执行（先 `SIGTERM`，超时 `cgroup.kill`） |
| `aosctl spawn` | 只创建任务沙箱，不执行命令；返回 `task_id`、pidfd、cgroup 路径 |
| `aosctl daemon restart` | 重启 daemon 并保留持久化幂等表（可选；没有时 lifecycle 用例会 SKIP） |

`result` 里至少要能取到 `exec_id`、`exit`、`stdout`；`evidence` 是非空字符串（审计 id）。`stdout_sha256` 是加分项，脚本在缺失时记为 SKIP 而不是失败。

## 接口与数据流

先把 `spawn` 和 `exec` 分开。`spawn` 创建任务沙箱：daemon 调用 `clone3`，带上 `CLONE_PIDFD` 和 `CLONE_NEWPID|CLONE_NEWNS|CLONE_NEWNET|CLONE_NEWIPC`。子进程在 clone 时就进入新 namespace，但会先阻塞在一条同步管道上；daemon 在宿主侧把它的 TID 写进新建的 cgroup，设好 `memory.max`、`pids.max`，再关闭管道放行。`spawn` 返回任务句柄：`task_id` 和任务 init 的 pidfd，pidfd 通过 `SCM_RIGHTS` 随响应一起传回；cgroup 路径只用于观测，daemon 内部保留目录 fd。pid 只作为日志字段，不能拿来发信号。

`exec` 不创建 namespace，也不改 cgroup。它把命令交给任务里的 init 进程，由 init 在沙箱内 `fork`/`exec`，所以命令由 init 创建，天然继承同一组 namespace 和 cgroup。daemon 不 `setns` 进沙箱，因为多线程进程里 `setns` 只影响调用线程，容易把 Go runtime 的线程状态弄乱。`exec` 返回执行句柄：`exec_id`、命令的 pidfd、审计 id；命令退出或到达截止时间时返回结果。

```text
aosctl ──JSON + SCM_RIGHTS──> aosd ──clone3(helper)──> task init（新 PID/mount/net ns）
                                │                          │
                                ├── 写 cgroup.procs ───────┤
                                └── exec 请求 ────────────> fork/exec 命令（同一 cgroup）
```

看两件事：pidfd 由 daemon 创建并转交，cgroup 由 daemon 内部管理。命令进程由 task init 创建，不是 daemon 直接 `fork`。

操作表按第 1 讲的七个字段写。这张表是接口，不是实现；每一行都要能回答“凭什么”。

| 操作 | 线性化点 | 前置条件 | 后置条件 | 幂等键 | 副作用 | 结构化错误 | 证据 |
|---|---|---|---|---|---|---|---|
| `spawn` | 同步管道关闭、子进程继续执行的那一刻 | cap 含 `task.create`；预算足够；cgroup 可创建 | 任务 init 可执行；cgroup 有 1 个进程；pidfd 有效 | `task/spawn/N` | 创建进程、cgroup、审计事件 | `denied`、`invalid`、`internal` | `audit:spawn` 含 task_id、pid、cgroup |
| `exec` | 命令 `execve` 成功的那一刻 | 任务存在且 `running`；cap 含 `exec`；argv 在限额内 | 命令进程在任务 cgroup 中；stdout 已归档；exit 已知或 `timeout` | `task/exec/N` | 创建子进程、写 stdout、文件副作用 | `denied`、`invalid`、`timeout`、`indeterminate` | `audit:exec` 含 exec_id、argv hash、exit |
| `status` | 读取任务状态快照的那一刻 | task_id 存在 | 返回 `running`/`exited`/`cancelled` 与 exit | 无（只读） | 无 | `invalid` | 返回快照的 audit 序号 |
| `terminate` | `cgroup.kill` 写入成功，或确认任务已无活进程 | 任务存在；cap 含 `task.kill` | 任务树无活进程；`populated=0`；已回收 | `task/terminate/N` | 杀进程；可能丢未 flush 输出 | `denied`、`invalid`、`conflict` | `audit:terminate` 含信号、耗时、`populated` |
| `audit.query` | 返回事件列表的那一刻 | cap 含 `audit.read`；范围覆盖 task | 返回按序事件 | 无（只读） | 无 | `denied` | 每条事件的 `prev_hash` |

请求和响应都用同一个信封。Go 结构体草图如下，字段可以加，不能少：

```go
type Status string
const (
    StatusOK            Status = "ok"
    StatusError         Status = "error"
    StatusTimeout       Status = "timeout"
    StatusIndeterminate Status = "indeterminate"
)
type ErrorClass string
const (
    ErrInvalid       ErrorClass = "invalid"
    ErrDenied        ErrorClass = "denied"
    ErrConflict      ErrorClass = "conflict"
    ErrRetryable     ErrorClass = "retryable"
    ErrIndeterminate ErrorClass = "indeterminate"
    ErrInternal      ErrorClass = "internal"
)

type Request struct {
    ABI        string          `json:"abi"`         // "aos/1"
    Op         string          `json:"op"`
    Idem       string          `json:"idem"`
    Cap        string          `json:"cap"`
    Args       json.RawMessage `json:"args"`
    DeadlineMS int64           `json:"deadline_ms"`
}
type Response struct {
    Status   Status          `json:"status"`
    Error    *Error          `json:"error,omitempty"`
    Result   json.RawMessage `json:"result,omitempty"`
    Effects  []Effect        `json:"effects"`
    Evidence string          `json:"evidence"`
}
type SpawnResult struct {
    TaskID    string `json:"task_id"`
    Pid       int    `json:"pid"`        // 仅日志，不用来发信号
    Cgroup    string `json:"cgroup"`
    PidfdSent bool   `json:"pidfd_sent"` // fd 走 SCM_RIGHTS
}
type ExecResult struct {
    ExecID       string `json:"exec_id"`
    Exit         int    `json:"exit"`
    Signal       int    `json:"signal,omitempty"`
    StdoutPath   string `json:"stdout_path"`
    StdoutSHA256 string `json:"stdout_sha256"`
}
```

一次 `spawn` 请求和响应：

```json
{"abi":"aos/1","op":"spawn","idem":"task-42/spawn/1","cap":"cap_7f3a","args":{"profile":"default","memory_max":134217728,"pids_max":64},"deadline_ms":5000}
{"status":"ok","result":{"task_id":"t-01J8","pid":4211,"cgroup":"/aos.slice/t-01J8","pidfd_sent":true},"effects":[],"evidence":"audit:1201"}
```

`exec` 的 `args` 带 `task_id`、`argv`、`timeout_ms`。stdout 不内联，落到 `artifacts/<exec_id>/stdout`，响应只给路径和 sha256，避免大输出把 JSON 撑爆。

## 阶段拆解

阶段 1 只做 ABI 和回环。写 `abi` 包、Unix socket server、内存幂等表；`exec` 先在 daemon 自己的 namespace 里 `fork/exec`，不隔离、不限资源。跑上面的 `echo hi`，预期 `status=ok`、`exit=0`、`out.txt` 内容正确；重复同一条命令，`exec_id` 不变，计数器为 1。这个阶段通过的标准是错误分类和证据字段都在。

阶段 2 加 `spawn` 和 namespace。写一个短命 helper 调 `clone3`，Go daemon 通过它创建任务，避免在 runtime 线程里直接依赖 `unshare` 的线程语义。子进程先等同步管道，daemon 拿到 pidfd 后放行。跑 `./aosctl spawn`，然后：

```bash
cat /proc/<pid>/status | grep NSpid
# NSpid:	4211	1
readlink /proc/<pid>/ns/pid
readlink /proc/self/ns/pid   # 两个 inode 不同
```

`NSpid` 有两个值，说明 PID namespace 生效；第二个值是 1，说明它是新 namespace 的 init。mount namespace 只有配上 `pivot_root` 才有意义，用 CN1 的 rootfs，或者 busybox 建一个最小根，`ls /` 应只看到 `bin dev proc tmp`。

阶段 3 加 cgroup。在 daemon 的 delegated 子树下 `mkdir` 任务目录，把子进程 TID 写进 `cgroup.procs`，再写 `memory.max` 和 `pids.max`。注意 cgroup v2 的 no internal process 约束：父 cgroup 不能既放进程又开控制器，先把 daemon 自己的进程放到父级的子 cgroup，再在父级写 `cgroup.subtree_control`。跑 `testdata/fake-tool hog 512MiB`，预期退出码 137，`memory.events` 里 `oom_kill 1`。如果进程活下来，先看 `/proc/<pid>/cgroup` 是不是你写的那个目录。

阶段 4 加 seccomp 和 `openat2`。测试工具在 exec 前装 seccomp：默认拒绝，放行 `execve`、`openat`、`openat2`、`read`、`write`、`mmap`、`brk`、`exit_group` 等最小集合；同时把每次文件打开改成 `openat2(dirfd, path, RESOLVE_BENEATH|RESOLVE_NO_MAGICLINKS)`。跑 `testdata/fake-tool read ~/.ssh/id_rsa`，预期 `EACCES` 或 `EXDEV`，`strace` 里能看到拒绝发生在内核。`grep -E 'Seccomp|NoNewPrivs' /proc/<pid>/status` 应为 `Seccomp: 2` 和 `NoNewPrivs: 1`。

阶段 5 加生命周期和持久化。`terminate` 先 `pidfd_send_signal(SIGTERM)`，等 2 秒，再写 `cgroup.kill`，最后等 `cgroup.events` 的 `populated` 变 0。把幂等表落到磁盘，daemon 重启后同一个 `idem` 仍返回旧结果。

`waitid(P_PIDFD)` 在这里会用不了：命令进程是 task init `fork` 出来的，daemon 不是它的父进程，`waitid` 返回 `ECHILD`。能回收它的是 task init —— 让 init 当 subreaper（或直接作为它的父进程）并负责 `wait4`，把退出码和 `ru_*` 通过 socket 报回 daemon。daemon 侧只观察：`pidfd` 的 `poll` 变成可读说明进程已退出，`cgroup.events` 的 `populated=0` 说明整棵进程树都没了。回收责任落在 init 上，daemon 负责记账和超时兜底（超时就 `cgroup.kill`，再由 init 回收）。

跑 `./tests/run.sh lifecycle`，它要求重启 daemon 后同一个 `idem` 仍返回旧结果；实现没有 `daemon restart` 子命令时脚本会 `SKIP` 并提示手工验证。

## 验收清单

没有 judge，人工验收。提交一个 `evidence/` 目录，每个用例一个子目录，里面有 `cmd.txt`（你跑的命令）、`out.txt`（完整输出）、`notes.md`（三句话解释你看到了什么）。清单：

- [ ] `spawn` 的证据包含 `task_id`、pidfd 编号、cgroup 路径，以及 `NSpid` 的两行输出。
- [ ] `exec` 的证据包含 `exit`、stdout 的 sha256、audit id；重复请求的 `exec_id` 相同。
- [ ] `ssh-denied`：工具读 `~/.ssh/id_rsa` 失败，`strace` 显示 `EACCES`/`EXDEV`，且测试工具没有吞掉错误。注意 rootfs 若是最小根，`~/.ssh/id_rsa` 在沙箱里本就不存在，这只能证明"读不到"，证明不了"路径守卫生效"——要证明后者，把宿主的一个已知文件 bind 进沙箱或在工作区内放同样的内容再读。
- [ ] `oom`：退出码 137，`memory.events` 的 `oom_kill` 至少为 1。
- [ ] `terminate`：`populated=0`，task init 回收了所有子进程（`wait4` 成功或进程表里没有 `<defunct>`），进程表里没有残留。
- [ ] `restart-idem`：重启 daemon 后同一 `idem` 不重复执行。
- [ ] 接口表七个字段齐全，`spawn`/`exec` 的创建者、namespace、cgroup、句柄写清楚。
- [ ] 300 字复盘，按[评分标准](grading.html#reflection)的五问。

## 常见错误

| 现象 | 原因 | 处理 |
|---|---|---|
| `clone3: EPERM` 或 `EINVAL` | 外层容器或发行版的 seccomp 拦了 `clone3`；或 flags 组合不合法 | 在 VM 里跑，不要在 Docker 默认 profile 里嵌套；用 `strace -f -e clone3` 看返回值 |
| `NSpid` 只有一个值 | 没设 `CLONE_NEWPID`，或读的是父进程的 status | 确认 clone flags，读 `/proc/<任务 init>/status` |
| 写 `cgroup.procs` 报 `ENOENT` | 父级没开 `+memory +pids`，子目录不存在 | 先写父级 `cgroup.subtree_control`，再 `mkdir` |
| 写了 `memory.max` 但没被杀 | 进程不在这个 cgroup，或限制在分配之后才生效 | 看 `/proc/<pid>/cgroup`；用同步管道保证 exec 前写好 |
| seccomp 装上后 `execve` 直接失败 | 默认拒绝但没放行动态链接器和 `execve` | 先放行最小集合；调试时用 `SECCOMP_RET_LOG` 看缺哪个 |
| `openat2: ENOSYS` | 内核低于 5.6，或 seccomp 拦了 `openat2` | 换内核；或在过滤器里放行 syscall 437（x86_64 架构） |
| 第二次 `exec` 又跑了一遍 | 幂等表只在内存，或键里带了随机数 | 持久化 `idem -> result`，键绑定 task、序号、参数 hash |
| daemon 退出后任务还在 | 只杀了 init，没杀 cgroup | `cgroup.kill` 后等 `populated=0` |

## 调试手册

先只跑一个用例并留日志：`./tests/run.sh spawn 2>&1 | tee /tmp/aos1-spawn.log`。看最后 30 行，确认是卡住、拒绝还是通过。

进程创建看 `strace`：

```bash
strace -f -e trace=clone3,execve,openat2,pidfd_open,pidfd_send_signal,waitid \
  -o /tmp/aos1.strace ./aosd
```

`clone3` 的返回值是子进程 TID；`execve` 之前应该先看到写 `cgroup.procs`。如果 `execve` 在 cgroup 写入之前发生，同步管道没起作用。

状态看 `/proc`：`NSpid` 确认 namespace，`Seccomp` 和 `NoNewPrivs` 确认过滤器，`CapEff` 确认 capability 已 drop，`/proc/<pid>/cgroup` 确认 cgroup 归属。pidfd 本身是匿名 inode，`ls -l /proc/<daemon>/fd` 能看到 `anon_inode:[pidfd]`；对 pidfd `poll` 在进程变成僵尸时可读；被 `wait4` 真正回收（由 task init 做）之后变成 `POLLHUP`。daemon 自己 `waitid` 会拿到 `ECHILD`，不要用它来判断回收完成。

cgroup 看三个文件：`cgroup.events` 的 `populated`、`memory.events` 的 `oom_kill`、`memory.current` 的实时用量。取消后 `populated` 迟迟不变 0，说明有子进程逃到了别的 cgroup，或者 init 没死。审计日志按 task_id 查：`./aosctl audit --task t-01J8`，每条事件要能和 `strace` 的时间对上；对不上就说明有路径绕过了 daemon。

## 提交前检查

- [ ] 操作表七个字段齐全，错误是枚举不是字符串。
- [ ] `spawn` 和 `exec` 的语义在 README 里用一段话讲清楚：谁建进程、谁进 namespace、谁写 cgroup、返回什么句柄。
- [ ] 幂等表持久化，重启后仍生效。
- [ ] `tests/` 没改，证据目录能按命令重放。
- [ ] 没有把 pid 当句柄；所有信号走 pidfd。
- [ ] 300 字复盘写完。

## 自测问题

1. `spawn` 返回 pidfd 而不是 pid，解决了什么？
2. 为什么 cgroup 要在子进程 exec 之前写入？
3. `exec` 为什么让 task init 创建子进程，而不是 daemon `setns` 进去？
4. 为什么 fd 不能放在 JSON 里？
5. 同一个 `idem` 第二次请求应该返回什么？
6. seccomp 默认拒绝后，为什么必须先放行 `execve`？

### 答案要点

1. pid 会被复用，信号可能打到无关进程；pidfd 绑定到具体任务，`poll`、`waitid`、`pidfd_send_signal` 都没有这个竞态。
2. 否则命令在限制生效前就开始跑，可能已经分配了内存或创建了子进程；同步管道把“限制写好”变成 exec 的前置条件。
3. 多线程进程里 `setns` 只改变调用线程的 namespace，其他线程仍在旧 namespace；init 已经在沙箱内，由它 fork 最简单，也避免 daemon 进入不可信 namespace。
4. fd 是进程内的整数，跨进程没有意义，而且可伪造；`SCM_RIGHTS` 让内核复制同一个打开文件描述，接收方拿到的是真句柄。
5. 返回第一次的结果和同一条证据，不再执行副作用；响应可以重复，效果只能一次。
6. `execve` 要加载 ELF 和动态链接器，默认拒绝会把它一起挡掉；allowlist 必须包含加载和启动所需的最小 syscall 集合。
