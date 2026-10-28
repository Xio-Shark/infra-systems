# Lab 2 中文精读：Key/Value Server

> 官方页：https://pdos.csail.mit.edu/6.5840/labs/lab-kvsrv1.html
>
> 本站只讲要求、设计、测试和常见坑，不提供可直接提交的代码。课程要求独立完成。

## 一句话

实现一个单机 key/value 服务，保证：

- 每个 `Put` 在 network failure 下 **at-most-once**（最多执行一次）。
- 所有 `Put` / `Get` 从客户端看是 **linearizable**（线性一致）。

然后用这个 KV 服务实现一个分布式锁。这个 lab 是 Lab 4（Raft 上的 KV）的前置。

## 协议

服务端为每个 key 存 `(value, version)`。`version` 是这个 key 被写过的次数。

```go
type Tversion uint64

type PutArgs struct {
    Key     string
    Value   string
    Version Tversion
}

type GetArgs struct {
    Key string
}

type GetReply struct {
    Value   string
    Version Tversion
    Err     Err
}
```

### Put 的语义

| 情况 | 行为 |
|---|---|
| key 不存在，`version == 0` | 创建 key，存 value，version 变成 1，返回 `OK` |
| key 不存在，`version > 0` | 返回 `ErrNoKey` |
| key 存在，`version == 当前 version` | 更新 value，version 加 1，返回 `OK` |
| key 存在，`version != 当前 version` | 返回 `ErrVersion` |

### Get 的语义

- key 存在：返回 value、version、`OK`。
- key 不存在：返回 `ErrNoKey`。

### 为什么版本号能实现 at-most-once

客户端重发同一个 `Put` 时，带的 version 不变：

- 如果第一次已经执行，服务端的 version 已经加 1；重发会得到 `ErrVersion`，不会执行第二次。
- 如果第一次没执行，重发会正常执行。

所以服务端不需要为每个客户端维护去重表，版本号本身就是去重机制。

## 代码结构

- `src/kvsrv1/client.go`：`Clerk`，实现 `Get` / `Put`，负责重试。
- `src/kvsrv1/server.go`：`KVServer`，实现 `Get` / `Put` RPC handler。
- `src/kvsrv1/rpc/rpc.go`：RPC 类型和错误常量（不用改）。
- `src/kvsrv1/lock/lock.go`：用 KV 实现锁，实现 `Acquire` / `Release`。
- `src/kvtest1/`：测试工具，`kvtest.RandValue(n)` 可以生成唯一 ID。

## Part 1：可靠网络下的 KV

先假设网络不丢包、不重排。目标是把 `Get` / `Put` 跑通。

### Server

```go
type KVServer struct {
    mu   sync.Mutex
    data map[string]entry
}

type entry struct {
    value   string
    version rpc.Tversion
}
```

`Get`：

1. 加锁。
2. 查 map。
3. 不存在 → `reply.Err = rpc.ErrNoKey`。
4. 存在 → 填 `Value`、`Version`、`Err = rpc.OK`。

`Put`：

1. 加锁。
2. 查 map。
3. 按上面的四种情况处理；version 的检查和更新必须在同一个临界区里。
4. 解锁。

注意：RPC handler 是并发的，`data` 必须用锁保护。

### Clerk

`Get`：

```text
for {
    reply := GetReply{}
    ok := ck.clnt.Call(ck.server, "KVServer.Get", &args, &reply)
    if ok {
        return reply.Value, reply.Version, reply.Err
    }
    time.Sleep(100 * time.Millisecond)
}
```

`Put`：

```text
retried := false
for {
    reply := PutReply{}
    ok := ck.clnt.Call(ck.server, "KVServer.Put", &args, &reply)

    if ok {
        if reply.Err == rpc.ErrVersion && retried {
            return rpc.ErrMaybe
        }
        if reply.Err == rpc.ErrVersion && !retried {
            return rpc.ErrVersion
        }
        return reply.Err
    }

    retried = true
    time.Sleep(100 * time.Millisecond)
}
```

关键点：

- 每次 RPC 前 `reply` 要清零（`reply := PutReply{}`）。
- `Call` 返回 `false` 表示没收到 reply；要重发。
- 只有“重发之后收到 `ErrVersion`”才返回 `ErrMaybe`；第一次就收到 `ErrVersion` 说明肯定没执行。
- `ErrMaybe` 是给上层应用的：它表示“可能执行了，也可能没执行”。

## Part 2：用 KV 实现锁

`src/kvsrv1/lock/lock.go`：

```go
type Lock struct {
    ck       kvtest.IKVClerk
    lockname string
    id       string
}
```

`MakeLock` 里生成唯一 ID：

```go
lk := &Lock{ck: ck, lockname: lockname, id: kvtest.RandValue(8)}
```

key 可以用 `"lock:" + lockname`，避免和测试里的其他 key 冲突。

### Acquire

目标：阻塞直到拿到锁。

```text
for {
    val, ver, err := ck.Get(key)

    if err == ErrNoKey {
        // 锁还不存在，尝试用 version 0 创建
        err = ck.Put(key, myID, 0)
        if err == OK { return }
        if err == ErrMaybe {
            // 可能已经创建成功，检查是不是我
            v, _, e := ck.Get(key)
            if e == OK && v == myID { return }
        }
        sleep; continue
    }

    if err == OK {
        if val == "" {
            // 锁空闲，尝试抢
            err = ck.Put(key, myID, ver)
            if err == OK { return }
            if err == ErrMaybe {
                v, _, e := ck.Get(key)
                if e == OK && v == myID { return }
            }
        }
        // 别人持有，等一会再试
        sleep; continue
    }
}
```

关键点：

- `Acquire` 必须真的持有锁才返回；不能因为一次 `Put` 没报错就以为拿到了。
- `ErrMaybe` 之后要 `Get` 确认 value 是不是自己的 ID。
- 等待时 `time.Sleep(10–50ms)`，不要忙等。
- 不同 lockname 用不同 key，互相独立。

### Release

目标：如果锁是自己持有的，把它释放；否则什么都不做。

```text
for {
    val, ver, err := ck.Get(key)
    if err == ErrNoKey { return }
    if err != nil { sleep; continue }

    if val != myID {
        // 不是我的锁，幂等返回
        return
    }

    err = ck.Put(key, "", ver)
    if err == OK || err == ErrMaybe {
        return
    }
    // ErrVersion: 状态变了，重试
}
```

关键点：

- 只释放自己的锁。
- `ErrMaybe` 可以当作成功（释放是幂等的）。
- 不要用一个全局变量存锁状态；锁状态在 KV 服务里。

## Part 3：不可靠网络

网络会丢请求、丢回复、重排。需要：

- `Get` 无限重试。
- `Put` 用版本号保证 at-most-once；重发后收到 `ErrVersion` 返回 `ErrMaybe`。
- 锁的 `Acquire` 处理 `ErrMaybe`：可能已经拿到锁，要 `Get` 确认。
- 所有等待都加 `time.Sleep`，避免打爆服务端。

`ErrMaybe` 是 lab 2 的核心难点。记住一句话：

> `ErrMaybe` 不是“失败”，是“结果未知”；上层必须能处理“可能成功”的情况。

## 测试

```bash
cd ~/labs/6.5840/src

# 可靠的 KV
make RUN="-run Reliable" kvsrv1

# 不可靠网络的 KV
make RUN="-run Unreliable" kvsrv1

# 全部 KV 测试
make kvsrv1

# 锁
make lock1

# 只跑不可靠网络的锁
make RUN="-run ManyClientsUnreliable" lock1
```

测试大概在测：

- `TestReliablePut`：可靠网络下的 Put/Get。
- `TestPutConcurrentReliable`：多客户端并发写同一个 key。
- `TestMemPutManyClientsReliable`：大量 Put，检查内存/并发（比较慢，约 50 秒）。
- `TestUnreliableNet`：丢包/重排下的 Put/Get。
- `TestReliableBasic` / `TestReliableNested`：单客户端、多把锁。
- `TestOneClientReliable` / `TestManyClientsReliable`：多客户端抢锁。
- `TestOneClientUnreliable` / `TestManyClientsUnreliable`：不可靠网络下抢锁。

## 常见坑

- **Reply 没清零**：`reply := GetReply{}`，不要复用带旧值的结构体。
- **版本检查不原子**：比较 version 和更新 value 必须在同一个锁里。
- **第一次 `ErrVersion` 就返回 `ErrMaybe`**：错。第一次收到 `ErrVersion` 说明肯定没执行，应该返回 `ErrVersion`。
- **重发后 `ErrVersion` 返回 `ErrVersion`**：错。应该是 `ErrMaybe`。
- **锁没有真正持有就返回**：`Acquire` 要循环到 `Put` 成功（或 `ErrMaybe` + `Get` 确认）。
- **释放别人的锁**：`Release` 先 `Get`，value 不是自己的 ID 就返回。
- **忙等**：`for {}` 会把 CPU 打满，测试变慢；用 `time.Sleep`。
- **锁 key 冲突**：`lockname` 前面加前缀，避免和测试 key 冲突。
- **`TestMemPutManyClientsReliable` 很慢**：约 50 秒，不要以为挂了。

## 术语

| 英文 | 中文 | 说明 |
|---|---|---|
| at-most-once | 最多一次 | 重发不会执行第二次 |
| linearizability | 线性一致性 | 所有操作像在一个点上原子执行 |
| version | 版本号 | 每次成功 Put 加 1 |
| ErrVersion | 版本不匹配 | Put 的 version 和服务端不一致 |
| ErrNoKey | key 不存在 | Get 或 Put 返回 |
| ErrMaybe | 结果未知 | 重发后收到 ErrVersion，可能执行了 |
| Clerk | 客户端库 | 封装 RPC 和重试 |
| lock | 锁 | 用 KV 的 Put/Get 实现 |

## 和 Lab 3/4 的关系

- Lab 2 的 `Clerk`、`Put/Get` 语义会被 Lab 4 复用。
- Lab 4 会把单机 server 换成 Raft 复制的 server；`ErrWrongLeader` 会替代部分错误处理。
- Lab 2 的 at-most-once 思路（版本号/去重）会在 Lab 4 的 `rsm` 和 Lab 5 的 shard 迁移里再次出现。

做完 Lab 2，你应该能回答：

- 为什么版本号能实现 at-most-once？
- 为什么第一次 `ErrVersion` 和重发后的 `ErrVersion` 语义不同？
- `Acquire` 收到 `ErrMaybe` 后怎么判断自己是否拿到了锁？
