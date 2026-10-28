# INFRA 01 · 分布式系统

> 21 lectures · 5 labs · Go
>
> 参考 MIT 6.5840 Spring 2026 的日程；本站是原创中文课程，不复制讲义原文，也不包含 lab 代码或答案。

## 课程说明

这门课讨论一个问题：**多个副本如何在对方面前表现得像一台机器？**

课程从 MapReduce 开始，经过 RPC、GFS、Paxos、Raft、线性一致、ZooKeeper、2PC、Spanner、Chain Replication、FaRM、IronFleet、Memcached、Lambda、Ray、SUNDR、Bitcoin，最后到 PBFT。主线不是把论文串起来，而是同一组约束的递进：副本放在哪、谁来写、什么时候算提交、失败后怎么恢复、客户端能看到什么顺序。

五个 Go lab 把这些约束写成代码：MapReduce、单机 KV、Raft、基于 Raft 的 replicated state machine、分片 KV。Lab 3 是核心，通常需要 2–3 周；Lab 4/5 会复用它。

## 怎么开始

1. 读 [第 1 讲 MapReduce](lectures.html#lec1)。
2. 打开 [Lab 1 任务书](lab1.html)，按“任务”和“硬性约束”实现。
3. 跑 `LAB_ROOT=~/labs/6.5840 ./judge/run.sh infra01 lab1`。
4. 参考：[MapReduce 论文](papers.html) 和 [官方 lab 页](https://pdos.csail.mit.edu/6.5840/labs/lab-mr.html)。

作业总览在 [作业与实验](labs.html)；评分标准在 [评分标准](grading.html)。

## 先修要求

- 会 Go，或愿意在两周内补到能写并发程序。
- 知道进程、线程、锁、文件系统、socket。
- 不怕调试并发程序；愿意反复跑 `-race` 和 `-count=100`。

## 课程安排

| # | 主题 | 阅读 | 讲义 |
|---|---|---|---|
| 1 | Introduction — MapReduce, coordinator/worker | [MapReduce](papers.html#mapreduce) | [Notes](lectures.html#lec1) |
| 2 | RPC and Threads — at-most-once, retries, Go concurrency | [Go concurrency](https://go.dev/doc/effective_go#concurrency) | [Notes](lectures.html#lec2) |
| 3 | GFS — master, chunkserver, lease, atomic append | [GFS](papers.html#gfs) | [Notes](lectures.html#lec3) |
| 4 | Paxos — proposer/acceptor/learner, quorum | [Paxos](papers.html#paxos) | [Notes](lectures.html#lec4) |
| 5 | Go Patterns — context, pipeline, cancellation | [Go docs](https://go.dev/doc/) | [Notes](lectures.html#lec5) |
| 6 | Raft (1) — election, term, AppendEntries | [Raft](papers.html#raft) | [Notes](lectures.html#lec6) |
| 7 | Raft (2) — commit, persistence, snapshot, linearizability | [Raft](papers.html#raft) | [Notes](lectures.html#lec7) |
| 8 | Linearizability — histories, real-time order, composition | [Linearizability](papers.html#linearizability) | [Notes](lectures.html#lec8) |
| 9 | ZooKeeper — znode, watch, ZAB, sessions | [ZooKeeper](papers.html#zookeeper) | [Notes](lectures.html#lec9) |
| 10 | Lab 3 Q&A — Figure 2, races, deadlocks | [Raft](papers.html#raft) | [Notes](lectures.html#lec10) |
| 11 | Distributed Transactions — 2PC, atomic commit, serializability | [6.033 ch. 9](papers.html#6033) | [Notes](lectures.html#lec11) |
| 12 | Spanner — TrueTime, Paxos groups, external consistency | [Spanner](papers.html#spanner) | [Notes](lectures.html#lec12) |
| 13 | Chain Replication — strong consistency, read at tail | [Chain Replication](papers.html#chain-replication) | [Notes](lectures.html#lec13) |
| 14 | OCC / FaRM — optimistic concurrency, RDMA, transactions | [FaRM](papers.html#farm) | [Notes](lectures.html#lec14) |
| 15 | Verification — IronFleet, TLA+, refinement | [IronFleet](papers.html#ironfleet) | [Notes](lectures.html#lec15) |
| 16 | Memcached at Facebook — leases, tail latency | [Memcached](papers.html#memcached) | [Notes](lectures.html#lec16) |
| 17 | AWS Lambda — isolation, cold start, snapshots, Firecracker | [Lambda](papers.html#lambda) / [Firecracker](papers.html#firecracker) | [Notes](lectures.html#lec17) |
| 18 | Ray — task/actor, scheduling, lineage | [Ray](papers.html#ray) | [Notes](lectures.html#lec18) |
| 19 | SUNDR — fork consistency on untrusted storage | [SUNDR](papers.html#sundr) | [Notes](lectures.html#lec19) |
| 20 | Bitcoin — proof-of-work, longest chain, double spend | [Bitcoin](papers.html#bitcoin) | [Notes](lectures.html#lec20) |
| 21 | Byzantine Fault Tolerance — PBFT, 3f+1 | [PBFT](papers.html#pbft) | [Notes](lectures.html#lec21) |
| 22 | Project demos | — | [Notes](lectures.html#lec22) |

> 第 10 讲是 Lab 3 的 Q&A，不是新论文；第 22 讲是项目展示。

## 实验

| # | 实验 | 内容 | 说明 |
|---|---|---|---|
| 1 | MapReduce | coordinator/worker, RPC, timeout/retry, atomic rename | [Lab 1](lab1.html) |
| 2 | KV Server | linearizable Put/Get, version, at-most-once, lock | [Lab 2](lab2.html) |
| 3 | Raft | election, log replication, persistence, snapshot (3A–3D) | [Lab 3](lab3.html) |
| 4 | Fault-tolerant KV | replicated state machine on Raft, snapshots | [Lab 4](lab4.html) |
| 5 | Sharded KV | shards, config changes, fault-tolerant controller | [Lab 5](lab5.html) |

Lab 3 是核心；Lab 4/5 复用 Lab 2/3 的代码。时间有限时可以做到 Lab 3，但不要跳过 Raft 的边界测试。

## 设计问题

这些问题没有标准答案；每学完一组课，选一个写 500 字。

1. Raft 的 commit 规则能否简化？如果允许 leader 直接提交旧 term 的 entry，会破坏哪个性质？构造一个反例。
2. 线性一致和可串行化分别约束什么？给一个满足可串行化但不满足线性一致的历史。
3. 2PC 在协调者崩溃后为什么可能阻塞？在什么假设下可以用 3PC、Paxos 或补偿替代？
4. 如果进程可以任意暂停（GC、VM migration、人工审批），Raft 的 liveness 还成立吗？你会怎么改？
5. 设计一个支持“长事务 + 外部副作用”的共识协议；哪些步骤必须由应用补偿，为什么？
6. 如果机器的时钟会漂移，lease、TrueTime 和线性一致分别受什么影响？设计一个不依赖物理时钟的 fencing 方案。

## 考核

- 本地 judge 通过：`LAB_ROOT=~/labs/6.5840 ./judge/run.sh infra01 labN`。
- `make ...` 全绿，`-race` 也过。
- 能不看代码讲清楚协议、失败模式、每个测试在测什么。
- 每个 lab 写 300 字：问题、设计、失败模式、如果放进多容器平台或 agent runtime 会怎样。
- 代码私有；不公开可直接复制的答案。

## 阅读

[阅读](papers.html) 有每篇论文的一句话定位和阅读重点。课程页与 lab 原文在 [MIT 6.5840](https://pdos.csail.mit.edu/6.5840/)；本站的 [讲义](lectures.html) 是原创中文导读。另加一篇 *Time, Clocks, and the Ordering of Events*（1978）作为顺序问题的补充。
