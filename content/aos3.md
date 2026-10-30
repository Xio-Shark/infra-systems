# AOS3 · Capability sandbox

> **课程**：[INFRA 03 · Agent OS](agent-os.html) · **实验 3/5**
>
> **先读**：[第 3 讲](agent-os.html#aos3)、[第 11 讲](agent-os.html#aos11) · **验收**：人工验收，清单见下
>
> [返回作业](labs.html) · [上一个：AOS2](aos2.html) · [下一个：AOS4](aos4.html)
>
> **难度** ★★★★ · **先修** AOS1 · **时间** 12–20 小时 · **最小通过** 句柄 + `openat2`；**完整通过** 衰减/撤销 + 逃逸测试

## 你将完成什么

这个实验把“你可以访问 `/home/user/project`”换成“你持有一个指向这个目录的句柄”。你要实现能力句柄（capability handle）的授予、派生、衰减、撤销和审计，然后用一组逃逸测试证明：没有句柄的路径进不去，有句柄也只能在句柄范围内活动。

验收看四组结果。第一组是衰减：从读能力派生写能力必须被拒绝，从工作区根派生出的子目录句柄打不开兄弟目录。第二组是撤销：撤销一个代理句柄后，下一次操作立刻返回 `denied`；已经复制出去的 fd 仍能读，这个负结果要如实记录，并说明你用杀进程兜底。第三组是逃逸矩阵：`..`、绝对路径、符号链接、`/proc/self/fd`、`fchdir`、bind mount、`chroot`、`open_by_handle_at`、`ptrace`、泄漏的继承 fd 全部被挡住。第四组是审计：给定一个能力，能查出谁在什么时候用它打开了哪个 inode。

跑通的样子：

```bash
cd ~/labs/aos3
./aos3 cap grant --subject agent-1 --path ws --rights read --ttl 10m
# cap_7f3a
./tests/escape.sh --all
# case=dotdot expect=EXDEV got=EXDEV DENIED
# case=fchdir expect=EACCES got=EACCES DENIED
# summary denied=11 escaped=0
```

## 开始之前

先读第 3 讲和第 11 讲。第 3 讲解释为什么路径不能当权限，第 11 讲给你操作信封和错误分类。你需要知道 `openat`、`SCM_RIGHTS`、`prctl`，并且跑过 AOS1 的 seccomp 阶段；没做过 AOS1 也能做，但要先补上“默认拒绝后放行哪些 syscall”的经验。

环境检查：

```bash
uname -r                                  # 5.13 以上才有 Landlock，5.6 以上有 openat2
./tests/probe-landlock                    # abi=1 或更高；或 unsupported
grep -E 'Seccomp|NoNewPrivs|CapEff' /proc/self/status
# Seccomp: 0（或 2）
# NoNewPrivs: 0
# CapEff: 000001ffffffffff
cat /proc/sys/kernel/yama/ptrace_scope    # 1
```

Landlock 是可选层，`unsupported` 不阻塞实验，但报告里要写清哪一层缺席。在 WSL2 上先跑探测，不要假设。目录布局：

```text
~/labs/aos3/
├── cmd/aos3/              # CLI
├── internal/cap/          # cap_t、能力表、衰减、撤销
├── internal/broker/       # 句柄代理、SCM_RIGHTS 传 fd
├── internal/sandbox/      # openat2、Landlock、seccomp、prctl
├── testdata/escape/       # 每个逃逸用例一个程序
└── tests/                 # 探测与验收脚本，不改
```

时间预算 12–20 小时。建议顺序：能力表 3 小时，fd 与 `openat2` 4 小时，seccomp 3 小时，Landlock 3 小时，撤销与审计 3 小时。

## 代码地图

`internal/cap/table.go` 是能力表：`grant`、`derive`、`revoke`、`lookup`，每个条目有 inode、权限位、过期时间和撤销代数。`cap/handle.go` 负责句柄编码与校验，句柄本身不可猜测，但只是查表键，不是内核对象。`broker/server.go` 接受 `cap_id`，执行代理操作；`broker/passfd.go` 用 `SCM_RIGHTS` 把工作区目录 fd 传给工具。`sandbox/openat2.go` 封装受限打开，`landlock_linux.go` 装规则，`seccomp.go` 装过滤器。

仓库 `starters/aos/aos3/tests/` 有 `cap.sh`、`escape.sh`、`revoke.sh`、`probe-landlock`；`starters/aos/aos3/testdata/escape/` 是逃逸程序源码（`go build -o testdata/escape ./testdata/escape`）。复制 `tests/` 和 `testdata/` 到 `~/labs/aos3/` 再用；它们只通过 CLI、继承 fd 和 Unix socket 与你的系统交互。

## 接口与数据流

能力分两层，混在一起会讲不清。控制面是 `cap_id`：agent 拿到的字符串，daemon 用它查表，决定能不能做某个操作，撤销就是删表。数据面是 fd：工作区目录的 `O_PATH` fd，通过 `SCM_RIGHTS` 传给工具，内核保证它指向真实 inode，不能伪造。控制面可撤销，数据面不能撤销；实验要求两条都实现，并对比。

**`cap_id` 本身不是安全边界，除非你把它和调用者身份绑起来。** 它只是一张表里的键：如果 broker 收到 `cap_id` 就执行，任何能连上 socket 的进程都能拿别人的句柄用。所以查表时必须同时校验"谁在问"：用 `getsockopt(fd, SOL_SOCKET, SO_PEERCRED, …)` 拿到对端的 pid/uid/gid（Linux 还有 `SO_PEERPIDFD`，能避免 pid 复用），把它和 `Cap.Subject` 对应的主体列表比对，不匹配就 `denied`。AOS1 的 daemon 也同理，`SO_PEERCRED` 是这类 Unix socket 服务的准入检查，不是可选项。

这也解释了为什么"句柄不可伪造"这个说法要限定范围：`cap_id` 不可**猜测**（随机串），但可**冒用**（别人拿到串就能用），除非加上对端身份校验。fd 才是不可伪造的——内核替你保证它指向哪个 inode。任务书要求两者都做，报告里要写清你用的是哪一种，以及漏掉身份校验时会发生什么。

```go
type Rights uint32
const (
    RightRead     Rights = 1 << iota
    RightWrite
    RightExec
    RightDelegate
)

type Cap struct {
    ID        string    // 不可猜测的查表键
    Subject   string    // agent 或任务
    Dev       uint64    // statx 的 st_dev
    Ino       uint64    // statx 的 st_ino
    Rights    Rights
    ExpiresAt time.Time
    Delegable bool
    Epoch     uint64    // 撤销代数
}
```

```json
{"op":"cap.grant","idem":"task-42/cap/1","args":{"subject":"agent-1","path":"ws","rights":["read"],"ttl_ms":600000,"delegable":false}}
{"status":"ok","result":{"cap_id":"cap_7f3a","dev":66306,"ino":1234567,"rights":["read"],"expires_at":"2026-10-29T12:00:00Z"},"evidence":"audit:3301"}
```

`cap.grant` 绑定一个已存在的 inode，不是绑定路径字符串；路径只用于审计展示。`cap.derive` 只能做两件事：把权限位取子集，或者把目录缩到某个子目录；新句柄的 `Delegable` 只能从 true 变 false。`cap.revoke` 删除条目并把 `Epoch` 加一，代理路径上下一次查表就失败。过期检查在每次查表时做，不靠后台扫描。

```text
agent ──cap_id──> aosd ──查表──> broker 操作 ──openat2(dirfd)──> 文件
          │
          └── SCM_RIGHTS(dirfd) ──> tool ──openat2(RESOLVE_BENEATH)──> 文件
```

看两条路径的差别：上面每次操作都经过 daemon，可以撤销；下面把 fd 直接交给工具，快，但交出去就收不回。

撤销能力要按对象分开说，不能一句“支持撤销”带过：

| 对象 | 能撤销吗 | 手段 | 残余 |
|---|---|---|---|
| `cap_id`（代理路径） | 能 | 删表，`Epoch` 加一；配合 `SO_PEERCRED` 校验调用者 | 无 |
| 已复制的 fd | 不能 | 只能杀持有进程 | 已打开的 fd 继续可读 |
| Landlock 规则 | 只能加严 | 再 `restrict_self` 一层 | 已打开的 fd、已 fork 的子进程 |
| 进程 | 能 | `pidfd_send_signal` 加 `cgroup.kill` | 已产生的外部副作用 |

三种机制要组合，单独用任何一种都有缺口。`openat2` 负责单次打开：`RESOLVE_BENEATH` 拒绝绝对路径和 `..` 逃逸，`RESOLVE_NO_MAGICLINKS` 拒绝 `/proc/self/fd` 这类魔法链接；越界返回 `EXDEV`，魔法链接返回 `ELOOP`。它只约束走 `openat2` 的调用，工具只要换成普通 `openat` 或先 `fchdir` 再打开相对路径，就绕过去了。

Landlock 负责进程级兜底：规则在 `exec` 前装好，之后所有打开都受约束，子进程继承，规则只能叠加不能放宽。它检查的是打开动作，已经打开的 fd 不受影响；`fchdir` 之后按绝对路径或 `..` 打开会被拒。seccomp 负责拿掉逃逸工具：`mount`、`umount2`、`pivot_root`、`ptrace`、`process_vm_readv`、`pidfd_getfd`、`open_by_handle_at`、`bpf`、`io_uring_setup` 这些都封掉。顺序是：`no_new_privs`，装 Landlock，装 seccomp，drop capabilities，清掉多余 fd，最后 `exec`。

逃逸矩阵如下，每一行都要有 `strace` 证据：

| 用例 | 动作 | 预期 | 挡住它的是谁 |
|---|---|---|---|
| `dotdot` | `openat2(dirfd, "../outside")` | `EXDEV` | `RESOLVE_BENEATH` |
| `abs` | `openat2(dirfd, "/etc/shadow")` | `EXDEV` | `RESOLVE_BENEATH` |
| `symlink` | 工作区内链接指向 `/etc/shadow` | `EXDEV` 或 `ELOOP` | `BENEATH` 或 `NO_SYMLINKS` |
| `magic` | `openat2(procfd, "3/../../etc/shadow")` | `ELOOP` | `RESOLVE_NO_MAGICLINKS` |
| `fchdir` | `fchdir(dirfd)` 后 `open("../../etc/shadow")` | `EACCES` | Landlock |
| `bind` | `mount --bind / /mnt` | `EPERM` | seccomp 加无 `CAP_SYS_ADMIN` |
| `chroot` | `chroot(x); chdir("../../..")` | `EPERM` | 无 `CAP_SYS_CHROOT`，配合 `pivot_root` |
| `handle` | `open_by_handle_at` | `EPERM` | 无 `CAP_DAC_READ_SEARCH` |
| `ptrace` | `pidfd_getfd` 或 `process_vm_readv` | `EPERM` | seccomp 加 Yama |
| `leak` | 读取意外继承的 fd 3 | 读不到 | `close_range` 加 `O_CLOEXEC` |
| `uring` | `io_uring_setup` 后发 `OPENAT` | `EPERM` | seccomp 封 `io_uring_setup` |

`procfd` 是预先打开的 `/proc/self/fd` 目录 fd；绝对路径会先被 `BENEATH` 拒成 `EXDEV`。`fchdir` 这一行是重点：只做 `openat2` 的系统会在这一行失败，这正是“单次检查不等于权限边界”的证据。

## CLI 契约 {#cli}

`tests/` 下的脚本只通过下面这些命令和你说话；参数名可以不同，语义必须一致。所有命令 stdout 是单行 JSON，成功退出 0。

| 命令 | 语义 |
|---|---|
| `aos3 cap grant --subject S --path DIR --rights read[,write] --ttl 10m` | 返回 `{"cap_id":…,"dev":…,"ino":…,"subject":…,"rights":…,"expires":…}` |
| `aos3 cap derive --cap C --path SUB --rights read` | 派生只能收窄；加宽返回 `{"status":"denied"}` 且退出非零 |
| `aos3 cap revoke --cap C` | 撤销代理句柄，下一次调用立刻失效 |
| `aos3 cap list` | 列出存活句柄；已撤销的不出现 |
| `aos3 cap probe --pid P` | 报告该进程持有的 fd 是否仍可读：`{"fd_still_reads":0|1}` |
| `aos3 open --cap C --path P [--hold D]` | 用句柄打开文件；`--hold` 让进程持 fd 一段时间（用于撤销对照） |
| `aos3 kill --pid P` | `pidfd_send_signal` + `cgroup.kill`，并等到 `cgroup.events` 的 `populated=0` |
| `aos3 audit --cap C [--since 10m]` | 列出该句柄的全部使用事件 |

`testdata/escape` 是一个可执行文件，按 argv[1] 选一个逃逸用例（`dotdot`、`abs`、`symlink`、`magic`、`procfd`、`fchdir`、`chroot`、`bind`、`handle`、`ptrace`、`processvm`、`uring`、`leak`）。它从 fd 3 拿到能力目录，只用 `openat2(RESOLVE_BENEATH|RESOLVE_NO_MAGICLINKS)` 打开，并把结果压成一行：

```text
DENIED EXDEV dotdot      内核拒绝（期望）
ESCAPED opened ../etc    成功了（逃逸）
ERROR ENOSYS uring       既不是拒绝也不是逃逸（过滤器坏了）
```

`tests/escape.sh` 只接受 `DENIED`；`ESCAPED` 和 `ERROR` 都判失败，因为后者通常意味着你的过滤器把系统调用变成了 `ENOSYS`，看起来"被挡住"其实是功能坏了。

## 阶段拆解

阶段 1 做能力表，不传 fd。实现 `cap.grant`、`cap.derive`、`cap.revoke`、`cap.list`，用 JSON 请求。跑 `./tests/cap.sh`：派生到子目录成功、加宽被 `denied`、过期句柄被拒、撤销后 `cap list` 里不再出现。派生一个权限更大的句柄必须返回 `denied`，不是悄悄截断。

阶段 2 把 fd 交给工具。`cap.grant` 返回 `cap_id` 和 `dev/ino`，代理路径用 `SCM_RIGHTS` 传 `O_PATH|O_DIRECTORY` fd。工具所有打开都走 `openat2`，相对这个 fd。跑 `./tests/escape.sh --cases dotdot,abs,symlink,magic`，预期四行 `DENIED`（绝对路径是 `EXDEV`），`strace` 里的 errno 与表一致。

阶段 3 加 seccomp。默认拒绝，放行 `execve`、`openat`、`read`、`write`、`mmap`、`brk`、`exit_group` 和 Landlock 所需 syscall；封掉上表里的逃逸工具。跑 `./tests/escape.sh --cases bind,handle,ptrace`，预期 `DENIED EPERM`；`grep Seccomp /proc/<工具>/status` 为 2。

阶段 4 加 Landlock。用 `landlock_create_ruleset` 建规则，只允许工作区目录的读写和 `/usr`、`/lib` 的执行，`no_new_privs` 后 `restrict_self`，再 `exec`。跑 `./tests/escape.sh --case fchdir`，有 Landlock 时 `DENIED EACCES`，没有时输出 `ESCAPED`；这个对照要写进报告（脚本会把 `ESCAPED` 判失败，所以没装 Landlock 时用 `AOS_ESCAPE` 指向一个未加固的构建做对照，而不是让脚本放行）。`tests/probe-landlock` 输出 `abi=1` 或更高，规则按支持的权限位降级。

阶段 5 做撤销。撤销代理句柄后立刻调用一次操作，预期 `denied`；再让一个工具持有已传出的 fd，撤销后它仍能读，记录 `fd_still_reads=1`，然后 `pidfd_send_signal` 加 `cgroup.kill` 结束它，确认 `populated=0`。跑 `./tests/revoke.sh`：撤销后 broker 立刻拒绝、持有 fd 的进程如实报 `fd_still_reads=1`、随后被杀且 `populated=0`。

阶段 6 补齐审计和矩阵。每次能力使用写一条事件：时间、subject、cap_id、inode、操作、结果、errno。跑 `./tests/escape.sh --all`，最后一行应是 `summary denied=13 escaped=0 errors=0`（环境不支持的用例计入 `skip`）；`./aos3 audit --cap cap_7f3a` 能列出该能力的全部使用。

## 验收清单

没有 judge，人工验收。提交 `evidence/`，每个用例一个子目录，包含 `cmd.txt`、`out.txt`、`strace.txt`、`notes.md`。清单：

- [ ] `cap.grant` 返回句柄、dev/ino、权限和过期时间；授权判断不看路径。
- [ ] broker 用 `SO_PEERCRED`（或 `SO_PEERPIDFD`）校验调用者身份：用另一个 uid 的进程拿 `cap_id` 调用必须 `denied`。
- [ ] 派生更大权限返回 `denied`；派生到子目录后打不开兄弟目录；`Delegable=false` 的句柄不能转交。
- [ ] 过期句柄和已撤销句柄的下一次操作都返回 `denied`。
- [ ] 逃逸矩阵每行都有 errno 和 `strace`，`escaped=0`。
- [ ] 撤销代理句柄立即生效；fd 残余如实记录，并有杀进程的证据。
- [ ] 审计能回答“谁在什么时候用哪个能力打开了哪个 inode”。
- [ ] 工具进程没有计划外的 fd（能力 fd 和控制 socket 除外）。
- [ ] 报告逐条说明哪个机制挡住哪个用例。
- [ ] 300 字复盘，按[评分标准](grading.html#reflection)的五问。

## 常见错误

| 现象 | 原因 | 处理 |
|---|---|---|
| `openat2: ENOSYS` | 内核低于 5.6，或 seccomp 拦了 `openat2` | 换内核；放行 syscall 437（x86_64 架构） |
| 越界返回 `EXDEV` 而不是 `EACCES` | 这是 `RESOLVE_BENEATH` 的正常语义 | 按 errno 断言，不要改成 `EACCES` |
| 只做 `openat2`，`fchdir` 用例逃了 | 普通 `openat` 不受 `openat2` 约束 | 加 Landlock；全封 `openat` 会破坏动态链接器，不要这么做 |
| Landlock 返回 `EOPNOTSUPP` | 内核没编译或启动时禁用了 Landlock | 降级到 seccomp 加 `openat2`，报告里写明 |
| Landlock 装了但没生效 | 在 `exec` 之后才装，或没设 `no_new_privs` | 在子进程 `exec` 前装；先 `prctl(PR_SET_NO_NEW_PRIVS, 1)` |
| 工具能读继承的 fd | 没关多余 fd，或没设 `O_CLOEXEC` | `close_range(3, ~0, 0)`，只留能力 fd |
| seccomp 默认拒绝后程序起不来 | 没放行动态链接器需要的 syscall | 先 allowlist 最小集合；调试用 `SECCOMP_RET_LOG` |
| 撤销后 fd 还能读 | 这是内核 fd 的语义，不是 bug | 代理路径负责撤销，fd 路径用杀进程兜底 |
| 删文件后旧句柄仍可用 | 句柄绑定 inode，删除不影响已打开对象 | 记录残余风险；必要时按 inode 重新校验 |
| 审计只有 cap_id 没有 inode | 事件字段不全 | 记录 dev/ino、操作和 errno |

## 调试手册

先复现单个用例：`./tests/escape.sh --case fchdir 2>&1 | tee /tmp/aos3-fchdir.log`。看 `expect`、`got` 和 `DENIED/ESCAPED` 三行。

syscall 看 `strace`：

```bash
strace -f -e trace=openat2,openat,fchdir,mount,chroot,ptrace,pidfd_getfd,seccomp,prctl \
  -o /tmp/aos3.strace ./testdata/escape/fchdir
```

`openat2` 返回 `EXDEV` 说明路径被 `BENEATH` 拒绝；返回 `EACCES` 多半是 Landlock；`EPERM` 多半是 seccomp 或缺 capability。三个来源要分清，报告里不能都写成“被沙箱挡住”。

状态看 `/proc/<pid>/status` 的 `Seccomp`、`NoNewPrivs`、`CapEff`，`/proc/<pid>/fd` 看有没有多余 fd，`/proc/<pid>/fdinfo/<fd>` 看 flags。Landlock 的拒绝通常进内核审计，`dmesg -T | tail` 或 auditd 能看到，取决于配置；seccomp 杀进程时退出信号是 `SIGSYS`（x86_64 上是 31）。

审计日志用 `./aos3 audit --cap cap_7f3a --since 10m` 查，每条要能和 `strace` 的时间对上。撤销后先查表，再查进程：表里没了但进程还在读，说明你只撤了控制面；这正是要记录的现象。收尾时用 `cgroup.events` 确认 `populated=0`。

## 提交前检查

- [ ] 能力表按 inode 绑定，路径只用于展示。
- [ ] 派生只能收窄，代码里有一处统一的检查，不是每个 handler 各写一遍。
- [ ] 逃逸矩阵全部有 `strace` 证据，`escaped=0`。
- [ ] 撤销的两种语义都实现并写清，没有把 fd 残余说成“已撤销”。
- [ ] 审计字段齐全，能按 cap、subject、inode 查询。
- [ ] 没有把 `chroot` 当安全边界，容器根用 `pivot_root`。
- [ ] 300 字复盘写完。

## 自测问题

1. 为什么路径字符串不能当 capability？
2. `SCM_RIGHTS` 保证什么，不保证什么？
3. 为什么已经复制出去的 fd 无法撤销？
4. Landlock 比 `openat2` 多做什么？
5. 为什么 seccomp 单独不能做文件权限？
6. 怎么证明衰减没有放大权限？
7. 句柄绑定 inode，文件删除后 inode 被复用什么风险？
8. 为什么要屏蔽 `io_uring`？

### 答案要点

1. 路径可以被符号链接、bind mount、`/proc/self/fd` 改写，检查和使用之间还有 TOCTOU；路径也不携带身份和撤销语义。
2. 保证接收方拿到同一个打开文件描述的副本，句柄不可伪造；不保证权限被收窄，也不保证你能收回。
3. 内核没有“撤销任意 fd”的操作，你只能关掉自己那份；对方的副本仍然指向同一个 inode，除非杀掉对方或从一开始就走代理。
4. `openat2` 只管走它的那次调用；Landlock 是进程级规则，约束之后所有打开，子进程继承，不能被普通 `openat` 绕过。
5. seccomp 看得到 syscall 号和标量参数，看不到路径字符串的内容；按路径做策略会落进 TOCTOU。
6. 构造“派生更大权限”“派生兄弟目录”“过期后再用”“撤销后再用”四组反例，全部应失败，并保留返回值和审计。
7. 删除后 inode 可能被新文件复用，旧句柄会指向新内容；`statx` 不暴露 inode generation，需要挂载 id 或重新校验，具体能力。
8. `io_uring` 的打开操作不经过逐 syscall 的 seccomp 检查；Landlock 是否覆盖取决于内核版本，最稳的做法是直接封掉 `io_uring_setup`。
