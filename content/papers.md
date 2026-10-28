# 阅读

> 官方 schedule：https://pdos.csail.mit.edu/6.5840/schedule.html
>
> 论文版权归原作者/出版方所有。

## 怎么读

1. 先读 Abstract、Introduction、Conclusion，回答“它解决什么问题”。
2. 再看设计：数据结构、协议、失败模式。
3. 最后看 evaluation：它测了什么、没测什么、代价是什么。
4. 用中文写 5 句话：问题、假设、机制、代价、和上一篇的关系。

## INFRA 01 · 核心阅读

### [MapReduce (2004)](https://static.googleusercontent.com/media/research.google.com/en//archive/mapreduce-osdi04.pdf) {#mapreduce}

**一句话**：把大规模数据处理抽象成 `map` 和 `reduce`，让框架处理并行、分区、失败重试。

**阅读重点**：
- coordinator 怎么分任务、怎么处理 straggler。
- 中间文件怎么命名、怎么原子写。
- 为什么 map 输出要按 key 分区。

**和 lab 的关系**：Lab 1 就是简化版 MapReduce。

### [GFS (2003)](https://static.googleusercontent.com/media/research.google.com/en//archive/gfs-sosp2003.pdf) {#gfs}

**一句话**：Google 的大文件系统，用 master + chunkserver + lease 支持大规模顺序读写和追加。

**阅读重点**：
- 单 master 怎么避免瓶颈。
- lease 怎么保证只有一个 chunkserver 能写。
- 原子追加（atomic append）的语义。
- 失败恢复：master 崩溃、chunkserver 崩溃。

**和 lab 的关系**：理解“复制 + 租约 + 失败恢复”的工程取舍；Lab 3 的 Raft 是另一条路线。

### [Paxos (2001) / Paxos Made Simple](https://lamport.azurewebsites.net/pubs/paxos-simple.pdf) {#paxos}

**一句话**：最经典的共识算法；proposer 提议、acceptor 投票、learner 学习，多数派保证安全。

**阅读重点**：
- 为什么需要多数派。
- safety 和 liveness 的区别。
- 为什么 Paxos 难实现（工程细节多）。

**和 lab 的关系**：Raft 是“更易理解”的 Paxos 变体；对照读更容易懂 Raft。

### [Raft (2014)](https://raft.github.io/raft.pdf) {#raft}

**一句话**：用 leader election + log replication + safety 规则实现共识，强调可理解性。

**阅读重点**：
- Figure 2：每个状态的字段和规则。
- 5.4.1 选举限制。
- 5.4.2 commit 规则（Figure 8）。
- 7 节：日志压缩 / snapshot。

**和 lab 的关系**：Lab 3 的全部内容。中文翻译：https://github.com/maemual/raft-zh_cn

### [Time, Clocks, and the Ordering of Events (1978)](https://lamport.azurewebsites.net/pubs/time-clocks.pdf) {#time-clocks}

**一句话**：用逻辑时钟和偏序描述分布式系统中的“先后”，不依赖物理时钟。

**阅读重点**：
- 偏序（happened-before）和全序的区别。
- 逻辑时钟怎么更新，为什么不能直接当物理时间用。
- 物理时钟同步的假设和误差。

**和 lab 的关系**：Raft 的 term、lease 的 epoch、线性一致的 real-time order 都建立在“顺序”上；先理解逻辑顺序，再区分哪些地方必须用物理时间。

### [Linearizability (1990)](https://cs.brown.edu/~mph/HerlihyW90/p463-herlihy.pdf) {#linearizability}

**一句话**：定义“线性一致”：每个操作看起来在某个瞬间原子生效，并尊重实时顺序。

**阅读重点**：
- history、real-time order、legal sequential history。
- 可组合性（composability）。
- 和 serializability 的区别。

**和 lab 的关系**：Lab 2/4 的 KV 服务要求线性一致；测试用 porcupine 检查。

### [ZooKeeper (2010)](https://www.usenix.org/legacy/event/atc10/tech/full_papers/Hunt.pdf) {#zookeeper}

**一句话**：一个协调服务，提供 znode、watch、session，用 ZAB 协议做复制。

**阅读重点**：
- 为什么用“顺序一致性 + 客户端 FIFO”而不是线性一致。
- watch 的语义和一次性触发。
- leader election / distributed lock 怎么用 znode 实现。

**和 lab 的关系**：Lab 2 的锁可以用 KV 实现；ZooKeeper 是工业界的版本。

### [Spanner (2012)](https://research.google/pubs/spanner-googles-globally-distributed-database-2/) {#spanner}

**一句话**：全球分布式 SQL，用 TrueTime + Paxos group 实现外部一致性。

**阅读重点**：
- TrueTime 的误差区间怎么用。
- Paxos group + 两阶段提交。
- 外部一致性（external consistency）的定义。

**和 lab 的关系**：Lab 5 的分片 + 配置变更，是 Spanner 的简化版。

### [Chain Replication (2004)](https://www.semanticscholar.org/paper/Chain-Replication-for-Supporting-High-Throughput-Renesse-Schneider/9a091dacf855c1b6a0cd4361194e238fe6e1ff11) {#chain-replication}

**一句话**：主备链：写从 head 到 tail，读从 tail，强一致。

**阅读重点**：
- 为什么读 tail 能保证强一致。
- 失败恢复：head/tail 挂了怎么办。
- 和 Raft 的取舍：吞吐 vs 可用性。

**和 lab 的关系**：理解复制协议的多样性；Lab 3 是 Raft 路线。

### [FaRM (2015)](https://www.microsoft.com/en-us/research/wp-content/uploads/2014/02/aleksandar-dragojevic.pdf) {#farm}

**一句话**：用 RDMA + OCC + 复制做内存事务系统，追求低延迟。

**阅读重点**：
- OCC 的读/写集和验证。
- RDMA 的 one-sided operations。
- 为什么需要复制和恢复。

**和 lab 的关系**：Lab 4 的事务/KV 是简化版；FaRM 是性能极限的另一端。

### [IronFleet (2015)](https://www.microsoft.com/en-us/research/publication/ironfleet-proving-practical-distributed-systems-correct/) {#ironfleet}

**一句话**：用机器验证的方法证明分布式系统（包括 Paxos）的正确性。

**阅读重点**：
- 怎么把协议和实现分层。
- refinement proof 的思路。
- 验证的代价和边界。

**和 lab 的关系**：提醒你 Raft 的“正确”不是靠测试堆出来的；测试只是抽样。

### [Memcached at Facebook (2013)](https://www.usenix.org/system/files/conference/nsdi13/nsdi13-final170_update.pdf) {#memcached}

**一句话**：Facebook 的大规模缓存系统，讲 lease、一致性、尾延迟。

**阅读重点**：
- cache lease 怎么防止 stale read。
- 为什么尾延迟重要。
- 多区域部署的取舍。

**和 lab 的关系**：Lab 2 的 lease/版本号思路在大规模系统里的样子。

### [AWS Lambda (2023)](https://arxiv.org/abs/2305.13162) {#lambda}

**一句话**：Serverless 平台的内部：隔离、冷启动、快照恢复、Firecracker。

**阅读重点**：
- 为什么用 microVM 而不是容器。
- 冷启动的优化（snapshot/restore）。
- 多租户隔离和安全边界。

**和 lab 的关系**：如果你做 agent runtime 或进程内核，这一篇和隔离/恢复问题很接近。

### [Ray (2021)](https://arxiv.org/abs/1712.05889) {#ray}

**一句话**：分布式 Python 的 task/actor 模型，强调调度和 lineage。

**阅读重点**：
- task graph 和 lineage-based recovery。
- actor 的状态管理。
- 调度器的取舍。

**和 lab 的关系**：和 agent 任务调度、DAG 执行相关；如果你做 agent runtime，会遇到相似的调度和恢复问题。

### [SUNDR (2004)](https://www.usenix.org/legacy/event/osdi04/tech/full_papers/li_j/li_j.pdf) {#sundr}

**一句话**：在不可信存储上保证 fork consistency：客户端能检测服务器是否给了不同视图。

**阅读重点**：
- fork consistency 的定义。
- 签名链和版本向量。
- 为什么不能完全防恶意服务器。

**和 lab 的关系**：理解“服务器可能撒谎”时的正确性模型；和 agent 执行审计里的“可验证的执行记录”是同一类问题。

### [Bitcoin (2008)](https://bitcoin.org/bitcoin.pdf) {#bitcoin}

**一句话**：用 proof-of-work + 最长链实现去中心化共识，容忍节点作恶。

**阅读重点**：
- PoW 的概率性保证。
- 最长链规则和分叉。
- 双花攻击的边界。

**和 lab 的关系**：和 Raft 对比： crash fault tolerance vs Byzantine fault tolerance。

### [PBFT (1999)](https://static.usenix.org/events/osdi99/castro.html) {#pbft}

**一句话**：实用拜占庭容错，3f+1 个节点容忍 f 个恶意节点。

**阅读重点**：
- primary/backup、pre-prepare/prepare/commit 三阶段。
- 为什么需要 3f+1。
- 和 Raft（crash fault）的区别。

**和 lab 的关系**：如果你关心“节点可能作恶”，这是入口；课程的 Raft 只处理 crash。

### [6.033 Chapter 9（分布式事务）](https://ocw.mit.edu/courses/6-033-computer-system-engineering-spring-2018/) {#6033}

**一句话**：2PC、原子提交、分布式事务的基础章节。

**阅读重点**：
- 2PC 的 prepare/commit 阶段。
- 协调者崩溃怎么办。
- 和 Raft/Paxos 的关系。

**和 lab 的关系**：Lab 4/5 的配置变更、shard 迁移涉及原子提交。

## INFRA 02 · 云原生阅读

下面这些不是 6.5840 schedule 上的必读论文，是INFRA 02/03的补充阅读。不要一次读完；每篇写 5 句话：问题、假设、机制、代价、和课程的关系。

### [Borg (2015)](https://research.google/pubs/large-scale-cluster-management-at-google-with-borg/) {#borg}

**一句话**：Google 的集群管理器，Pod、优先级、配额、抢占这些概念的前身。

**阅读重点**：
- 为什么把多个容器放进同一个“alloc”（Borg 的调度单位）。
- 优先级、配额和抢占怎么一起工作。
- 大规模集群里，失败是常态而不是异常。

**和课程的关系**：INFRA 02的 Pod、requests/limits、QoS、eviction 都能在 Borg 里看到影子。

### [The Tail at Scale (2013)](https://research.google/pubs/the-tail-at-scale/) {#tail-at-scale}

**一句话**：为什么大规模系统的 p99 比平均值重要，以及怎么用 hedged request、微分区降低尾延迟。

**阅读重点**：
- 尾延迟的放大效应：一个请求要等很多后端。
- hedged request 的代价和触发条件。
- 为什么“平均 CPU 不高”不代表系统健康。

**和课程的关系**：INFRA 02 第 13 讲的可观测性与性能；INFRA 01 MapReduce 的 straggler 也是同一个问题。

### [Firecracker (2020)](https://www.usenix.org/system/files/nsdi20-paper-agache.pdf) {#firecracker}

**一句话**：AWS 为 serverless 设计的 microVM，启动快、内存开销小、支持快照恢复。

**阅读重点**：
- 为什么不用普通 VM，也不只用容器。
- microVM 的设备和内存模型。
- snapshot/restore 对冷启动的意义。

**和课程的关系**：INFRA 02 的 sandbox runtime；INFRA 03 的快照与恢复、强隔离任务进程。

### [The True Cost of Containing: A gVisor Case Study (2019)](https://www.usenix.org/system/files/hotcloud19-paper-young.pdf) {#gvisor}

**一句话**：gVisor 用用户态内核拦截 syscall，换来更强隔离，但系统调用、内存分配、文件打开都变慢。

**阅读重点**：
- gVisor 的 Sentry 和 Go netstack 怎么工作。
- 哪些 workload 适合 gVisor，哪些不适合。
- 隔离强度和性能的取舍。

**和课程的关系**：INFRA 02 第 10 讲的 sandbox runtime；INFRA 03 第 2 讲的“边界放在哪一层”。

## INFRA 03 · Agent OS 阅读

> Agent OS 是探索方向，这些论文和系统不代表主流共识。读的时候重点看它们各自解决了什么、没解决什么，不要把这些设计当成标准答案。

### [seL4 (2009)](https://www.sigops.org/s/conferences/sosp/2009/papers/klein-sosp09.pdf) {#sel4}

**一句话**：形式验证的微内核；capability 是原生的权限模型，不是后加的补丁。

**阅读重点**：
- capability 怎么表示、怎么派生、怎么撤销。
- 形式验证证明了什么，没证明什么。
- 微内核的 IPC 开销和设计取舍。

**和课程的关系**：INFRA 03的 capability 模型、微内核 vs 宏内核；你不一定要用 seL4，但要知道“能力原生”的设计长什么样。

### [The UNIX Time-Sharing System (1974)](https://people.eecs.berkeley.edu/~brewer/cs262/unix.pdf) {#unix}

**一句话**：Unix 的经典论文；文件、进程、shell、权限模型的原点。

**阅读重点**：
- 为什么“一切皆文件”是一个强大的抽象。
- fork/exec、fd、pipe 的设计。
- 当年的权限模型假设了什么，今天为什么不够。

**和课程的关系**：INFRA 03要从 Unix 的接口往前走一步；先理解它为什么成功，再讨论它为什么不适合 agent。

### [End-to-End Arguments in System Design (1984)](https://web.mit.edu/Saltzer/www/publications/endtoend/endtoend.pdf) {#e2e}

**一句话**：很多功能只有在端点实现才可靠；中间层可以优化，但不能替代端点的正确性。

**阅读重点**：
- 端到端论证的原始表述。
- 哪些功能适合放在网络中间，哪些必须放端点。
- 和“可靠消息”“ exactly-once”这些承诺的关系。

**和课程的关系**：INFRA 01的 RPC 语义、INFRA 02的 sidecar 重试、INFRA 03的审计，都要问“这个保证到底由谁负责”。

### [Sagas (1987)](https://www.cs.cornell.edu/andru/cs711/2002fa/reading/sagas.pdf) {#sagas}

**一句话**：长事务拆成一系列本地事务，每个配一个补偿操作；补偿不是回滚，可能失败。

**阅读重点**：
- saga 的两种恢复方式：向后补偿、向前重试。
- 补偿操作的语义和隔离性。
- 为什么 saga 不能提供 ACID。

**和课程的关系**：INFRA 03第 6 讲的事务与补偿；多容器/多 agent 的跨服务操作。

### [AIOS: LLM Agent Operating System (2024)](https://arxiv.org/abs/2403.16971) {#aios}

**一句话**：把 LLM 当 CPU、把 agent 当进程，在用户态实现调度、上下文管理、内存和工具调用。

**阅读重点**：
- 它的 syscall 表覆盖了什么，没覆盖什么。
- 它的“内核”是用户态库，还是内核边界。
- 它对权限、事务、审计的处理。

**和课程的关系**：INFRA 03 的对照阅读。AIOS 是“用户态 agent OS”的一种尝试；读完问自己：哪些操作必须放进内核，哪些可以留在 runtime。

## 规范

规范不是论文；不要从头读到尾，带着问题查章节。

| 文档 | 用途 | 课程 |
|---|---|---|
| [OCI Image Spec](https://github.com/opencontainers/image-spec) | 镜像层、配置、manifest | INFRA 02 |
| [OCI Runtime Spec](https://github.com/opencontainers/runtime-spec) | 容器进程、namespace、mount、cgroup | INFRA 02/03 |
| [CNI Spec](https://github.com/containernetworking/cni/blob/main/SPEC.md) | Pod 网络插件 | INFRA 02 |
| [CSI Spec](https://github.com/container-storage-interface/spec) | 存储插件、快照 | INFRA 02 |
| [Kubernetes Pod Lifecycle](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/) | init/sidecar/termination | INFRA 02 |
| [cgroup v2](https://docs.kernel.org/admin-guide/cgroup-v2.html) | CPU/内存/IO/PID 限制 | INFRA 02/03 |
| [seccomp](https://docs.kernel.org/userspace-api/seccomp_filter.html) | syscall 过滤 | INFRA 03 |
| [Landlock](https://docs.kernel.org/userspace-api/landlock.html) | 路径权限 | INFRA 03 |
| [overlayfs](https://docs.kernel.org/filesystems/overlayfs.html) | 联合文件系统、快照 | INFRA 02/03 |
| [pidfd](https://man7.org/linux/man-pages/man2/pidfd_open.2.html) | 无 race 的进程控制 | INFRA 03 |
| [SLSA](https://slsa.dev/spec/v1.0/) | 构建供应链的完整性等级 | INFRA 02 |
| [in-toto](https://in-toto.io/) | 供应链各步骤的签名与验证 | INFRA 02 |
| [SPDX](https://spdx.dev/) | SBOM（软件物料清单）格式 | INFRA 02 |

## 阅读顺序

1. **[MapReduce](#mapreduce)** → 做 Lab 1。
2. **[Time, Clocks, and the Ordering of Events](#time-clocks)** → 理解逻辑顺序，再进入 Raft。
3. **[Raft](#raft)** → 做 Lab 3；中间穿插 **[Linearizability](#linearizability)**。
4. [GFS](#gfs) / [Paxos](#paxos) / [ZooKeeper](#zookeeper) → 理解复制和协调的多样性。
5. [Spanner](#spanner) / [Chain Replication](#chain-replication) / [FaRM](#farm) → 看工业界怎么组合这些原语。
6. [AWS Lambda](#lambda) / [Ray](#ray) → 看分布式系统在 serverless / ML 场景的形态。

不要为了“读完”而读；每篇读完写 5 句话，比读十篇更有用。
