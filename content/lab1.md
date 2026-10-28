# Lab 1 · MapReduce

> **课程**：[INFRA 01 · 分布式系统](course-map.html) · **实验 1/5**
>
> **先读**：[第 1 讲 MapReduce](lectures.html#lec1) · **参考**：[官方 lab 页](https://pdos.csail.mit.edu/6.5840/labs/lab-mr.html) · [MapReduce 论文](https://static.googleusercontent.com/media/research.google.com/en//archive/mapreduce-osdi04.pdf)
>
> **评分**：`LAB_ROOT=~/labs/6.5840 ./judge/run.sh infra01 lab1` · [评分标准](grading.html)
>
> [返回作业](labs.html) · [下一个：Lab 2](lab2.html)

## 目标

用 Go 写一个简化版 MapReduce：一个 coordinator 把 map/reduce 任务分给多个 worker；worker 通过 RPC 领任务，读输入，调用插件里的 `Map` / `Reduce`，写中间文件和最终输出。

coordinator 要处理 worker 崩溃、卡住、太慢：超过 10 秒没完成就重发任务。

## 修改哪些文件

只改这三个：

- `src/mr/coordinator.go`
- `src/mr/worker.go`
- `src/mr/rpc.go`

测试时其他文件保持原版。

## 任务

1. coordinator 按顺序推进 map 阶段和 reduce 阶段；所有 map 完成后才能开始 reduce。
2. worker 向 coordinator 要任务，执行 map 或 reduce，然后报告完成。
3. map 的输出按 key 分成 `nReduce` 个桶；第 X 个 reduce 任务只读第 X 个桶。
4. 所有 reduce 完成后，`Done()` 返回 true，worker 退出。
5. worker 崩溃或超时后，coordinator 把同一个任务重新发给另一个 worker；重复报告不能破坏状态。

## 硬性约束

- 中间文件命名 `mr-X-Y`，X 是 map 任务号，Y 是 reduce 分区号。
- 第 X 个 reduce 的输出必须叫 `mr-out-X`。
- `mr-out-X` 每行一个结果，格式是 `%v %v\n`（key, value）。
- coordinator 和 worker 只通过 RPC 通信，不共享内存。
- 文件写入用临时文件 + 原子 rename，保证读者不会看到写了一半的文件。
- 不要改 `mrapps/`、`main/`、`labrpc/` 和测试文件。

## 测试

```bash
cd ~/labs/6.5840/src

make RUN="-run Wc" mr
make RUN="-run Indexer" mr
make RUN="-run MapParallel" mr
make RUN="-run ReduceParallel" mr
make RUN="-run JobCount" mr
make RUN="-run EarlyExit" mr
make RUN="-run Crash" mr
make mr
```

| 测试 | 测什么 |
|---|---|
| `TestWc` | word count 输出正确 |
| `TestIndexer` | 倒排索引输出正确 |
| `TestMapParallel` | 至少 2 个 map worker 并行 |
| `TestReduceParallel` | 至少 2 个 reduce 并行 |
| `TestJobCount` | 没有乱发重复任务 |
| `TestEarlyExit` | 所有 reduce 完成后 coordinator 及时退出 |
| `TestCrashWorker` | worker 崩溃后，超时重发，最终结果正确 |

第一次直接 `make mr` 可能挂住，因为 `Done()` 还没实现；先跑单个测试。

## 本地评分

```bash
LAB_ROOT=~/labs/6.5840 ./judge/run.sh infra01 lab1
LAB_ROOT=~/labs/6.5840 ./judge/run.sh infra01 lab1 --quick
```

## 常见坑

- worker 的当前目录是 `mr-tmp-*`，输入路径是相对的；输出不要加 `../`。
- RPC 结构体字段首字母必须大写，否则 `net/rpc` 不传。
- 不要在持锁时发 RPC、读文件或 `time.Sleep`。
- 超时重发后，旧 worker 可能晚到；报告要幂等。
- `Done()` 太早会让 `TestEarlyExit` 失败，太晚会让 `make mr` 挂住。
- reduce 输出不是 JSON；每行一个 `key value`。

## 自测问题

- 为什么 map 输出要按 key 分区，而不是让每个 reduce 读所有 map 输出？
- worker 写完文件但没报告就崩溃，会发生什么？coordinator 怎么恢复？
- 如果 coordinator 在 reduce 阶段崩溃，测试允许吗？为什么？
- 临时文件 + rename 解决了哪个竞态？
