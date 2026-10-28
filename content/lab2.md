# Lab 2 · KV Server 与锁

> 官方页：https://pdos.csail.mit.edu/6.5840/labs/lab-kvsrv1.html
>
> 这一页只给任务、约束和验收，不给实现。评分脚本在 `judge/tests/infra01/lab2.sh`。

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
