# Lab 3 中文精读：Raft

> 官方页：https://pdos.csail.mit.edu/6.5840/labs/lab-raft1.html
>
> 本站只讲要求、设计、测试和常见坑，不提供可直接提交的代码。课程要求独立完成。
>
> 必读：Raft 论文 Figure 2、Raft structure advice、Raft locking advice。
>
> - 论文：https://raft.github.io/raft.pdf
> - 结构建议：https://pdos.csail.mit.edu/6.5840/labs/raft-structure.txt
> - 锁建议：https://pdos.csail.mit.edu/6.5840/labs/raft-locking.txt
> - 中文翻译：https://github.com/maemual/raft-zh_cn

## 一句话

用 Go 实现 Raft：多个 server 通过 RPC 复制日志，选举 leader，在少数机器崩溃、网络分区、消息丢失的情况下仍然保持同一个日志顺序。Lab 3 分四部分：3A 选举、3B 日志复制、3C 持久化、3D 快照。

## 接口

```go
rf := Make(peers, me, persister, applyCh)

index, term, isLeader := rf.Start(command)

term, isLeader := rf.GetState()

type ApplyMsg struct {
    CommandValid bool
    Command      interface{}
    CommandIndex int

    SnapshotValid bool
    Snapshot      []byte
    SnapshotTerm  int
    SnapshotIndex int
}
```

- `Make`：创建一个 Raft peer。`peers` 是所有 peer 的网络 ID，`me` 是自己的下标。
- `Start`：leader 收到客户端命令，追加到日志；立即返回 index/term/isLeader，不等待提交。
- `GetState`：返回当前 term 和是否是 leader。
- `applyCh`：每个新提交的日志条目都要按顺序发送到 applyCh；3D 还要发送 snapshot。
- 只改 `src/raft1/raft.go`；不要改 `labrpc`。

## 代码结构

`src/raft1/raft.go` 里已经有骨架：

- `Raft` struct：加 Figure 2 的字段。
- `RequestVoteArgs` / `RequestVoteReply`：3A 用。
- `AppendEntriesArgs` / `AppendEntriesReply`：3A/3B 用。
- `Make`：初始化，启动 ticker goroutine。
- `Start`：3B 用。
- `GetState`：3A 用。
- `persist` / `readPersist`：3C 用。
- `Snapshot`：3D 用。

测试在 `src/raft1/raft_test.go`；可以读测试，但不要改。

## 3A：Leader election

目标：选出一个 leader；没有故障时 leader 保持不变；旧 leader 失联或分区时，5 秒内选出新 leader。

### 状态

每个 peer 维护：

- `currentTerm`：单调递增的任期。
- `votedFor`：本 term 投给了谁。
- `state`：Follower / Candidate / Leader。
- `lastHeartbeat`：最后一次收到 leader 心跳的时间（或最后一次重置选举计时的时间）。

### 选举流程

1. Follower 在 election timeout 内没收到心跳 → 变成 Candidate。
2. `currentTerm++`，`votedFor = me`，给自己投票。
3. 向所有 peer 发 `RequestVote`。
4. 收到多数票 → 变成 Leader，立刻发心跳。
5. 收到更高 term 的 RPC → 变回 Follower，更新 term。

### RequestVote 规则

- `args.Term < currentTerm` → 拒绝。
- `args.Term > currentTerm` → 更新 `currentTerm`，`votedFor = -1`，变 Follower。
- 如果 `votedFor == -1` 或 `votedFor == candidateId`，并且 candidate 的日志至少和自己一样新 → 投票。
- “至少一样新”：先比最后一条日志的 term，term 相同再比 index。

### 心跳

- Leader 定期发 `AppendEntries`（可以没有 entries）。
- 测试要求 leader 每秒最多发 10 次心跳；常见做法是 50–100ms 一次。
- 测试要求旧 leader 失联后 5 秒内选出新 leader；election timeout 不要太大，常见 300–600ms。
- 不要用 `time.Timer` / `time.Ticker`；用 `time.Sleep` 的循环，课程明确建议这样做。

### 3A 的坑

- 选举超时太短 → 频繁 split vote；太长 → 5 秒内选不出 leader。
- 收到更高 term 的 `RequestVote` 要立刻变 Follower。
- 收到旧 term 的 RPC 要忽略，不要回退 term。
- 投票要持久化 `votedFor` 和 `currentTerm`（3C 会测；3A 先做对）。
- 心跳里也要带 term；follower 看到更高 term 要更新。

## 3B：日志复制

目标：leader 把客户端命令追加到日志，复制到多数派，提交后按顺序 apply。

### 日志结构

- 日志从 1 开始；建议在 index 0 放一个 dummy entry（term 0），这样 `PrevLogIndex=0` 是合法的。
- 每条 entry 至少有 `Term` 和 `Command`。
- `commitIndex`：已知被多数派复制的最大 index。
- `lastApplied`：已经发送到 applyCh 的最大 index。

### Start

- 只有 leader 能接受。
- 追加 entry 到本地日志。
- 返回 index、term、isLeader。
- 立即返回，不等待复制。

### AppendEntries

Leader 对每个 follower 维护：

- `nextIndex[i]`：下一次要发给 follower 的日志 index。
- `matchIndex[i]`：已知 follower 复制到的最大 index。

发送：

- `PrevLogIndex = nextIndex[i] - 1`
- `PrevLogTerm = log[PrevLogIndex].Term`
- `Entries = log[nextIndex[i]:]`
- `LeaderCommit = commitIndex`

Follower 处理：

- `args.Term < currentTerm` → 拒绝。
- `args.Term > currentTerm` → 更新 term，变 Follower。
- 如果 `PrevLogIndex` 没有对应 entry，或 term 不匹配 → 拒绝。
- 否则追加/覆盖 entries；如果冲突，删除冲突之后的日志。
- `commitIndex = min(LeaderCommit, last log index)`。
- 重置选举计时。

Leader 处理回复：

- 如果成功：`matchIndex[i] = PrevLogIndex + len(Entries)`；`nextIndex[i] = matchIndex[i] + 1`。
- 如果失败：减小 `nextIndex[i]`，重试。
- 处理回复前要检查 term 没变；旧回复要丢弃。

### Commit 规则

Leader 只能提交满足以下条件的 entry：

- 该 entry 已经被多数派复制（`matchIndex` 多数 >= index）。
- **该 entry 的 term == currentTerm**。

第二条是 Figure 8 的关键：不能通过“多数派有旧 term 的 entry”来提交旧 term 的 entry；只能等当前 term 的 entry 提交，间接提交之前的 entry。

### Apply

- 单独一个 goroutine 按顺序把 `commitIndex` 之前的 entry 发送到 `applyCh`。
- 不要在持锁时发送到 `applyCh`（可能阻塞）。
- 用 `sync.Cond` 或 channel 通知 apply goroutine。

### 选举限制

Candidate 的日志必须至少和 voter 一样新，否则不能当选。这是 Raft 安全性的一部分：已经提交的 entry 不会丢。

### 3B 的坑

- Follower 收到冲突日志要截断，不要简单 append。
- `commitIndex` 只能前进，不能后退。
- 不要提交旧 term 的 entry（Figure 8）。
- `applyCh` 要按 index 顺序发送，不能乱序。
- 不要忙等；用 `sync.Cond` 或 `time.Sleep(10ms)`。
- 处理 RPC 回复时检查 term；旧回复可能来自旧任期。
- 心跳太频繁会触发 `TestCount3B` 的 RPC 数量检查。

## 3C：持久化

目标：server 重启后恢复 `currentTerm`、`votedFor`、`log`，继续工作。

### 要持久化的状态

Figure 2 明确：

- `currentTerm`
- `votedFor`
- `log[]`

`commitIndex`、`lastApplied`、`nextIndex`、`matchIndex` 不需要持久化；重启后从日志和快照恢复。

### 实现

- `persist()`：用 `labgob` 编码上述三个字段，调用 `persister.Save(raftstate, nil)`。
- `readPersist()`：`Make` 时从 `persister.ReadRaftState()` 解码。
- 每次 `currentTerm`、`votedFor`、`log` 变化后调用 `persist()`。
- 在回复 RPC 之前持久化（尤其是投票和追加日志），否则崩溃后会违反安全性。

### nextIndex 回退优化

如果 follower 拒绝，leader 每次只把 `nextIndex` 减 1，会很慢。3C 要求你实现快速回退：

Follower 在拒绝时返回：

- `XTerm`：冲突 entry 的 term（如果没有，填 -1）。
- `XIndex`：该 term 的第一个 index（如果没有，填 follower 的日志长度）。
- `XLen`：follower 的日志长度。

Leader 处理：

- 如果 leader 没有 `XTerm`：`nextIndex = XIndex`。
- 如果 leader 有 `XTerm`：`nextIndex = leader 中该 term 的最后一条 entry 的 index + 1`。
- 如果 follower 日志太短：`nextIndex = XLen`。

### 3C 的坑

- 忘记在 term 变化时持久化 → 重启后可能重复投票。
- 忘记在 `votedFor` 变化时持久化 → 可能一 term 投两票。
- 日志截断后没有持久化 → 重启后日志不一致。
- `labgob` 只编码首字母大写的字段；日志 entry 的字段要大写。
- 3C 的测试比 3A/3B 更严格；3A/3B 的 bug 会在 3C 暴露。

## 3D：日志压缩 / 快照

目标：日志不能无限增长；服务层定期调用 `Snapshot(index, snapshot)`，Raft 丢弃 index 之前的日志；落后太多的 follower 通过 `InstallSnapshot` 追上。

### 状态

- `lastIncludedIndex`：快照包含的最后一条日志 index。
- `lastIncludedTerm`：该 entry 的 term。
- `snapshot []byte`：服务层状态的序列化。

### Snapshot(index, snapshot)

- 如果 `index <= lastIncludedIndex`，忽略（快照不能倒退）。
- 丢弃 `index` 之前的日志。
- 保存 `lastIncludedIndex`、`lastIncludedTerm`、snapshot。
- `persister.Save(raftstate, snapshot)`。
- 注意：丢弃日志后，不能还持有对旧 entry 的引用，否则 GC 回收不了。

### InstallSnapshot

Leader 发现 follower 需要的日志已经被丢弃 → 发送 `InstallSnapshot`。

- args 带 `LastIncludedIndex`、`LastIncludedTerm`、`Data`。
- follower 收到后：
  - 如果 `args.LastIncludedIndex <= commitIndex`，忽略（不能倒退）。
  - 否则丢弃整个日志（或保留 snapshot 之后的部分），设置 `lastIncludedIndex/Term`。
  - 通过 `applyCh` 发送 `ApplyMsg{SnapshotValid: true, ...}`。
  - 持久化状态和 snapshot。
  - 重置选举计时。

### 重启

- `Make` 时读 `persister.ReadSnapshot()`。
- 如果 snapshot 非空，恢复 `lastIncludedIndex/Term`。
- apply goroutine 要从 snapshot 之后开始发送，不能重复发送已经包含在 snapshot 里的 entry。

### 3D 的坑

- `Snapshot` 的 index 是“已经 apply 的 index”，不是 `commitIndex`；不要搞混。
- Follower 收到 snapshot 后，`applyCh` 的 snapshot 不能倒退。
- `InstallSnapshot` 的 RPC 可能很大；这个 lab 允许整块发送，不用分片。
- 日志裁剪后，`PrevLogIndex` 可能小于 `lastIncludedIndex`；这时要发 snapshot，而不是普通 AppendEntries。
- 持久化时要同时保存 raft state 和 snapshot；`persister.Save(state, snapshot)`。
- 3D 测试很慢（`-race` 下约 5 分钟）；不要以为卡死。

## 测试

```bash
cd ~/labs/6.5840/src

make raft1                 # 全部 3A–3D
make RUN="-run 3A" raft1   # 只跑 3A
make RUN="-run 3B" raft1
make RUN="-run 3C" raft1
make RUN="-run 3D" raft1
```

- 评分时不用 `-race`，但你应该用 `-race` 测；竞态是 Raft 最常见的 bug。
- 全部测试有总时间限制：600 秒；单个测试 120 秒。
- 3A 大约 20 秒，3B 约 70 秒，3C 约 180 秒，3D 约 300 秒（`-race` 下，来自 lab 页）。
- 测试失败时会生成一个可视化 HTML（porcupine timeline），看事件顺序很有用。

## 调试方法

1. **先对 Figure 2**：Raft 的 bug 80% 是漏了 Figure 2 的某个条件。
2. **加打印**：在 `RequestVote`、`AppendEntries`、`Start`、commit 变化处打印 term、state、index、commitIndex、lastApplied。
3. **只跑一个测试**：`make RUN="-run TestBasicAgree3B" raft1`，把输出重定向到文件，慢慢看。
4. **画时序图**：谁在什么 term 发了什么 RPC，收到什么回复。
5. **检查锁**：持锁时不要发 RPC、不要 `time.Sleep`、不要往 `applyCh` 发送。
6. **检查旧回复**：RPC 回复回来时，term 可能已经变了；要重新检查。
7. **检查持久化点**：每次改变 `currentTerm`、`votedFor`、`log` 后都要 persist。

## 常见 bug 清单

- [ ] 收到更高 term 的 RPC 没有变 Follower。
- [ ] 收到旧 term 的 RPC 没有忽略。
- [ ] 投票前没有检查候选人的日志是否至少一样新。
- [ ] 一个 term 投了两票（`votedFor` 没持久化）。
- [ ] Leader 提交了旧 term 的 entry（Figure 8）。
- [ ] Follower 日志冲突时没有截断。
- [ ] `commitIndex` 倒退了。
- [ ] `applyCh` 乱序或重复 apply。
- [ ] 持锁发 RPC / 持锁 sleep / 持锁 send applyCh。
- [ ] `nextIndex` 回退太慢，3C/3D 超时。
- [ ] Snapshot 的 index 和日志 index 混淆。
- [ ] `InstallSnapshot` 让 apply 倒退。
- [ ] 日志裁剪后还引用旧 entry，GC 回收不了。
- [ ] `labgob` 字段小写，编码丢失。
- [ ] 心跳超过 10 次/秒，`TestCount3B` 失败。
- [ ] 选举超时太短，频繁 split vote。
- [ ] 选举超时太长，5 秒内选不出 leader。
- [ ] `Start` 在非 leader 上返回了错误的 index/term。
- [ ] `GetState` 没有加锁，`-race` 报错。

## Figure 2 中文检查表

每次改完 Raft，按这张表过一遍：

**所有 server：**

- [ ] `currentTerm` 只增不减。
- [ ] 收到更高 term → 更新 term，`votedFor = -1`，变 Follower。
- [ ] 收到旧 term 的 RPC → 拒绝。
- [ ] 投票规则：每个 term 最多一票；候选人日志至少一样新。
- [ ] 只有 leader 能处理 `Start`。
- [ ] 提交后按顺序 apply。

**Leader：**

- [ ] 心跳不超过 10 次/秒。
- [ ] 只在 `entry.term == currentTerm` 且多数派复制时提交。
- [ ] `nextIndex` 初始化为 `lastLogIndex + 1`。
- [ ] `matchIndex` 初始化为 0。
- [ ] 处理回复时检查 term。

**Follower：**

- [ ] `PrevLogIndex/Term` 不匹配 → 拒绝。
- [ ] 冲突日志 → 截断后追加。
- [ ] `commitIndex = min(LeaderCommit, lastLogIndex)`。
- [ ] 收到 AppendEntries / RequestVote → 重置选举计时。

**持久化：**

- [ ] `currentTerm`、`votedFor`、`log` 每次变化后 persist。
- [ ] 重启后 readPersist。
- [ ] 3D 同时持久化 snapshot。

## 术语

| 英文 | 中文 | 说明 |
|---|---|---|
| term | 任期 | 单调递增 |
| leader election | 领导者选举 | 多数票当选 |
| heartbeat | 心跳 | 空的 AppendEntries |
| log replication | 日志复制 | leader 发给 follower |
| commitIndex | 提交索引 | 已知被多数派复制的最大 index |
| lastApplied | 已应用索引 | 已发送到 applyCh 的最大 index |
| nextIndex | 下一条索引 | leader 对每个 follower 维护 |
| matchIndex | 匹配索引 | 已知 follower 复制到的最大 index |
| election restriction | 选举限制 | 候选人日志必须至少一样新 |
| persistence | 持久化 | currentTerm/votedFor/log |
| snapshot | 快照 | 日志压缩 |
| InstallSnapshot | 安装快照 | 落后 follower 追上 |
| linearizability | 线性一致性 | 上层 KV 的目标 |

## 从 Raft 到工程系统

Raft 的每个机制，在工程系统里几乎都有一个同名或近义的对应物：

- `term` ↔ 控制器的 epoch、配置版本。
- `votedFor` / 多数派 ↔ leader election、单所有者。
- `commitIndex` ↔ 操作从 `running` 到 `committed` 的提交点。
- `applyCh` ↔ 内核把已提交的操作交给状态机。
- `Snapshot` ↔ 工作区快照、配置快照、容器检查点。
- `InstallSnapshot` ↔ 新 owner 接管时的状态重建。

这不是“把 Raft 搬到某个项目”，而是训练你把协议语义映射到工程约束：谁在写、什么时候算提交、失败后看到什么。

做完 Lab 3，你应该能回答：

- 为什么 Raft 不能直接提交旧 term 的 entry？
- 为什么 `votedFor` 必须持久化？
- 为什么 `nextIndex` 回退要优化？
- 为什么 `applyCh` 要单独一个 goroutine？
- 为什么 `Snapshot` 的 index 不能倒退？
