# Lab 2 · KV Server 与锁

> **课程**：[INFRA 01 · 分布式系统](course-map.html) · **实验 2/5**
>
> **先读**：[第 2 讲 RPC and Threads](lectures.html#lec2) 和 [第 8 讲 线性一致](lectures.html#lec8) · **参考**：[官方实验页](https://pdos.csail.mit.edu/6.5840/labs/lab-kvsrv1.html) · [Go 并发](https://go.dev/doc/effective_go#concurrency) · [阅读](papers.html)
>
> **评分**：`LAB_ROOT=~/labs/6.5840 ./judge/run.sh infra01 lab2` · [评分标准](grading.html)
>
> [上一个：Lab 1](lab1.html) · [返回作业](labs.html) · [下一个：Lab 3](lab3.html)
>
> **难度** ★★ · **先修** Lab 1 + 第 2、8 讲 · **时间** 6–10 小时 · **最小通过** `kvsrv1` 的 Reliable 三件套 + `lock1` 的四个 Reliable 测试（judge 显示 `PASS`）；**完整通过** `kvsrv1` + `lock1` 全绿
>
> judge 的 `min_pass` 与这一行一致，写在 `judge/courses/infra01.json`；改这一行就要同步改那里。

## 你将完成什么

改完 `kvsrv1/client.go`、`kvsrv1/server.go` 和 `kvsrv1/lock/lock.go` 之后，你在 `src` 目录下跑两条命令，就能看到这个实验的全部验收结果：

```bash
cd ~/labs/6.5840/src
make kvsrv1
make lock1
```

`make kvsrv1` 跑 4 个测试，最后一行是 `ok 6.5840/kvsrv1 64.442s`；`make lock1` 跑 6 个测试，最后一行是 `ok 6.5840/kvsrv1/lock 12.227s`。每个测试先打印一行 `... Passed --  time ... #peers 1 #RPCs ... #Ops ...`，四个数字分别是耗时、peer 数、RPC 次数和 `Clerk.Get`/`Clerk.Put` 调用次数。这个实验的 peer 数固定为 1。

通过不只是“输出看起来对”。`TestUnreliableNet` 要求 `Clerk.Put` 至少返回一次 `ErrMaybe`，`TestMemPutManyClientsReliable` 会量服务端内存增长，`TestManyClientsUnreliable` 会在临界区里检查有没有第二个客户端。三个测试分别对应重发语义、不要为每个客户端存状态、锁的互斥。

## 开始之前

先读[第 2 讲](lectures.html#lec2)和[第 8 讲](lectures.html#lec8)。第 2 讲给你 RPC、超时和重试的背景，第 8 讲给你线性一致的定义和反例；官方页里链到的 linearizability FAQ 可以在卡住时再看。这个实验不要求先读论文。

环境检查：

```bash
cd ~/labs/6.5840/src
go version          # 需要 go1.22 或更高
ls kvsrv1           # client.go lock rpc server.go test.go kvsrv_test.go
```

第一次跑 `make kvsrv1` 会失败，这是骨架的预期行为：

```text
=== RUN   TestReliablePut
One client and reliable Put (reliable network)...
    kvsrv_test.go:24: Put err ErrNoKey
--- FAIL: TestReliablePut (0.11s)
```

原因是 `client.go` 里的 `Clerk.Put` 还是桩，直接返回 `rpc.ErrNoKey`。把这条错误当成起点，不要先去改测试。行号（`:24`）和耗时（`0.11s`）会随 MIT 更新骨架而变，只要 `FAIL` 的原因还是 `Put err ErrNoKey` 就说明你在正确的位置。

只改三个文件：`kvsrv1/client.go`、`kvsrv1/server.go`、`kvsrv1/lock/lock.go`。`kvsrv1/rpc/rpc.go` 是客户端和服务端共同的契约，`kvsrv1/test.go`、`kvsrv1/kvsrv_test.go` 和 `kvsrv1/lock/lock_test.go` 是测试，都不要改。

时间预算：6–10 小时，其中 KV 部分 4–6 小时，锁 2–4 小时。这是经验估计，不是官方数字；锁的代码很少，但需要独立想清楚收到 `ErrMaybe` 之后怎么判断。

## 代码地图

| 文件 | 负责什么 | 能不能改 |
|---|---|---|
| `kvsrv1/client.go` | `Clerk` 的 `Get`/`Put`，RPC 发送与重试 | 改 |
| `kvsrv1/server.go` | `KVServer` 的 map、`Get`/`Put` handler | 改 |
| `kvsrv1/lock/lock.go` | 用 KV 实现 `Acquire`/`Release` | 改 |
| `kvsrv1/rpc/rpc.go` | 参数、回复、错误常量 | 不改 |
| `kvsrv1/test.go` | 建一个 1 台服务器的测试配置 | 不改 |
| `kvsrv1/kvsrv_test.go` | KV 的 4 个测试 | 不改 |
| `kvsrv1/lock/lock_test.go` | 锁的 6 个测试 | 不改 |
| `main/kvsrv1d.go` | 服务端守护进程入口 | 不改 |

`client.go` 里的 `Clerk` 只有两个字段：`clnt *tester.Clnt` 和 `server string`。`tester.Clnt.Call(server, "KVServer.Get", &args, &reply)` 发一次 RPC，返回 `true` 表示收到了回复，返回 `false` 表示等超时了，请求或回复可能丢在路上。`server.go` 里的 `StartKVServer` 会创建 `KVServer` 并返回给 tester，测试通过 `main/kvsrv1d` 把它跑在独立进程里，所以 Clerk 只能通过 RPC 访问它。

## 数据从哪来，到哪去

一次读写的数据流很短，但两个方向都要经过网络：

```text
Clerk.Get/Put ──RPC──> KVServer.Put/Get ──lock──> map[key]{value, version}
      ▲                        │
      └── OK/ErrNoKey/ErrVersion ┘
```

服务端为每个 key 存一个 `(value, version)`。`version` 记录这个 key 被成功写了几次，`Put` 只在请求里的 version 等于服务端当前 version 时生效。四条规则必须背下来：

| 情况 | 行为 |
|---|---|
| key 不存在，`version == 0` | 创建 key，存 value，version 变成 1，返回 `OK` |
| key 不存在，`version > 0` | 返回 `ErrNoKey` |
| key 存在，`version == 当前 version` | 更新 value，version 加 1，返回 `OK` |
| key 存在，`version != 当前 version` | 返回 `ErrVersion` |

`Get` 更简单：key 存在就返回 value、version、`OK`；不存在就返回 `ErrNoKey`。所有 map 访问都在同一把 `sync.Mutex` 下，这样单个 `Get` 或 `Put` 在服务端是一个原子步骤，整个服务从客户端看就是线性一致的。

接口在 `rpc/rpc.go` 里已经定好：

```go
type Tversion uint64

type PutArgs struct {
    Key     string
    Value   string
    Version Tversion
}
type PutReply struct{ Err Err }

type GetArgs struct{ Key string }
type GetReply struct {
    Value   string
    Version Tversion
    Err     Err
}
```

Clerk 的 `Put` 是一个小状态机。关键是 `retries` 记录“已经失败过几次”，而不是总共发了几次；只有 `retries == 0` 时收到的 `ErrVersion` 才能确定是第一次请求的回复：

```text
Put(key, value, ver):
  retries := 0
  loop:
    args  := PutArgs{key, value, ver}
    reply := PutReply{}                 // 每轮清零
    if !Call("KVServer.Put", &args, &reply):
        retries++
        sleep(100ms)
        continue
    switch reply.Err:
      case OK:        return OK
      case ErrNoKey:  return ErrNoKey
      case ErrVersion:
          if retries == 0: return ErrVersion
          return ErrMaybe
      default:        retries++; sleep(100ms)
```

`Get` 没有副作用，循环到 `Call` 返回 `true` 为止，把服务端的 `OK` 或 `ErrNoKey` 原样带回：

```text
Get(key):
  loop:
    args  := GetArgs{key}
    reply := GetReply{}
    if Call("KVServer.Get", &args, &reply):
        return reply.Value, reply.Version, reply.Err
    sleep(100ms)
```

服务端不需要为每个 Clerk 保存“上次回复”，version 本身就是去重令牌。第一次 `Put` 成功会把 version 加 1；重发的同一请求带着旧 version，必然匹配失败，于是最多执行一次。这正好解释了 `TestMemPutManyClientsReliable` 为什么能用 20 000 个客户端量内存：正确实现里，服务端只有一张 key 表，没有 per-client 表。

## 阶段 1：先让单机 KV 在可靠网络下跑通

目标：`TestReliablePut` 通过。这一步先不管重发，`Clerk` 每发一次 RPC 就返回。

1. 在 `server.go` 里定义 `type entry struct { value string; version rpc.Tversion }`，给 `KVServer` 加 `data map[string]entry`，在 `MakeKVServer` 里初始化。
2. `Get` handler 加锁，查 map；命中就填 `reply.Value`、`reply.Version`、`reply.Err = rpc.OK`，未命中填 `rpc.ErrNoKey`。
3. `Put` handler 加锁，按上面的四条规则分支；更新时 `e.version = args.Version + 1`。
4. `client.go` 的 `Get`/`Put` 先各发一次 `Call`，把 `reply.Err` 返回；先不做循环。
5. 跑单测：

```bash
make RUN="-run TestReliablePut" kvsrv1
```

预期：

```text
=== RUN   TestReliablePut
One client and reliable Put (reliable network)...
  ... Passed --  time  0.0s #peers 1 #RPCs     5 #Ops    5
--- PASS: TestReliablePut (0.12s)
PASS
```

通过标志是 `--- PASS: TestReliablePut`。这个测试依次检查：第一次 `Put("k", "6.5840", 0)` 返回 `OK`；`Get("k")` 返回 value 和 version 1；再用 version 0 写同一个 key 返回 `ErrVersion`；用 version 1 写不存在的 `"y"` 返回 `ErrNoKey`；`Get("y")` 返回 `ErrNoKey`。任何一条不符合，测试会打印具体是 value 错还是 version 错。

## 阶段 2：让 Clerk 重发，分清 ErrVersion 和 ErrMaybe

目标：`make kvsrv1` 的 4 个测试全过，尤其是 `TestUnreliableNet`。

1. 把 `Put` 改成上面的循环；每次 `Call` 前用新的 `PutReply`，不要复用上一轮的变量。
2. `Call` 返回 `false` 时先 `time.Sleep(100 * time.Millisecond)` 再重发。官方页明确给了这个建议，避免把一台慢服务器打爆。
3. 用 `retries` 区分首次和重发：首次收到 `ErrVersion` 返回 `ErrVersion`，重发后收到 `ErrVersion` 返回 `ErrMaybe`。
4. `Get` 也循环到收到回复为止；`Get` 重发没有副作用，不需要版本判断。
5. 跑全量：

```bash
make kvsrv1
```

预期 4 个测试全绿，最后 `ok 6.5840/kvsrv1 64.442s`。其中 `TestMemPutManyClientsReliable` 约 52 秒，`TestPutConcurrentReliable` 约 6 秒，`TestUnreliableNet` 约 4 秒。

通过标志有两个：`TestUnreliableNet` 打印 `--- PASS`，以及输出里没有 `Clerk.Put never returned ErrMaybe`。如果出现这条消息，说明你的重发路径从来没有返回过 `ErrMaybe`；测试会用 100 轮不可靠网络专门逼它出现。

为什么首次和重发要区别对待？首次收到 `ErrVersion`，说明请求到达服务端时 version 就不匹配，这次 `Put` 一定没执行。重发收到 `ErrVersion` 时，可能是第一次请求已经执行、成功回复丢了，第二次才带着旧 version 被拒；也可能是别的客户端先改了 key，两次都没执行。客户端分不清这两种，只能报 `ErrMaybe`，让上层用 `Get` 去确认。

## 阶段 3：用 KV 实现一把锁

目标：`TestManyClientsReliable` 通过。一种可行设计是把锁的状态放在 KV 里：key 用 `"lock:" + lockname`，值是持有者的唯一 ID；ID 在 `MakeLock` 时用 `kvtest.RandValue(8)` 生成一次，空字符串 `""` 表示锁空闲。

`Acquire` 的最小路径是“读—判断—条件写”：

```text
Acquire():
  loop:
    val, ver, err := ck.Get(key)
    if err == ErrNoKey:
        if ck.Put(key, id, 0) == OK: return
        continue
    if err != OK: continue
    if val == id: return              // 重入；测试不依赖
    if val == "":
        if ck.Put(key, id, ver) == OK: return
        continue                      // ErrVersion: 别人先抢到
    sleep(10ms)                       // 别人持有，等释放
```

`Release` 必须先确认锁是自己的，再写回空字符串：

```text
Release():
  loop:
    val, ver, err := ck.Get(key)
    if err == ErrNoKey: return
    if err != OK: continue
    if val != id: return             // 不是自己的锁，什么都不做
    if ck.Put(key, "", ver) == OK: return
    // ErrVersion / ErrMaybe: 下一轮 Get 看 value 是否已经变成 ""
```

先跑可靠网络下的 4 个测试：

```bash
make RUN="-run Reliable" lock1
```

预期 `ok 6.5840/kvsrv1/lock 5.817s`。这里有一个陷阱：`TestReliableBasic` 和 `TestReliableNested` 在 `Acquire`/`Release` 完全是空函数时也会通过，因为前者只调用一次，后者只用一个客户端。真正检查互斥的是 `TestManyClientsReliable`：10 个客户端反复抢同一把锁，抢到后读 key `"l0"`，确认它是空的，写入自己的编号，睡 10 毫秒，再清空。如果两个客户端同时进了临界区，测试会报 `two clients acquired lock`。

`"l0"` 是测试自己用的 key。锁的 key 一定要加前缀，不要把锁状态写到裸的 `lockname` 或固定的 `"l0"` 上，否则会和测试数据互相覆盖。

## 阶段 4：让锁在不可靠网络下也成立

目标：`make lock1` 的 6 个测试全过。网络会丢请求、丢回复、重排，`Acquire` 和 `Release` 都会收到 `ErrMaybe`，不能把 `ErrMaybe` 当成成功或失败。

`Acquire` 的处理方式已经藏在循环里：`Put` 返回 `ErrMaybe` 时不返回，回到 `Get`。读回来 `val == id`，说明那次写其实成功了，锁已经拿到；还是空字符串，说明没写成，下一轮再抢；是别人的 ID，就继续等。`Release` 同理：`Put` 返回 `ErrMaybe` 后重新 `Get`，值不再是自己的 ID 就说明释放已经生效（或已被别人拿走），可以返回；仍然是自己的 ID 就再试。

跑全量：

```bash
make lock1
```

预期 6 个测试全绿，最后 `ok 6.5840/kvsrv1/lock 12.227s`。`TestManyClientsUnreliable` 约 4.2 秒，`TestOneClientUnreliable` 约 2.2 秒，慢是正常的。

通过标志是 `TestManyClientsUnreliable` 通过，并且 `-race` 下没有报告。锁不要求公平，先到的客户端不保证先拿到；只要同一时刻最多一个持有者，`Release` 只释放自己的锁，就满足实验要求。等锁时 `sleep` 10–50 毫秒即可，不要忙等把 CPU 打满。

## 测试与判分

| 测试 | 规模 | 测什么 | 官方样例耗时 |
|---|---|---|---|
| `TestReliablePut` | 1 个客户端 | 可靠网络下的 Put/Get 和四条版本规则 | 0.12 s |
| `TestPutConcurrentReliable` | 10 个客户端，1 秒 | 并发写同一个 key，Porcupine 检查线性一致 | 6.36 s |
| `TestMemPutManyClientsReliable` | 20 000 个 Clerk，1000 字节 value | 服务端内存增长不超过每客户端 10 字节 | 52.91 s |
| `TestUnreliableNet` | 1 个客户端，100 轮 | 丢包重发、`ErrMaybe`、最多执行一次 | 4.13 s |
| `TestReliableBasic` | 1 个客户端 | 一次 Acquire/Release | 0.13 s |
| `TestReliableNested` | 1 个客户端，2 把锁 | 不同名字的锁互不影响 | 0.17 s |
| `TestOneClientReliable` | 1 个客户端，2 秒 | 反复抢锁，临界区读 `"l0"` | 2.14 s |
| `TestManyClientsReliable` | 10 个客户端，2 秒 | 多客户端互斥 | 2.36 s |
| `TestOneClientUnreliable` | 1 个客户端，2 秒 | 不可靠网络下的单客户端锁 | 2.18 s |
| `TestManyClientsUnreliable` | 10 个客户端，2 秒 | 不可靠网络下的多客户端互斥 | 4.23 s |

耗时来自官方页的 `-race` 样例，你的机器会不同；`TestMemPutManyClientsReliable` 超过 50 秒不是挂死。`TestPutConcurrentReliable` 会调用 `CheckPorcupineT(10*time.Second)`，线性一致检查本身最多花 10 秒，超时会打印 `linearizability check timed out, assuming history is ok`，这不是失败。

本地评分脚本分两档。`--quick` 只跑 `make RUN="-run Reliable" kvsrv1` 和 `make RUN="-run Reliable" lock1`，也就是 KV 的 3 个可靠测试加锁的 4 个可靠测试，最高只给 `PARTIAL`；全量才跑 `make kvsrv1` 和 `make lock1`。所以“quick 全绿”不等于通过，`TestUnreliableNet`、`TestOneClientUnreliable`、`TestManyClientsUnreliable` 才是不可靠网络的关键证据。

## 常见错误：现象、原因、处理

| 现象 | 原因 | 处理 |
|---|---|---|
| 第一次 `make kvsrv1` 报 `Put err ErrNoKey` | `Clerk.Put` 还是桩，或服务端没实现 | 先实现 `Put`/`Get`，再跑单测 |
| `Get wrong version 0; expected 1` | `Put` 成功后没把 version 加 1 | 写入时设成 `args.Version + 1` |
| 对已存在的 key 用 version 0 写返回 `OK` | 只比较了 key 是否存在，没有比较 version | 先查当前 version，再决定 `OK`/`ErrVersion` |
| 对不存在的 key 用 version 1 写返回 `ErrVersion` | 把“key 不存在”当成版本不匹配 | 特判 `version > 0` 且 key 不存在，返回 `ErrNoKey` |
| `Put shouldn't have happen more than once` | 重发路径没有版本保护，或客户端自己改了 version | 重发必须带原来的 version |
| `Clerk.Put never returned ErrMaybe` | 重发后收到 `ErrVersion` 仍返回 `ErrVersion` | 用 `retries` 区分首次和重发 |
| `history is not linearizable` | 比较 version 和更新 value 不在同一个锁里，或复用了旧 Reply | 整个 Put 临界区持锁；每轮 RPC 前清零 Reply |
| 锁的前两个测试过了，`TestManyClientsReliable` 失败 | 前两个测试不检查互斥，空实现也能过 | 检查 `Acquire` 是否确认自己持有锁 |
| `two clients acquired lock` | `Acquire` 没验证 owner，或 `Release` 释放了别人的锁 | `Acquire` 只在写入自己 ID 后返回；`Release` 先 `Get` 比对 ID |
| 锁测试偶发失败，或 key 数据被覆盖 | 锁的 key 和测试用的 `"l0"` 冲突 | 用 `"lock:" + lockname` 之类的前缀 |
| `server using too much memory` | 服务端为每个 Clerk 存了去重表 | 删掉 per-client 状态，用 version 做 at-most-once |
| `-race` 报竞态，或 CPU 100% | map 没加锁；等锁时忙等 | 所有 map 访问用同一把 `sync.Mutex`；等待用 `time.Sleep` |

## 调试手册

1. **只跑一个测试，把输出留下来。**

   ```bash
   cd ~/labs/6.5840/src
   make RUN="-run TestReliablePut" kvsrv1 > /tmp/kv.log 2>&1
   tail -40 /tmp/kv.log
   ```

   先确认失败在哪个断言。`kvsrv_test.go` 的报错会带期望值和实际值，比只看 `FAIL` 有用。

2. **在服务端打印每次 Put/Get 的输入和当前状态。**

   打印 key、请求 version、当前 value/version、返回的 Err；在客户端打印第几次尝试、`Call` 是否成功、收到什么 Err。一次 `TestReliablePut` 只有 5 次操作，日志应该很短；如果日志刷屏，说明重试循环没有 sleep 或服务端在反复拒绝同一个请求。

3. **改了 `server.go` 后重新构建守护进程。**

   测试跑的是 `src/main/kvsrv1d`，不是测试进程里的代码。`make kvsrv1` 会先 `go build`；如果你直接 `cd kvsrv1 && go test`，先跑一次 `make kvsrv1-build`，否则测的还是旧二进制。

4. **用 Porcupine 的可视化看线性一致失败。**

   ```bash
   VIS_ENABLE=always VIS_FILE=/tmp/kv-vis.html make RUN="-run TestPutConcurrentReliable" kvsrv1
   ```

   失败时输出会给出 HTML 路径；在浏览器里看哪些操作的先后顺序矛盾。常见原因是 `Get` 读到了旧 value，或者两个 `Put` 的 version 都被接受。

5. **锁的偶发失败多跑几次。**

   ```bash
   make RUN="-run TestManyClientsUnreliable" lock1
   ```

   连跑 3–5 次。锁的 bug 往往只在丢包时出现；一次通过不能说明问题。也可以临时把 `time.Sleep(10 * time.Millisecond)` 的临界区拉长，让冲突更容易暴露，但提交前要改回去。

6. **确认 `-race` 真的开着。**

   MIT 的 Makefile 默认 `RACE=-race`，`make kvsrv1` 和 `make lock1` 都会带上。自己调试可以 `RACE=` 临时关掉，提交前必须用默认值跑一遍；竞态通常表现为偶发的 `Get` 旧值或 `two clients acquired lock`。

## 提交前检查

- [ ] `make kvsrv1` 4 个测试全绿，`make lock1` 6 个测试全绿；关键测试各连跑 3 次。
- [ ] 默认 `-race` 跑过，没有 data race 或 goroutine 泄漏。
- [ ] 首次 `ErrVersion` 返回 `ErrVersion`，重发后的 `ErrVersion` 返回 `ErrMaybe`；`TestUnreliableNet` 确实见过 `ErrMaybe`。
- [ ] 每次 RPC 前 Reply 清零；服务端比较 version 和更新 value 在同一个锁里。
- [ ] `Acquire` 只在确认持有后返回；`Release` 检查 owner；锁 key 有前缀；等待没有忙等。
- [ ] 服务端没有 per-client 状态；`TestMemPutManyClientsReliable` 通过。
- [ ] 写了 300 字复盘：不变量、取舍、最先暴露问题的测试、根因（模板见[评分标准](grading.html#reflection)）。

## 自测问题

1. 为什么 version 能实现 at-most-once？它省掉了哪种去重表？
2. 为什么首次 `ErrVersion` 可以返回 `ErrVersion`，重发后的 `ErrVersion` 必须返回 `ErrMaybe`？
3. `Acquire` 收到 `ErrMaybe` 后，怎么判断自己是否拿到了锁？
4. 两个客户端同时 `Acquire`，哪个机制保证只有一个成功？
5. `Release` 为什么必须先 `Get` 检查 owner，不能直接写空字符串？
6. 为什么 `Get` 可以无限重发，`Put` 重发却必须带原来的 version？

### 答案要点

1. version 是“期望值”：重发的 `Put` 带着旧 version，如果第一次已经执行，服务端 version 已经变了，第二次必然被拒。这样服务端不需要为每个 Clerk 保存请求 ID 和上次回复，只需要每个 key 一个 version。
2. 首次收到 `ErrVersion` 说明请求到达时就没匹配，肯定没执行。重发时可能第一次已经执行、成功回复丢了，也可能两次都没执行；客户端无法区分，只能报 `ErrMaybe`，让上层用 `Get` 确认。
3. 不能从 `ErrMaybe` 本身判断。回到 `Get`：读回来的 value 等于自己的 ID 就说明那次 `Put` 实际成功了；是空字符串说明没写成；是别人的 ID 说明没抢到。
4. 所有客户端对同一个锁 key 做条件 `Put`，服务端在同一把互斥锁下比较 version 并更新；只有一个 `Put` 的 version 能匹配，其余得到 `ErrVersion`。单机 KV 的线性一致保证了这一点。
5. 如果锁已经被释放并被别人拿走，盲目写空字符串会释放别人的锁，破坏互斥。先 `Get` 确认 value 是自己的 ID，再写，才符合“只释放自己的锁”。
6. `Get` 不修改状态，重复执行结果一样；`Put` 会改状态，重复执行必须靠 version 条件挡住，否则一次写会变成两次。
