# Lab 4 · Fault-tolerant KV

> **课程**：[INFRA 01 · 分布式系统](course-map.html) · **实验 4/5**
>
> **先读**：[第 6 讲 Raft (1)](lectures.html#lec6)、[第 7 讲 Raft (2)](lectures.html#lec7) 和 [第 8 讲 线性一致](lectures.html#lec8) · **参考**：[官方 lab 页](https://pdos.csail.mit.edu/6.5840/labs/lab-kvraft1.html) · [Raft 论文](https://raft.github.io/raft.pdf)
>
> **评分**：`LAB_ROOT=~/labs/6.5840 ./judge/run.sh infra01 lab4` · [评分标准](grading.html)
>
> [上一个：Lab 3](lab3.html) · [返回作业](labs.html) · [下一个：Lab 5](lab5.html)

## 开始之前

先读[第 6 讲](lectures.html#lec6)、[第 7 讲](lectures.html#lec7)和[第 8 讲](lectures.html#lec8)。这个 lab 不引入新协议，只是把 Lab 2 的 KV 状态机放到 Raft 上；难点在“什么时候算提交”和“重复请求只执行一次”。

**本 lab 的不变量**

1. `Submit` 只有在 op 被 apply 后才返回结果；`Start` 成功不等于提交成功。
2. 同一个 op 重试只执行一次，返回第一次的结果。
3. `Get` 也走 Raft（或等价的线性一致读），不能直接读本地 map。
4. follower 不执行写，返回 `ErrWrongLeader`，让客户端换 leader。
5. snapshot 包含 KV 数据、去重表和 `lastApplied`；restore 后 apply 不倒退。

**第一次跑通**

1. 4A 先用一个最小状态机（例如只记录 apply 次数）验证 `Submit`/`applyCh` 的时序，再跑 `make RUN="-run 4A" rsm1`。
2. 4B 把 Lab 2 的 Put/Get 语义搬进状态机，跑 `make RUN="-run 4B" kvraft1`。
3. 4C 加 snapshot，先手动触发，再跑 `make RUN="-run 4C" kvraft1`。
4. 最后跑 `make rsm1` 和 `make kvraft1` 全量，开 `-race`。

## 目标

用 Lab 3 的 Raft 把 Lab 2 的单机 KV 变成容错服务：多个 server 用 Raft 复制同一个状态机；多数派活着时，服务继续处理 `Put` / `Get`，并保持 **linearizable**、`Put` **at-most-once**。

分三部分：

- **4A**：通用的 replicated state machine（`rsm`）。
- **4B**：用 `rsm` 实现 KV，不带 snapshot。
- **4C**：加 snapshot，让 Raft 丢弃旧日志。

## 修改哪些文件

- `src/kvraft1/rsm/rsm.go`：`RSM`、`StateMachine` 接口、`Submit`。
- `src/kvraft1/server.go`：`KVServer`，实现 `DoOp`、`Snapshot`、`Restore`、`Get`、`Put`。
- `src/kvraft1/client.go`：`Clerk`，找 leader、重试。
- `src/kvraft1/rsm/server.go`、`proxy.go` 和测试文件不要改。

`StartKVServer` 已经注册了 `rsm.Op`、`rpc.PutArgs`、`rpc.GetArgs`，并创建了 `RSM`；你不需要改注册。

## 要求

**4A：RSM**

- `Submit(op)` 把 op 交给 Raft；只有 leader 能提交。
- op 被 apply 后，`Submit` 返回对应结果；不能把 `Start` 成功当成提交成功。
- 每个 op 带唯一 ID；重复提交（客户端重试）只执行一次，返回第一次的结果。
- follower 收到 `Submit` 时，要把客户端引导到 leader，不能本地执行。
- `applyCh` 只由一个 goroutine 读，按顺序处理。

**4B：KV**

- `Get` / `Put` 线性一致；`Get` 不能直接读本地 map。
- `Put` 的 version 规则和 Lab 2 一致。
- Clerk 在 `ErrWrongLeader` 时换 leader；在 `ErrMaybe` 时查结果，不能盲目重试。
- 只有 leader 的 `Submit` 在等结果；follower 不要阻塞。

**4C：Snapshot**

- `maxraftstate` 限制 Raft 日志大小；超过时做 snapshot。
- snapshot 要包含 KV 数据和去重表。
- `Restore` 能从 snapshot 重建状态；apply 不能倒退。
- snapshot 的 index 和 Raft 日志 index 要对齐。

## 测试

```bash
cd ~/labs/6.5840/src

make rsm1
make kvraft1
make RUN="-run 4A" rsm1
make RUN="-run 4B" kvraft1
make RUN="-run 4C" kvraft1
```

| 测试 | 测什么 |
|---|---|
| 4A | `Submit` 只返回一次结果；重复提交不重复执行 |
| 4B | 多 server、leader 切换、网络失败下的线性一致 KV |
| 4C | snapshot 后日志被裁剪；重启/落后 follower 能恢复 |

## 本地评分

```bash
LAB_ROOT=~/labs/6.5840 ./judge/run.sh infra01 lab4
LAB_ROOT=~/labs/6.5840 ./judge/run.sh infra01 lab4 --quick
```

## 调试

- 在 `Submit` 入口打印 op ID、term、index；在 apply 处打印 index、op ID、结果。
- 看到 `Submit` 卡住，先查它等的结果是否已经被 apply，或 applyCh 是否被多个 goroutine 抢读。
- 看到 leader 切换后重复执行，查去重表和 snapshot 里的去重表。
- snapshot 之后 apply 倒退，先查 `lastApplied` 和 snapshot 的 index。

## 常见坑

- `Submit` 把 `Start` 成功当成提交成功。
- `Submit` 等待时持锁，reader 无法推进。
- 多个 goroutine 同时读 `applyCh`。
- follower 也返回结果给客户端。
- `Get` 直接读本地 map，返回 stale data。
- `Put` 的 version 规则写错。
- Clerk 不换 leader，一直发同一个 server。
- `ErrMaybe` 语义写错。
- snapshot 的 index 用错。
- 去重表没进 snapshot。
- `labgob.Register` 漏了 `rsm.Op` 或请求类型。

## 自测问题

- `Submit` 怎么知道 apply 的是自己提交的那个 op，而不是另一个客户端的？
- 为什么 `Get` 也要走 Raft？只读本地 map 会破坏什么？
- 重复提交的 op 应该在 apply 时去重，还是在 `Submit` 时去重？两者的失败场景有什么不同？
- snapshot 为什么要包含去重表？只存 KV 数据会怎样？
- follower 收到 `Submit` 时，应该返回什么？为什么不能本地执行？

## 提交前检查

- [ ] `make rsm1` 和 `make kvraft1` 全绿；4B/4C 关键测试各跑 3 次。
- [ ] 用默认 `-race` 跑过；`Submit` 只在 apply 后返回。
- [ ] 去重表和 snapshot 包含在状态里；重启后不重复执行。
- [ ] follower 返回 `ErrWrongLeader`；`Get` 不直接读本地 map。
- [ ] 能讲清 RSM、线性一致读、snapshot 边界；写了 300 字复盘（模板见[评分标准](grading.html#reflection)）。
