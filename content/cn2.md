# CN2 · 迷你 Pod 生命周期

> **课程**：[INFRA 02 · 云原生系统](cloud-native.html) · **实验 2/5**
>
> **先读**：[第 4 讲](cloud-native.html#cn4)、[第 5 讲](cloud-native.html#cn5) · **接口**：[contracts/infra02.md](https://github.com/Xio-Shark/infra-systems/blob/main/judge/contracts/infra02.md)（CN2–CN5 未冻结）
>
> **验收**：人工清单（见“验收与测试”）；judge 接口未冻结
>
> [上一个：CN1](cn1.html) · [返回作业](labs.html) · [下一个：CN3](cn3.html)
>
> **难度** ★★★ · **先修** CN1 + 第 4、5 讲 · **时间** 8–12 小时 · **最小通过** pause/netns + init/app 顺序；**完整通过** sidecar、信号、subreaper

## 你将完成什么

你要写一个 `minipod`，读一份 Pod 风格的 spec：先起 pause 进程持有网络命名空间，再按顺序跑 init，最后并行启动 app 和 sidecar。删除时先给 app 发 `SIGTERM`，过了优雅期再 `SIGKILL`，然后处理 sidecar，最后关 pause。验收不靠自动脚本，而是一组可观察行为：

```bash
sudo ./minipod run --spec testdata/pod.json
sudo ./minipod delete demo
```

预期日志依次出现 `pause pid=<pid>`、`init exit=0`、`app start`、`sidecar start`；init 没完成时 app 不启动。用 `nsenter` 进去看，三个容器的 `/proc/<pid>/ns/net` 指向同一个 inode，app 和 sidecar 能通过 `127.0.0.1` 互访，共享卷能看到对方写的文件，`ps` 里没有僵尸。

接口由你自己定，judge 还没有冻结 CN2 的契约。本页给一套最小 spec 和 CLI，但要保留四个行为：pause 持有 netns、init 顺序执行、app 与 sidecar 共享网络和卷、删除时按顺序发信号并回收进程。

## 开始之前

先读[第 4 讲](cloud-native.html#cn4)和[第 5 讲](cloud-native.html#cn5)。第 4 讲解释 Pod 为什么是最小调度单位，init、app、sidecar 各解决什么问题；第 5 讲解释 PID 1 的信号语义、优雅退出和僵尸进程。

环境检查，需要 root：

```bash
unshare --net --uts --ipc --fork sleep 1 && echo ns-ok   # 预期 ns-ok
lsns -t net -o NS,PID,COMMAND | head                     # 能看到 net namespace
cat /proc/sys/kernel/pid_max                             # 预期 4194304 左右
id -u                                                    # 预期 0
```

`unshare` 失败时，先确认你在 Linux VM 或 WSL2 里，再确认 user namespace 没有被发行版限制。`minipod` 要建 netns、做 bind mount、写 cgroup，普通用户没有这些权限。

目录布局建议如下。rootfs 复用 CN1 的 busybox，补 `sleep`、`nc`、`wget` 的 symlink。

```text
~/labs/cn2/
  go.mod
  cmd/minipod/main.go
  internal/pod/spec.go      # Spec、Container、JSON 解析
  internal/pod/run.go       # pause、init、app/sidecar 的启动顺序
  internal/pod/child.go     # setns、mount、pivot_root、信号转发
  internal/pod/state.go     # /run/minipod/<id>/ 下的状态和日志
  testdata/pod.json
  minipod
```

时间预算 8–12 小时。先跑通 pause 和 netns，再加 init 顺序，最后做删除和信号。

## 代码地图

四个包各自只做一件事：

- `spec.go`：定义 `Spec` 和 `Container`，解析 JSON，补默认值（`gracePeriodSeconds` 默认 10，容器名不能重复）。
- `run.go`：创建状态目录，启动 pause，按顺序等 init，并行启动 app 和 sidecar，记录 PID 和退出码。
- `child.go`：每个容器的 stage-2 helper。它在新的 PID/mount namespace 里，`setns` 加入 Pod 的 net/UTS/IPC，bind 共享卷，`pivot_root`，fork 真正的命令并转发信号。
- `state.go`：维护 `state.json`、`pause.pid`、`pids/`、`vol/`、`logs/<name>.log`，删除和调试都靠这些文件。

可执行文件放在 `~/labs/cn2/minipod`。每个容器共用只读 rootfs，`/tmp` 挂 tmpfs，其他写入只走共享卷；不要复制 rootfs，否则会混淆“共享卷”和“独立 rootfs”。

## 接口与数据流

最小 CLI 只有三个子命令：

```text
minipod run --spec FILE
minipod delete ID
minipod status ID
```

spec 只保留实验需要的东西。容器命令用 exec 形式（数组），不要用 shell 字符串，否则 PID 1 会变成 shell，信号转发要多绕一层。

```go
type Spec struct {
    ID                 string      `json:"id"`
    GracePeriodSeconds int         `json:"gracePeriodSeconds"`
    Init               []Container `json:"init"`
    Containers         []Container `json:"containers"`
    Sidecars           []Container `json:"sidecars"`
}

type Container struct {
    Name string   `json:"name"`
    Cmd  []string `json:"cmd"`
    Env  []string `json:"env"`
}
```

启动和删除的控制流如下：

```text
minipod run --spec pod.json
  ├─ mkdir /run/minipod/<id>/{vol,logs}
  ├─ pause：unshare(NET|UTS|IPC)，sethostname，lo up，sleep
  ├─ init[0]：clone(PID|NS) + setns(NET|UTS|IPC) → wait → exit 0?
  ├─ init[1]：同上 → wait → exit 0?
  ├─ app     ─┐ 并行启动
  └─ sidecar ─┘
minipod delete <id>
  ├─ SIGTERM app     → 等 grace → SIGKILL
  ├─ SIGTERM sidecar → 等 grace → SIGKILL
  ├─ 关 pause（最后）
  └─ 删 cgroup、vol、state
```

看什么：pause 只持有 namespace，不跑业务；init 一个接一个，app 和 sidecar 才并行；删除顺序和启动顺序相反。

pause 持有 netns 的方式是“有一个进程一直待在里面”。业务容器启动时，父进程打开 `/proc/<pause-pid>/ns/net`，把 fd 通过 `cmd.ExtraFiles` 传给子进程；子进程在新的 PID/mount namespace 里调 `setns(fd, CLONE_NEWNET)`，再 `execve`。也可以 `mount --bind` 这个路径到 `/run/minipod/<id>/netns` 做稳定入口，但 bind mount 本身会持有 namespace，pause 死了它也不消失。最小实现用 `/proc/<pid>/ns/net` 就够了。

打开 netns 文件的动作要在 `pivot_root` 之前；`setns` 本身用继承的 fd，切根后也能做。切了根以后，宿主上的 `/proc/<pause-pid>` 已经不可见，再想打开就晚了。父进程先打开 fd，子进程继承，进容器后再 `setns`。UTS 和 IPC 同理；只共享网络时，把这两个 `setns` 去掉。

## 阶段拆解

每阶段只加一个机制。工作目录 `~/labs/cn2`，先 `go build -o minipod ./cmd/minipod`。

### 阶段 1：让 pause 持有 netns

目标：pause 调用 `unshare(CLONE_NEWNET|CLONE_NEWUTS|CLONE_NEWIPC)`，设置 Pod hostname，拉起 loopback，然后阻塞。跑：

```bash
sudo ./minipod run --spec testdata/pause.json
pause=$(cat /run/minipod/demo/pause.pid)
readlink /proc/$pause/ns/net
sudo nsenter -t "$pause" -n -- ip addr show lo
```

预期 `readlink` 输出的 inode 与宿主的不同（宿主通常是 `net:[4026531840]`，新建的 netns 一般是另一个更大的动态分配值），`lo` 是 `UP`。注意**不要把这个数字写死**：`4026531840` 正是 `PROC_DYNAMIC_FIRST`（`0xF0000000`），宿主 netns 通常拿到它，所以如果把 `4026531840` 当成"正确"，隔离失败反而会通过。硬性判据只有一个：`ping -c1 10.22.0.3` 能通（跨 netns 的地址），或 `nsenter` 后 `ip link` 里可见两个 veth 端点。通过标志：pause 还活着，`/proc/<pid>/ns/net` 可打开，`nsenter` 能看到独立的 loopback。此时 `minipod delete demo` 应该能干净地杀掉 pause 并删掉状态目录。

### 阶段 2：init 顺序，app 与 sidecar 并行

目标：init 一个接一个跑，任何一个非零退出就让整个 Pod 失败；全部成功后，app 和 sidecar 同时启动。测试 spec 让 init `sleep 3` 后打印 `init-done`，app 启动后打印 `app start`。跑：

```bash
sudo ./minipod run --spec testdata/pod.json
sleep 1
cat /run/minipod/demo/logs/app.log     # 预期还没有 app start
cat /run/minipod/demo/logs/init.log    # 预期只有 init start
sleep 4
cat /run/minipod/demo/logs/init.log    # 预期出现 init-done
cat /run/minipod/demo/logs/app.log     # 预期出现 app start
```

通过标志：app 的启动时间晚于 init 的退出时间；把 init 改成 `exit 1` 后，app 和 sidecar 都不启动，`state.json` 里 Pod 状态是 failed。再比较三个进程的 netns inode：

```bash
for p in $(cat /run/minipod/demo/pids/*); do readlink /proc/$p/ns/net; done
```

三行应该完全相同。在 sidecar 里监听端口，在 app 里连 `127.0.0.1`，能通就说明共享 netns 生效。

### 阶段 3：共享卷和日志

目标：runner 在状态目录下建 `vol/`，每个容器启动时把它 bind 到 `/data`。bind mount 必须在子进程的 mount namespace 里做，而且要在 `pivot_root` 之前，因为切根后宿主的 `vol/` 路径不可达。跑：

```bash
sudo ./minipod run --spec testdata/volume.json
cat /run/minipod/demo/vol/app.txt       # 预期看到 app 写的内容
cat /run/minipod/demo/logs/sidecar.log  # 预期 sidecar 读到了同一份内容
```

通过标志：宿主和 sidecar 看到同一份文件，两个容器的日志各自完整；`kill -9` 掉 app 后，已经写入的日志还在。日志不要接到没人读的 pipe 上，runner 直接把每个容器的 stdout/stderr 指向 `logs/<name>.log`，进程被杀时内核会把已写的数据留在文件里。

### 阶段 4：删除、信号和 subreaper

目标：`delete` 先给 app 发 `SIGTERM`，等 `gracePeriodSeconds`，没退出就 `SIGKILL`；然后对 sidecar 做同样的事；最后杀 pause。每个容器的 stage-2 helper 是 PID 1，它必须安装 `SIGTERM` handler，把信号转发给真正的命令（PID 2），并给子进程建独立进程组，用 `kill(-pgid, SIGTERM)` 连同孙进程一起通知。`wait4` 回收后按子进程的退出码退出。跑：

```bash
sudo ./minipod delete demo
cat /run/minipod/demo/logs/app.log      # 预期有 got SIGTERM
cat /run/minipod/demo/logs/sidecar.log  # 预期在 app 之后收到 SIGTERM
ps -eo pid,ppid,stat,cmd | grep -E 'defunct|minipod'
```

通过标志：app 先退出，sidecar 后退出，没有 `Z` 状态；`state.json` 记录 app 的退出码（正常退出 0，被 `SIGKILL` 是 137）；`/run/minipod/demo` 被删掉。Go 的 `ExitCode()` 对信号返回 -1，要按 `128+signal` 映射成 137。

PID 1 的信号语义是核心。内核不会把没有 handler 的 `SIGTERM` 送给 PID namespace 的 1 号，只对 `SIGKILL` 和 `SIGSTOP` 例外。helper 必须显式 `signal.Notify`，否则 `delete` 看起来发了信号，app 却一直不退出。helper 是 PID 1 时天然是这个 namespace 的 reaper；再调 `prctl(PR_SET_CHILD_SUBREAPER, 1)` 是双保险。

真正需要 subreaper 的是共享 PID namespace 的场景：只有一个 PID 1，其他容器里的孤儿都挂到它下面，必须由它 `wait4` 回收。runner 在宿主侧设 subreaper，可以兜住没有进 PID namespace 的 helper。

### 阶段 5（可选）：shareProcessNamespace 和 native sidecar

默认模型里，每个容器有自己的 PID namespace，`ps` 看不到彼此的进程。加一个 `shareProcessNamespace` 开关：所有容器加入 pause 的 PID namespace，`ps` 能看到全部进程，一个容器可以给另一个发信号；这时 pause 是 PID 1，必须自己回收孤儿。native sidecar 是另一个对照：把 sidecar 放进 init 列表并标记 `restartPolicy: Always`，让它在 app 之前启动、在所有普通容器之后终止。经典 sidecar 没有启动顺序保证，app 必须容忍它还没 ready。两种模型都做一遍，就能解释日志 sidecar 的顺序；native sidecar 的细节以 Kubernetes 文档为准。

## 验收与测试

CN2 没有自动 judge，按下面的人工清单验收。

| 验收项 | 怎么查 | 预期 |
|---|---|---|
| init 未完成时 app 不启动 | init `sleep 3`，1 秒后看 `logs/app.log` | 没有 `app start` |
| init 失败则 Pod 失败 | init 改成 `exit 1`，再 `status demo` | 状态 failed，app/sidecar 未启动 |
| 三个容器共享 netns | 比较 `/proc/<pid>/ns/net` 的 inode | 三行相同 |
| 容器内 `localhost` 可通 | sidecar 监听 8080，app 连 `127.0.0.1:8080` | 收到响应 |
| 共享卷可读写 | 宿主 `cat vol/app.txt`，sidecar 读同一路径 | 内容一致 |
| 日志按容器分开 | `ls logs/`，逐个 `cat` | 每个文件只有自己的输出 |
| 删除顺序 | `delete` 后看两个日志的时间戳 | app 的 `SIGTERM` 早于 sidecar |
| 没有僵尸 | `ps -eo stat,ppid,pid,cmd \| awk '$1 ~ /Z/'` | 没有输出 |
| 退出码记录 | `cat state.json` | 与实际退出码一致 |
| 清理干净 | `ls /run/minipod`、`lsns -t net` | 没有该 Pod 的目录和 netns |

`delete` 的优雅期默认 10 秒，测试时调成 2 秒。`SIGKILL` 之后进程可能来不及写日志，别把“日志里没有退出行”当成失败，先看 `state.json` 的退出码。

## 常见错误

| 现象 | 原因 | 处理 |
|---|---|---|
| app 看不到 Pod 的网卡 | 打开 netns 路径在 `pivot_root` 之后，路径已不可达 | 父进程先打开 netns fd，用 `ExtraFiles` 传给子进程 |
| 每个容器一个 netns | clone 时带了 `CLONE_NEWNET` | 去掉这个 flag，改用 `setns` 加入 pause 的 netns |
| init 和 app 一起启动 | 用 goroutine 同时启动所有容器 | init 逐个 `Wait`，全部成功后再并行启动 app/sidecar |
| `delete` 后 app 不退出 | PID 1 没装 `SIGTERM` handler | helper 里 `signal.Notify`，转发给子进程；命令用 exec 形式 |
| sidecar 比 app 先退出 | 并行启动，sidecar 没有等待条件 | 用 ready 文件或 native sidecar；或让 app 容忍未就绪 |
| 共享卷是空的 | bind mount 做在父进程，或做在 `pivot_root` 之后 | 在子进程的 mount namespace 里、切根之前 bind |
| `ps` 里有僵尸 | 容器没有独立 PID namespace，或 PID 1 不 `wait` | 给容器 `CLONE_NEWPID`；PID 1 循环 `wait4` 回收 |
| 日志丢最后几行 | stdout 接到 pipe，runner 没读 | 直接重定向到文件，不要用无人消费的 pipe |
| pause 死了业务容器还有网卡 | netns 还被业务容器持有，内核不会立刻销毁 | 不要依赖 pause 死亡清理；显式杀光容器，或重建 sandbox |
| cgroup 删不掉 | 里面还有进程 | 先 `cgroup.kill` 写 1，再 `rmdir` |

## 调试手册

先画进程树，再看 namespace。`ps -eo pid,ppid,stat,wchan:20,cmd --forest` 能看出谁是谁的子进程，`Z` 和 `PPID 1` 是僵尸的典型信号。`cat /proc/<pid>/status | grep -E 'NSpid|PPid|SigCgt'` 能看到进程在每层 PID namespace 里的编号；`SigCgt` 的位掩码里 `SIGTERM` 对应 bit 14，装没装 handler 一目了然。

namespace 用 `lsns` 和 `readlink` 对照：

```bash
lsns -o NS,TYPE,PID,COMMAND
for p in $(cat /run/minipod/demo/pids/*); do
  readlink /proc/$p/ns/net /proc/$p/ns/pid /proc/$p/ns/uts
done
nsenter -t <pid> -n -u -i -- sh -c 'hostname; ip addr; ps'
```

同一个 Pod 的 net/UTS/IPC inode 应该相同，PID 和 mount 各自不同。如果 net 不同，说明 `setns` 没生效；如果 PID 相同，说明 clone 时漏了 `CLONE_NEWPID`。

cgroup 看 `cgroup.events` 和 `cgroup.procs`：

```bash
cat /sys/fs/cgroup/minipod-<id>/cgroup.events   # populated 1 表示还有进程
cat /sys/fs/cgroup/minipod-<id>/cgroup.procs
```

`populated 1` 时 `rmdir` 一定失败。强制收尾时往 `cgroup.kill` 写 1，等 `populated` 变成 0。

syscall 用 `strace` 跟一遍启动和删除：

```bash
sudo strace -f -e trace=clone,setns,prctl,mount,pivot_root,kill,wait4 \
  ./minipod run --spec testdata/pod.json
```

重点看 `setns` 的 fd 是否指向 pause 的 netns，`clone` 的 flags 里有没有多带 `CLONE_NEWNET`，`kill` 的目标是不是 PID 1，`wait4` 有没有回收所有子进程。

## 提交前检查

- [ ] init 未完成时 app 不启动；init 失败时 app 和 sidecar 都不启动。
- [ ] pause、app、sidecar 的 netns inode 相同；UTS 和 IPC 也共享（如果实现了）。
- [ ] app 和 sidecar 能通过 `127.0.0.1` 通信；共享卷双向可见。
- [ ] `delete` 先 app 后 sidecar，最后 pause；没有僵尸；`SIGKILL` 兜底生效。
- [ ] 每个容器的退出码记录在 `state.json`，正常退出和 137 能区分。
- [ ] 清理后 `/run/minipod/<id>` 和对应 netns 都不存在。
- [ ] 不看代码能解释：pause 到底持有什么，PID 1 为什么可能收不到 `SIGTERM`。

## 自测问题

1. pause 进程死了，Pod 的 netns 会立刻消失吗？业务容器还会不会有网卡？
2. 为什么 netns 文件要在 `pivot_root` 之前打开？把 fd 传进子进程解决了什么？
3. 容器里的 PID 1 为什么可能收不到 `SIGTERM`？`tini` 解决了哪一步？
4. 默认的每容器 PID namespace 下，孤儿由谁回收？`shareProcessNamespace: true` 时又由谁回收？
5. 删除 Pod 时为什么最后才杀 pause？

### 答案要点

1. 不会立刻消失。netns 只要还有进程待在里面就存在，业务容器通过 `setns` 进来后也持有它。pause 死了，`/proc/<pause>/ns/net` 这个入口没了，新容器无法再加入，Pod 网络不可管理，kubelet 会重建 sandbox。
2. `pivot_root` 之后宿主上的 `/proc/<pause-pid>` 不可达，没法再打开 netns 文件。父进程提前打开 fd，通过 `ExtraFiles` 继承给子进程；`setns` 用这个 fd 即可，不必在切根前调用。
3. 内核不会把没有安装 handler 的信号送给 PID namespace 的 1 号，`SIGTERM` 会被忽略，只有 `SIGKILL` 和 `SIGSTOP` 例外。`tini` 安装 handler，转发给业务进程，并回收孤儿。
4. 默认模型里每个容器有自己的 PID namespace，1 号天然是 reaper。`shareProcessNamespace: true` 时整个 Pod 共用一个 PID namespace，pause 或 pod init 是 1 号，必须由它 `wait4` 回收；runner 在宿主侧设 subreaper 看不到 namespace 里的孤儿。
5. pause 持有 sandbox 的身份，先杀它会让还在退出的容器失去网络入口，sidecar 来不及 flush。先停 app，再停 sidecar，最后关 pause。
