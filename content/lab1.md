# Lab 1 · MapReduce

> **课程**：[INFRA 01 · 分布式系统](course-map.html) · **实验 1/5**
>
> **先读**：[第 1 讲 MapReduce](lectures.html#lec1) 和 [第 2 讲 RPC](lectures.html#lec2) · **参考**：[官方实验页](https://pdos.csail.mit.edu/6.5840/labs/lab-mr.html) · [MapReduce 论文](https://static.googleusercontent.com/media/research.google.com/en//archive/mapreduce-osdi04.pdf)
>
> **评分**：`LAB_ROOT=~/labs/6.5840 ./judge/run.sh infra01 lab1` · [评分标准](grading.html)
>
> [返回作业](labs.html) · [下一个：Lab 2](lab2.html)
>
> **难度** ★★ · **先修** 第 1、2 讲 + Go 基础 · **时间** 8–12 小时 · **最小通过** `TestWc` + `TestIndexer`（judge 显示 `PASS`）；**完整通过** 7 个测试全绿
>
> judge 的 `min_pass` 与这一行一致，写在 `judge/courses/infra01.json`；改这一行就要同步改那里。

## 你将完成什么

写完 `mr/coordinator.go`、`mr/worker.go` 和 `mr/rpc.go` 之后，你会在 `src` 目录下跑通：

```bash
make mr
```

七个测试全部 PASS，最后一行是 `ok 6.5840/mr ...`。测试会启动一个 coordinator 和多个 worker，检查 word count 和倒排索引的输出、map/reduce 的并行度、重复任务数量、提前退出和 worker 崩溃恢复。

这个实验不只看输出对不对：`TestJobCount` 会数你发了多少次 map 任务，`TestEarlyExit` 会检查有没有进程在输出完成前退出，`TestCrashWorker` 会随机杀掉 worker。三个测试分别对应“不要重复调度”“不要提前退出”“要能重跑”。

## 开始之前

先读[第 1 讲](lectures.html#lec1)和[第 2 讲](lectures.html#lec2)。第 1 讲给你 MapReduce 的数据流和失败模型；第 2 讲给你 RPC、重试和并发的背景。论文可以做完再看。

环境检查：

```bash
cd ~/labs/6.5840/src
go version          # 需要 Go 1.22+
ls mr               # 应该看到 coordinator.go、worker.go、rpc.go、mr_test.go
```

第一次跑 `make mr` 会挂住，因为 `Done()` 默认返回 false。这是预期的。想看到失败信息，把 `mr/coordinator.go` 里的 `ret := false` 临时改成 `true`，再跑：

```bash
make mr
```

你会看到：

```text
=== RUN   TestWc
... reduce created no mr-out-X output files!
exit status 1
FAIL    6.5840/mr       4.516s
```

这说明测试在等 `mr-out-*`，而你的 reduce 还没有写。把 `ret` 改回 `false`，开始实现。

时间预算：8–12 小时。第一次做不要一上来就写并发；先让一条任务链跑通，再加并行和超时。

## 代码地图

只改这三个文件：

- `mr/coordinator.go`：coordinator 的状态、RPC handler、`Done()`。
- `mr/worker.go`：worker 的主循环、map/reduce 的执行、RPC 调用。
- `mr/rpc.go`：RPC 参数和回复的结构体。

不要改 `main/mrcoordinator.go`、`main/mrworker.go`、`mr/mr_test.go`、`mrapps/`。`main/` 里的两个入口已经写好：coordinator 创建 `MakeCoordinator(sockname, files, nReduce)`，然后每秒调一次 `Done()`；worker 加载 `.so` 插件，调用 `Worker(sockname, mapf, reducef)`。

测试和你的代码在同一个 Go package 里，所以 `mr_test.go` 可以直接调用 `MakeCoordinator`。它启动 worker 的方式是 `exec.Command("../../main/mrworker", app, sock)`，工作目录是一个临时目录（`src/mr/mr-tmp-*`）。这一点很重要：worker 的当前目录不是 `src/`，测试传进来的输入路径是 `../../main/...`，所以不要把它当成 `src/` 下的路径。

## 数据从哪来，到哪去

一次作业的数据流是固定的：

```text
input files ──map──> mr-X-0 … mr-X-(nReduce-1) ──reduce──> mr-out-Y
```

- 第 X 个 map 任务读第 X 个输入文件，对每个 key/value 调用 `mapf(filename, content)`。
- 对每个输出的 key 算 `bucket := ihash(key) % nReduce`，把 `(key, value)` 追加到 `mr-X-bucket`。
- 第 Y 个 reduce 任务读所有 `mr-*-Y`，按 key 排序，把同一个 key 的 values 交给 `reducef`，把结果写到 `mr-out-Y`。
- `mr-out-Y` 每行一个结果，格式是 `%v %v\n`，也就是 `key value`。测试会把这个格式和顺序版比较。

这里有一个容易忽略的点：map 的输出不是直接给 reduce 的，而是先落成文件。这样 reduce 可以重复读、可以从头读，也可以在 worker 崩溃后由另一个 worker 重新生成。代价是多一次磁盘 I/O，但换来了简单。coordinator 只发任务，不搬数据；文件系统是 worker 之间共享数据的地方。不要试图把 map 的 key/value 直接塞进 RPC 发给 coordinator，数据量一大就走不动了。

格式只有一条硬性要求：`mr-out-Y` 的每一行是 `%v %v`。中间文件怎么存由你决定，JSON 只是建议；不要为了省事把最终输出也改成 JSON，测试会按行比较。

`ihash` 已经在 `worker.go` 里给你了；`nReduce` 由 `MakeCoordinator` 的参数传入：测试用 2、3 或 4（`mr_test.go` 里 `runMR` 的第三个参数），手动跑 `main/mrcoordinator.go` 时固定是 10。你的代码不能假设它是某个固定值，`TestWc` 和 `TestIndexer` 用的就不同。

中间文件建议用 JSON：

```go
enc := json.NewEncoder(file)
for _, kv := range kva {
    enc.Encode(&kv)
}
```

读的时候用 `json.NewDecoder(file).Decode(&kv)` 循环到 `io.EOF`。字段名必须大写，否则 `encoding/json` 和 `labgob` 都读不到。

coordinator 的任务表至少要有任务类型、编号、状态和开始时间：

```go
type TaskState int

const (
    Idle TaskState = iota
    Running
    Done
)

type Task struct {
    Kind      TaskKind   // Map 或 Reduce
    Index     int
    State     TaskState
    Start     time.Time  // 只在 idle -> running 时更新
}
```

任务表要挂在 `Coordinator` 上，不能放在 RPC handler 的局部变量里。`Report` 和超时扫描都用 `Kind + Index` 找到同一个任务；`Start` 是用来判断“这个任务是不是跑太久了”的，不是用来排序的。

worker 的主循环可以写成：

```go
for {
    reply := askForTask()
    switch reply.Kind {
    case MapTask:
        doMap(reply)
    case ReduceTask:
        doReduce(reply)
    case Wait:
        time.Sleep(100 * time.Millisecond)
    case Exit:
        return
    }
}
```

## 阶段 1：先让 TestWc 通过

目标：先不管并行，coordinator 一次只发一个任务，让 `TestWc` 通过。测试本身会启动 3 个 worker，所以“串行”指的是你的 coordinator 不把多个任务同时发出去。

1. 在 `rpc.go` 里定义 `AskArgs`、`AskReply`、`ReportArgs`、`ReportReply`。`AskReply` 至少要能表达：任务类型（map/reduce/wait/exit）、任务编号、输入文件、`nReduce`。
2. 在 `coordinator.go` 里把任务表建起来：每个 map 任务有 `idle/running/done` 三种状态，reduce 任务同理。
3. `Ask` handler：加锁，找一个 idle 的 map 任务，标成 running，返回给 worker；没有 map 可发但还有 map 在跑，返回 wait；map 全完成，发 reduce；reduce 全完成，返回 exit。
4. `Report` handler：加锁，把对应任务标成 done；如果所有 map 都 done，进入 reduce 阶段。
5. `Done()`：所有 reduce 都 done 才返回 true。
6. worker 主循环：`Ask` → 执行 → `Report` → 再 `Ask`。收到 exit 就返回。
7. map 执行：读文件，调用 `mapf`，按 `ihash` 分桶，写到临时文件，关闭，`os.Rename` 成 `mr-X-Y`。
8. reduce 执行：读所有 `mr-*-Y`，解码，按 key 排序，分组，调用 `reducef`，写到临时文件，关闭，`os.Rename` 成 `mr-out-Y`。

跑：

```bash
cd ~/labs/6.5840/src
make RUN="-run Wc" mr
```

预期：

```text
=== RUN   TestWc
--- PASS: TestWc (8.64s)
PASS
ok      6.5840/mr       8.7s
```

时间会因机器而异。如果卡住超过 30 秒，先看 coordinator 是不是一直在发 wait，或者 worker 是不是在等一个永远不会来的任务。

如果 coordinator 还是串行发任务，`TestMapParallel` 会失败；这是阶段 2 要解决的。先让 `TestWc` 稳定。

## 阶段 2：让多个 worker 并行

目标：`TestMapParallel` 和 `TestReduceParallel` 通过。

1. coordinator 必须能同时把多个 map 任务发给不同 worker。不要在 `Ask` handler 里等任务完成，也不要在持锁时做慢操作。
2. 任务表用 `sync.Mutex` 保护；`Ask` 和 `Report` 都只做很短的临界区。
3. worker 的执行时间可能很长，coordinator 不能因为一个 worker 在跑就阻塞其他 `Ask`。
4. reduce 任务也要能并行；第 Y 个 reduce 只读自己的分区，不读别的分区。

跑：

```bash
make RUN="-run MapParallel" mr
make RUN="-run ReduceParallel" mr
```

预期看到 `--- PASS`。如果 `TestMapParallel` 报 `saw 1 worker(s) instead of 2`，说明你的 coordinator 在串行发任务，或者 worker 启动后没有真正并行执行 map。

## 阶段 3：处理崩溃和超时

目标：`TestCrashWorker` 通过。

1. 每个 running 任务记一个开始时间。coordinator 起一个后台 goroutine，每隔一段时间扫描：超过 10 秒还没报告的任务，重新标成 idle，再发给别人。
2. `Report` 要幂等：如果任务已经 done，忽略晚到的报告；如果任务已经被重发，旧 worker 的报告不能覆盖新状态。
3. map 输出用临时文件 + `rename`，保证 reduce 不会读到半个文件。
4. worker 在 `call` 失败时退出：骨架里的 `call()` 在**拨号**失败时 `log.Fatal`，在**调用**失败时只打印日志并返回 false。所以 coordinator 退出后，worker 的下一次 `Ask` 会 `dial` 失败并当场退出；`connection refused` 是正常现象，不要把它当成 bug。

跑：

```bash
make RUN="-run Crash" mr
```

这个测试会反复杀 worker，通常要 40 秒左右。预期：

```text
=== RUN   TestCrashWorker
... *re*-starting map ...
--- PASS: TestCrashWorker (40.18s)
```

如果输出正确但测试超时，检查重发是不是太慢：10 秒是上限，不是固定等待；任务完成后要立刻推进，不要等下一轮扫描。

## 阶段 4：收尾

目标：`TestJobCount`、`TestEarlyExit` 和全量 `make mr` 通过。

- `TestJobCount`：没有崩溃时，每个 map 任务只能执行一次。不要因为“任务在跑”就重复发；只有超时或明确失败才重发。
- `TestEarlyExit`：所有进程必须在输出全部完成后才能退出。coordinator 的 `Done()` 只能在所有 reduce 都 done 后返回 true；worker 收到 exit 再退出。
- `TestWc` / `TestIndexer`：输出必须和顺序版一致。差异通常来自分区、排序或分组。

全量：

```bash
make mr
```

预期七个测试全绿，总耗时约 90 秒（`TestCrashWorker` 最慢）。官方示例：

```text
--- PASS: TestWc (8.64s)
--- PASS: TestIndexer (5.90s)
--- PASS: TestMapParallel (7.05s)
--- PASS: TestReduceParallel (8.05s)
--- PASS: TestJobCount (10.04s)
--- PASS: TestEarlyExit (6.05s)
--- PASS: TestCrashWorker (40.18s)
ok      6.5840/mr       86.932s
```

## 测试与判分

| 测试 | 启动几个 worker | 测什么 | 慢但正常？ |
|---|---|---|---|
| `TestWc` | 3 | word count 输出和顺序版一致 | 约 8–10 秒 |
| `TestIndexer` | 2 | 倒排索引输出正确 | 约 6 秒 |
| `TestMapParallel` | 2 | 至少 2 个 map 任务并行 | 约 7 秒 |
| `TestReduceParallel` | 2 | 至少 2 个 reduce 任务并行 | 约 8 秒 |
| `TestJobCount` | 4 | 没有崩溃时不重复发 map 任务 | 约 10 秒 |
| `TestEarlyExit` | 4 | 所有进程等输出完成后才退出 | 约 6 秒 |
| `TestCrashWorker` | 3 | worker 崩溃后重发，最终输出正确 | 约 40 秒 |

`TestCrashWorker` 会反复重启 worker，输出里出现多次 `*re*-starting map` 是正常的。其他测试不应该出现重发日志。

## 常见错误：现象、原因、处理

| 现象 | 原因 | 处理 |
|---|---|---|
| `make mr` 一直不返回 | `Done()` 永远 false；或 worker 一直在等任务 | 先临时把 `Done()` 改成 true，看测试报什么；再检查任务表有没有从 map 阶段切到 reduce |
| `reduce created no mr-out-X output files!` | reduce 没写文件，或文件名不是 `mr-out-Y` | 检查 reduce 的输出路径和 `Done()` 的时机 |
| `saw 1 worker(s) instead of 2` | coordinator 串行发任务，或在持锁时等任务完成 | `Ask` 只做分配，不做慢操作；锁的临界区要短 |
| `map jobs ran incorrect number of times` | 没有崩溃也重复发 map；任务状态没记 | 只对 running 超时的任务重发；done 的任务不再发 |
| 输出和顺序版不一致 | 分区函数、排序、分组有 bug | 用 `ihash(key) % nReduce`；reduce 内按 key 排序后再分组 |
| `call failed ... connection refused` | coordinator 已退出，worker 还在重试 | 正常现象；让 worker 在 `call` 失败后退出 |
| `labgob` 警告字段小写 | RPC 或日志结构体字段没大写 | 所有跨 RPC 的字段首字母大写 |
| `-race` 报竞态 | 任务表或输出文件没加锁 | 用 `sync.Mutex` 保护任务表；每个 worker 写自己的文件 |

## 调试手册

1. **只跑一个测试，把日志留下来。**

   ```bash
   cd ~/labs/6.5840/src
   make RUN="-run Wc" mr > /tmp/mr-wc.log 2>&1
   ```

   先看最后 30 行，确认是卡住、失败还是通过。

2. **在 coordinator 的 `Ask` 和 `Report` 里打印一行。**

   打印任务类型、编号、状态、worker、时间。正常的一次作业应该能看到 map 0–N 依次 running/done，然后 reduce 0–M。看不到 reduce，说明 map 阶段没结束；看到同一个任务被发给两个 worker，说明超时或状态有 bug。日志里带上时间，才能判断是任务先完成，还是扫描先触发。

3. **看临时目录。**

   测试在 `src/mr/mr-tmp-*` 下跑；从 `src` 看是 `mr/mr-tmp-*`。里面能看到 `mr-X-Y` 和 `mr-out-Y`。如果只有 map 文件没有 reduce 文件，问题在 reduce 阶段；如果连 map 文件都没有，问题在 worker 或 RPC。

4. **确认 worker 真的在跑。**

   `ps aux | grep mrworker` 看进程；如果一个都没有，coordinator 可能已经退出，或者 worker 启动就失败了。

5. **用 `-race` 跑。**

   MIT 的 Makefile 默认 `RACE=-race`，`make mr` 会自动带上。调试时可以临时 `RACE=` 关掉，但提交前要用默认值跑一遍。

## 提交前检查

- [ ] `make mr` 七个测试全绿；`TestCrashWorker` 连续跑 3 次没有偶发失败。
- [ ] 用默认 `-race` 跑过；没有 data race 或 goroutine 泄漏。
- [ ] 没有残留的 `mr-tmp-*`、临时文件和 worker 进程。
- [ ] 能不看代码讲清楚：`mr-X-Y` 的原子发布、重复报告幂等、`Done()` 的退出条件。
- [ ] 写了 300 字复盘：问题、设计、失败模式、测试结果（模板见[评分标准](grading.html#reflection)）。

## 自测问题

1. 为什么 map 输出要分成 `nReduce` 个文件？如果每个 reduce 读所有 map 输出，会多出哪些开销？
2. coordinator 怎么区分“worker 慢”和“worker 死了”？为什么只能靠超时？
3. `Report` 为什么必须幂等？构造一个晚到报告覆盖新状态的场景。
4. `Done()` 太早或太晚分别会发生什么？对应哪个测试？
5. 论文里 map worker 死了要重跑 map，实验里为什么不用？

### 答案要点

1. 每个 reduce 只读一个分区，map 输出只读一次；如果每个 reduce 读所有输出，读取量会变成 `nReduce` 倍，还要过滤不属于自己的 key。
2. 区分不了；coordinator 只能看“有没有在期限内报告”，所以只能用超时。
3. 任务超时后被重发，旧 worker 晚到的 done 报告如果直接覆盖状态，会把新 worker 的 running 误标成 done，导致任务丢失。
4. 太早会让 `TestEarlyExit` 失败；太晚会让 `make mr` 挂住。
5. 实验里 worker 共享文件系统，map 输出还在；论文里输出在 worker 本地磁盘，worker 死了文件就没了，所以要重跑。
