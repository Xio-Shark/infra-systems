# Lab 5 · Sharded KV

> **课程**：[INFRA 01 · 分布式系统](course-map.html) · **实验 5/5**
>
> **先读**：[第 11 讲 分布式事务](lectures.html#lec11)、[第 12 讲 Spanner](lectures.html#lec12) 和 [第 13 讲 Chain Replication](lectures.html#lec13) · **参考**：[官方实验页](https://pdos.csail.mit.edu/6.5840/labs/lab-shard1.html) · [Spanner 论文](https://research.google/pubs/pub39966/)
>
> **评分**：`LAB_ROOT=~/labs/6.5840 ./judge/run.sh infra01 lab5` · [评分标准](grading.html)
>
> [上一个：Lab 4](lab4.html) · [返回作业](labs.html)
>
> **难度** ★★★★ · **先修** Lab 4（含 4C）+ 第 11–13 讲 · **时间** 10–15 小时 · **最小通过** 5A 的 14 个测试（judge 显示 `PASS`）；**完整通过** 5A–5C 共 23 个
>
> judge 的 `min_pass` 与这一行一致，写在 `judge/courses/infra01.json`；改这一行就要同步改那里。

## 你将完成什么

12 个 shard 分布在多个 group 上，客户端按 key 找 group。加组、减组时 controller 搬 shard；controller 半路崩了，新 controller 接着搬。客户端用旧配置访问时不会读到两个 owner 的数据。做完这个实验，你会把 Lab 4 的 RSM KV 复制成多组，用可崩溃的 controller 管理配置。

验收命令在 `src` 下跑：

```bash
cd ~/labs/6.5840/src
make shardkv
make RUN="-run 5A" shardkv
make RUN="-run 5B" shardkv
make RUN="-run 5C" shardkv
```

`make shardkv` 用 `-timeout 15m`，跑 5A 的 14 个、5B 的 2 个和 5C 的 7 个测试。全绿时最后一行是 `ok 6.5840/shardkv1 ...`。5A 和 5C 各约 4 分钟，5B 约 36 秒。

这个实验的五条不变量：

1. 同一时刻每个 shard 最多一个 group 在服务。
2. 配置的 `Num` 单调递增，不能分叉；同一个 `Num` 只能有一份配置。
3. 迁移一个 shard 时，先停服务，再搬数据，最后恢复服务；搬的数据包括 KV、去重表和这个 shard 的 `Num`。
4. 客户端用旧配置访问时得到 `ErrWrongGroup`，重新 `Query` 后再试。
5. controller 崩溃后，新 controller 能从 `next` 配置识别未完成的迁移；重复的 Freeze/Install/Delete 不能改变结果。

第一次跑 `make RUN="-run TestInitQuery5A" shardkv` 会在 `Query()` 返回 `nil` 后于 `cfg.Num` 处 panic。先写 `InitConfig` 和 `Query`。

## 开始之前

先读[第 11 讲](lectures.html#lec11)、[第 12 讲](lectures.html#lec12)和[第 13 讲](lectures.html#lec13)。你需要理解分片、配置版本、迁移期间的“先停服务、再搬数据、最后恢复服务”，以及 controller 只是可崩溃的客户端。Spanner 论文不是前置。

前置是 Lab 2 的 `kvsrv1`、Lab 3 的 `raft1` 和 Lab 4 的 `rsm`。Lab 5 必须和 Lab 4 用同一套 `rsm`/Raft；改了要重跑 Lab 4。`shardctrler` 把配置存在 Lab 2 的单机 `kvsrv`，所以 Lab 2 的版本语义要先正确。

环境检查：

```bash
cd ~/labs/6.5840/src
go version
ls shardkv1
ls shardkv1/shardcfg
ls shardkv1/shardgrp
```

预期：

```text
go version go1.23.5 linux/amd64
client.go  shardcfg  shardctrler  shardgrp  shardkv_test.go  test.go
shardcfg.go  shardcfg_test.go
client.go  server.go  shardrpc
```

版本不低于 `go1.22`；`ls` 的文件名要对得上。`shardcfg` 和 `shardctrler` 在 `shardkv1/` 下面，不在 `src/` 顶层；import 用 `6.5840/shardkv1/shardcfg`、`6.5840/shardkv1/shardctrler`。

这个实验只改四个文件：

- `src/shardkv1/shardctrler/shardctrler.go`：`InitConfig`、`Query`、`ChangeConfigTo`、`InitController`。
- `src/shardkv1/shardgrp/server.go`：`KVServer`、`DoOp`、`Snapshot`/`Restore`、5 个 RPC handler、`StartServerShardGrp`。
- `src/shardkv1/shardgrp/client.go`：group 内 Clerk，包括三个迁移 RPC。
- `src/shardkv1/client.go`：整体 Clerk，负责 `Query`、按 key 找 group、处理 `ErrWrongGroup`。

不要改 `src/shardkv1/shardcfg/`、`src/shardkv1/shardgrp/shardrpc/`、`shardkv_test.go`、`test.go`、`src/main/`、`src/kvsrv1/`、`src/raft1/`。`shardcfg` 是给定的配置数学，`shardrpc` 是 RPC 契约；改它们等于改测试标准。

测试把 controller 的 `kvsrv` 和每个 shard group 放在独立进程里：`make shardkv` 先构建 `main/kvsrv1d` 和 `main/shardgrp1d`，测试再通过 UNIX socket 连上去。

时间预算 10–15 小时。先让一个 group 服务所有 shard，再做 join/leave，再做 controller 崩溃，最后做并发 controller；不要一开始就写 5C。

## 代码地图

| 文件 | 负责什么 | 能不能改 |
|---|---|---|
| `src/shardkv1/shardctrler/shardctrler.go` | `ShardCtrler`、`InitConfig`、`Query`、`ChangeConfigTo`、`InitController` | 改 |
| `src/shardkv1/shardcfg/shardcfg.go` | `Tshid`/`Tnum`、`ShardConfig`、`Key2Shard`、`Join`/`Leave`/`Rebalance`、`GidServers` | 不改 |
| `src/shardkv1/shardgrp/server.go` | `KVServer`、`DoOp`、`Snapshot`/`Restore`、5 个 RPC handler、`StartServerShardGrp` | 改 |
| `src/shardkv1/shardgrp/client.go` | group 内 Clerk 的 `Get`/`Put` 和三个迁移 RPC | 改 |
| `src/shardkv1/shardgrp/shardrpc/shardrpc.go` | `FreezeShard`/`InstallShard`/`DeleteShard` 的参数和回复 | 不改 |
| `src/shardkv1/client.go` | 整体 Clerk：`Query`、`Key2Shard`、group 缓存、`ErrWrongGroup` 重试 | 改 |
| `src/shardkv1/shardkv_test.go`、`test.go` | 5A/5B/5C 测试和测试驱动 | 不改 |
| `src/main/kvsrv1d.go`、`shardgrp1d.go` | 两个 daemon 入口 | 不改 |
| `src/kvraft1/rsm/`、`src/raft1/` | Lab 4 的 RSM 和 Lab 3 的 Raft | 只在暴露 bug 时改，改完重跑 Lab 3/4 |

`StartServerShardGrp` 已经注册了 `rpc.PutArgs`、`rpc.GetArgs`、三个 `shardrpc` 参数类型和 `rsm.Op`，也创建了 `rsm.MakeRSM(servers, me, persister, maxraftstate, kv)`。你不需要改注册，除非新增了过 RPC 或 Raft 的结构体；新增字段照样要大写。

## 数据流 / 接口

配置和 key 的映射：

```go
type Tshid int
type Tnum int

const (
    NShards  = 12
    NumFirst = Tnum(1)
)
const Gid1 = tester.Tgid(1)

type ShardConfig struct {
    Num    Tnum                     // config number
    Shards [NShards]tester.Tgid     // shard -> gid
    Groups map[tester.Tgid][]string // gid -> servers[]
}

func Key2Shard(key string) Tshid
func MakeShardConfig() *ShardConfig
func (cfg *ShardConfig) String() string
func FromString(s string) *ShardConfig
func (cfg *ShardConfig) Copy() *ShardConfig
func (cfg *ShardConfig) GidServers(sh Tshid) (tester.Tgid, []string, bool)
func (cfg *ShardConfig) IsMember(gid tester.Tgid) bool
```

`Num` 是 `shardcfg.Tnum`，不是 `int`；`Shards[i]` 和 `Groups` 的 key 是 `tester.Tgid`，不是旧的 `int`/`Gid`。`Shards[i] == 0` 表示暂时没有 group 负责。`Key2Shard` 用 FNV-32a 对 12 取模。`String()`/`FromString()` 是 JSON；`Copy()` 是深拷贝，`Query()` 返回的配置不要原地改。

controller：

```go
type ShardCtrler struct {
    clnt *tester.Clnt
    kvtest.IKVClerk
    killed int32
    // 你的字段
}

func MakeShardCtrler(clnt *tester.Clnt) *ShardCtrler
func (sck *ShardCtrler) InitController()
func (sck *ShardCtrler) InitConfig(cfg *shardcfg.ShardConfig)
func (sck *ShardCtrler) ChangeConfigTo(new *shardcfg.ShardConfig)
func (sck *ShardCtrler) Query() *shardcfg.ShardConfig
```

`Query()` 不带参数，返回当前配置，不是按 `Num` 查历史。`MakeShardCtrler` 已接上 controller 的 kvsrv。`InitConfig` 把第一份配置写到某个 key，版本 0；`ChangeConfigTo` 是同步的。

shard group 的 RPC：

```go
type FreezeShardArgs struct {
    Shard shardcfg.Tshid
    Num   shardcfg.Tnum
}
type FreezeShardReply struct {
    State []byte
    Num   shardcfg.Tnum
    Err   rpc.Err
}
type InstallShardArgs struct {
    Shard shardcfg.Tshid
    State []byte
    Num   shardcfg.Tnum
}
type InstallShardReply struct { Err rpc.Err }
type DeleteShardArgs struct {
    Shard shardcfg.Tshid
    Num   shardcfg.Tnum
}
type DeleteShardReply struct { Err rpc.Err }
```

三个 RPC 都要像 `Put`/`Get` 一样走 `rsm.Submit`，不能直接改本地 map，这样它们和客户端读写有同一个日志顺序。每个 group 为每个 shard 记住见过的最大 `Num`；`args.Num` 小于它拒绝，等于且做过就幂等处理。

下面这个动画把一次迁移的顺序走一遍；重点看 `Num` 在 freeze、install、publish 三个阶段怎么变。

<div class="anim" data-anim="shard-migration">
<p class="anim-fallback">这个动画需要 JavaScript；正文的步骤说明仍然完整。</p>
</div>

`shardgrp.KVServer` 和 Clerk：

```go
type KVServer struct {
    me  int
    rsm *rsm.RSM
    gid tester.Tgid
    // 你的字段
}

func (kv *KVServer) DoOp(req any) any
func (kv *KVServer) Snapshot() []byte
func (kv *KVServer) Restore(data []byte)
func (kv *KVServer) Get(args *rpc.GetArgs, reply *rpc.GetReply)
func (kv *KVServer) Put(args *rpc.PutArgs, reply *rpc.PutReply)
func (kv *KVServer) FreezeShard(args *shardrpc.FreezeShardArgs, reply *shardrpc.FreezeShardReply)
func (kv *KVServer) InstallShard(args *shardrpc.InstallShardArgs, reply *shardrpc.InstallShardReply)
func (kv *KVServer) DeleteShard(args *shardrpc.DeleteShardArgs, reply *shardrpc.DeleteShardReply)

func StartServerShardGrp(servers []*labrpc.ClientEnd, gid tester.Tgid, me int,
    persister *tester.Persister, maxraftstate int) []any

type Clerk struct { /* ... */ }
func MakeClerk(clnt *tester.Clnt, servers []string) *Clerk
func (ck *Clerk) Get(key string) (string, rpc.Tversion, rpc.Err)
func (ck *Clerk) Put(key string, value string, version rpc.Tversion) rpc.Err
func (ck *Clerk) FreezeShard(s shardcfg.Tshid, num shardcfg.Tnum) ([]byte, rpc.Err)
func (ck *Clerk) InstallShard(s shardcfg.Tshid, state []byte, num shardcfg.Tnum) rpc.Err
func (ck *Clerk) DeleteShard(s shardcfg.Tshid, num shardcfg.Tnum) rpc.Err
```

整体 Clerk：

```go
type Clerk struct {
    clnt *tester.Clnt
    sck  *shardctrler.ShardCtrler
    rcks map[tester.Tgid]*shardgrp.Clerk
    // 你的字段
}
func MakeClerk(clnt *tester.Clnt, sck *shardctrler.ShardCtrler) kvtest.IKVClerk
func (ck *Clerk) GetClerk(gid tester.Tgid) (*shardgrp.Clerk, bool)
func (ck *Clerk) Get(key string) (string, rpc.Tversion, rpc.Err)
func (ck *Clerk) Put(key string, value string, version rpc.Tversion) rpc.Err
```

一次 `Get` 的路径：

```text
Clerk.Get(key)
  ├─ s = shardcfg.Key2Shard(key)
  ├─ cfg = sck.Query()                 // Num, Shards[s], Groups[gid]
  ├─ gid, servers, _ = cfg.GidServers(s)
  ├─ rck = shardgrp.MakeClerk(ck.clnt, servers)
  └─ rck.Get(key)
        ├─ 找到 group 的 leader，Submit(GetArgs)
        ├─ apply 后返回 GetReply
        └─ ErrWrongGroup -> 回到 sck.Query()
```

`ErrWrongLeader` 在 group 内换 server，`ErrWrongGroup` 把客户端推回配置读取；混在一起会在 group 里死循环，或把配置变更误当成 leader 切换。

迁移一个 shard 的顺序：

```text
controller                    shardgrp A (源)          shardgrp B (目标)
   │─ FreezeShard(s, N) ────────>│ 停止服务，返回 state
   │─ InstallShard(s, state, N) ───────────────────────>│ 安装，准备好
   │─ DeleteShard(s, N) ────────>│ 删除旧副本
   │─ Put current = new (Num=N)
```

freeze 在 install 前，delete 在 install 后，配置最后发布。源组先停服务，目标组拿到完整状态后才成为 owner；发布前客户端只得到 `ErrWrongGroup`，不会读到旧值。未受影响的 shard 不 freeze。

## 阶段 1：5A 先让 Init/Query 过

目标：`make RUN="-run TestInitQuery5A" shardkv` 通过。只改 `shardctrler.go`。

1. 选两个 key，例如 `"config-current"` 和 `"config-next"`；测试不检查 key 名。
2. `InitConfig` 用 `sck.Put("config-current", cfg.String(), 0)` 存第一份配置。版本 0 表示新建；`ErrVersion` 说明已初始化，读出来比较。
3. `Query` 用 `sck.Get("config-current")`，`ErrNoKey` 时返回 `nil`，否则 `shardcfg.FromString(value)`。
4. `InitController` 先留空，5B 再写。

跑：

```bash
cd ~/labs/6.5840/src
make RUN="-run TestInitQuery5A" shardkv
```

官方示例：

```text
=== RUN   TestInitQuery5A
Test (5A): Init and Query ... (reliable network)...
  ... Passed --  time  0.0s #peers 1 #RPCs     3 #Ops    0
--- PASS: TestInitQuery5A (0.13s)
PASS
ok      6.5840/shardkv1 1.143s
```

通过标志是 `--- PASS: TestInitQuery5A`。panic 在 `cfg.Num` 说明 `Query` 还返回 `nil`；`cfg.Num != 1` 说明 `InitConfig` 没存 `JoinBalance` 后的配置。

## 阶段 2：5A 一个 group 服务所有 shard

目标：`make RUN="-run TestStaticOneShardGroup5A" shardkv` 通过。

改 `shardgrp/server.go`：

1. 把 Lab 4 的 `KVServer` 搬过来，数据 map 还是按 key 存；再加 `owned [NShards]bool`、`frozen [NShards]bool`、`maxNum [NShards]shardcfg.Tnum`。
2. `Gid1` 启动时 `owned` 全 true，`maxNum` 设为 `shardcfg.NumFirst`；其他 group 全 false。测试先启动 `Gid1`，再调 `InitConfig`，中间没有 RPC 告诉它配置。
3. `Get`/`Put` handler 先算 `s := shardcfg.Key2Shard(args.Key)`；`!owned[s]` 就返回 `ErrWrongGroup`，否则 `rsm.Submit(args)`。`DoOp` 里再检查一次 `owned`/`frozen`，因为 Freeze 可能已经在这个请求之前提交。
4. `DoOp` 处理 `rpc.GetArgs`/`rpc.PutArgs`，版本规则和 Lab 4 一样；`versions map[string]rpc.Tversion` 就是去重表。
5. `StartServerShardGrp` 里 `rsm.MakeRSM` 之后设置初始 `owned`，要在 reader 启动前完成，避免第一个请求看到空状态。

改 `shardkv1/client.go`：

1. `MakeClerk` 里 `sck` 已经是 `*shardctrler.ShardCtrler`；`rcks` 按 `gid` 缓存 `*shardgrp.Clerk`。
2. `Get`/`Put` 先 `Query()`，`s := shardcfg.Key2Shard(key)`，`gid, servers, ok := cfg.GidServers(s)`；`!ok` 或 `gid == 0` 就重试 `Query`。
3. 用 `shardgrp.MakeClerk(ck.clnt, servers)` 建 group Clerk，调用它的 `Get`/`Put`。
4. 内层返回 `ErrWrongGroup` 就丢缓存，重新 `Query` 再试；`ErrMaybe` 原样传下去。`ErrWrongLeader` 由内层处理，不要冒泡。

跑：

```bash
cd ~/labs/6.5840/src
make RUN="-run TestStaticOneShardGroup5A" shardkv
```

官方示例：

```text
=== RUN   TestStaticOneShardGroup5A
Test (5A): one shard group ... (reliable network)...
  ... Passed --  time  9.4s #peers 1 #RPCs   822 #Ops  420
--- PASS: TestStaticOneShardGroup5A (9.52s)
PASS
ok      6.5840/shardkv1 10.542s
```

通过标志是 `--- PASS`。这个测试会关掉 `Gid1` 的 leader，再用剩下的两台读同一批 key；如果关了 leader 就读不到，说明 `Get` 没走 Raft，或者 `Gid1` 没有真的拥有全部 shard。

## 阶段 3：5A 加 join、delete、leave

目标：`TestJoinBasic5A`、`TestDeleteBasic5A`、`TestJoinLeaveBasic5A` 通过，最后 `make RUN="-run 5A" shardkv` 全绿。

改 `shardgrp/server.go` 和 `client.go`：

1. `FreezeShard` 走 `rsm.Submit`。`DoOp` 里 `!owned[s]` 返回 `ErrWrongGroup`；`args.Num < maxNum[s]` 返回过期错误；等于且已 frozen 返回 state，已 delete 返回错误；更大就设 `frozen[s] = true`，编码 state，更新 `maxNum[s]`。
2. state 用 `labgob` 或 JSON 编码，至少包含 KV、`versions`、`maxNum[s]` 和 frozen 标记；否则旧 RPC 还能回来覆盖。
3. `InstallShard` 也走 `rsm.Submit`。`args.Num < maxNum[s]` 拒绝；等于且已安装返回 `OK`，已删除拒绝；更大就覆盖状态，设 `owned[s] = true`、`frozen[s] = false`、`maxNum[s] = args.Num`。是替换不是合并。
4. `DeleteShard` 走 `rsm.Submit`。`args.Num < maxNum[s]` 拒绝；否则删 KV 和 `versions`，设 `owned[s] = false`，但保留 `maxNum[s]`，挡住更旧的 Install。
5. `FreezeShardReply.Num` 可以回传操作后的 `maxNum[s]`，controller 可据此判断自己是否落后。

改 `shardctrler.go` 的 `ChangeConfigTo`：

1. `current := sck.Query()`。`new.Num <= current.Num` 直接返回；`new.Num != current.Num+1` 在 5A 不会发生。
2. 读 `next` 再写：不存在就用版本 0；存在且 `next.Num < new.Num`，就用读到的版本覆盖它。`Put` 成功的 controller 继续；`ErrVersion` 说明别人抢先，读回 `next` 用它的内容。
3. 对每个 `current.Shards[s] != next.Shards[s]` 的 shard：旧 gid 非 0 就 `FreezeShard`，新 gid 非 0 就 `InstallShard`，旧 gid 非 0 就 `DeleteShard`，全用 `next.Num`。
4. 全部搬完后 promote：`Get` 当前版本，`Put(currentKey, next.String(), version)`。`ErrVersion` 说明别人先 promote，重读并确认 `current.Num >= next.Num` 后返回。
5. `ChangeConfigTo` 要同步：测试在它返回后马上 `Query` 检查成员，不要起后台 goroutine 做迁移。

`TestDeleteBasic5A` 用的是 `VALUESIZE=10000`（每个 value 10000 字节）和 `MAXRAFTSTATE=1000`（快照阈值 1000 字节），检查搬走之后 `Gid1`、`Gid2` 的 snapshot 总和不超过搬走前的 `sz + 10000`。value 远大于快照阈值，所以靠"日志还没截断"蒙不过去：源组不真删 shard，或者目标组把整份旧快照复制过去，总和都会超。

跑：

```bash
cd ~/labs/6.5840/src
make RUN="-run TestJoinBasic5A" shardkv
make RUN="-run TestDeleteBasic5A" shardkv
make RUN="-run TestJoinLeaveBasic5A" shardkv
make RUN="-run 5A" shardkv
```

官方 5A 全量输出的开头和结尾：

```text
Test (5A): Init and Query ... (reliable network)...
  ... Passed --  time  0.0s #peers 1 #RPCs     3 #Ops    0
Test (5A): one shard group ... (reliable network)...
  ... Passed --  time  5.1s #peers 1 #RPCs   792 #Ops  180
...
PASS
ok      6.5840/shardkv1 243.115s
```

通过标志是 14 个 `--- PASS`。`TestJoinBasic5A` 失败先看 `Num` 有没有加一、`Gid1` 关掉后是否还有一半 key 可读；空间超限先看 `DeleteShard` 有没有真删 map。

## 阶段 4：5B 让新 controller 接着搬

目标：`make RUN="-run 5B" shardkv` 全绿。

`TestJoinLeave5B` 先关掉 `Gid1`，再在 goroutine join 一个新组；join 在 `Gid1` 关着时不能完成，`Gid1` 重启后 2 秒内完成。leave 同理：目标组关掉时不能完成，重启后完成。group 不可达时必须等，不能返回成功或跳过 shard。

`TestRecoverCtrler5B` 跑 5 轮 `partitionCtrler`：controller 在 join/leave 中途被分区，测试重启 group，创建新 controller，调用 `InitController`，检查 `cfg.Num > 旧 Num` 且成员关系符合当时的 join/leave。

实现 `InitController`：

1. 读 `"config-current"` 和 `"config-next"`。`next == nil` 或 `next.Num <= current.Num` 就直接返回。
2. 否则把 `next` 当目标配置，重跑 `ChangeConfigTo` 的第 3 步：对每个 owner 变化的 shard 做 freeze/install/delete，全用 `next.Num`。
3. 搬完后把 `next` promote 成 current，版本检查同阶段 3。
4. RPC 可能重复：新 controller 不需要知道旧 controller 做到哪一步；`Num` 挡住旧的 Freeze/Install/Delete，重复的 Install/Delete 幂等。

`ChangeConfigTo` 每步后重读 current：`current.Num >= new.Num` 说明已被取代，停止返回。被分区的旧 controller 重连后不会覆盖新配置；两个 5B/5C 测试依赖这个退出路径。

跑：

```bash
cd ~/labs/6.5840/src
make RUN="-run 5B" shardkv
```

官方示例：

```text
Test (5B): Join/leave while a shardgrp is down... (reliable network)...
  ... Passed --  time  9.2s #peers 1 #RPCs   899 #Ops  120
Test (5B): recover controller ... (reliable network)...
  ... Passed --  time 26.4s #peers 1 #RPCs  3724 #Ops  360
PASS
ok      6.5840/shardkv1 35.805s
```

通过标志是两个 `--- PASS`。如果 join 在 group 关着时就返回了，说明你把 RPC 失败当成了成功；如果 `InitController` 后 `cfg.Num` 没变，说明 `next` 没存或没检查。

## 阶段 5：5C 让多个 controller 不打架

目标：`make RUN="-run 5C" shardkv` 全绿。

5C 的难点不是搬 shard，而是两个 controller 同时算出同一个 `Num` 的不同配置：A 想 join `Gid2`，B 想 join `Gid3`，都基于 current `Num=N` 算出 `N+1`；两个都写 `next` 就分叉。

用 `"config-next"` 的版本化 `Put` 做选举：

1. 只有用读到的 `next` 版本 `Put` 成功的 controller 赢得这个 `Num`，`next` 不存在时版本是 0；`ErrVersion` 的读回已有 `next`，用它的内容，或者直接返回。
2. 赢家负责搬 shard 和 promote；输家可以帮忙重跑同一份 `next` 的 RPC，但不能写自己的配置。
3. `InitController` 也可能被多个 controller 同时调用；它们都可能完成同一个 `next`。`Num` fencing 让重复 RPC 安全；promote 用版本检查，只有一个能推进 current。
4. `ChangeConfigTo` 开始时 `new.Num <= current.Num` 就直接返回；promote 失败时重读 current，`current.Num >= next.Num` 就认为完成。

`TestConcurrentReliable5C` 和 `TestAcquireLockConcurrentUnreliable5C` 各起 4 个 controller，各带 `tester.Clnt`，同时 join/leave 不同 gid 跑 2 秒，最后检查所有 key 可读。`TestPartitionControllerJoin5C` 把旧 controller 分区在 join 中途，新 controller 恢复 join，旧的重连后必须退出。`partitionRecovery5C` 把 3 或 5 轮分区和 60 秒客户端读写叠在一起，用 Porcupine 检查。

跑：

```bash
cd ~/labs/6.5840/src
make RUN="-run 5C" shardkv
```

官方示例里两组并发测试：

```text
Test (5C): Concurrent ctrlers ... (reliable network)...
  ... Passed --  time  8.2s #peers 1 #RPCs  1753 #Ops  120
PASS
ok      6.5840/shardkv1 8.364s
```

```text
Test (5C): Concurrent ctrlers ... (unreliable network)...
  ... Passed --  time 23.8s #peers 1 #RPCs  1850 #Ops  120
PASS
ok      6.5840/shardkv1 24.008s
```

`Partition` 子集的官方示例：

```text
Test (5C): partition controller in join... (reliable network)...
  ... Passed --  time  7.8s #peers 1 #RPCs   876 #Ops  120
...
PASS
ok      6.5840/shardkv1 217.779s
```

通过标志是 7 个 `--- PASS`。5C 的测试名都以 `5C` 结尾，`-run 5C` 会一次跑完；按官方示例相加约 250 秒。

## 阶段 6：5D 可选，收尾回归

5D 是自由扩展，官方页的方向有：controller 的 kvsrv 换成 kvraft、kvsrv 加 exactly-once、加 `Range`、kvraft 做 lease 读、kvraft 或 shardkv 加事务。选一个写 `extension.md`，说明设计、失败模式和验证；5D 不计入 judge。

收尾：

1. `make shardkv` 全量跑 3 次，5A/5B/5C 各单独跑 3 次。
2. `make raft1` 和 `make kvraft1` 再跑一次；Lab 5 复用同一套 Raft/rsm，改了就要回归。
3. 跑 judge：

```bash
cd ~/infra-systems
LAB_ROOT=~/labs/6.5840 ./judge/run.sh infra01 lab5
```

预期：

```text
CHECK PASS "5A shards" ""
CHECK PASS "5B controller recovery" ""
CHECK PASS "5C concurrent config" ""
SCORE 3/3
```

`--quick` 只跑 5A，最高显示 `PARTIAL`，不算通过。

## 测试与判分

5A 的 14 个测试：

| 测试 | 测什么 | 慢但正常 |
|---|---|---|
| `TestInitQuery5A` | `InitConfig` 存配置，`Query` 读回 `Num=1`、所有 shard 归 `Gid1` | 0.0 秒 |
| `TestStaticOneShardGroup5A` | 一个 group 服务所有 shard，关掉 leader 后仍可读 | 约 5 秒 |
| `TestJoinBasic5A` | 加 `Gid2`，`Num+1`，两边各分到 shard | 约 13 秒 |
| `TestDeleteBasic5A` | 搬走的 shard 在源组被删除，snapshot 不膨胀 | 约 8 秒 |
| `TestJoinLeaveBasic5A` | join、leave、再 join，数据一直在 | 约 14 秒 |
| `TestManyJoinLeaveReliable5A` / `Unreliable5A` | 8 个组反复 join/leave | 约 22 / 55 秒 |
| `TestShutdown5A` | 所有 group 关掉再重启，数据还在 | 约 12 秒 |
| `TestProgressShutdown5A` | 关掉 2 个组，存活组的 key 2 秒内可读 | 约 9 秒 |
| `TestProgressJoin5A` | 迁移期间未受影响的 shard 仍可读，4 秒内至少 100 次 | 约 14 秒 |
| `TestOneConcurrentClerkReliable5A` 等 4 个 | 1 或 10 个 client 在 join/leave 时读写，Porcupine 检查 | 约 20–26 秒 |

5B 的 2 个测试：

| 测试 | 测什么 | 慢但正常 |
|---|---|---|
| `TestJoinLeave5B` | group 关着时 join/leave 不能完成，重启后完成 | 约 9 秒 |
| `TestRecoverCtrler5B` | controller 被分区后，新 controller 接着完成 join/leave | 约 26 秒 |

5C 的 7 个测试：

| 测试 | 测什么 | 慢但正常 |
|---|---|---|
| `TestConcurrentReliable5C` | 4 个 controller 并发 join/leave | 约 8 秒 |
| `TestAcquireLockConcurrentUnreliable5C` | 同上，不可靠网络 | 约 24 秒 |
| `TestPartitionControllerJoin5C` | 旧 controller 在 join 中被分区，新 controller 恢复，旧的重连后退出 | 约 8 秒 |
| `TestPartitionRecoveryReliableNoClerk5C` / `UnreliableNoClerk5C` | 3–5 轮 controller 分区，无客户端 | 约 37 / 52 秒 |
| `TestPartitionRecoveryReliableClerks5C` / `UnreliableClerks5C` | 分区加 5 个客户端读写 60 秒，Porcupine 检查 | 约 60 秒 |

测试驱动里 `NSRV=3`、`NGRP=8`、`NKEYS=5*NShards=60`，每加一个组等 `INTERGRPDELAY=200 ms`。`setupKVService` 先起 `Gid1` 的 3 台 server，再用 `JoinBalance({Gid1: servers})` 初始化；新组通过 `MakeGroupStart` 启动，然后 controller 调 `ChangeConfigTo`。

`-race` 默认打开。5A 官方 243 秒，5C 约 250 秒；judge 超时 1200 秒，够用。最慢 `TestManyJoinLeaveUnreliable5A` 和两个 `PartitionRecovery...Clerks5C`。

## 常见错误：现象、原因、处理

| 现象 | 原因 | 处理 |
|---|---|---|
| `TestInitQuery5A` panic 在 `cfg.Num` | `Query()` 返回 `nil` | 实现 `InitConfig`/`Query` |
| 客户端一直 `ErrWrongGroup` | Clerk 不重新 `Query`，或 `owned` 没更新 | 收到就丢缓存配置，重读再试 |
| 关 leader 后读不到 | `Get` 读本地 map，或 `Gid1` 没拥有全部 shard | `Get` 走 `rsm.Submit`；`Gid1` 启动认领 12 个 shard |
| join 后 key 读不到 | Freeze 的 state 漏了 `versions`/`maxNum`，或 Install 没覆盖旧数据 | state 带 KV、去重表、`Num`；Install 是替换不是合并 |
| 两个 group 同时服务 shard | 配置在 install 前发布，或 Freeze 后源组还收 Put | 顺序 freeze、install、delete、publish；frozen 返回 `ErrWrongGroup` |
| `TestDeleteBasic5A` 空间超限 | `DeleteShard` 只标记，或 snapshot 留着旧 shard | 真删 KV/versions；snapshot 只存 owned 的 KV，保留 `maxNum` 和 owned/frozen 标记 |
| `TestProgressJoin5A` 超时 | 迁移停了不相关的 shard，或全局锁 | 只 freeze owner 变化的 shard；每个 shard 走自己的 Raft |
| group 关着时 join 完成了 | controller 把 RPC 失败当成功，或没等 Freeze | 不可达时重试/阻塞；不要跳过 shard |
| `TestPartitionControllerJoin5C` 旧 controller 覆盖新配置 | 没有 `Num` fencing，或 `ChangeConfigTo` 不重读 current | 每个 RPC 带 `Num`；每步后 `current.Num >= new.Num` 就退出 |
| 配置分叉：同 `Num` 两份 | 两个 controller 都写 `next` | 用读到的 `next` 版本 `Put`；输家读回已有 next |
| `InitController` 不恢复 | `next` 没存，或没比较 `Num` | 存 current 和 next；`next.Num > current.Num` 时重跑迁移 |
| `labgob` 警告字段小写 | 迁移参数或 state 结构体字段没大写 | 所有过 RPC/Raft 的字段首字母大写 |
| RPC reply 的 map 竞态 | handler 把 server 的 map 放进 reply | 复制一份，或编码成 `[]byte` |

## 调试手册

1. **只跑一个测试，把日志留下来。**

   ```bash
   cd ~/labs/6.5840/src
   make RUN="-run TestJoinBasic5A" shardkv > /tmp/shardkv-join.log 2>&1
   tail -60 /tmp/shardkv-join.log
   ```

   先看最后 60 行；`make shardkv` 先构建两个 daemon，构建错误和测试失败分开看。

2. **在 `ChangeConfigTo` 打一行状态。**

   打 `current.Num`、`new.Num`、shard、旧/新 gid、阶段、Err。正常 join 应看到每个移动 shard 走完四个阶段；卡在 freeze 说明源组不可达，卡在 install 说明目标组不可达或拒绝了这个 `Num`。

3. **在 `shardgrp.DoOp` 打 shard、owned、frozen、maxNum、op 类型、Err。**

   这里能看出 `ErrWrongGroup` 是“不归我管”还是“已 freeze”。Freeze 后还有 Put 被 apply，说明 `frozen` 没在 `DoOp` 里检查。

4. **直接看配置。**

   在 `Query` 里打印 `cfg.Num`、`cfg.Shards`、`cfg.Groups`。同一个 `Num` 出现两份不同 `Shards` 就是分叉；`Num` 跳号或回退，说明 promote 的版本检查有问题。

5. **确认进程。**

   `ps aux | grep shardgrp1d` 能看到每个 group 的 3 个 daemon；`ps aux | grep kvsrv1d` 能看到 controller 的 kvsrv。关 group 就是真的杀进程，不是模拟；重启后从 persister 恢复。

6. **用 `-race` 跑。**

   `make` 默认 `RACE=-race`。`owned`/`frozen`/`maxNum` 数组、`rcks` 缓存、`Clerk` 的配置缓存都是常见竞态点；5C 的并发 controller 最容易暴露。

7. **看 Porcupine。**

   线性一致失败时，测试会写 `porcupine-*.html` 并打印路径。看哪个 Get 读到迁移前/后的值；问题多在 freeze 和 publish 之间的窗口，或 Clerk 用了过期配置。

## 提交前检查

- [ ] `make shardkv` 全绿；5A/5B/5C 各单独跑 3 次。
- [ ] 默认 `-race` 跑过；没有 data race 或卡住的 goroutine。
- [ ] 每个 shard 同一时刻最多一个 owner；顺序是 freeze、install、delete、publish。
- [ ] 迁移带上 KV、去重表和 `maxNum`；`DeleteShard` 真的释放数据。
- [ ] 配置 `Num` 单调、不分叉；`next` 只用版本化 `Put` 抢一次。
- [ ] 旧 controller 被 `Num` 挡住；`InitController` 能完成 `next`。
- [ ] `ErrWrongGroup` 会重新 `Query`；`ErrWrongLeader` 只在 group 内换 server。
- [ ] `make raft1`、`make kvraft1` 仍然全绿；写了 300 字复盘（模板见[评分标准](grading.html#reflection)）。

## 自测问题

1. 为什么 freeze 是必要的？不 freeze 会怎样？
2. 为什么 shard group 之间不直接通信，而由 controller 协调？
3. RPC 里的 `Num` 和配置的 `Num` 是什么关系？它们各自防什么？
4. 5B 里新 controller 怎么知道旧 controller 做到哪一步？
5. 5C 里两个 controller 同时 `ChangeConfigTo`，只有一个能写 `next`，另一个应该做什么？
6. 如果客户端在配置变更期间用旧配置访问，会发生什么？怎么恢复？

### 答案要点

1. 不 freeze 的话，源组可能在状态复制后又接受 Put，目标组没有这个写；客户端切过去会读到旧值。Freeze 切一个点：之前的写进状态，之后的写被拒绝，再 install、delete、publish。
2. 直接通信会让每个 group 都知道其他 group 的地址和 owner，连接数和一致性变成 N 方问题。controller 读 current/next，按 `Num` 发 RPC；group 只负责自己的 shard。controller 崩了，新 controller 从 kvsrv 接着做。
3. 是同一个数：`next.Num` 或新配置的 `Num`，类型都是 `shardcfg.Tnum`。配置的 `Num` 给配置排序；RPC 的 `Num` 给每个 shard 的 Freeze/Install/Delete 排序，让 group 拒绝旧 controller 晚到的请求。两者都单调递增，作用域不同。
4. 不需要知道做到哪一步。新 controller 读 `next`，只要 `next.Num > current.Num`，就对所有 owner 变化的 shard 重跑 freeze/install/delete；重复 RPC 由 `Num` 和幂等挡住，跑完 promote。它靠目标状态加幂等操作恢复。
5. 输的一方读回已有 `next`，用它的内容；`next.Num >= 自己的 new.Num` 就不写自己的配置，直接返回。它可以帮忙重跑同一份 `next` 的 RPC，但不能用同一个 `Num` 写另一份配置。
6. 旧 owner 已 freeze 这个 shard，返回 `ErrWrongGroup`；Clerk 重新 `Query`，找到新 owner。未移动的 shard 在旧 owner 上仍可读。新配置还没发布时 Clerk 短暂重试；这个 shard 暂时不可用，但不会有两个 owner。
