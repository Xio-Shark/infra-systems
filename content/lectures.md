# INFRA 01 · 讲义

> 21 讲讲义 + 项目展示，按 MIT 6.5840 Spring 2026 的日程整理。每一讲给出问题、机制、失败模式、和实验的关系。读完一讲和对应的实验任务书，就可以开始实验。
> 这是原创中文导读，不是原文翻译。讲义给出问题、机制、失败模式和实验的接口；它不替代论文的完整论证。做实验时以讲义、`src/` 骨架和官方实验页为准；想真正理解协议，做完实验后至少读对应论文章节。
>
> 课程页、实验和 design questions 在 [INFRA 01](course-map.html)。

## 第 1 讲：Introduction {#lec1}

用一句话说：MapReduce 把一次大计算拆成很多个 map 和 reduce 任务，交给一群 worker 去做；有任务失败就重跑，最后把结果合并成一份。

### 从一次单词计数开始

假设你要统计 100 个文本文件里每个单词出现的次数。单进程程序不难写：读文件、切词、累加到一个 map、最后输出。但数据量再大一点，单机就跑不完；机器中途挂了，还得从头再来。

MapReduce 的办法不是让一个程序跑得更快，而是把计算拆开。它把输入切成很多份，每一份交给一个 map 任务：map 读一段文本，输出一堆 `(单词, "1")`。然后框架把相同单词的计数送到同一个 reduce 任务，reduce 把一长串 `"1"` 加起来，得到最终次数。

这里有两个纯函数：

```text
map(k, v)             -> list(k2, v2)
reduce(k2, list(v2))  -> list(v2)
```

用户只写这两个函数；切分、调度、网络传输、失败重试由框架负责。这是 MapReduce 最重要的分工：**用户写业务逻辑，框架用“重跑”换可靠性**。

### 三个角色

一次作业里有三个角色。输入文件是计算的起点：每个文件（或文件的一段）是一个 split，对应一个 map 任务。coordinator 只有一个，保存任务状态，给 worker 发任务，回收结果；论文里叫 master。worker 可以有多个，循环向 coordinator 要任务，执行 map 或 reduce，然后报告完成。

coordinator 不读输入文件，也不做计算；它只维护一张任务表。它保存每个任务的状态：还没开始、正在跑、已经完成；还保存开始时间，用来判断是否超时。worker 的数量不影响协议，只影响并行度；coordinator 不需要知道有多少 worker，它只把 idle 任务发出去。它也不需要搬数据：map 和 reduce 之间只传文件名，真正的数据在文件系统里。

worker 不互相通信，只和 coordinator 说话。这个结构让 coordinator 成为唯一的决策点，也让它可以很容易地重发任务：把超时的任务重新标成 idle，不需要 worker 之间协调。

```text
文件 0 ─ map 0 ─┐
文件 1 ─ map 1 ─┼─> 分区 0 ─ reduce 0 ─> mr-out-0
文件 2 ─ map 2 ─┤
                └─> 分区 1 ─ reduce 1 ─> mr-out-1
```

这张图里，map 的输出先落到分区文件，reduce 再按分区读。看的时候注意两条线：map 只写自己那一行，reduce 只读自己那一列。

### 一次作业怎么跑完

以 3 个输入文件、`nReduce = 2` 为例。

1. coordinator 生成 3 个 map 任务，编号 0、1、2；再生成 2 个 reduce 任务，编号 0、1。
2. 一个 worker 领到 map 0，读第 0 个文件，对每个单词调用 `map`，得到 `(word, "1")`。
3. 对每个 key 算 `ihash(key) % nReduce`，决定它属于哪个 reduce 分区。map 0 把所有输出写成两个文件：`mr-0-0` 和 `mr-0-1`。
4. 三个 map 都完成后，coordinator 才发 reduce 任务。reduce 0 读取所有 map 的第 0 个分区，也就是 `mr-0-0`、`mr-1-0`、`mr-2-0`。
5. reduce 0 把这些 key/value 按 key 排序，把同一个 key 的所有 value 交给 `reduce`，把结果写进 `mr-out-0`。reduce 1 同理，写 `mr-out-1`。
6. 两个 reduce 都完成后，`Done()` 返回 true，coordinator 退出；worker 发现联系不上 coordinator，也退出。

最终结果是所有 `mr-out-*` 的并集；测试会把它们排序后和顺序版的结果比较。

分区是这一步的关键。如果每个 map 把输出发给所有 reduce，reduce 会被大量重复数据淹没；先按 key 分区，每个 reduce 只处理自己那一份，网络和内存都省下来。代价是 reduce 必须等所有 map 都写完对应分区，不能边 map 边 reduce。

下面这个动画把正常路径走一遍；注意 W2 超时后，reduce 并没有提前开始。

<div class="anim" data-anim="mapreduce">
<p class="anim-fallback">这个动画需要 JavaScript；正文的步骤说明仍然完整。</p>
</div>

### 失败了怎么办

MapReduce 的失败处理只有一条主线：**任务在期限内没完成，就当成没做，重新发给另一个 worker**。

最常见的两种失败都和“做了一半”有关。worker 执行 map 到一半崩溃时，它可能已经写了半个 `mr-X-Y`。所以输出必须先写临时文件，关闭后再 `rename` 成最终名字；读者要么看到旧文件，要么看到完整的新文件，不会看到半个。另一种是 worker 写完文件但没来得及报告；coordinator 超时后重发，新 worker 重新生成同样的文件，旧 worker 晚到的报告被忽略。

还有两种边界。两个 worker 同时做同一个任务时，允许重复计算，但只接受一次完成报告，结果必须幂等。reduce 在 map 全部完成前启动会漏掉还没写完的分区，所以 coordinator 必须等所有 map 完成，才能发 reduce。

在实验里，所有 worker 共享同一个文件系统，所以 map worker 报告完就可以退出，reduce 仍能读到 `mr-X-Y`。论文里的 map 输出放在 worker 本地磁盘，reduce 通过网络去拉；如果那个 worker 死了，reduce 拉不到，coordinator 会把 map 任务重跑。两种情况的协调逻辑是一样的，差别只在“中间结果放在哪”。

论文还提了 backup task：一个任务拖得太慢，就在另一台机器上再跑一份，谁先完成用谁的结果。实验不做 backup，10 秒超时后重发就够了。coordinator 自己崩溃也不在实验的范围内：只有一个 coordinator，状态没有持久化，它挂了整个作业就得重来。

### 和实验的关系

Lab 1 就是这套东西的简化版：Unix socket 上的 RPC、`nReduce` 个中间文件、10 秒超时、`Done()` 退出条件。你会实现 `mr/coordinator.go`、`mr/worker.go` 和 `mr/rpc.go`，测试会检查输出正确性、并行度、重复任务数量和崩溃恢复。

讲义只能给你机制；具体到 RPC 结构体、任务状态机和测试输出，看 [Lab 1](lab1.html)。

### 检查一下自己

1. 为什么 map 的输出要按 key 分成 `nReduce` 个文件，而不是让每个 reduce 读所有 map 的输出？
2. worker 写完 `mr-X-Y` 但没报告就崩溃，会发生什么？coordinator 怎么恢复？
3. 论文里 map worker 死了，为什么要重跑 map？实验里为什么不需要？
4. 临时文件 + `rename` 解决了哪个竞态？如果直接写最终文件会怎样？

### 答案要点

1. 按 key 分区后，每个 reduce 只处理一个分区，map 输出只需要被读一次。如果每个 reduce 都读所有 map 输出，读取量会变成 `nReduce` 倍，而且每个 reduce 还要先过滤掉不属于自己的 key。
2. coordinator 在超时后把任务重新标成可分配，发给另一个 worker；旧 worker 晚到的报告因为任务已经完成，会被忽略。
3. 论文里的 map 输出在 map worker 的本地磁盘，reduce 通过网络去拉；worker 死了，文件就没了。实验里所有 worker 共享文件系统，文件还在，所以只需要重跑没有报告的任务。
4. 直接写最终文件时，reduce 可能读到写了一半的文件。`rename` 是原子的，读者要么看到旧文件，要么看到完整的新文件。

**依据**：MapReduce 论文第 2、3 节；6.5840 Lab 1 的 “A few rules” 和 “Hints”。

**作业**：[Lab 1](lab1.html) · [作业总览](labs.html)

## 第 2 讲：RPC 与线程（RPC and Threads） {#lec2}

### 一次迟到的重传

客户端先 `Put("x", 10)`，再 `Put("x", 20)`。第二个调用成功返回；第一个调用的回复在网络上丢了，客户端超时后重发。重发的旧请求晚于第二个请求到达服务端，服务端按到达顺序执行，最终 `Get("x")` 返回 10。客户端认为自己写了两次，服务端却把旧值写在了新值后面。这不是服务端的缺陷，而是远程过程调用（RPC）与本地函数调用的根本差别：请求可能丢失、重复、延迟，客户端无法从“没有回复”推断服务端有没有执行。

### 一次调用经过哪些人

一次 RPC 有客户端（client）、服务端（server）和两边的 RPC 库。客户端调用的是存根（stub），存根把参数序列化成请求，交给网络；服务端收到请求后，调度器（dispatcher）按方法名找到处理函数（handler），并通常为每个请求启动一个协程（goroutine）。handler 读写共享状态，回复再沿原路返回。Go 的 `net/rpc` 只序列化首字母大写的字段，跨网络的参数和回复都要按这个规则定义。

```text
client                    server
  |  Call(args)              |
  |---- request ------------>| dispatcher
  |                          |   -> handler（每个请求一个 goroutine）
  |                          |   lock; 读改写; unlock
  |<--- reply / error -------|
  | 超时，重发同一组参数      |
```

看什么：请求和回复是两条独立的消息，任何一条都可能丢；handler 并发执行，共享状态必须自己加锁。

### 三种语义，三种代价

至少一次（at-least-once）：客户端超时就重发，直到收到回复。实现最简单，代价是重复副作用。上面的 `Put` 就是例子；如果操作幂等（idempotent），重复执行没有坏处，至少一次就够。

最多一次（at-most-once）：服务端保证同一个请求最多执行一次。做法有两种。第一种是去重表：请求带唯一 ID，服务端记住“这个 ID 已执行，结果是 X”；崩溃重启后表还在，才能继续保证。第二种是把请求变成条件操作，Lab 2 的版本号就是这种：`Put(key, value, expectedVersion)` 只在版本匹配时更新并把版本加一，重发的请求带着同一个旧版本，自然不会再执行。Go 的 `net/rpc` 不做应用层重发，库这一层就是 at-most-once；但客户端仍可能不知道服务端有没有执行。

恰好一次（exactly-once）：效果恰好一次。它通常等于“最多一次”加上“客户端最终知道结果”，去重状态必须持久化，还要处理“执行了但回复丢了”的窗口。代价不只是内存，还有崩溃恢复和垃圾回收；不要把它当成默认语义。

### 版本号怎么替代去重表

以 Lab 2 为例，键（key）`x` 不存在，当前版本是 0。下面看一次回复丢失会怎样。

1. 客户端 A 发 `Put("x", 10, 0)`。服务端检查版本 0 匹配，写入 10，版本变成 1，准备回复。
2. 回复在网络上丢失。A 超时，用同一个参数重发 `Put("x", 10, 0)`。
3. 服务端现在版本是 1，期望版本 0 不匹配，返回 `ErrVersion`，不执行第二次写入。
4. A 收到 `ErrVersion`。它不能断定“第一次没执行”，因为第一次可能已经成功，只是回复丢了；所以 A 返回 `ErrMaybe`，让调用者用 `Get` 确认。
5. 如果 A 第一次就收到 `ErrVersion`，没有发生超时重发，那么可以确定这一次没有执行，返回 `ErrVersion`。

这里真正起作用的是条件写：重复请求带着旧版本，自然失效；版本号本身不是请求 ID。它省掉了一张去重表，但只适用于能表达成比较并交换的操作。发邮件、追加日志这类有外部副作用的操作，仍然需要显式的请求 ID 和持久化去重表。

把这次 `ErrVersion` / `ErrMaybe` 的往返走一遍：

<div class="anim" data-anim="rpc-retry">
<p class="anim-fallback">这个动画需要 JavaScript；正文的步骤说明仍然完整。</p>
</div>

### goroutine 和锁的边界

服务端每个请求一个 goroutine，意味着 handler 里的局部变量是安全的，共享的 map、任务表、日志不是。互斥锁（mutex）保护的是不变量，不是某一行代码。Lab 2 里“比较版本”和“更新值和版本”必须在同一个临界区（critical section）里，否则两个客户端都看到版本 0，都写入，后一个覆盖前一个。

一个实用规则是：锁保护数据，不保护 I/O。持锁时不要发 RPC、读文件、`time.Sleep`、往通道（channel）发送。Lab 1 的协调者（coordinator）如果在 `Ask` 里持锁等 10 秒，三个工作进程（worker）的 `Ask` 都会排队，`TestMapParallel` 会看到只有一个 worker 在跑。正确做法是先在锁内选出任务、标成运行中（running），解锁，再做慢操作。

channel 适合传递所有权和取消信号，mutex 适合保护一张共享表。两者都能解决大多数并发问题，选哪个取决于你把问题看成“共享状态”还是“消息传递”。Lab 1 和 Lab 3 的共享状态建议用 `sync.Mutex`；请求结束、超时、关闭这类事件用 channel 更自然。

### 坏了会看到什么

- 丢回复后重试，服务端执行两次 `Put`，最终值回退到旧请求。
- 去重表只存在内存，服务端重启后重复执行。
- 持锁发 RPC，一个慢节点拖住整个服务。
- 多个 goroutine 同时读写 map，`go test -race` 报竞态，或者程序直接崩溃。
- handler 等一个永远不会关闭的 channel，goroutine 泄漏，进程退不出去。
- 把重发后的 `ErrVersion` 当成“确定没执行”，调用者误以为可以安全重试。

### 回到 Lab 1、Lab 2 和 Lab 3

Lab 1 的 `mr/worker.go` 里，`call()` 发 `Ask` 和 `Report`；coordinator 的任务表要用锁保护，`Ask` 只做分配，超时扫描在后台把运行中超过 10 秒的任务改回空闲（idle）。`TestCrashWorker` 会反复杀 worker，`TestJobCount` 会检查没有崩溃时 map 任务不被重复调度。map 输出先写临时文件再 `rename`，是为了让重复执行和晚到报告不会留下半个文件。

Lab 2 的 `Clerk.Put` 在失败时重发同一个版本，`KVServer.Put` 在锁内比较版本并更新；`TestUnreliableNet` 用丢包和重排验证这条路径。Lab 3 的每个 RPC handler 也在独立 goroutine 里跑，`RequestVote` 和 `AppendEntries` 都要先拿锁再读状态；持锁发 RPC 是 3A/3B 常见的超时原因。

### 检查一下自己

1. 客户端超时后重发，服务端会不会执行两次？at-most-once 靠什么避免？
2. 为什么首次收到 `ErrVersion` 可以返回 `ErrVersion`，重发后收到同样的错误却要返回 `ErrMaybe`？
3. 持锁发 RPC 会怎样？Lab 1 的哪个测试会暴露这个问题？
4. Go 的 `net/rpc` 本身不重发，为什么 Lab 2 还需要版本号？
5. 什么时候用 channel，什么时候用 mutex？

### 答案要点

1. 可能执行两次；服务端要么用持久化去重表识别重复请求，要么把请求变成带版本的条件写，让重复请求失败。
2. 首次 `ErrVersion` 说明这一次没有执行；重发后的 `ErrVersion` 可能是第一次已执行、版本已经变了，也可能是别的客户端抢先改了版本，所以只能返回“可能执行”。
3. 一个慢 RPC 会让所有需要同一把锁的请求排队；Lab 1 的 `TestMapParallel` 会看到并行度变成 1，`TestCrashWorker` 也可能超时。
4. 因为应用层为了容错会重发；Go RPC 的不重发只保证“一次调用最多发一次”，不保证“业务操作最多执行一次”。
5. 共享一张表、需要原子地比较并更新，用 mutex；传递数据、通知结束、取消一组 goroutine，用 channel。

**依据**：6.5840 Spring 2026 第 2 讲 “Threads and RPC” 讲义；Lab 2 `kvsrv1` 任务书的 `ErrVersion` / `ErrMaybe` 规则；Go 官方 `net/rpc` 与 Effective Go 的并发章节。

**作业**：[Lab 1](lab1.html) · [Lab 2](lab2.html) · [作业总览](labs.html)

## 第 3 讲：GFS（Google File System） {#lec3}

### 一次只写了一半的失败

客户端往某个 chunk 的偏移量（offset）0 写 1 MB。主副本写本地成功，第二个副本超时，主副本向客户端返回错误。几秒后，读主副本的客户端看到新数据，读第二个副本的客户端看到旧数据。GFS 没坏，只是把这种失败后的区域定义成不一致（inconsistent）。要理解 GFS，先要接受“成功”和“失败”不是全局瞬间，而是相对于某个副本和某个租约。

### 谁存名字，谁存字节

GFS 有三个角色：客户端（client）、主节点（master，课程笔记里也叫 coordinator）、数据块服务器（chunkserver）。文件被切成固定大小的数据块（chunk），默认 64 MB；每个 chunk 默认存 3 个副本（replica）。master 保存元数据（metadata）：命名空间、文件到 chunk 的映射、chunk 位置和版本号（version）。chunkserver 存真正的字节，每个 chunk 在本地就是一个 Linux 文件。

master 的元数据全在内存里，命名空间和文件到 chunk 的映射写进操作日志（operation log），落盘并复制到远端，回复客户端前必须刷盘。chunk 位置不持久化，master 启动时问 chunkserver。这样 master 不用维护位置表，代价是启动慢。

### 写一个 chunk 的七步

读路径短：客户端把文件名和偏移量发给 master，master 返回 chunk 句柄（chunk handle）和副本位置；客户端缓存，之后直接找最近的 chunkserver 读。数据不经过 master，所以 master 不是带宽瓶颈。

写路径先选一个主副本（primary），其余是从副本（secondary）。master 给 chunk 发租约（lease），拿到租约的副本就是 primary。租约初始 60 秒，primary 可通过心跳续租，master 通常批准；想换 primary 时不续租，等旧租约过期。

1. 客户端问 master：这个偏移量属于哪个 chunk，谁持有租约，副本在哪。
2. master 返回 primary 和 secondary 列表；客户端缓存。
3. 客户端沿链把数据推给所有副本，副本先放进内部缓存，不急着写盘。
4. 数据全部到达后，客户端向 primary 发写请求。
5. primary 给这个写分配连续序号，按序写本地，再转发给所有 secondary。
6. secondary 按同一序号应用写，回复 primary。
7. primary 收到所有 secondary 的成功回复后回复客户端；出错就回复错误。

```text
客户端              master             primary          secondary A/B
  |--1 问 chunk------->|                  |                  |
  |<--2 primary 列表---|                  |                  |
  |--3 推数据（沿链）--------------------------------------->|
  |--4 写请求--------------------------->|                  |
  |                    |--5 转发（带序号）------------------>|
  |<--7 成功 / 错误--------------------|--6 确认----------|
```

看什么：控制流是 1、2、4、7，数据流是 3；数据先于写请求到达所有副本。primary 只排序和转发控制消息，不搬数据，所以不会成为中转站。

把七步写路径压缩成一条动画：

<div class="anim" data-anim="gfs-write">
<p class="anim-fallback">这个动画需要 JavaScript；正文的步骤说明仍然完整。</p>
</div>

### 三种一致性状态

GFS 的一致性不是线性一致。它把一次写之后的文件区域分成三种状态。

已定义（defined）：串行成功的写。所有客户端都会看到这次写的完整内容，它一定一致。

一致但未定义（consistent but undefined）：并发成功的写。所有副本字节相同，客户端看到的内容也相同，但这份内容可能是多次写拼出来的，不对应任何一次完整写。课程笔记的例子：C1 写 `ab`，C2 写 `xy`，两个写覆盖的范围重叠，所有副本都可能看到 `xb`。

不一致（inconsistent）：失败的写。primary 可能已写本地，部分 secondary 没写；不同客户端读不同副本，数据可能不同。客户端重试成功，区域才可能回到已定义。

记录追加（record append）里，客户端只给数据，primary 选偏移量。GFS 保证至少写一次，可能重复或留下填充（padding）；成功记录的区域已定义，填充和重复记录算不一致，应用靠校验和与记录 ID 过滤。

### 租约为什么不能省

master 分不清 primary 是崩溃了，还是只是网络断了。如果它直接给另一个副本发租约，旧 primary 可能还活着、还在接受写，就会脑裂（split brain）。租约把“什么时候可以换人”变成时间承诺：primary 承诺在到期前停止当 primary，master 承诺在到期前不选新 primary。两边都不需要知道对方是不是还活着，只需要各自的时钟大致可信。

代价是可用性。假设没有续租，primary 在租约开始 10 秒后失联，master 最坏要等到第 60 秒才能把租约发给别人，这 50 秒内该 chunk 的写不可用。租约只保证同一时刻一个 primary，不保证 primary 不丢已答应的写；后者靠副本按序应用和客户端重试。

### 边界和坏掉的样子

- 单 master 的 CPU 和内存是上限。小文件太多会撑爆元数据内存，master 扫描也变慢。
- 热点 chunk：大量客户端同时读同一个 chunk，少数 chunkserver 被打满；更高副本数和错开启动只缓解。
- 客户端缓存旧位置，可能读到过期副本（stale replica）；master 不会把过期副本发给新请求，但管不了旧缓存。
- master 崩溃：操作日志要能回放，检查点（checkpoint）后的日志不能丢；原论文的 master 切换不完全自动。
- chunk 很大，恢复坏盘要复制很多数据；副本长期缺失时，再坏一个就可能丢 chunk。

### 回到 Lab 1、Lab 2 和 Lab 3

Lab 1 的 `mr-X-Y` 先写临时文件再 `rename`，对应 GFS 的“失败重试，读者不能看到半个文件”；`TestCrashWorker` 检查崩溃重跑，`TestJobCount` 检查无崩溃时不重复发。Lab 1 的工作进程（worker）共享文件系统，map 输出不用复制；GFS 的 chunkserver 各有磁盘，要复制。

Lab 2 的 `Put` 用版本号拒绝过期写，和 GFS 用 chunk 版本号识别过期副本是同一类思路。差别是 Lab 2 只有一个服务端，版本比较加锁就能线性一致；GFS 有多个副本和租约，只给弱一致。`TestUnreliableNet` 验证重发不会写两次，对应 GFS 客户端失败重试写的场景。

Lab 3 的 Raft 用选举出的领导者（leader）和多数派复制取代租约 primary。GFS 靠租约避免脑裂，Raft 靠任期（term）和多数票避免脑裂；`TestBackup3B` 检查跟随者（follower）日志冲突时回退补齐，相当于 GFS 副本修复，但 Raft 要多数派确认才提交。

### 检查一下自己

1. 为什么客户端要先把数据推给所有副本，再向 primary 发写请求？
2. 租约解决什么问题？没有租约，master 换 primary 时会发生什么？
3. 已定义、一致但未定义、不一致，各举一个例子。
4. 记录追加为什么可能重复？应用怎么处理重复和填充？
5. master 为什么不持久化 chunk 位置？

### 答案要点

1. 把数据流和控制流分开：数据按拓扑沿链传输，primary 只排序，不用中转大块数据；所有副本先拿到数据，primary 才能按序应用后转发。
2. 防止旧 primary 和新 primary 同时接受写，造成脑裂。没有租约，master 无法区分崩溃和分区，可能在新 primary 上任时旧 primary 还在写。
3. 串行写 `x=1` 成功是已定义；两个并发写拼成 `xb` 是一致但未定义；primary 写了、secondary 没写、客户端收到错误，是不一致。
4. 客户端失败重试时，primary 可能已经追加成功但回复丢了，重试会再追加一次；primary 也可能补填充。应用用校验和识别填充，用记录 ID 去重。
5. chunkserver 最清楚自己磁盘上有什么；持久化位置表容易和实际状态不一致。启动时问一遍更简单，代价是恢复慢一点。

**依据**：GFS 论文第 2.3–2.7 节（含 Table 1）、第 3.1–3.3 节、第 4.5 节；6.5840 Spring 2026 第 3 讲 GFS 讲义；Lab 1 与 Lab 2 任务书。

**作业**：[Lab 1](lab1.html) · [作业总览](labs.html)

## 第 4 讲：Paxos 共识（Paxos） {#lec4}

### 两个备份都觉得自己该当主副本

GFS 的 master 只有一个。假设给它做主动备份，它一挂，两个备份都觉得自己应该接管；网络分区让一边的客户端继续写，另一边的客户端读不到。要避免这种脑裂（split brain），系统必须让一组机器对“谁是主副本（primary）”达成同一个值。Paxos 解决这个最小问题：在会丢消息、会崩溃的异步网络里，让所有参与者对单个值达成一致。

### 提议者、接受者、学习者

Paxos 有三个角色。提议者（proposer）提出一个值；接受者（acceptor）对提案投票；学习者（learner）学习已经选中的结果。每个提案带一个全局唯一的提案编号（proposal number，也叫 ballot）。多数派（majority）指超过半数：3 个节点要 2 个。一个值被选中（chosen），当且仅当多数派接受它。

### 两阶段：先问“有没有旧值”，再说“接受这个值”

第一阶段叫准备（prepare）。提议者选一个比见过的都大的编号 n，发给所有接受者。接受者如果发现 n 比它见过的最大编号 n_p 还大，就把 n_p 改成 n，承诺（promise）不再接受编号小于 n 的提案，并返回已接受的最大编号提案 (n_a, v_a)；如果 n 不够大，就拒绝。

第二阶段叫接受（accept）。提议者收到多数派回复后，挑 n_a 最大的值；没人接受过值，才用自己的值。然后它发 accept(n, v)。

接受者只要 n 不小于 n_p，就接受这个提案，更新 n_p、n_a、v_a，回复接受；否则拒绝。多数派接受后，值就被选中。学习者通过接受者通知或提议者 decided 消息得知结果。

```text
P1                 A1        A2        A3
 |--prepare(5)---->|         |         |
 |<--ok(_,_)-------|         |         |
 |--prepare(5)-------------->|         |
 |<--ok(_,_)----------------|         |
 |--accept(5,X)---->|         |         |
 |<--ok------------|         |         |
 |--accept(5,X)-------------->|         |
 |<--ok----------------------|         |
 |        多数派 A1+A2 接受，X 被选中  |
P2
 |--prepare(6)-------------------------->|
 |<--ok(n_a=5, v_a=X)--------------------|
 |--accept(6,X)  必须复用 X，不能提 Y
```

看什么：A2 同时属于第一轮的多数派 {A1, A2} 和第二轮的多数派 {A2, A3}。它在第二轮 prepare 的回复里带回了 X，所以 P2 即使想提 Y，也必须提 X。多数派的交集就是安全性的来源。

### 为什么不会选出两个值

假设值 X 在第一轮被多数派 C 接受，后来又有值 Y 在第二轮被多数派 S 接受。C 和 S 一定有交集，至少有一个接受者同时属于两边。这个接受者在第一轮接受过 X，它给第二轮 prepare 的回复里必然带着 X（或编号更高、但按归纳仍是 X 的值）。第二轮提议者看到这个回复，就必须把 X 作为提案值；所以 Y 不可能被选中。

这个论证依赖一个前提：接受者不能失忆。接受者必须在回复 prepare 或 accept 之前，把 n_p 和 (n_a, v_a) 写到稳定存储。它重启后如果忘了，可能先接受 X，再接受编号更高的 Y，而 X 已被选中。提议者可以忘，接受者不能忘。

### 走一遍数字

三个接受者 A1、A2、A3，A3 挂了。P1 发 prepare(5)，A1、A2 回复没有接受过任何值。P1 发 accept(5, X)，A1、A2 接受，2/3 构成多数派，X 被选中。

P2 不知道 X 已经选中，想提 Y，发 prepare(6)。这次 A1 挂了，A2、A3 回复。A2 的回复是 (n_a=5, v_a=X)，P2 必须发 accept(6, X)。如果 P2 违反规则发 accept(6, Y)，A2 和 A3 在 n=6 下会接受 Y，系统就出现了两个被选中的值。这个反例说明“提议者必须选 n_a 最大的值”不是优化，是安全规则。

再看崩溃。A2 接受 5/X 后崩溃，A1 也接受了，X 已经选中。A2 重启后如果丢了 n_a，P2 发 prepare(6) 时，A2 和 A3 都回复没接受过值，P2 就会提 Y，A2、A3 接受，Y 被选中。X 和 Y 都被选中，安全被破坏。所以接受者的状态必须落盘。

把两轮提案和多数派交集走一遍：

<div class="anim" data-anim="paxos">
<p class="anim-fallback">这个动画需要 JavaScript；正文的步骤说明仍然完整。</p>
</div>

### 活锁和活性

Paxos 保证安全性（safety），不保证活性（liveness）。P1 发 prepare(10)，P2 发 prepare(11)。P1 的 accept(10, X) 因为接受者的 n_p 已经是 11 而被拒绝，改发 prepare(12)。P2 的 accept(11, Y) 又因为 n_p 是 12 而被拒绝。两边不断抬高编号，谁也无法完成，这就是活锁（livelock），不破坏安全，但没进展。

解决办法是让一段时间内只有一个提议者。选一个稳定的领导者（leader，也叫 distinguished proposer），由它连续提议；其他节点退避，或者随机等待后再试。FLP 结果说，在完全异步、允许一个崩溃的网络里，确定性共识算法无法同时保证安全和终止；Paxos 用随机化或超时来换取实际中的活性。

### 代价和边界

Paxos 一次共识两个往返：prepare 和 accept。多数派是 2f+1 个节点，容忍 f 个故障。接受者每次承诺和接受都落盘，磁盘慢会拖慢吞吐；实际系统批量提交摊薄。

multi-Paxos 把每轮的值当成日志的一个位置。稳定 leader 只做一次 prepare，之后对每个日志位置直接 accept，省掉每条一次的 prepare。这就是状态机复制（RSM）的骨架：日志顺序一致，所有副本按顺序应用，状态就一致。代价是 leader 成为瓶颈，且日志不能无限增长，需要快照。

没有多数派时，Paxos 不能推进。这不是 bug，是定义：少数派不能单方面做决定。分区恢复后，多数派能通信，协议就继续。

### 回到 Lab 1、Lab 2 和 Lab 3

Lab 3 的 Raft 是 Paxos 的工程变体。`RequestVote` 像 prepare：候选人的任期（term）相当于提案编号，`votedFor` 相当于接受者的承诺，日志新旧检查相当于“不能选出一个缺少已提交值的 leader”。`AppendEntries` 像 accept：leader 把某个位置的值复制给多数派，多数派确认后提交。多数派交集保证已提交的日志不会在换 leader 后丢失；`TestBackup3B` 检查日志冲突时的回退和补齐。

`currentTerm` 和 `votedFor` 必须持久化，对应接受者的 n_p；日志本身也要持久化，对应 (n_a, v_a)。`applyCh` 是学习者：提交后的条目按下标（index）顺序交给状态机。3A 的 `TestInitialElection3A`、`TestReElection3A` 检查选举，3B 的 `TestBackup3B` 检查日志修复。

Lab 1 的 coordinator 是单点，正是 Paxos 要复制的对象；多副本时任务表要先达成共识。Lab 2 的版本比较是条件写，不是共识：它假设只有一个服务端，崩溃后状态就没了；多副本对版本顺序达成一致才需要 Paxos。`TestUnreliableNet` 只测 RPC 重复，不测服务端崩溃。

### 检查一下自己

1. 为什么多数派交集能保证不会选出两个不同的值？
2. 接受者为什么必须持久化 n_p 和 (n_a, v_a)？给出一个崩溃反例。
3. 两个提议者怎样活锁？实际系统怎么打破？
4. Paxos 保证活性吗？为什么？
5. multi-Paxos 为什么能省掉每个日志位置的 prepare？

### 答案要点

1. 任何两个多数派至少共享一个接受者；如果 X 已被选中，交集里的接受者一定见过 X，它会把 X 带回 prepare，新的提议者必须复用 X。
2. 忘了 n_p，可能接受编号更小、值不同的旧提案；忘了 (n_a, v_a)，无法把已选中的值告诉新提议者，可能选出另一个值。
3. 两个提议者互相用更大的编号覆盖对方的 prepare，导致对方的 accept 一直被拒绝；用稳定的 leader、随机退避或超时来打破。
4. 不保证。Paxos 只保证安全；没有多数派、或者提议者互相抬高编号时，系统可能一直不结束。活性依赖 leader 选举和随机化。
5. 稳定 leader 在一次 prepare 后已经拿到多数派的承诺，之后只要编号不被更高的提案超过，就可以对每个日志位置直接 accept。

**依据**：Paxos Made Simple 第 2.1–2.4 节（P2c、Phase 1/2、Progress）；6.5840 Spring 2026 第 4 讲 Paxos 讲义与 pseudo-code；Lab 3 任务书。

**作业**：[Lab 3](lab3.html) · [作业总览](labs.html)

## 第 5 讲：Go 并发模式（Go Patterns） {#lec5}

### 测试结束了，进程却不退出

一个 Raft server 测试通过后没有退出。协程转储（goroutine dump）里有 200 个协程：心跳（heartbeat）定时器还在每 100 ms 发一次，apply 协程卡在 `applyCh`，几个 RPC handler 持着锁等一个永远不会关闭的 channel。测试不是被算法卡住的，是被并发结构卡住的。这一讲看四个结构：定时器、工作池、流水线、取消，以及共同边界：锁。

### 四个角色和一条规则

协程（goroutine）是 Go 的轻量线程，启动成本远低于系统线程。通道（channel）在协程之间传值并同步；互斥锁（mutex）保护共享状态；上下文（context）传递取消信号和截止时间。定时器（ticker）按固定间隔往 channel 发时间；工作池（worker pool）用固定数量的协程消费任务；流水线（pipeline）把多个阶段（stage）用 channel 串起来。

一条规则贯穿全讲：谁生产，谁关闭；谁阻塞，谁检查取消。关闭 channel 是发送方的责任；每个阻塞点都要有退出路径。

### 定时器：别用 Sleep 轮询

Raft 的心跳是周期事件。最直接的写法是 `for { time.Sleep(100 * time.Millisecond); sendHeartbeat() }`，但它睡眠时无法响应关闭，多次睡眠还会累积漂移。用定时器：

```go
t := time.NewTicker(100 * time.Millisecond)
defer t.Stop()
for {
    select {
    case <-t.C:
        sendHeartbeat()
    case <-stop:
        return
    }
}
```

`Ticker` 会为慢消费者调整间隔或丢弃 tick，不会把积压的 tick 排队；`Stop` 之后不再发送，但不会关闭 channel，所以不要用 `range t.C` 等它结束。`time.Tick` 返回只读 channel，不能主动停止；Go 1.23 起未被引用的 ticker 可以靠垃圾回收（GC）处理，但在服务关闭时要确定性停止，仍然用 `NewTicker` 加 `Stop`。

### 工作池：固定并发，别无限起协程

如果每个任务起一个协程，任务一多，协程数量和内存就失控。工作池把并发固定住：

```go
jobs := make(chan Job, 100)
results := make(chan Result, 100)
var wg sync.WaitGroup
for i := 0; i < 8; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        for j := range jobs {
            results <- process(j)
        }
    }()
}
go func() { wg.Wait(); close(results) }()
```

生产者往 `jobs` 发任务，发完 `close(jobs)`；8 个工作协程（worker）用 `range jobs` 消费，channel 关闭后循环自然结束。`results` 由 `wg.Wait()` 之后的收集者（collector）关闭。多个 worker 读同一个 channel 叫扇出（fan-out）；把多个 channel 合并成一个叫扇入（fan-in）。

```text
生产者 --jobs（缓冲 100）--> [worker 1] --\
                            [worker 2] ----> results --> collector
                            [worker 8] --/
        发完 close(jobs)           wg.Wait() 后 close(results)
        ctx.Done() 让每个 select 退出
```

看什么：固定 8 个 worker，不会因为任务多而膨胀；`jobs` 的缓冲是队列，也是背压（backpressure）；关闭 `jobs` 的是生产者，关闭 `results` 的是等待所有 worker 结束后的那一个协程。

### 流水线：每个阶段只做一件事

流水线把处理拆成阶段（stage），阶段之间用 channel 连接。每个阶段从上游读、处理、往下游写，写完关闭自己的输出：

```go
func stage(ctx context.Context, in <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for v := range in {
            select {
            case out <- v * v:
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}
```

上游关闭后 `range` 结束，`defer close(out)` 通知下游；下游提前退出时，如果上游还在往 `out` 发送，就会永久阻塞。所以每个发送都要带 `ctx.Done()`，或者保证下游会把 channel 读干净。协程泄漏（goroutine leak）通常就是这样来的：请求结束了，后台协程还在等一个没人接收的 channel。

### 取消：context 是协作式的

取消（cancellation）不是杀死协程，而是发一个信号，让协程自己在安全点退出。`ctx, cancel := context.WithCancel(parent)` 创建子上下文；`defer cancel()` 在函数返回时释放资源；`ctx.Done()` 在取消时关闭。子上下文会随父上下文一起取消，形成一棵树。

每个阻塞点都要检查：`select { case <-ctx.Done(): return; case job := <-jobs: process(job) }`。如果协程卡在不带 context 的 RPC 或系统调用里，取消信号到了它也退不出来；要用支持 context 的 API，或者设置超时。取消是协作的，代码不检查，信号就没有用。

### 锁的边界

mutex 保护的是不变量，不是某个变量。Lab 2 的 `KVServer.Put` 里，比较版本和更新值必须在同一个临界区；Lab 1 的 coordinator 里，选任务和标成运行中（running）也必须原子。锁的边界要尽量短：只在内存里读写，不做出站 RPC、不读磁盘、不 `time.Sleep`、不往 channel 发送。持锁发送时，如果接收方不读，整个服务就卡死。

锁的顺序要固定。两个锁 A、B，一个协程先 A 后 B，另一个先 B 后 A，就会死锁。`go test -race` 能抓数据竞争，抓不到死锁；死锁要看协程转储，找谁在等锁、谁在等 channel、谁在等 RPC。

### 走一遍数字

1000 个任务，每个耗时 100 ms，工作池 8 个 worker，`jobs` 缓冲 100。每个 worker 处理约 125 个任务，理论总时间约 1000 ÷ 8 × 100 ms = 12.5 秒。每个任务起一个协程，1000 个同时跑，内存和调度压力大。

第 3 个任务失败，调用 `cancel()`。8 个正在跑的 worker 在下一个 `select` 看到 `ctx.Done()`，停止处理并返回；生产者停止发送，`close(jobs)`，`wg.Wait()` 返回，collector 关闭 `results`。已经排队的 992 个任务不再执行，退出不到 1 秒。如果没有取消，关闭要等队列跑完，约 12.5 秒。

Lab 3 里，心跳间隔通常取 100 ms，选举超时（election timeout）要明显大于它，lab 要求旧 leader 失联后 5 秒内选出新 leader；每次测试杀掉 leader，如果 ticker 没 `Stop`、apply 协程没退出，跑 100 次就留下 100 个协程。`TestReElection3A` 会反复触发这条路径。

### 代价和坏掉的样子

- channel 有同步成本；一个热点计数器用 mutex 可能比“一个协程加 channel”更快。不要为了风格把锁都换成协程。
- 工作池会遇到队头阻塞：一个慢任务占住 worker，后面的任务等；任务粒度不均时要分池或限制单任务时间。
- 流水线每级都有延迟；缓冲越大吞吐越高，内存也越大；无缓冲 channel 把生产和消费绑在一起。
- 取消是协作的；阻塞在 RPC、磁盘、`time.Sleep` 里的协程不会因为 `ctx.Done()` 自动退出。
- 向已关闭的 channel 发送会 panic；重复关闭也会 panic；只有发送方可以关闭。
- 锁太粗，并发变差；锁太细，死锁和竞态变多。`-race` 通过不代表没有并发 bug。

### 回到 Lab 1、Lab 2 和 Lab 3

Lab 1 的 coordinator 用 mutex 保护任务表，`Ask` 和 `Report` 只做短暂的临界区；后台扫描用 ticker 或循环加 `time.Sleep`，把运行中超过 10 秒的任务改回空闲（idle）。`TestMapParallel` 会因为持锁做慢操作而失败，`TestCrashWorker` 会因为重发太慢而超时。

Lab 2 的 `KVServer.Put` 在同一个锁里比较版本、更新值和版本；`Lock.Acquire` 只有在确认写入成功后才能返回，`Release` 要检查持有者（owner）。`TestManyClientsUnreliable` 会把锁的竞态放大。

Lab 3 常见骨架里，`Make` 启动心跳协程，`ticker()` 用 `time.NewTicker` 发心跳，`applier()` 是唯一往 `applyCh` 发送的协程，保证按下标（index）顺序、不重复。`RequestVote` 和 `AppendEntries` 在独立协程里跑，先拿锁再读状态，持锁不发 RPC。`TestInitialElection3A` 和 `TestBackup3B` 失败时，先看协程转储，再看锁。

### 检查一下自己

1. 为什么工作池要固定 worker 数量？无限起协程会怎样？
2. 流水线里谁负责关闭 channel？下游提前退出会怎样？
3. 为什么用 `time.NewTicker` 而不是 `time.Tick`？`Stop` 之后 channel 会关闭吗？
4. 持锁发 RPC 会怎样？Lab 1 或 Lab 3 的哪个现象对应？
5. `context` 取消后，goroutine 一定会退出吗？

### 答案要点

1. 固定数量把并发和内存上限锁住；无限起协程会让调度、栈和下游 channel 一起过载，任务越积越多。
2. 发送方关闭自己的输出 channel；下游提前退出时，上游的发送会永久阻塞，必须用 `ctx.Done()` 或把 channel 读干净。
3. `NewTicker` 可以 `Stop`，关闭时能确定性释放；`Tick` 不能主动停。`Stop` 只停止发送，不关闭 channel。
4. 一个慢 RPC 会让所有需要同一把锁的请求排队；Lab 1 的 `TestMapParallel` 并行度变 1，Lab 3 的选举或提交超时。
5. 不一定。取消是协作式的，协程必须检查 `ctx.Done()`；卡在不带 context 的阻塞调用里，信号到了也退不出来。

**依据**：Russ Cox, “Go Concurrency Patterns”（2012）与 “Advanced Go Concurrency Patterns”（2013）；Sameer Ajmani, “Go Concurrency Patterns: Pipelines and Cancellation”（2014）与 “Go Concurrency Patterns: Context”（2014）；6.5840 Spring 2026 第 5 讲 Go patterns 幻灯片；Go 官方 `time` 包文档；Lab 3 的 `raft-locking.txt`。

**作业**：[Lab 1](lab1.html) · [Lab 2](lab2.html) · [Lab 3](lab3.html) · [作业总览](labs.html)

## 第 6 讲：Raft (1) {#lec6}

用一句话说：Raft 先选出一个 leader，再由 leader 把日志复制到多数派；只要多数派还活着，日志顺序就不会乱。

### 三个 server，一个挂了

假设有三个 server：S1、S2、S3。客户端把命令发给 leader，leader 把命令写进日志，再复制给另外两个。多数派（至少两个）确认后，这条命令才算提交。

现在 S1 挂了。剩下 S2 和 S3，仍然构成多数派，服务可以继续。问题是：谁来当新 leader？如果 S2 和 S3 都觉得自己应该当，客户端可能把命令发给两个 leader，日志就会分叉。

Raft 用两个办法避免这件事：**一个 term 最多一个 leader**，以及**候选人必须拿到多数票**。这两条加起来，保证同一个 term 最多一个 leader；旧 leader 即使还没发现自己过期，也拿不到新的多数派，不能提交新条目。

### 三种状态和两个时间

每个 server 在任意时刻处于三种状态之一。follower 被动接收请求；超过 election timeout 没收到 leader 的心跳，就转成 candidate。candidate 把 term 加一，投自己一票，向所有 peer 发 `RequestVote`；拿到多数票就转成 leader。leader 定期发心跳（不带日志的 `AppendEntries`），维持自己的地位。收到更高 term 的请求时，任何状态都先更新 `currentTerm`、清空 `votedFor`，再转成 follower；candidate 收到同 term 或更高 term 的 `AppendEntries`，也会退回 follower。

心跳就是不带日志的 `AppendEntries`。follower 收到就重置 election timeout，所以 leader 只要还在发心跳，就不会有人发起选举。

每个 server 要持久化 `currentTerm`、`votedFor` 和 `log[]`；`commitIndex`、`lastApplied` 不需要持久化，重启后从 0 重新推进；leader 还维护 `nextIndex[]` 和 `matchIndex[]`。这些变量在论文 Figure 2 里有完整的表。

有两个时间要区分：

- **election timeout**：follower 等多久没心跳就发起选举。必须随机化，否则所有 follower 会同时超时、同时拉票，谁也拿不到多数票。
- **heartbeat interval**：leader 多久发一次心跳。必须明显小于 election timeout，否则 follower 会误以为 leader 挂了。

论文的典型值是 election timeout 150–300 ms、心跳约 10 ms 一次。实验的 tester 限制 leader 每秒最多发 10 次心跳，所以心跳不能太密；同时要求旧 leader 失效后 5 秒内选出新 leader，所以 election timeout 也不能太大。具体数值要自己调，关键是“心跳间隔 < election timeout，而且 election timeout 明显小于 5 秒”。

### 选举：从超时到多数票

继续用三个 server 的例子。

1. S1、S2、S3 都是 follower，各自有一个随机 election timeout。
2. S2 的 timer 先到。它把 `currentTerm` 从 0 加到 1，`votedFor` 设为自己，向 S1、S3 发 `RequestVote(term=1, candidateId=2, lastLogIndex, lastLogTerm)`。
3. S1、S3 检查三件事：term 不小于自己的 term；这个 term 还没投过别人；S2 的日志至少和自己一样新。三条都满足，就投赞成票。
4. S2 收到两票（包括自己），达到 3 个 server 的多数派，成为 term 1 的 leader。
5. S2 立刻发心跳。S1、S3 收到心跳，重置 election timeout，继续当 follower。

如果 S2 和 S3 同时超时，各投自己一票，每人只有一票，谁也到不了 2 票。这一轮就浪费了。下一轮它们的随机 timeout 不同，通常会有一个先发起选举，split vote 就解开了。**随机化不是性能优化，它保证系统不会长期卡在 split vote 里**。

```text
S2 (candidate)                S1, S3 (follower)
     |  RequestVote(term=1)  |
     |---------------------->|
     |<----------------------|  voteGranted = true
     |  拿到多数票，成为 leader |
     |  AppendEntries (心跳)  |
     |---------------------->|
```

这张图只画了一次拉票。真实的实现里，S2 会并行发给所有 peer，收到多数票就立刻转成 leader，不等最慢的那个回复。

把这段拉票过程连起来看：

<div class="anim" data-anim="raft-election">
<p class="anim-fallback">这个动画需要 JavaScript；正文的步骤说明仍然完整。</p>
</div>

### 日志复制：一次 AppendEntries 的往返

假设 S2 已经是 leader，客户端发来命令 `x = 1`。

1. S2 把命令追加到本地日志的 index 5，term 记为 1。
2. S2 向 S1、S3 并行发 `AppendEntries(term=1, leaderId=2, prevLogIndex=4, prevLogTerm=1, entries=[x=1], leaderCommit=4)`。
3. S1、S3 先检查：自己的日志在 index 4 处的 term 是不是 1。如果是，追加新条目，回复成功；如果不是，拒绝，并把自己的冲突信息带回去。
4. S2 收到多数派（包括自己）的成功回复，把 `commitIndex` 推进到 5。它把这条命令交给状态机执行，然后回复客户端。
5. 下一次心跳带上 `leaderCommit=5`，S1、S3 也把 index 5 应用到自己的状态机。

如果 S1 的日志在 index 4 处和 leader 不一致，它会拒绝。S2 把 `nextIndex[1]` 往回退，直到找到一个双方都有的前缀，再从那里开始发。论文里还给了快速回退的优化：follower 在拒绝时带上冲突 term 的第一个 index，leader 一次跳过一整个 term，而不是一条一条退。实验的 3B 测试 `TestBackup3B` 专门检查这个回退不能太慢。

把回退和追平的过程走一遍：

<div class="anim" data-anim="raft-replication">
<p class="anim-fallback">这个动画需要 JavaScript；正文的步骤说明仍然完整。</p>
</div>

### 两条最容易写错的规则

**第一，选举限制。** 候选人不能只看票数，还要看日志。投票者只在“候选人的日志至少和我一样新”时才投票。比较的方法是：先比最后一条日志的 term，term 大的更新；term 相同再比最后一条日志的 index。没有这条规则，一个日志落后的节点可能当选，已经提交的条目就会被覆盖。

**第二，只能提交当前 term 的条目。** leader 不能因为“某个旧 term 的条目已经复制到多数派”就直接提交它。Figure 8 给了反例：旧条目可能在新 leader 上任后被覆盖。正确做法是等当前 term 的一条新条目提交，旧条目随之间接提交。实践中，新 leader 常先提交一条当前 term 的 no-op，尽快完成这件事。

### 和实验的关系

Lab 3A 只做选举和心跳，目标是 `TestInitialElection3A`、`TestReElection3A`、`TestManyElections3A` 全绿；Lab 3B 才做日志复制，测试从 `TestBasicAgree3B` 开始，最后是 `TestBackup3B` 和 `TestCount3B`。3A 的通过标准不是“能选出 leader”，而是“旧 leader 失联后 5 秒内选出新 leader，而且心跳不能太密”。3B 的通过标准不是“能复制”，而是“日志冲突能快速回退，RPC 数量不能太高”。

### 检查一下自己

1. 为什么 election timeout 要随机？如果所有节点用同一个值，会发生什么？
2. 一个 term 里，一个 server 最多投几票？这条规则防止了什么？
3. follower 的日志比 leader 长，`AppendEntries` 应该怎么处理？
4. 为什么 leader 不能直接提交旧 term 的条目？构造一个反例。
5. 3A 的测试为什么限制心跳频率？心跳太密会掩盖什么问题？

### 答案要点

1. 同时超时、同时拉票，split vote 可能反复发生；随机化让某一轮只有一个 candidate 先行动，系统才能继续推进。
2. 一票；防止同一个 term 出现两个 leader。
3. 以 leader 的 `prevLogIndex`、`prevLogTerm` 为准，找到第一个冲突点，截断自己的后缀，再追加 leader 的条目。
4. 旧 term 的条目即使复制到多数派，也可能被一个新 leader 用更高 term 的条目覆盖；要等当前 term 的条目提交，才能间接提交旧条目。
5. 心跳太密会让 follower 一直不超时，选举路径得不到测试；也会让 RPC 数量过高，拖慢测试。

**依据**：Raft 论文第 5.1–5.4 节、Figure 2、Figure 8；6.5840 Lab 3 的 3A/3B 说明。

**作业**：[Lab 3](lab3.html) · [作业总览](labs.html)

## 第 7 讲：Raft 的提交与快照（Raft (2)） {#lec7}

S1 在任期（term）4 当选领导者（leader），日志里下标（index）7 是任期 2 留下的旧条目。它把下标 7 复制到 S2、S3、S4，四台都有，已经是多数派（majority）。如果按“多数派有就算提交（commit）”处理，S1 会把成功回复给客户端。然后 S1 崩溃，S5 在任期 9 靠 S2、S3、S4 的票当选：它的下标 7 是任期 3 的另一条，比多数派持有的任期 2 更新，选举限制（election restriction）允许它当选，它随即覆盖下标 7。客户端已经收到成功，读到的却不是原来的值。

这里的关键不是“多数派复制没用”，而是**多数派复制的是哪个任期的条目**。当前任期的条目复制到多数派就可以提交；旧任期的条目不行，它只说明“没被推翻”，不说明“已经定了”。

### 提交、应用和快照各指什么

日志（log）是一串带下标和任期的条目（entry）。`commitIndex` 是已知提交的最高下标，`lastApplied` 是已交给状态机（state machine）执行的最高下标；两者都不持久化（persist）。快照（snapshot）是状态机在某个下标上的完整状态，附带 `lastIncludedIndex` 和 `lastIncludedTerm`，这两个值要持久化。

### 提交规则为什么不能只看多数派

规则：leader 只能提交当前任期的条目；旧条目要等当前任期的新条目提交后才间接提交。Figure 8 是反例。

```text
(a) 任期 2    S1 [1][2]   S2 [1][2]   S3 [1]   S4 [1]   S5 [1]
              S1 是 leader，下标 2 只到 S1、S2，未提交就崩溃
(b) 任期 3    S5 靠 S3、S4、S5 的票当选，在下标 2 写入任期 3 的另一条
(c) 任期 4    S1 重启当选，追加任期 4 条目，把下标 2 的旧条目复制到 S2、S3
              3/5 已有旧条目，但它不是当前任期的条目，仍不能提交
(d) 更高任期  S1 崩溃，S5 靠 S2、S3、S4 的票当选，用任期 3 的条目覆盖下标 2
(e) 如果 S1 崩溃前先让任期 4 的条目上多数派，旧条目随之间接提交，
    S5 日志比多数派旧，凑不齐票，无法当选
```

看什么：盯住下标 2 的任期和每一列的多数派；能不能提交取决于当前任期，而不是副本数。

在 (c) 里，下标 2 的旧条目已在多数派，但 S1 不能提交它；S5 在 (d) 里仍能靠 S2、S3、S4 当选并覆盖它。只有 (e) 先让任期 4 的条目上多数派，旧条目才随之间接提交；此时 S5 日志比多数派旧，选举限制（election restriction）让它拿不到票。

下面用 Figure 8 的五个状态走一遍；每换一步，先看 index 2 的 term，以及哪几个 server 有它。

<div class="anim" data-anim="raft-commit">
<p class="anim-fallback">这个动画需要 JavaScript；正文的步骤说明仍然完整。</p>
</div>

### 持久化：先落盘，再回复

Figure 2 规定，`currentTerm`、`votedFor` 和 `log[]` 改变后、回复远程过程调用（RPC）前必须写进稳定存储（stable storage）。顺序不能反：先回复 `RequestVote` 再持久化，重启后可能忘记自己投过票，在同一个任期投第二票，选出两个 leader。`commitIndex`、`lastApplied` 是易失状态，重启后从快照位置或 0 重建；`nextIndex`、`matchIndex` 在当选后重新初始化。`labgob` 只编码首字母大写的字段，字段名写错时持久化的内容会悄悄变成零值，重启后才表现为丢日志或重复投票。

### 快照：把日志前缀换成状态

状态机定期写快照，告诉 Raft“这个下标前的状态已包含”；Raft 截断日志，只留快照后的条目。`lastIncludedIndex` 是最后一个被包含的下标，不是下一个日志下标，`lastIncludedTerm` 用来支撑后续 `AppendEntries` 的前缀检查。

落后的跟随者（follower）需要 `InstallSnapshot`。leader 发现 `nextIndex[f]` 小于等于自己的 `lastIncludedIndex`，说明要发的日志已经被截掉，于是改发快照。follower 若在快照下标处有相同任期条目，就保留后缀；否则丢弃整条日志，用快照重置状态机，并把 `commitIndex`、`lastApplied` 跳到 `lastIncludedIndex`。lab 用 `applyCh` 把快照交给服务，服务只允许前进；3D 只要求一次 `InstallSnapshot` 发完整快照，不按偏移量（offset）分块，快照要和 Raft 状态一起 `persister.Save()`。

把快照安装和后续复制走一遍：

<div class="anim" data-anim="raft-snapshot">
<p class="anim-fallback">这个动画需要 JavaScript；正文的步骤说明仍然完整。</p>
</div>

### 客户端去重（client deduplication）：一个请求只执行一次

客户端给每个命令分配唯一 ID 和序列号；状态机在应用（apply）时记录每个客户端已执行到的序列号和结果。重试命令序列号不大于记录值时，直接返回缓存结果，不再执行。leader 在提交后、回复前崩溃，客户端换 leader 重试也不会产生第二次副作用；去重表必须进快照。

### 线性一致读：读也要有提交点

最简单的做法是把 `Get` 也写进日志：leader 等到这条 `Get` 提交并应用后回答。读和写排在同一个日志顺序里，线性一致读（linearizable read）自然成立；Lab 4 官方页说这样做就够了，不要求第 8 节的只读优化，代价是每次读都要复制和落盘。

更快的是读下标（ReadIndex）：leader 在任期开始时先提交一条空操作（no-op），拿到当前任期的 `commitIndex`，再向多数派发心跳确认自己仍是 leader，等 `lastApplied` 追上读下标，最后本地读。租约（lease）读依赖时钟偏移有界，进程长时间暂停时可能读到旧值；follower 直接读本地 map 也会落后。

### 走一遍带数字的流程

5 个 server，S1 是任期 7 的 leader，日志到下标 100。它在 100 做快照，`lastIncludedIndex = 100`，`lastIncludedTerm = 6`。follower S3 只有到 80 的日志，S1 的 `nextIndex[S3] = 81` 不超过 100，不能再发下标 81 的 `AppendEntries`，改发 `InstallSnapshot`。S3 安装后 `commitIndex = lastApplied = 100`，下一条 `AppendEntries` 带 `prevLogIndex = 100`、`prevLogTerm = 6`，从 101 继续。

再看去重。客户端 C7 的序列号 42 在下标 98 已应用，S1 在回复前崩溃；C7 重试到 S2，S2 的日志里也有下标 98，应用时查到 `(C7, 42)` 已执行，直接返回缓存结果。如果快照没包含这条记录，S3 恢复后不知道它执行过，C7 再重试时就会重复执行。

最后看提交。S2 在任期 9 当选，101 是任期 7 的旧条目，102 是任期 9 的 no-op；S2 先让 102 提交，101 才随之间接提交。

### 代价、边界和坏掉的样子

持久化不是免费的：每次任期、投票或日志变化都要落盘。快照会暂停状态机或需要写时复制（copy-on-write）；太频繁浪费磁盘，太稀疏则日志过长。`InstallSnapshot` 占用网络，快照越大，落后的 follower 追得越慢。

边界在“什么时候能省”。旧条目若在每个 server 上，可直接判定提交，Raft 选择保守。租约读依赖时钟；去重表可清理，规则要匹配客户端重试窗口。坏掉时：

- 提交旧任期条目，会覆盖已成功的值。
- 持久化顺序错，会出现同任期两个 leader。
- 快照下标混淆，会让 `applyCh` 倒退。
- 去重表漏进快照，会让 `Put` 执行两次。

### 和实验的关系

Lab 3 的 3B 对应复制和提交，`TestBackup3B` 检查 `nextIndex` 回退速度，`TestCount3B` 检查 RPC 数量；3C 的 `TestPersist13C` 到 `TestPersist33C` 和 `TestFigure83C` 覆盖重启；3D 的 `TestSnapshotBasic3D`、`TestSnapshotInstall3D` 检查快照。Lab 4 把它们拼成状态机复制（RSM）：`rsm.Submit` 等应用后返回，`Snapshot` 和 `Restore` 负责 4C，`TestSnapshotRPC4C` 检查快照和去重表。Lab 2 的版本号是单机版 at-most-once，Raft 的客户端 ID 加序列号是复制版去重。

### 检查一下自己

1. 为什么旧任期的条目在多数派上仍不能直接提交？
2. 持久化哪些状态，顺序是什么？
3. 快照的 `lastIncludedIndex` 和 `commitIndex` 有什么区别？
4. 客户端重试为什么不会执行两次？
5. 线性一致读有哪两条路，各依赖什么假设？

### 答案要点

1. 旧条目可能被更高任期的 leader 覆盖，Figure 8 的 (c) 到 (d) 是反例；要等当前任期的条目提交，旧条目才间接提交。
2. `currentTerm`、`votedFor`、`log[]` 先落盘再回复 RPC；`commitIndex`、`lastApplied` 不持久化；快照的下标、任期和数据要持久化。
3. `lastIncludedIndex` 是快照覆盖的最后一个下标；`commitIndex` 是已知提交的最高下标。安装快照后两者都跳到快照位置。
4. 客户端 ID 加序列号让状态机识别重复请求；已执行过就返回缓存结果。去重表要进快照。
5. 一条是把 `Get` 写进日志；另一条是 ReadIndex 加多数派心跳。租约读更快，但依赖时钟偏移有界。

**依据**：Raft 论文第 5.4.1、5.4.2、7、8 节，Figure 2、Figure 8、Figure 13；6.5840 官方 Lab 3 页的 3B–3D 说明和 Lab 4 页的 Part A/C 说明。

**作业**：[Lab 3](lab3.html) · [Lab 4](lab4.html) · [作业总览](labs.html)

## 第 8 讲：线性一致（Linearizability） {#lec8}

复制 KV 服务里，C1 在 10:00:00.100 发出 `Put(x, 1)`，10:00:00.140 收到成功；C2 在 10:00:00.120 发出 `Get(x)`，10:00:00.160 收到 0。两次调用重叠，C2 读到 0 可以解释成 `Get` 排在 `Put` 前面。换一个时间：C2 在 10:00:00.200 才发出 `Get`，仍然读到 0，而这段时间没有别的写。这个历史就坏了：`Put` 已经完成，之后的读必须看到 1。线性一致（linearizability）就是用来判断这类历史对错的。

### 历史、实时序和线性化点

把每个客户端操作记成两个事件：调用（invocation）和返回（response），中间是操作执行的时间段。一个历史（history）就是这些事件的序列。如果操作 A 的返回早于操作 B 的调用，就说 A 在 B 之前，记作 A <_H B，这个顺序叫实时序（real-time order）。两个操作的时间段重叠，就叫并发（concurrent），实时序不规定谁先谁后。

线性一致要求存在一个顺序：每个操作都在它调用和返回之间的某个瞬间生效，这个瞬间叫线性化点（linearization point）。按线性化点排出的顺序必须符合每个操作的语义，并且尊重实时序。符合语义的顺序历史叫合法顺序历史（legal sequential history）。用论文的话说，历史 H 可以扩展成 H'，complete(H') 等价于某个合法顺序历史 S，且 <_H 包含于 <_S。

调用后一直没有返回的操作，可以补一个返回事件算它生效，也可以当它没发生；complete(H') 就是删掉仍未返回的调用后的历史。定义允许这两种选择，所以客户端超时重试不会自动让历史非法。也不能用调用开始时间当线性化点。请求可能延迟到达，服务端无法知道更早的请求还会不会来；只要求在调用和返回之间某个瞬间生效，才可实现。

### 一个并发读写的时序

```text
时间(ms)  0    2    4    6    8   10   12   14   16
C1 Put(1) |=================|
C2 Get    |=========| -> 0
C3 Get                       |=========| -> 1
```

看什么：C2 和 C1 重叠，可以排在 C1 前；C3 在 C1 返回后才开始，必须排在 C1 后。

C1 在 0 到 10 之间执行，C2 在 2 到 6 之间执行，两者重叠。把 C2 的线性化点放在 3、C1 放在 5，C2 返回 0、C3 在 13 读返回 1，这是一个合法顺序。也可以把 C1 放在 3、C2 放在 5，C2 返回 1；两种都线性一致，因为并发操作可以任意排序。C3 在 12 才开始，晚于 C1 的返回 10，实时序要求 C1 排在 C3 前，所以 C3 必须返回 1。

把 C2 的开始时间改成 12，它仍然返回 0，这个历史就不线性一致：C1 已经完成，C2 在它之后开始，实时序要求 C2 看到 1，没有任何线性化点能同时满足这两条。另一种坏历史是 C2 先读到 1，C3 在 C2 返回后读到 0，期间没有写 0；值回退了，同样找不到合法顺序。

把上面两个历史放进同一条时间轴：

<div class="anim" data-anim="linearizability">
<p class="anim-fallback">这个动画需要 JavaScript；正文的步骤说明仍然完整。</p>
</div>

### 可组合，所以能按对象检查

线性一致是可组合的（composable）。论文的 Theorem 1 说：历史 H 线性一致，当且仅当对每个对象 x，限制在 x 上的子历史 H|x 都线性一致。证明思路是把每个对象的线性化顺序和实时序合在一起，构造一个偏序，再证明它无环，最后拓成全序。

这条性质让测试可以按 key 分片检查：Lab 4 的线性一致检查器可以把不同 key 的历史分开，再分别找线性化点。它也让系统可以由多个线性一致的对象拼起来，而不需要一把全局锁。要注意，组合性只保证单个对象上的操作；跨多个对象的业务不变量不在此列。

### 和可串行化差在哪

可串行化（serializability）约束的是事务：一个事务可以读写多个对象，历史要等价于事务按某个顺序串行执行，但这个顺序不必尊重实时序。线性一致约束的是单个对象上的单个操作，要求尊重实时序；论文把它看成严格可串行化（strict serializability）的特例，即每个事务只有一个操作、只碰一个对象。

两者的工程后果不同。可串行化可能阻塞、回滚、重启事务；线性一致是非阻塞的（nonblocking），读不会为了排序而等待别的事务。可串行化不是局部性质，两个对象各自可串行化，合起来未必可串行化；线性一致是局部性质。

举例：银行转账事务 T1 读 x、读 y、写 x、写 y，另一个事务 T2 也在 x、y 之间转账。每个 key 都线性一致，T1 仍可能读到 x 的新值和 y 的旧值，总和不对。要避免这种不一致，需要严格可串行化、两阶段锁或快照隔离加冲突检查；单 key 线性一致不够。

线性一致的代价是协调。跨副本的读要确认 leader 仍有效，或者把读写进日志；网络分区时，少数派可能无法服务。缓存和 follower 本地读更快，但会破坏实时序。

### 坏掉的样子

常见的坏法有五种。陈旧读（stale read）：读了一个落后的副本或缓存，写已经完成，读还返回旧值。读己之写失败：客户端写成功，紧接着读自己的写却读不到，通常是换了副本或连接。

值回退：先读到 1，之后没有写 0，却又读到 0。只检查最终值：测试结束时数据对了，但中间顺序错了，线性一致检查器能抓到，最终值比较抓不到。把可串行化当线性一致：事务之间没有实时序约束，读到的组合可能不合法。

### 和实验的关系

Lab 2 的 `Clerk.Put` 和 `Clerk.Get` 要求线性一致，`TestPutConcurrentReliable` 让多个客户端并发写同一个 key，`TestUnreliableNet` 在丢包和重发下检查读到的值；`Acquire` 和 `Release` 也靠同一套 KV 语义。Lab 3 的 `applyCh` 按 index 递增，给状态机一个全序，`TestFigure83C` 检查提交规则；但 `Start` 返回 index 和 term 不等于提交，读还要等应用。Lab 4 的 `TestPersistPartitionUnreliableLinearizable4B` 和 `TestSnapshotUnreliableRecoverConcurrentPartitionLinearizable4C` 会把客户端历史交给检查器；`rsm.Submit` 只在 `DoOp` 执行后返回，`Get` 也走日志，才有线性一致读。

### 检查一下自己

1. 一个读在写完成之后开始，却返回旧值，违反哪条？
2. 两个并发写都返回成功，怎么判断顺序？
3. 线性一致和可串行化最关键的区别是什么？
4. 为什么线性一致可以按 key 分别检查？

### 答案要点

1. 违反实时序。写的返回早于读的调用，读必须排在写之后，并看到写的效果；找不到这样的线性化点，历史就不线性一致。
2. 两个写并发，顺序可以任选；但后续读必须和选定的顺序一致，不能一个读看到 2、另一个更晚的读又看到 1。
3. 可串行化管多对象事务，不要求实时序，可能阻塞；线性一致管单对象单操作，要求实时序，非阻塞且可组合。
4. 因为线性一致是局部性质：整个历史线性一致，当且仅当每个对象的子历史都线性一致；检查器可以分片找线性化点，再合并。

**依据**：Herlihy & Wing 1990 第 2.2 节（定义 L1/L2）、第 3.1 节（Theorem 1，可组合性）、第 3.3 节（与可串行化比较）；6.5840 的 linearizability FAQ；6.5840 官方 Lab 2、Lab 4 页。

**作业**：[Lab 2](lab2.html) · [Lab 3](lab3.html) · [Lab 4](lab4.html) · [作业总览](labs.html)

## 第 9 讲：协调服务 ZooKeeper（ZooKeeper） {#lec9}

10:00:00.000，客户端 A 向领导者（leader）写 `/config`，把值从 v3 改成 v4；10:00:00.005，leader 提交，事务标识（zxid）为 0x20；10:00:00.006，A 收到成功。10:00:00.010，客户端 B 连到跟随者（follower）F，F 只应用到 zxid 0x1d，读 `/config` 仍然得到 v3。A 已经在消息里告诉 B“配置是 v4”，B 却读到 v3。ZooKeeper 允许这种陈旧读（stale read），因为它只对写做线性一致，读由各副本本地服务。要用好它，必须分清四个概念。

### znode 树、会话和监听

ZooKeeper 的数据模型是一棵树，每个节点叫数据节点（znode），存少量数据和版本号。znode 分普通节点和临时节点（ephemeral），创建时可加顺序标志（sequential）；临时节点在会话（session）结束时自动删除，顺序节点名带单调递增序号。会话有超时时间，客户端定期发心跳；会话可以在 server 之间迁移，新 server 要先追上客户端见过的 zxid。

```text
/
├── /config          (v3)
├── /workers
│   ├── w1           (ephemeral)
│   └── w2           (ephemeral)
└── /lock
    ├── lock-0001    (holder)
    ├── lock-0002    (watch 0001)
    └── lock-0003    (watch 0002)
```

看什么：临时节点随会话消失，顺序节点按序号排队。

监听（watch）由带标志的读操作注册，例如 `getData('/config', true)`。它只承诺一件事：信息变了会通知；通知不携带新值，客户端要重新读。触发一次后 watch 失效，会话关闭也会失效。服务端处理写时按顺序触发并清除通知，所以同一个会话不会先看到新状态、后收到通知。

### 写走 leader，读走本地

所有写请求都发给 leader。leader 执行请求，给它分配 zxid，再通过原子广播（ZAB，ZooKeeper Atomic Broadcast）发给 follower，多数派确认后提交，follower 按 zxid 顺序应用。读不经过 ZAB：每个 server 直接读本地数据库，并在回复里带上自己见过的最后一个 zxid。写有全序，读没有全序，这就是陈旧读的来源。

### 四个概念各管什么

论文第 2.3 节给了两条基本保证，并讨论了通知顺序；陈旧读是这套设计的缺口。下面把四个概念分开。

| 概念 | 管什么 | 不管什么 |
|---|---|---|
| 线性一致写（linearizable writes） | 所有写请求可序列化，并尊重实时先后 | 不覆盖读；并发写可任意排序 |
| 客户端 FIFO 顺序（FIFO client order） | 同一客户端的请求按发送顺序执行 | 不保证不同客户端之间的顺序 |
| 通知顺序（notification order） | watch 通知先于看到新状态；同一会话通知有序 | 不保证看到每一次变化，watch 会合并 |
| 陈旧读（stale read） | 读本地副本，可能落后 | 不保证读到最新写；需要同步（sync）或写后读 |

线性一致写说的是写与写之间：一个写完成后，后发的写必须排在它后面；并发写可以任意排序。它不保证读能看到最新的写，因为读根本不进 ZAB。

客户端 FIFO 顺序说的是同一客户端：先发的请求先执行。客户端换 server 时，新 server 要先追上它见过的 zxid，所以同一个客户端写完再读，至少能读到自己写的值；这不管别的客户端。

通知顺序说的是 watch：客户端注册监听后，如果节点变了，它一定先收到通知，再看到新状态；同一个会话的通知按顺序到达。watch 是一次性的，触发后要重新注册；如果节点在两次读之间变了三次，客户端可能只收到一次通知。

陈旧读不是一条正面保证，而是前面几条的缺口：读可能返回任意一个已提交的前缀，不一定是最后一个写。需要读最新值时，客户端可以先做一次写，或者调用同步（sync），让当前 server 应用完挂起的写，再做读。同步是慢读，不是全局屏障。

### 用 znode 做锁

经典做法是顺序临时节点。三个客户端 C1、C2、C3 在 `/lock` 下分别创建 `/lock/lock-0000000001`、`0002`、`0003`；序号最小的 C1 持有锁，C2 监听 C1 的节点，C3 监听 C2 的节点，而不是所有人都监听 `/lock`，避免羊群效应（herd effect）。C1 的会话超时设为 10 秒；它连续 10 秒没有心跳，ZooKeeper 删除它的临时节点，C2 收到通知，成为持有者。

如果 C1 只是被长时间 GC 暂停，它在 t=11 s 恢复后仍以为自己持有锁，但节点已经被删，C2 已经拿到锁。工程上，下游资源要用围栏令牌（fencing token）拒绝旧持有者，例如把 znode 的序号或 zxid 带进每次写，资源端只接受更大的令牌。ZooKeeper 的锁方案不解决暂停，它只保证序号最小的存活节点能拿到锁；暂停的旧持有者不在它的视野里。

### 代价、边界和坏掉的样子

写要过 leader 和多数派，延迟高于本地读；读可以水平扩展，但可能陈旧。watch 在服务端占内存，大量客户端监听同一个节点会有惊群风险；论文的锁方案用监听前驱来避免。会话超时太长，崩溃的客户端要很久才释放锁；太短，GC 或网络抖动会误判死亡。znode 默认每个最多 1 MB，不适合存大对象。

边界和失败模式很多。watch 触发后没重新注册，会永远等不到下一次变化；会话过期会让临时节点和锁消失；读 follower 后误以为线性一致。锁持有者暂停超过会话超时，会出现两个自认为持有锁的客户端；ZAB 没有多数派时写不可用，读仍可能返回旧值。论文的 API 子集里，跨多个 znode 的更新没有事务，条件更新只针对单个 znode 的版本。

### 和实验的关系

Lab 2 的锁是单机版：`Acquire` 用条件 `Put` 抢一个 key，`Release` 检查 owner；`TestManyClientsUnreliable` 在丢包下检查同一时刻只有一个持有者。它没有会话和临时节点，官方页也说明客户端不会崩溃。Lab 3 的 `applyCh` 按 index 递增，相当于 ZAB 的按序交付；`TestFigure83C` 检查提交规则。Lab 4 的 `rsm.Submit` 和 `DoOp` 是复制状态机，`Get` 走日志所以是线性一致读；ZooKeeper 的读可以本地服务，这一点比 Lab 4 弱。

### 检查一下自己

1. 为什么 ZooKeeper 的写线性一致，整体却不是？
2. FIFO 客户端顺序保证什么？
3. watch 保证什么、不保证什么？
4. 什么时候需要同步？
5. 锁持有者被暂停超过会话超时，会发生什么？

### 答案要点

1. 只有写进 ZAB，有全序；读由各副本本地服务，可能落后于最后一个提交的写，所以整体不是线性一致。
2. 同一个客户端的请求按发送顺序执行；换 server 时会追上客户端见过的 zxid，因此能读到自己的写，但不约束其他客户端。
3. 保证变化后先收到通知、再看到新状态，同一会话通知有序；不保证每次变化都通知，watch 一次性且会合并。
4. 另一个客户端写完，当前客户端要读最新值，而它连的副本可能落后时；同步让该 server 应用完挂起的写，再读。
5. 临时节点被删除，另一个客户端可能拿到锁；旧持有者恢复后仍可能自认为持有锁，下游要用围栏令牌拒绝它。

**依据**：ZooKeeper 论文第 2.1 节（znode、会话、watch）、第 2.3 节（写、FIFO、通知顺序与陈旧读）、第 4.2 节（ZAB 与本地读）、第 4.4 节（会话心跳与迁移）；6.5840 官方 Lab 2、Lab 4 页。

**作业**：[Lab 2](lab2.html) · [Lab 4](lab4.html) · [作业总览](labs.html)

## 第 10 讲：Lab 3 常见问题与调试（Lab 3 Q&A） {#lec10}

`TestPersist23C` 失败时，日志里出现两个任期 4 的领导者（leader）。S1 在重启前把票投给了自己，但 `persist()` 是在回复 `RequestVote` 之后才调用；重启后它忘了这一票，又投给了 S2。测试用 5 个 server、反复崩溃和分区把这个问题放大，最后同一个任期选出两个 leader。Raft 的 bug 大多不是算法不会写，而是某条规则漏了、某个状态没落盘、某把锁持有了太久。这一讲按 3A 到 3D 给出常见症状和排查路径。

### 按 3A 到 3D 加机制

3A 只做选举（election）和心跳（heartbeat），不复制日志；3B 加日志复制（log replication）和提交；3C 加持久化（persistence）；3D 加快照（snapshot）和 `InstallSnapshot`。每一部分都先跑单测，再跑全量；不要 3A 还没稳就做 3D，否则失败时无法定位。官方页给的顺序也是 3A、3B、3C、3D，测试名带对应的后缀。

### 3A：选举能跑，一加故障就乱

3A 的典型症状是选不出 leader、leader 频繁更换，或者 `TestReElection3A` 超时。先查选举超时（election timeout）是否随机：所有跟随者（follower）用同一个值会同时拉票，分票（split vote）反复发生。再查心跳是否超过每秒 10 次，以及 follower 是否只在合法 `AppendEntries` 上重置计时器；旧任期的 RPC 不能重置。

然后查收到更高任期是否立刻转 follower、清 `votedFor`，以及投票前是否比较候选人日志的最后一个任期和下标。`GetState` 返回的任期和 leader 标志也要和内部状态一致。`TestInitialElection3A`、`TestReElection3A` 和 `TestManyElections3A` 分别检查首次选举、旧 leader 失联后的重选，以及多次选举；先让它们在 `-race` 下稳定，再进 3B。

### 3B：能复制，冲突时退不回来

3B 的典型症状是 `TestBasicAgree3B` 不过、`TestBackup3B` 很慢，或者 `applyCh` 乱序。先查 `AppendEntries` 的 `prevLogIndex` 和 `prevLogTerm`：follower 在 `prevLogIndex` 处没有相同任期的条目时必须拒绝，不能先追加再截断。冲突时先截断冲突后缀，再追加 leader 的条目；`commitIndex` 只能前进。

提交只能数当前任期的副本，旧条目要等当前任期的新条目提交。如果 `applyCh` 乱序，先确认只有一个 goroutine 读它，并且按 `lastApplied + 1` 的顺序发送；持锁发送会阻塞整个 server。

`TestBackup3B` 慢，通常是 `nextIndex` 每次只退一格。让 follower 在拒绝时带回 `XTerm`、`XIndex` 和 `XLen`：leader 没有 `XTerm` 就把 `nextIndex` 设为 `XIndex`，有就设为自己该任期的最后一条加一，follower 日志太短就设为 `XLen`。

例如 S1 是任期 2 的 leader，日志是 `[1:1, 2:1, 3:2, 4:2, 5:2]`，`commitIndex = 5`；S2 的日志是 `[1:1, 2:1, 3:1]`。S1 先发 `prevLogIndex = 3`、`prevLogTerm = 2`，S2 拒绝并带回 `XTerm = 1`、`XIndex = 2`、`XLen = 3`。S1 在任期 1 的最后一条是下标 2，于是把 `nextIndex` 设为 3，重发 `prevLogIndex = 2`、`prevLogTerm = 1` 和下标 3 到 5 的条目；S2 截断下标 3，追加 3 到 5，`matchIndex` 变成 5，`commitIndex` 推进到 5，`applyCh` 依次送出 3、4、5。

```text
S1 (leader, term 2)  [1:1] [2:1] [3:2] [4:2] [5:2]   commitIndex=5
S2 (follower)        [1:1] [2:1] [3:1]

S1 -> prevLogIndex=3, prevLogTerm=2
S2 -> reject: XTerm=1, XIndex=2, XLen=3
S1 -> nextIndex[S2]=3
S1 -> prevLogIndex=2, prevLogTerm=1, entries=[3:2][4:2][5:2]
S2 -> truncate index 3, append 3..5, matchIndex=5
```

看什么：先对齐 `prevLogIndex`，再截断冲突后缀；回退一次跳过一个任期。

### 3C：重启后同任期两个 leader

3C 的典型症状是 `TestPersist13C` 能过，`TestFigure83C` 或节点反复进出（churn）测试挂掉；重启后同一个任期出现两个 leader，或者已提交的条目消失。先查持久化顺序：`currentTerm`、`votedFor`、`log[]` 每次改变后先落盘，再回复 RPC；不能先回复再落盘。

再查 `readPersist` 是否恢复了日志和投票，`commitIndex`、`lastApplied` 是否从 0 或快照位置重建。`labgob` 字段名小写会让编码丢字段，表现为重启后日志为空或任期归零。`TestPersist23C`、`TestPersist33C` 会扩大重启和分区；`TestUnreliableAgree3C`、`TestFigure8Unreliable3C` 和反复进出测试更容易暴露持久化窗口。

### 3D：快照之后 apply 倒退

3D 的典型症状是 `TestSnapshotBasic3D` 能过，`TestSnapshotInstall3D` 挂掉；服务收到比当前状态更旧的快照，`applyCh` 倒退，或者 follower 安装快照后下一条 `AppendEntries` 的前缀对不上。先查 `lastIncludedIndex` 的语义：它是快照覆盖的最后一个下标，不是下一个日志下标；安装后 `commitIndex` 和 `lastApplied` 都跳到这个下标。再查 leader 什么时候发 `InstallSnapshot`：只有 `nextIndex[f]` 小于等于 `lastIncludedIndex` 时才发，否则继续发日志。follower 安装时，如果本地日志在快照下标处有相同任期的条目，保留后缀；否则丢弃整条日志。

快照要通过 `applyCh` 交给服务，服务只允许前进；`persister.Save()` 要同时保存 Raft 状态和快照，重启后先读快照。`TestSnapshotInstallCrash3D`、`TestSnapshotAllCrash3D` 和 `TestSnapshotInit3D` 专门检查崩溃后的快照恢复。另一个常见问题是快照对象还被日志条目引用，Go 的 GC 回收不掉；截断日志时要把引用一起清掉。

### 调试路径

调试时先固定一个失败测试，用 `-run` 和 `-count=1` 只跑它，把输出重定向到文件。日志至少打印任期、状态、`votedFor`、`commitIndex`、`lastApplied`、`nextIndex`、`matchIndex`，以及每个 RPC 的参数和回复；不要用 `time.Sleep` 猜时序，用事件和日志还原。

第二步逐条对照 Figure 2，尤其是任期检查、投票规则、提交规则和持久化时机。第三步查锁：持锁时不要发 RPC、不要 `time.Sleep`、不要往 `applyCh` 发送；RPC 回复回来时任期可能已经变了，重新拿锁后要重新检查假设。第四步用 `-race` 跑；官方评分不带 `-race`，但开发时必须用，竞态（race）是 Raft 最常见的 bug。第五步看测试失败生成的时间线（timeline），确认事件顺序。

测试是抽样，不是证明；偶发失败要当成真 bug，连续跑三次再判断。3C 和 3D 在 `-race` 下可能跑好几分钟，`TestSnapshotInstall3D` 和 `TestSnapshotInstallUnreliable3D` 慢是正常的；官方页给的预算约 6 分钟实际时间，带 `-race` 约 10 分钟，单个测试超过 120 秒或全量超过 600 秒会判失败。

### 和实验的关系

Lab 4 会复用这份 Raft，4A 的 `TestRestartReplay4A` 和 4C 的 `TestSnapshotRPC4C` 容易暴露 3C/3D 的遗留问题；`rsm.Submit` 在 apply 后才返回，`Get` 也走日志，所以 Raft 的提交和快照错了，KV 的线性一致也会错。Lab 2 的 `ErrMaybe` 和版本号去重，会在 Lab 4 的 `Put` 重试里再次出现。`TestPersistPartitionUnreliableLinearizable4B` 还会用客户端历史检查线性一致；如果 Raft 偶发丢已提交条目，测试会表现为读到的值不对或超时。

### 检查一下自己

1. 3A 通过但 3C 失败，先查什么？
2. `TestBackup3B` 很慢，`nextIndex` 应该怎么退？
3. 快照之后 `applyCh` 倒退，查哪些下标？
4. 持锁发 RPC 会怎样？
5. 官方评分不带 `-race`，为什么开发时还要用？

### 答案要点

1. 先查持久化顺序：任期、投票、日志是否在回复 RPC 前落盘；再查重启后有没有正确恢复这些状态。
2. 让 follower 带回冲突任期、该任期第一个下标和日志长度；leader 一次跳过一个任期，而不是每次只退一格。
3. 查 `lastIncludedIndex`、`commitIndex`、`lastApplied`，以及快照的 `SnapshotIndex` 是否小于已经 apply 的下标；快照只能前进。
4. 网络慢时整个 server 卡住，两个 peer 互相持锁发 RPC 还会死锁；应该先释放锁，复制任期等参数，RPC 回来重新拿锁再检查。
5. 竞态在普通运行下可能不出现，评分时却偶发失败；`-race` 能定位共享状态的读写冲突，所以提交前必须跑。

**依据**：Raft 论文第 5.1–5.4、7 节，Figure 2、Figure 8、Figure 13；6.5840 官方 Lab 3 页（3A–3D 测试、时间上限、评分不带 `-race`）、Lab 4 页；`raft-structure.txt`、`raft-locking.txt`。

**作业**：[Lab 3](lab3.html) · [Lab 4](lab4.html) · [作业总览](labs.html)

## 第 11 讲：Distributed Transactions {#lec11}

### 一笔转账卡在 prepare 之后

账户 A、B 分处两个分片。客户端发起“A 扣 100、B 加 100”，两个分片各有自己的 leader，中间断电怎么办。单机数据库用一个本地事务就能解决；跨分片后，本地事务管不到另一个分片。系统需要一个跨多个分片的原子提交（atomic commit）协议。

### coordinator、participant 和两次投票

两阶段提交（two-phase commit, 2PC）把一次跨分片事务拆成两个阶段。coordinator（协调者）通常是被客户端选中的那个分片，也可以是独立进程；participant（参与者）是每个涉及的分片。第一阶段叫 prepare：coordinator 先写一条 prepare 日志，再问所有 participant“这个事务能不能提交”。participant 检查约束、锁住要改的行、把 prepare 记录写进日志，然后回复 yes 或 no。

```text
coordinator                 participant A        participant B
    |  prepare  ----------------> |                    |
    |  prepare  ---------------------------------------> |
    |  <------------------ yes    |                    |
    |  <----------------------------------------- yes   |
    |  commit   ----------------> |                    |
    |  commit   --------------------------------------> |
```

图注：看 prepare 和 commit 之间的空白。participant 已投 yes、锁住资源，却还不知道最终决定。

第二阶段做决定：所有 participant 都回 yes，coordinator 把 commit 写进日志，再发 commit。任何一个回 no，或者超时，coordinator 发 abort。participant 收到 commit 后执行修改、释放锁，收到 abort 后撤销并释放锁。正常路径两次网络往返，消息量随 participant 数量线性增长。

### 为什么 coordinator 一挂，participant 就只能等

关键在 participant 投出 yes 之后。它已经承诺“只要收到 commit 就执行”，并且把锁握在手里。如果它擅自 abort，而 coordinator 实际上已经决定 commit，另一个 participant 可能已经提交，原子性就破了。所以它只能等 coordinator 恢复，或者向其他 participant 打听决定。

coordinator 的日志是恢复的核心。只要它在发 commit 之前把决定落盘，重启后就能重发；如果它在写日志前崩溃，participant 可以安全地 abort。真正麻烦的是“决定已经做出、日志还没落盘”或者“coordinator 永久丢失”。后者在基本 2PC 里没有解，participant 会一直阻塞并占着锁。

### 3PC 和多副本各补了哪一半

三阶段提交（three-phase commit, 3PC）在 prepare 和 commit 之间加一个 pre-commit 阶段。它让 participant 能从其他人那里推断方向，减少阻塞。3PC 仍然假设网络延迟有上界；一旦分区，participant 还是可能卡住，所以它在工程里并不常见。

另一条路是把 coordinator 的决定本身复制出去。Paxos 或 Raft 先把“commit 这个事务”写进一条复制的日志，coordinator 挂了，新 leader 接着把决定做完。这里要分清两层：共识协议保证决定不丢，2PC 保证多个分片的修改一起生效。把 2PC 当共识协议，或以为 Raft 自动带来跨分片原子性，都是误解。

### 一个具体的崩溃点

三个 participant A、B、C，coordinator 已经决定 commit 并写进日志，然后依次发 commit。A 收到并提交；发到 B 时 coordinator 崩溃，C 还没收到。A 的状态是已提交，B、C 停在 prepared 状态。恢复后 coordinator 重发 commit，B、C 才跟上；在此之前，它们锁住的行不能被别的事务修改。

这里只给定性结论。2PC 的可用性取决于 coordinator 的恢复速度；participant 越多，阻塞期间被锁住的资源越多，但协议轮数不变。

把 prepare 到 commit 的崩溃点走一遍：

<div class="anim" data-anim="two-phase-commit">
<p class="anim-fallback">这个动画需要 JavaScript；正文的步骤说明仍然完整。</p>
</div>

### 失败模式和边界

participant 在 prepare 后崩溃，重启时必须能从日志找回锁和 prepare 记录；日志丢了，它可能重复执行或丢修改。coordinator 在做出 commit 决定后崩溃，participant 超时后不能擅自 abort，否则会出现部分提交。网络分区把 participant 分成两半时，2PC 不会自动选主，它只会阻塞。

2PC 只保证原子提交，不保证可串行化（serializability）；隔离级别来自锁或乐观并发控制。事务如果在第一次读之前就拿锁、持有到 commit，就是两阶段锁（two-phase locking），能提供可串行化。只在 prepare 时才拿锁，读阶段仍可能读到中间状态。

### 和实验的关系

Lab 5 的 shard 迁移是一个缩小版的原子提交：源组 freeze、目标组 install、配置发布，三步要么都完成，要么回滚。controller 崩溃后，新 controller 靠配置编号 `Num` 判断旧操作是否已经生效。`Num` 在这里扮演 coordinator 日志的角色，它让旧请求被拒绝，避免两个 controller 同时推进。

Lab 4 的 Raft 解决单个分片内的决定不丢，不解决跨分片原子性。把两者接起来，才是 Spanner 那类系统的形态。

### 检查一下自己

1. participant 投了 yes 之后，为什么不能自己超时 abort？
2. coordinator 在发 commit 之前崩溃，和发 commit 之后崩溃，恢复方式有什么不同？
3. 2PC 能保证可串行化吗？

### 答案要点

1. 它已经承诺执行 coordinator 的决定；擅自 abort 可能和已经提交的 participant 冲突，破坏原子性。
2. 前者可以安全 abort；后者必须等 coordinator 恢复或查询其他 participant，不能单方面放弃。
3. 不能。2PC 只保证原子提交；可串行化需要锁或 OCC 等并发控制，通常靠 prepare 阶段持锁到 commit 来实现。

**依据**：6.033 第 9 章（Atomicity: Two-Phase Commit）；6.5840 Lab 5 的 shard 迁移说明。

**作业**：[Lab 4](lab4.html) · [Lab 5](lab5.html) · [作业总览](labs.html)

## 第 12 讲：Spanner {#lec12}

### 一次跨洲下单，读到的是下单前

用户在东京下单，订单库在东京，库存库在加州。订单写成功，紧接着查库存，却读到下单前的数量。两个事务在真实时间上一前一后，数据库却给出了相反的顺序。Spanner 要解决的就是这件事：全球分片、跨洲复制，仍然让外部观察到的顺序和真实时间一致。

### TrueTime 把“现在”变成一个区间

Spanner 是 Google 的全球分布式 SQL 数据库，数据按 key 范围分成一个个分片（tablet）。每个 tablet 由一个 Paxos group 复制，跨 tablet 的事务用 2PC 提交。它对外提供外部一致性（external consistency），等价于严格可串行化（strict serializability）。事务的串行顺序既要满足可串行化，又要尊重真实时间。A 在 B 开始前提交，B 一定看到 A。

普通物理时钟有误差，两次读取可能回退。TrueTime 不返回一个点，而是一个区间 `[earliest, latest]`，保证真实时间落在这个区间里。`TT.now()` 返回当前区间，`TT.after(t)` 判断 t 是否已经过去，`TT.before(t)` 判断 t 是否还没到。区间的半宽记为 ε，Spanner 假设 ε 有上界，并由原子钟和 GPS 持续校准。

```text
真实时间  ----|----------|----------|----------|---->
                earliest    now       latest
事务时间戳 s = latest
commit-wait: 等到 TT.after(s) 为真，才让事务可见
```

图注：看 s 落在区间的右端。等右端过去，后面的事务再取时间戳，一定大于 s；代价是提交要等掉这段误差。

### 一个 tablet 一个 Paxos group，跨 tablet 再走 2PC

每个 Paxos group 有一个长期 leader，靠租约维持。写请求先由 leader 在 group 内复制一条 prepare 记录，再进入跨 group 的 2PC。跨 group 的事务，coordinator 通常是某个 group 的 leader。它给事务分配提交时间戳 s，等所有 participant prepare 成功，再写 commit 记录。最后做提交等待（commit-wait），直到 `TT.after(s)` 为真，才回复客户端。

读路径分两种。读写事务按时间戳加锁、复制；只读事务可以拿一个时间戳做快照读（snapshot read），不拿锁、不写日志，直接读该时间戳的一致性视图。快照读的关键是选时间戳。Spanner 用最后一次心跳或 `TT.now().latest` 之类的界，保证读到某个不超过当前时间的完整视图，不会读到未来的写。

### 提交要等时钟，故障也会传导

commit-wait 的代价是每次读写事务至少多等一个 ε 量级的时间。论文报告 ε 通常在 1–7 ms 量级，跨洲部署还会放大网络往返；这让 Spanner 的写延迟明显高于单区域数据库。TrueTime 失效时，Spanner 不能假装时间还有界，只能停止或延长等待，可用性让位于正确性。

跨 group 的 2PC 仍有 coordinator 崩溃阻塞的问题。Spanner 用 Paxos 复制 coordinator 状态来缩短阻塞窗口，但没有消除协调成本。热点 tablet 还会把负载集中到单个 Paxos group，靠分裂和负载均衡缓解，不能靠加机器立刻解决。

### 一个时间戳的例子

假设 T1 在 10:00:00.000 提交，TrueTime 给出的区间是 `[09:59:59.996, 10:00:00.004]`。T1 取 s = 10:00:00.004，等到 `TT.after(s)` 为真才可见。T2 在 10:00:00.005 开始，它拿到的时间戳一定大于 10:00:00.004，所以 T2 的快照包含 T1。没有 commit-wait，T2 可能拿到一个更早的时间戳，读到 T1 之前的状态。

时间是示意值，不是论文测量。要记住的是不等式：T2 的开始时间晚于 T1 的提交时间，T2 的时间戳就必须晚于 T1 的时间戳。

### 失败模式和边界

TrueTime 的误差变大，提交延迟上升；时钟回拨超过 ε，外部一致性被破坏，Spanner 假设这不会发生并持续监控。跨 group 的 coordinator 崩溃会让事务短暂阻塞；只读事务的时间戳选错，会读到未来或过期的快照。热点分片、区域故障、Paxos group 失去多数派，都会让对应 key 范围不可用。

### 和实验的关系

Lab 5 的 shardctrler 和 controller 是 Spanner placement driver 的简化版。配置有编号、分片有归属、迁移要停止旧服务再搬数据。Spanner 的 Paxos group 对应 Lab 5 的 shard group。跨 group 事务在 Lab 5 里没有实现，但配置变更本身就是一个需要原子提交的元事务。

### 检查一下自己

1. TrueTime 的区间怎么被用来分配时间戳和 commit-wait？
2. 外部一致性和线性一致、可串行化分别是什么关系？
3. 只读事务为什么可以不拿锁？

### 答案要点

1. 事务提交时间戳取 `TT.now().latest`，等 `TT.after(s)` 为真才可见，保证后续事务的时间戳更大。
2. 外部一致性等于严格可串行化，即可串行化加实时顺序；线性一致约束单个对象，两者不是同一个定义。
3. 它读一个固定时间戳的快照，快照本身是一致的；不修改数据，所以不需要锁，也不需要写日志。

**依据**：Spanner 论文第 3 节（TrueTime）、第 4.1–4.2 节（时间戳管理、读写与只读事务）；6.5840 Lab 5 说明。

**作业**：[Lab 5](lab5.html) · [作业总览](labs.html)

## 第 13 讲：Chain Replication {#lec13}

> 这一讲是导览，讲清“它解决什么问题、代价是什么”，不逐节推导论文。

### 写请求要走完整条链

三个副本排成 A、B、C。客户端把写发给 A，A 改完转发给 B，B 改完转发给 C，C 改完才回复客户端。读只能问 C。这个结构把“哪台副本最新”变成不需要协商的事实：C 见过所有完成的写。

### head、tail 和中间的转发者

链式复制（chain replication）把副本排成一条有序链。head 接收所有写，按顺序应用后转发给后继；tail 是链尾，只有它回复客户端；中间的副本只负责按顺序转发和应用。读请求只由 tail 服务，因为 tail 是最后一个应用写的人，它看到的状态就是所有已提交写的顺序结果。

```text
client -- write --> [head A] --> [B] --> [tail C] -- read --> client
                        ^                    |
                        |____ 失败时重配置 ___|
```

图注：看写和读走的是不同方向。写穿过整条链才返回，读只在 tail 一次完成；链越长，写越慢，读越省。

写必须经过每一跳，延迟随链长线性增长。读只碰 tail，延迟是一跳，但 tail 的读吞吐会成为瓶颈。

### 为什么读 tail 就够

强一致要求读返回最近一次完成的写。链式复制里，写只有在 tail 应用后才回复客户端，所以任何“已经完成”的写都已经过了 tail；tail 之后的读一定能看到它。读发给中间节点，可能还没收到最新写，就返回旧值。读集中到 tail，就不需要判断“副本是否最新”。

这个论证依赖一个前提：链的成员和顺序在配置里是确定的，客户端知道当前 tail 是谁。配置变更期间，旧 tail 和新 tail 可能同时认为自己该服务读。这时需要租约、配置服务或栅栏令牌（fencing token）把旧 tail 挡掉。

### 一个节点挂了，链怎么接回去

head 挂了，第二个节点接任 head；tail 挂了，前一个节点接任 tail；中间节点挂了，前一个直接指向后一个。故障检测通常由外部 master（主控）或配置服务做，发现节点失联后发布新配置。新 head 必须知道哪些写已经到达旧 tail，否则可能丢掉一个已经回复客户端的写。实践中让新 head 先跟旧 tail 或配置服务对齐，再接受新写。

恢复期间写暂停，读也可能暂停。任何一个节点故障，整条链都要重配置，不像 Raft 只要多数派还在就能继续。链越长，故障概率越高，重配置也越慢。

### 一个三节点的例子

A、B、C 三个副本，客户端写 `x=1`。A 应用后转发 B，B 应用后转发 C，C 写入成功并回复客户端。客户端读只问 C，得到 1。假设 B 在转发给 C 之前崩溃，A 已经应用、C 还没收到，客户端没收到回复，这个写算未完成。重配置后 A 直接连 C，把 B 没转发的写补上，或让客户端重试；已经回复的写不会丢，未回复的写可能丢。

这里只给定性结论。链式复制的写延迟是链长的函数，读延迟与链长无关；具体吞吐数字取决于网络和实现，不在讲义里编。

### 失败模式和边界

head 挂了，客户端还在重试旧 head；旧 head 如果没被 fencing，可能继续接受写，造成两个 head。tail 挂了，读暂时不可用；中间节点落后，整条链会被它拖住，形成队头阻塞。重配置时出现两个 tail，两个客户端可能读到不同状态。链太长，尾延迟高；链太短，容错能力弱。

### 和实验的关系

Lab 3 的 Raft 是另一条路线：leader 把日志复制到多数派，读可以由 leader 服务，故障时多数派还在就能继续。链式复制把“顺序”放在链的结构里，Raft 把“顺序”放在 term 和日志里；两者都要求配置变更时只有一个合法的服务点。Lab 5 的 shard group 用的是 Raft，但你可以把链式复制当成“读多写少、追求吞吐”时的另一种分片内复制方案。

### 检查一下自己

1. 为什么读 tail 能保证强一致，读中间节点不行？
2. head 和 tail 的故障恢复有什么不同？
3. 链式复制和 Raft 在可用性上的主要差别是什么？

### 答案要点

1. 写只有在 tail 应用后才回复客户端，tail 见过所有已完成的写；中间节点可能还没收到最新写。
2. head 挂了由后继接任，要确保旧 head 的写已经传到 tail；tail 挂了由前驱接任，新 tail 已经拥有全部已完成的写，但仍要用配置服务挡住旧 tail。
3. 链式复制任一节点故障都要重配置，写会暂停；Raft 只要多数派存活就能继续，容忍少数派故障。

**依据**：Chain Replication 论文（Renesse & Schneider, 2004）第 2 节及故障恢复部分；6.5840 课程页。

**作业**：[Lab 3](lab3.html) · [Lab 4](lab4.html) · [作业总览](labs.html)

## 第 14 讲：OCC / FaRM {#lec14}

> 这一讲是导览，讲清“它解决什么问题、代价是什么”，不逐节推导论文。

### 两个事务改了同一个账户

T1 读余额 100，准备写 90；T2 也读 100，准备写 80。两边都先读后写，最后余额可能只记一次扣款。悲观的做法是先锁住账户再读；乐观的做法是先读、先算，提交时再检查这期间有没有人改过。后者就是乐观并发控制（optimistic concurrency control, OCC），它把冲突检测推迟到提交，用重试换并发。

### 读、验证、写：OCC 的三段

OCC 把事务分成三个阶段。读阶段（read phase）里，事务读数据、把修改写进私有工作区，不碰共享状态。验证阶段（validation phase）检查读集是否被别人改过、写集是否冲突。写阶段（write phase）把工作区一次性安装到共享状态。验证失败就 abort，回滚工作区，从头重试。

```text
T1: 读 x=100 ---- 计算 90 ---- 验证 x 未变 ---- 写 x=90
T2:      读 x=100 ---- 计算 80 ---- 验证 x 已变 ---- abort
```

图注：看两条时间线在验证点的分岔。T2 的读发生在 T1 写之前，验证发生在 T1 写之后，所以它必须放弃；如果它先验证，T1 才会 abort。

验证通过后，写阶段必须是原子的，否则两个事务会同时写回。实现上要么验证时加锁，要么用比较并交换（compare-and-swap）把检查和写入合成原子操作。只检查不锁、检查完再慢慢写，冲突窗口又打开了。

### FaRM 把验证和写回压进一次 RDMA 往返

FaRM 是微软的内存事务系统，数据放在远端内存，用远程直接内存访问（RDMA）的单边读写作远程访问。客户端读对象时，用 RDMA READ 拿到对象和它的版本号。提交时，用 RDMA 原子操作锁住写集，重新读一遍读集做验证，通过后用 RDMA WRITE 写新版本，再解锁。primary 负责协调，backup 通过 RDMA 接收日志和副本，primary 挂了 backup 接管。

RDMA 绕过远端 CPU：客户端直接读写远端内存，不需要服务端线程，省掉上下文切换和网络栈处理。FaRM 把一次事务的读阶段压到一次往返，提交阶段也尽量压到一次往返，所以延迟能做到微秒级。代价是网络必须是 RDMA 网络、内存要注册、数据要能放进内存，故障恢复也要重新设计。

### 冲突率决定成败

OCC 适合冲突少的负载。冲突多时，大量事务在验证阶段 abort，重试又增加冲突，吞吐可能比加锁还低。FaRM 用“锁 + 版本号”减少浪费：写集先锁住，读集用版本号快速检查，冲突早发现早 abort。它还把只读事务做成无锁快照，避免读写互相干扰。

这里只给定性结论。FaRM 的收益来自 RDMA 和内存，不是来自 OCC 本身；同样的 OCC 放在普通网络上，往返延迟会把优势吃掉。

### 一个冲突的例子

T1 和 T2 都读 `x=100`，都想写 `x`。T1 先验证，读集里的 x 版本没变，通过，锁住 x，写 90，解锁。T2 后验证，发现 x 的版本从 v1 变成 v2，验证失败，abort；它重新读 x=90，再算 70，再提交。最终结果 70，两次扣款都生效，顺序是 T1 再 T2。如果 T2 先验证，T1 会 abort，顺序反过来，结果仍是 70；OCC 只保证存在一个串行顺序。

### 失败模式和边界

验证和写回不在一个原子步骤，会出现丢失更新。读集太大，验证成本高。冲突多时活锁或重试风暴。primary 在 backup 复制完成前崩溃，可能丢已提交事务。RDMA 内存注册或权限配置错误，直接读写失败。OCC 还假设事务之间能拿到一致的版本号，跨分片时这个假设要额外的协调来维持。

### 和实验的关系

Lab 4 的 KV 用 Raft 做悲观复制：先选出 leader，再按日志顺序执行，冲突在提交前就被顺序化。FaRM 是另一个极端：不选全局 leader，事务在客户端并发执行，提交时用版本号和锁解决冲突。两者都在回答“多个客户端同时改同一份状态怎么办”，只是一个先挡冲突，一个放到提交时。

### 检查一下自己

1. OCC 的三个阶段分别做什么，验证失败后发生什么？
2. 为什么验证通过后，写回还必须是原子的？
3. RDMA 为什么能降低事务延迟？

### 答案要点

1. 读阶段读数据、写私有工作区；验证阶段检查读集版本和写集冲突；写阶段安装修改。验证失败就 abort 并重试。
2. 否则两个事务可能同时通过验证、交错写回，产生丢失更新；验证和写回要合并成一个原子步骤。
3. RDMA 让客户端直接读写远端内存，绕过远端 CPU 和协议栈，减少一次往返和上下文切换。

**依据**：FaRM 论文（2015）第 2–4 节；OCC 原始论文（Kung & Robinson, 1981）。

**作业**：[Lab 4](lab4.html) · [作业总览](labs.html)

## 第 15 讲：Verification {#lec15}

> 这一讲是导览，讲清“它解决什么问题、代价是什么”，不逐节推导论文。

### 测试跑了一万次，还是没证明它对

一个 Raft 实现跑了十万次随机测试，选举、复制、重启都通过。某天有人在一条没被覆盖的交错里发现：leader 提交旧 term 条目时，日志被新 leader 覆盖。测试是抽样，随机种子和超时决定它看到哪些执行；验证要证明“所有可能的执行”都满足规格。

### 规格、实现和精化证明

规格（specification）是一个抽象状态机，例如“这个 KV 服务对每个 key 表现为一个线性一致的寄存器”。实现（implementation）是真正的代码，有锁、有日志、有网络。精化证明（refinement proof）建立两者的模拟关系：实现的每一步对应规格的一步，规格允许的行为实现都允许，不允许的实现也不会出现。

证明通常靠不变式（invariant）。不变式在初始状态成立，每一步之后仍成立；再证明它蕴含规格的安全性质。Raft 的“同一 term 最多一个 leader”“已提交的日志前缀不会被覆盖”都是这种形状。不变式写错，证明再漂亮也没有意义。

### TLA+ 穷举小模型，IronFleet 证到代码

TLA+ 用时序逻辑描述状态机，模型检查器 TLC 穷举有限状态空间找反例。三个 server、两个 term 的小模型，状态空间就已经很大；参数再大就跑不动。模型检查只说“小模型里没找到反例”，不是对所有规模成立的证明。

IronFleet 走得更远：用 Dafny 写实现和证明，机器检查每一步的精化关系。它验证了 IronRSL 和 IronKV，前者是 Paxos 系的复制状态机，后者是分片 KV；IronRSL 不是 Raft 的变体。它把协议层证明和实现层代码接起来，证明真正会被编译执行的代码。

```text
规格状态机:  S0 --op1--> S1 --op2--> S2
                \         \          \
实现状态机:  I0 --step--> I1 --step--> I2
             每一步都能映射到规格的一步；不变式在 I0..In 都成立
```

图注：看两条箭头之间的对应关系。精化证明不是“实现和规格长得一样”，而是“实现的每个行为都能被规格解释”。

### 证明覆盖不到的地方

规格本身可能写错。你证明了一个“允许返回旧值”的寄存器规格，实现当然正确，但用户要的是线性一致。模型和代码之间也可能有缝：编译器、运行时、网络库、操作系统，任何一层不在证明范围内，都可能破坏假设。IronFleet 假设节点 crash-stop、网络最终恢复；节点会撒谎，证明就不适用。

证明通常只覆盖安全性（safety），不覆盖活性（liveness）。安全性说“不会发生坏事”，活性说“好事最终发生”；后者要公平性假设和时序推理，成本更高。IronFleet 的证明以安全性为主，liveness 是否覆盖要回论文核对。

### 一个具体的反例

TLA+ 里描述一个两节点寄存器，允许读、写。模型检查器能找到一个执行：A 写 1，B 读 0，A 的写已经返回。这个执行违反线性一致，反例只有几步。改规格后反例消失，但这只说明小模型里没有反例。

验证的成本主要在写规格和维护证明。规格一变，证明要跟着改，工作量往往超过重新实现。

### 失败模式和边界

规格写错，证明了一个错的东西。模型和代码不一致，出现精化缝隙。状态空间爆炸，只验证了小模型。假设不现实，例如同步网络。只证安全不证活性。证明工具的信任边界也会影响结论。

### 和实验的关系

Lab 3 的测试用随机故障和超时检查 Raft，能发现具体 bug，但覆盖不了所有交错。写 Raft 时先写下不变式，再用测试撞它们，比“跑通就算对”更接近验证。Lab 4 的线性一致测试用 porcupine 检查历史，已经是“从执行记录反推规格”的轻量版本。

### 检查一下自己

1. 测试和验证各自能发现什么、发现不了什么？
2. 精化证明在证什么？
3. 为什么“模型检查通过”不等于“实现正确”？

### 答案要点

1. 测试抽样具体执行，能发现实现 bug，但覆盖不了未测试的交错；验证覆盖所有执行，但依赖规格和假设正确。
2. 证明实现的每一步都能对应到规格的一步，且不变式始终成立，从而把规格的安全性质转移到实现上。
3. 模型检查只穷举小模型；模型和代码之间还有编译器、运行时、网络等未验证的层，规格本身也可能写错。

**依据**：IronFleet 论文（SOSP 2015）第 2–4 节；TLA+ 官方文档（lamport.azurewebsites.net/tla/tla.html）。

**作业**：[Lab 3](lab3.html) · [作业总览](labs.html)

## 第 16 讲：Memcached at Facebook {#lec16}

> 这一讲是导览，讲清“它解决什么问题、代价是什么”，不逐节推导论文。

### 一个删除，为什么会被旧值盖回去

用户改昵称，应用先更新数据库，再删除缓存。一个读请求在删除之前就 miss 了，它去数据库读到旧昵称，回来准备写缓存；删除已经发生，它再把旧昵称写进去，缓存就比数据库旧，直到过期。这个窗口很短，但在每秒百万级请求的系统里，它一定会发生。

### lease 不是锁，是一次有期限的许可

Facebook 的缓存层用的是 Memcached，数据放在内存里，数据库是真相源。缓存最怕返回旧值，慢还可以忍。Facebook 给 memcached 加了租约（lease）：缓存 miss 时，服务器不只返回 miss，还返回一个 lease token。持有 token 的客户端去数据库读，回来用 token 写缓存。如果这期间有人删除或更新这个 key，token 失效，写会被拒绝。

lease 还解决惊群（thundering herd）。同一个 key 失效，成千上万个客户端同时回源数据库，数据库会被打垮。有了 lease，只有一个客户端拿到 token 去读，其他客户端等待或稍后重试。token 有有效期，持有者崩溃或网络卡住时，其他客户端不会永远等下去。

```text
client A:  Get(k) -> miss + token
           read DB (old value) ----------------------+
client B:  Delete(k) -> invalidate token               |
client A:  Set(k, old, token) -> rejected             |
           retry: Get(k) -> miss + new token -> read DB -> Set
```

图注：看删除发生在 A 的回源和写回之间。没有 token，A 的旧值会覆盖删除；有 token，写回被拒绝，A 必须重新读。

### 尾延迟会被 fan-out 放大

一次用户请求往往要访问很多个 memcached 服务器，每个 key 一次。假设单台 p99 是 1 ms，一百台里最慢的那台可能到几毫秒；请求要等所有分片返回，尾延迟（tail latency）被扇出（fan-out）放大。Facebook 的优化重点是减少必须等待的分片、给慢请求发备份请求（hedged request）、把热点 key 拆开。

缓存层的一致性也要按这个尺度看。缓存和数据库之间没有事务，应用要能容忍“缓存旧、数据库新”的短暂窗口；lease 缩短窗口，但不能消除。跨区域部署时，本区域读本地缓存最快，跨区域复制越慢，旧值窗口越大；要在延迟、一致性和成本之间选一个点。

### 一个具体的窗口

假设 A 的 `Get` 在 t0 返回 miss 和 token。t1 从数据库读到旧值，t2 应用执行 `Delete(k)`，t3 A 发 `Set(k, old, token)`。没有 lease 时，t3 的写成功，缓存从 t2 之后一直是旧值。有 lease 时，t2 让 token 失效，t3 被拒绝，A 重新走一遍 miss 流程，读到新值。具体的 lease 时长和失效规则要看论文实现。

### 失败模式和边界

缓存穿透：查一个不存在的 key，每次都打到数据库；缓存空值或布隆过滤器可以缓解。惊群：lease 过期或实现漏了 token 检查，大量客户端同时回源。热点 key：单个 key 的 QPS 超过单台 memcached 的能力，需要拆分或本地缓存。多区域复制延迟导致陈旧读（stale read）；lease 只能管住写回，管不住跨区域的复制滞后。

### 和实验的关系

Lab 2 的 version 和 `ErrMaybe` 是单机版的“防止旧写覆盖新写”：客户端带版本号，服务端只接受匹配的写。Memcached 的 lease 把这个思路放到缓存层：token 是版本号，删除是让旧版本失效。Lab 4 的去重表则解决另一个方向的问题：重复请求只执行一次。

### 检查一下自己

1. lease 怎么防止“旧值写回缓存”？
2. lease 怎么缓解惊群？
3. 为什么尾延迟比平均延迟更值得关注？

### 答案要点

1. 删除或更新会让 token 失效；持有旧 token 的客户端写回时被拒绝，旧值进不了缓存。
2. 一次 miss 只给一个客户端 token，其他客户端等待或重试，避免同时回源数据库。
3. 一个请求要等多个分片，最慢的分片决定总延迟；fan-out 越大，p99 被放大得越明显。

**依据**：Scaling Memcache at Facebook（NSDI 2013）第 3–4 节；The Tail at Scale（2013）。

**作业**：[Lab 2](lab2.html) · [作业总览](labs.html)

## 第 17 讲：AWS Lambda {#lec17}

> 这一讲是导览，讲清“它解决什么问题、代价是什么”，不逐节推导论文。

### 函数第一次被调用，为什么要等几百毫秒

你把一个函数部署上去，第一次调用要等几百毫秒甚至几秒，第二次就快了。这段等待叫冷启动（cold start）：平台要先找一台机器、创建隔离环境、启动运行时、加载代码，然后才执行 handler。Serverless 的卖点是“不用管服务器”，代价是平台要在多租户之间快速切换，还要为每次调用计费。

### microVM 把隔离做小，把启动做快

AWS Lambda 用微虚拟机（microVM）做隔离，具体实现是 Firecracker。每个函数实例跑在一个轻量 VM 里，VM 有独立的内核和内存，租户之间靠硬件虚拟化边界隔开；容器共享宿主内核，隔离弱一些，启动快一些。Firecracker 论文报告的最小启动时间是 125 ms，单实例内存开销约 5 MiB，这两个数字让它能在一台机器上塞进大量空闲实例。

冷启动分三段：调度和放置、沙箱启动、运行时和用户代码初始化。第一段是平台选机器、拉镜像；第二段是创建 microVM、挂载根文件系统；第三段是启动语言 runtime、执行初始化代码。热实例复用可以跳过前两段，只跑 handler；预置并发（provisioned concurrency）提前把实例准备好，用钱换延迟。

```text
冷启动:  调度/放置 ---> 创建 microVM ---> runtime init ---> 用户 init ---> handler
热调用:                                                              handler
快照恢复: 恢复内存镜像 -----------------------------> handler
```

图注：看三段各自的成本。调度和镜像拉取可能比 VM 启动更贵；快照恢复跳过中间两段，但恢复后的外部状态要重新对齐。

### 计费方式决定了复用策略

Lambda 按请求次数和“内存 × 执行时间”计费，执行时间按毫秒计。平台因此有动力把多个租户打包到同一台机器上，提高利用率；也有动力复用热实例，减少冷启动。复用和隔离是一对矛盾：复用越多，冷启动越少，但上一个请求留下的全局变量、临时文件、连接池、随机数状态，可能被下一个请求看到。

函数的执行环境会被冻结再解冻。冻结期间后台线程不跑，解冻后时钟跳变、TCP 连接可能已经断了、DNS 缓存可能过期。写函数时要假设“进程可能随时被暂停”，不要把关键状态放在内存里，不要依赖后台线程在两次调用之间继续工作。

### 一个具体的账

假设一个函数配置 1 GB 内存，每次执行 200 ms，一天调用 100 万次。计费时间是 100 万 × 0.2 秒 = 20 万 GB-秒，再乘单价。如果把内存降到 512 MB，执行时间可能变成 300 ms，计费是 15 万 GB-秒，反而更便宜。内存和 CPU 通常按比例分配，降内存会变慢，账单要看“内存 × 时间”的乘积，不是单看内存。

这是计费模型的算术示例，不是 AWS 的报价。具体单价和免费额度以官方定价页为准。

### 失败模式和边界

冷启动尾延迟：p99 被少数冷启动拉高，平均值看不出来。实例复用导致状态泄漏：全局变量、`/tmp`、数据库连接、随机种子。并发请求打到同一个实例：默认一个实例一次处理一个请求，但异步调用和重试可能叠加。快照恢复后时钟、连接、随机数状态不一致，外部副作用（已经发出的邮件、已经扣的款）不能靠恢复撤销。依赖包太大，镜像拉取变慢，冷启动更久。

### 和实验的关系

INFRA 02 的容器实验讲 namespace、cgroup、镜像层，那些是“进程级隔离”的工具。Lambda 这一讲把边界推到 microVM，让你看到隔离强度和启动成本怎么互相牵制。如果你做 agent runtime，沙箱、快照、恢复、外部副作用也是同一组问题：恢复一个进程容易，恢复它对外部世界做过的事很难。

### 检查一下自己

1. 为什么 Lambda 用 microVM 而不是普通容器？
2. 冷启动的三段分别是什么，哪一段最容易被优化？
3. 实例复用会带来哪些状态泄漏？

### 答案要点

1. microVM 提供硬件虚拟化边界，多租户隔离强于共享内核的容器，同时启动和内存开销足够小。
2. 调度/放置、沙箱启动、runtime 和用户代码初始化；镜像拉取和 runtime 初始化通常是大头，预置并发和快照恢复可以跳过。
3. 全局变量、临时文件、连接池、随机数、时钟和 DNS 缓存，都可能跨请求残留。

**依据**：Firecracker 论文（NSDI 2020）第 1–3 节；AWS Lambda 论文（arXiv:2305.13162）；AWS Lambda 定价页。

**作业**：[INFRA 02 · CN1](cloud-native.html#lab-cn1) · [作业总览](labs.html)

## 第 18 讲：Ray {#lec18}

> 这一讲是导览，讲清“它解决什么问题、代价是什么”，不逐节推导论文。

### 一个训练任务，卡在等对象上

你写了一个 Python 脚本：预处理数据、训练两个模型、合并结果。单机上顺序执行没问题；放到集群上，预处理和训练在不同节点，中间数据要跨网络传。哪个任务先跑、数据放在哪、某个节点挂了重算哪一段，这些是 Ray 要解决的问题。

### task 和 actor 是两种生命周期

Ray 把计算拆成两类。无状态任务（task）是一个远程函数，输入对象引用，输出对象引用，跑完就结束。有状态 actor（actor）是一个长期存在的对象，方法调用在它所在的进程里串行执行，状态留在内存里。task 适合并行处理，actor 适合维护模型参数、数据库连接、会话状态。

对象引用（object reference）是另一个核心。task 的返回值不直接传给下一个 task，而是先写进分布式对象存储（object store），下一个 task 拿到的是引用，运行时按需拉取。对象不可变，谁读过、谁写过一目了然；数据本地性调度让消费者尽量和对象同节点，减少网络传输。

```text
t1: preprocess(shard1) --o1--+
                             +--> t3: train(o1, o2) --o3--+
t2: preprocess(shard2) --o2--+                            +--> t4: merge(o3, o4)
t5: train(shard3) ----------------------------------o4--+
```

图注：看对象引用把任务连成有向无环图（DAG）。调度器先看依赖，再看对象在哪；一个节点失败，只需要重算丢失对象对应的 task。

### 对象存储和 lineage

Ray 的容错靠数据谱系（lineage）：每个对象记录它由哪个 task、哪些输入产生。节点失败，对象丢了，调度器沿着 lineage 往回找，重跑能重建它的 task。重算代价取决于链路长度和输入大小；上游若是很贵的训练任务，重算可能比重新跑还慢。

actor 不走 lineage。actor 的状态在进程内存里，进程挂了状态就没了；Ray 不会自动重算一个 actor，除非你显式重启并恢复 checkpoint。这是 task 和 actor 最重要的区别：task 可以重算，actor 只能恢复。对象存储也要考虑容量，对象太大时会溢写到磁盘或远端，拉取延迟上升。

### 调度看的是依赖和本地性

Ray 的调度器分层：每节点一个本地调度器，全局调度器负责跨节点放置。任务提交时带资源需求（CPU、GPU、内存），调度器找满足条件且有输入对象的节点；放不下就排队，排队太久可能溢出到其他节点。GPU 任务还要考虑显存和拓扑，调度不好会让 GPU 空转。

资源死锁是常见故障：一个 task 占着资源，等另一个 task 的输出，而那个 task 在等它释放资源。Ray 不自动检测这种环，应用要把大任务拆小，或者给嵌套任务预留资源。

### 一个 lineage 重算的例子

四个 task：t1、t2 各处理一个分片，产出 o1、o2。t3 消费 o1、o2，产出 o3。t4 消费 o3 和另一个 train 的输出 o4。如果存放 o1 的节点挂了，Ray 发现 o1 丢失，查 lineage 得知 o1 由 t1 产生，于是重跑 t1。t3 如果还没跑，等 o1 重建后再跑。t3 如果已经跑完并且 o3 还在，就不需要重跑 t3。重算只沿丢失对象的上游找，不会重跑整个 DAG。

这里只给定性结论。lineage 重算适合幂等、可重放的 task；有外部副作用的 task 重算会重复执行，需要应用自己去重。

### 失败模式和边界

对象太大，传输和存储成为瓶颈。actor 崩溃，状态丢失。lineage 重算风暴，一个节点失败引发大量重算。资源死锁。数据本地性差，GPU 等数据。driver 崩溃，整个作业失去协调者。Ray 的 object store 不是数据库，不提供持久化保证，关键结果要自己 checkpoint 到外部存储。

### 和实验的关系

INFRA 03 的 agent runtime 也要调度任务、传对象、处理失败。Ray 的 task/actor 二分可以直接借用。工具调用是无状态 task，会话和模型状态是 actor。lineage 对应“这个结果由哪次调用产生”的审计记录。区别在于 agent 的 task 往往有外部副作用，重算不能像纯函数那样随意。

### 检查一下自己

1. task 和 actor 的区别是什么，各自适合什么场景？
2. lineage 怎么恢复失败的任务，代价在哪里？
3. 为什么对象存储要用不可变对象？

### 答案要点

1. task 无状态、可重算、适合并行；actor 有状态、方法串行执行、适合长期存在的对象，崩溃后要靠 checkpoint 恢复。
2. 对象丢失时沿 lineage 找到产生它的 task，重跑重建；代价是上游计算和输入数据，链路越长越贵。
3. 不可变对象让引用和版本明确，读不需要锁，失败时可以安全重算，也方便做本地性调度。

**依据**：Ray 论文（OSDI 2018）第 3–4 节；Ray 官方文档的对象与 lineage 说明。

**作业**：[INFRA 03 · AOS1](agent-os.html#lab-aos1) · [作业总览](labs.html)

## 第 19 讲：SUNDR {#lec19}

> 这一讲是导览，讲清“它解决什么问题、代价是什么”，不逐节推导论文。

### 服务器说“你看到的是最新版”

你把文件存在云盘上，服务器告诉你“这是最新版本”。它完全可能对客户端说谎：给 Alice 看一个版本，给 Bob 看另一个版本，两人都以为自己看到最新版。客户端没有服务器的 root 权限，怎么发现？SUNDR 研究的就是“服务器不可信”的存储系统。

### 签名链和版本向量

SUNDR 让客户端给每次操作签名，服务器只负责存储和排序，不能伪造。每个版本包含前一个版本的 hash，形成一条签名链（signature chain）；客户端拿到新版本时，验证链是否从上次看到的版本接上来。接不上，就是分叉。

版本向量（version vector）记录每个客户端最后看到的位置。Alice 的向量是 `{Alice: 5, Bob: 3}`，Bob 的是 `{Alice: 4, Bob: 3}`。两个向量不可比较，说明他们看到的历史已经分叉。客户端把向量带在请求里，服务器返回的版本必须包含这些位置。

```text
            Alice 看到的分支
           /---- v5(A) ---- v6(A)
v4 -- fork
           \---- v5(B) ---- v6(B)
            Bob 看到的分支
```

图注：看分叉（fork）点之后两条链各自生长。服务器可以维持两个都自洽的分支，但 Alice 和 Bob 一旦交换版本向量，就会发现对方的链不在自己的祖先里。

### fork consistency 到底保证了什么

SUNDR 的保证叫分叉一致性（fork consistency）：两个客户端看到的历史一旦分叉，之后永远看不到对方的分叉。它比线性一致弱：线性一致要求所有客户端看到同一顺序；fork consistency 允许暂时欺骗，只要求留下痕迹。

要发现分叉，客户端之间要比较版本向量，或依赖带外通道。单个客户端只能验证自己的链自洽，不能验证世界上没有另一个分支。这里最容易误解：它不保证服务器不作恶，只保证作恶不能被无限期隐藏。

### 它不防什么

服务器可以回滚（rollback）：给刚上线的客户端看很旧的版本，只要版本自洽，客户端就发现不了。服务器还能删除文件、拒绝服务、做流量分析；签名链不提供机密性，内容要另外加密。客户端密钥泄漏，攻击者可以伪造该客户端的签名，链的保证随之失效。

fork consistency 也不保证实时性。服务器可以延迟某个客户端的更新，让它看到旧状态；只要不分叉，就不违反定义。要实时保证，得把版本号写到外部可信锚点之类的机制里。

### 一个分叉的例子

Alice 写 `x=1`，服务器把这条写只放进 Alice 的分支；Bob 读 `x`，服务器给他看另一个分支，返回 0。两人各自验证签名链，都没发现问题。之后 Alice 写 `x=2`，Bob 再读还是 0；直到两人交换版本向量，发现彼此的链里都有对方没见过的版本，分叉暴露。暴露后，两人知道服务器不可信，但已经发生的写无法自动合并。

SUNDR 的检测依赖客户端通信，检测延迟取决于多久交换一次版本。不通信的客户端可能长期被蒙在鼓里。

### 失败模式和边界

服务器回滚到旧版本。对不同客户端展示不同分支。客户端离线太久，版本链无法合并。密钥管理和签名性能也是负担。只保证 fork consistency，不保证线性一致或实时性。部署还要考虑多设备同步、冲突解决和元数据膨胀。

### 和实验的关系

INFRA 03 的审计日志用哈希链记录 agent 的每一步操作，思路和 SUNDR 的签名链同源：让服务器不能悄悄改写历史。区别是审计日志通常还有可信锚点（例如定期发布根 hash），否则链本身只能保证“自洽”，不能保证“没有分叉”。如果你做可验证执行记录，先想清楚谁来验证、验证者之间怎么交换视图。

### 检查一下自己

1. fork consistency 的定义是什么，它比线性一致弱在哪里？
2. 单个客户端能发现服务器分叉吗？
3. SUNDR 不防哪些攻击？

### 答案要点

1. 两个客户端看到分叉后，永远看不到对方的分支；它允许服务器暂时欺骗，只保证分叉永久且可检测，线性一致要求所有客户端看到同一顺序。
2. 不能。单个客户端只能验证自己的链自洽；要发现分叉，需要和另一个客户端比较版本向量，或依赖带外锚点。
3. 回滚、删除、拒绝服务、流量分析；密钥泄漏后签名也可伪造。

**依据**：SUNDR 论文（OSDI 2004）第 2–4 节。

**作业**：[INFRA 03 · AOS5](agent-os.html#lab-aos5) · [作业总览](labs.html)

## 第 20 讲：Bitcoin {#lec20}

> 这一讲是导览，讲清“它解决什么问题、代价是什么”，不逐节推导论文。

### 一笔付款，等六个区块才算数

你买一杯咖啡，用比特币付款，商家要等六个确认才发货。六个区块约一小时，期间交易可能被回滚。没有银行、没有仲裁，一群互不认识的节点靠什么同意“这笔钱已经付了”？比特币的答案就是工作量证明（proof-of-work, PoW）和最长链。

### PoW 用算力买投票权

矿工把待确认的交易打包成区块，再加一个随机数（nonce），反复计算区块 hash，直到 hash 小于目标值。找到的人广播区块，其他人验证 hash 和交易合法性，然后在这个区块后面继续挖。找到合法区块的概率和算力成正比；改写历史要重新挖出更长的链，成功率随确认数指数下降。

难度会调整：全网算力上升，出块变快，协议就把目标值调小，让平均出块时间回到约 10 分钟；比特币每 2016 个区块调整一次难度，约两周。这让“一个区块”成为稳定的时间单位，也让攻击成本可以估算。

```text
创世 -- b1 -- b2 -- b3 -- b4 -- b5 -- b6
                  \
                   b3' -- b4'   （更短的非法分支，被丢弃）
```

图注：看主链和分叉的累计工作量。矿工总是接在累计工作量最大的链后面；短分叉即使先出现，也会被更长的那条取代。

### 最长链其实是累计工作量最大

“最长链”是简称，准确规则是累计工作量最大的链。一个区块的权重按它包含的难度算，不按区块个数算；短链如果难度更高，也可能胜出。节点收到新块时，看它是否延长已知累计工作量最大的链，是就切换，不是就暂存；分叉通常在下个块出现时解决。

确认数（confirmation）是概率最终性（probabilistic finality）的度量。交易在区块 b 里，后面跟 z 个块，被回滚的概率随 z 增加而下降，但永远不为零。论文第 11 节给出 q（算力占比）和 z 的成功概率表：q=0.1、z=5 时大约千分之一；q 越大，同一 z 的概率上升。商家等六个确认，是在用延迟换确定性。

### 51% 和它的边界

如果攻击者掌握超过一半算力，他可以持续挖一条私有链，追上并超过公开链，从而双花（double spend）。51% 是“能稳定改写历史”的阈值，不是“能偷币”的阈值：他没有私钥，不能花别人的钱，但可以让自己的付款先确认再回滚。自私挖矿（selfish mining）等策略能在低于 51% 时获得额外收益，说明“算力多数”不是唯一假设。

比特币不提供即时最终性，不适合低延迟支付；它用经济激励替代身份认证，节点可以自由加入退出，代价是能耗和吞吐。轻客户端只下载区块头，靠 SPV 验证交易包含，安全性弱于全节点。

### 和 Raft/PBFT 的边界

Raft 假设节点只崩溃、不撒谎，成员固定，选出一个 leader 后日志顺序确定。比特币假设节点可能作恶，成员开放，没有固定 leader，用算力竞争出块。PBFT 用 3f+1 个副本容忍 f 个拜占庭节点，适合小规模许可链；比特币用 PoW 在开放网络里概率性地达成一致。三者解决的不是同一个问题，别拿“比特币更去中心化”否定 Raft 的确定性，也别拿 Raft 的延迟要求比特币。

### 失败模式和边界

51% 算力攻击；自私挖矿和分叉；交易池拥塞，手续费波动；轻客户端验证不足；确认数不够就当最终；矿池集中。协议参数也影响吞吐和传播延迟，是工程取舍。

### 和实验的关系

Lab 3 的 Raft 只处理崩溃故障，节点不会发矛盾消息；比特币和下一讲的 PBFT 把故障模型推到拜占庭。你写的 `AppendEntries` 检查、投票规则，在拜占庭模型下都不够用，因为 follower 可能撒谎。理解这一点，比记住“51%”这个数字更重要。

### 检查一下自己

1. 为什么 51% 是改写历史的阈值？
2. 什么是概率最终性，确认数怎么影响它？
3. 比特币和 Raft 的故障模型有什么不同？

### 答案要点

1. 超过一半算力可以比诚实网络更快地挖出更长的链，追上并取代已公开的链，从而回滚交易。
2. 交易被回滚的概率随确认数增加而下降但不会到零；确认越多，攻击者需要追赶的区块越多，成本越高。
3. Raft 假设 crash fault、成员固定；比特币假设 Byzantine fault、成员开放，用 PoW 概率性达成一致。

**依据**：Bitcoin 白皮书第 4、5、11 节；6.5840 课程页的 Bitcoin 阅读。

**作业**：[作业总览](labs.html)

## 第 21 讲：Byzantine Fault Tolerance {#lec21}

> 这一讲是导览，讲清“它解决什么问题、代价是什么”，不逐节推导论文。

### 三个副本里有一个在撒谎

Raft 里，节点要么正常、要么崩溃，崩溃的节点不说话，活着的节点说真话。真实系统里还有第三种：节点活着，但发矛盾的消息，给 A 说“我投了 x”，给 B 说“我投了 y”。这可能是 bug、被入侵，也可能是恶意。拜占庭故障（Byzantine fault）要求协议在节点撒谎时仍然正确，代价是更多副本和更多消息。

### 3f+1 是从哪来的

实用拜占庭容错（PBFT）用 3f+1 个副本容忍 f 个拜占庭节点。直觉是：n 个副本里最多 f 个坏节点，诚实副本有 n-f 个；要能在有 f 个坏节点时凑出 2f+1 个副本的多数派，需要 `n - f >= 2f+1`，即 `n >= 3f+1`。另一方面，n=3f+1 时任意两个 2f+1 多数派的交集至少 `2(2f+1) - (3f+1) = f+1` 个节点，其中至少一个诚实，坏节点不能在两处说不同的话。

n=4、f=1 时，每个多数派 3 个副本，任意两个多数派至少交 2 个，其中至少 1 个诚实。n=3、f=1 时，2f+1=3，一个多数派要包含所有副本；只要有一个副本坏了，诚实副本就凑不齐 3 个，协议停摆。这不是保守，是数学。

### 三阶段和 2f+1 个一致回复

PBFT 的正常路径分三阶段。pre-prepare：primary 给请求分配序号，广播给所有 backup。prepare：backup 检查序号和视图，广播 prepare。commit：副本收到 2f+1 个匹配的 prepare（包括自己）后，广播 commit。收到 2f+1 个 commit 后执行请求，把结果发给客户端。客户端等 f+1 个相同回复，就认为结果确定。

```text
client --request--> primary
primary --pre-prepare(n)--> all backups
backups --prepare(n)------> all
backups --commit(n)-------> all
all --reply-------------> client   （等 f+1 个一致回复）
```

图注：看每个阶段都要求“同一序号、同一视图”的一致消息。坏节点可以缺席或发矛盾消息，但凑不出 2f+1 个一致的好消息。

视图切换（view change）在 primary 坏掉时换主。backup 发现 primary 沉默或作恶，广播 view-change，带上自己见过的 prepared 证书。新 primary 收集 2f+1 个 view-change，重新提议那些可能已经提交的请求，保证已提交的请求不被丢掉。view change 本身也可能被坏节点拖延，所以 PBFT 的活性依赖网络最终同步。

### 成本：消息是 O(n²)

每个副本都要向所有副本广播 prepare 和 commit，消息数是 O(n²)；n=4 时每个阶段约 16 条消息，n=20 时就是 400 条。Raft 的一次日志复制是 O(n)，PBFT 用消息量换拜占庭容错。除此之外还有签名验证、视图切换、checkpoint 的开销，所以 PBFT 适合小规模、已知成员的联盟链或许可链，不适合开放公网。

这里只给定性结论。PBFT 的性能随 n 增长迅速下降，具体吞吐取决于实现、签名算法和网络，不在讲义里编数字。

### 一个坏 primary 的例子

n=4、f=1，primary 是坏的。客户端发请求，primary 给副本 A 发序号 1，给副本 B 发序号 2，试图让两笔请求都执行。A 和 B 各自收到 pre-prepare，但 prepare 阶段会暴露矛盾。诚实副本只接受同一视图、同一序号的一个请求，2f+1 个一致 prepare 凑不齐，两个请求都无法 commit。客户端超时后触发 view change，换掉 primary，请求重新走一遍。坏 primary 能拖慢系统，但不能让两个冲突的请求都提交。

### 失败模式和边界

坏节点发送矛盾消息。primary 作恶或沉默，view change 卡住。副本数不足 3f+1。消息认证不完整，攻击者伪造视图。网络异步时活性不保证。PBFT 假设消息最终送达、签名不可伪造，这两条在真实部署里要靠 TLS、密钥管理和超时重传保证。

### 和实验的关系

Lab 3 的 Raft 只处理崩溃故障：节点不会撒谎，所以 leader 可以只靠多数派日志就确定顺序。PBFT 把“节点可能撒谎”加进来，副本数从 2f+1 提到 3f+1，消息从 O(n) 提到 O(n²)。如果你做联盟链或跨组织的协调服务，先问清楚成员是否可信；如果可信，Raft 更便宜。

### 检查一下自己

1. 为什么 PBFT 需要 3f+1 个副本？
2. prepare 和 commit 各解决什么问题？
3. primary 作恶时，view change 怎么保证已提交的请求不丢？

### 答案要点

1. 两个 2f+1 多数派的交集要有至少一个诚实节点，n 必须大于 3f，所以至少 3f+1。
2. prepare 让副本对序号和视图达成一致，排除 primary 给不同副本发不同请求；commit 让副本知道多数派已经准备好，可以执行。
3. 新 primary 收集 2f+1 个 view-change，里面带有 prepared 证书，重新提议可能已提交的请求，保证它们不被跳过。

**依据**：PBFT 论文（Castro & Liskov, OSDI 1999）第 4 节；6.5840 课程页的 Byzantine fault tolerance 阅读。

**作业**：[作业总览](labs.html)

## 第 22 讲：Project demos {#lec22}

> 这一讲是导览，讲项目展示怎么准备；不涉及新机制。

### 演示当天，最怕的是“它平时是好的”

你花了三周写了一个分片 KV，测试全绿。演示时你启动集群，输入一个 `Put`，返回正确；再输入一个 `Get`，也正确。评委问“如果 leader 现在挂了会怎样”，你关掉一个节点，客户端卡住，你开始翻日志。项目展示考的不是顺利路径（happy path），而是你有没有想过系统会在哪里坏。

### 十分钟里只讲三件事

项目展示只讲三件事：问题是什么、系统怎么工作、你验证了什么。问题要具体到“现有方案在什么场景下不够用”，不要从“分布式系统很重要”讲起。系统怎么工作，用一张架构图和一条关键路径的时序，把写路径、读路径、失败路径各走一遍；不要念代码，代码留在仓库里。

验证部分是得分点。至少给一组失败注入（failure injection）结果，覆盖杀掉 leader、断开网络、让一个节点在提交中途崩溃、把磁盘写满、让 lease 过期这些情况。每一组写清楚“预期现象、实际现象、怎么恢复”。如果某个故障下系统不可用，就直说不可用，并解释为什么这个代价可以接受。

```text
0:00  问题与反例
2:00  架构图：写路径 / 读路径
4:00  关键路径时序
6:00  失败注入：杀 leader、分区、崩溃恢复
8:00  边界：不保证什么，代价是什么
9:00  提问
```

图注：看失败注入占的时间。它单独占两分钟，说明失败演示是主线的一部分。

### 怎么演示失败

失败演示要可重复。提前写好脚本：启动几个进程、灌入固定数据、执行固定操作、在固定时间点杀进程；每次演示前跑一遍，确认现象一致。不要依赖“手动点一下”，也不要把演示绑在外部服务或真实凭证上，网络抖一下、token 过期，演示就废了。

演示失败时，先讲预期，再操作，最后对照日志。例如“我现在杀掉 leader，预期 5 秒内选出新 leader，客户端重试后成功。如果 5 秒内没选出来，说明 election timeout 或投票规则有问题”。把失败当成实验。评委更愿意看到一个你能解释的失败，假装没发生反而扣分。

### 边界比功能更加分

讲清楚“不保证什么”：单机持久化没做、跨分片事务没做、snapshot 只覆盖 KV 不覆盖去重表、controller 崩溃后迁移可能重做。每一条边界配一句“如果要补，下一步做什么”。这比列十个 feature 更能说明你真的理解系统。

也要讲代价：多副本带来写延迟，2PC 带来阻塞，缓存带来旧值窗口，microVM 带来冷启动。一个设计如果没有代价，通常是你还没看到它的边界。

### 和实验的关系

Lab 1 到 Lab 5 已经给了你一套可复用的展示素材，包括 MapReduce 的失败重跑、Raft 的选举和日志回退、KV 的线性一致、分片迁移的 freeze/install。项目不需要发明新协议，把其中一个实验扩展成一个有明确问题、有失败注入、有边界说明的小系统，就足够。

### 检查一下自己

1. 项目展示的三件事是什么？
2. 怎么设计一组可重复的失败注入？
3. 为什么讲边界比列功能更加分？

### 答案要点

1. 问题是什么、系统怎么工作、你验证了什么；验证里要包含失败注入，不只 happy path。
2. 固定环境、固定数据、固定操作、固定故障时间点，写成脚本，每次演示前重跑，确保现象可复现。
3. 边界说明你知道系统在哪里不成立、代价是什么、下一步怎么补，这比功能列表更能证明理解。

**依据**：6.5840 final project 页面；Lab 1–5 的测试与失败注入说明。

**作业**：[作业总览](labs.html)
