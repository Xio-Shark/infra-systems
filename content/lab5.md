# Lab 5 · Sharded KV

> **课程**：[INFRA 01 · 分布式系统](course-map.html) · **实验 5/5**
>
> **先读**：[第 12 讲 Spanner](lectures.html#lec12) · **参考**：[官方 lab 页](https://pdos.csail.mit.edu/6.5840/labs/lab-shard1.html) · [Spanner 论文](https://research.google/pubs/pub39966/)
>
> **评分**：`LAB_ROOT=~/labs/6.5840 ./judge/run.sh infra01 lab5` · [评分标准](grading.html)
>
> [上一个：Lab 4](lab4.html) · [返回作业](labs.html)
>
> 这一页只给任务、约束和验收，不给实现。评分脚本在 `judge/tests/infra01/lab5.sh`。

## 目标

把 KV 按 key 分片到多个 Raft-replicated shard group（`shardgrp`）。用一个 `shardctrler` 存配置，用一个 controller 执行配置变更，把 shard 从一个组搬到另一个组。

在配置变更、controller 崩溃、网络分区时，系统仍要保持 **linearizability**，并且同一时刻每个 shard 最多只有一个组在服务。

分四部分：

- **5A**：无故障下的 shard 移动（join/leave）。
- **5B**：controller 崩溃后的恢复。
- **5C**：多个 controller 并发运行。
- **5D**：自由扩展（可选）。

## 系统组成

- **shardctrler**：存 `ShardConfig`（shard → group 的映射），本身用 Lab 2 的 KV 复制。
- **shardgrp**：一个 Raft group，负责一部分 shard；成员固定，不做 Raft membership change。
- **controller**：管理员客户端，调用 `ChangeConfigTo` 搬迁 shard；它可能崩溃、被分区。
- **shardkv Clerk**：先 `Query` 配置，找到 key 对应的 shard 和 group，再向该 group 发 `Put` / `Get`。

`src/shardkv1/shardcfg` 已经提供：

```go
type ShardConfig struct {
    Num    int
    Shards [NShards]Gid
    Groups map[Gid][]string
}
```

- `Num`：配置编号，单调递增。
- `Shards[i]`：第 i 个 shard 由哪个 group 负责。
- `Groups[gid]`：该 group 的 server 列表。

## 要求

**5A：移动 shard**

- 实现 `InitConfig`、`Query(num)`、`ChangeConfigTo(newConfig)`。
- 先让单个 group 服务所有 shard，再做 join/leave。
- 迁移一个 shard 时：源组停止服务该 shard，传输状态，目标组安装完成后再对外服务。
- 迁移要带上 KV 数据和去重表。
- 客户端用旧配置访问时，返回 `ErrWrongGroup`，让它重新 `Query`。

**5B：controller 崩溃恢复**

- controller 的每一步要可恢复；崩溃后新 controller 能接着做，不能重做一半。
- 配置更新要原子；旧 controller 的请求要被 `Num` 拒绝。
- 未完成的迁移要能被新 controller 识别并继续或回滚。

**5C：并发 controller**

- 多个 controller 同时 `ChangeConfigTo` 时，只能有一个写成功。
- 失败的一方要重新读配置，不能覆盖别人的新配置。
- 配置编号单调递增，不能分叉。

**5D：可选**

- 自己选一个扩展：更快迁移、更好的负载均衡、快照、故障注入测试等；写清楚设计、失败模式和验证方法。

## 测试

```bash
cd ~/labs/6.5840/src

make shardkv
make RUN="-run 5A" shardkv
make RUN="-run 5B" shardkv
make RUN="-run 5C" shardkv
make RUN="-run Partition" shardkv
```

- `make shardkv` 用 `-timeout 15m`；5A/5C 的测试很慢。
- 先让 `TestInitQuery5A` 过，再 `TestStaticOneShardGroup5A`，再 join/leave。
- 用 `-race`；并发 controller 和 shard 迁移很容易有竞态。
- 在 `ChangeConfigTo`、Freeze/Install/Delete、配置更新处打印 `Num`、shard、gid、状态。

## 本地评分

```bash
LAB_ROOT=~/labs/6.5840 ./judge/run.sh infra01 lab5
LAB_ROOT=~/labs/6.5840 ./judge/run.sh infra01 lab5 --quick
```

## 常见坑

- `ChangeConfigTo` 在 install 完成前就发布新配置，客户端读到不完整状态。
- freeze 之后源组还接受该 shard 的 `Put`。
- install 之后目标组还没准备好就对外服务。
- 旧 controller 的 RPC 没被 `Num` 拒绝。
- 多个 controller 同时写 `next`，配置分叉。
- `InitController` 没完成旧的 `next`。
- 搬 shard 时把未受影响的 shard 也停了。
- `ErrWrongGroup` 没让 Clerk 重新 `Query`。
- 配置存在 KV 里，但没处理 `ErrMaybe` / 版本冲突。
- shard 迁移没有包含去重表或 snapshot 状态。

## 自测问题

- 为什么 freeze 是必要的？不 freeze 会怎样？
- 为什么 shard group 之间不直接通信，而由 controller 协调？
- `Num` 和配置的 `Num` 是同一个东西吗？它们各自防什么？
- 5B 里新 controller 怎么知道旧 controller 做到哪一步？
- 5C 里两个 controller 同时 `ChangeConfigTo`，只有一个能写 `next`，另一个应该做什么？
- 如果客户端在配置变更期间用旧配置访问，会发生什么？怎么恢复？
