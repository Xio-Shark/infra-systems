# Lab 4 · Fault-tolerant KV

> **课程**：[INFRA 01 · 分布式系统](course-map.html) · **实验 4/5**
>
> **先读**：[第 6 讲 Raft (1)](lectures.html#lec6) 和 [第 7 讲 Raft (2)](lectures.html#lec7) · **参考**：[官方 lab 页](https://pdos.csail.mit.edu/6.5840/labs/lab-kvraft1.html) · [阅读](papers.html)
>
> **评分**：`LAB_ROOT=~/labs/6.5840 ./judge/run.sh infra01 lab4` · [评分标准](grading.html)
>
> [上一个：Lab 3](lab3.html) · [返回作业](labs.html) · [下一个：Lab 5](lab5.html)
>
> 这一页只给任务、约束和验收，不给实现。评分脚本在 `judge/tests/infra01/lab4.sh`。

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
