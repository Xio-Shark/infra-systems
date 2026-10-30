# CN5 · Capstone 迷你多容器平台

> **课程**：[INFRA 02 · 云原生系统](cloud-native.html) · **实验 5/5**
>
> **先读**：[第 12 讲](cloud-native.html#cn12)、[第 13 讲](cloud-native.html#cn13)、[第 14 讲](cloud-native.html#cn14) · **验收**：人工验收 + 10 分钟 demo
>
> [返回作业](labs.html) · [上一个：CN4](cn4.html)
>
> **难度** ★★★★★ · **先修** CN1–CN4 · **时间** 15–25 小时 · **最小通过** 3 个容器 + 2 类混沌测试；**完整通过** 平台 + 3 类混沌 + 故障报告

## 你将完成什么

把 CN1 到 CN4 拼成一个单节点平台：读一份 Pod 风格的 spec，建共享 netns，按顺序跑 init，启动 app 和 sidecar，挂共享工作区，设 cgroup 限制，暴露日志和指标，还能注入五类故障。交付物是一个 `mp` 二进制、一份故障报告、一次 10 分钟 demo。

跑起来长这样：

```bash
cd ~/labs/cn5
sudo ./mp apply -f pods/agent.yaml
./mp get pods
```

预期：

```text
NAME    PHASE     READY   RESTARTS   AGE
agent   Running   2/2     0          12s
```

`./mp logs agent app --tail 5` 能看到 app 的输出，`./mp top` 能看到每个容器的 CPU 和内存。验收看四件事：能不能起来、坏了能不能恢复、能不能解释为什么、权限有没有限制住。

## 开始之前

先读第 12、13、14 讲，并把 CN1 到 CN4 各跑通一次。这个 capstone 不引入新原语，难点在组合：CN2 的 pause 进程要活到最后一个容器退出，CN3 的 netns 要跟着 pause 走，CN4 的工作区要在 Pod 删除后还能回滚。

环境检查：

```bash
uname -r
stat -fc %T /sys/fs/cgroup   # cgroup2fs
ip -V                        # iproute2
sudo ./mp doctor             # 自检 overlay、veth、DNAT、pidfd
```

时间预算 15–25 小时。目录建议：

```text
mp/
  cmd/mp/
  internal/spec/      解析和校验 spec
  internal/runtime/   namespace、rootfs、cgroup、进程
  internal/net/       veth、bridge、NAT、VIP
  internal/volume/    CN4 的工作区
  internal/control/   reconcile、状态机、重启策略
  internal/obs/       指标、日志、p99
  internal/chaos/     故障注入
  pods/agent.yaml
  state/pods/<name>/
```

范围要主动缩小：单节点、不做调度、不拉镜像，rootfs 用本地目录。把省下的时间放在故障注入和报告上。

## 组件表：五块，各管一件事

| 组件 | 最小职责 | 来自 | 坏了的典型现象 |
|---|---|---|---|
| runtime | clone 命名空间、pivot_root、cgroup v2、exec、回收孤儿 | CN1、CN2 | Pod 卡在 Pending，或留下一堆僵尸进程 |
| network | pause 持有 netns，veth 接 bridge，NAT 出网，DNAT 做 VIP | CN3 | 容器没有出网，或 VIP 打到没人监听的端口 |
| volume | 版本化工作区，commit/rollback，单写者 | CN4 | 读者看到半个文件，回滚回不到干净基线 |
| control plane | 解析 spec、维护状态机、reconcile、重启策略 | 本实验新增 | 控制器重启后重复建 Pod，或该重启的没重启 |
| observability | cgroup 指标、结构化日志、p99 直方图 | 本实验新增 | 出事时说不清是 CPU、内存还是网络 |

控制面是新增部分里最容易做错的。它负责把观测到的状态推向期望状态，不负责按顺序发命令。

## 接口与状态机

spec 只保留必要字段：

```yaml
name: agent
restartPolicy: Always
volumes:
  - name: work
containers:
  - name: init
    role: init
    rootfs: /srv/rootfs/busybox
    command: ["/bin/sh", "-c", "mkdir -p /work && echo ok > /work/ready"]
    volumeMounts: [{name: work, mountPath: /work}]
  - name: app
    role: app
    rootfs: /srv/rootfs/agent
    command: ["/usr/local/bin/agent", "--listen", ":8080"]
    resources: {cpuMax: "50000 100000", memoryMax: "128M", pidsMax: 64}
    volumeMounts: [{name: work, mountPath: "/work"}]
    ports: [{name: http, containerPort: 8080}]
  - name: sidecar
    role: sidecar
    rootfs: /srv/rootfs/proxy
    command: ["/usr/local/bin/proxy", "--listen", "127.0.0.1:15001"]
    resources: {memoryMax: "64M"}
    volumeMounts: [{name: work, mountPath: "/work"}]
```

Pod 的状态机：

```text
Pending --netns/volume 就绪--> Initializing --init 全部退出 0--> Running
Running --delete 或重启策略触发--> Terminating --SIGTERM 超时--> SIGKILL
Initializing --init 非 0--> Failed
```

`state/pods/<name>/status.json` 至少记录 `generation`（每次 spec 变更加一）、`phase`、每个容器的 `pid`、`startTimeTicks`、`restartCount`、`lastExitCode`。`startTimeTicks` 取自 `/proc/<pid>/stat` 的第 22 个字段，用来防 PID 复用：控制器重启后按 pid 加启动时间认领旧容器，认不到就清理重建。

reconcile 每轮做一件事：

```text
observed = 读 status.json + pidfd 探活 + 读 cgroup
step     = nextStep(desired, observed)
if step != nil { execute(step); record(step) }
```

每个 step 必须幂等：建 netns 前先看名字在不在，建 cgroup 前先看目录在不在，启动容器前先看 pid 还活着没有。控制器被 `kill -9` 后重启，第一轮 reconcile 不能多建一个 Pod，也不能把正在跑的容器当成死的。

## 阶段拆解

**阶段 1：一个 Pod 在前台跑起来。** 先写 `mp run -f pods/agent.yaml`，不开控制面。建 pause 进程持有 netns，跑 init，等它退出 0，再并行起 app 和 sidecar。`mp run` 退出时按 app、sidecar 的顺序发 `SIGTERM`，超时 10 秒再 `SIGKILL`。通过标志：init 没结束时 app 不启动；Ctrl-C 之后 `ps` 里没有僵尸，`ip netns list` 里没有残留。

**阶段 2：网络和卷接进来。** 给 Pod 建 veth，一头在 netns，一头接 bridge，配 NAT 让容器能 `curl` 外网；再起两个后端，用 DNAT 做一个 VIP。工作区用 CN4 的版本目录，app 写、sidecar 读，提交后读者看到新版本。通过标志：`nsenter -t <pause> -n curl -sS https://example.com` 有响应；VIP 轮询到两个后端；commit 后 sidecar 读到新内容，rollback 后读到旧内容。

**阶段 3：把控制面加上。** `mp apply` 落 spec 和 status，后台 reconcile；`mp get` 读状态；`mp delete` 走 Terminating。加 `restartPolicy: Always`：app 退出就重建容器，不重建 Pod，netns 和卷保持不变。通过标志：`kill -9` app 后 5 秒内 `RESTARTS` 加 1，Pod 仍是 Running；`kill -9` 控制器后重启，`mp get` 里没有多出 Pod，原来的容器还在。

**阶段 4：观测。** 暴露 `/metrics`，至少给每个容器 CPU 使用、`cpu.stat` 的 throttled 次数、`memory.current`、`memory.events` 的 `oom_kill`、重启次数；日志按容器分文件并带 `pod`、`container` 标签；用直方图算 p99。用 `tc netem` 给 VIP 加 100 ms 延迟，`mp top` 要能看出 p99 变了而平均值变化不大。通过标志：注入延迟前后各取一次 p99，差值接近 100 ms；OOM 后 `oom_kill` 计数增加。

**阶段 5：混沌和报告。** 从矩阵里选至少三类，逐项注入，每项至少 3 次，记录现象、时间线、恢复路径。

## 故障报告写什么

报告固定六段：

1. 现象：第一手信号和错误码。
2. 影响：波及范围、时长和数据损失。
3. 时间线：按时间排序，标出注入起止。
4. 根因：触发条件、潜在缺陷和防线缺失。
5. 修复：止血和根治分开，各写验证。
6. 防再发：测试、告警或设计改动。

模板和填好的例子见[故障报告页](cn5-report.html)。

## 混沌测试矩阵

| 故障 | 怎么注入 | 预期看到什么 | 记录什么 |
|---|---|---|---|
| 进程崩溃 | `kill -9` app、sidecar、pause、控制器，各一次 | app 崩由重启策略恢复；sidecar 崩则出网断；pause 崩则沙箱失效，整个 Pod 重建；控制器崩，在跑的 Pod 不受影响（除非设了 PDEATHSIG） | 退出码、重启次数、恢复耗时、有没有重复 Pod |
| 网络分区 | 在 pod netns 或 bridge 上 `iptables -A OUTPUT -j DROP`，或 `tc qdisc add dev veth0 root netem loss 100%` | 请求超时，健康检查失败，重试放大流量；分区恢复后连接能重建 | 超时分布、重试次数、conntrack 条目、VIP 是否黑洞 |
| 磁盘满 | 工作区放在小 loop 设备或小 tmpfs 上，`dd` 填满 | 写入返回 `ENOSPC`；commit 失败后旧版本仍可读；状态文件写失败会让控制器卡住 | `df`、失败的系统调用、commit 退出码、旧版本是否完好 |
| OOM | `memory.max=64M`，容器里跑 `stress-ng --vm 1 --vm-bytes 128M` | 容器被内核杀死，退出码 137，`memory.events` 的 `oom_kill` 加 1，按策略重启 | cgroup 计数、dmesg、重启次数、sidecar 是否被连带影响 |
| 时钟跳变 | 在 VM 里 `date -s` 前后跳 10 分钟；或在支持的内核上用 time namespace | 超时、心跳和指标时间戳异常；Go 的单调时钟不受影响，墙钟会跳 | 跳变前后的时间戳、超时是否误触发、日志顺序是否乱 |

时钟这一项最容易做假。`date -s` 需要 `CAP_SYS_TIME`，容器里通常没有；time namespace 需要内核支持和 `CLONE_NEWTIME`，你的环境不一定有，以实际行为为准。做不了就在报告里写清“未验证”，不要编一个结果。

## 验收清单

- [ ] `mp apply`、`get`、`logs`、`top`、`delete`、`chaos` 六个子命令可用。
- [ ] init 失败时 Pod 进入 Failed，app 不启动。
- [ ] app 和 sidecar 共享 netns 与卷，`localhost` 互通。
- [ ] 删除 Pod 后没有残留进程、netns、veth、cgroup 目录。
- [ ] 控制器 `kill -9` 三次，重启后不重复建 Pod。
- [ ] 混沌至少覆盖三类，每类 3 次；做满五类更好，做不了的写明原因。
- [ ] 指标覆盖每个容器，日志带 pod 和 container 标签。
- [ ] 非 root 运行，drop capabilities，rootfs 只读，默认 seccomp。CN1–CN4 的代码是 root + 可写 rootfs，这一步要自己改：`setuid` 后 exec、`--read-only` 的 rootfs 用 tmpfs 挂可写目录、`prctl(PR_SET_NO_NEW_PRIVS)` + seccomp 默认拒绝；讲义第 10 讲给了原则，具体改法按你的实现定。做不到就在报告里写清哪一项没做、为什么。
- [ ] 10 分钟 demo 能现场回答：sidecar 挂了会怎样、节点断电会怎样、两个 Pod 抢同一个卷会怎样。
- [ ] 故障报告六段齐全，附日志、指标和时间线。

## 常见错误

| 现象 | 原因 | 处理 |
|---|---|---|
| pause 退出后 Pod 网络失效 | pause 是 netns 锚点，平台按沙箱失效重建 Pod，CNI 清理 veth | pause 活到最后一个容器退出，用 pidfd 监控 |
| `mp delete` 后还有僵尸 | 容器不是当前进程的子进程，或没设 subreaper | `prctl(PR_SET_CHILD_SUBREAPER)`，统一 `waitpid` |
| cgroup 写入报 `EROFS` 或目录不存在 | 父 cgroup 没开 `+cpu +memory` 控制器，或父层还有进程 | 在父层写 `cgroup.subtree_control`，先移走进程 |
| `memory.max` 设了但没生效 | 写到了错误的 cgroup，进程没加进去 | 查 `/proc/<pid>/cgroup`，再写 `cgroup.procs` |
| 控制器重启后出现两个同名 Pod | 状态文件没 fsync，或没按 pid 加启动时间认领 | 先落盘再返回；认领失败先清理再重建 |
| reconcile 重复建 netns | step 不幂等，失败后直接重试 | 每个 step 先查存在性，再执行 |
| sidecar 重启后 VIP 全黑洞 | conntrack 还指向旧端口，或 DNAT 规则没重装 | sidecar 启动时重装规则；必要时清 conntrack |
| 磁盘满后控制器卡死 | status 写失败被当成致命错误，或无限重试 | 状态写入失败要退避并暴露指标 |
| 日志交错 | 所有容器写同一个 fd | 每容器一个文件，行首带标签 |
| p99 看不出问题 | 只存了平均值 | 用直方图，至少保留 p50、p95、p99 |

## 调试手册

先看状态文件，再看进程，最后看内核。`cat state/pods/agent/status.json` 里 phase、pid、generation 对不上，问题在控制面；pid 活着但 `mp get` 显示 Pending，问题在状态写回。`nsenter -t <pause-pid> -n ip addr` 看网络，`cat /sys/fs/cgroup/<pod>/memory.events` 看 OOM，`conntrack -L | grep <vip>` 看 VIP 的连接落在哪。`tc -s qdisc show dev veth0` 能看到注入的延迟和丢包有没有真的生效。

只跑一个故障，一次只改一个变量。混沌测试最常见的假象是“恢复了”，其实是重启把证据清掉了。先把日志和指标落到 Pod 目录之外，再注入。

崩溃类问题用 `dmesg -T | tail -40` 对时间；控制器问题用 `status.json` 的 generation 和日志里的 step 名对时间。两边时间对不上，先查时钟，再查日志缓冲。

## 提交前检查

- [ ] 五个阶段都能单独演示，不依赖上一步的残留状态。
- [ ] 混沌至少三类各 3 次，结果写进报告；未验证的项标出来。
- [ ] 删除 Pod 后系统干净：`ps`、`ip netns`、`ip link`、cgroup 目录都查过。
- [ ] 权限限制真的生效：容器内 `id` 不是 0，`capsh --print` 里没有多余 capability。
- [ ] 报告有现象、影响、时间线、根因、修复、防再发六段，每条结论有日志或指标支撑。
- [ ] demo 能不看稿回答三个问题，并能指出一个已知未解决的问题。

## 自测问题

1. 为什么 pause 容器必须活到最后一个业务容器退出？
2. reconcile 为什么必须幂等？举一个控制器重启后重复建 Pod 的场景。
3. sidecar 挂了，app 还能出网吗？你的平台怎么发现这件事？
4. 节点断电后，哪些状态能恢复，哪些不能？
5. OOM 和进程自己退出 137 怎么区分？
6. 两个 Pod 要挂同一个工作区，你的平台应该拒绝、排队，还是允许？

### 答案要点

1. pause 是 netns 的锚点，新容器靠它加入。pause 一退，平台无法再往这个 Pod 加容器，CNI 也会清理 veth，所以整个 Pod 要重建；旧容器可能短暂持有旧 netns，但不能再当可用 Pod。
2. reconcile 会被重复调用，控制器也可能在任意一步崩溃。比如建完 netns、还没写 status 就崩了，重启后如果不先查 netns 是否存在，就会再建一个，旧容器变成孤儿。
3. 出网流量被 iptables 重定向到 sidecar 端口，sidecar 死了就连接拒绝，app 自己不知道。平台要让 sidecar 健康参与 Ready 判定，或让探针真的走一次代理。
4. 能恢复的是卷上的已提交版本和 spec；不能恢复的是进程、netns、cgroup 和内存状态。重启后要按 spec 重建，工作区按版本目录恢复。
5. 看 cgroup 的 `memory.events` 里 `oom_kill` 有没有增加，再看 `dmesg` 有没有 OOM 记录。只看退出码 137 分不清是被杀还是自己 `exit(137)`。
6. 单写者语义下应该拒绝第二个写挂载，或者排队等锁。允许两个写者同时挂，等于把冲突留给文件系统，CN4 的提交检查会失败。
