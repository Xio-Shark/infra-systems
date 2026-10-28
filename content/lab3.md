# Lab 3 · Raft

> **课程**：[INFRA 01 · 分布式系统](course-map.html) · **实验 3/5**
>
> **先读**：[第 6 讲 Raft (1)](lectures.html#lec6) 和 [第 7 讲 Raft (2)](lectures.html#lec7) · **参考**：[官方 lab 页](https://pdos.csail.mit.edu/6.5840/labs/lab-raft1.html) · [Raft 论文](https://raft.github.io/raft.pdf) · [中文翻译](https://github.com/maemual/raft-zh_cn)
>
> **评分**：`LAB_ROOT=~/labs/6.5840 ./judge/run.sh infra01 lab3` · [评分标准](grading.html)
>
> [上一个：Lab 2](lab2.html) · [返回作业](labs.html) · [下一个：Lab 4](lab4.html)
>
> 必读 Raft 论文 Figure 2、`raft-structure.txt`、`raft-locking.txt`。

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

- 评分不强制 `-race`，但你应该用 `-race` 自测；竞态是 Raft 最常见的 bug。
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
