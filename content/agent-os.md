# INFRA 03 · Agent OS

> **这是一门探索课，不是主流结论。**
>
> Agent OS 目前没有公认的定义、标准接口或成熟产品。本页提出的操作表、原子性主张和系统结构，都是研究性假设，可能不成立，也可能被更好的方案取代。课程要求你论证、实现、反驳，而不是把这些内容当成事实。
>
> 12 lectures · 5 labs + capstone · Linux/WSL2
>
> 核心实验只依赖内核原语：namespace、cgroup v2、overlayfs、seccomp、pidfd。不需要 GPU、KVM 或 Firecracker。

## 课程说明

今天的 agent 大多通过用户空间的接口操作计算机：`bash -c "..."`、HTTP 请求、浏览器点击、JSON 工具调用。这种方式很灵活，但不可靠。执行 `rm -rf build && make` 时，内核只看到一串字符串，不知道这些命令属于哪个任务；一个“写文件、调 API、更新数据库”的任务，第二步成功、第三步失败，没有可以恢复的检查点；一个工具继承了 shell 的全部权限，路径检查还存在 TOCTOU（检查与使用之间有时间差）；最后 agent 说“完成了”，你却没有证据。

Agent OS 不解决“让 agent 更聪明”的问题。它解决的是：**让 agent 的操作具备原子性、权限边界、幂等性和可验证的执行记录**。它不是再包一层 tool calling，也不是在用户空间模拟一个 OS；它把 agent 需要的操作交给内核执行，并定义一组新的原子操作，让 LLM 调用。

这里的“底层”指三件事：

1. **原子性由内核保证**，不靠 prompt 约束。`rename`、`cgroup.kill`、`pidfd_send_signal`、`openat2`、Landlock 这些原语有明确语义；你的接口要把它们组合成更高层的操作。
2. **权限用 capability（能力句柄）表示**，不用路径字符串。Agent 拿到的是一个不能伪造的句柄，可以缩小、转交、撤销；不是“你可以访问 `/tmp/foo`”这种能被 symlink 绕过的约定。
3. **效果由内核记录**，不采用 agent 自己的说法。审计日志记录系统调用、文件变更、进程退出、网络请求，而不是模型说“我跑过测试了”。

这门课不认为现在已经有标准的 Agent OS。课程给出一张可以论证的操作表和原型，要求你为每个操作回答五个问题：原子性由什么保证、谁有权调用、重复调用会怎样、失败后留下什么状态、凭什么证明它发生过。你可以推翻这张表，但要给出更好的方案。

## 怎么开始

1. 读 [第 1 讲 从 shell 到 syscall](#aos1) 和 [第 2 讲 边界](#aos2)。
2. 打开 [AOS1 任务书](#lab-aos1)，先定义接口表。
3. 评分接口还没冻结；先按任务书的“验收”自测，judge 会在接口冻结后补。
4. 参考：[seL4](papers.html)、[AIOS](papers.html)、[OCI Runtime Spec](papers.html)。

作业总览在 [作业与实验](labs.html)；评分标准在 [评分标准](grading.html)。

## 先修要求

- INFRA 01 的 Lab 1–4，或等价的操作系统/分布式系统基础。
- 会在 Linux 上写 Go、C 或 Rust；知道 syscall、文件描述符、fork/exec。
- 在 Linux 或 WSL2 里有 root；内核实验只在一次性环境里做。

## 课程安排

| # | 主题 | 关键问题 | 实验 |
|---|---|---|---|
| 1 | From shell to syscall | 为什么 tool schema 不能当 OS 接口？ | [AOS1](#lab-aos1) |
| 2 | Kernel/runtime boundary | 事务应该由哪一层负责？ | [AOS1](#lab-aos1) |
| 3 | Isolation and capabilities | 为什么路径字符串不能当权限？ | [AOS3](#lab-aos3) |
| 4 | Files and workspaces | 多个文件如何一次性提交？ | [AOS2](#lab-aos2) |
| 5 | Process lifecycle | 取消任务后，怎么证明没有遗留进程？ | [AOS1](#lab-aos1) |
| 6 | Transactions | 什么情况下无法回滚？ | [AOS2](#lab-aos2) |
| 7 | Snapshots and restore | 文件快照漏掉了哪些状态？ | [AOS4](#lab-aos4) |
| 8 | Resources and scheduling | 怎么强制执行 token 预算？ | — |
| 9 | Leases and fencing | 旧 owner 恢复后，为什么不能继续写？ | [AOS5](#lab-aos5) |
| 10 | Audit and evidence | 为什么 agent 自己写的日志不能当证据？ | [AOS5](#lab-aos5) |
| 11 | ABI for LLMs | 怎么设计有类型、有错误分类的操作？ | [Capstone](#lab-aos-capstone) |
| 12 | Capstone | 你的 Agent OS 能证明哪些性质？ | [Capstone](#lab-aos-capstone) |

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

设想一个 agent 接到任务：“把构建修好，跑测试，确认没有回归。”它会执行 `rm -rf build && make`，编译失败，读错误，改代码，再跑。这个过程里，内核看到的是 `unlinkat`、`execve`、`write`、`read`；它不知道“构建”是一个事务，也不知道“测试通过”需要哪些证据。Agent 只能在自然语言里维护意图，而自然语言不是内核能验证的状态。

Tool calling 比 shell 好一点：参数是结构化的，工具可以校验类型。但它仍然不够。一个 JSON schema 描述的是“参数长什么样”，不是“这个操作什么时候算完成”“失败了能不能重试”“需要什么权限”“产生了什么副作用”。模型可以从 50 个工具里挑一个，但它不知道自己有没有权限，也不知道上一次调用到底有没有生效。

我们需要把“操作”当成核心概念。一个操作至少要有七个部分：

- **线性化点**：在哪个瞬间，这个操作被认为生效。
- **前置条件**：版本号、lease、文件 hash、能力句柄。
- **后置条件**：成功后系统处于什么状态。
- **幂等键**：重复提交时，怎么识别是同一次操作。
- **副作用**：文件、进程、网络、外部 API，分别是可回滚、可补偿还是不可逆。
- **结构化错误**：`retryable`、`denied`、`conflict`、`indeterminate`，而不是一段字符串。
- **证据**：内核记录的审计事件，能证明发生了什么。

这就是“syscall”和“tool”的区别。Tool 只是一个函数；syscall 是一份有明确语义的约定。LLM 应该负责计划，不应该像一个拥有一切权限的 shell；它调用操作，内核验证并执行，返回结构化结果和证据。

**自测**

- 一个 tool schema 缺了哪三样东西，导致它不能当 OS ABI？
- 为什么幂等键需要绑定 agent、任务、工作区和操作序号，而不能只是一个随机 UUID？

**作业**：[AOS1](#lab-aos1) · [作业总览](labs.html)

**参考**：[阅读](papers.html)

## 第 2 讲：边界——内核、runtime、编排器 {#aos2}

第一个设计问题是：**事务应该由哪一层负责？**

放在 agent 进程里，最简单：agent 自己记下要做什么（intent），自己回滚。但 agent 会崩溃、会被杀、会写出 bug；它不能保证崩溃后状态一致。放在 sidecar 里，好一点：sidecar 和 agent 在同一个 Pod，能看住它的文件和行为；但 sidecar 仍然共享内核，无法阻止 agent 直接调用 syscall。放在内核里，最强：内核可以在 `open`、`exec`、`mount`、`kill` 的路径上做检查，崩溃后也能恢复；但内核开发成本高，接口一旦发布很难改。

这就是 OS 结构的选择。 monolithic kernel 把文件系统、网络、调度、驱动都放在内核里，性能好，但攻击面大；microkernel 只把 IPC、调度、内存管理放在内核，文件系统和驱动在用户态，隔离好，但 IPC 开销大；library OS 把 OS 作为库链接进应用，启动快，但隔离弱；unikernel 把应用和 OS 编成一个地址空间，适合单任务；gVisor 在用户态实现一个 Linux 兼容内核，拦截 syscall；Firecracker 用 microVM 提供硬件级隔离；WASM 用沙箱字节码提供能力模型。

Agent OS 不一定要从零写一个内核。更现实的路线是：**先在 Linux 上定义一个接口（ABI），用内核原语实现它；等接口稳定后，再把关键路径迁移到 eBPF/LSM、内核模块、gVisor 或 microVM。** 课程的原型是一个运行在用户空间的后台程序（daemon），但它的原子性来自内核，不是来自 prompt；它的权限来自 capability，不是来自路径；它的证据来自审计，不是来自模型自己的说法。

这里要区分一件事：**运行在用户空间的 daemon 不等于“用户态 OS”**。daemon 只负责调度和转发，不能自己创造原子性。每个操作都要标注“原子性来源”：

| 操作 | 原子性来源 | 是不是严格原子 |
|---|---|---|
| `workspace.commit`（单文件替换） | `rename` + `fsync` | 是，单文件 |
| `terminate` | `pidfd_send_signal` + `cgroup.kill` | 是，进程组级 |
| `workspace.commit`（多文件） | 暂存目录 + manifest 切换 + 崩溃恢复 | 不是；只能做到“可恢复”，不是内核级多文件原子 |
| 跨服务副作用 | saga（补偿事务）/ 补偿操作 / 幂等表 | 不是；只能做到“最终一致或可补偿” |

这张表比“我们做了一个 OS”这句话更重要。课程会反复问：这个操作的原子性到底由谁保证？如果答案是“由 runtime 的约定保证”，那它就不是内核级原子操作；如果答案是“由内核原语保证”，那你要说清楚是哪个原语、覆盖哪些对象、失败时留下什么状态。

哪些东西应该放进内核？隔离、调度、内存、IPC、能力检查、审计钩子。哪些应该留在 runtime？工具适配、模型调用、策略、重试编排。LLM 不应该进内核：它不确定、会幻觉、不可形式化；内核应该是确定性的、可验证的。反过来，内核也不应该试图理解自然语言；它只执行类型化的操作。

**原型放在哪一层**

| 方案 | 隔离 | 原子性 | 性能 | 工程成本 | 适合 |
|---|---|---|---|---|---|
| Linux + 用户态 daemon | 中 | 组合内核原语 | 高 | 低 | 课程原型、早期产品 |
| eBPF/LSM + 内核模块 | 高 | 可在内核实现 | 高 | 高 | 研究、生产加固 |
| gVisor | 高 | 用户态内核可定制 | 中 | 中 | 多租户工具执行 |
| Firecracker | 很高 | 快照/恢复强 | 高 | 中 | 强隔离、serverless |
| seL4 | 很高 | capability 原生 | 高 | 很高 | 高保证场景 |
| WASM | 高 | 沙箱内 | 高 | 中 | 纯计算工具 |

**自测**

- 为什么不能把 LLM 放进内核？如果它只是一个“策略模块”呢？
- 用户态 daemon 能保证哪些原子性？哪些必须放进内核？

**作业**：[AOS1](#lab-aos1) · [作业总览](labs.html)

**参考**：[阅读](papers.html)

## 第 3 讲：隔离——让 agent 只看见它该看见的 {#aos3}

一个常见的泄漏场景：agent 的工具以当前用户身份运行，读到了 `~/.ssh/id_rsa`；另一个工具把 token 作为命令行参数传进去，`ps` 里所有人都能看到；还有一个工具用 `chroot` 做“沙箱”，但 agent 用 `chdir("..")` 和 `chroot(".")` 就能逃出来。

隔离要用内核机制，不能靠路径约定。namespace 把 PID、mount、network、IPC、UTS、user、cgroup、time 分开；cgroup 限制 CPU、内存、进程数、I/O；seccomp 过滤 syscall；Landlock 让进程声明“我只能访问这些目录”，而且不能被路径绕过；capability 把 root 的特权拆成小块；`no_new_privs` 阻止 setuid 提权；`openat2(RESOLVE_BENEATH)` 在解析路径时限制在某个目录下，避免 symlink 和 `..` 逃逸。

但“隔离”不只是“看不见”。它还包括**授权**：agent 能对哪些资源做什么。路径字符串不能当 capability，因为它可以被 symlink、bind mount、`/proc/self/fd` 绕过；能力句柄是内核对象，可以被引用、复制、转交、撤销，但不能伪造。一个设计良好的 Agent OS 应该让 LLM 拿到一个 `workspace_t` 句柄，而不是一个 `/home/user/project` 字符串；句柄绑定到具体的 inode 和权限，路径变了也不会失效。

**一个可复现的故障案例**：某个 agent runtime 把 MCP token 放在环境变量里，工具进程又把它写进了日志；另一个进程用 `ps` 读到了完整的命令行。问题不是“日志没脱敏”，而是“权限放在环境变量里，不是能力句柄；任何能读进程环境的进程都能拿到它”。正确的修法不是加一条正则，而是把 token 放进只读 fd，用 `SCM_RIGHTS` 传给需要它的进程，并在审计里记录“谁在什么时候拿到了哪个句柄”。

**自测**

- 为什么 `chroot` 不是安全边界？`pivot_root` 解决了什么，没解决什么？
- 路径白名单为什么有 TOCTOU？`openat2` 和 Landlock 分别怎么缓解？

**作业**：[AOS3](#lab-aos3) · [作业总览](labs.html)

**参考**：[阅读](papers.html)

## 第 4 讲：文件与工作区——原子性从哪里来 {#aos4}

Agent 最常做的事是改文件。改文件看起来简单，实际上是整个系统里最容易出现“只完成一半”的地方：写 `main.go` 写到一半，formatter 又把它重写；测试读到写了一半的文件；进程崩溃，磁盘上留下一个语法不完整的文件；两个 agent 同时改同一个文件，后写的覆盖先写的。

POSIX 给了几个关键保证，但很多人记错：

- `write` 对普通文件不保证原子；多个进程并发写，内容可能交错。
- `rename` 在同一条文件系统内是原子的：读者要么看到旧名字，要么看到新名字，不会看到“半个文件”。跨文件系统会退化成 copy + unlink，不原子。
- `O_TMPFILE` 创建一个没有名字的文件，写完可以用 `linkat(AT_EMPTY_PATH)` 挂到目标名；中间状态不会被别人看到。
- `renameat2(RENAME_EXCHANGE)` 原子交换两个文件；`RENAME_NOREPLACE` 在目标存在时失败，适合做“只创建一次”。
- `fsync` 文件保证内容落盘；`fsync` 目录保证目录项（文件名、inode 链接）落盘。只 `fsync` 文件不 `fsync` 目录，崩溃后文件可能“消失了”。
- `mmap` 的写回不是即时的；`msync` 才能保证。

工作区事务可以基于这些原语实现：把变更写进一个暂存目录；每个文件用临时文件 + `rename` 替换；写完 `fsync` 所有文件和目录；最后原子地切换一个 manifest 或 symlink。崩溃恢复时，读 manifest，决定回滚还是继续。overlayfs 可以让“切换”变成改一个挂载点；reflink（`FICLONE`）可以让“复制整个工作区”变成 O(1) 的写时复制（CoW）。

但文件系统事务不等于业务事务。Agent 可能同时调用了外部 API、发了消息、创建了云资源；这些副作用不在文件系统里，不能靠 `rename` 回滚。第 6 讲会讲怎么把它们分成“可回滚、可补偿、不可逆”三类。

**自测**

- `rename` 跨目录原子吗？跨文件系统呢？
- 为什么 `fsync` 文件之后还要 `fsync` 目录？`O_TMPFILE` 解决了哪个竞态？

**作业**：[AOS2](#lab-aos2) · [作业总览](labs.html)

**参考**：[阅读](papers.html)

## 第 5 讲：进程生命周期——启动、取消、回收 {#aos5}

Agent 启动一个工具，工具又启动子进程；用户点“取消”；agent 只杀了父进程，子进程还在写文件。几分钟后，工作区里出现了“已经取消”的任务留下的半成品。这不是 agent 的 bug，而是取消的语义没有定义。

Linux 的进程原语比 `kill(pid)` 细得多。`clone3(CLONE_PIDFD)` 在创建进程时同时拿到一个 pidfd；`pidfd_send_signal` 可以无 race 地给进程发信号；`waitid(P_PIDFD)` 可以等这个 pidfd；`PR_SET_CHILD_SUBREAPER` 让一个进程收养孤儿，负责 `wait`；process group 和 session 可以一次给一组进程发信号，但子进程可以 `setsid` 逃出去；`cgroup.kill` 可以一次杀掉整个 cgroup 的进程，`cgroup.freeze` 可以暂停而不是杀死。

一个可靠的取消协议应该：给任务一个截止时间；先 `SIGTERM`，给优雅退出的窗口；同时停止接收新请求；等所有子进程退出；超时后 `cgroup.kill`；最后检查 cgroup 是否为空、有没有僵尸、有没有未 flush 的输出。取消不是一个信号，而是一个状态机：`running → cancelling → cancelled`，每一步都要有证据。

孤儿进程还会导致资源泄漏。容器退出后，如果子 cgroup 里还有进程，cgroup 不会被销毁，内存和 PID 都被占着。一个常见的故障是“容器已经退了，节点上的 cgroup 还在，资源一直不释放”；正确的做法是退出时递归检查子 cgroup，先 `cgroup.kill`，再等 `cgroup.events` 的 `populated=0`。

**自测**

- 为什么 `kill(-pgid)` 不能保证杀掉所有子进程？`cgroup.kill` 强在哪？
- 取消后如何证明“没有孤儿进程还在写工作区”？

**作业**：[AOS1](#lab-aos1) · [作业总览](labs.html)

**参考**：[阅读](papers.html)

## 第 6 讲：事务——intent、commit、rollback {#aos6}

一个多步骤任务：写文件、调外部 API、更新数据库。第二步成功了，第三步失败了。Agent 说“我回滚了”，但它只删了文件；外部 API 的副作用还在，数据库里也没有对应的记录。用户看到的是“回滚成功”，系统里却只完成了一半。

事务的核心不是“加锁”，而是**定义一个原子边界，并让所有参与者在边界上达成一致**。单机文件可以用 `rename` 做原子提交；跨服务要用 2PC、saga（补偿事务）或 outbox（先写本地表，再异步投递）；跨外部 API 通常只能补偿，不能回滚。2PC 的 prepare 阶段锁定资源，commit 阶段统一提交；协调者崩溃会阻塞，需要恢复协议。Saga 把长事务拆成一系列本地事务，每个都有一个补偿操作；补偿不是“撤销”，而是“用另一个操作抵消”，可能失败，也可能不完美。

Agent 事务需要比数据库更宽的状态机：`intent`（记录要做什么）、`running`（执行中）、`committed`（已提交）、`aborted`（已回滚）、`indeterminate`（结果未知）。`indeterminate` 必须是接口的一部分：超时、网络断开、进程崩溃都可能让 agent 不知道外部操作有没有生效；这时不能盲目重试，也不能假装失败，要查审计、查幂等表、查外部系统的状态。

幂等键是这一切的基础。它要绑定“谁、在哪个工作区、做第几次操作”，而不只是一个随机 UUID；服务端要持久化“这个键已经执行过，结果是 X”，重试时返回同一个结果。没有幂等表，`exactly-once` 只是空话；有了幂等表，至少能做到“效果恰好一次，响应至少一次”。

**一个可复现的故障案例**：某个 runtime 的 rollback 报告 `complete`，但它只回滚了文件，没有回滚已经发出的 webhook。另一个 runtime 在计算事务读集时把文件的 atime 也算进去，导致大量假冲突，吞吐骤降。两个问题的共同点是：**事务的范围没有覆盖所有副作用**。设计时要先列出所有副作用，再决定哪些进事务、哪些用补偿、哪些标记为不可逆。

**自测**

- 什么时候 rollback 是不可能的？此时应该怎么向 LLM 表达？
- 为什么“补偿”不等于“撤销”？举一个补偿失败的例子。

**作业**：[AOS2](#lab-aos2) · [作业总览](labs.html)

**参考**：[阅读](papers.html)

## 第 7 讲：快照、分支与恢复 {#aos7}

Agent 想试三种方案。它把仓库复制了三份，每份几百 MB；磁盘很快满了，恢复还要几分钟。更糟的是，它只复制了文件，没有复制进程状态；恢复后，正在跑的服务、打开的文件描述符、内存里的缓存都没了。

快照有三个层次：**文件系统快照**（overlayfs upperdir、btrfs/ZFS snapshot、reflink）、**进程快照**（CRIU checkpoint/restore）、**内存和整机快照**（Firecracker snapshot、gVisor checkpoint）。文件系统快照开销小，适合工作区回滚；进程快照能保住 fd、内存、信号状态，但兼容性和开销更复杂；整机快照隔离最强，适合多租户和 serverless，但快照里有内核状态和设备状态。

一致性是难点。文件快照和进程快照不是同一个瞬间：你可能拍到了一个“进程认为文件已写、但磁盘还没落盘”的状态。要得到一致快照，需要先冻结进程（`cgroup.freeze` 或 `SIGSTOP`），`fsync` 文件系统，再拍快照，最后解冻。外部副作用仍然不能快照：已经发出的 HTTP 请求、已经扣的款、已经发的消息，都快照不了；这些只能靠事务日志和补偿。

**自测**

- 文件系统快照和进程快照分别缺什么状态？
- 为什么“先 freeze 再 snapshot”比“直接 copy”更一致？

**作业**：[AOS4](#lab-aos4) · [作业总览](labs.html)

**参考**：[阅读](papers.html)

## 第 8 讲：资源与调度——token 也是资源 {#aos8}

一个 agent 陷入循环，十分钟消耗两百万 token；CPU 利用率很低，cgroup 没有任何告警，账单却爆了。传统的资源模型管 CPU、内存、I/O、PID，但 agent 的主要成本是 token、工具调用次数、外部 API 配额和实际耗时（wall-clock time）。

Agent OS 的资源模型要同时管两类资源：**机器资源**（cgroup v2 的 `cpu.max`、`memory.max`、`io.max`、`pids.max`）和**语义资源**（token 预算、工具调用配额、并发子 agent 数、外部 API QPS）。机器资源由内核强制，语义资源由 runtime 强制；两者都要有预留（reserve）、用量（usage）、限额（quota）和计费（charge）。

调度也有两层：节点级调度决定 agent 跑在哪台机器；任务级调度决定哪个 agent 先拿到模型、工具和锁。Kubernetes 的 requests/limits 适合机器资源；token 预算需要一套自己的 admission 和 fair scheduling。一个常见的错误是把 token 预算做成“事后统计”，而不是“事前预留”；事后只能告诉你超了，不能阻止超。

Agent 的“内存”也不只是 RAM。上下文窗口、对话历史、向量索引、工作区文件都是记忆；它们有不同的持久性和一致性。`checkpoint` / `restore` / `fork_context` 是记忆管理的原语；`fork_context` 应该像 `fork` 一样 CoW，而不是复制整个上下文。把上下文当文件描述符管理，比把它当字符串拼接更容易做预算、隔离和回收。

**自测**

- 为什么 token 预算不能直接映射成 cgroup？它还缺哪些维度？
- 重试和子 agent 会如何绕过预算？怎么在 ABI 层堵住？

**作业**：[AOS1](#lab-aos1) · [Capstone](#lab-aos-capstone) · [作业总览](labs.html)

**参考**：[阅读](papers.html)

## 第 9 讲：协调——lease、fencing、单所有者 {#aos9}

两个 agent 同时认为自己是同一个工作区的 owner，都开始写。最后一个写的赢，中间的文件被覆盖，审计日志里两个人都说“我提交了”。这不是“锁没加”，而是“锁没有 fencing”。

Lease 是一段时间内的所有权：client 向 lease service 申请一个带 TTL 的租约，定期续约；过期后，service 可以把所有权给别人。问题在于，client 可能因为 GC pause、网络延迟、时钟漂移，在 lease 过期后还以为自己持有租约，继续写。解决办法是 **fencing token**：每次授予 lease 时发一个单调递增的编号；存储层记住最大的 token，拒绝更小的写。这样即使旧 owner 复活，它的写也会被拒绝。

分布式锁如果没有 fencing（栅栏），就起不到锁的作用。etcd 的 lease、Kubernetes 的 `Lease` 对象、Chubby 的 sequencer、ZooKeeper 的 zxid，都是这个思路。多 agent 场景还要区分“工作区所有权”和“文件锁”：文件锁保护一个文件，lease 保护一个角色；两者可以组合，但不能互相替代。

**自测**

- 为什么 lease 需要单调 fencing token？只靠 TTL 会出什么问题？
- 一个 agent 被 `SIGSTOP` 暂停 30 秒后恢复，它还能写吗？谁来拒绝？

**作业**：[AOS5](#lab-aos5) · [作业总览](labs.html)

**参考**：[阅读](papers.html)

## 第 10 讲：观察与审计——可验证的执行记录 {#aos10}

Agent 说“测试通过了”。你打开日志，发现它跑的是 `go test ./...`，但工作区里有一个被修改过的 `go.mod`，测试其实用了缓存；或者它根本没跑测试，只是复述了上一次的输出。日志是 agent 自己写的，不是证据。

“可验证的执行记录”需要三层：**事件**（谁在什么时候做了什么系统调用/文件变更/网络请求）、**证据**（不可篡改的日志、hash chain、签名）、**可重放**（给定事件流，能重建关键状态）。eBPF 可以在内核 tracepoint/kprobe 上抓 `execve`、`openat`、`connect`、`mmap`；`ptrace` 可以抓 syscall，但开销大；`fanotify` 可以监控文件访问，但有盲区；`inotify` 只告诉你“变了”，不告诉你“谁改的”。

审计不等于把日志收集到一起。审计要有明确的 schema、追加写、防篡改、保留策略和查询接口。一个常见的做法是把每条事件串成 hash chain：`h_i = H(h_{i-1} || event_i)`；任何一条被改，后面的 hash 都对不上。更强的是把关键事件写到外部不可变存储，或者用 TEE/远程证明。课程不要求你做密码学，但要求你知道“agent 自己的说法”和“内核记录的证据”的区别。

**自测**

- 为什么 agent 自己的日志不能当审计证据？eBPF 又看不到什么？
- Hash chain 能防什么？不能防什么？

**作业**：[AOS5](#lab-aos5) · [作业总览](labs.html)

**参考**：[阅读](papers.html)

## 第 11 讲：给 LLM 的 ABI——类型化操作与结构化错误 {#aos11}

现在你有一个 50 个工具的 agent。模型经常选错工具，参数类型不对，失败了就重试，重试又产生重复副作用；错误是一段自然语言，模型只能猜“这是不是暂时性的”。这不是模型不够聪明，而是 ABI 没有设计好。

一个好的 Agent OS 接口应该像 syscall 一样，有操作表、类型、能力句柄、前置条件、后置条件、幂等键、错误分类、返回值和版本。下面是一张**设计表**，不是标准；课程要你论证每个操作的原子性范围和失败语义。

| 类别 | 原子操作 | 语义 | 关键失败 |
|---|---|---|---|
| 生命周期 | `spawn`, `suspend`, `resume`, `terminate`, `reap` | 创建/暂停/恢复/终止/回收任务进程 | 孤儿、僵尸、取消失败 |
| 工作区 | `workspace.open`, `snapshot`, `commit`, `rollback`, `merge` | 对一组文件做全有或全无的变更 | 半写、崩溃、冲突 |
| 执行 | `exec`, `exec.batch`, `cancel`, `status` | 调用工具/命令，返回结构化结果 | 超时、重复、输出截断 |
| 权限 | `cap.grant`, `cap.derive`, `cap.revoke`, `cap.delegate` | 授予/派生/撤销/转交能力 | 权限膨胀、路径逃逸 |
| 资源 | `reserve`, `release`, `quota.set`, `charge` | 预留/释放/限额/计费 | 超卖、泄漏、token 爆炸 |
| 协调 | `lease.acquire`, `lease.renew`, `lease.release`, `fence` | 租约与栅栏 | 双主、过期写 |
| 观察 | `watch`, `wait`, `trace`, `audit.query` | 订阅事件/等待/追踪/审计 | 丢事件、日志撒谎 |
| 记忆 | `checkpoint`, `restore`, `fork_context` | 检查点/恢复/分叉上下文 | 状态不一致、上下文污染 |

权限类操作要特别小心：`cap.grant`、`cap.delegate`、`cap.revoke` 不应该由 LLM 直接调用，它们是策略层或人类审批的操作；LLM 只能 `cap.derive` 出一个更小的子能力，或者发起一个 `cap.request` 等待审批。否则这个接口就成了提权工具。

每个操作都用同一套信封：

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

错误分类比错误信息重要：

| 错误 | 含义 | LLM 应该做什么 |
|---|---|---|
| `invalid` | 参数或前置条件不合法 | 修正参数，不要重试 |
| `denied` | 能力不足 | 申请能力或停止 |
| `conflict` | 版本/lease 冲突 | 重新读取状态，重新规划 |
| `retryable` | 暂时性失败 | 用同一个幂等键重试 |
| `indeterminate` | 副作用可能已发生 | 查 `status`/`audit`，不要盲重试 |
| `internal` | 内核/实现错误 | 停止并报告 |

LLM 侧的使用方式是：**plan → syscall → observe**。模型提出一个计划，runtime 做静态检查（能力、前置条件、预算），内核执行，返回结构化结果和证据；模型根据错误分类决定下一步。模型不应该持有原始 capability，只持有绑定到任务的句柄；不应该直接读 `/proc`，只能通过 `audit.query` 看授权范围内的事件；不应该自己拼 shell，只能调用 `exec`。

接口要版本化。内核不能假设 LLM 永远调用最新版；每个操作带 `abi_version`，旧版本至少在一个生命周期内可用，弃用要有迁移路径。返回结果也要带版本，否则模型会把新字段当旧字段解释。

**设计练习**：把上面 8 类操作删到 5 个，写出你删掉的理由；再用一个故障场景证明你删错了一个。然后把 5 个操作扩展成 12 个，看看哪些是真正独立的原子操作，哪些只是参数组合。

**自测**

- 为什么 tool schema 不足以描述一个 syscall？至少缺哪四样？
- `indeterminate` 为什么不能简单重试？幂等键在这里起什么作用？

**作业**：[Capstone](#lab-aos-capstone) · [作业总览](labs.html)

**参考**：[阅读](papers.html)

## 第 12 讲：Capstone——实现一个最小 Agent OS {#aos12}

Capstone 的目标不是做一个“全能 agent 平台”，而是做一个**能证明原子性和权限边界的最小系统**。你要实现一个 daemon，通过 Unix socket 暴露 8–10 个操作；一个脚本化 planner 或小模型调用它，完成一个多步骤任务；系统要在崩溃、重复请求、并发 agent、权限逃逸和磁盘满的情况下仍然可解释。

最低要求：

- **ABI**：至少 8 个操作，覆盖 `spawn`、`exec`、`workspace.commit`、`workspace.rollback`、`snapshot`、`lease.acquire`、`audit.query`、`terminate`；每个操作有类型、前置条件、幂等键、错误分类和证据。
- **隔离**：工具在 namespace + cgroup + seccomp/Landlock 下运行；非 root；只读 rootfs；能力按需授予。
- **工作区事务**：overlayfs 或 staging + 原子 rename；commit/rollback 可崩溃恢复；读者永远看到完整文件。
- **快照**：工作区级 snapshot/restore；至少支持三个分支；说明哪些状态不能快照。
- **协调**：lease + fencing token；两个 agent 并发写时，旧 owner 的写被拒绝。
- **审计**：append-only 事件流，hash chain；能回答“谁在什么时候改了什么”；能重放关键步骤。
- **测试**：崩溃注入、重复请求、并发 agent、权限逃逸、孤儿进程、磁盘满，各至少一次。
- **报告**：10 页以内，说明设计、失败语义、未解决的问题；不要只贴代码。

里程碑建议：

1. M1：ABI + `spawn`/`exec` + fake tool；能跑通一个 hello world。
2. M2：namespace/cgroup/seccomp 隔离；能证明工具读不到宿主文件。
3. M3：工作区 commit/rollback；崩溃后状态确定。
4. M4：snapshot/restore；三个分支互不污染。
5. M5：lease/fencing；两个 agent 并发写，旧 owner 被拒绝。
6. M6：审计 + 重放；能从事件流重建一次任务。
7. M7：混沌测试 + demo + 报告。

验收看四件事：**原子性是否真的成立**、**权限是否真的限制住**、**失败是否可解释**、**证据是否可验证**。不看你接入了多少工具，也不看你用了多大的模型。

**作业**：[Capstone](#lab-aos-capstone) · [作业总览](labs.html)

**参考**：[阅读](papers.html)

## 实验

这门课有五个实验，加一个 capstone。每个实验都给目标、任务、验收和常见坑，不给完整代码。建议在一次性的 Linux/WSL2 环境里做，做完就快照/重装。

### AOS1：类型化 ABI 与沙箱执行 {#lab-aos1}

**目标**：定义一个最小 syscall 表，实现 `spawn` 和 `exec`，并让工具在隔离环境里运行。

**任务**：

1. 设计 ABI：操作名、参数类型、前置条件、幂等键、错误分类、返回值。
2. 用 Unix socket 实现 daemon；客户端发送 JSON 或长度前缀的二进制请求。
3. `spawn` 创建子进程，放进新的 PID/mount/net namespace；`exec` 在 cgroup 里跑命令，设 `memory.max` 和 `pids.max`。
4. 用 seccomp 或 Landlock 限制工具只能读工作区；用 `openat2(RESOLVE_BENEATH)` 防路径逃逸。
5. 返回结构化结果：`status`、`exit`、`stdout` artifact、`effects`、`evidence`。

**验收**：工具读不到 `~/.ssh`；超过内存限制被 kill；重复 `exec` 用同一个幂等键不会产生两次副作用（可以用一个写文件的 fake tool 验证）。

**常见坑**：PID namespace 里要重新挂 `/proc`；cgroup v2 要写 `cgroup.procs`；seccomp 默认拒绝后要放行必要的 syscall；Landlock 需要在 `exec` 前设置，且不能撤销。

### AOS2：工作区事务 {#lab-aos2}

**目标**：实现 `workspace.commit` / `rollback`，保证读者永远看到完整版本。

**任务**：

1. 用 overlayfs 或 staging 目录管理工作区；基线只读，变更写 upper/staging。
2. `commit`：`fsync` 所有文件；原子切换 manifest 或 symlink；`fsync` 目录；返回新版本号。
3. `rollback`：丢弃 upper/staging；恢复到上一个版本；返回版本号。
4. 并发读：读者在 commit 过程中持续读，验证不会看到写了一半的文件。
5. 崩溃测试：在 commit 的每个阶段 `kill -9`，重启后检查状态（旧版本或新版本，不能混合）。

**验收**：读者零次看到写了一半的文件；崩溃后状态确定；rollback 后 hash 与基线一致；并发写有冲突检测。

**常见坑**：`rename` 只在同一文件系统内原子；overlayfs 的 copy-up 有开销；whiteout 要处理；`fsync` 目录不能漏。

### AOS3：能力沙箱与权限收敛 {#lab-aos3}

**目标**：把“路径权限”换成“能力句柄”，并证明逃逸尝试会失败。

**任务**：

1. 设计 `cap_t`：绑定工作区 inode、操作类型（读/写/执行）、有效期、可转交标志。
2. 用 `SCM_RIGHTS` 传 fd，而不是传路径；daemon 只接受句柄，不接受绝对路径。
3. 用 seccomp 过滤 `mount`、`ptrace`、`bpf` 等危险 syscall；用 `openat2` 限制路径；如果内核支持 Landlock，再加一层；drop capabilities。
4. 写一组逃逸测试：`..`、symlink、`/proc/self/fd`、bind mount、`chroot` 逃逸、读 `/etc/shadow`。
5. 记录每次能力使用到审计日志；实现 `cap.revoke`。

**验收**：所有逃逸测试失败；撤销能力后，旧句柄不能继续用；审计能回答“谁用了哪个能力”。

**常见坑**：fd 传过去后，接收方可以 `fchdir`；Landlock 不能限制已经打开的 fd；seccomp 过滤 `openat` 会影响动态链接；user namespace 里 mount 的语义不同。

### AOS4：快照与恢复 {#lab-aos4}

**目标**：实现工作区级 snapshot/restore，并讨论进程快照的边界。

**任务**：

1. 用 overlayfs 或 reflink 做工作区快照；记录 snapshot id、父 snapshot、manifest hash。
2. 实现 `snapshot`、`restore`、`list`；restore 要原子切换，不能影响正在读的进程。
3. 做三个分支：从同一个基线出发，改不同文件，互不污染。
4. 用 `cgroup.freeze` + `fsync` 做一致快照；对比“直接 copy”的结果。
5. 选做：用 CRIU 对一个简单进程做 checkpoint/restore，记录失败的情况。

**验收**：三个分支互不污染；restore 后文件 hash 正确；一致快照在崩溃后可恢复；报告说明哪些状态不能快照。

**常见坑**：overlayfs 快照不是原子的；reflink 依赖文件系统；CRIU 对网络、GPU、复杂 fd 的支持有限；外部副作用无法快照。

### AOS5：租约、栅栏与审计 {#lab-aos5}

**目标**：让两个 agent 安全地共享一个工作区，并能证明谁做了什么。

**任务**：

1. 实现 `lease.acquire/renew/release`，TTL 可配置；返回单调递增的 `epoch`。
2. 在工作区写入路径检查 `epoch`：小于当前最大 epoch 的写被拒绝（fencing）。
3. 模拟 GC pause：`SIGSTOP` 旧 owner 30 秒，让 lease 过期，新 owner 接管；恢复旧 owner，验证它的写被拒绝。
4. 实现 append-only 审计日志：每条事件有 `ts`、`actor`、`op`、`args_hash`、`result`、`prev_hash`、`hash`。
5. 实现 `audit.query` 和 `replay`：给定任务 ID，重建关键步骤；验证 hash chain。

**验收**：双主场景下只有一个 owner 能写；旧 owner 恢复后写失败；审计能复现一次任务；篡改一条事件会被发现。

**常见坑**：lease 续约和写不是原子的；时钟漂移；`SIGSTOP` 期间 TCP 连接可能断；审计日志的 `fsync` 会影响性能；hash chain 不防删除末尾事件。

### Capstone：最小 Agent OS {#lab-aos-capstone}

把 AOS1–AOS5 组合起来，按第 12 讲的清单实现，附一份故障报告和 10 分钟 demo。可以选一个真实的小任务（例如“改一个 Markdown 文件、跑一次链接检查、提交一个 artifact”）作为端到端场景；不要接真实凭证，不要接生产 API。

## 延伸阅读

- `clone(2)`, `pidfd_open(2)`, `pidfd_send_signal(2)`, `waitid(2)`
- `cgroup v2` 内核文档：`Documentation/admin-guide/cgroup-v2.rst`
- `seccomp(2)`, `Landlock` 内核文档，`openat2(2)`
- `overlayfs` 内核文档，`renameat2(2)`, `O_TMPFILE`
- `CRIU` 文档，Firecracker snapshot 文档
- `eBPF` / `bpftrace` 文档
- INFRA 01的 Raft、线性一致、2PC 章节；INFRA 02的容器、cgroup、工作区事务章节
