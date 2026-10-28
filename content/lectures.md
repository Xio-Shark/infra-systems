# INFRA 01 · Lecture Notes

> 21 讲导读，按 MIT 6.5840 Spring 2026 的日程整理。每一讲给出一句话定位、核心内容、阅读材料、和 lab 的关系、自测问题。
> 这不是讲义原文的翻译，而是原创中文导读；论文和讲义请读官方链接：
> https://pdos.csail.mit.edu/6.5840/schedule.html
>
> 课程页、labs 和 design questions 在 [INFRA 01](course-map.html)。

## 第 1 讲：Introduction {#lec1}

**一句话**：用 MapReduce 说明为什么需要分布式系统，以及怎么用“复制 + 重试”处理失败。

**核心内容**

- 分布式系统的动机：性能、容错、地理分布。
- MapReduce 模型：`map(k, v) -> list(k2, v2)`，`reduce(k2, list(v2)) -> list(v2)`。
- coordinator 分任务，worker 执行；失败/慢节点用超时重发。
- 输出用临时文件 + 原子 rename，避免留下写了一半的文件。

**阅读**：MapReduce (2004)。

**和 lab 的关系**：Lab 1 就是简化版 MapReduce。

**自测**

- 为什么 map 输出要按 key 分成 `nReduce` 个桶？
- worker 写完输出但没来得及报告就崩溃，会发生什么？

## 第 2 讲：RPC and Threads {#lec2}

**一句话**：分布式系统的编程基础：RPC 的语义、重试、去重，以及用线程/goroutine 处理并发。

**核心内容**

- RPC 语义：at-least-once、at-most-once、exactly-once。
- 丢包/丢回复时，客户端只能重试；服务端要能识别重复请求。
- Go 的 goroutine、channel、mutex；什么时候用锁，什么时候用 channel。
- 例子：crawler、KV、vote。

**阅读**：Go 并发章节；课程给的 crawler/kv/vote 代码。

**和 lab 的关系**：Lab 1/2 的 RPC 和重试；Lab 3 的 RPC handler 并发。

**自测**

- 为什么 exactly-once 难？`ErrMaybe` 表示什么？
- 持锁时发 RPC 会有什么问题？

## 第 3 讲：GFS {#lec3}

**一句话**：Google 的大文件系统：单 master + 多 chunkserver + lease + 原子追加。

**核心内容**

- 文件切成 64MB chunk，每个 chunk 复制 3 份。
- master 存元数据；chunkserver 存数据。
- lease 保证同一时刻只有一个 chunkserver 能写某个 chunk。
- 原子追加（atomic append）的语义；snapshot 用 copy-on-write。
- 失败恢复：master 崩溃、chunkserver 崩溃、网络分区。

**阅读**：GFS (2003)。

**和 lab 的关系**：理解“复制 + 租约 + 失败恢复”的工程取舍；Lab 3 的 Raft 是另一条路线。

**自测**

- 为什么需要 lease？没有 lease 会怎样？
- GFS 的一致性模型是什么？它保证什么、不保证什么？

## 第 4 讲：Paxos {#lec4}

**一句话**：最经典的共识算法：proposer 提议、acceptor 投票、learner 学习；多数派保证安全。

**核心内容**

- prepare/accept 两阶段；ballot number。
- 多数派交集保证“不会选出两个不同的值”。
- safety 和 liveness 的区别；活锁和随机退避。
- multi-Paxos：把共识用到日志上。

**阅读**：Paxos Made Simple；Paxos (2001)。

**和 lab 的关系**：Raft 是更易理解的 Paxos 变体；对照读更容易懂 Raft。

**自测**

- 为什么需要多数派？
- Paxos 能保证 liveness 吗？为什么？

## 第 5 讲：Go Patterns {#lec5}

**一句话**：Russ Cox 讲 Go 并发服务器的常见写法：pipeline、cancellation、worker pool、避免 goroutine 泄漏。

**核心内容**

- 用 `context` 取消一组 goroutine。
- pipeline：每个 stage 一个 goroutine，channel 连接。
- 关闭 channel 的规则；谁生产谁关闭。
- 避免在循环里泄漏 goroutine；用 `select` 处理取消。

**阅读**：Go 官方博客的 concurrency patterns；Russ Cox 的演讲。

**和 lab 的关系**：Lab 1/3 的并发结构；Lab 3 的 ticker/apply goroutine。

**自测**

- 怎么取消一个 pipeline？
- 为什么不应该在多个 goroutine 里读同一个 `applyCh`？

## 第 6 讲：Raft (1) {#lec6}

**一句话**：Raft 的选举和日志复制基础：term、RequestVote、心跳、AppendEntries。

**核心内容**

- 三种状态：Follower / Candidate / Leader。
- term 单调递增；每个 term 最多一票。
- 随机 election timeout；heartbeat。
- 日志匹配：`PrevLogIndex` / `PrevLogTerm`。
- 选举限制：候选人日志必须至少和 voter 一样新。

**阅读**：Raft 论文第 5.1–5.3 节；Figure 2。

**和 lab 的关系**：Lab 3A/3B。

**自测**

- 为什么候选人日志短了不能当选？
- split vote 怎么解决？

## 第 7 讲：Raft (2) {#lec7}

**一句话**：Raft 的提交规则、持久化、快照，以及怎么用它做线性一致的 KV。

**核心内容**

- commit 规则：多数派复制 + 当前 term（Figure 8）。
- 持久化 `currentTerm`、`votedFor`、`log`。
- snapshot / log compaction；`InstallSnapshot`。
- 客户端交互：去重、线性一致读。

**阅读**：Raft 论文第 5.4、7、8 节。

**和 lab 的关系**：Lab 3B–3D；Lab 4。

**自测**

- 为什么不能直接提交旧 term 的 entry？
- snapshot 的 index 和 `commitIndex` 有什么区别？

## 第 8 讲：Linearizability {#lec8}

**一句话**：线性一致的定义：每个操作看起来在某个瞬间原子生效，并尊重实时顺序。

**核心内容**

- history：调用/返回事件。
- real-time order：一个操作在另一个开始前完成。
- legal sequential history：存在一个顺序，满足实时序和每个操作的语义。
- 线性化点；可组合性。
- 和 serializability 的区别。

**阅读**：Linearizability (1990)。

**和 lab 的关系**：Lab 2/4 的 KV 要求线性一致；测试用 porcupine 检查。

**自测**

- 一个 stale read 是线性一致的吗？
- 两个并发 Put，怎么判断哪个先生效？

## 第 9 讲：ZooKeeper {#lec9}

**一句话**：一个协调服务：znode、watch、session；用 ZAB 做复制，提供顺序一致性 + 客户端 FIFO。

**核心内容**

- znode 树；临时节点；watch 一次性触发。
- 顺序一致性 + 客户端 FIFO，而不是线性一致。
- leader election、分布式锁、配置管理。
- session 和 ephemeral node。

**阅读**：ZooKeeper (2010)。

**和 lab 的关系**：Lab 2 的锁；Lab 5 的 controller/配置服务。

**自测**

- ZooKeeper 为什么不提供线性一致？
- watch 保证什么、不保证什么？

## 第 10 讲：Lab 3 Q&A {#lec10}

**一句话**：Raft lab 的常见 bug、测试和调试方法。

**核心内容**

- Figure 2 漏条件：term 检查、投票规则、commit 规则。
- 锁：持锁发 RPC、持锁 sleep、持锁 send applyCh。
- 持久化：term/votedFor/log 的变化点。
- 测试：3A → 3B → 3C → 3D；`-race`；可视化 timeline。

**阅读**：Raft structure / locking advice。

**和 lab 的关系**：Lab 3。

**自测**

- 你的 Raft 在什么情况下会提交旧 term 的 entry？
- 你怎么证明 `applyCh` 是顺序的？

## 第 11 讲：Distributed Transactions {#lec11}

**一句话**：跨多个分片的原子提交：2PC、锁、可串行化。

**核心内容**

- 2PC：coordinator 问 prepare，所有 participant 同意后 commit。
- coordinator 崩溃 → participant 阻塞；需要恢复/日志。
- 锁和死锁；可串行化。
- 和 Paxos/Raft 的关系：复制 + 原子提交。

**阅读**：6.033 Chapter 9；2PC 材料。

**和 lab 的关系**：Lab 4/5 的配置变更、shard 迁移。

**自测**

- 2PC 为什么可能阻塞？
- 怎么从 coordinator 崩溃中恢复？

## 第 12 讲：Spanner {#lec12}

**一句话**：全球分布式 SQL：TrueTime + Paxos group + 2PC，提供外部一致性。

**核心内容**

- TrueTime：带误差区间的全局时间。
- Paxos group 复制每个 shard；跨 group 用 2PC。
- 外部一致性：全局实时序。
- 只读事务、snapshot read。

**阅读**：Spanner (2012)。

**和 lab 的关系**：Lab 5 的分片 + 配置变更。

**自测**

- TrueTime 的误差区间怎么用？
- 外部一致性和线性一致的关系？

## 第 13 讲：Chain Replication {#lec13}

**一句话**：主备链：写从 head 到 tail，读从 tail，强一致。

**核心内容**

- 链式复制；head 接收写，tail 服务读。
- 失败恢复：head/tail 挂了怎么换。
- 吞吐和可用性的取舍。
- 和 Raft 的对比。

**阅读**：Chain Replication (2004)。

**和 lab 的关系**：Lab 3 的对照；理解复制协议的多样性。

**自测**

- 为什么读 tail 能保证强一致？
- head 挂了怎么办？

## 第 14 讲：OCC / FaRM {#lec14}

**一句话**：乐观并发控制 + RDMA + 复制，做低延迟内存事务。

**核心内容**

- OCC：读/写集；提交时验证；冲突则 abort。
- FaRM：RDMA one-sided operations；primary/backup 复制。
- 事务的原子性和隔离性。
- 延迟优化。

**阅读**：FaRM (2015)。

**和 lab 的关系**：Lab 4 的 KV/事务；性能极限的另一端。

**自测**

- OCC 什么时候 abort？
- RDMA 为什么能降低延迟？

## 第 15 讲：Verification {#lec15}

**一句话**：用 IronFleet/TLA+ 证明分布式系统的正确性；测试只是抽样。

**核心内容**

- 规格（spec）和实现（implementation）。
- refinement proof；invariant。
- model checking vs. machine-checked proof。
- 验证的代价和边界。

**阅读**：IronFleet (2015)。

**和 lab 的关系**：Lab 3 的 Raft 安全性；提醒你测试通过 ≠ 正确。

**自测**

- 测试能发现哪些 bug，发现不了哪些？
- refinement 证明在证什么？

## 第 16 讲：Memcached at Facebook {#lec16}

**一句话**：大规模缓存：lease、一致性、尾延迟、多区域。

**核心内容**

- cache lease 防止 stale read。
- thundering herd；tail latency。
- 多区域部署和一致性取舍。
- 缓存和数据库的交互。

**阅读**：Memcached at Facebook (2013)。

**和 lab 的关系**：Lab 2 的 lease/版本号思路。

**自测**

- 怎么避免缓存返回旧值？
- 为什么尾延迟比平均延迟重要？

## 第 17 讲：AWS Lambda {#lec17}

**一句话**：Serverless 平台内部：隔离、冷启动、快照恢复、Firecracker。

**核心内容**

- microVM 隔离；多租户安全。
- 冷启动；snapshot/restore。
- 调度和弹性。
- 和容器/进程隔离的对比。

**阅读**：AWS Lambda (2023)。

**和 lab 的关系**：和 agent runtime / 进程内核的隔离、恢复问题接近。

**自测**

- 为什么用 microVM 而不是容器？
- 怎么降低冷启动？

## 第 18 讲：Ray {#lec18}

**一句话**：分布式 Python：task/actor、object store、lineage、调度。

**核心内容**

- task vs. actor。
- lineage-based recovery。
- 调度器；数据本地性。
- ML workload 的特点。

**阅读**：Ray (2021)。

**和 lab 的关系**：AgentRuntime 的任务调度、DAG 执行。

**自测**

- lineage 怎么恢复失败的任务？
- task 和 actor 的区别？

## 第 19 讲：SUNDR {#lec19}

**一句话**：不可信存储上的 fork consistency：客户端能检测服务器是否给了不同视图。

**核心内容**

- 不可信服务器；签名链；版本向量。
- fork consistency：客户端能发现分叉。
- 不能防什么：回滚、删除。
- 和“可验证执行事实”的关系。

**阅读**：SUNDR (2004)。

**和 lab 的关系**：如果你做 agent runtime 或可验证执行，“可验证的执行记录”是同一类问题。

**自测**

- fork consistency 的定义？
- 为什么不能完全防恶意服务器？

## 第 20 讲：Bitcoin {#lec20}

**一句话**：PoW + 最长链的 Nakamoto 共识；概率最终性。

**核心内容**

- proof-of-work；难度调整。
- 最长链；分叉；双花。
- 51% 攻击；概率最终性。
- 和 Raft/PBFT 的对比。

**阅读**：Bitcoin (2008)。

**和 lab 的关系**：crash fault vs. Byzantine fault。

**自测**

- 为什么 51% 是关键阈值？
- 什么是概率最终性？

## 第 21 讲：Byzantine Fault Tolerance {#lec21}

**一句话**：PBFT：3f+1 个节点容忍 f 个拜占庭节点。

**核心内容**

- primary/backup；pre-prepare/prepare/commit。
- 3f+1 的原因。
- view change。
- 和 Raft（crash fault）的对比。

**阅读**：PBFT (1999)。

**和 lab 的关系**：Lab 3 的 Raft 只处理 crash fault。

**自测**

- 为什么需要 3f+1？
- primary 作恶怎么办？

## 第 22 讲：Project demos {#lec22}

期末项目展示。自学可以跳过；如果你想做项目，选一个和 lab 相关的小系统，写清楚问题、设计、测试和限制。
