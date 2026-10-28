# INFRA 01 · 讲义

> 21 讲讲义 + 项目展示，按 MIT 6.5840 Spring 2026 的日程整理。每一讲给出问题、机制、失败模式、和 lab 的关系。读完一讲和对应的 lab 任务书，就可以开始实验。
> 这是原创中文导读，不是原文翻译。讲义给出问题、机制、失败模式和 lab 的接口；它不替代论文的完整论证。做 lab 时以讲义、`src/` 骨架和官方 lab 页为准；想真正理解协议，做完 lab 后至少读对应论文章节。
>
> 课程页、labs 和 design questions 在 [INFRA 01](course-map.html)。

## 第 1 讲：Introduction {#lec1}

**一句话**：用 MapReduce 说明为什么需要分布式系统，以及怎么用“复制 + 重试”处理失败。

**核心内容**

- 分布式系统的动机：性能、容错、地理分布。
- MapReduce 模型：`map(k, v) -> list(k2, v2)`，`reduce(k2, list(v2)) -> list(v2)`。
- coordinator 分任务，worker 执行；失败/慢节点用超时重发。
- 输出用临时文件 + 原子 rename，避免留下写了一半的文件。

**机制**

MapReduce 把一次大规模计算拆成两个纯函数：`map` 把一条输入变成若干 key/value，`reduce` 把同一个 key 的所有 value 合并。框架负责切分输入、把 map 输出按 key 分区、把同一分区的数据送到同一个 reduce、在任务失败时重跑。用户不写调度、不写网络、不写重试，所以框架可以用“重跑”代替精细的恢复。

一次作业的顺序是：coordinator 先发 M 个 map 任务；每个 map 读一个 split，把输出写成 R 个本地文件 `mr-X-Y`；所有 map 完成后，coordinator 再发 R 个 reduce 任务；第 Y 个 reduce 读取所有 map 的第 Y 个文件，按 key 排序后调用 reduce，写 `mr-out-Y`。map 输出留在 worker 本地磁盘，reduce 阶段才跨机器拉取，网络流量只发生一次；代价是 map 输出要保留到 reduce 读完。

失败处理只有一条原则：任务在期限内没有完成，就当成没做，重新分配给另一个 worker。重复执行是允许的，因为 map/reduce 是确定性的，输出用临时文件 + `rename` 原子发布；晚到的旧 worker 报告直接忽略。coordinator 自己崩溃不在这个 lab 的范围内；真实系统会把 coordinator 状态也持久化。

**失败模式**

- map 输出写了一半、worker 就崩溃：reduce 不能读到半个文件；临时文件 + `rename` 是硬要求。
- 旧 worker 在任务重发后才完成：重复报告不能让任务被算两次，也不能覆盖新结果。
- reduce 在 map 全部完成前启动：会漏掉还没写完的分区。
- 一个慢 worker 拖住整个作业：超时重发，或像论文那样跑备份任务。
- map 输出所在的 worker 退出太早：reduce 拉不到文件；worker 要活到 `Done()`。

**延伸阅读（可选）**：[MapReduce (2004)](papers.html#mapreduce)。

**和 lab 的关系**：Lab 1 就是简化版 MapReduce。

**自测**

- 为什么 map 输出要按 key 分成 `nReduce` 个桶？
- worker 写完输出但没来得及报告就崩溃，会发生什么？

**作业**：[Lab 1](lab1.html) · [作业总览](labs.html)

## 第 2 讲：RPC and Threads {#lec2}

**一句话**：分布式系统的编程基础：RPC 的语义、重试、去重，以及用线程/goroutine 处理并发。

**核心内容**

- RPC 语义：at-least-once、at-most-once、exactly-once。
- 丢包/丢回复时，客户端只能重试；服务端要能识别重复请求。
- Go 的 goroutine、channel、mutex；什么时候用锁，什么时候用 channel。
- 例子：crawler、KV、vote。

**机制**

RPC 把函数调用变成请求和回复。网络会丢请求、丢回复、重复、延迟；客户端能做的只有重试。服务端于是要回答：同一个请求到达两次，执行一次还是两次？at-least-once 实现简单，但会重复副作用；at-most-once 需要服务端记住执行过的请求，或让客户端带版本号；exactly-once 在崩溃恢复下还要把去重状态持久化，不是免费的。

Lab 2 用版本号实现 at-most-once：`Put` 带 expected version，服务端只在版本匹配时更新并把版本加一；客户端超时后用同一个 version 重发，服务端不会执行第二次。关键是客户端**不能**从重发后的 `ErrVersion` 推断“已经生效”：第一次 RPC 可能执行了但回复丢了，也可能被别的客户端抢先改了 version，两次都没执行。官方 6.5840 的规则是：首次（未重发）收到 `ErrVersion` 返回 `ErrVersion`（确定没执行）；重发后收到 `ErrVersion` 必须返回 `ErrMaybe`（可能执行了）。`ErrMaybe` 表示结果不确定，调用者要用 `Get` 或其他方式确认，不能盲目重试。

并发方面，goroutine 很便宜，但共享状态需要明确的锁。一个实用规则：锁保护数据，不保护 I/O；持锁时不要发 RPC、读文件、`time.Sleep`、往 channel 发送。channel 适合传递所有权和取消信号，不适合保护一个大 map。

**失败模式**

- 丢回复后重试，服务端执行两次 `Put`。
- 持锁发 RPC，网络慢导致整个服务卡住。
- goroutine 泄漏：请求取消后后台协程还在等 channel。
- 多个 goroutine 同时读写 map；用 `-race` 自测。
- 关闭 channel 的责任不清；向已关闭的 channel 发送会 panic。

**延伸阅读（可选）**：[Go 并发](https://go.dev/doc/effective_go#concurrency)；课程给的 crawler/kv/vote 代码。

**和 lab 的关系**：Lab 1/2 的 RPC 和重试；Lab 3 的 RPC handler 并发。

**自测**

- 为什么 exactly-once 难？`ErrMaybe` 表示什么？
- 持锁时发 RPC 会有什么问题？

**作业**：[Lab 1](lab1.html) · [Lab 2](lab2.html) · [作业总览](labs.html)

## 第 3 讲：GFS {#lec3}

**一句话**：Google 的大文件系统：单 master + 多 chunkserver + lease + 原子追加。

**核心内容**

- 文件切成 64MB chunk，每个 chunk 复制 3 份。
- master 存元数据；chunkserver 存数据。
- lease 保证同一时刻只有一个 chunkserver 能写某个 chunk。
- 原子追加（atomic append）的语义；snapshot 用 copy-on-write。
- 失败恢复：master 崩溃、chunkserver 崩溃、网络分区。

**机制**

GFS 把文件切成固定大小的 chunk，每个 chunk 存三个副本。master 只保存文件名、chunk 位置、lease 等元数据，客户端的数据读写不经过 master。写的时候，客户端先问 master 哪个 chunkserver 持有 lease；master 选一个 primary，返回副本列表；客户端把数据推到所有副本的缓存，再请 primary 分配序号并转发写；primary 决定顺序，所有副本按同一顺序应用。

lease 解决“谁是 primary”。没有 lease，两个客户端可能同时认为自己是写者，副本就会写出不同顺序。lease 有有效期，primary 可以续租；master 在旧 lease 过期前不会发新的。GFS 的一致性模型不是线性一致，也不是简单的“所有客户端看到相同顺序”：串行成功的写是 defined；并发成功的写是 consistent but undefined（所有客户端看到相同字节，但可能不对应任何一次写）；失败的写会让区域 inconsistent（不同客户端可能看到不同数据）。record append 只保证 at-least-once，可能重复并插入 padding。理解这张状态表，比记住“GFS 是强一致”更重要。

**失败模式**

- primary 崩溃或分区，lease 还没过期：写暂时不可用。
- 副本落后：读可能看到旧数据；GFS 用版本号检测 stale replica。
- master 崩溃：元数据要写操作日志并回放。
- 客户端重试 append：可能重复追加。
- chunk 过大：热点和恢复都会变慢。

**延伸阅读（可选）**：[GFS (2003)](papers.html#gfs)。

**和 lab 的关系**：理解“复制 + 租约 + 失败恢复”的工程取舍；Lab 3 的 Raft 是另一条路线。

**自测**

- 为什么需要 lease？没有 lease 会怎样？
- GFS 的一致性模型是什么？它保证什么、不保证什么？

**作业**：[Lab 1](lab1.html) · [作业总览](labs.html)

## 第 4 讲：Paxos {#lec4}

**一句话**：最经典的共识算法：proposer 提议、acceptor 投票、learner 学习；多数派保证安全。

**核心内容**

- prepare/accept 两阶段；ballot number。
- 多数派交集保证“不会选出两个不同的值”。
- safety 和 liveness 的区别；活锁和随机退避。
- multi-Paxos：把共识用到日志上。

**机制**

Paxos 把“选一个值”拆成两阶段。proposer 选一个比见过的都大的 ballot，发 prepare；acceptor 如果没承诺过更大的 ballot，就承诺不再接受更小的 ballot，并返回自己已经接受过的最大 ballot 的值；proposer 拿到多数派的 promise 后，发 accept(ballot, value)；acceptor 接受；多数派接受后，值被选中。任意两个多数派一定相交，所以不会选出两个不同的值。

安全不等于能结束。两个 proposer 可以互相抬高 ballot，谁也无法拿到多数派；随机退避或选一个稳定的 leader（multi-Paxos）让系统在实际中推进。Paxos 的 liveness 依赖“最终有一个 proposer 能拿到多数派”，不是纯安全性质。multi-Paxos 把每一轮的值当成日志的一个位置，leader 一次 prepare 后连续 accept，减少往返。

**失败模式**

- acceptor 忘记 promise 或已接受的值（没持久化），会破坏安全。
- proposer 在 accept 后崩溃，learner 不知道值已选中。
- 两个 proposer 活锁：一直抬高 ballot。
- 把“多数派接受”误认为“客户端已经知道”；客户端还要等 learner 或 leader 确认。
- ballot 不单调，或不同 proposer 用了重复的编号。

**延伸阅读（可选）**：[Paxos Made Simple](papers.html#paxos)；[Paxos (2001)](papers.html#paxos)。

**和 lab 的关系**：Raft 是更易理解的 Paxos 变体；对照读更容易懂 Raft。

**自测**

- 为什么需要多数派？
- Paxos 能保证 liveness 吗？为什么？

**作业**：[Lab 3](lab3.html) · [作业总览](labs.html)

## 第 5 讲：Go Patterns {#lec5}

**一句话**：Russ Cox 讲 Go 并发服务器的常见写法：pipeline、cancellation、worker pool、避免 goroutine 泄漏。

**核心内容**

- 用 `context` 取消一组 goroutine。
- pipeline：每个 stage 一个 goroutine，channel 连接。
- 关闭 channel 的规则；谁生产谁关闭。
- 避免在循环里泄漏 goroutine；用 `select` 处理取消。

**机制**

并发服务器的难点不是“开 goroutine”，而是“什么时候结束、谁来收尾”。`context` 传递取消和截止时间；pipeline 的每个 stage 只从上游读、向下游写，上游关闭后下游退出；worker pool 用固定数量的 goroutine 消费任务队列，避免无限创建。关闭 channel 的责任应该由发送方承担，接收方不要关闭。

调试并发程序先跑 `go test -race`，再看 goroutine dump（`SIGQUIT` 或 `pprof`）。如果程序卡住，先找谁在等锁、谁在等 channel、谁在等 RPC；大多数死锁不是“锁不够”，而是锁的顺序不一致，或持锁做了阻塞操作。

**失败模式**

- goroutine 泄漏：请求结束但后台 goroutine 还在等 channel。
- 死锁：两个锁顺序相反，或持锁发 RPC。
- data race：共享 map 没锁；`-race` 能抓到。
- 向已关闭 channel 发送，或重复关闭。
- `context` 取消了，但下游 goroutine 不检查。

**延伸阅读（可选）**：[Go concurrency patterns](https://go.dev/talks/2012/concurrency.slide)；[Russ Cox 的演讲](https://go.dev/talks/)。

**和 lab 的关系**：Lab 1/3 的并发结构；Lab 3 的 ticker/apply goroutine。

**自测**

- 怎么取消一个 pipeline？
- 为什么不应该在多个 goroutine 里读同一个 `applyCh`？

**作业**：[Lab 1](lab1.html) · [Lab 2](lab2.html) · [作业总览](labs.html)

## 第 6 讲：Raft (1) {#lec6}

**一句话**：Raft 的选举和日志复制基础：term、RequestVote、心跳、AppendEntries。

**核心内容**

- 三种状态：Follower / Candidate / Leader。
- term 单调递增；每个 term 最多一票。
- 随机 election timeout；heartbeat。
- 日志匹配：`PrevLogIndex` / `PrevLogTerm`。
- 选举限制：候选人日志必须至少和 voter 一样新。

**机制**

Raft 把每个 server 的状态压缩成几个变量：`currentTerm`、`votedFor`、`log[]`、`commitIndex`、`lastApplied`，以及 leader 才有的 `nextIndex[]`、`matchIndex[]`。日志下标从 1 开始，`log[0]` 是哨兵。term 是单调递增的“任期编号”，一次选举对应一个 term；每个 server 在一个 term 里最多投一票。

选举：follower 在随机 election timeout 内没收到心跳，就变成 candidate，term 加一，投自己，向所有 peer 发 `RequestVote(term, candidateId, lastLogIndex, lastLogTerm)`。对方只有在 term 不小于自己、这个 term 没投过别人、并且候选人日志“至少一样新”时才投票。拿到多数票的 candidate 变成 leader，立刻发心跳。随机 timeout 是为了让 split vote 在下一次很快解开。

日志复制：leader 收到客户端命令，追加到本地日志，然后并行发 `AppendEntries(term, leaderId, prevLogIndex, prevLogTerm, entries, leaderCommit)`。follower 先检查自己是否有 `prevLogIndex` 且 term 匹配；不匹配就拒绝，leader 回退 `nextIndex` 再试；匹配就截断冲突的后缀、追加新条目。`AppendEntries` 同时承担心跳和复制。日志匹配性质保证：如果两个日志在某个 index/term 相同，那么它们之前的所有条目都相同。

提交：leader 在多数派的 `matchIndex` 覆盖到 N，且 `log[N].term == currentTerm` 时，才能把 `commitIndex` 推进到 N。这个“当前 term”条件是 Raft 最容易被写错的地方，第 7 讲会用反例解释。已提交的条目按 index 顺序送进 `applyCh`，不能跳过、不能重复。

**失败模式**

- 收到更高 term 的 RPC 没转 follower、没更新 term。
- 旧 term 的 RPC 没拒绝。
- 投票没检查日志新旧，导致已提交条目丢失。
- 一个 term 投两票；`votedFor` 没持久化。
- `AppendEntries` 不检查 `prevLogTerm`，错误覆盖日志。
- leader 提交旧 term 的条目。
- 持锁发 RPC 或等 `applyCh`。
- `nextIndex` 回退逻辑错误，死循环。
- `applyCh` 乱序或重复 apply。

**延伸阅读（可选）**：[Raft 论文第 5.1–5.3 节](https://raft.github.io/raft.pdf)；Figure 2。

**和 lab 的关系**：Lab 3A/3B。

**自测**

- 为什么候选人日志短了不能当选？
- split vote 怎么解决？

**作业**：[Lab 3](lab3.html) · [作业总览](labs.html)

## 第 7 讲：Raft (2) {#lec7}

**一句话**：Raft 的提交规则、持久化、快照，以及怎么用它做线性一致的 KV。

**核心内容**

- commit 规则：多数派复制 + 当前 term（Figure 8）。
- 持久化 `currentTerm`、`votedFor`、`log`。
- snapshot / log compaction；`InstallSnapshot`。
- 客户端交互：去重、线性一致读。

**机制**

Figure 8 的场景要按五步看：

1. **(a)** S1 是 term 2 的 leader，只把 index 2 的 entry 复制到 S1、S2 两个节点（2/5，不是多数派），还没提交就崩溃。
2. **(b)** S5 靠 S3、S4、S5 的票当选 term 3 leader，在 index 2 写入了另一条 term 3 的 entry。
3. **(c)** S5 崩溃；S1 重启，靠 S1、S2、S3 的票当选 term 4 leader，继续复制自己那条 term 2 的 entry。此时它在多数派上，但仍不能提交，因为它不是当前 term 的 entry。
4. **(d)** S1 崩溃；S5 可以靠 S2、S3、S4 的票当选（term 5），用它 term 3 的 entry 覆盖 index 2。
5. **(e)** 如果 S1 在崩溃前先复制并提交一条**当前 term（term 4）**的 entry，那么这条 entry 提交后，它前面的旧 entry 也随之间接提交，S5 就无法再当选并覆盖。

规则是：leader 只能通过提交当前 term 的条目来间接提交旧 term 的条目；旧条目要等当前 term 的一条新条目提交后才算提交。实践中新 leader 常先提交一条当前 term 的 no-op entry，来尽快完成这件事。

持久化：`currentTerm`、`votedFor`、`log` 在改变后、回复 RPC 前必须落盘；否则重启后可能在一个 term 投两票，或丢失已承诺的日志。`commitIndex`、`lastApplied`、`nextIndex`、`matchIndex` 可以重建，不需要持久化。snapshot 的 `lastIncludedIndex`、`lastIncludedTerm` 要持久化，因为它们替代了被截掉的日志。

snapshot：状态机定期把当前状态写成快照，告诉 Raft “这个 index 之前的状态已经有了”；Raft 截断日志，保留 snapshot 元数据。落后的 follower 需要 `InstallSnapshot`：leader 直接把快照分块发过去，follower 安装后把 `commitIndex`/`lastApplied` 跳到快照位置。注意 snapshot 的 index 是“最后一个被包含的 index”，不是下一个日志下标。

客户端交互：每个请求带唯一 ID；状态机在 apply 时查去重表，已执行过就直接返回上次结果。线性一致的读有两条路：把 `Get` 也写进日志（简单，lab 用这条），或用 ReadIndex/lease 确认自己仍是 leader 后本地读（快，但要额外机制）。

**失败模式**

- 提交旧 term 的 entry。
- 持久化顺序错：先回复 RPC，再落盘。
- snapshot 的 index/term 与日志 index 混淆；apply 倒退。
- `InstallSnapshot` 后日志没截断，或 `commitIndex` 没更新。
- 去重表没进 snapshot，重启后重复执行。
- 读本地 map 返回 stale 数据。
- 客户端重试导致重复执行。

**延伸阅读（可选）**：[Raft 论文第 5.4、7、8 节](https://raft.github.io/raft.pdf)。

**和 lab 的关系**：Lab 3B–3D；Lab 4。

**自测**

- 为什么不能直接提交旧 term 的 entry？
- snapshot 的 index 和 `commitIndex` 有什么区别？

**作业**：[Lab 3](lab3.html) · [作业总览](labs.html)

## 第 8 讲：Linearizability {#lec8}

**一句话**：线性一致的定义：每个操作看起来在某个瞬间原子生效，并尊重实时顺序。

**核心内容**

- history：调用/返回事件。
- real-time order：一个操作在另一个开始前完成。
- legal sequential history：存在一个顺序，满足实时序和每个操作的语义。
- 线性化点；可组合性。
- 和 serializability 的区别。

**机制**

线性一致说的是单个对象：每个操作在“调用”和“返回”之间有一个瞬间生效，所有操作可以排成一个顺序，这个顺序尊重实时关系（如果 A 在 B 开始前返回，A 必须排在 B 前面），并且每个读返回它前面最近一次写的结果。这个瞬间叫线性化点。它不要求操作按开始时间排序，只要求存在这样一个顺序。

例子：客户端 A 的 `Put(x,1)` 在 t1 调用、t3 返回；客户端 B 的 `Get(x)` 在 t2 调用、t4 返回。因为 B 在 A 返回前就开始，B 可以返回 0 或 1，都合法；如果 B 在 t3 之后才开始，就必须返回 1。线性一致允许并发操作任意排序，但不允许“读到一个已经完成之后又被改回去的旧值”。

线性一致常和可串行化混淆。可串行化约束多个对象上的事务，要求存在一个串行顺序；它不要求尊重实时顺序。线性一致约束单个对象的读写，要求尊重实时顺序。两者可以同时成立（strict serializability），但不是一回事。线性一致可组合：每个对象线性一致，整个系统就线性一致；这使它可以按对象测试。

**失败模式**

- stale read：读了一个已经过期的副本。
- 读己之写：写返回后读不到自己的写。
- 成功返回后值回退。
- 把可串行化当线性一致。
- 测试只检查最终值，不检查实时顺序。

**延伸阅读（可选）**：[Linearizability (1990)](papers.html#linearizability)。

**和 lab 的关系**：Lab 2/4 的 KV 要求线性一致；测试用 porcupine 检查。

**自测**

- 一个 stale read 是线性一致的吗？
- 两个并发 Put，怎么判断哪个先生效？

**作业**：[Lab 2](lab2.html) · [Lab 3](lab3.html) · [Lab 4](lab4.html) · [作业总览](labs.html)

## 第 9 讲：ZooKeeper {#lec9}

**一句话**：一个协调服务：znode、watch、session；用 ZAB 做复制，提供 linearizable writes + FIFO client order。

**核心内容**

- znode 树；临时节点；watch 一次性触发。
- linearizable writes + FIFO client order；读可能陈旧，所以整体不是线性一致。
- leader election、分布式锁、配置管理。
- session 和 ephemeral node。

**机制**

ZooKeeper 是一个小的复制状态机，数据组织成 znode 树。客户端建立 session；session 有效期内可以创建 ephemeral znode，session 断开后这些节点被删除。watch 是一次性触发器：客户端注册“这个节点变了叫我”，触发一次后要重新注册。它不保证你看到所有中间变化，只保证“在你注册之后、触发之前，至少有一次变化”。

ZAB 是 ZooKeeper 的复制协议：leader 把写按 zxid 排序，follower 按顺序应用；读可以由 follower 本地服务，所以不同客户端可能看到不同的最新 zxid。ZooKeeper 的写是线性一致的（所有更新请求可序列化并尊重 precedence），同时提供客户端 FIFO（同一个客户端的操作按发送顺序执行）和通知顺序。它整体不是线性一致：一个客户端刚写完，另一个客户端可能读到旧值；需要 read-your-writes 时用 `sync()`。

这组保证足够做很多协调：leader election 用临时节点 + watch；分布式锁用顺序临时节点，最小序号持有锁；配置管理用 watch 监听变更。需要线性一致的场景（例如唯一 ID、严格读写）不能直接拿 ZooKeeper 的读来用。

**失败模式**

- 把 watch 当持久订阅，触发一次后没重注册。
- session 过期，ephemeral 节点消失，锁被释放。
- 读 follower 看到旧值，误以为线性一致。
- 羊群效应：大量客户端同时 watch 同一个节点。
- 锁的持有者崩溃，客户端没处理 session 事件。

**延伸阅读（可选）**：[ZooKeeper (2010)](papers.html#zookeeper)。

**和 lab 的关系**：Lab 2 的锁；Lab 5 的 controller/配置服务。

**自测**

- ZooKeeper 的写是线性一致的，为什么整体仍不是线性一致？
- watch 保证什么、不保证什么？

**作业**：[Lab 2](lab2.html) · [作业总览](labs.html)

## 第 10 讲：Lab 3 Q&A {#lec10}

**一句话**：Raft lab 的常见 bug、测试和调试方法。

**核心内容**

- Figure 2 漏条件：term 检查、投票规则、commit 规则。
- 锁：持锁发 RPC、持锁 sleep、持锁 send applyCh。
- 持久化：term/votedFor/log 的变化点。
- 测试：3A → 3B → 3C → 3D；`-race`；可视化 timeline。

**机制**

实现顺序建议：先只做 3A（选举 + 心跳，不复制日志），让 `TestInitialElection3A`、`TestReElection3A` 稳定；再加 3B 的日志复制和 commit，跑可靠网络；然后 3C 持久化，反复重启；最后 3D snapshot。每加一层都先跑单测，不要一上来跑全量。

调试时先固定一个失败测试，打开日志，记录每个 server 的 term/state/votedFor/commitIndex/lastApplied。看到“日志不一致”先查 `AppendEntries` 的 `prevLogIndex/prevLogTerm` 和截断逻辑；看到“选举卡住”先查 timeout、term 更新、votedFor 持久化；看到“apply 卡住”先查 commit 规则和 applyCh 的消费。

**失败模式**

- 一次改太多，3A 还没稳就做 3D，失败时无法定位。
- 只看最终输出，不看每个 server 的状态变化。
- 用 `time.Sleep` 猜时序，而不是用事件和日志。
- 测试失败就重跑，没保留失败现场。

**延伸阅读（可选）**：[Raft structure advice](https://pdos.csail.mit.edu/6.5840/labs/raft-structure.txt)；[locking advice](https://pdos.csail.mit.edu/6.5840/labs/raft-locking.txt)。

**和 lab 的关系**：Lab 3。

**自测**

- 你的 Raft 在什么情况下会提交旧 term 的 entry？
- 你怎么证明 `applyCh` 是顺序的？

**作业**：[Lab 3](lab3.html) · [作业总览](labs.html)

## 第 11 讲：Distributed Transactions {#lec11}

**一句话**：跨多个分片的原子提交：2PC、锁、可串行化。

**核心内容**

- 2PC：coordinator 问 prepare，所有 participant 同意后 commit。
- coordinator 崩溃 → participant 阻塞；需要恢复/日志。
- 锁和死锁；可串行化。
- 和 Paxos/Raft 的关系：复制 + 原子提交。

**机制**

2PC 分两阶段：coordinator 先写日志，再问所有 participant“能否提交”；participant 检查约束、锁住资源、写 prepare 日志，回复 yes/no；所有人 yes 后，coordinator 写 commit 日志，发 commit；participant 执行并释放锁。任何一个人 no，或者超时，coordinator 发 abort。

阻塞点在 coordinator 崩溃：participant 已经 prepare、锁着资源，却不知道最终是 commit 还是 abort；它只能等 coordinator 恢复，或者问其他 participant。3PC 加一个 pre-commit 阶段减少阻塞，但仍假设同步网络；Paxos/Raft 把 coordinator 的决策也复制，才能在主备切换后继续。2PC 保证原子提交，不保证高可用。

**失败模式**

- participant prepare 后崩溃，恢复时要能找回锁和日志。
- coordinator 在做出 commit 决策后崩溃，participant 超时后不能擅自 abort。
- 网络分区导致部分 participant 提交、部分未提交。
- 锁不释放，造成死锁。
- 把 2PC 当共识协议；它不解决 leader 选举。

**延伸阅读（可选）**：[6.033 Chapter 9](papers.html#6033)。

**和 lab 的关系**：Lab 4/5 的配置变更、shard 迁移。

**自测**

- 2PC 为什么可能阻塞？
- 怎么从 coordinator 崩溃中恢复？

**作业**：[Lab 4](lab4.html) · [Lab 5](lab5.html) · [作业总览](labs.html)

## 第 12 讲：Spanner {#lec12}

**一句话**：全球分布式 SQL：TrueTime + Paxos group + 2PC，提供外部一致性。

**核心内容**

- TrueTime：带误差区间的全局时间。
- Paxos group 复制每个 shard；跨 group 用 2PC。
- 外部一致性：全局实时序。
- 只读事务、snapshot read。

**机制**

Spanner 把数据按 key 范围分片，每个分片是一个 Paxos group；跨分片事务用 2PC。它给每个事务分配一个全局时间戳，读写都按时间戳排序，从而提供外部一致性（strict serializability）：如果事务 A 在 B 开始前提交，B 一定看到 A。

TrueTime 是带误差区间的物理时钟：`TT.now()` 返回 `[earliest, latest]`，保证真实时间在区间内。提交时，Spanner 等 `latest` 过去才让事务可见（commit-wait），这样后续事务的时间戳一定更大。代价是提交延迟至少一个时钟误差（通常几毫秒），并且依赖原子钟/GPS。

只读事务可以用 snapshot read：选一个时间戳，读该时间戳的一致性视图，不拿锁、不写日志。分片和配置变更由内部的 placement driver 管理；lab 5 的 shardctrler/controller 是它的简化版。

**失败模式**

- TrueTime 误差变大，提交延迟上升。
- 跨 group 的 2PC 协调者崩溃，事务阻塞。
- 时钟回拨或闰秒；依赖时钟基础设施。
- 只读事务时间戳选错，读到未来或过去。
- 热点分片。

**延伸阅读（可选）**：[Spanner (2012)](papers.html#spanner)。

**和 lab 的关系**：Lab 5 的分片 + 配置变更。

**自测**

- TrueTime 的误差区间怎么用？
- 外部一致性和线性一致的关系？

**作业**：[Lab 5](lab5.html) · [作业总览](labs.html)

## 第 13 讲：Chain Replication {#lec13}

**一句话**：主备链：写从 head 到 tail，读从 tail，强一致。

**核心内容**

- 链式复制；head 接收写，tail 服务读。
- 失败恢复：head/tail 挂了怎么换。
- 吞吐和可用性的取舍。
- 和 Raft 的对比。

**机制**

Chain replication 把副本排成一条链：写请求到 head，head 应用后转发给下一个，直到 tail；tail 应用后回复客户端。读只由 tail 服务，因为 tail 已经看到了所有已完成的写，所以读是强一致的。写要经过整条链，延迟随链长增加；读可以集中在 tail，也可以为读做额外副本。

失败恢复：head 挂了，第二个节点接任 head；tail 挂了，前一个节点接任 tail；中间节点挂了，前后相连。恢复期间要保证不丢已提交的写：新 head 需要知道哪些写已经到 tail；通常配合租约、配置服务或复制日志。链的成员变更要小心，不能让两个 head 同时接受写。

**失败模式**

- head 挂了，客户端还在重试旧 head。
- tail 挂了，读暂时不可用。
- 中间节点落后，链卡住。
- 重配置时出现两个 head 或两个 tail。
- 链太长，尾延迟高。

**延伸阅读（可选）**：[Chain Replication (2004)](papers.html#chain-replication)。

**和 lab 的关系**：Lab 3 的对照；理解复制协议的多样性。

**自测**

- 为什么读 tail 能保证强一致？
- head 挂了怎么办？

**作业**：[Lab 3](lab3.html) · [Lab 4](lab4.html) · [作业总览](labs.html)

## 第 14 讲：OCC / FaRM {#lec14}

**一句话**：乐观并发控制 + RDMA + 复制，做低延迟内存事务。

**核心内容**

- OCC：读/写集；提交时验证；冲突则 abort。
- FaRM：RDMA one-sided operations；primary/backup 复制。
- 事务的原子性和隔离性。
- 延迟优化。

**机制**

OCC 让事务先读、先写本地缓冲区，提交时再验证：读过的数据没变、写冲突没有发生；验证通过才写回，否则 abort 重试。它适合冲突少的负载；冲突多时大量 abort，吞吐反而下降。

FaRM 把事务放在内存里，用 RDMA 单边读写作远端访问，primary 负责并发控制和日志，backup 复制。它用“锁 + 版本号 + 乐观读”减少往返，把提交延迟压到微秒级。代价是依赖 RDMA、内存容量和故障恢复设计；不是所有环境都能复制。

**失败模式**

- 验证和写回不在一个原子步骤，出现丢失更新。
- 读集太大，验证成本高。
- 冲突多时活锁或重试风暴。
- primary 崩溃，backup 还没复制完。
- RDMA 内存注册或权限错误。

**延伸阅读（可选）**：[FaRM (2015)](papers.html#farm)。

**和 lab 的关系**：Lab 4 的 KV/事务；性能极限的另一端。

**自测**

- OCC 什么时候 abort？
- RDMA 为什么能降低延迟？

**作业**：[Lab 4](lab4.html) · [作业总览](labs.html)

## 第 15 讲：Verification {#lec15}

**一句话**：用 IronFleet/TLA+ 证明分布式系统的正确性；测试只是抽样。

**核心内容**

- 规格（spec）和实现（implementation）。
- refinement proof；invariant。
- model checking vs. machine-checked proof。
- 验证的代价和边界。

**机制**

测试只能抽样。验证试图证明“实现的所有可能执行都满足规格”。规格是一个抽象状态机（例如“KV 服务对每个 key 表现为一个线性一致的寄存器”）；实现是具体代码；refinement 证明建立两者之间的模拟关系：实现的每一步都能对应到规格的一步，且不变式在每一步后成立。

TLA+ 用状态机和时序逻辑描述规格，模型检查器穷举小规模状态；IronFleet 用交互式定理证明验证分布式协议：IronRSL 是 Paxos-based 的复制状态机，IronKV 是分片 KV（不是 Raft 的变体）。代价是规格本身可能写错、证明工作量大、代码和模型可能脱节。验证不能替代测试，但能发现测试很难覆盖的边界。

**失败模式**

- 规格写错，证明了一个错的东西。
- 模型和代码不一致（refinement gap）。
- 状态空间爆炸，只验证了小模型。
- 假设（故障模型、时钟）不现实。
- 证明只覆盖安全，不覆盖 liveness。

**延伸阅读（可选）**：[IronFleet (2015)](papers.html#ironfleet)。

**和 lab 的关系**：Lab 3 的 Raft 安全性；提醒你测试通过 ≠ 正确。

**自测**

- 测试能发现哪些 bug，发现不了哪些？
- refinement 证明在证什么？

**作业**：[Lab 3](lab3.html) · [作业总览](labs.html)

## 第 16 讲：Memcached at Facebook {#lec16}

**一句话**：大规模缓存：lease、一致性、尾延迟、多区域。

**核心内容**

- cache lease 防止 stale read。
- thundering herd；tail latency。
- 多区域部署和一致性取舍。
- 缓存和数据库的交互。

**机制**

缓存最怕的不是慢，而是返回旧值。Facebook 的 memcached 用 lease 解决两类问题：缓存 miss 时，只给一个客户端 lease，让它去数据库读，其他客户端等它的结果，避免惊群；删除或更新时，lease 防止一个慢的读把旧值写回缓存。

尾延迟比平均延迟重要：一个请求要等最慢的分片，99 分位会被放大。多区域部署要在一致性、延迟和可用性之间取舍；跨区域复制越快，旧值窗口越小，但成本越高。缓存和数据库之间没有事务，应用要能容忍“缓存旧、数据库新”的短暂窗口。

**失败模式**

- 缓存穿透或惊群。
- 删除后旧值被并发读写回。
- lease 过期，多个客户端同时回源。
- 热点 key。
- 多区域复制延迟导致 stale read。

**延伸阅读（可选）**：[Memcached at Facebook (2013)](papers.html#memcached)。

**和 lab 的关系**：Lab 2 的 lease/版本号思路。

**自测**

- 怎么避免缓存返回旧值？
- 为什么尾延迟比平均延迟重要？

**作业**：[Lab 2](lab2.html) · [作业总览](labs.html)

## 第 17 讲：AWS Lambda {#lec17}

**一句话**：Serverless 平台内部：隔离、冷启动、快照恢复、Firecracker。

**核心内容**

- microVM 隔离；多租户安全。
- 冷启动；snapshot/restore。
- 调度和弹性。
- 和容器/进程隔离的对比。

**机制**

Serverless 的核心是把“启动一个进程”做成毫秒级。AWS Lambda 用 Firecracker microVM 做隔离：每个函数实例一个轻量 VM，启动快、攻击面小；请求到来时复用热实例，冷启动时拉镜像、启动 VM、初始化 runtime。

冷启动分三段：调度/放置、沙箱启动、用户代码初始化。优化手段包括预置并发、快照恢复（把初始化后的内存状态存下来）、更小的镜像、更快的 runtime。隔离和复用是矛盾的：复用越多，冷启动越少，但不同租户/请求之间的状态泄漏风险越大。

**失败模式**

- 冷启动尾延迟。
- 实例复用导致全局状态泄漏。
- 并发请求打到同一个实例。
- 快照恢复后时钟、连接、随机数状态不一致。
- 依赖包太大。

**延伸阅读（可选）**：[AWS Lambda (2023)](papers.html#lambda)；[Firecracker (2020)](papers.html#firecracker)。

**和 lab 的关系**：和 agent runtime / 进程内核的隔离、恢复问题接近。

**自测**

- 为什么用 microVM 而不是容器？
- 怎么降低冷启动？

**作业**：[INFRA 02 · CN1](cloud-native.html#lab-cn1) · [作业总览](labs.html)

## 第 18 讲：Ray {#lec18}

**一句话**：分布式 Python：task/actor、object store、lineage、调度。

**核心内容**

- task vs. actor。
- lineage-based recovery。
- 调度器；数据本地性。
- ML workload 的特点。

**机制**

Ray 把计算拆成 task（无状态函数）和 actor（有状态对象）。driver 提交任务，调度器按资源需求放到节点；对象存在分布式对象存储里，task 的输入输出用 object reference 表示；lineage 记录每个对象由哪个 task 产生，节点失败时重算。

Actor 适合维护模型、连接或状态；task 适合无状态并行。调度要考虑数据本地性、GPU/CPU 资源、依赖关系。lineage 重算的代价可能很大，所以需要 checkpoint 或对象持久化。

**失败模式**

- 对象太大，传输或存储成为瓶颈。
- actor 崩溃，状态丢失；需要 checkpoint。
- lineage 重算风暴。
- 资源死锁：任务等资源，资源被任务占着。
- 数据本地性差。

**延伸阅读（可选）**：[Ray (2021)](papers.html#ray)。

**和 lab 的关系**：AgentRuntime 的任务调度、DAG 执行。

**自测**

- lineage 怎么恢复失败的任务？
- task 和 actor 的区别？

**作业**：[INFRA 03 · AOS1](agent-os.html#lab-aos1) · [作业总览](labs.html)

## 第 19 讲：SUNDR {#lec19}

**一句话**：不可信存储上的 fork consistency：客户端能检测服务器是否给了不同视图。

**核心内容**

- 不可信服务器；签名链；版本向量。
- fork consistency：客户端能发现分叉。
- 不能防什么：回滚、删除。
- 和“可验证执行事实”的关系。

**机制**

SUNDR 研究“服务器不可信”的文件系统：客户端把文件操作签名后上传，服务器只负责存储和排序；客户端验证服务器返回的版本链，确保自己没有看到分叉的历史。fork consistency 是它定义的保证：如果两个客户端看到不同的历史，那么它们之后永远看不到对方的分叉；这比线性一致弱，但能在不可信服务器上实现。

关键机制是版本向量和签名链：每个操作包含前一个版本的 hash，客户端验证链的完整性；服务器不能伪造签名，只能选择给谁看哪个分支。它防的是服务器欺骗，不防客户端自己的密钥泄漏。

**失败模式**

- 服务器回滚到旧版本（rollback）。
- 服务器对不同的客户端展示不同分支（fork）。
- 客户端离线太久，版本链无法合并。
- 密钥管理或签名性能。
- 只保证 fork consistency，不保证实时性。

**延伸阅读（可选）**：[SUNDR (2004)](papers.html#sundr)。

**和 lab 的关系**：如果你做 agent runtime 或可验证执行，“可验证的执行记录”是同一类问题。

**自测**

- fork consistency 的定义？
- 为什么不能完全防恶意服务器？

**作业**：[INFRA 03 · AOS5](agent-os.html#lab-aos5) · [作业总览](labs.html)

## 第 20 讲：Bitcoin {#lec20}

**一句话**：PoW + 最长链的 Nakamoto 共识；概率最终性。

**核心内容**

- proof-of-work；难度调整。
- 最长链；分叉；双花。
- 51% 攻击；概率最终性。
- 和 Raft/PBFT 的对比。

**机制**

Bitcoin 用工作量证明（PoW）在开放网络里选 leader：矿工找一个 nonce，使区块 hash 小于目标值；找到的人广播区块，其他人验证后接在后面。最长链（累计工作量最大）代表共识；分叉时，矿工选自己看到的最长链，最终一条分支胜出。

它提供概率最终性：一个交易后面跟的区块越多，被回滚的概率越低。双花攻击的成本与算力占比、确认数有关。它不做即时最终性，也不适合低延迟支付；它用经济激励替代身份认证，允许节点自由加入退出。

**失败模式**

- 51% 算力攻击。
- 自私挖矿或分叉。
- 交易池拥塞，手续费波动。
- 轻客户端验证不足。
- 确认数不够就认为最终。

**延伸阅读（可选）**：[Bitcoin (2008)](papers.html#bitcoin)。

**和 lab 的关系**：crash fault vs. Byzantine fault。

**自测**

- 为什么 51% 是关键阈值？
- 什么是概率最终性？

**作业**：[作业总览](labs.html)

## 第 21 讲：Byzantine Fault Tolerance {#lec21}

**一句话**：PBFT：3f+1 个节点容忍 f 个拜占庭节点。

**核心内容**

- primary/backup；pre-prepare/prepare/commit。
- 3f+1 的原因。
- view change。
- 和 Raft（crash fault）的对比。

**机制**

PBFT 处理拜占庭故障：节点可能撒谎、发不同消息，而不只是崩溃。它要求 3f+1 个副本，才能在有 f 个坏节点时仍然达成一致。协议分 pre-prepare、prepare、commit 三个阶段：primary 给请求编号并广播；副本检查编号/视图后广播 prepare；收到 2f+1 个 prepare 后广播 commit；收到 2f+1 个 commit 后执行并回复客户端。

View change 在 primary 坏掉时换主，保证新 primary 继承已提交的请求。PBFT 的消息复杂度是 O(n²)，适合小规模联盟链或许可链；大规模开放网络通常用 PoW/PoS 或别的共识。

**失败模式**

- 坏节点发送矛盾消息。
- primary 作恶或沉默，view change 卡住。
- 副本数不足 3f+1。
- 消息认证不完整，伪造视图。
- 网络异步时 liveness 不保证。

**延伸阅读（可选）**：[PBFT (1999)](papers.html#pbft)。

**和 lab 的关系**：Lab 3 的 Raft 只处理 crash fault。

**自测**

- 为什么需要 3f+1？
- primary 作恶怎么办？

**作业**：[作业总览](labs.html)

## 第 22 讲：Project demos {#lec22}

期末项目展示。自学可以跳过；如果你想做项目，选一个和 lab 相关的小系统，写清楚问题、设计、测试和限制。

**怎么讲**

项目展示只讲三件事：问题是什么、系统怎么工作、你验证了什么。准备一张架构图、一条关键路径的时序、一组失败注入结果；不要念代码。留时间回答“某个组件挂了会怎样”“这个设计的代价是什么”。

**展示检查**

- 只演示 happy path。
- 没有失败注入。
- 讲不清一致性和边界。
- demo 依赖外部服务或真实凭证。

**作业**：[作业总览](labs.html)

