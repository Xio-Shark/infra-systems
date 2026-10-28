# 6.5840 Lab 1 中文精读：MapReduce

> 这是学习导读，不是官方翻译。英文原文是权威版本：
> https://pdos.csail.mit.edu/6.5840/labs/lab-mr.html
>
> 课程要求独立完成：不要看别人的代码，也不要把自己的代码公开到公开仓库。
> 这篇导读可以帮你理解任务，但代码要自己写。

## 0. 一句话

用 Go 写一个简化版 MapReduce：

- 一个 **coordinator**（协调者）把 map/reduce 任务分给多个 **worker**（工作进程）。
- worker 通过 RPC 领任务，读输入文件，调用插件里的 `Map` / `Reduce` 函数，写中间文件和最终输出。
- coordinator 要处理 worker 崩溃、卡住、太慢：超过 10 秒没完成就重发任务。

## 1. 环境与仓库

要求 Go 1.22 或更新版本。

```bash
cd ~/labs
git clone git://g.csail.mit.edu/6.5840-golabs-2026 6.5840
cd 6.5840/src
```

目录说明：

- `src/mr/`：你要改的包。
- `src/main/`：入口程序，**不要改**。
- `src/mrapps/`：示例应用（`wc`、`indexer`、`crash` 等）。
- `src/mr/mr_test.go`：测试，**不要改**。

先跑一遍顺序版，理解输入输出：

```bash
cd src/main
go build -buildmode=plugin ../mrapps/wc.go
go run mrsequential.go wc.so pg-*.txt
LC_COLLATE=C sort mr-out-0 | head
```

应该看到类似：

```text
A 509
ABOUT 2
ACT 8
...
```

`wc.so` 是编译好的 MapReduce 应用插件；`mrsequential.go` 是单进程顺序版，先 map 再 reduce，最后写 `mr-out-0`。

## 2. 代码结构

### `src/mr/coordinator.go`

- `Coordinator` 结构体：现在是空的，你要加状态。
- `Example`：示例 RPC handler，可以删掉或保留。
- `server(sockname)`：注册 RPC，监听 Unix domain socket，起 HTTP RPC server。
- `Done()`：`main/mrcoordinator.go` 每秒调用一次；整个 job 完成时返回 `true`。
- `MakeCoordinator(sockname, files, nReduce)`：初始化 coordinator，然后 `c.server(sockname)`。

### `src/mr/worker.go`

- `KeyValue`：map 输出的一条 key/value。
- `ihash(key)`：哈希函数；用 `ihash(key) % nReduce` 决定这条 KV 去哪个 reduce 分区。
- `Worker(sockname, mapf, reducef)`：worker 主循环，你要实现。
- `call(rpcname, args, reply)`：已经封装好的 RPC 调用。
- `CallExample()`：示例，可以删掉或保留。

### `src/mr/rpc.go`

- `ExampleArgs` / `ExampleReply`：示例。
- 你要在这里加自己的 RPC 参数和回复结构体。

### `src/main/mrcoordinator.go`

```go
m := mr.MakeCoordinator(os.Args[1], os.Args[2:], 10)
for m.Done() == false {
    time.Sleep(time.Second)
}
```

注意：**`nReduce` 固定是 10**。输入文件列表是 `os.Args[2:]`。

### `src/main/mrworker.go`

```go
mapf, reducef := loadPlugin(os.Args[1])
mr.Worker(os.Args[2], mapf, reducef)
```

worker 的插件路径是 `../../mrapps/wc.so` 这类；socket 名是 coordinator 传进来的。

## 3. 运行时模型

测试 `runMR` 会：

1. 在 `src/mr/mr-tmp-*` 里启动 1 个 coordinator。
2. 启动 N 个 worker，**worker 的当前目录是 `mr-tmp-*`**。
3. 输入文件路径是 `../../main/pg-*.txt`，相对 worker 的 cwd。
4. 测试把所有 `mr-out-*` 合并，和正确答案比较。

所以：

- 读输入：直接 `os.ReadFile(task.File)`，不要自己拼绝对路径。
- 写输出：直接写当前目录的 `mr-X-Y` / `mr-out-Y`，不要加 `../`。
- 中间文件、最终文件都在 `mr-tmp-*` 里，测试结束后会清理。

## 4. 建议的 RPC 协议

名字和字段可以自己定，只要 coordinator 和 worker 一致。一个最小设计：

```go
type TaskType int

const (
    MapTask TaskType = iota
    ReduceTask
    WaitTask
    DoneTask
)

type AskTaskArgs struct{}

type AskTaskReply struct {
    Type    TaskType
    TaskID  int
    File    string // map task 才有
    NReduce int
    NMap    int
}

type ReportTaskArgs struct {
    Type   TaskType
    TaskID int
}

type ReportTaskReply struct{}
```

- `AskTask`：worker 问“给我一个任务”。
- `ReportTask`：worker 说“这个任务完成了”。
- 字段首字母必须大写，否则 `net/rpc` 不会传。
- `rpc.go` 里加完后，在 coordinator 里实现两个方法：

```go
func (c *Coordinator) AskTask(args *AskTaskArgs, reply *AskTaskReply) error
func (c *Coordinator) ReportTask(args *ReportTaskArgs, reply *ReportTaskReply) error
```

## 5. Coordinator 状态机

建议字段：

```go
type TaskState struct {
    Status    int       // Idle / InProgress / Done
    StartTime time.Time
}

type Coordinator struct {
    mu      sync.Mutex
    files   []string
    nReduce int
    nMap    int

    phase       int // Map / Reduce / Done
    mapTasks    []TaskState
    reduceTasks []TaskState
}
```

### `MakeCoordinator`

- `nMap = len(files)`。
- 每个输入文件是一个 map task。
- 初始化 `mapTasks`、`reduceTasks`（长度 `nReduce`）。
- 最后调用 `c.server(sockname)`。

### `AskTask`

建议逻辑：

1. 加锁。
2. 如果 `phase == Map`：
   - 先找 `Idle` 的 map task。
   - 如果没有，找 `InProgress` 且 `time.Since(StartTime) > 10*time.Second` 的 task（超时重发）。
   - 找到就标记 `InProgress`、记录 `StartTime`，返回 `Type=MapTask`、`TaskID`、`File`、`NReduce`、`NMap`。
   - 如果所有 map task 都 `Done`，把 `phase` 切成 `Reduce`，继续走 reduce 逻辑。
   - 否则返回 `Type=WaitTask`。
3. 如果 `phase == Reduce`：
   - 同样的 Idle / 超时逻辑，返回 `Type=ReduceTask`、`TaskID`、`NMap`、`NReduce`。
   - 所有 reduce 都 `Done`，把 `phase` 切成 `Done`，返回 `Type=DoneTask`。
4. 解锁。

### `ReportTask`

1. 加锁。
2. 如果 `args.Type == MapTask`，把 `mapTasks[args.TaskID].Status` 标成 `Done`。
3. 如果 `args.Type == ReduceTask`，把 `reduceTasks[args.TaskID].Status` 标成 `Done`。
4. 解锁。

注意幂等：超时重发后，旧 worker 可能晚到；重复报告不要 panic，也不要让计数变成负数。最简单的做法是“无论当前状态，直接标 Done”。

### `Done`

```go
func (c *Coordinator) Done() bool {
    c.mu.Lock()
    defer c.mu.Unlock()
    return c.phase == Done
}
```

## 6. Worker 主循环

伪代码：

```text
for {
    reply := AskTask()

    switch reply.Type {
    case MapTask:
        读 reply.File
        kvs := mapf(reply.File, string(data))
        for _, kv := range kvs {
            r := ihash(kv.Key) % reply.NReduce
            把 kv 写到 mr-<reply.TaskID>-<r>
        }
        ReportTask(MapTask, reply.TaskID)

    case ReduceTask:
        var kvs []KeyValue
        for i := 0; i < reply.NMap; i++ {
            读 mr-<i>-<reply.TaskID>
            解码，追加到 kvs
        }
        按 Key 排序
        对每组相同 Key 的 values 调用 reducef(key, values)
        写 mr-out-<reply.TaskID>

        ReportTask(ReduceTask, reply.TaskID)

    case WaitTask:
        time.Sleep(100 * time.Millisecond)

    case DoneTask:
        return
    }
}
```

### Map 输出文件

- 文件名：`mr-<mapTaskID>-<reducePartition>`。
- 每条记录用 `encoding/json` 编码 `KeyValue`：

```go
enc := json.NewEncoder(file)
for _, kv := range kvs {
    enc.Encode(&kv)
}
```

- 读的时候用 `json.NewDecoder`，循环 `Decode` 直到 EOF。
- 用 `os.CreateTemp` 创建临时文件，写完 `Close`，再 `os.Rename` 成最终名字。这样 worker 崩溃不会留下写了一半的文件。

### Reduce 输入

- 第 `Y` 个 reduce task 读所有 `mr-*-Y` 文件。
- 一共 `NMap` 个 map task，所以是 `mr-0-Y`、`mr-1-Y`、…、`mr-(NMap-1)-Y`。
- 把所有 `KeyValue` 收集起来，按 `Key` 排序。
- 相同 key 的 value 放进一个 slice，调用 `reducef(key, values)`。
- 输出一行：`fmt.Fprintf(f, "%v %v\n", key, value)`。
- 同样用临时文件 + `os.Rename`。

### Worker 退出

- 收到 `DoneTask` 就 `return`。
- 如果 coordinator 先退出，`call()` 可能 `log.Fatal`；测试允许少量这种错误。如果觉得吵，可以把 `call()` 里 dial 失败改成返回 `false`，然后 worker 退出。

## 7. 原文的硬性规则

- map 阶段要把中间 key 分成 `nReduce` 个桶；每个 map task 产生 `nReduce` 个中间文件。
- 第 X 个 reduce task 的输出必须叫 `mr-out-X`。
- `mr-out-X` 每行一个 Reduce 输出，用 `%v %v` 格式（key, value）。
- 只改 `mr/worker.go`、`mr/coordinator.go`、`mr/rpc.go`；测试时其他文件保持原版。
- 中间文件放当前目录；reduce 从这里读。
- `Done()` 在整个 job 完成时返回 true；`mrcoordinator.go` 会轮询。
- 完成后 worker 应该退出。

## 8. 最重要的 hints

- 先让 `TestWc` 过，再管并行和崩溃。
- coordinator 是并发 RPC server，所有共享状态都要锁。
- worker 等待时用 `time.Sleep`，不要忙等。
- coordinator 分不清“崩溃”“卡住”“太慢”，只能 10 秒超时重发。
- 如果想做 backup task，只在 10 秒后才发；否则 `TestJobCount` 可能挂。
- `call()` 的 reply 结构体要先清零；RPC 只传首字母大写的字段。
- 用 `mrapps/crash.go` 测崩溃恢复；临时文件 + 原子 rename 防止产生写了一半的输出。
- 单测：`make RUN="-run Wc" mr`；全量：`make mr`。

## 9. 测试分别在测什么

| 测试 | 测什么 |
|---|---|
| `TestWc` | word count 输出正确 |
| `TestIndexer` | 倒排索引输出正确 |
| `TestMapParallel` | 至少 2 个 map worker 并行 |
| `TestReduceParallel` | 至少 2 个 reduce 并行 |
| `TestJobCount` | map 任务数量不能过多（别乱发重复任务） |
| `TestEarlyExit` | 所有 reduce 完成后 coordinator 及时退出 |
| `TestCrashWorker` | worker 崩溃后，10 秒超时重发，最终结果正确 |

运行方式：

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

注意：现在直接 `make mr` 会挂住，因为 `Done()` 永远返回 false，这是预期的。想先看失败，可以把 `Done()` 的 `ret` 临时改成 `true`，跑一次看到 `reduce created no mr-out-X output files!`，再改回来。

## 10. 常见坑

- **路径**：worker cwd 是 `mr-tmp-*`，输入是 `../../main/...`；输出不要加 `../`。
- **格式**：reduce 输出必须是 `key value\n`，不是 JSON。
- **重复报告**：超时重发后旧 worker 可能晚到；报告要幂等。
- **死锁**：不要在持锁时发 RPC、读文件、`time.Sleep`。
- **忙等**：`for {}` 会拖慢测试；用 `time.Sleep(100ms)` 或 `sync.Cond`。
- **`Done()` 太早**：所有 reduce 完成前不要返回 true，否则 `TestWc` / `TestEarlyExit` 会失败。
- **`Done()` 太晚**：所有 reduce 完成后要尽快返回 true；`mrcoordinator` 每秒查一次。
- **`make mr` 挂住**：正常，`Done()` 还是 false；先跑单个测试。

## 11. 术语表

| 英文 | 中文 | 说明 |
|---|---|---|
| coordinator | 协调者 | 原论文叫 master |
| worker | 工作进程 | 实际执行 map/reduce |
| map task | map 任务 | 一个输入文件一个 |
| reduce task | reduce 任务 | 一个输出分区一个 |
| intermediate file | 中间文件 | `mr-X-Y` |
| partition | 分区 | `ihash(key) % nReduce` |
| RPC | 远程过程调用 | worker 和 coordinator 通信 |
| Unix domain socket | Unix 域套接字 | 本机进程间通信 |
| atomic rename | 原子重命名 | 保证文件完整 |
| straggler | 慢节点 | 拖慢整个 job 的 worker |
| backup task | 备用任务 | 给慢任务再发一份 |
| crash recovery | 崩溃恢复 | worker 挂了怎么办 |

## 12. 第一周动作

- **Day 1**：读英文 lab + 这份导读；跑顺序版；画出 coordinator/worker 的时序图。
- **Day 2**：定义 RPC；coordinator 的 `AskTask` 先返回 `WaitTask`；worker 循环。
- **Day 3**：map 路径跑通；看 `mr-tmp-*/mr-*`。
- **Day 4**：reduce 路径；`TestWc` 过。
- **Day 5–7**：并行、超时、崩溃；`make mr` 全绿。

## 13. 中文资源

- Raft 论文中文翻译：https://github.com/maemual/raft-zh_cn
- Go 中文教程：https://tour.go-zh.org/
- 课程页面可以用 Chrome/Edge 右键“翻译成中文”，但术语会翻错，建议对照这份导读。
- 搜“6.5840 lab1 中文”能找到很多博客；只看概念和调试思路，不要看别人的代码。
