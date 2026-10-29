# 学习路径与难度

> 这不是必须按周执行的课表，而是一张“先做什么、做到哪算过关”的地图。每门课的讲义和实验页都有独立入口；本页只负责顺序、难度和最小路径。

## 难度标记

- **★** 入门：照着步骤能跑通，主要熟悉工具。
- **★★** 需要指导：有几个边界要自己想清楚，但调试路径明确。
- **★★★** 需要独立设计：接口、状态机和失败恢复要自己定。
- **★★★★** 需要反复调试：并发、崩溃、网络分区，测试会暴露你没想过的顺序。
- **★★★★★** capstone：没有唯一答案，要自己划范围、做取舍、写报告。

时间估计按“有 Go/Linux 基础、每周 8–10 小时”算。第一次做内核实验，取上限。

## 第 0 周：先修（1–2 周，可跳过）

如果已经会这些，直接进入第 1 段。

**Go 最小清单**

- `go run`、`go build`、`go test`、`go mod`；能读懂 `go.mod`。
- goroutine、channel、`sync.Mutex`、`context`、`time.Sleep`；能写一个带超时和重试的并发程序。
- `net/rpc` 或任意 RPC 样例；知道结构体字段为什么要大写。
- 会用 `go test -run`、`-count`、`-race`。

练习：写一个 worker pool，3 个 worker 消费 10 个任务；主程序在 2 秒后取消，所有 worker 都能退出。再写一个带版本号的 KV，重复提交同一个版本不会写两次。

**Linux 最小清单**

- 进程、文件描述符、信号、`fork/exec`、`wait`。
- `mount`、`/proc`、`namespace`、cgroup v2 的基本查看命令。
- 会用 `strace`、`ps`、`lsns`、`nsenter`、`ip netns`。

练习：用 `unshare` 起一个 PID/mount namespace，挂 `/proc`，确认 `ps` 只看到自己；用 cgroup v2 给一个 `sleep` 进程设 `memory.max`。

**工具**

- Git：commit、branch、diff、log；知道怎么把实验代码放在私有仓库。
- 调试：日志、单测、最小复现；不要一上来就单步。

## 第 1 段：单机与 RPC（2–3 周）

| 顺序 | 内容 | 难度 | 时间 |
|---|---|---|---|
| 1 | [第 1 讲 MapReduce](lectures.html#lec1) + [Lab 1](lab1.html) | ★★ | 8–12 小时 |
| 2 | [第 2 讲 RPC 与线程](lectures.html#lec2) | ★★ | 2–3 小时 |
| 3 | [第 8 讲 线性一致](lectures.html#lec8) + [Lab 2](lab2.html) | ★★ | 6–10 小时 |

过关标志：Lab 1 的 `make mr` 全绿；Lab 2 的 `make kvsrv1` 和 `make lock1` 全绿；能解释 `ErrVersion` 和 `ErrMaybe` 的区别。

Lab 2 只用到第 8 讲的线性一致定义，可以提前读；不需要先完成 Lab 3。

## 第 2 段：复制与共识（5–7 周）

| 顺序 | 内容 | 难度 | 时间 |
|---|---|---|---|
| 1 | [第 6 讲 Raft (1)](lectures.html#lec6)、[第 7 讲 Raft (2)](lectures.html#lec7) | ★★★ | 4–6 小时 |
| 2 | [Lab 3 Raft](lab3.html) 3A → 3B → 3C → 3D | ★★★★ | 30–40 小时 |
| 3 | [第 10 讲 Lab 3 Q&A](lectures.html#lec10) | ★★★ | 1–2 小时 |
| 4 | [Lab 4 RSM/KV](lab4.html) 4A → 4B → 4C | ★★★ | 8–12 小时 |

过关标志：Lab 3 的 3A–3D 全绿，`-race` 连续跑 3 次没有偶发失败；Lab 4 的 `make rsm1` 和 `make kvraft1` 全绿。**Lab 3D 没做完不要开 Lab 4**，否则 4C 会卡在 follower 追日志。

## 第 3 段：分片与系统案例（2–3 周）

| 顺序 | 内容 | 难度 | 时间 |
|---|---|---|---|
| 1 | [第 11–13 讲](lectures.html#lec11) 事务、Spanner、Chain Replication | ★★★ | 3–4 小时 |
| 2 | [Lab 5 Sharded KV](lab5.html) 5A → 5B → 5C（先完成 Lab 4C） | ★★★★ | 10–15 小时 |
| 3 | 第 14–22 讲（导览） | ★★ | 6–8 小时 |

过关标志：Lab 5 的 `make shardkv` 全绿；能画出一个 shard 从旧 group 搬到新 group 的顺序，并说明 controller 崩溃后怎么继续。

第 14–22 讲是案例和边界，不必逐篇精读；每讲读完能回答“它解决什么问题、代价是什么”即可。

## 第 4 段：容器与多容器（3–4 周）

| 顺序 | 内容 | 难度 | 时间 |
|---|---|---|---|
| 1 | [CN1 容器](cn1.html) | ★★ | 6–10 小时 |
| 2 | [CN2 Pod 生命周期](cn2.html) | ★★★ | 8–12 小时 |
| 3 | [CN3 CNI/Service](cn3.html) | ★★★★ | 10–14 小时 |
| 4 | [CN4 工作区事务](cn4.html) | ★★★ | 8–12 小时 |
| 5 | [CN5 Capstone](cn5.html) + [报告模板](cn5-report.html) | ★★★★★ | 15–25 小时 |

过关标志：CN1 的 judge 检查全过（没有 `lsns` 时允许一项 SKIP），OOM 手工确认；CN2 能演示 init 未完成时 app 不启动；CN3 能通过 Service VIP 访问两个后端；CN4 能在 commit 中 `kill -9` 后恢复；CN5 至少做三类混沌测试并写报告。

CN4 的难度比 CN3 低一点，是故意的：在 capstone 前把“工作区原子性”单独做熟，再组合。

## 第 5 段：Agent OS（4–6 周）

| 顺序 | 内容 | 难度 | 时间 |
|---|---|---|---|
| 1 | [AOS1 Typed ABI](aos1.html) | ★★★★ | 12–20 小时 |
| 2 | [AOS2 工作区事务](aos2.html) | ★★★ | 10–16 小时 |
| 3 | [AOS3 Capability](aos3.html) | ★★★★ | 12–20 小时 |
| 4 | [AOS4 快照](aos4.html) | ★★★ | 8–14 小时 |
| 5 | [AOS5 Lease/Audit](aos5.html) | ★★★★ | 10–16 小时 |
| 6 | [Capstone](aos-capstone.html) | ★★★★★ | 20–30 小时 |

过关标志：AOS1 能演示参数校验、权限拒绝、重复调用和失败证据；AOS2 能在 commit 中崩溃后恢复；AOS3 的逃逸测试全部失败；AOS4 能说清哪些状态没进快照；AOS5 能拒绝旧 owner 的写并重放审计；capstone 能现场回答“哪个假设先失效”。

## 最小路径（时间不够时）

如果每周只能投入 8–10 小时，按下面的顺序砍：

1. **只想学分布式**：Lab 1 → Lab 2 → Lab 3 → Lab 4；Lab 5 和案例讲选做。做 Lab 5 之前，把 Lab 4C 补上。
2. **只想学容器**：CN1 → CN2 → CN3；CN4/CN5 选做。
3. **想做 Agent OS**：AOS1 → AOS2 → AOS5；AOS3/AOS4 至少各做一半；capstone 选做。

不要跳的顺序：

- Lab 3 之前先做 Lab 1/2；Lab 4/5 之前先做 Lab 3。
- CN2/CN3 之前先做 CN1；CN5 之前至少做完 CN1–CN3。
- AOS2/3 之前先做 AOS1；capstone 之前至少做完 AOS1–AOS5 中的三个。

## 时间安排

- **稳扎稳打**：24–30 周，每周 8–10 小时；Raft 和 capstone 阶段可以到 12 小时。
- **冲刺**：14–18 周，每周 15–20 小时；不建议同时开两个硬实验。
- **只做最小路径**：12–16 周；把省下的时间用来写复盘和读论文。

每个实验页顶部都有“难度 / 先修 / 时间 / 最小通过”一行；以那一行为准，本页只给全局顺序。
