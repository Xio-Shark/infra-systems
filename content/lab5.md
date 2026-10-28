# Lab 5 中文精读：Sharded Key/Value Service

> 官方页：https://pdos.csail.mit.edu/6.5840/labs/lab-shard1.html
>
> 本站是忠实于 lab 要求的中文导读，保留技术术语英文；不提供可直接提交的代码。
> 课程要求独立完成。

## 一句话

把 KV 按 key 分片（shard）到多个 Raft-replicated **shardgrp**；用一个 **shardctrler** 存配置，用一个 **controller** 执行配置变更（把 shard 从一个组搬到另一个组）。系统要在配置变更、controller 崩溃、网络分区的情况下仍然保持 **linearizability**，并且同一时刻每个 shard 最多只有一个组在服务。

Lab 5 分四部分：

- **5A**：无故障下的 shard 移动（join/leave）。
- **5B**：controller 崩溃后的恢复。
- **5C**：多个 controller 并发运行。
- **5D**：自由扩展（可选）。

## 系统组成

```text
client
  |
  v
shardkv Clerk  --- Query --->  shardctrler (配置服务, 基于 Lab 2 的 kvsrv)
  |                                   ^
  |                                   |
  v                                   |
shardgrp (Raft group)  <--- controller (ChangeConfigTo)
  |  shard 1, 3, 5 ...               |
  |  FreezeShard/InstallShard/DeleteShard
  v
rsm / Raft
```

- **shardgrp**：一个 Raft group，负责一部分 shard。每个 shardgrp 的成员固定，不做 Raft membership change。
- **shardctrler**：存 `ShardConfig`（shard → group 的映射），本身用 Lab 2 的 `kvsrv` 复制。
- **controller**：管理员客户端，调用 `ChangeConfigTo` 搬迁 shard；它可能崩溃、被分区。
- **shardkv Clerk**：先 `Query` 配置，找到 key 对应的 shard 和 group，再向该 group 发 `Put`/`Get`。

## 配置

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

`shardctrler` 要实现：

- `InitConfig(config)`：把初始配置存进 kvsrv。
- `Query(num)`：返回当前配置（或指定编号的配置）。
- `ChangeConfigTo(newConfig)`：从当前配置迁移到新配置。

## 5A：移动 shard

### 5A 的第一步：静态单组

1. 实现 `shardctrler.InitConfig` / `Query`，把配置存进 `kvsrv`。
2. 实现 `shardgrp`（复制 Lab 4 的 KV + `rsm`）和 `shardgrp` clerk。
3. 实现 `shardkv` clerk：`Query` 配置 → 找 group → 发 `Put`/`Get`。
4. 第一个 `shardgrp`（`shardcfg.Gid1`）初始化时拥有所有 shard。

做完这些，`TestInitQuery5A` 和 `TestStaticOneShardGroup5A` 应该过。

### 5A 的第二步：join/leave

`ChangeConfigTo` 的推荐流程：

1. **Freeze**：让 source shardgrp 冻结要搬走的 shard，拒绝该 shard 上的 `Put`。
2. **Install**：把 shard 的数据复制到 destination shardgrp。
3. **Delete**：source 删除已冻结的 shard。
4. **Post config**：把新配置写进 `shardctrler`，客户端之后按新配置找组。

这样 shardgrp 之间不需要直接通信；不受影响的 shard 可以继续服务。

### Num fencing

每个 `FreezeShard`/`InstallShard`/`DeleteShard` RPC 都带 `Num`。shardgrp 要记住每个 shard 见过的最大 `Num`，拒绝旧 `Num` 的 RPC。这样：

- 旧 controller 的迟到 RPC 不会覆盖新状态。
- 重复的 RPC 可以安全重试。

### ErrWrongGroup

如果客户端找错组（该组不负责这个 key 的 shard），shardgrp 返回 `ErrWrongGroup`；Clerk 重新 `Query` 配置并重试。

### 5A 的关键不变量

- **同一时刻每个 shard 最多只有一个组在服务**：freeze 之后 source 不再接受写；install 完成之前 destination 不对外服务；配置 post 之后客户端才切过去。
- **未受影响的 shard 继续服务**：不要因为一个 shard 在搬就把整个组停掉。
- **线性一致**：搬 shard 的过程中，已经完成的写不能丢；读不能看到旧状态。

### 5A 的测试

```bash
cd ~/labs/6.5840/src
make RUN="-run 5A" shardkv
```

包括：初始化/查询、单组、join、delete、join/leave、多组、不可靠网络、shutdown、进度、并发客户端。

## 5B：controller 崩溃恢复

controller 是一个短命进程：搬完 shard 就退出。它可能在 `ChangeConfigTo` 中途崩溃或被分区。

要求：测试启动一个新 controller，调用 `InitController`，新 controller 要完成旧 controller 没做完的配置变更。

推荐做法：

- 在 `shardctrler` 里存两份配置：**current** 和 **next**。
- `ChangeConfigTo` 开始时写 `next`；完成后把 `next` 变成 `current`。
- `InitController` 先检查 `next` 是否存在且 `Num > current.Num`；如果是，继续完成 `next` 的迁移。
- 重复的 `FreezeShard`/`InstallShard`/`DeleteShard` 用 `Num` 去重。

### 5B 的测试

```bash
make RUN="-run 5B" shardkv
```

包括：shardgrp down 时 join/leave、controller 恢复。

## 5C：并发 controller

测试会同时启动多个 controller；它们可能都在尝试 `ChangeConfigTo`。要求：

- 只有一个 controller 能成功写 `next` 配置。
- 其他 controller 的 `ChangeConfigTo` 直接返回（不报错）。
- 旧 controller 的 shard RPC 被 `Num` fencing 拒绝。

推荐做法：

- 用 kvsrv 的 **versioned Put**：读当前配置和 version，写 `next` 时带上 version；只有 version 匹配的 Put 成功。
- `Num` 继续做 shardgrp RPC 的 fencing。
- 新 controller 先完成 `next`（5B 的恢复逻辑），再处理新的配置变更。

### 5C 的测试

```bash
make RUN="-run TestConcurrentReliable5C" shardkv
make RUN="-run TestAcquireLockConcurrentUnreliable5C" shardkv
make RUN="-run Partition" shardkv
```

## 5D：扩展（可选）

官方给了一些方向：

- 用 `kvraft` 而不是 `kvsrv` 存配置。
- 给 `kvsrv` 加 exactly-once 语义。
- 给 `kvsrv` 加 `Range`。
- 让 `kvraft` leader 用 lease 直接服务 `Get`。
- 给 `kvraft` 加事务。
- 给 `shardkv` 加跨 shard 事务（2PC + 2PL）。

写一个 `extension.md` 描述你的扩展和测试。

## 测试与调试

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
- 失败时先判断是“配置没更新”“shard 没搬完”还是“客户端用了旧配置”。

## 常见坑

- [ ] `ChangeConfigTo` 在 install 完成前就 post 新配置，客户端读到不完整状态。
- [ ] freeze 之后 source 还接受该 shard 的 Put。
- [ ] install 之后 destination 还没准备好就对外服务。
- [ ] 旧 controller 的 RPC 没被 `Num` 拒绝。
- [ ] 多个 controller 同时写 `next`，配置分叉。
- [ ] `InitController` 没完成旧的 `next`。
- [ ] 搬 shard 时把未受影响的 shard 也停了。
- [ ] `ErrWrongGroup` 没让 Clerk 重新 Query。
- [ ] 配置存在 kvsrv 里，但没处理 `ErrMaybe` / 版本冲突。
- [ ] `shardctrler` 的 `Query(num)` 语义写错（返回当前还是指定版本）。
- [ ] shard 迁移没有包含去重表/snapshot 状态。
- [ ] 5A 过了但 5B/5C 挂：通常是 controller 恢复/并发写配置的问题。

## 自测问题

- 为什么 freeze 是必要的？不 freeze 会怎样？
- 为什么 shardgrp 之间不直接通信，而由 controller 协调？
- `Num` 和配置的 `Num` 是同一个东西吗？它们各自防什么？
- 5B 里新 controller 怎么知道旧 controller 做到哪一步？
- 5C 里两个 controller 同时 `ChangeConfigTo`，只有一个能写 `next`，另一个应该做什么？
- 如果客户端在配置变更期间用旧配置访问，会发生什么？怎么恢复？
