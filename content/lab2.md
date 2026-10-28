# Lab 2 · KV Server 与锁

> **课程**：[INFRA 01 · 分布式系统](course-map.html) · **实验 2/5**
>
> **先读**：[第 2 讲 RPC and Threads](lectures.html#lec2) 和 [第 8 讲 线性一致](lectures.html#lec8) · **参考**：[官方 lab 页](https://pdos.csail.mit.edu/6.5840/labs/lab-kvsrv1.html) · [Go 并发](https://go.dev/doc/effective_go#concurrency) · [阅读](papers.html)
>
> **评分**：`LAB_ROOT=~/labs/6.5840 ./judge/run.sh infra01 lab2` · [评分标准](grading.html)
>
> [上一个：Lab 1](lab1.html) · [返回作业](labs.html) · [下一个：Lab 3](lab3.html)

## 开始之前

先读[第 2 讲](lectures.html#lec2)和[第 8 讲](lectures.html#lec8)。你需要知道 RPC 重试、at-most-once、线性一致和锁的基本语义；讲义已经覆盖这些，论文不是前置。

**本 lab 的不变量**

1. 每个 key 的 version 单调递增；`Put` 只在 expected version 匹配时生效。
2. 同一个请求重发不会产生第二次修改；重发后的 `ErrVersion` 要能和“第一次就没执行”区分。
3. `Get` 返回最后一次成功 `Put` 的值，不能读到旧值或在成功后回退。
4. 同一把锁同一时刻最多一个持有者；`Release` 只释放自己的锁。

**第一次跑通**

1. 先跑可靠网络：

   ```bash
   cd ~/labs/6.5840/src
   make RUN="-run Reliable" kvsrv1
   ```

2. 再跑不可靠网络，确认重发和去重：

   ```bash
   make RUN="-run Unreliable" kvsrv1
   ```

3. KV 稳定后再做锁：先 `make lock1`，再跑 `ManyClients...`。
4. 不要一开始就做锁；KV 的版本语义不稳，锁的测试会把问题放大。

**环境**：只改 `client.go`、`server.go`、`lock/lock.go`；`rpc/rpc.go` 是契约，不要改。

## 目标

实现一个单机 key/value 服务：

- `Put` 在 network failure 下 **at-most-once**（最多执行一次）。
- 所有 `Put` / `Get` 从客户端看是 **linearizable**（线性一致）。

然后用这个 KV 服务实现一个分布式锁。这个 lab 是 Lab 4 的前置。

## 修改哪些文件

- `src/kvsrv1/client.go`：`Clerk`，实现 `Get` / `Put` 和重试。
- `src/kvsrv1/server.go`：`KVServer`，实现 RPC handler。
- `src/kvsrv1/lock/lock.go`：用 KV 实现 `Acquire` / `Release`。
- `src/kvsrv1/rpc/rpc.go`：RPC 类型和错误常量，不要改。

## 要求

服务端为每个 key 存 `(value, version)`。`Put` 的语义：

| 情况 | 行为 |
|---|---|
| key 不存在，`version == 0` | 创建 key，存 value，version 变成 1，返回 `OK` |
| key 不存在，`version > 0` | 返回 `ErrNoKey` |
| key 存在，`version == 当前 version` | 更新 value，version 加 1，返回 `OK` |
| key 存在，`version != 当前 version` | 返回 `ErrVersion` |

`Get` 的语义：

- key 存在：返回 value、version、`OK`。
- key 不存在：返回 `ErrNoKey`。

Clerk 的要求：

- 网络失败时重发同一个请求，不产生第二次 `Put`。
- 重发后收到 `ErrVersion`，要能区分“第一次执行了”和“第一次没执行”。
- `Get` / `Put` 的返回值必须符合线性一致：不能读到旧值，也不能在成功后回退。

锁的要求：

- `Acquire(lockname)` 成功返回时，调用者确实持有锁。
- `Release(lockname)` 只释放自己持有的锁。
- 多个客户端并发抢锁时，同一时刻最多一个持有者。

## 测试

```bash
cd ~/labs/6.5840/src

make RUN="-run Reliable" kvsrv1
make RUN="-run Unreliable" kvsrv1
make kvsrv1
make lock1
make RUN="-run ManyClientsUnreliable" lock1
```

| 测试 | 测什么 |
|---|---|
| `TestReliablePut` | 可靠网络下的 Put/Get |
| `TestPutConcurrentReliable` | 多客户端并发写同一个 key |
| `TestUnreliableNet` | 丢包/重排下的 Put/Get |
| `TestReliableBasic` / `TestReliableNested` | 单客户端、多把锁 |
| `TestOneClientReliable` / `TestManyClientsReliable` | 多客户端抢锁 |
| `TestOneClientUnreliable` / `TestManyClientsUnreliable` | 不可靠网络下抢锁 |

## 本地评分

```bash
LAB_ROOT=~/labs/6.5840 ./judge/run.sh infra01 lab2
LAB_ROOT=~/labs/6.5840 ./judge/run.sh infra01 lab2 --quick
```

## 调试

- 每次 RPC 前把 Reply 清零；复用变量会把上一次的 `Err`/`Value` 带回来。
- 在 server 的 Put/Get 入口打印 key、version、当前 value；在 client 重试处打印第几次、收到什么 `Err`。
- 锁测试失败先看 `Acquire` 是否在确认成功后返回，再看 `Release` 是否检查了 owner。
- `TestMemPutManyClientsReliable` 约 50 秒，不是挂死；留足 `-timeout`。

## 常见坑

- Reply 没清零，复用了上一次的返回值。
- 比较 version 和更新 value 不在同一个锁里。
- 第一次 `ErrVersion` 和重发后的 `ErrVersion` 用了同一个错误。
- `Acquire` 没有确认自己真的拿到锁就返回。
- `Release` 没有检查 value 是不是自己的 ID。
- 忙等把 CPU 打满；用 `time.Sleep`。
- 锁的 key 和测试 key 冲突；给 `lockname` 加前缀。
- `TestMemPutManyClientsReliable` 很慢（约 50 秒），不是挂死。

## 自测问题

- 为什么版本号能实现 at-most-once？它省掉了哪种去重表？
- 第一次收到 `ErrVersion` 和重发后收到 `ErrVersion`，语义有什么不同？
- `Acquire` 收到 `ErrMaybe` 后，怎么判断自己是否拿到了锁？
- 如果两个客户端同时 `Acquire`，哪个机制保证只有一个成功？

## 提交前检查

- [ ] 对应 `make` 目标全绿；关键的故障测试重复跑 3 次没有偶发失败。
- [ ] 开 `-race` 跑过；没有 data race 或 goroutine 泄漏。
- [ ] 没有残留的临时文件、子进程、namespace、cgroup。
- [ ] 能不看代码讲清楚：核心不变量、失败恢复路径、每个测试在测什么。
- [ ] 写了 300 字复盘：问题、设计、失败模式、测试结果。
