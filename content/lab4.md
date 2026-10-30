# Lab 4 · Fault-tolerant KV

> **课程**：[INFRA 01 · 分布式系统](course-map.html) · **实验 4/5**
>
> **先读**：[第 6 讲 Raft (1)](lectures.html#lec6)、[第 7 讲 Raft (2)](lectures.html#lec7) 和 [第 8 讲 线性一致](lectures.html#lec8) · **参考**：[官方实验页](https://pdos.csail.mit.edu/6.5840/labs/lab-kvraft1.html) · [Raft 论文](https://raft.github.io/raft.pdf)
>
> **评分**：`LAB_ROOT=~/labs/6.5840 ./judge/run.sh infra01 lab4` · [评分标准](grading.html)
>
> [上一个：Lab 3](lab3.html) · [返回作业](labs.html) · [下一个：Lab 5](lab5.html)
>
> **难度** ★★★ · **先修** Lab 2/3（含 3D）+ 第 6–8 讲 · **时间** 8–12 小时 · **最小通过** 4A+4B 的 20 个测试（judge 显示 `PASS`）；**完整通过** 4A–4C
>
> judge 的 `min_pass` 与这一行一致，写在 `judge/courses/infra01.json`；改这一行就要同步改那里。

## 你将完成什么

多数派还活着时，客户端仍然能 `Put` 和 `Get`；leader 挂了，Clerk 换一台继续；整个组重启后，已经提交的写不会丢。做完这个实验，你会把 Lab 2 的单机 KV 放进 Lab 3 的 Raft，得到线性一致、`Put` 最多执行一次的复制服务。

验收命令在 `src` 下跑：

```bash
cd ~/labs/6.5840/src
make rsm1
make kvraft1
```

`make rsm1` 跑 4A 的 7 个测试和 4C 的 `TestSnapshot4C`；`make kvraft1` 跑 4B 的 13 个和 4C 的 9 个测试。全绿时最后一行是 `ok 6.5840/kvraft1/rsm ...` 和 `ok 6.5840/kvraft1 ...`。只跑 4A 用 `make RUN="-run 4A" rsm1`；只跑 4B/4C 用 `make RUN="-run 4B" kvraft1` 和 `make RUN="-run 4C" kvraft1`。

这个实验的五条不变量：

1. `Submit` 只有在 op 被 apply 之后才返回 `OK` 和结果；`raft.Start` 返回成功不等于提交成功。
2. 同一个 `Put` 重试只执行一次，返回第一次的结果；去重状态必须和 KV 一起进快照。
3. `Get` 也走 Raft，不能直接读本地 map，否则 leader 分区时会返回 stale 数据。
4. follower 收到 `Submit` 返回 `rpc.ErrWrongLeader`，让 Clerk 换一台；follower 不本地执行写。
5. 快照包含 KV、去重表（每个 key 的已应用版本）和 `lastApplied`；restore 后 apply 不倒退。

第一次跑 `make rsm1` 会看到：

```text
=== RUN   TestBasic4A
Test RSM basic (reliable network)...
    rsm_test.go:28: expected 0 instead of 0
```

两个 0 是测试消息的笔误：第 1 次 `Inc` 应该返回 1，你的 `Submit` 返回了 0。看到它说明测试已经接上你的 `rsm`，只是 `Submit` 还没等 apply。

## 开始之前

先读[第 6 讲](lectures.html#lec6)、[第 7 讲](lectures.html#lec7)和[第 8 讲](lectures.html#lec8)。第 6、7 讲给你 Raft 的提交规则、持久化和快照；第 8 讲给你线性一致的定义。论文读第 7 节即可，第 8 节的可读优化这个实验不需要。前置代码是 Lab 3 的 `raft1` 和 Lab 2 的 `kvsrv1`；Lab 3D 的 `Snapshot`/`InstallSnapshot` 必须已经通过，否则 4C 会卡在 follower 追日志。

环境检查：

```bash
cd ~/labs/6.5840/src
go version
ls kvraft1/rsm
ls kvraft1
```

预期：

```text
go version go1.23.5 linux/amd64
proxy.go  rsm.go  rsm_test.go  server.go  test.go
client.go  kvraft_test.go  server.go  test.go
```

版本不低于 `go1.22` 即可；`ls` 的文件名要对得上，少一个说明骨架版本不对。

这个实验只改三个文件：

- `src/kvraft1/rsm/rsm.go`：`Op`、`RSM`、`Submit` 和读 `applyCh` 的 goroutine。
- `src/kvraft1/server.go`：`KVServer` 的 `DoOp`、`Snapshot`、`Restore`、`Get`、`Put`。
- `src/kvraft1/client.go`：`Clerk` 的 leader 缓存和重试。

不要改 `src/kvraft1/rsm/server.go`、`proxy.go`、`rsm_test.go`、`test.go`，也不要改 `kvraft_test.go`、`src/kvsrv1/rpc/rpc.go`、`src/main/`。`rsm/server.go` 是 4A 的测试状态机：`rsmSrv` 已实现 `StateMachine`，`DoOp` 处理 `Inc`/`Null`，`GetCounter` 读计数。你不需要另写状态机或测试驱动，4A 只需要补 `rsm.go`。

测试把每个 server 放在独立进程里跑，`make` 先构建 `main/rsm1d` 和 `main/kvraft1d`，测试再通过 UNIX socket 连上去。只改 `rsm.go` 后直接 `go test` 会用到旧 daemon；用 `make` 目标，或手动重新 `go build -race -o main/rsm1d main/rsm1d.go`。

时间预算 8–12 小时。4A 先跑通，4B 再做故障，4C 最后加快照；不要一开始就同时改三处。

## 代码地图

| 文件 | 负责什么 | 能不能改 |
|---|---|---|
| `src/kvraft1/rsm/rsm.go` | `Op`、`RSM`、`Submit`、reader goroutine | 改 |
| `src/kvraft1/rsm/server.go` | 4A 的计数器状态机 `rsmSrv`、`Inc`/`Null`/`Dec`、`GetCounter` | 不改 |
| `src/kvraft1/rsm/proxy.go` | tester 到 server 的 RPC 代理 | 不改 |
| `src/kvraft1/rsm/rsm_test.go`、`test.go` | 4A 测试和测试驱动 | 不改 |
| `src/kvraft1/server.go` | `KVServer`、`DoOp`、`Snapshot`、`Restore`、`Get`、`Put`、`StartKVServer` | 改 |
| `src/kvraft1/client.go` | `Clerk` 的 `Get`/`Put`、leader 提示 | 改 |
| `src/kvraft1/kvraft_test.go`、`test.go` | 4B/4C 测试和测试驱动 | 不改 |
| `src/kvsrv1/rpc/rpc.go` | `PutArgs`、`GetArgs`、错误常量 | 不改，契约 |
| `src/main/rsm1d.go`、`kvraft1d.go` | 两个 daemon 的入口 | 不改 |
| `src/raft1/` | 你的 Lab 3 Raft | 只在暴露 bug 时改，改完重跑 Lab 3 |

`StartKVServer` 已经注册了 `rsm.Op`、`rpc.PutArgs`、`rpc.GetArgs`，也创建了 `rsm.MakeRSM(servers, me, persister, maxraftstate, kv)`，返回值是 `[]any{kv, kv.rsm.Raft()}`。你不用改注册，也不用自己造 Raft 实例。`MakeRSM` 里的 `if !tester.UseRaftStateMachine` 只是给测试替换 Raft 用的，正常路径会创建 `raft.Make`。

## 数据流 / 接口

一次 `Put` 的路径：

```text
client
  │ Put/Get RPC
  ▼
kvserver (leader)
  │ kv.Put -> rsm.Submit(req)
  │            │
  │            ├─ 注册 waiter[op.Id]
  │            ├─ rf.Start(Op{Me, Id, Req})
  │            └─ 等 waiter 或 done
  │                         ▲
  │                         │ result
  │            rsm reader ──┘
  │              │ msg := <-applyCh
  │              │ rep := sm.DoOp(op.Req)
  │              ▼
  └──────── reply ◄── waiter[Id]
```

看图时注意两个 goroutine：`Submit` 在 RPC handler 里等，reader 在 `applyCh` 上收。只有 reader 能把 `DoOp` 的结果送回 `Submit`；`Submit` 自己不能猜结果。

接口和结构体：

```go
type Op struct {
    Me  int
    Id  int64
    Req any
}

type StateMachine interface {
    DoOp(any) any
    Snapshot() []byte
    Restore([]byte)
}

func MakeRSM(servers []*labrpc.ClientEnd, me int, persister *tester.Persister,
    maxraftstate int, sm StateMachine) *RSM

func (rsm *RSM) Submit(req any) (rpc.Err, any)
func (rsm *RSM) Raft() raftapi.Raft
```

- `Op` 的字段必须大写，`labgob` 和 RPC 才看得到。`Id` 用 `int64`，每次 `Submit` 生成一个全局唯一值，不能只用进程内从 0 开始的计数器。
- `Submit` 返回 `(rpc.Err, any)`。`rpc.OK` 表示 op 已 apply，第二个值是 `DoOp` 的返回值；`rpc.ErrWrongLeader` 表示换一台 server 重试。
- `DoOp` 收到的是 `op.Req`，不是整个 `Op`；官方页要求它的参数类型和传给 `Submit` 的一致，`rsm/server.go` 也是按 `Inc` 直接断言。
- `raftapi.Raft` 提供 `Start(command) (index, term, isLeader)`、`GetState() (term, isLeader)`、`Snapshot(index, snapshot)` 和 `PersistBytes() int`。
- `ApplyMsg` 有两种：`CommandValid` 为真时带 `Command`/`CommandIndex`，`SnapshotValid` 为真时带 `Snapshot`/`SnapshotIndex`/`SnapshotTerm`。

错误码：

| 错误 | 谁返回 | 含义 |
|---|---|---|
| `rpc.OK` | server | op 已 apply，结果有效 |
| `rpc.ErrNoKey` | KV `Get` | key 不存在 |
| `rpc.ErrVersion` | KV `Put` | 期望版本和当前版本不匹配 |
| `rpc.ErrMaybe` | Clerk | 重试后的 `ErrVersion`，第一次可能已经执行 |
| `rpc.ErrWrongLeader` | `Submit`/handler | 这台不是 leader，换一台 |
| `rpc.ErrWrongGroup` | Lab 5 的 shardgrp | 这个 shard 不归我管 |

KV 的请求类型是固定的：

```go
type PutArgs struct { Key, Value string; Version Tversion }
type PutReply struct { Err Err }
type GetArgs struct { Key string }
type GetReply struct { Value string; Version Tversion; Err Err }
```

`Clerk` 的公开方法：

```go
func MakeClerk(clnt *tester.Clnt, servers []string) kvtest.IKVClerk
func (ck *Clerk) Get(key string) (string, rpc.Tversion, rpc.Err)
func (ck *Clerk) Put(key string, value string, version rpc.Tversion) rpc.Err
func (ck *Clerk) Leader() int
```

`Leader()` 返回最后一次成功的 leader 在 `servers` 里的下标，`TestOnePartition4B` 用它来切网络。每次 RPC 成功都要更新 `leader`，否则测试可能切错 server。

## 阶段 1：4A 先让一条 Inc 走完

目标：`make RUN="-run 4A" rsm1` 全绿。只改 `rsm.go`。

最小路径：

1. 给 `RSM` 加 `persister`、`waiting map[int64]chan result`、`lastApplied int`、`nextId int64`、`done chan struct{}`。`waiting` 的 channel 至少缓冲 1，否则 reader 会阻塞在 send 上。
2. 在 `MakeRSM` 里启动 reader goroutine；`MakeRSM` 必须马上返回，不能在里面读 snapshot 或等 Raft。
3. `Submit` 先生成唯一 `Id`，注册 waiter，再调用 `rf.Start`。注册必须在 `Start` 前，否则 op 可能在注册前 apply，结果没人接。
4. `Start` 返回 `isLeader == false` 时，删掉 waiter，返回 `ErrWrongLeader`。返回 `true` 时记住 `index` 和 `term`，等 waiter。
5. reader 循环读 `applyCh`。`CommandValid` 时先跳过 `CommandIndex <= lastApplied`；否则把 `msg.Command` 断言成 `Op`，调用 `sm.DoOp(op.Req)`，更新 `lastApplied`，再把结果送到 `waiting[op.Id]` 并删除。
6. `applyCh` 关闭时，关闭 `done` 并把所有 waiter 以 `ErrWrongLeader` 唤醒。`TestShutdown4A` 要求 `Kill()` 之后 `Submit` 能停下来。
7. leader 在 `Start` 后丢了 leadership 时，起一个轻量 watcher 定期 `rf.GetState()`；term 变了或自己不是 leader，就把 waiter 以 `ErrWrongLeader` 唤醒。

这里有一个容易写反的点。`TestLeaderPartition4A` 把 leader 单独分区，并发提交 100 个 `Dec`，检查这些 `Submit` 在愈合前没有全部返回。如果你在 `Start` 成功后立刻返回 `ErrWrongLeader`，它们会很快结束，测试报 `Dec's in minority completed`。正确做法是等：分区中的旧 leader 收不到更高 term，就不知道新 leader 存在，只能等网络恢复或进程被杀。官方页允许这种等待，因为同一分区里的客户端也找不到新 leader。

跑：

```bash
cd ~/labs/6.5840/src
make RUN="-run 4A" rsm1
```

官方示例的输出：

```text
=== RUN   TestBasic4A
Test RSM basic (reliable network)...
  ... Passed --  time  4.2s #peers 3 #RPCs    50 #Ops   10
--- PASS: TestBasic4A (4.57s)
...
--- PASS: TestRestartSubmit4A (40.21s)
PASS
ok      6.5840/kvraft1/rsm  93.691s
```

通过标志是 7 个 `--- PASS` 和最后的 `ok`。`TestRestartReplay4A` 和 `TestRestartSubmit4A` 各要 30–40 秒。如果 `TestBasic4A` 报 `expected 0 instead of 0`，先看 `Submit` 是不是在 `DoOp` 之前就返回了，或者 reader 把结果送给了错的 waiter。

## 阶段 2：4B 把 KV 放上 RSM

目标：`make RUN="-run 4B" kvraft1` 全绿。

改 `server.go`：

1. `KVServer` 加 `mu`、`data map[string]string`、`versions map[string]rpc.Tversion`；`versions` 是每个 key 已应用的版本，也是去重表。
2. `DoOp` 用类型 switch 分 `rpc.GetArgs` 和 `rpc.PutArgs`；`Get` 不存在返回 `ErrNoKey`，`Put` 按 Lab 2 的版本规则处理，成功时版本加一。
3. `Get`/`Put` handler 只调用 `kv.rsm.Submit(args)`；`err != rpc.OK` 就把 `reply.Err = err`，否则把 `rep` 断言成对应 reply。
4. `StartKVServer` 已注册 `rsm.Op`、`rpc.PutArgs`、`rpc.GetArgs`，不要漏。

`Put` 的版本规则和 Lab 2 一样：

| 情况 | 行为 |
|---|---|
| key 不存在，`Version == 0` | 创建，存值，版本变 1，`OK` |
| key 不存在，`Version > 0` | `ErrNoKey` |
| key 存在，`Version == 当前版本` | 更新值，版本加 1，`OK` |
| key 存在，`Version != 当前版本` | `ErrVersion` |

这张表就是去重逻辑：重复的 `Put` 到 apply 时版本已经小于当前版本，返回 `ErrVersion`，不会再写一次。不要另外维护按请求 ID 的全量缓存，`TestSnapshotSize4C` 只允许 500 字节；Put 的唯一标识就是 `(key, version)`。如果你加 client ID 和序号，去重表是 `map[clientID]lastSeq` 加最后一次回复，同样要进快照，而且每个 client 只留最后一条。

改 `client.go`：

1. `Clerk` 里 `leader` 是 `servers` 的下标，`MakeClerk` 可以初始化为 0。
2. `Get` 从 `leader` 开始，RPC 失败或 `ErrWrongLeader` 就换下一个，直到拿到 `OK` 或 `ErrNoKey`。`Get` 对外不返回 `ErrWrongLeader`。
3. `Put` 同理，但要记住“这是第几次发”。第一次收到 `ErrVersion` 返回 `ErrVersion`；重发后收到 `ErrVersion` 返回 `ErrMaybe`，因为第一次可能已经写成功但回复丢了。
4. RPC 失败（`ok == false`）也算一次发送；之后收到 `ErrVersion` 要按重发处理，返回 `ErrMaybe`。
5. 每次成功都更新 `leader`。`TestSpeed4B` 要求 1000 次 Put 的平均时间约 33 ms，每次都从 0 开始扫 5 台会太慢。

跑：

```bash
cd ~/labs/6.5840/src
make RUN="-run 4B" kvraft1
```

官方示例的开头和结尾：

```text
=== RUN   TestBasic4B
Test: one client (4B basic) (reliable network)...
  ... Passed --  time  3.5s #peers 5 #RPCs   395 #Ops  122
--- PASS: TestBasic4B (4.11s)
...
--- PASS: TestPersistPartitionUnreliableLinearizable4B (24.94s)
PASS
ok      6.5840/kvraft1  175.518s
```

通过标志是 13 个 `--- PASS`。如果 `TestBasic4B` 报 `Fatal: Wrong error`，先检查 `Clerk.Put` 有没有把 `ErrWrongLeader` 返回给调用方；`kvtest.OnePut` 只接受 `OK`、`ErrVersion`、`ErrMaybe`，其他错误会直接 Fatal。另一个常见原因是 `Get` 直接读了本地 map，`TestOnePartition4B` 会在少数派里读到旧值。

## 阶段 3：4C 加 snapshot

目标：`make RUN="-run 4C" kvraft1` 全绿，`rsm` 包的 `TestSnapshot4C` 也通过。

改 `rsm.go`：

1. 把 `persister` 存到 `RSM` 上。`MakeRSM` 已经收到它，骨架没保存。
2. reader 启动时先读 `persister.ReadSnapshot()`。长度大于 0 就解码，调用 `sm.Restore(payload)`，把 `lastApplied` 设成快照里的 index，再进 `applyCh` 循环。
3. 每次 apply 后检查 `maxraftstate > 0 && rsm.rf.PersistBytes() >= maxraftstate`。到阈值就 `state := sm.Snapshot()`，外面包一层 `{LastApplied, State}`，调用 `rf.Snapshot(lastApplied, blob)`。不要在每次 apply 都做快照，`TestSpeed4C` 会慢到超时。
4. 收到 `ApplyMsg{SnapshotValid: true}` 时，解码 `msg.Snapshot`，调用 `sm.Restore`，把 `lastApplied` 设成 `msg.SnapshotIndex`。还有等旧 index 的 `Submit` 就用 `ErrWrongLeader` 唤醒，它们的 op 可能已被快照跳过。
5. `maxraftstate == -1` 时永远不调用 `rf.Snapshot`。`GenericTest` 会检查 `SnapshotSize() == 0`，做了快照就失败。

改 `server.go`：

1. `Snapshot` 编码 `data` 和 `versions`，字段大写。`Restore` 解码后覆盖这两个 map，不能和旧状态合并。
2. 整个快照字节里要能恢复三样：KV、去重表、`lastApplied`。前两样在 `KVServer.Snapshot()` 的负载里，`lastApplied` 由 `rsm` 外层包进去；`Restore` 先拆外层，再把负载交给 `KVServer.Restore`。
3. 快照不能包含 Raft 日志、请求历史或每个请求的回复。`TestSnapshotSize4C` 在 200 轮 Put/Get 后要求快照不超过 500 字节；一个 key 的值加版本加 `lastApplied` 就够了。

跑：

```bash
cd ~/labs/6.5840/src
make RUN="-run 4C" kvraft1
make RUN="-run TestSnapshot4C" rsm1
```

官方示例：

```text
=== RUN   TestSnapshotRPC4C
Test: snapshots, one client (4C SnapshotsRPC) (reliable network)...
Test: InstallSnapshot RPC (4C) (reliable network)...
  ... Passed --  time  4.8s #peers 3 #RPCs   248 #Ops   72
--- PASS: TestSnapshotRPC4C (5.18s)
...
PASS
ok      6.5840/kvraft1  130.724s
```

通过标志是 9 个 `--- PASS`，加上 `rsm` 的 `TestSnapshot4C`。如果 `TestSnapshotRPC4C` 失败，先确认 Lab 3D 的 `InstallSnapshot` 真的把 follower 的日志截断并更新了 `commitIndex`；如果 `TestSnapshotSize4C` 报 `snapshot too large`，先看 `Snapshot` 里是不是编了整张请求表。

## 阶段 4：收尾和回归

目标：全量和 `-race` 都稳定。

1. `make rsm1`、`make kvraft1` 各跑 3 次，确认没有偶发失败。
2. `make raft1` 再跑一次。4C 会暴露 Raft 的 snapshot bug；你改过 `raft1` 就必须重跑 Lab 3。
3. 跑 judge：

```bash
cd ~/infra-systems
LAB_ROOT=~/labs/6.5840 ./judge/run.sh infra01 lab4
```

预期：

```text
CHECK PASS "4A RSM" ""
CHECK PASS "4B KV" ""
CHECK PASS "4C snapshot" ""
SCORE 3/3
```

`--quick` 只跑 4A 和 4B，最高显示 `PARTIAL`，不算通过。注意 judge 的 `4A RSM` 检查跑的是不带 `-run` 的 `make rsm1`，所以 `TestSnapshot4C` 也会跑；只做 4A 时可以用 `-run 4A` 跳过它，提交前要让它一起绿。

## 测试与判分

4A 的 7 个测试在 `kvraft1/rsm` 包，服务端是 `rsm1d`，每组 3 个 peer：

| 测试 | 测什么 | 慢但正常 |
|---|---|---|
| `TestBasic4A` | 10 次 `Inc`，返回递增计数，三台最终一致 | 约 4 秒 |
| `TestConcurrent4A` | 50 个并发 `Inc`，最终计数 50 | 约 1 秒 |
| `TestLeaderFailure4A` | 断开 leader，剩下两台仍能提交，重连后一致 | 约 3 秒 |
| `TestLeaderPartition4A` | 少数派 leader 的 100 个 `Dec` 不能提交；愈合后全部返回 | 约 4 秒 |
| `TestRestartReplay4A` | 100 次 `Inc` 后全组重启，replay 后是 100，再提交是 101 | 约 28 秒 |
| `TestShutdown4A` | 100 个并发 `Null` 时 `Kill()`，`Submit` 要在 11 秒内停 | 约 10 秒 |
| `TestRestartSubmit4A` | 重启后的新提交不能和老 op 混淆 | 约 40 秒 |
| `TestSnapshot4C` | 100 次 `Inc`，`RaftSize() <= 2000`，重启后恢复再加一 | 未单列 |

4B 的 13 个测试在 `kvraft1` 包，覆盖 1–15 个 client、5–7 台 server、可靠/不可靠网络、重启和分区：

| 测试 | 测什么 |
|---|---|
| `TestBasic4B` | 1 个 client、5 台 server 的基本 Put/Get |
| `TestSpeed4B` | 1000 次 Put，平均每次约 33 ms |
| `TestConcurrent4B` | 5 个 client 并发 |
| `TestUnreliable4B` | 5 个 client，丢包/重排 |
| `TestOnePartition4B` | 少数派不能完成 Put/Get，愈合后完成 |
| `TestManyPartitionsOneClient4B` / `ManyClients4B` | 反复分区 |
| `TestPersistOneClient4B` / `Concurrent4B` / `ConcurrentUnreliable4B` | 重启后恢复 |
| `TestPersistPartition4B` / `PartitionUnreliable4B` | 重启加分区 |
| `TestPersistPartitionUnreliableLinearizable4B` | 15 个 client、7 台 server、随机 key，Porcupine |

4C 的 9 个测试：

| 测试 | 测什么 | 慢但正常 |
|---|---|---|
| `TestSnapshotRPC4C` | 落后的 follower 靠 InstallSnapshot 追上，日志被裁剪 | 约 5 秒 |
| `TestSnapshotSize4C` | 快照不超过 500 字节，Raft 状态不超过 8000 字节 | 约 21 秒 |
| `TestSpeed4C` | 有快照时 1000 次 Put 仍然够快 | 约 25 秒 |
| `TestSnapshotRecover4C` / `ManyClients4C` | 重启后从快照恢复 | 约 9–13 秒 |
| `TestSnapshotUnreliable4C` / `Recover4C` | 不可靠网络下的快照 | 约 6–11 秒 |
| `TestSnapshotUnreliableRecoverConcurrentPartition4C` / `Linearizable4C` | 分区、重启、快照、随机 key | 约 20 秒 |

`TestPersistPartitionUnreliableLinearizable4B` 和 4C 的 Linearizable 测试可能打印 `info: linearizability check timed out, assuming history is ok`。这是 Porcupine 没算完，按通过处理。

`-race` 默认打开，慢机器按 2 倍估。

## 常见错误：现象、原因、处理

| 现象 | 原因 | 处理 |
|---|---|---|
| `expected 0 instead of 0` | `Submit` 在 `DoOp` 之前返回了 0 | 先注册 waiter，再 `Start`，只在 reader 送到结果后返回 |
| `Submit` 一直不返回 | waiter 在 `Start` 后才注册，结果错过；或 channel 无缓冲 | 注册放到 `Start` 前；channel 至少缓冲 1 |
| `TestLeaderPartition4A` 报 `Dec's in minority completed` | 旧 leader 立刻返回 `ErrWrongLeader` | `Start` 成功后等 term 变化或 `done` |
| `Submit didn't stop after shutdown` | `applyCh` 关闭后没唤醒 waiter | reader 检测 `ok == false`，关闭 `done` 并 fail 所有 waiter |
| `TestRestartSubmit4A` 偶发错结果 | 重启后 `Op.Id` 从 0 重新开始，和老 op 撞了 | 用随机前缀或 `time.Now().UnixNano()` 加原子计数 |
| `Fatal: Wrong error` | `Clerk` 把 `ErrWrongLeader` 返回给调用方 | Clerk 内部换 server，只对外返回 `OK`/`ErrVersion`/`ErrMaybe`/`ErrNoKey` |
| 少数派里读到旧值 | `Get` 直接读本地 map | `Get` 也走 `rsm.Submit`，让 Raft 排序 |
| 重启后计数翻倍 | `lastApplied` 没恢复，快照前的日志又被 apply | 启动时从快照恢复 `lastApplied`；apply 时跳过 `CommandIndex <= lastApplied` |
| `logs were not trimmed` | 没做快照，或阈值设成 `8*maxraftstate` 才做 | 在 `PersistBytes() >= maxraftstate` 附近就做 |
| `snapshot too large` | 快照里塞了日志、请求历史或全量去重缓存 | 只存 KV、每个 key 的版本、`lastApplied` |
| `labgob` 警告字段小写 | `Op` 或快照结构体字段没大写 | 所有跨 Raft/快照的字段首字母大写 |
| `close of closed channel` 或 send on closed | 关闭 waiter channel 而不是关闭 `done` | 只关闭 `done`，waiter channel 只发送不关闭 |

## 调试手册

1. **只跑一个测试，把日志留下来。**

   ```bash
   cd ~/labs/6.5840/src
   make RUN="-run TestBasic4B" kvraft1 > /tmp/kvraft-basic.log 2>&1
   tail -40 /tmp/kvraft-basic.log
   ```

   先看最后 40 行，确认失败、卡住还是通过；`make` 的输出带构建和测试两段，不要把构建错误当成测试失败。

2. **在 `Submit` 和 reader 各打一行。**

   `Submit` 打 `op.Id`、`term`、`index`、`isLeader`，reader 打 `CommandIndex`、`op.Id`、结果类型。正常顺序是注册、`Start`、同 index apply、唤醒 waiter；同一个 `Id` 对不上就是送错，同一个 index apply 两次就是 `lastApplied` 没更新。

3. **在 `DoOp` 打 key、version、当前版本、返回的 Err。**

   同一个 key 和 version 出现两次、第二次返回 `ErrVersion` 是正常的；第二次返回 `OK` 说明版本没加一，或用了两张不一致的表。

4. **检查快照边界。**

   打 `PersistBytes`、`maxraftstate`、`lastApplied`、快照长度。`TestSnapshotSize4C` 的 500 字节是硬上限；`TestSnapshot4C` 的 `RaftSize() <= 2*maxraftstate` 说明快照太晚或没截断日志。

5. **确认进程和二进制是新的。**

   `ps aux | grep kvraft1d` 能看到 daemon。改完代码用 `make`；直接 `go test` 可能还在跑旧二进制。残留进程用 `pkill -f kvraft1d` 清掉，先确认不是别的测试。

6. **用 `-race` 跑。**

   `make` 默认 `RACE=-race`。调试时可以临时 `RACE=` 关掉，提交前用默认值跑一遍；waiter map、`KVServer` 的 map、`lastApplied` 都是常见竞态点。

7. **看 Porcupine 的可视化。**

   线性一致失败时，`kvtest1/porcupine.go` 会把 history 写到 `porcupine-*.html` 并打印路径。打开看哪个操作的调用/返回区间和值冲突；线性一致检查的是实时顺序，不是最后的值。

## 提交前检查

- [ ] `make rsm1`、`make kvraft1` 全绿；4B/4C 关键测试各跑 3 次。
- [ ] 默认 `-race` 跑过；没有 data race 或卡住的 goroutine。
- [ ] `Submit` 只在 apply 后返回 `OK`；follower 和丢 leadership 的 leader 返回 `ErrWrongLeader`。
- [ ] 去重表和 `lastApplied` 在快照里；restore 后不重复 apply。
- [ ] `maxraftstate == -1` 时无快照；`> 0` 时状态在限制内，快照不超过 500 字节。
- [ ] `make raft1` 仍然全绿；改过 `raft1` 的话，Lab 3 的 3A–3D 都重跑过。
- [ ] 能讲清 `Submit`/reader 握手、线性一致读、快照边界。
- [ ] 写了 300 字复盘：不变量、取舍、暴露问题的测试、根因、风险（模板见[评分标准](grading.html#reflection)）。

## 自测问题

1. `Submit` 怎么知道 apply 的是自己提交的那个 op，而不是另一个客户端的？
2. 为什么 `Get` 也要走 Raft？只读本地 map 会破坏什么？
3. 重复提交的 op 应该在 apply 时去重，还是在 `Submit` 时去重？两者的失败场景有什么不同？
4. snapshot 为什么要包含去重表？只存 KV 数据会怎样？
5. follower 收到 `Submit` 时应该返回什么？为什么不能本地执行？
6. `Submit` 在 leader 被单独分区时为什么要等，而不是立刻返回 `ErrWrongLeader`？

### 答案要点

1. 每个 `Submit` 生成唯一 `Op.Id`，在 `waiting` 里注册自己的 channel；reader 按 `Id` 找 waiter，只送结果给对应调用。`Me` 只用于调试。
2. leader 可能已被分区却还认为自己活着，本地 map 会落后于已提交的新值。把 `Get` 写进日志，只有能提交的 leader 才能返回，读一定排在此前所有提交之后。ReadIndex/lease 是优化，不是要求。
3. 在 apply 时去重。`Submit` 时看不到已提交但未 apply 的 op，也看不到重启前别的 leader 提交的 op，还可能把合法重试当成新请求。状态机按 `(key, version)` 或 `(clientID, seq)` 判断最可靠。
4. 快照丢掉之前的日志；去重表不在快照里，重启后无法判断旧版本的 `Put` 是否执行过，可能再写一次。`lastApplied` 也要在快照里，否则会把已包含的日志再 apply 一遍。
5. 返回 `rpc.ErrWrongLeader`。follower 状态可能落后，也没资格排序；本地执行会让副本分叉。它仍从 `applyCh` 应用已提交的 op，只是不接客户端写。
6. `Start` 已成功，op 仍在旧 leader 日志里；它重新连上多数派后可能提交。立刻返回会让客户端去别处重试；`TestLeaderPartition4A` 还要求旧 leader 在愈合前不要结束这些调用。只有看到更高 term 或自己不再是 leader，才能确定 op 丢了。
