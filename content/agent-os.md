# INFRA 03 · Agent OS

> **这是一门探索课，不是主流结论。**
>
> Agent OS 目前没有公认的定义、标准接口或成熟产品。本页提出的操作表、原子性主张和系统结构，都是研究性假设，可能不成立，也可能被更好的方案取代。课程要求你论证、实现、反驳，而不是把这些内容当成事实。
>
> 12 讲 · 5 个实验 + capstone · Linux/WSL2
>
> 核心实验只依赖内核原语：namespace、cgroup v2、overlayfs、seccomp、pidfd。不需要 GPU、KVM 或 Firecracker。

## 课程说明

今天的 agent 大多通过用户空间的接口操作计算机：`bash -c "..."`、HTTP 请求、浏览器点击、JSON 工具调用。这种方式很灵活，但不可靠。执行 `rm -rf build && make` 时，内核只看到一串字符串，不知道这些命令属于哪个任务。一个“写文件、调 API、更新数据库”的任务，第二步成功、第三步失败，没有可以恢复的检查点。一个工具继承了 shell 的全部权限，路径检查还存在 TOCTOU（检查与使用之间有时间差）；最后 agent 说“完成了”，你却没有证据。

Agent OS 不解决“让 agent 更聪明”的问题。它解决的是：**让 agent 的操作具备原子性、权限边界、幂等性和可验证的执行记录**。它不是再包一层 tool calling，也不是在用户空间模拟一个 OS；它把 agent 需要的操作交给内核执行，并定义一组新的原子操作，让 LLM 调用。

这里的“底层”指三件事：

1. **原子性由内核保证**，不靠 prompt 约束。`rename`、`cgroup.kill`、`pidfd_send_signal`、`openat2`、Landlock 这些原语有明确语义；你的接口要把它们组合成更高层的操作。
2. **权限用 capability（能力句柄）表示**，不用路径字符串。Agent 拿到的是一个不能伪造的句柄，可以缩小、转交、撤销；不是“你可以访问 `/tmp/foo`”这种能被 symlink 绕过的约定。
3. **效果由内核记录**，不采用 agent 自己的说法。审计日志记录系统调用、文件变更、进程退出、网络请求，而不是模型说“我跑过测试了”。

这门课不认为现在已经有标准的 Agent OS。课程给出一张可以论证的操作表和原型，要求你为每个操作回答五个问题：原子性由什么保证？谁有权调用？重复调用会怎样？失败后留下什么状态？凭什么证明它发生过？你可以推翻这张表，但要给出更好的方案。

## 怎么开始

1. 读 [第 1 讲 从 shell 到 syscall](#aos1) 和 [第 2 讲 边界](#aos2)。
2. 打开 [AOS1 任务书](aos1.html)，先定义接口表。
3. 评分接口还没冻结；先按任务书的验收清单自测，judge 会在接口冻结后补。
4. 延伸参考（可选）：[seL4](papers.html)、[AIOS](papers.html)、[OCI Runtime Spec](papers.html)。讲义覆盖概念，实现看任务书和 `aos1.html` 里的骨架。

作业总览在 [作业与实验](labs.html)；评分标准在 [评分标准](grading.html)。

## 先修要求

- INFRA 01 的 Lab 1–4，或等价的操作系统/分布式系统基础。
- 做过 namespace、cgroup、mount（INFRA 02 的 CN1–CN2，或同等经验）；AOS1 直接用到这些原语。
- 会在 Linux 上写 Go、C 或 Rust；知道 syscall、文件描述符、fork/exec。
- 在 Linux 或 WSL2 里有 root；内核实验只在一次性环境里做。

## 课程安排

| # | 主题 | 关键问题 | 实验 |
|---|---|---|---|
| 1 | From shell to syscall | 为什么 tool schema 不能当 OS 接口？ | [AOS1](aos1.html) |
| 2 | Kernel/runtime boundary | 事务应该由哪一层负责？ | [AOS1](aos1.html) |
| 3 | Isolation and capabilities | 为什么路径字符串不能当权限？ | [AOS3](aos3.html) |
| 4 | Files and workspaces | 多个文件如何一次性提交？ | [AOS2](aos2.html) |
| 5 | Process lifecycle | 取消任务后，怎么证明没有遗留进程？ | [AOS1](aos1.html) |
| 6 | Transactions | 什么情况下无法回滚？ | [AOS2](aos2.html) |
| 7 | Snapshots and restore | 文件快照漏掉了哪些状态？ | [AOS4](aos4.html) |
| 8 | Resources and scheduling | 怎么强制执行 token 预算？ | — |
| 9 | Leases and fencing | 旧 owner 恢复后，为什么不能继续写？ | [AOS5](aos5.html) |
| 10 | Audit and evidence | 为什么 agent 自己写的日志不能当证据？ | [AOS5](aos5.html) |
| 11 | ABI for LLMs | 怎么设计有类型、有错误分类的操作？ | [Capstone](aos-capstone.html) |
| 12 | Capstone | 你的 Agent OS 能证明哪些性质？ | [Capstone](aos-capstone.html) |

## 实验

| # | 实验 | 交付物 | 环境 |
|---|---|---|---|
| AOS1 | Typed ABI and sandboxed exec | syscall 表 + `spawn`/`exec` + 隔离 | Linux/WSL2 |
| AOS2 | Workspace transaction | commit/rollback + 崩溃恢复 | Linux/WSL2 |
| AOS3 | Capability sandbox | 句柄、衰减、撤销、逃逸测试 | Linux/WSL2 |
| AOS4 | Snapshot and restore | overlayfs/reflink 快照 + 一致恢复 | Linux/WSL2 |
| AOS5 | Lease, fencing, audit | 双主拒绝 + hash chain + replay | Linux/WSL2 |
| Capstone | Minimal Agent OS | 8–10 个操作 + 混沌测试 + 报告 | Linux/WSL2 |

## 设计问题

1. 没有新的内核原语时，多个文件能否做到严格原子提交？证明或反驳。
2. 设计一个权限模型，让 LLM 不需要理解整张权限图，也能申请刚好够用的权限。
3. 怎么记录 agent 的行为，既不需要信任 agent，又不让系统慢 10 倍？
4. `fork_context` 应该用 copy-on-write 复制哪些状态？agent 的“缺页”对应什么？
5. `indeterminate`（结果未知）可以避免吗？如果不能，接口应该怎么表达它？
6. 为会暂停几分钟的 agent（GC、人工审批）设计租约和 fencing 协议；旧 owner 恢复后会发生什么？

## 环境

- 单机 Linux 或 WSL2（Ubuntu 24.04），2 vCPU、4 GB 内存、20 GB 磁盘。
- 核心实验只依赖 namespace、cgroup v2、overlayfs、seccomp、pidfd；不需要 GPU、KVM 或多节点集群。
- Landlock 在部分 WSL2 内核不可用；AOS3 可以只用 seccomp + `openat2` + `pivot_root`。
- CRIU、Firecracker、eBPF 是可选进阶；没有 KVM 就跳过 Firecracker，不要用软件模拟硬撑。

## 考核

- 原子性测试能证明“要么全做、要么不做”；权限逃逸测试全部失败。
- 审计日志能重放一次任务；报告写清楚哪些副作用无法回滚。
- 能回答至少 3 个 design questions；代码私有。

## 阅读

[阅读](papers.html) 有 seL4、gVisor、AIOS、Saga、Unix、End-to-End Arguments 的定位；规范读 OCI Runtime Spec、cgroup v2、seccomp、Landlock、overlayfs、pidfd 的内核文档。

以下是 12 讲的讲义，按课程顺序排列。

## 第 1 讲：从 shell 到 syscall {#aos1}

用一句话说：agent 说“我把构建修好了”，内核只看到一串 syscall；Agent OS 要把“操作”变成内核能验证的契约。

### 一次“修构建”在内核眼里是什么

设想一个 agent 接到任务：“把构建修好，跑测试，确认没有回归。”它会执行 `rm -rf build && make`，编译失败，读错误，改代码，再跑。这个过程里，内核看到的是 `unlinkat`、`execve`、`write`、`read`；它不知道“构建”是一个事务，也不知道“测试通过”需要哪些证据。

Agent 只能在自然语言里维护意图，而自然语言不是内核能验证的状态。于是出现三个问题。任务做到一半失败，没有可以恢复的检查点。工具继承了 shell 的全部权限，路径检查还存在 TOCTOU（检查与使用之间有时间差）；最后 agent 说“完成了”，你却没有证据。

### tool calling 比 shell 好在哪里，又差在哪里

Tool calling 比 shell 好一点：参数是结构化的，工具可以校验类型。但它仍然不够。一个 JSON schema 描述的是“参数长什么样”，不是“这个操作什么时候算完成”“失败了能不能重试”“需要什么权限”“产生了什么副作用”。

模型可以从 50 个工具里挑一个，但它不知道自己有没有权限，也不知道上一次调用到底有没有生效。工具的实现藏在用户态，内核没有参与，审计日志也只能记“工具说它做了什么”。

### 把“操作”当成核心概念

一个操作至少要有七个部分。

- **线性化点**：在哪个瞬间，这个操作被认为生效。
- **前置条件**：版本号、lease、文件 hash、能力句柄。
- **后置条件**：成功后系统处于什么状态。
- **幂等键**：重复提交时，怎么识别是同一次操作。
- **副作用**：文件、进程、网络、外部 API，分别是可回滚、可补偿还是不可逆。
- **结构化错误**：`retryable`、`denied`、`conflict`、`indeterminate`，而不是一段字符串。
- **证据**：内核记录的审计事件，能证明发生了什么。

这就是“syscall”和“tool”的区别。Tool 只是一个函数；syscall 是一份有明确语义的约定。LLM 应该负责计划，不应该像一个拥有一切权限的 shell；它调用操作，内核验证并执行，返回结构化结果和证据。

### 一个具体操作：commit workspace

假设 agent 要提交一个工作区。操作表可以写成：

| 字段 | 内容 |
|---|---|
| 名称 | `workspace.commit` |
| 线性化点 | 新 manifest 的 `rename` 成功那一刻 |
| 前置条件 | workspace id 有效；`expected_version` 等于当前版本；调用者持有写 capability |
| 后置条件 | 新版本可见；旧版本保留为只读；审计事件已落盘 |
| 幂等键 | `(agent_id, task_id, workspace_id, op_seq)` |
| 副作用 | 文件系统可回滚；外部 webhook 不可回滚，标记为 `compensable` |
| 错误 | `conflict`（版本不匹配）、`denied`（capability 不足）、`indeterminate`（commit 中崩溃） |
| 证据 | 审计事件包含旧版本、新版本、文件 hash、调用者 |

这张表不是文档装饰。它决定了接口怎么设计、失败怎么表达、测试怎么断言。比如“commit 中崩溃”只能返回 `indeterminate`，让调用者用 `workspace.status` 查，而不是猜。

### 和实验的关系

AOS1 要求你定义这样一张操作表，实现 `spawn` 和 `exec` 两个操作，再用最小隔离跑起来。验收不看代码行数，看四组可观察行为：参数校验、权限拒绝、重复调用、失败后的证据。具体任务书见 [AOS1](aos1.html)。

### 检查一下自己

1. 一个 tool schema 缺了哪三样东西，导致它不能当 OS ABI？
2. 为什么幂等键要绑定 agent、任务、工作区和操作序号，而不能只是一个随机 UUID？
3. `indeterminate` 可以避免吗？如果不能，接口应该怎么表达它？

### 答案要点

1. 完成条件、权限/副作用、证据；schema 只描述参数形状。
2. 随机 UUID 每次重试都会变，服务端无法识别“这是同一次操作”；绑定任务和序号才能在重试和崩溃恢复后去重。
3. 不能完全避免；崩溃可能发生在“已生效、未回复”之间。接口要返回 `indeterminate`，并提供查询操作让调用者确认，而不是盲目重试。

**依据**：`clone(2)`、`execve(2)`、`pidfd_open(2)`、`openat2(2)`、Landlock 文档；AOS1 任务书。

## 第 2 讲：边界：内核、runtime、编排器 {#aos2}

一个团队把事务逻辑放进 agent 进程：agent 自己记下要写哪三个文件，自己决定成功还是回滚。第三次运行时，它写完两个文件后崩溃。重启后工作区里两个新文件、一个旧文件，agent 既不敢重做，也不敢删除。原子边界被放在了一个会崩溃的进程里。

### 三个层次各自能保证什么

宏内核（monolithic kernel）把文件系统、网络、调度和驱动放在同一个地址空间，系统调用路径短，攻击面大。微内核（microkernel）只保留 IPC、调度和内存管理，文件系统和驱动移到用户态，隔离更强，IPC 往返更多；seL4 的能力（capability）是原生权限模型，内核经过形式验证（功能正确性）。用户态内核（user-space kernel）在用户空间重新实现 syscall 接口，gVisor 是代表。

边界问题只有一个：谁能在崩溃后仍然保证一件事。内核能在 open、exec、mount、kill 的路径上检查，也能在进程死后保留状态；runtime 只能在进程活着时检查；编排器（orchestrator）决定任务放在哪台机器、何时重启，但看不到单个 syscall。把事务放在 agent 里，等于把保证交给最不可靠的一层；sidecar 好一些，但与 agent 共享内核，阻止不了 agent 直接调用 syscall。

### 用户态 daemon 不等于用户态 OS

课程原型是一个用户空间 daemon。它负责调度、转发和策略，但原子性来自内核原语，不来自自己的约定。每个操作都要标注原子性来源：

| 操作 | 原子性来源 | 是否严格原子 |
|---|---|---|
| 单文件替换 | rename + fsync | 是，单文件 |
| 终止任务 | pidfd_send_signal + cgroup.kill | 是，cgroup 级 |
| 多文件提交 | 暂存目录 + manifest 切换 + 恢复 | 否，只是可恢复 |
| 跨服务副作用 | saga 补偿 / 幂等表 | 否，最终一致 |

多文件没有内核级的“全部替换”原语，rename 一次只换一个名字；manifest 切换把“部分完成”变成“可判定”，但恢复仍依赖 fsync 顺序。跨服务只能补偿。工具适配、模型调用、策略、重试留在 runtime；隔离、调度、内存、IPC、能力检查、审计钩子放进内核。LLM 不进内核，它不确定、会幻觉；内核只执行类型化操作。

### 一次 commit 的 syscall 轨迹

daemon 收到 workspace.commit 后：openat(O_TMPFILE) 建临时文件，write 新内容，fsync 文件，rename 到目标名，fsync 目录。读者任何时刻 open 目标名，只看到旧 inode 或新 inode。若 daemon 在 rename 后、目录 fsync 前崩溃，掉电后新名字可能消失；这个保证只能由内核提供。

```text
daemon: openat(tmp) -> write -> fsync(tmp) -> rename(tmp, dst) -> fsync(dir)
reader:                                    open(dst) 只看到完整旧版或完整新版
crash:   rename 后掉电，目录未 fsync，名字可能回退
```

看图注意：rename 的原子性只覆盖名字替换那一瞬；持久性要等目录 fsync，两者不同。

### 哪些是假设，哪些有现成机制

现成机制：rename、fsync、pidfd、cgroup.kill、openat2、Landlock、seccomp 的语义由内核文档定义；seL4 的能力模型、gVisor 的 syscall 拦截、Firecracker 的 microVM 都有实现。

研究性假设：“Agent OS 应暴露一张小的类型化操作表”“每个操作带幂等键和证据”“权限用句柄而不是路径”都是课程主张，没有标准。AIOS 把 LLM 当 CPU、agent 当进程，在用户态实现调度和上下文管理，但它的“内核”仍是用户态库，不能证明内核级原子性。End-to-End Arguments 提醒：中间层可以优化，不能替代端点的正确性；事务和审计最终都要问“保证由谁负责”。

### 和实验的关系

AOS1 要求先交接口表，再写 spawn/exec。每个操作写“原子性来源”；写不出内核原语、只写“由 daemon 保证”，它就不是严格原子操作。这个判断会用到 AOS2 和 AOS5。

### 检查一下自己

1. 为什么用户态 daemon 不能单独保证多文件原子提交？
2. 表里哪一行严格原子，哪一行只是可恢复？
3. End-to-End Arguments 对审计日志意味着什么？

### 答案要点

1. 它只能组合内核原语。多文件没有单一原子替换原语，两次 rename 之间崩溃就留下混合状态；恢复靠 manifest 和 fsync 顺序，只能“可判定”，不是“原子”。
2. 单文件替换靠 rename，任务终止靠 cgroup.kill，两者严格原子；多文件提交只是可恢复，中间状态真实存在过。
3. 端点必须能验证，中间层日志可能丢、可能被改；内核记录比 agent 自述更接近证据，但仍需防篡改和外部锚点。

**依据**：第 1、2 讲；seL4（SOSP 2009）；AIOS（arXiv:2403.16971）；End-to-End Arguments（1984）；Linux rename(2)、fsync(2)、cgroup v2 文档。

**作业**：[AOS1](aos1.html) · [作业总览](labs.html)

## 第 3 讲：隔离：让 agent 只看见它该看见的 {#aos3}

一个 agent 的工具以当前用户身份运行，读到了 `~/.ssh/id_rsa`；另一个工具把 token 放进命令行参数，`ps` 里所有用户都能看到；第三个工具用 `chroot` 做沙箱，agent 用 `chdir("..")` 加 `chroot(".")` 就逃了出来。三个事故的共同点是：权限被写成了路径或字符串，而不是内核对象。

### 隔离要同时管看见和能做

命名空间（namespace）把 PID、mount、network、IPC、UTS、user、cgroup、time 分开，让进程看见一套新视图。控制组（cgroup）限制 CPU、内存、进程数和 I/O，管的是用量，不是可见性。系统调用过滤（seccomp）按 syscall 号和参数过滤，过滤器在 fork/exec 后继承，不能撤销。Landlock 让进程声明能访问哪些目录；`openat2` 的 `RESOLVE_BENEATH` 在解析路径时把结果限制在某个目录下。

这些机制解决“看不见”，不自动解决“能不能做”。授权要用能力（capability）：一个不可伪造的句柄，绑定具体 inode 和权限位，可以派生、转交、撤销。seL4 把能力做成内核原生模型；Linux 用文件描述符加 `SCM_RIGHTS` 近似，但不是完整的 capability 系统。路径字符串不能当能力，因为名字可以被重新绑定：symlink、bind mount、`/proc/self/fd`、当前工作目录都能让同一个字符串指向另一个 inode。token 也一样：放进只读 fd 用 `SCM_RIGHTS` 传，比在日志里加脱敏正则更接近根因。

### 路径检查为什么总有时间差

检查和使用是两个动作，中间存在检查与使用的时间差（TOCTOU）。daemon 先 `stat("/workspace/out")`，确认它在工作区内；工具随后把 `out` 换成指向 `/etc/shadow` 的 symlink；daemon 再 `open`，打开的就是 shadow。路径检查没有错，错在检查和打开不是同一个原子操作。

`openat2` 把约束放进解析过程：`openat2(dirfd, "out", {flags, resolve: RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS})`，内核在每一步解析时检查，遇到 `..` 或 symlink 就失败。Landlock 在 inode 访问点检查，已经打开的 fd 不受新规则约束，这是它的边界。seccomp 能拦住 `mount`、`ptrace`、`bpf` 这类危险调用，但拦不住“读一个允许读的文件”。

### 一次能力转交

```text
daemon: open("/workspace", O_PATH) -> cap_t(fd, R/W)
daemon: sendmsg(fd, SCM_RIGHTS) ---> tool
tool:   openat(cap_fd, "src/main.go", O_RDWR)
audit:  {actor: tool, cap: 17, op: openat, path: src/main.go}
```

看图时注意：工具拿到的是 fd，不是字符串；它不能用 `..` 跳出 fd 指向的目录，也不能把 fd 伪造成别的 inode。daemon 记录的是“哪个句柄被谁用了”，不是“哪个路径被批准过”。

### 哪些是假设，哪些有现成机制

现成机制：namespace、cgroup v2、seccomp、Landlock、`openat2`、`no_new_privs`、`SCM_RIGHTS` 都有内核文档；seL4 的内核经过形式验证（功能正确性），能力是原生模型；gVisor 在用户态拦截 syscall。它们提供可执行的边界。

研究性假设：“LLM 应该持有工作区句柄而不是路径”“能力派生和撤销应该是 Agent OS 的一等操作”“每次能力使用都要进审计”都是课程主张，没有标准。Linux 的 fd 模型也不是完整能力系统：fd 可以 `fchdir`，Landlock 管不到已打开的 fd，user namespace 里的 mount 语义和宿主不同。把 sidecar 当沙箱也不够，它和 agent 共享内核。

### 和实验的关系

AOS3 要求你把工作区做成 fd 句柄，用 `SCM_RIGHTS` 传给工具，daemon 只接受句柄；然后写 `..`、symlink、`/proc/self/fd`、bind mount 的逃逸测试，要求全部失败。AOS1 的 seccomp/Landlock 是这条线的起点；AOS2 的 commit 也要通过句柄访问工作区。

### 检查一下自己

1. 为什么 `chroot` 不是安全边界？`pivot_root` 补上了什么？
2. 路径白名单为什么有 TOCTOU？`openat2` 和 Landlock 分别怎么缓解？
3. 能力句柄比路径多了哪两个性质？

### 答案要点

1. `chroot` 不改变当前目录，也不关闭已打开的 fd；有 root 权限时可以用 `chdir("..")` 加 `chroot(".")` 逃出。`pivot_root` 配合 mount namespace 换掉根挂载，但已打开的 fd 仍然有效。
2. 检查和打开是两次系统调用，中间 symlink 或 bind mount 可以换掉目标。`openat2` 在解析时约束路径，Landlock 在访问点检查 inode；两者都不能追溯已经打开的 fd。
3. 绑定具体 inode 和权限位，不可伪造；可以转交和撤销。路径只是名字，可以被重新绑定。

**依据**：seL4（SOSP 2009）；Linux `namespaces(7)`、cgroup v2、`seccomp(2)`、`landlock(7)`、`openat2(2)` 文档；gVisor（HotCloud 2019）。

**作业**：[AOS3](aos3.html) · [作业总览](labs.html)

## 第 4 讲：文件与工作区：原子性从哪里来 {#aos4}

Agent 最常做的事是改文件，也最容易只完成一半。写 `main.go` 写到一半，formatter 又把它重写；测试读到写了一半的文件；进程崩溃，磁盘上留下语法不完整的文件；两个 agent 同时改同一个文件，后写的覆盖先写的。每个 syscall 都成功，合起来却没有完整版本。

### POSIX 到底保证什么

`write` 返回成功，只说明数据交给了内核，不说明已经落盘，也不保证多个进程的写入按你的顺序排列。原子替换（atomic rename）在同一条文件系统内是原子的：读者要么看到旧名字，要么看到新名字，不会看到半个文件；跨文件系统会返回 `EXDEV`，不再原子。`fsync` 文件保证内容落盘，`fsync` 目录保证目录项落盘；只 fsync 文件，崩溃后名字可能消失。`O_TMPFILE` 创建一个没有名字的文件，写完用 `linkat(AT_EMPTY_PATH)` 挂到目标名，中间状态不会被别人看见。`renameat2` 可以原子交换两个名字，或在目标存在时失败。这些原语组合起来，就是单文件提交的材料。

### 多文件怎么提交

多文件没有内核级的“全部替换”原语。可行的做法是暂存目录（staging directory）加 manifest：所有新内容先写进 staging，逐个 `fsync`；然后写一份新 manifest，记录每个文件的 hash；`fsync` manifest 和目录；最后原子地把 `current` 指针或 symlink 切到新 manifest。崩溃恢复时读 `current`，如果它指向的 manifest 不完整，就回退到上一个完整版本。

```text
staging/            manifests/
  src/main.go   ->   v6: {main.go: h6, go.mod: h6}
  go.mod             v7: {main.go: h7, go.mod: h7}
                     current -> v7
```

看图时注意：`current` 是唯一的提交点；读者必须先读 `current`，再按 manifest 取文件，才能看到一致的一组版本。如果读者直接按路径逐个打开，仍可能读到新旧混合，这是多文件事务的边界，不是实现 bug。

overlayfs 可以把“切换”变成改挂载点：lower 只读，upper 收变更，提交时换视图。reflink（`FICLONE`）让复制整个工作区变成 O(1) 的写时复制（copy-on-write, CoW），但依赖文件系统支持，btrfs 和 XFS 可以，ext4 不行。

### 一次崩溃留下的状态

假设 commit 执行到 `rename(staging/src/main.go, workspace/src/main.go)` 之后、`fsync(workspace/src)` 之前，机器掉电。文件内容可能已经在新 inode 上，但目录项还指向旧 inode；重启后看到的可能是旧版本，也可能新版本。此时 manifest 还没切换，恢复选 v6，把 staging 丢掉，状态确定。若 manifest 已经切换但目录没 fsync，恢复逻辑必须能识别“manifest 指向的文件不存在”，回退到 v6。

关键不是“永不失败”，而是“失败后能判定”。`rename` 给你单文件的原子性；manifest 给你多文件的可判定性；两者都不能给你跨服务的原子性。

### 哪些是假设，哪些有现成机制

现成机制：`rename`、`fsync`、`O_TMPFILE`、`renameat2`、overlayfs、reflink 的语义都有 man page 和内核文档；单文件替换的原子性是 POSIX 和文件系统共同保证的。多文件 manifest 切换是工程模式，不是内核原语，它的正确性依赖恢复逻辑和 fsync 顺序，需要测试证明。

研究性假设：“工作区应该是一个带版本号的 ABI 对象”“commit 和 rollback 应该返回证据”“读者应该通过工作区句柄取文件，而不是直接读路径”都是课程主张。它们没有标准。跨服务副作用不在文件系统里，`rename` 回滚不了已经发出的 webhook，第 6 讲展开。

### 和实验的关系

AOS2 先做单文件 `commit`/`rollback`：临时文件加 `rename` 加 `fsync`，确认读者零次看到半写文件；再做多文件 manifest，并在 commit 的每个阶段 `kill -9`，重启后检查状态只能是旧版本或新版本。不要先上 overlayfs，理解 `rename`/`fsync` 的边界后，overlayfs 只是另一种实现。

### 检查一下自己

1. `rename` 跨目录原子吗？跨文件系统呢？
2. 为什么 `fsync` 文件之后还要 `fsync` 目录？
3. `O_TMPFILE` 解决了哪个竞态？

### 答案要点

1. 同一文件系统内跨目录仍然原子，因为替换的是目录项；跨文件系统返回 `EXDEV`，`mv` 会退化成复制加删除，不再原子。
2. 文件内容落盘不等于目录项落盘；崩溃后目录项可能还指向旧 inode，新名字消失。目录 `fsync` 把“名字到 inode”的映射写下去。
3. 它避免创建一个有名字的临时文件被别人看见或误用；写完再用 `linkat` 发布。发布本身仍需 `fsync` 才能持久。

**依据**：POSIX `write`/`rename`/`fsync` 语义；Linux `open(2)`、`rename(2)`、`renameat2(2)`、`fsync(2)` 文档；overlayfs 内核文档；AOS2 任务书。

**作业**：[AOS2](aos2.html) · [作业总览](labs.html)

## 第 5 讲：进程生命周期：启动、取消、回收 {#aos5}

Agent 启动一个工具，工具又启动子进程；用户点“取消”；agent 只杀了父进程，子进程还在写文件。几分钟后，工作区里出现了“已经取消”的任务留下的半成品。这不是 agent 的 bug，而是取消的语义没有定义：杀掉一个 PID，不等于结束一个任务。

### 进程原语比 kill 细

`kill(pid)` 有两个问题：PID 会被复用，信号可能发给另一个进程；它只覆盖一个进程，不覆盖它启动的整棵树。进程描述符（pidfd）解决第一个问题：`pidfd_open` 或 `clone3(CLONE_PIDFD)` 拿到一个绑定到进程的 fd，`pidfd_send_signal` 用它发信号，`waitid(P_PIDFD)` 用它等待退出，不存在 PID 复用竞态。

控制组（cgroup）解决第二个问题：把任务的所有进程放进一个 cgroup，`cgroup.kill` 一次给整个 cgroup 发 SIGKILL，`cgroup.freeze` 暂停而不是杀死，`cgroup.events` 的 `populated=0` 表示组里没有进程了。进程组和 session 也能一次发信号，但子进程可以 `setsid` 逃出去；cgroup 是层级结构，只要进程没有权限把自己挪走，就逃不掉。

### 取消是一个状态机

可靠的取消协议分四步。第一，给任务一个截止时间，停止接收新请求；第二，发 `SIGTERM`，给优雅退出的窗口；第三，等所有子进程退出，用 `waitid(P_PIDFD)` 或 `poll` 监听 pidfd；第四，超时后 `cgroup.kill`，再等 `cgroup.events` 的 `populated` 变成 0，最后回收僵尸。

取消不是“发一个信号”，而是 `running → cancelling → cancelled` 的状态迁移，每一步都要留下证据：什么时候发的信号、哪些进程退出、有没有进程被 SIGKILL、cgroup 是否为空。只看“kill 返回 0”不够，那只说明信号送到了，不说明进程死了。

```text
task cgroup: /aos/task-42
  bash(100) -> make(101) -> cc(102)
  kill(100)        -> 101, 102 继续写
  cgroup.kill      -> 100, 101, 102 全部 SIGKILL
  cgroup.events    -> populated 0，才能删除 cgroup
```

看图时注意：cgroup 的边界是整棵进程树，不是一个 PID；删除 cgroup 之前必须确认 `populated=0`，否则 cgroup 会留在节点上，占着内存和 PID。

### 一次孤儿进程泄漏

假设任务启动时先 `clone` 再写 `cgroup.procs`。子进程在两条语句之间 fork 了一个孙子，孙子还没被写进 cgroup；父进程被 kill 后，孙子被 init 或 subreaper 收养，继续运行。`PR_SET_CHILD_SUBREAPER` 可以让 daemon 成为收养者，负责 `wait` 这些孤儿进程（orphan process）；更稳的做法是用 `clone3(CLONE_INTO_CGROUP)`，让子进程从第一刻就在目标 cgroup 里，消除这段窗口。

僵尸进程（zombie process）是另一个方向：进程已经退出，父进程没有 `wait`，进程表项还在。僵尸不占 CPU，但占 PID；大量僵尸会让 `pids.max` 耗尽，新任务起不来。回收责任要明确：谁创建，谁 wait；daemon 作为 subreaper 时，要循环 `waitpid(-1, WNOHANG)` 直到返回 0。

### 哪些是假设，哪些有现成机制

现成机制：`pidfd_open`、`pidfd_send_signal`、`waitid(P_PIDFD)`、`clone3(CLONE_PIDFD)`、`PR_SET_CHILD_SUBREAPER`、`cgroup.kill`、`cgroup.freeze`、`cgroup.events` 都有 man page 和内核文档。它们能提供无竞态的启动、终止和回收。

研究性假设：“每个任务应该独占一个 cgroup”“取消应该是带证据的状态机”“terminate 应该是一个 ABI 操作”都是课程主张，没有标准。边界也要说清：`cgroup.kill` 发的是 SIGKILL，进程没有机会清理；优雅退出必须靠前面的 SIGTERM 窗口。处于不可中断睡眠的进程会延迟退出；有权限写 `cgroup.procs` 的进程可以把自己挪走；内核线程不能被普通信号杀死。

### 和实验的关系

AOS1 的 `spawn`/`exec` 要求任务在独立 cgroup 里运行，`terminate` 后要能证明没有遗留进程：`cgroup.events` 的 `populated=0`、没有僵尸、审计里没有取消之后的写事件。AOS3 的隔离让进程逃不出 cgroup，AOS5 的 fencing 则防止旧任务在暂停后继续写。

### 检查一下自己

1. 为什么 `kill(-pgid)` 不能保证杀掉所有子进程？`cgroup.kill` 强在哪？
2. 取消后如何证明“没有孤儿进程还在写工作区”？
3. `cgroup.freeze` 和 `cgroup.kill` 分别适合什么场景？

### 答案要点

1. 子进程可以 `setsid` 或新建进程组，逃出原来的组；`kill(pid)` 还有 PID 复用竞态。`cgroup.kill` 覆盖整个 cgroup 层级，只要进程没有权限把自己移走，就一起被杀。
2. 等 `cgroup.events` 的 `populated=0`，用 `waitid` 回收所有子进程，再查审计：取消时间点之后没有该任务的写事件。三条都满足，才能说没有遗留。
3. `freeze` 暂停调度但不杀进程，适合拍一致快照或人工审批前冻结；`kill` 直接终止，适合取消和清理。冻结不能替代取消，取消也不该依赖冻结。

**依据**：Linux `pidfd_open(2)`、`pidfd_send_signal(2)`、`waitid(2)`、`clone3(2)`、`cgroup v2` 文档；AOS1 任务书。

**作业**：[AOS1](aos1.html) · [作业总览](labs.html)

## 第 6 讲：事务：intent、commit、rollback {#aos6}

一个多步骤任务：写文件、调外部 API、更新数据库。第二步成功，第三步失败。Agent 说“我回滚了”，但只删了文件；API 的副作用还在，数据库里也没有记录。用户看到“回滚成功”，系统只完成了一半。原子边界没有覆盖所有副作用。

### 先定义原子边界

事务的核心不是加锁，而是定义一个原子边界（atomic boundary），让边界内的操作要么全做，要么全不做。边界取决于副作用能否撤销：文件写入可以用 `rename` 回滚，外部 API 通常只能补偿，已发出的邮件、已扣的款不可逆。设计时先列副作用，再分可回滚、可补偿、不可逆三类。

单机文件用第 4 讲的暂存目录加 manifest 就够。跨服务要么用两阶段提交（two-phase commit, 2PC），要么用补偿事务（compensating transaction）。2PC 的 prepare 阶段锁定资源，commit 阶段统一提交；协调者崩溃会让参与者停在 in-doubt 状态，阻塞是它的代价。补偿事务把长事务拆成一系列本地事务，每个配一个补偿操作；它不提供隔离，中间状态可见，补偿也可能失败。Saga 论文说：补偿是用另一个操作抵消，原操作撤不回。

### 为什么要允许不确定状态

Agent 事务需要更宽状态机：`intent` 记录要做什么，`running` 执行中，`committed` 已提交，`aborted` 已回滚，不确定（indeterminate）表示结果未知。它是接口的一部分，不是异常。超时、断网、崩溃都可能让 agent 不知道外部操作有没有生效；这时不能盲目重试，要查审计、查幂等表、查外部系统状态。

幂等键（idempotency key）是基础。它要绑定“谁、在哪个工作区、做第几次操作”，不能只是随机 UUID；服务端要持久化“这个键执行过，结果是 X”，重试时返回同一个结果。没有幂等表，exactly-once 只是空话；有了幂等表，最多做到“效果恰好一次，响应至少一次”。End-to-End Arguments 同样成立：去重必须在真正产生副作用的端点做。

### 一次超时后留下了什么

```text
tx-42  state=running
  step 1  file.write src/main.go   idem=tx-42/1  done
  step 2  api.deploy               idem=tx-42/2  done
  step 3  db.update                idem=tx-42/3  timeout
```

看图注意第三步：超时只说明没等到回复，不说明没执行。恢复时拿 `tx-42/3` 查数据库幂等表；已执行就继续提交，没执行就重试，查不到就是 `indeterminate`。回滚时 step 2 调 undeploy，step 1 丢 staging；undeploy 失败时，报告必须写“残留了一个部署”，不能写 `complete`。

一个故障：rollback 报告 `complete`，却只回滚了文件，没回滚已经发出的 webhook。事务范围没覆盖真实副作用，报告就不成立。

### 哪些是假设，哪些有现成机制

现成机制：2PC、saga、发件箱（outbox）、幂等表、数据库事务都有成熟定义和实现；文件侧的 `rename`/manifest 在第 4 讲已经成立。

研究性假设：“Agent OS 应该把 intent/commit/rollback 暴露成 ABI 操作”“indeterminate 应该是一等状态”“每个副作用都要先分类再进事务”都是课程主张，没有标准。边界也要承认：没有外部系统配合，跨服务原子性做不到；补偿可能失败，2PC 可能阻塞，saga 可能泄漏中间状态。exactly-once 通常是端点去重后的效果，不是网络层承诺。

### 和实验的关系

AOS2 要求 `commit`/`rollback` 在崩溃注入下状态确定，读者永远看到完整版本。文件级之后，再列出“哪些副作用不在事务里”，写进报告；AOS5 的审计和幂等表用来解决 `indeterminate`。

### 检查一下自己

1. 什么时候 rollback 不可能？此时怎么向 LLM 表达？
2. 为什么补偿不等于撤销？举一个补偿失败的例子。
3. 幂等键为什么要绑定任务和操作序号？

### 答案要点

1. 副作用已离开控制面，对方不支持撤销或查询，例如邮件已送达、支付已清算。返回 `indeterminate`，附上已确认的副作用和残留，让调用者查证或人工处理，不要报 `complete`。
2. 补偿是另一个可能失败的操作。退款可能被银行拒绝，库存回补可能超卖，undeploy 可能超时；抵消效果，不抵消时间。
3. 新 UUID 会让服务端把重试当新请求，重复执行；绑定任务和序号，重试才能命中同一条幂等记录。

**依据**：Saga（SIGMOD 1987）；2PC 与原子提交（6.033 第 9 章）；End-to-End Arguments（1984）；第 4 讲；AOS2 任务书。故障现象来自课程记录。

**作业**：[AOS2](aos2.html) · [作业总览](labs.html)

## 第 7 讲：快照、分支与恢复 {#aos7}

Agent 想试三种方案。它把仓库复制了三份，每份几百 MB；磁盘很快满了，恢复还要几分钟。更糟的是，它只复制了文件，没有复制进程状态；恢复后，正在跑的服务、打开的文件描述符、内存里的缓存都没了。复制目录不等于快照，快照要回答“到底保存了哪些状态”。

### 三个层次的快照

文件系统快照（snapshot）最轻：overlayfs 用只读 lower 加可写 upper 表示一个视图，btrfs 和 ZFS 有原生快照，reflink（`FICLONE`）用写时复制（copy-on-write, CoW）把复制变成 O(1)。它适合工作区回滚，不包含进程。

进程检查点（checkpoint）保存进程树的内存、寄存器、打开的文件描述符和信号状态，CRIU 是代表。它能保住“进程还在跑”这件事，但兼容性差：网络连接、GPU、复杂 fd 经常恢复不了（具体范围随版本而异）。整机快照再上一层，Firecracker 把 microVM 的内存和设备状态一起拍下来，隔离最强，快照里也包含内核状态。

### 一致快照要先停住世界

文件快照和进程快照不是同一个瞬间。你可能拍到“进程认为文件已写、但磁盘还没落盘”的状态，也可能拍到进程正在写一半的缓冲区。要得到一致快照，顺序是：先冻结任务的控制组（`cgroup.freeze`）或发 `SIGSTOP`，再 `fsync` 工作区，然后拍文件快照和进程检查点，最后解冻。

```text
freeze(cgroup) -> fsync(workspace) -> snapshot(fs) -> checkpoint(proc) -> unfreeze
                         |                 |
                         v                 v
                  磁盘上的确定版本     进程看到同一版本
```

看图时注意：freeze 必须覆盖整个任务 cgroup，不是单个进程；`fsync` 必须在 freeze 之后、snapshot 之前，否则快照可能包含未落盘的页缓存。解冻之后，进程继续跑，快照是它某个过去时刻的视图。

### 一次恢复失败

假设 agent 对一个开着 TCP 连接的进程做 CRIU checkpoint，dump 成功。几分钟后 restore，对端已经关闭连接，恢复失败；进程的内存还在镜像里，但它依赖的外部状态没了。文件快照也有类似问题：进程打开了一个已删除的文件，文件快照里没有这个 inode，restore 后 fd 指向的对象和原来不同。

分支（branch）的做法是给每个快照记录 id、父快照和 manifest hash；三个分支各自有 upper 目录，互不污染。restore 不是“复制回去”，而是原子切换 `current` 指针或挂载视图；已经在读旧版本的进程继续读旧 inode，新读者看到新版本。合并两个分支没有免费午餐，需要三方合并或明确策略。

### 哪些是假设，哪些有现成机制

现成机制：overlayfs、btrfs/ZFS 快照、reflink、CRIU、Firecracker snapshot 都有文档和实现；`cgroup.freeze`、`fsync` 的语义也明确。它们能提供可执行的快照和恢复路径。

研究性假设：“工作区快照应该是 ABI 操作”“`fork_context` 应该像 `fork` 一样 CoW”“每个任务至少支持三个分支”都是课程主张，没有标准。边界必须说清。外部副作用无法快照：已经发出的 HTTP 请求、已经扣的款、已经发的消息都不在镜像里。进程快照对网络、GPU、复杂 fd 的支持有限；overlayfs 快照不是原子的，copy-up 有开销，whiteout 要处理；reflink 依赖文件系统。

### 和实验的关系

AOS4 先做单工作区 snapshot/restore，确认文件 hash 一致；再做三个分支，要求互不污染；然后用 `cgroup.freeze` 加 `fsync` 做一致快照，和“直接 copy”对比。进程快照是选做，先把工作区快照做对。

### 检查一下自己

1. 文件系统快照和进程快照分别缺什么状态？
2. 为什么“先 freeze 再 snapshot”比“直接 copy”更一致？
3. 哪些东西无法被快照？

### 答案要点

1. 文件快照缺进程内存、寄存器、fd、信号和网络连接；进程快照缺文件系统之外的持久状态，也缺外部世界。两者都缺已经离开系统的副作用。
2. 直接 copy 时进程还在写，文件和进程状态不在同一时刻；freeze 停住写者，fsync 把页缓存落盘，快照才对应一个确定版本。
3. 外部副作用无法快照：HTTP 请求、支付、消息、第三方资源。文件快照还拍不到内核和硬件状态；进程快照拍不到对端连接。

**依据**：overlayfs、btrfs、reflink 内核文档；CRIU 文档；Firecracker（NSDI 2020）；AOS4 任务书。

**作业**：[AOS4](aos4.html) · [作业总览](labs.html)

## 第 8 讲：资源与调度：token 也是资源 {#aos8}

一个 agent 陷入循环，十分钟消耗两百万 token；CPU 利用率很低，cgroup 没有任何告警，账单却爆了。传统资源模型管 CPU、内存、I/O、PID，但 agent 的主要成本是 token、工具调用次数、外部 API 配额和实际耗时。共同点是 cgroup 管不到。

### 两类资源，两套执行者

机器资源由内核强制：cgroup v2 的 `cpu.max`、`memory.max`、`io.max`、`pids.max` 限制 CPU、内存、I/O 和进程数。语义资源由 runtime 强制：token 预算、工具调用配额、并发子 agent 数、外部 API 的 QPS。两类资源都要有四个量：预留（reserve）、用量（usage）、限额（quota）、计费（charge）。

token 预算不能直接映射成 cgroup：cgroup 控制器只管内核可见的资源，token 在模型提供方消耗，内核没有计数器。runtime 只能在调用边界上拦截：模型调用前预留，返回后按实际用量计费，差额释放。如果 agent 能绕过 runtime 直接访问模型端点，预算就只是建议，所以网络出口也要受控。

### 事前预留，不是事后统计

把 token 预算做成事后统计，调用完成才记账，只能告诉你超了，不能阻止超。准入控制（admission control）要在调用前判断：预估成本加已预留量是否超过配额；超过就返回 `denied`，让 agent 缩小范围或申请更多预算。

预估不可能精确，所以要预留一个上界，调用后按实际用量结算，释放多余部分。重试要重新预留，提供方按每次请求计费，幂等键去重的是副作用，不一定是账单。子 agent 的预算要从父任务派生，所有子任务的预留之和不能超过父配额；否则一次 fan-out 就能把预算放大五倍。

### 调度分两层

节点级调度决定 agent 跑在哪台机器，任务级调度决定谁先拿到模型、工具和锁。Kubernetes 的 requests/limits 适合机器资源；token 预算需要自己的公平调度（fair scheduling）策略：按工作区加权，交互式任务优先，批处理限制并发。调度器要避免队头阻塞：等人工审批的 agent 不该占住模型并发槽。

Agent 的“内存”不只是 RAM。上下文窗口、对话历史、向量索引、工作区文件都是记忆，持久性和一致性各不相同。`checkpoint`、`restore`、`fork_context` 是记忆管理的原语；`fork_context` 应该像 `fork` 一样写时复制，而不是复制整个上下文。上下文当 fd 管理，比当字符串拼接更容易做预算和回收。

### 一次预算穿透

```text
workspace quota 1,000k
  task-42 quota 200k
    call #1  reserve 8k  -> usage 6.2k -> release 1.8k
    child-1  reserve 50k (从 task-42 派生)
    child-2  reserve 50k
  task-43 quota 200k
```

看图时注意：子任务的预留要从父任务扣，不是从工作区重新领；否则两个子任务各自看到 200k，实际已经超了。每次调用都要记 `reserve` 和 `charge` 两条事件，审计才能回答“钱花在哪”。

### 哪些是假设，哪些有现成机制

现成机制：cgroup v2 的限制、Kubernetes 的 requests/limits、提供方的 usage 字段、令牌桶限流都是成熟做法。

研究性假设：“token 预算应该是 Agent OS 的一等资源”“调用前必须预留”“`fork_context` 应该 CoW”都是课程主张，没有标准。边界是：token 价格和计数由提供方定义，预估有误差；已经花掉的 token 不能抢占；公平策略是价值判断；如果 agent 能直接出网，任何 runtime 预算都可被绕过。

### 和实验的关系

课程没有单独的资源实验，这项工作放进 Capstone：在 ABI 里实现 `reserve`、`charge`、`quota.set`，用 fake 模型验证重试和子 agent 不能绕过预算。AOS1 的 `exec` 也要带预算参数。

### 检查一下自己

1. 为什么 token 预算不能直接映射成 cgroup？
2. 重试和子 agent 会如何绕过预算？怎么在 ABI 层堵住？
3. 为什么预留比事后统计更有效？

### 答案要点

1. cgroup 控制器只统计内核可见的 CPU、内存、I/O、PID，token 在模型提供方消耗，内核没有计数器。只能在 runtime 的调用边界拦截，并限制网络出口。
2. 重试会重新计费，子 agent 会领到新的配额。做法是每次尝试都预留、按父任务派生预算、所有预留求和不超过父配额，并把预留和计费写进审计。
3. 事后统计只能观测已经发生的开销；预留在调用前判断，超限就拒绝。预估加结算能控制误差。

**依据**：cgroup v2 内核文档；Kubernetes 资源管理文档；AIOS（arXiv:2403.16971）的调度与上下文管理；第 1、6 讲的预算与幂等讨论。

**作业**：[Capstone](aos-capstone.html) · [作业总览](labs.html)

## 第 9 讲：协调：lease、fencing、单所有者 {#aos9}

两个 agent 同时认为自己是同一个工作区的 owner，都开始写。最后一个写的赢，中间的文件被覆盖，审计日志里两个人都说“我提交了”。这不是锁没加，而是锁没有栅栏：旧 owner 在租约过期后仍然能写，存储层也不认识谁是新的。

### 租约只是有期限的所有权

租约（lease）是一段时间内的所有权。client 向 lease service 申请一个带 TTL 的租约，定期续约；过期后，service 可以把所有权给别人。单所有者（single owner）是目标：同一时刻只有一个 writer。租约把“永远持有”换成“在 TTL 内持有”，代价是 client 必须续约，service 必须处理过期。

问题在于 client 不能完全相信自己。它可能因为 GC 暂停、`SIGSTOP`、网络延迟或时钟漂移，在租约过期后还以为自己持有租约，继续写。只靠 TTL，service 已经把所有权给了新 owner，旧 owner 却还在写，双主就出现了。租约解决“正常情况下谁拥有”，不解决“旧 owner 复活后怎么办”。

### 栅栏令牌把过期写挡在存储层

栅栏令牌（fencing token）是每次授予租约时发的单调递增编号，也叫 epoch。存储层记住见过的最大 token，拒绝更小的写。旧 owner 恢复后带着 epoch 12 来提交，存储层已经见过 13，直接拒绝；新 owner 的 13 正常通过。关键是拒绝发生在存储层，不在旧 owner 的本地判断，因为旧 owner 的判断正是不可靠的那个。

```text
owner A: acquire -> epoch 12, TTL 10s
         ... SIGSTOP 30s ...
owner B: acquire -> epoch 13
A 恢复:  commit(epoch=12) -> 存储层拒绝（max=13）
B:       commit(epoch=13) -> 通过
```

看图时注意：A 的写不是被 A 自己取消的，是被存储层拒绝的。fencing 必须落在真正写数据的那一层；如果只有 lease service 检查 token，存储层不检查，token 只是装饰。

### 一次暂停后的双主

假设 A 在写一个 20 MB 的 manifest 时被 `SIGSTOP`。租约 10 秒后过期，B 拿到 epoch 13，开始写。30 秒后 A 恢复，它手里的 fd 还开着，缓冲区还在，它继续 `write`。如果 A 走的是 commit 路径，存储层会拒绝 epoch 12；如果 A 直接写文件，fencing 拦不住，因为它没经过检查点。这说明 fencing 要和隔离、能力撤销一起用：旧 owner 的写句柄要么被撤销，要么工作区按 epoch 分开，不能给它一个能直接写当前版本的 fd。

etcd 的 lease、Kubernetes 的 `Lease` 对象、Chubby 的 sequencer、ZooKeeper 的 zxid 都提供单调序号，可以配合 fencing 使用。文件锁保护一个文件，租约保护一个角色；两者可以组合，不能互相替代。

### 哪些是假设，哪些有现成机制

现成机制：租约、fencing token、compare-and-swap、etcd/Kubernetes/Chubby/ZooKeeper 的协调原语都有实现和文档。存储层拒绝旧 epoch 的做法在分布式存储里很常见。

研究性假设：“工作区所有权应该是带 epoch 的租约”“每次 commit 都带 epoch”“同一工作区同一时刻只有一个 writer”都是课程主张，没有标准。边界要说清：fencing 只在资源层检查 token 时有效；外部 API 未必支持；lease service 本身可能不可用；暂停和时钟漂移不会消失，只能被检测；读路径如果不检查 epoch，旧 owner 仍可能提供陈旧读。

### 和实验的关系

AOS5 要求实现 `lease.acquire/renew/release`，返回单调递增的 epoch；在 commit 路径检查 epoch；用 `SIGSTOP` 暂停旧 owner 30 秒，让租约过期、新 owner 接管，恢复后验证旧 owner 的写被拒绝。审计要记录每次授予和拒绝，AOS3 的句柄撤销用来堵住直接写路径。

### 检查一下自己

1. 为什么租约需要单调 fencing token？只靠 TTL 会出什么问题？
2. 一个 agent 被 `SIGSTOP` 暂停 30 秒后恢复，它还能写吗？谁来拒绝？
3. 文件锁和工作区租约有什么区别？

### 答案要点

1. TTL 到期后 service 可以把所有权给别人，但旧 owner 可能还不知道，继续写。fencing token 让存储层拒绝旧 epoch，双主才不会同时生效。
2. 它可能尝试写，但 commit 应被存储层拒绝，因为它的 epoch 小于当前最大值。如果它绕过 commit 直接写文件，就需要能力撤销或按 epoch 隔离工作区来拦住。
3. 文件锁保护一个文件，粒度小，生命周期短；租约保护一个角色或工作区，跨多个文件和操作。两者可以组合，不能互相替代。

**依据**：Chubby（OSDI 2006）的 sequencer；ZooKeeper（USENIX ATC 2010）的 zxid；etcd lease 与 Kubernetes Lease 文档；AOS5 任务书。

**作业**：[AOS5](aos5.html) · [作业总览](labs.html)

## 第 10 讲：观察与审计：可验证的执行记录 {#aos10}

Agent 说“测试通过了”。你打开日志，发现它跑的是 `go test ./...`，但工作区里有一个被修改过的 `go.mod`，测试其实用了缓存；或者它根本没跑测试，只是复述了上一次的输出。日志是 agent 自己写的，不是证据。审计要回答的不是“它说了什么”，而是“系统能证明什么”。

### 事件、证据、重放

可验证的执行记录分三层。事件（event）是“谁在什么时候做了什么”：系统调用、文件变更、进程退出、网络请求。证据（evidence）是不可篡改或至少可检测篡改的记录：追加写、哈希链（hash chain）、签名、外部锚点。重放（replay）是给定事件流，重建关键状态，检查后置条件是否成立。

采集要放在沙箱边界，不放在 agent 里面。eBPF 可以在 tracepoint 或 kprobe 上抓 `execve`、`openat`、`connect`、`mmap`；`ptrace` 能抓 syscall，但开销大；`fanotify` 能监控文件访问，但有盲区；`inotify` 只告诉你“变了”，不告诉你“谁改的”。采集点决定了证据的强度：agent 自己能改的日志，只能算自述。

### 哈希链能证明什么

把每条事件串成链：`h_i = H(h_{i-1} || event_i)`。任何一条被改，后面的 hash 都对不上。它防的是“改中间某条事件”，不防“删掉末尾一段”，也不防“从创世重写整条链”，除非你把链头定期签到外部不可变存储，或者用 TEE 做远程证明。审计日志还要有 schema、序号、保留策略和查询接口，否则只是一堆文本。

```text
e1: {seq:1, op:"exec", args_hash:a1, prev:0,  hash:h1}
e2: {seq:2, op:"write", path:"go.mod", prev:h1, hash:h2}
e3: {seq:3, op:"exec", args_hash:a2, prev:h2, hash:h3}
     改 e2 -> h2 变 -> e3 的 prev 对不上
```

看图时注意：链只能保证“从前往后一致”，不能保证“后面没有缺”。要让“缺”也可检测，链头必须被外部记住。

### 一次测试声明的核对

Agent 声称测试通过。审计里应该能看到：`execve("/usr/bin/go", ["test","./..."], cwd=/ws)`，退出码 0，前后 `go.mod` 和源码的 hash。如果 `go.mod` 的写事件发生在测试之后，那么测试跑的不是当前代码；如果根本没有 `execve` 事件，测试声明没有证据。重放时不要重新执行 `go test`，那会产生新的副作用和新的时间；用记录下来的事件和结果重建“当时测了什么、结果是什么”。

### 哪些是假设，哪些有现成机制

现成机制：eBPF、`ptrace`、`fanotify`、`inotify` 是内核提供的采集手段；哈希链、数字签名、TEE 远程证明、SUNDR 的 fork consistency 都是已有研究。它们能提供不同强度的证据。

研究性假设：“每个 ABI 操作都返回 `audit_id`”“审计日志应该是 append-only 哈希链”“给定事件流能重放关键步骤”都是课程主张，没有标准。边界必须说清。eBPF 可能丢事件，看不到 TLS 里面的内容，特权用户可以卸载。哈希链不防尾部截断；重放不能复现外部副作用和不确定性。审计日志本身可能含密钥和隐私，需要脱敏和访问控制。

### 和实验的关系

AOS5 要求实现 append-only 审计日志，每条事件有 `ts`、`actor`、`op`、`args_hash`、`result`、`prev_hash`、`hash`；实现 `audit.query` 和 replay，篡改一条事件要能被发现。AOS1 的 `exec` 返回值里已经有 `evidence` 字段，到了 AOS5 要把它变成可查询、可验证的记录。

### 检查一下自己

1. 为什么 agent 自己的日志不能当审计证据？eBPF 又看不到什么？
2. 哈希链能防什么？不能防什么？
3. 审计重放为什么不应该重新执行外部调用？

### 答案要点

1. Agent 可以改日志、漏记、编造，日志没有独立来源。eBPF 看不到 TLS 加密的载荷、纯用户态事件，也可能在高负载下丢事件；它附着在特定 cgroup 或 namespace 上，范围外的东西看不到。
2. 能检测链中间的事件被修改；不能防尾部删除、整链重写，也不能防采集点本身被特权用户控制。需要外部锚点、签名或 TEE 补强。
3. 重新执行会产生新的副作用，而且外部状态已经变了，结果不可比。重放应该用记录下来的事件和结果重建状态，验证声明，而不是再发一次请求。

**依据**：eBPF、`ptrace(2)`、`fanotify(7)`、`inotify(7)` 文档；SUNDR（OSDI 2004）的 fork consistency；End-to-End Arguments（1984）；AOS5 任务书。

**作业**：[AOS5](aos5.html) · [作业总览](labs.html)

## 第 11 讲：给 LLM 的 ABI：类型化操作与结构化错误 {#aos11}

一个 50 工具的 agent 经常选错工具、传错类型，失败就重试，重试又产生重复副作用；错误是一段自然语言，模型只能猜“是不是暂时性的”。这不是模型不聪明，而是应用二进制接口（ABI）只描述了参数长什么样，没描述操作何时算完成、能否重试、需要什么权限、留下什么。

### 一个操作是一份合同

好的 Agent OS 接口应该像 syscall 一样，有操作表、类型、能力句柄（capability handle）、前置条件、后置条件、幂等键（idempotency key）、错误分类、返回值和版本。每个操作要回答五个问题：线性化点（linearization point）在哪，谁有权调用，重复调用会怎样，失败后留下什么状态，凭什么证明它发生过。

```text
op(
  name:        "workspace.commit",
  idem:        "task-42/commit/7",
  cap:         cap_t,
  pre:         [workspace.version == 7, lease.epoch == 12],
  args:        {...},
  deadline_ms: 30000,
) -> {
  status:   "ok" | "error" | "timeout" | "indeterminate",
  result:   {...},
  effects:  [file.write("src/main.go"), proc.exit(0)],
  evidence: audit_id,
}
```

看信封时注意三件事：`pre` 把版本和租约变成可检查的前置条件；`idem` 让重试可识别；`effects` 和 `evidence` 让调用者知道发生了什么、凭什么相信。

### 错误分类比错误信息重要

| 错误 | 含义 | LLM 应该做什么 |
|---|---|---|
| `invalid` | 参数或前置条件不合法 | 修正参数，不要重试 |
| `denied` | 能力不足 | 申请能力或停止 |
| `conflict` | 版本或租约冲突 | 重新读取状态，重新规划 |
| `retryable` | 暂时性失败 | 用同一个幂等键重试 |
| `indeterminate` | 副作用可能已发生 | 查 `status` 或 `audit`，不要盲重试 |
| `internal` | 内核或实现错误 | 停止并报告 |

这张表把“模型该做什么”写进协议。自然语言错误让模型猜；结构化错误让模型按规则行动。`indeterminate` 尤其重要：它表示结果未知，不是失败，也不是成功；模型必须先查证，再决定重试还是回滚。

### 权限操作不能让 LLM 直接调

`cap.grant`、`cap.delegate`、`cap.revoke` 不应该由 LLM 直接调用，它们是策略层或人类审批的操作。LLM 只能 `cap.derive` 出一个更小的子能力，或发起 `cap.request` 等待审批；否则这个接口就是提权工具。模型也不应持有原始 capability，只持有任务句柄；不能直接读 `/proc`，只能 `audit.query`；不能拼 shell，只能 `exec`。

接口要版本化。内核不能假设 LLM 永远调用最新版；每个操作带 `abi_version`，旧版本至少在一个生命周期内可用，弃用要有迁移路径。返回结果也要带版本。操作表不是越多越好：50 个工具让选择变难，8 到 10 个原子操作加参数组合，通常更容易验证。

### 哪些是假设，哪些有现成机制

现成机制：syscall 式接口、IDL、能力句柄、gRPC 错误码、API 版本化都有成熟实践；seL4 的能力模型和 Linux 的 fd 传递提供了底层素材。

研究性假设：“LLM 应该调用类型化操作而不是 shell”“每个操作都要有幂等键和证据”“权限操作不暴露给模型”都是课程主张，没有标准。AIOS 的 syscall 表是一个对照，但它在用户态实现，覆盖范围和保证强度都不同。边界是：ABI 不能让计划变正确；类型系统表达不了所有语义；`indeterminate` 无法消除；操作太少会逼出隐藏的复合操作，太多会增加选择错误。

### 和实验的关系

Capstone 要求至少 8 个操作，覆盖 `spawn`、`exec`、`workspace.commit`、`workspace.rollback`、`snapshot`、`lease.acquire`、`audit.query`、`terminate`；每个操作有类型、前置条件、幂等键、错误分类和证据。AOS1 先交接口表，AOS3 把权限换成句柄，AOS5 把证据变成审计记录。

### 检查一下自己

1. 为什么 tool schema 不足以描述一个 syscall？至少缺哪四样？
2. `indeterminate` 为什么不能简单重试？幂等键在这里起什么作用？
3. 为什么 `cap.grant` 不应该由 LLM 直接调用？

### 答案要点

1. 缺线性化点和前后置条件、幂等键、副作用分类、结构化错误和证据。参数类型只回答“长什么样”，不回答“何时生效、能否重试、留下什么”。
2. 结果未知时，副作用可能已经发生；直接重试会重复执行。幂等键让服务端识别同一次操作，返回第一次的结果；调用者仍要先查证。
3. 它等于把提权接口交给模型。授权应由策略层或人类审批，模型只能派生更小的能力或发起申请。

**依据**：第 1、6、10 讲；seL4（SOSP 2009）；AIOS（arXiv:2403.16971）；gRPC 错误码与 API 版本化实践；Capstone 任务书。

**作业**：[Capstone](aos-capstone.html) · [作业总览](labs.html)

## 第 12 讲：Capstone——实现一个最小 Agent OS {#aos12}

Demo 那天，你的 agent 跑完了一个多步骤任务，界面上写着“完成”。有人问：如果 daemon 在第二步和第三步之间崩溃，工作区会是什么状态？如果两个 agent 同时提交，谁的写会生效？如果工具试图读 `~/.ssh`，系统怎么证明它没读到？如果答不上来，你做的是一堆工具集成，不是一个能证明性质（property）的系统。

### 先选一个小任务，再缩操作表

Capstone 的目标不是“全能 agent 平台”，而是一个能证明原子性和权限边界的最小系统。先选一个端到端小任务，例如改一个 Markdown 文件、跑一次链接检查、提交一个 artifact；不要接真实凭证，不要接生产 API。然后把操作表缩到 8 到 10 个：`spawn`、`exec`、`workspace.commit`、`workspace.rollback`、`snapshot`、`lease.acquire`、`audit.query`、`terminate`。

先跑通最薄的一条路径：启动、改文件、commit、审计。这条路径能跑通，再依次加 namespace/cgroup/seccomp 隔离、快照、lease/fencing、混沌测试。每加一个机制，只回答一个问题：它让哪条性质从“口头承诺”变成“可测试的断言”。

### 每个性质都要有测试和证据

| 性质 | 测试 | 证据 |
|---|---|---|
| 原子性 | 在 commit 每个阶段 `kill -9` | 旧版本或新版本，不混合 |
| 权限 | `..`、symlink、`/proc/self/fd` 逃逸 | 全部失败，且有审计 |
| 协调 | `SIGSTOP` 旧 owner 30 秒 | 旧 epoch 的写被拒绝 |
| 审计 | 篡改一条事件 | hash chain 断裂，能被发现 |
| 回收 | 取消后查 cgroup | `populated=0`，无僵尸 |

这张表是 Capstone 的核心。验收看四件事：原子性是否真的成立，权限是否真的限制住，失败是否可解释，证据是否可验证。不看你接入了多少工具，也不看你用了多大的模型。混沌测试（chaos testing）至少要覆盖崩溃注入、重复请求、并发 agent、权限逃逸、孤儿进程和磁盘满，每项至少一次。

### 报告要写清楚不能证明什么

一个诚实的 Capstone 报告，一半篇幅在讲边界。外部副作用不在事务里，已经发出的 webhook 和支付不能被 `rename` 回滚。`indeterminate` 无法消除，只能被表达和查证。进程快照对网络、GPU、复杂 fd 的支持有限；Linux 的 fd 加 Landlock 不是完整的能力系统。崩溃注入是抽样，不是形式证明；审计哈希链不防尾部截断，也不防 root 从采集点篡改。

这些不是扣分项，而是研究的一部分。课程要你论证、实现、反驳，不是把这些设计当成事实。能把“我的系统证明了什么、没证明什么”写清楚，比多接十个工具更有价值。

### 哪些是假设，哪些有现成机制

现成机制：AOS1 到 AOS5 用到的 namespace、cgroup、seccomp、Landlock、overlayfs、reflink、pidfd、lease、哈希链，都有内核文档或论文支撑；Capstone 是把它们组合起来，并给出可复现的测试。

研究性假设：“最小 Agent OS 应该只有 8 到 10 个操作”“性质比功能重要”“混沌测试可以作为验收证据”都是课程主张，没有标准。单机原型也不能证明多节点、强隔离或生产级可用性；它只在一个受控环境里展示这些性质如何被实现和检验。

### 和实验的关系

Capstone 任务书要求先完成 AOS1 到 AOS5 中至少三个，再按里程碑推进：M1 是 ABI 加 `spawn`/`exec` 加 fake tool；M2 是隔离；M3 是 commit/rollback；M4 是 snapshot/restore；M5 是 lease/fencing；M6 是审计和重放；M7 是混沌测试、demo 和报告。每一步都以“能跑、能测、能解释”结束，不要等到最后才补测试。

```text
M1 ABI -> M2 隔离 -> M3 commit -> M4 snapshot -> M5 lease -> M6 审计 -> M7 混沌
```

看图时注意：每一步都要先有可复现的测试，再进下一步。

### 检查一下自己

1. 为什么 Capstone 要求 8 到 10 个操作，而不是 50 个工具？
2. 验收看哪四件事？
3. 哪些主张是 Capstone 证明不了的？

### 答案要点

1. 每个操作都要有类型、前置条件、幂等键、错误分类和证据，操作越多，语义和测试面越大；8 到 10 个原子操作可以通过参数组合覆盖任务，也更容易证明性质。
2. 原子性是否真的成立，权限是否真的限制住，失败是否可解释，证据是否可验证。
3. 外部副作用的原子性、`indeterminate` 的消除、进程快照的完整兼容、root 级防篡改、形式化正确性；崩溃注入只是抽样，不是证明。

**依据**：第 1 到 11 讲；AOS1 到 AOS5 任务书；Capstone 任务书；seL4（SOSP 2009）；Saga（SIGMOD 1987）；End-to-End Arguments（1984）。

**作业**：[Capstone](aos-capstone.html) · [作业总览](labs.html)

## 实验

| # | 实验 | 交付物 | 环境 |
|---|---|---|---|
| AOS1 | Typed ABI and sandboxed exec | syscall 表 + `spawn`/`exec` + 隔离 | Linux/WSL2 |
| AOS2 | Workspace transaction | commit/rollback + 崩溃恢复 | Linux/WSL2 |
| AOS3 | Capability sandbox | 句柄、衰减、撤销、逃逸测试 | Linux/WSL2 |
| AOS4 | Snapshot and restore | overlayfs/reflink 快照 + 一致恢复 | Linux/WSL2 |
| AOS5 | Lease, fencing, audit | 双主拒绝 + hash chain + replay | Linux/WSL2 |
| Capstone | Minimal Agent OS | 8–10 个操作 + 混沌测试 + 报告 | Linux/WSL2 |

每个实验都有独立任务书，按“你将完成什么 → 开始之前 → 阶段拆解 → 验收清单”组织。AOS 没有自动 judge，验收以任务书里的可观察证据为准。

- [AOS1：Typed ABI and sandboxed exec](aos1.html)
- [AOS2：Workspace transaction](aos2.html)
- [AOS3：Capability sandbox](aos3.html)
- [AOS4：Snapshot and restore](aos4.html)
- [AOS5：Lease, fencing, audit](aos5.html)
- [Capstone：Minimal Agent OS](aos-capstone.html)

### AOS1：Typed ABI and sandboxed exec {#lab-aos1}

定义一个能落到内核原语上的操作表，实现 `spawn`/`exec` 和最小隔离，并给出结构化结果和审计证据。完整任务书：[AOS1](aos1.html)。

### AOS2：Workspace transaction {#lab-aos2}

让一组文件操作具备 intent、commit、rollback 和崩溃恢复；先做单文件，再做 manifest。完整任务书：[AOS2](aos2.html)。

### AOS3：Capability sandbox {#lab-aos3}

用 capability 句柄表达权限，支持衰减、转交和撤销，并用逃逸测试检查边界。完整任务书：[AOS3](aos3.html)。

### AOS4：Snapshot and restore {#lab-aos4}

把文件、进程和运行时状态做成一致快照，恢复后重新建立外部连接。完整任务书：[AOS4](aos4.html)。

### AOS5：Lease, fencing, audit {#lab-aos5}

用 lease 和单调递增的 fencing token 拒绝旧 owner 的写，用 hash chain 记录可重放的审计事件。完整任务书：[AOS5](aos5.html)。

### Capstone：Minimal Agent OS {#lab-aos-capstone}

把 AOS1–AOS5 组合成 8–10 个操作的迷你 Agent OS，附混沌测试、故障报告和 10 分钟 demo。完整任务书：[Capstone](aos-capstone.html)。

## 延伸阅读

- `clone(2)`, `pidfd_open(2)`, `pidfd_send_signal(2)`, `waitid(2)`
- `cgroup v2` 内核文档：`Documentation/admin-guide/cgroup-v2.rst`
- `seccomp(2)`, `Landlock` 内核文档，`openat2(2)`
- `overlayfs` 内核文档，`renameat2(2)`, `O_TMPFILE`
- `CRIU` 文档，Firecracker snapshot 文档
- `eBPF` / `bpftrace` 文档
- INFRA 01 的 Raft、线性一致、2PC 章节；INFRA 02 的容器、cgroup、工作区事务章节
