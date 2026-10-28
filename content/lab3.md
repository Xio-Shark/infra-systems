# Lab 3 · Raft

> **课程**：[INFRA 01 · 分布式系统](course-map.html) · **实验 3/5**
>
> **先读**：[第 6 讲 Raft (1)](lectures.html#lec6)、[第 7 讲 Raft (2)](lectures.html#lec7)、[第 8 讲 线性一致](lectures.html#lec8) 和 [第 10 讲 Lab 3 Q&A](lectures.html#lec10) · **参考**：[官方 lab 页](https://pdos.csail.mit.edu/6.5840/labs/lab-raft1.html) · [Raft 论文](https://raft.github.io/raft.pdf) · [中文翻译](https://github.com/maemual/raft-zh_cn)
>
> **评分**：`LAB_ROOT=~/labs/6.5840 ./judge/run.sh infra01 lab3` · [评分标准](grading.html)
>
> [上一个：Lab 2](lab2.html) · [返回作业](labs.html) · [下一个：Lab 4](lab4.html)
>
> **对照**：Raft 论文 Figure 2、`raft-structure.txt`、`raft-locking.txt`（可选）。

## 开始之前

先读[第 6 讲](lectures.html#lec6)、[第 7 讲](lectures.html#lec7)、[第 8 讲](lectures.html#lec8)和[第 10 讲](lectures.html#lec10)。讲义和下面的规则速查给了状态、RPC、选举、提交、持久化、snapshot 的关键规则；论文 Figure 2 用来对照检查。第一次实现可以只看这两处，卡住时再读论文第 5 节。

**规则速查**

| 场景 | 必须做什么 |
|---|---|
| 收到 term 更大的 RPC | 更新 `currentTerm`，转 follower，清 `votedFor` |
| 收到 term 更小的 RPC | 拒绝，回复自己的 term |
| 投票 | 本 term 没投过别人，且候选人日志至少一样新 |
| AppendEntries 前缀不匹配 | 拒绝，让 leader 回退 `nextIndex` |
| 日志冲突 | 截断冲突后缀，再追加 leader 的条目 |
| 推进 `commitIndex` | 多数派 `matchIndex ≥ N`，且 `log[N].term == currentTerm` |
| 改变 term/votedFor/log | 先持久化，再回复 RPC |
| 应用日志 | 单 goroutine 按 index 顺序送 `applyCh` |

**本 lab 的不变量**

1. 一个 term 最多一个 leader，每个 server 一个 term 最多投一票。
2. 已提交的条目不会丢，也不会被覆盖。
3. 任意两个日志在相同 index/term 处，之前的所有条目相同。
4. `applyCh` 按 index 递增，不跳过、不重复；snapshot 之后从 snapshot 位置继续。
5. 重启后 `currentTerm`、`votedFor`、`log` 与崩溃前一致。

**第一次跑通**

1. 只做 3A：选举和心跳，先不复制日志。跑 `make RUN="-run 3A" raft1`。
2. 3A 稳定后做 3B：日志复制和 commit。先可靠网络，再故障测试。
3. 3C：每次改变 term/votedFor/log 都持久化，跑重启测试。
4. 3D：加 snapshot 和 InstallSnapshot，最后跑 `make raft1`。
5. 每步都开 `-race` 自测；失败时只跑一个测试，保留日志。

## 目标

用 Go 实现 Raft：多个 server 通过 RPC 复制日志，选举 leader，在少数机器崩溃、网络分区、消息丢失时仍保持同一个日志顺序。

分四部分：

- **3A**：leader election。
- **3B**：log replication。
- **3C**：persistence。
- **3D**：snapshot。

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

- `Make`：创建一个 Raft peer。`peers` 是所有 peer 的网络 ID，`me` 是下标。
- `Start`：leader 收到命令后追加到日志，立即返回 index/term/isLeader，不等待提交。
- `GetState`：返回当前 term 和是否是 leader。
- `applyCh`：已提交的日志按顺序送到 applyCh；3D 还要送 snapshot。
- 只改 `src/raft1/raft.go`；不要改 `labrpc` 和测试。

## 要求

**3A**

- 没有故障时选出一个 leader，并保持稳定。
- 旧 leader 失联或分区后，5 秒内选出新 leader。
- 每个 term 最多一票；候选人日志至少要和投票者一样新。

**3B**

- leader 把日志复制到多数派后才提交。
- follower 的日志冲突时要截断，再追加 leader 的日志。
- 只能提交当前 term 的条目；旧 term 的条目要靠当前 term 的提交间接提交。
- `applyCh` 按 index 顺序，不重复、不跳过。

**3C**

- `currentTerm`、`votedFor`、`log` 每次变化后都要持久化，再回复 RPC。
- 重启后从 `persister` 恢复，不能丢已提交的条目。

**3D**

- 日志过大时做 snapshot，丢弃旧日志。
- `InstallSnapshot` 让落后的 follower 追上。
- snapshot 的 index/term 和日志 index 不能混淆。
- snapshot 恢复后，apply 不能倒退。

## 测试

```bash
cd ~/labs/6.5840/src

make raft1                 # 全部 3A–3D
make RUN="-run 3A" raft1
make RUN="-run 3B" raft1
make RUN="-run 3C" raft1
make RUN="-run 3D" raft1
```

- MIT 的 Makefile 默认用 `-race` 跑测试，judge 调 `make` 时也会带上；自己调试可以临时用 `RACE=` 关掉，但提交前要用默认值跑一遍。竞态是 Raft 最常见的 bug。
- 全部测试有总时间限制；3C/3D 在 `-race` 下可能要好几分钟。
- 测试失败会生成可视化 HTML（porcupine timeline），看事件顺序。

## 本地评分

```bash
LAB_ROOT=~/labs/6.5840 ./judge/run.sh infra01 lab3
LAB_ROOT=~/labs/6.5840 ./judge/run.sh infra01 lab3 --quick
```

## 调试方法

1. 先对照 Raft 论文 Figure 2，逐条检查每个状态和规则。
2. 在 `RequestVote`、`AppendEntries`、`Start`、commit 变化处打印 term、state、index、commitIndex、lastApplied。
3. 只跑一个测试，把输出重定向到文件。
4. 画时序图：谁在什么 term 发了什么 RPC，收到什么回复。
5. 检查锁：持锁时不要发 RPC、不要 `time.Sleep`、不要往 `applyCh` 发送。
6. RPC 回复回来时 term 可能已经变了，要重新检查。
7. 每次改 `currentTerm`、`votedFor`、`log` 后都要 persist。

## 常见 bug

- 收到更高 term 的 RPC 没有变 Follower。
- 收到旧 term 的 RPC 没有拒绝。
- 投票前没有检查候选人日志是否至少一样新。
- 一个 term 投了两票，或 `votedFor` 没持久化。
- leader 提交了旧 term 的 entry。
- follower 日志冲突时没有截断。
- `commitIndex` 倒退。
- `applyCh` 乱序或重复 apply。
- 持锁发 RPC、持锁 sleep、持锁 send `applyCh`。
- `nextIndex` 回退太慢，导致 3C/3D 超时。
- snapshot 的 index 和日志 index 混淆。
- `labgob` 字段小写，编码丢失。

## 自测问题

- 为什么 leader 不能直接提交旧 term 的条目？构造一个反例。
- 为什么选举限制能保证已提交的条目不会丢？
- follower 的日志比 leader 长时，`AppendEntries` 应该怎么处理？
- snapshot 之后，`commitIndex` 和 `lastApplied` 分别是什么？
- 哪些状态必须持久化？哪些可以重建？

## 提交前检查

- [ ] 3A–3D 全绿；`make raft1` 连续跑 3 次没有偶发失败。
- [ ] 用默认 `-race` 跑过；持久化顺序正确（先落盘再回复）。
- [ ] `applyCh` 按 index 递增，不重复、不跳过；snapshot 后不倒退。
- [ ] 能不看代码讲清 Figure 8、选举限制、commit 规则、snapshot。
- [ ] 没有残留的 goroutine/临时文件；写了 300 字复盘（模板见[评分标准](grading.html#reflection)）。
