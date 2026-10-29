# Lab 3 · Raft

> **课程**：[INFRA 01 · 分布式系统](course-map.html) · **实验 3/5**
>
> **先读**：[第 6 讲 Raft (1)](lectures.html#lec6)、[第 7 讲 Raft (2)](lectures.html#lec7)、[第 8 讲 线性一致](lectures.html#lec8) 和 [第 10 讲 Lab 3 Q&A](lectures.html#lec10) · **参考**：[官方实验页](https://pdos.csail.mit.edu/6.5840/labs/lab-raft1.html) · [Raft 论文](https://raft.github.io/raft.pdf) · [中文翻译](https://github.com/maemual/raft-zh_cn)
>
> **评分**：`LAB_ROOT=~/labs/6.5840 ./judge/run.sh infra01 lab3` · [评分标准](grading.html)
>
> [上一个：Lab 2](lab2.html) · [返回作业](labs.html) · [下一个：Lab 4](lab4.html)
>
> **对照**：Raft 论文 Figure 2、`raft-structure.txt`、`raft-locking.txt`（可选）。

## 你将完成什么

改完 `raft1/raft.go`，在 `src` 下按部分跑：

```bash
cd ~/labs/6.5840/src
make RUN="-run 3A" raft1
make RUN="-run 3B" raft1
make RUN="-run 3C" raft1
make RUN="-run 3D" raft1
```

四组共 28 个测试：3A 3、3B 10、3C 8、3D 7。官方样例的收尾分别是 `ok 6.5840/raft1 22.095s`、`71.716s`、`180.983s`、`301.406s`，都带 `-race`。

通过不是只看最后一行。3A 要求每个 term 最多一个 leader，旧 leader 失联后 5 秒内选出新 leader。3B 要求已提交日志在所有 server 上一致，`applyCh` 按 index 递增；3C 要求重启后 `currentTerm`、`votedFor`、`log` 与崩溃前一致。3D 要求截断日志后仍能让落后 follower 追上，且快照不能把状态推回去。

评分脚本对 Lab 3–5 有统一限制：全部测试超过 600 秒，或单个超过 120 秒，算失败。开发用 `-race`，判分不带。`make raft1` 把 28 个测试放同一进程，官方 `-race` 总耗时约 576 秒，接近默认 10 分钟超时；平时分 3A–3D 跑。

## 开始之前

先读[第 6 讲](lectures.html#lec6)、[第 7 讲](lectures.html#lec7)、[第 8 讲](lectures.html#lec8)和[第 10 讲](lectures.html#lec10)。讲义给你选举、复制、提交和快照的主线；Figure 2 是逐条对照的清单，卡住时再读第 5、7 节。`raft-structure.txt` 讲 goroutine 分工，`raft-locking.txt` 讲锁的边界。

环境检查：

```bash
cd ~/labs/6.5840/src
go version          # 需要 go1.22 或更高
ls raft1            # raft.go raft_test.go test.go server.go proxy.go util.go
ls raftapi          # raftapi.go
```

第一次跑 `make raft1` 会失败，这是骨架的预期行为：

```text
=== RUN   TestInitialElection3A
Test (3A): initial election (reliable network)...
Fatal: expected one leader, got none
        .../raft1/test.go:151
        .../raft1/raft_test.go:36
info: wrote visualization to /var/folders/.../porcupine-2242138501.html
--- FAIL: TestInitialElection3A (5.51s)
```

`ticker()` 还没触发选举，`GetState()` 也一直返回 `(0, false)`，所以 `checkOneLeader` 在约 5 秒后放弃。

只改 `raft1/raft.go`；`raft_test.go`、`test.go`、`server.go`、`proxy.go`、`raftapi` 契约和 `labrpc` 都不要改。每个 peer 跑在独立进程里，只能通过 RPC 通信，不能共享 Go 变量或文件。

时间预算：30–40 小时，3A 约 3–5 小时，3B 约 10–15 小时，3C 约 8–10 小时，3D 约 10–15 小时。这是经验估计；调试通常比写代码更花时间。

## 代码地图

`raft.go` 是唯一要改的文件，骨架已经标好位置：

| 位置 | 作用 |
|---|---|
| `type Raft struct` | Figure 2 的状态和 goroutine 协调字段 |
| `GetState()` | 返回 `currentTerm` 和是否 leader |
| `persist()` / `readPersist()` | 3C 的序列化和恢复 |
| `PersistBytes()` | 返回 `persister.RaftStateSize()`，已写好 |
| `Snapshot(index, snapshot)` | 3D 截断日志 |
| `RequestVote` / `sendRequestVote` | 选举 RPC 的 handler 和发送示例 |
| `Start(command)` | leader 追加日志，立即返回 |
| `ticker()` | 周期检查选举超时 |
| `Make()` | 初始化、恢复状态、启动 goroutine |

`raftapi/raftapi.go` 定义接口与 `ApplyMsg`：`CommandValid` 带 `Command`/`CommandIndex`，`SnapshotValid` 带 `Snapshot`/`SnapshotIndex`/`SnapshotTerm`，两者互斥。

`raft1/server.go` 是服务层 `rfsrv`：从 `applyCh` 读消息，把已提交命令交给 tester 检查，并在每 10 条命令后调用 `rf.Snapshot(m.CommandIndex, data)`。3D 的 `applierSnap` 检查 `m.CommandIndex == lastApplied+1`；重启后先从持久化快照恢复 `lastApplied`。

`raft1/test.go` 是测试脚手架：`checkOneLeader` 每轮等 450–550 毫秒，最多 10 轮；`one()` 最多重试 10 秒；`wait()` 等多数派提交；`CheckLogs` 检查同一 index 是否提交了不同值。

## 数据流与接口

一次客户端命令的路径是固定的：

```text
Start(cmd)
   │  leader 追加 log[i]
   ▼
AppendEntries ──> follower 复制 log[i]
   │  多数派 matchIndex >= i，且 log[i].Term == currentTerm
   ▼
commitIndex = i ──apply goroutine──> applyCh{CommandValid, Command, CommandIndex}
```

测试和服务层主要用这四个接口：

```go
rf := Make(peers, me, persister, applyCh)
index, term, isLeader := rf.Start(command)
term, isLeader := rf.GetState()
rf.Snapshot(index int, snapshot []byte)
```

`Start` 必须立即返回，不能等提交；命令可能永远不提交。`applyCh` 每个已提交条目只送一次，按 index 递增；重启后从恢复位置继续，不能倒退。

Raft 的状态可以用这个最小结构体起步：

```go
type LogEntry struct {
    Term    int
    Command interface{}
}

type Raft struct {
    mu        sync.Mutex
    peers     []*labrpc.ClientEnd
    persister *tester.Persister
    me        int
    applyCh   chan raftapi.ApplyMsg
    applyCond *sync.Cond

    currentTerm int
    votedFor    int          // -1 表示本 term 还没投票
    log         []LogEntry   // 初始 log[0] 是哨兵，Term=0
    commitIndex int
    lastApplied int
    state       State        // Follower / Candidate / Leader

    nextIndex  []int         // 只对 leader 有意义
    matchIndex []int         // 只对 leader 有意义

    electionResetAt time.Time
    snapshotIndex   int
    snapshotTerm    int
    snapshot        []byte
}
```

3D 截断日志后，`log[0]` 当哨兵代表快照边界，绝对 index 由 `snapshotIndex` 记录；`termAt(i)` 和 `entriesFrom(i)` 统一换算，不要混用相对与绝对下标。

RPC 结构体至少要有这些字段：

```go
type RequestVoteArgs struct {
    Term, CandidateId, LastLogIndex, LastLogTerm int
}
type RequestVoteReply struct {
    Term        int
    VoteGranted bool
}

type AppendEntriesArgs struct {
    Term, LeaderId, PrevLogIndex, PrevLogTerm int
    Entries                                  []LogEntry
    LeaderCommit                             int
}
type AppendEntriesReply struct {
    Term    int
    Success bool
    XTerm   int   // 冲突条目的 term，没有则为 -1
    XIndex  int   // 该 term 的第一个 index
    XLen    int   // follower 日志长度
}

type InstallSnapshotArgs struct {
    Term, LeaderId, LastIncludedIndex, LastIncludedTerm int
    Data                                                []byte
}
type InstallSnapshotReply struct{ Term int }
```

Figure 2 的规则可以压成一张对照表，写代码时逐条打勾：

| 场景 | 必须做什么 |
|---|---|
| 收到 term 更大的 RPC | 更新 `currentTerm`，转 follower，清 `votedFor`，持久化 |
| 收到 term 更小的 RPC | 拒绝，回复 `currentTerm` |
| 投票 | 本 term 未投别人，且候选人日志至少一样新；投票后持久化再回复 |
| AppendEntries 前缀不匹配 | 拒绝，回 `XTerm/XIndex/XLen` |
| 日志冲突 | 从第一个冲突 index 截断，再追加 leader 条目 |
| 推进 `commitIndex` | 多数派 `matchIndex >= N`，且 `log[N].Term == currentTerm` |
| 应用日志 | 单 goroutine 按 index 送 `applyCh`，发送时不持锁 |
| 改变 term/votedFor/log | 先持久化，再回复或返回 |

必须持久化 `currentTerm`、`votedFor`、`log`；3D 还有 `snapshotIndex`、`snapshotTerm` 和快照字节。`commitIndex`、`lastApplied`、`state`、`nextIndex`、`matchIndex` 和定时器都可重建。

## 阶段 1（3A）：选出唯一 leader，并让它稳住

目标：`make RUN="-run 3A" raft1` 的 3 个测试全过。

1. `Make` 初始化 `state = Follower`、`votedFor = -1`、`log = []LogEntry{{Term: 0}}`、`electionResetAt = now + random(300–600ms)`，创建 `applyCond = sync.NewCond(&rf.mu)`；`GetState` 持锁返回 term 和是否 leader。
2. `ticker` 每 20–50 毫秒持锁检查 `state != Leader && now >= electionResetAt`，满足就发起选举。不要持锁 `Sleep`，也不要用 `time.Timer` 或 `time.Ticker`。
3. 选举时在锁内完成 `state = Candidate`、`currentTerm++`、`votedFor = me`、重置 deadline、`persist()`，解锁后给每个 peer 起 goroutine 发 `RequestVote`，参数带 `LastLogIndex/LastLogTerm`。
4. 回复后重新持锁，先检查 `rf.currentTerm == args.Term && rf.state == Candidate` 再计票；过半就转 leader，初始化 `nextIndex[i] = lastLogIndex()+1`、`matchIndex[i] = 0`，立刻发空 `AppendEntries`。
5. `RequestVote` 全程持锁：term 小拒绝；term 大就更新 term、转 follower、清 `votedFor` 并持久化；再查本 term 是否投过、候选人日志是否至少一样新，满足就投、重置定时器并持久化，再回复。
6. `AppendEntries` 先处理 term：小拒绝；大就更新 term、转 follower、清 `votedFor`；term 不小于自己就重置定时器，3A 可忽略日志直接回 `Success = true`。

跑：

```bash
make RUN="-run 3A" raft1
```

预期：

```text
--- PASS: TestInitialElection3A (3.84s)
--- PASS: TestReElection3A (6.54s)
--- PASS: TestManyElections3A (10.68s)
ok      6.5840/raft1    22.095s
```

通过标志是三个 `--- PASS`。`TestReElection3A` 还检查没有多数派时不能选出 leader，旧 leader 重新加入后必须转 follower；`TestManyElections3A` 用 7 个 peer 反复断开 3 个再恢复。

硬约束来自官方页：leader 每秒最多发 10 次心跳，旧 leader 失联后 5 秒内选出新 leader。论文的 150–300 毫秒超时偏短，因为心跳被限制在每秒 10 次；用 300–600 毫秒选举超时、100–150 毫秒心跳比较稳。`raft_test.go` 的 `RaftElectionTimeout` 是 1000 毫秒。

## 阶段 2（3B）：复制日志，按多数派提交

目标：`make RUN="-run 3B" raft1` 的 10 个测试全过，先让 `TestBasicAgree3B` 通过。

1. `Start` 在锁内检查是不是 leader；不是就返回 `-1, currentTerm, false`。是就追加 `LogEntry{Term: currentTerm, Command: command}`，持久化，返回新 index、term、true。
2. leader 给每个 peer 维护复制 goroutine。发送前在锁内取 `nextIndex[i]`，构造 `PrevLogIndex = nextIndex-1`、`PrevLogTerm = termAt(PrevLogIndex)`、`Entries = entriesFrom(nextIndex)`、`LeaderCommit = commitIndex`，解锁再 `Call`。
3. 成功时更新 `matchIndex[i] = max(matchIndex[i], PrevLogIndex+len(Entries))`、`nextIndex[i] = matchIndex[i]+1`，再尝试推进 `commitIndex`；失败时按 `XTerm/XIndex/XLen` 回退，不要每次只减 1。
4. 推进提交时从 `lastLogIndex()` 往下找：若多数派 `matchIndex >= N` 且 `termAt(N) == currentTerm`，令 `commitIndex = N` 并唤醒 applier。只能提交当前 term 的条目，旧 term 条目靠当前 term 的提交间接完成。
5. applier 是独立 goroutine：持锁等到 `lastApplied < commitIndex`，复制 `lastApplied+1..commitIndex`，推进 `lastApplied`，解锁后逐条送 `applyCh`。发送时不能持锁，否则服务层一慢就卡住整个 Raft。
6. follower 的 `AppendEntries`：先做 term 检查并重置定时器；再检查 `PrevLogIndex/PrevLogTerm`。不匹配就回 `Success = false` 和冲突信息；匹配就从第一个冲突 index 起截断后缀，追加缺少的条目，令 `commitIndex = min(LeaderCommit, lastNewIndex)`，持久化后回复。
7. 选举限制也要补上：`RequestVote` 只在候选人日志至少一样新时投票，先比 `LastLogTerm`，相同再比 `LastLogIndex`。

跑：

```bash
make RUN="-run 3B" raft1
```

预期 10 个测试全绿，最后 `ok 6.5840/raft1 71.716s`。`TestBackup3B` 约 28 秒，`TestCount3B` 约 3 秒，其余 2–8 秒。`TestBasicAgree3B` 证明基本协议，`TestBackup3B` 证明回退够快，`TestCount3B` 证明 RPC 没发太多。

`TestRPCBytes3B` 限制总字节为 `3 * 命令总字节 + 50000`，即每条命令每 peer 只发一次。`TestCount3B` 还要求空闲 1 秒内 3 个 server 共不超过 60 次 RPC。

## 阶段 3（3C）：先落盘，再回复

目标：`make RUN="-run 3C" raft1` 的 8 个测试全过。3C 的失败常是 3A/3B 的隐藏 bug 被崩溃放大，不要只盯着 `persist()`。

1. `persist()` 用 `labgob` 按固定顺序编码 `currentTerm`、`votedFor`、`log`，调用 `persister.Save(w.Bytes(), nil)`；3D 时第二个参数换成快照。
2. `readPersist(data)` 用同样顺序解码；`data` 为空就保留 `Make` 的初始状态。`log` 至少要有哨兵条目，否则 `termAt(0)` 越界。
3. 每个改变持久化状态的地方都要 `persist()`，而且在回复 RPC 或从 `Start` 返回之前：投票、term 变大、追加/截断日志、`currentTerm++`、`Start` 追加条目。
4. 重启后 `Make` 先从 `persister.ReadRaftState()` 恢复，再启动 ticker 和 applier。`lastApplied` 从 0 开始，已提交条目会重新送；tester 接受相同 index、相同 value 的重复上报，value 不同会报错。
5. 跑：

```bash
make RUN="-run 3C" raft1
```

预期 8 个测试全绿，最后 `ok 6.5840/raft1 180.983s`。`TestFigure83C` 约 49 秒，`TestFigure8Unreliable3C` 约 54 秒，`TestPersist23C` 约 22 秒，慢是正常的。

通过标志是 `TestPersist1/2/3` 和 `TestFigure83C`。`TestFigure83C` 构造 Figure 8：旧 term 条目已复制到多数派但未提交，新 leader 不能直接数副本提交，否则可能覆盖另一分支上已提交的条目。正确做法是只提交当前 term 条目，旧条目等当前 term 的提交间接完成。

3C 的超时还依赖 `nextIndex` 回退。官方页给了三种情况：leader 没有 `XTerm` 就令 `nextIndex = XIndex`；有 `XTerm` 就跳到该 term 最后一条之后；follower 日志太短就令 `nextIndex = XLen`。每次只减 1 会明显变慢。

## 阶段 4（3D）：截断日志，用快照追赶

目标：`make RUN="-run 3D" raft1` 的 7 个测试全过，先过 `TestSnapshotBasic3D`。

1. 统一索引表示。让 `log[0]` 当哨兵代表快照边界：`snapshotIndex` 是它的绝对 index，`snapshotTerm` 是它的 term；`lastLogIndex() = snapshotIndex + len(log) - 1`，`termAt(i)` 和 `entriesFrom(i)` 都先减 `snapshotIndex` 再访问切片。
2. `Snapshot(index, data)` 在锁内检查 `index > snapshotIndex`，取 `termAt(index)`，把 `log` 截到 index 之后，更新 `snapshotIndex/snapshotTerm/snapshot`，再 `persist()`。截断时复制到新切片，如 `append([]LogEntry(nil), rf.log[k:]...)`，否则旧数组还被引用，GC 回收不了。
3. `Make` 读 `persister.ReadSnapshot()` 恢复快照字节；`snapshotIndex/snapshotTerm` 从持久化 Raft state 恢复，因为快照字节对 Raft 不透明。把 `commitIndex` 和 `lastApplied` 初始化为 `snapshotIndex`，applier 第一条消息必须是快照之后的下一条命令。
4. leader 发现 `nextIndex[i] <= snapshotIndex` 时改发 `InstallSnapshot`，带 `LastIncludedIndex`、`LastIncludedTerm` 和整份 `Data`。官方要求一次 RPC 发完整快照，不要实现 Figure 13 的 offset 分片。
5. follower 收到 `InstallSnapshot`：term 小拒绝；`LastIncludedIndex <= snapshotIndex` 或 `<= commitIndex` 就忽略，避免倒退；否则安装快照，更新 `snapshotIndex/snapshotTerm`，令 `commitIndex` 和 `lastApplied` 至少到该 index，持久化 state 和 snapshot，再送一条 `SnapshotValid` 的 `ApplyMsg`。
6. 每次 `persister.Save()` 都要带当前快照；日志截断后不能传 `nil`。`TestSnapshotInit3D` 会在“做快照、崩全部、恢复、再写、再崩、再恢复”后检查后续 `Save` 有没有丢掉快照。
7. 跑：

```bash
make RUN="-run 3D" raft1
```

预期 7 个测试全绿，最后 `ok 6.5840/raft1 301.406s`。`TestSnapshotInstallUnreliable3D` 约 82 秒，`TestSnapshotInstallUnCrash3D` 约 67 秒，`TestSnapshotInstall3D` 和 `TestSnapshotInstallCrash3D` 约 54–60 秒，都是慢但正常。

通过标志是 `TestSnapshotBasic3D` 和 `TestSnapshotInit3D`：前者证明快照能截断日志且不影响复制，后者证明重启后恢复了快照和尾部日志。第一个 3D 测试最常见的失败是 follower 追得太慢，先查 `nextIndex` 回退和心跳间隔。

## 测试与判分

| 测试 | peer 数 | 测什么 | 官方样例 |
|---|---|---|---|
| `TestInitialElection3A` | 3 | 初始选举稳定 | 3.84 s |
| `TestReElection3A` | 3 | 断 leader 重选；无多数派不选 | 6.54 s |
| `TestManyElections3A` | 7 | 10 轮断 3 恢复 | 10.68 s |
| `TestBasicAgree3B` | 3 | 3 条命令按序提交 | 1.96 s |
| `TestRPCBytes3B` | 3 | 每条命令每 peer 只发一次 | 3.71 s |
| `TestFollowerFailure3B` | 3 | 一个 follower 失联仍一致 | 5.77 s |
| `TestLeaderFailure3B` | 3 | leader 失联重选；少数派不提交 | 6.89 s |
| `TestFailAgree3B` | 3 | follower 重连后追上 | 6.37 s |
| `TestFailNoAgree3B` | 5 | 3 个 follower 失联不提交；修复后 index 2/3 | 4.55 s |
| `TestConcurrentStarts3B` | 3 | 5 个并发 `Start` 全提交 | 1.75 s |
| `TestRejoin3B` | 3 | 旧 leader 未提交条目被覆盖 | 8.15 s |
| `TestBackup3B` | 5 | 50 条错误日志快速回退 | 28.27 s |
| `TestCount3B` | 3 | RPC 数量有上限 | 3.05 s |
| `TestPersist13C` | 3 | 全崩、leader/follower 崩后恢复 | 7.99 s |
| `TestPersist23C` | 5 | 反复杀 2–3 台再恢复 | 22.17 s |
| `TestPersist33C` | 3 | 分区 + leader/follower 崩溃 | 4.11 s |
| `TestFigure83C` | 5 | Figure 8：旧 term 条目不能直提 | 49.08 s |
| `TestUnreliableAgree3C` | 5 | 不可靠网络下并发提交 | 5.68 s |
| `TestFigure8Unreliable3C` | 5 | Figure 8 + 不可靠网络 | 54.19 s |
| `TestReliableChurn3C` | 5 | 崩溃、重启、分区 | 18.80 s |
| `TestUnreliableChurn3C` | 5 | 不可靠网络下的 churn | 17.92 s |
| `TestSnapshotBasic3D` | 3 | 快照基本路径 | 8.74 s |
| `TestSnapshotInstall3D` | 3 | 落后 follower 靠快照追上 | 59.99 s |
| `TestSnapshotInstallUnreliable3D` | 3 | 不可靠网络下的快照安装 | 82.49 s |
| `TestSnapshotInstallCrash3D` | 3 | follower 崩溃后用快照恢复 | 53.99 s |
| `TestSnapshotInstallUnCrash3D` | 3 | 不可靠网络 + 崩溃 | 66.60 s |
| `TestSnapshotAllCrash3D` | 3 | 全崩重启，快照 index 不倒退 | 20.79 s |
| `TestSnapshotInit3D` | 3 | 重启时正确初始化快照 | 7.77 s |

本地评分 `--quick` 只跑 3A，全量才跑 3A–3D；quick 通过只说明选举没坏。3C/3D 会反复杀进程、断网，单个测试几十秒正常；超过 120 秒通常是有 goroutine 卡住或 RPC 风暴。

## 常见错误：现象、原因、处理

| 现象 | 原因 | 处理 |
|---|---|---|
| `expected one leader, got none` | ticker 没触发；票数没算对；心跳太慢 | 打印选举 term、票数、deadline |
| `term %d has %d (>1) leaders` | 一个 term 投两票；候选人不验回复 term | 投票和 term 更新都在锁内；回复后验 term/state |
| 无故障时 term 仍变大 | 心跳没发；follower 没重置定时器 | 定期发空 AppendEntries；收合法 leader 就重置 |
| 旧 leader 重连后仍自认 leader | 更高 term 的 RPC 没转 follower | term 更大就更新 term、转 follower、清 votedFor |
| 已提交的 index 被覆盖 | 提交了旧 term 条目；没截断冲突后缀 | 只提交当前 term 条目；冲突时先截断 |
| `server %v apply out of order` | 多 goroutine 送 applyCh；持锁发送 | 单 applier，按 index 递增 |
| 同一个 index 被 apply 两次 | `lastApplied` 没在锁内推进 | 只由 applier 在锁内推进 |
| `TestBackup3B` 很慢或超时 | `nextIndex` 每次只减 1 | 用 `XTerm/XIndex/XLen` 快速回退 |
| 3C 重启后丢已提交条目 | 没 `persist`，或先回复后落盘 | 状态变化先 `persist` 再回复 |
| 3C 同一 term 投两票 | `votedFor` 没持久化；term 变大没清空 | term 和 votedFor 一起编码；变大置 -1 |
| `snapshot doesn't match m.SnapshotIndex` | 快照 index 与日志绝对 index 混用 | 统一用 `snapshotIndex + 偏移` |
| `Raft size too large` | `Snapshot()` 没截断，或仍引用旧数组 | 截断并复制到新切片 |
| 快照把服务状态推回去 | 发送了不比 `lastApplied` 新的快照 | 只发更新的快照，安装也只前进 |
| 卡死、`-race` 报竞态 | 持锁发 RPC、`Sleep`、送 `applyCh` | 锁只包状态读写；等待和 RPC 在锁外 |
| `labgob` 警告字段小写 | RPC 或日志字段没大写 | 跨 RPC、进日志的字段首字母大写 |

## 调试手册

1. **对着 Figure 2 静态检查。** 把状态、AppendEntries、RequestVote、Rules for Servers 逐条抄成清单打勾。多数 bug 在这一步就能发现。

2. **在关键位置打日志。** 打印 `me`、`term`、`state`、`commitIndex`、`lastApplied`、`len(log)`，RPC 入口再打 `args.Term`、`PrevLogIndex`、`Success`。带时间才能判断心跳和选举谁先触发。

3. **只跑一个测试，把输出留下来。**

   ```bash
   make RUN="-run TestPersist13C" raft1 > /tmp/raft.log 2>&1
   tail -60 /tmp/raft.log
   ```

   反复跑用 `-count=3`；在 `src/raft1` 直接 `go test` 前先 `make raft1-build`，否则跑的是旧守护进程。

4. **失败时打开时间线 HTML。** 输出里的 `porcupine-*.html` 能看到每个 server 的 term、崩溃、分区和检查点。先看谁在什么 term 收到什么 RPC。

5. **检查锁边界。** 持锁不发 RPC、不 `Sleep`、不送 `applyCh`；回复回来重新持锁后 term/state 可能已变，必须重查。见 `raft-locking.txt` 第 4、5 条。

6. **复现重启问题。** 在 `persist()`/`readPersist()` 各打一行，确认字段顺序一致；跑 `TestPersist13C` 对比崩溃前后的 `currentTerm/votedFor/log`。3D 再确认 `Save()` 第二个参数不是 `nil`。

7. **用 `-race` 跑，但别只看一次。** 竞态往往十次才出一次，3A–3D 每组至少连跑 3 次。

## 提交前检查

- [ ] 四组全绿；每组连跑 3 次无偶发失败。
- [ ] `-race` 跑过；无 data race、goroutine 泄漏或卡死。
- [ ] 每次改变 `currentTerm`、`votedFor`、`log` 都先 `persist()`，再回复 RPC 或从 `Start` 返回。
- [ ] `applyCh` 按 index 递增，不重复、不跳过；快照只前进，不倒退。
- [ ] `Snapshot()` 截断日志后没有旧数组引用；3D 的 `RaftSize()` 低于 2000 字节。
- [ ] 能不看代码讲清 Figure 8、选举限制、当前 term 提交规则、InstallSnapshot。
- [ ] 写了 300 字复盘：不变量、取舍、最先暴露问题的测试、根因（模板见[评分标准](grading.html#reflection)）。

## 自测问题

1. 为什么 leader 不能直接提交旧 term 的条目？构造一个反例。
2. 选举限制为什么能保证已提交的条目不会丢？
3. follower 的日志比 leader 长时，`AppendEntries` 应该怎么处理？
4. 快照之后，`commitIndex` 和 `lastApplied` 分别是什么？
5. 哪些状态必须持久化？哪些可以重建？
6. 为什么必须“先持久化，再回复”，反过来会怎样？
7. follower 收到 `LastIncludedIndex <= commitIndex` 的 InstallSnapshot 应该怎么做？

### 答案要点

1. 旧 term 条目即使复制到多数派，也可能被未来 leader 覆盖。Figure 8 里 term 2 的条目未提交，term 3 的新 leader 可带不同条目当选并覆盖它；只有提交当前 term 条目才能间接确认旧条目。
2. 多数派中至少一个 server 持有已提交条目，选举限制要求候选人日志至少一样新，所以候选人不会缺已提交条目。先比 term 再比 index，保证“更新”与日志前缀一致。
3. 先比较 `PrevLogIndex/PrevLogTerm`；不匹配就回退到冲突点，截断 follower 多出的后缀，再追加 leader 的条目。截断从第一个冲突 index 开始。
4. 两者都至少是 `snapshotIndex`：`commitIndex` 取 `max(commitIndex, snapshotIndex)`，安装快照后 `lastApplied` 设为该 index。小于边界会重复 apply 或倒退。
5. 持久化 `currentTerm`、`votedFor`、`log`；3D 还有 `snapshotIndex`、`snapshotTerm` 和快照字节。`commitIndex`、`lastApplied`、`state`、`nextIndex`、`matchIndex`、定时器都可重建。
6. 先回复再落盘，server 可能在回复后、落盘前崩溃；上层已认为成功，重启却看到旧状态，可能同 term 投两票或丢已确认日志。先落盘再回复，保证说出去的话能恢复。
7. 忽略快照，回复自己的 `currentTerm`。安装旧快照会让 `lastApplied` 倒退；若对方 term 更大，仍要更新 term 并转 follower。
