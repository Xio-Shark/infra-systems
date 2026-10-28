# Lab 4 中文精读：Fault-tolerant Key/Value Service

> 官方页：https://pdos.csail.mit.edu/6.5840/labs/lab-kvraft1.html
>
> 本站是忠实于 lab 要求的中文导读，保留技术术语英文；不提供可直接提交的代码。
> 课程要求独立完成。

## 一句话

用 Lab 3 的 Raft 把 Lab 2 的单机 KV 变成容错服务：多个 server 用 Raft 复制同一个状态机；只要多数派活着，服务就能继续处理 `Put`/`Get`，并且保持 **linearizable**、`Put` **at-most-once**。

Lab 4 分三部分：

- **4A**：通用的 replicated state machine（`rsm`）。
- **4B**：用 `rsm` 实现 KV，不带 snapshot。
- **4C**：加 snapshot，让 Raft 可以丢弃旧日志。

## 代码结构

- `src/kvraft1/rsm/rsm.go`：`RSM`、`StateMachine` 接口、`Submit`。
- `src/kvraft1/rsm/server.go`、`proxy.go`：测试用的辅助代码，先读，不要改。
- `src/kvraft1/server.go`：`KVServer`，实现 `DoOp`、`Snapshot`、`Restore`、`Get`、`Put`。
- `src/kvraft1/client.go`：`Clerk`，实现 `Get`/`Put`，负责找 leader 和重试。
- `src/kvraft1/kvraft_test.go`：测试，不要改。
- `src/kvsrv1/rpc/rpc.go`：复用 Lab 2 的 `PutArgs`/`GetArgs`/`Err`。

`StartKVServer` 已经帮你做了：

```go
labgob.Register(rsm.Op{})
labgob.Register(rpc.PutArgs{})
labgob.Register(rpc.GetArgs{})

kv := &KVServer{me: me}
kv.rsm = rsm.MakeRSM(servers, me, persister, maxraftstate, kv)
return []any{kv, kv.rsm.Raft()}
```

## 整体数据流

```text
client -> Clerk -> kvserver (RPC)
                    |
                    v
              rsm.Submit(op)
                    |
                    v
              raft.Start(op)
                    |
        (commit + apply on every peer)
                    |
                    v
              rsm reader <- applyCh
                    |
                    v
              kv.DoOp(op)  -> result
                    |
                    v
              Submit returns result to RPC handler
```

关键点：`raft.Start()` 只保证“日志被接受”，不保证“已经提交”。`rsm` 要把 `Start` 返回的 index 和 `applyCh` 上来的 `CommandIndex` 对上，才能把结果还给客户端。

## 4A：Replicated State Machine

目标：实现 `rsm.Submit(req any) (rpc.Err, any)` 和一个 reader goroutine。

### `Op` 结构

`rsm.Op` 是空的，你自己定义。至少要有：

- 一个唯一 ID（用来匹配 `Submit` 和 `applyCh`）。
- 客户端请求本身（`PutArgs` 或 `GetArgs`）。
- 可能还要 `ClientId`、`Seq`，用于去重（4B 会用到）。

字段首字母大写，否则 `labgob` 编码会丢。

### reader goroutine

`MakeRSM` 里启动一个 goroutine：

```text
for msg := range applyCh {
    if msg.CommandValid {
        result := sm.DoOp(msg.Command)
        // 用 msg.Command 里的唯一 ID 找到等待中的 Submit
        // 把 result 交给它
    }
    if msg.SnapshotValid {
        sm.Restore(msg.Snapshot)
        // 更新 lastApplied / snapshot index
    }
}
```

注意：

- `DoOp` 在每个 peer 上都会执行；只有 leader 上的 `Submit` 在等结果。
- `applyCh` 是单 goroutine 读的；不要多个 goroutine 同时读。
- 发送结果给 `Submit` 时不要持锁阻塞；用 channel 或 `sync.Cond`。

### `Submit`

```text
func Submit(req any) (rpc.Err, any) {
    生成唯一 id
    op := Op{Id: id, Req: req}

    index, term, isLeader := rf.Start(op)
    if !isLeader { return ErrWrongLeader, nil }

    等待 id 对应的结果：
      - 如果 applyCh 上来了这个 id，返回结果
      - 如果 rf.GetState() 的 term 变了，或 index 处出现了不同的 op，
        返回 ErrWrongLeader（领导权可能丢了）
      - 如果自己是被分区的旧 leader，可能永远等不到；
        这是允许的，因为同一分区的客户端也找不到新 leader
}
```

关键点：

- `Start` 之后 leader 可能立刻失去领导权；不能假设“Start 成功 = 会提交”。
- 判断“领导权变了”可以用 term 变化，或检查 `index` 处的 op 是否还是自己提交的那个。
- 返回 `ErrWrongLeader` 让 Clerk 换一个 server 重试。
- 不要持锁等待；等待时释放锁，收到结果再加锁。

### 4A 的测试

```bash
cd ~/labs/6.5840/src
make rsm1
make RUN="-run 4A" rsm1
```

测试用一个简单的整数状态机，检查：

- 基本 Submit/apply。
- 并发 Submit。
- leader 失败/分区。
- 重启后 replay。
- shutdown。

## 4B：KV Service（不带 snapshot）

目标：用 `rsm` 实现 `KVServer` 的 `Get`/`Put`，让 `kvraft1` 的测试通过。

### Server

`KVServer` 维护一个 map：

```go
type KVServer struct {
    me  int
    rsm *rsm.RSM

    mu   sync.Mutex
    data map[string]entry
}

type entry struct {
    value   string
    version rpc.Tversion
}
```

`Get`：

```text
rep, err := kv.rsm.Submit(args)
if err == ErrWrongLeader {
    reply.Err = ErrWrongLeader
    return
}
*reply = rep.(rpc.GetReply)
```

`Put` 同理，返回 `rep.(rpc.PutReply)`。

`DoOp`：

```text
switch req := req.(type) {
case rpc.GetArgs:
    查 map，返回 GetReply
case rpc.PutArgs:
    按 Lab 2 的版本规则更新 map，返回 PutReply
}
```

为什么 `Get` 也要走 Raft？因为 follower 可能落后；如果直接在本地读，会返回 stale data，破坏 linearizability。课程允许你做 read-only optimization（lease/read index），但 4B 不要求；最稳的是所有 `Get` 都进 Raft log。

### 去重 / at-most-once

`kvtest` 的 `Put` 还是带 version 的：重复的 `Put` 如果已经执行，第二次会得到 `ErrVersion`，不会重复写。这就是 Lab 2 的 at-most-once 机制。

如果你在 `Op` 里加了 `ClientId`/`Seq`，也可以在 `DoOp` 里做请求去重；但注意：去重表要包含在 snapshot 里（4C），否则重启后会丢。

### Clerk

- `Get`/`Put` 先发给上次成功的 leader（`ck.leader`）。
- 收到 `ErrWrongLeader` 就换下一个 server。
- 网络失败就重试；`Call` 返回 `false` 表示没收到 reply。
- `Put` 的 `ErrMaybe` 语义和 Lab 2 一样：第一次 `ErrVersion` 返回 `ErrVersion`；重发后 `ErrVersion` 返回 `ErrMaybe`。
- 每次 RPC 前 `reply` 清零。

### 4B 的测试

```bash
make kvraft1
make RUN="-run 4B" kvraft1
```

测试包括：单客户端、速度、多客户端、不可靠网络、分区、重启、线性一致检查。

## 4C：Snapshot

目标：当 Raft 持久化状态超过 `maxraftstate` 时，让 `rsm` 调 `StateMachine.Snapshot()`，把快照交给 Raft；Raft 丢弃旧日志。

### 触发条件

- `maxraftstate` 是 `StartKVServer` 传进来的。
- 如果 `maxraftstate == -1`，不需要 snapshot。
- 否则比较 `rf.PersistBytes()` 和 `maxraftstate`；接近阈值时 snapshot。

### `Snapshot` / `Restore`

`KVServer.Snapshot()`：

- 序列化整个 map（包括 value、version、去重表）。
- 返回 `[]byte`。

`KVServer.Restore(data)`：

- 反序列化，替换 map。
- 重置任何“已应用 index”状态。

`rsm` 的 reader goroutine：

- 每 apply 一条命令，更新 `lastApplied`。
- 如果 `rf.PersistBytes() > maxraftstate`，调用 `sm.Snapshot()`，再 `rf.Snapshot(lastApplied, data)`。
- 收到 `ApplyMsg{SnapshotValid: true}` 时，调用 `sm.Restore(msg.Snapshot)`，并更新 `lastApplied = msg.SnapshotIndex`。

### 4C 的坑

- snapshot 的 index 必须是“已经 apply 的 index”，不是 `commitIndex`。
- `Restore` 后，`lastApplied` 要跟上 snapshot index，否则会重复 apply。
- 去重表必须进 snapshot；否则重启后可能重复执行 Put。
- `maxraftstate` 限制的是 Raft 持久化状态（包括 log），不是整个进程内存。
- 4C 会暴露 4A/4B 的 bug；如果 4C 挂了，先重跑 4A/4B。

### 4C 的测试

```bash
make RUN="-run 4C" kvraft1
make kvraft1
```

## 测试与调试

```bash
cd ~/labs/6.5840/src
make rsm1
make kvraft1
make RUN="-run 4A" rsm1
make RUN="-run 4B" kvraft1
make RUN="-run 4C" kvraft1
```

调试建议：

- 在 `Submit`、`DoOp`、apply 处打印 op id、index、term、结果。
- 先跑 4A，确保 `rsm` 的匹配逻辑对；再跑 4B，最后 4C。
- 用 `-race`；`rsm` 的 reader 和 Submit 很容易有竞态。
- 如果测试卡住，检查是不是 `Submit` 在等一个永远不会 apply 的 op；看 term 是否变了。
- 如果 `Get` 返回旧值，检查是不是没走 Raft，或者 apply 顺序不对。

## 常见坑

- [ ] `Submit` 把 `Start` 成功当成提交成功。
- [ ] `Submit` 等待时持锁，导致 reader 无法推进。
- [ ] `applyCh` 被多个 goroutine 读。
- [ ] `DoOp` 在 follower 上也返回结果给客户端（只有 leader 的 Submit 在等）。
- [ ] `Get` 直接读本地 map，返回 stale data。
- [ ] `Put` 的版本规则写错（0 表示创建，大于 0 且 key 不存在返回 ErrNoKey）。
- [ ] Clerk 不换 leader，一直发同一个 server。
- [ ] `ErrMaybe` 语义写错。
- [ ] snapshot 的 index 用错。
- [ ] 去重表没进 snapshot。
- [ ] `labgob.Register` 漏了 `rsm.Op` 或请求类型。

## 和 Lab 5 的关系

Lab 5 会复用：

- `rsm` 作为通用的 replicated state machine。
- `KVServer` 的 `DoOp`/`Snapshot`/`Restore` 结构。
- Clerk 的找 leader、重试、ErrWrongLeader 逻辑。

Lab 4 写干净，Lab 5 会轻松很多。

## 自测问题

- 为什么 `Get` 也要走 Raft？什么情况下可以不走？
- `Submit` 怎么判断自己已经失去领导权？
- 为什么 snapshot 的 index 不能大于 `lastApplied`？
- 去重表为什么必须进 snapshot？
- 如果 leader 被分区，`Submit` 一直等不到结果，客户端会怎样？
