# CN1 · 从零做一个容器

> **课程**：[INFRA 02 · 云原生系统](cloud-native.html) · **实验 1/5**
>
> **先读**：[第 1 讲](cloud-native.html#cn1)、[第 2 讲](cloud-native.html#cn2) · **接口**：[contracts/infra02.md](https://github.com/Xio-Shark/infra-systems/blob/main/judge/contracts/infra02.md)
>
> **验收**：`SUBMISSION=~/labs/cn1/cn1 CN1_ROOTFS=~/labs/cn1-rootfs ./judge/run.sh infra02 cn1`
>
> [返回作业](labs.html) · [下一个：CN2](cn2.html)
>
> **难度** ★★ · **先修** Linux/Go 基础 + 第 1、2 讲 · **时间** 6–10 小时 · **最小通过** judge 的 namespace/rootfs/proc 检查；**完整通过** judge 全过（没有 `lsns` 时允许一项 SKIP）+ OOM 手工验收

## 你将完成什么

你要写一个 `cn1` 可执行文件，它不调用 Docker、containerd 或 runc，只用 namespace、mount 和 cgroup v2 把一条命令关进独立视图。评分脚本用 `SUBMISSION` 找到这个文件，用 `CN1_ROOTFS` 找到 busybox rootfs，然后逐项调用：

```bash
SUBMISSION=~/labs/cn1/cn1 CN1_ROOTFS=~/labs/cn1-rootfs ./judge/run.sh infra02 cn1
```

全部通过时，你会看到 12 行 `PASS`（没有 `lsns`、或读不到 host 的 cgroup 树时，对应两项显示 `SKIP`），最后是 `总分：20/20` 和“自动检查全部通过”。这些检查覆盖命令执行、退出码、stderr、PID/mount/network/IPC 四个 namespace、rootfs 切换、容器本地 `/proc`、hostname、`--memory` 参数，以及运行期间是否真的存在 `memory.max=64M` 的 cgroup。内存上限是否真的触发 OOM kill 仍是人工验收项——自动检查只证明上限被写进去了。

难点不在系统调用数量，而在顺序：namespace 要在 `clone` 时建，`/proc` 要在新的 PID namespace 里挂，rootfs 要在 mount namespace 里切，cgroup 要在子进程还活着时写。顺序错一步，失败信息通常不会指向真正的原因。

## 开始之前

先读[第 1 讲](cloud-native.html#cn1)和[第 2 讲](cloud-native.html#cn2)。第 1 讲解释 namespace、cgroup 和 rootfs 各管什么；第 2 讲解释运行时为什么需要 shim、谁持有 stdio。这个实验只做前者，但后者的视角能帮你理解清理顺序。

环境检查在 Linux 或 WSL2 的 Ubuntu 24.04 里做，需要 root：

```bash
stat -fc %T /sys/fs/cgroup          # 预期 cgroup2fs
cat /sys/fs/cgroup/cgroup.controllers   # 预期包含 memory
id -u                               # 预期 0
uname -r                            # 预期 5.15 以上
```

如果 `cgroup.controllers` 里没有 `memory`，先把 `+memory` 写进父 cgroup 的 `cgroup.subtree_control`。如果 `/sys/fs/cgroup` 是只读的，说明你在一个没有委派 cgroup 的容器里，换一台启用了 systemd 的 WSL2 或 Linux VM。`clone(CLONE_NEWPID)`、`mount` 和 `pivot_root` 都需要 `CAP_SYS_ADMIN`，所以下面的命令默认在 root shell 里跑。用普通用户时，`sudo -E` 要保留 `SUBMISSION` 和 `CN1_ROOTFS`；judge 是否以 root 运行、cgroup 是否委派，契约没写。

rootfs 按[环境页](setup.html)准备：

```bash
sudo apt install -y busybox-static
rootfs=~/labs/cn1-rootfs
mkdir -p "$rootfs"/{bin,proc,sys,dev,tmp}
cp /bin/busybox "$rootfs/bin/"
for c in sh hostname cat readlink ps mount; do ln -sf busybox "$rootfs/bin/$c"; done
sudo chroot "$rootfs" /bin/sh -c 'echo rootfs-ok'   # 预期 rootfs-ok
```

目录布局建议如下。rootfs 是评分脚本传进来的目录，不要复制它，也不要打包进二进制。脚本会往这个目录写一个 marker，再从容器里的 `/` 读回来。

```text
~/labs/cn1/
  go.mod
  main.go          # CLI、clone、cgroup、退出码
  cn1              # go build -o cn1 .
~/labs/cn1-rootfs/
  bin/busybox
  bin/sh -> busybox
  bin/hostname -> busybox
  bin/cat -> busybox
  bin/readlink -> busybox
  proc/  sys/  dev/  tmp/
```

时间预算 6–10 小时。第一次做，先让 `/bin/sh -c 'echo ok'` 在宿主上跑通，再加 namespace，最后加 rootfs 和 cgroup。不要一开始就把五件事写在一起。

## 代码地图

仓库里有一份起步骨架 `starters/cn1/`，把命令行解析、父子进程切换和退出码透传搭好了，可以直接 `go build`，核心逻辑分成 7 处 `TODO(n)`（n 从 2 到 8）：cgroup 建组与迁移、mount propagation、bind rootfs、挂 `/proc`、`pivot_root`、`sethostname`。想自己从零写也可以，下面给出同样的职责划分。

最小实现只需要一个 `main.go`。建议按职责拆成三块，调试时容易定位：

- `main.go`：解析 `run --rootfs DIR [--memory 64M] -- CMD [ARG...]`，启动子进程，等待结束，透传退出码。
- `child.go`：子进程阶段，已经在新的 namespace 里。它负责 private mount、bind rootfs、挂 `/proc`、`pivot_root`、`sethostname`，最后 `execve` 目标命令。
- `cgroup.go`：创建 cgroup v2 子组，把子进程的宿主 PID 写进 `cgroup.procs`，设置 `memory.max`，退出后清理。

可执行文件放在 `~/labs/cn1/cn1`，评分脚本只认这个路径。rootfs 放在 `~/labs/cn1-rootfs`，和代码分开。不要改 `judge/` 下的文件；测试是黑盒的，改测试不会让实现变对。

## 接口与数据流

命令行只有一种形式：

```text
cn1 run --rootfs DIR [--memory 64M] -- CMD [ARG...]
```

`--` 之前是 `cn1` 的参数，之后全部属于 `CMD`，包括看起来像 `--memory` 的字符串。`--memory` 可以省略；给了就必须设置 `memory.max`。退出码等于 `CMD` 的退出码，stdout 和 stderr 直接继承父进程的文件描述符，不缓冲、不改写。

一次运行的控制流如下：

```text
cn1（宿主 PID N）
  │  解析参数
  ├─ clone(CLONE_NEWPID|CLONE_NEWNS|CLONE_NEWUTS|CLONE_NEWIPC|CLONE_NEWNET)
  │    └─ stage-2 helper（新 PID namespace 里的 1 号）
  │          mount / private
  │          bind DIR → DIR（让 DIR 成为挂载点）
  │          mount proc → DIR/proc
  │          pivot_root(DIR, DIR/.oldroot)
  │          sethostname("cn1")
  │          execve(CMD)
  ├─ 写 child host pid → cgroup.procs
  ├─ 写 67108864 → memory.max
  └─ waitpid → 删 cgroup → exit(child code)
```

看什么：`clone` 在父进程，`/proc` 和 `pivot_root` 在子进程，cgroup 的写入在父进程，而且必须赶在子进程退出之前。

把宿主视角和容器内视角并排看：

<div class="anim" data-anim="namespace-isolation">
<p class="anim-fallback">这个动画需要 JavaScript；正文的步骤说明仍然完整。</p>
</div>

关键调用只有五个：

```go
cmd.SysProcAttr = &syscall.SysProcAttr{
    Cloneflags: syscall.CLONE_NEWPID | syscall.CLONE_NEWNS |
        syscall.CLONE_NEWUTS | syscall.CLONE_NEWIPC | syscall.CLONE_NEWNET,
}
syscall.Mount("", "/", "", syscall.MS_REC|syscall.MS_PRIVATE, "")
syscall.Mount(rootfs, rootfs, "", syscall.MS_BIND|syscall.MS_REC, "")
syscall.Mount("proc", rootfs+"/proc", "proc", 0, "")
syscall.PivotRoot(rootfs, rootfs+"/.oldroot")
```

Go 不能在 `clone` 和 `execve` 之间插入任意代码，所以用“重新执行自己”的办法。父进程用 `/proc/self/exe` 启动 stage-2 helper，通过环境变量 `CN1_STAGE=child` 区分角色。helper 在子进程里跑完挂载和 `pivot_root`，再 `syscall.Exec` 目标命令。骨架如下，省略了错误处理和 cgroup 清理细节：

```go
func main() {
    if os.Getenv("CN1_STAGE") == "child" {
        child()
        return
    }
    rootfs, mem, argv := parse(os.Args[1:])
    cmd := exec.Command("/proc/self/exe", append([]string{"child", rootfs}, argv...)...)
    cmd.Env = append(os.Environ(), "CN1_STAGE=child")
    cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
    cmd.SysProcAttr = &syscall.SysProcAttr{Cloneflags: syscall.CLONE_NEWPID |
        syscall.CLONE_NEWNS | syscall.CLONE_NEWUTS |
        syscall.CLONE_NEWIPC | syscall.CLONE_NEWNET}
    if err := cmd.Start(); err != nil {
        log.Fatal(err)
    }
    cg := ""
    if mem != "" {
        cg = setupCgroup(cmd.Process.Pid, mem) // mkdir + cgroup.procs + memory.max
    }
    err := cmd.Wait()
    if cg != "" {
        os.Remove(cg) // 子进程退出后目录才为空
    }
    os.Exit(exitCode(err))
}

func child() {
    rootfs, argv := os.Args[2], os.Args[3:]
    must(syscall.Mount("", "/", "", syscall.MS_REC|syscall.MS_PRIVATE, ""))
    must(syscall.Mount(rootfs, rootfs, "", syscall.MS_BIND|syscall.MS_REC, ""))
    os.MkdirAll(rootfs+"/proc", 0555)
    must(syscall.Mount("proc", rootfs+"/proc", "proc", 0, ""))
    os.MkdirAll(rootfs+"/.oldroot", 0700)
    must(syscall.PivotRoot(rootfs, rootfs+"/.oldroot"))
    must(os.Chdir("/"))
    syscall.Unmount("/.oldroot", syscall.MNT_DETACH)
    os.Remove("/.oldroot")
    syscall.Sethostname([]byte("cn1"))
    path, err := exec.LookPath(argv[0]) // judge 会用裸名字调 hostname
    if err != nil {
        os.Exit(127)
    }
    syscall.Exec(path, argv, os.Environ())
}
```

`syscall.Exec` 不搜 `PATH`，而 judge 会用裸名字调 `hostname`。切根后用 `exec.LookPath` 解析；必要时在 child 里设默认 `PATH=/bin:/usr/bin:/sbin:/usr/sbin`。

`setupCgroup` 不要直接把 `"64M"` 写进 `memory.max`。先把后缀换算成字节，再写十进制数字，可以避开不同内核版本对单位后缀的差异。顺序是先建子组、先把上限写好，再 `Start()`，最后立刻把子进程的 TID 写进 `cgroup.procs`。反过来（先启动再设上限）不会让限制失效，但子进程可能在被迁进 cgroup 之前就 fork 出孙进程，那段时间完全不受限；`memory.max` 是跟着 cgroup 走的，所以孙进程一旦随父进程一起迁入就同样受限，真正漏掉的是"迁移前的瞬间"。骨架里的 TODO(2)(3) 就是这两步。

## 阶段拆解

每个阶段只加一个机制，跑通再进下一个。先构建，再用最小命令冒烟：

```bash
cd ~/labs/cn1
go build -o cn1 .
./cn1 run --rootfs ~/labs/cn1-rootfs -- /bin/sh -c 'echo cn1-ok'
```

### 阶段 1：先让命令跑起来

目标：不做隔离，`cn1` 只是 `exec` 目标命令，但参数解析和退出码已经正确。改 `main.go` 的 `parse` 和启动逻辑，暂时不加 `Cloneflags`。跑：

```bash
./cn1 run --rootfs ~/labs/cn1-rootfs -- /bin/sh -c 'echo cn1-ok; exit 7'
echo $?    # 预期 7
./cn1 run --rootfs ~/labs/cn1-rootfs -- /bin/sh -c 'echo err >&2' 2>&1
```

预期先看到 `cn1-ok`，`echo $?` 是 7，第三条能看到 `err`。通过标志：judge 的前三项变成 `PASS`。

### 阶段 2：加 namespace 和 hostname

目标：加上 `CLONE_NEWPID|NEWNS|NEWUTS|NEWIPC|NEWNET`，并在子进程里 `sethostname("cn1")`。此时还没有切 rootfs，`/proc` 仍然是宿主挂载的，但进程已经在新的 namespace 里。跑：

```bash
./cn1 run --rootfs ~/labs/cn1-rootfs -- /bin/sh -c \
  'readlink /proc/self/ns/pid; readlink /proc/self/ns/net; hostname'
hostname    # 宿主 hostname，应该和上面不同
```

预期容器里的 `pid` 和 `net` 链接与宿主不同，hostname 是 `cn1`。通过标志：PID、mount、network、IPC、hostname 五项 `PASS`。mount namespace 在这一步已经建了，但 `pivot_root` 还没做，所以 rootfs 检查仍然失败。

### 阶段 3：切 rootfs，挂自己的 /proc

目标：在 mount namespace 里把 `/` 设为 private，bind rootfs 到它自己，挂新的 procfs，然后 `pivot_root`。这一阶段同时解决 rootfs 和 `/proc` 两项检查。先手工验证：

```bash
printf 'cn1-rootfs-ok\n' | sudo tee ~/labs/cn1-rootfs/.marker >/dev/null
sudo ./cn1 run --rootfs ~/labs/cn1-rootfs -- /bin/sh -c 'cat /.marker; ps'
```

预期 `cat` 输出 `cn1-rootfs-ok`，`ps` 里只有这条 shell 和它启动的 `ps`，看不到宿主的一堆 PID。通过标志：`switch to the supplied rootfs` 和 `mount a container-local /proc` 变绿。如果 marker 看不到，先检查你是不是把 rootfs 复制到了临时目录；脚本写的是 `CN1_ROOTFS`，你切过去的必须是同一个目录。

### 阶段 4：cgroup 内存上限

目标：`--memory 64M` 时创建 cgroup v2 子组，把子进程写进 `cgroup.procs`，把 `memory.max` 设成 67108864。先确认父 cgroup 能建子组：

```bash
sudo mkdir /sys/fs/cgroup/cn1-test
cat /sys/fs/cgroup/cn1-test/cgroup.controllers   # 预期包含 memory
sudo rmdir /sys/fs/cgroup/cn1-test
```

busybox 没有可靠的内存分配器，写一个十行的 Go 程序，循环 `make([]byte, 1<<20)` 并逐页写 1，静态编译后放进 rootfs 的 `/bin/memhog`。跑：

```bash
sudo ./cn1 run --rootfs ~/labs/cn1-rootfs --memory 64M -- /bin/memhog
echo $?       # 预期 137，被 SIGKILL
sudo cat /sys/fs/cgroup/cn1-*/memory.events   # 预期 oom_kill 1
```

预期进程在几秒内被杀，`dmesg -T | tail` 里能看到 `oom-kill`。通过标志：`accept a memory limit` 变绿，手工 OOM 也能复现。如果 `memhog` 没被杀，先看 `memory.max` 是否写对 cgroup，或子进程在入组前已 fork。`echo` 可能在父进程写 `cgroup.procs` 前退出，稳妥做法是用 `clone3` 的 `CLONE_INTO_CGROUP` 在创建时入组。

### 阶段 5：清理和全量验收

目标：子进程退出后删掉 cgroup，保证没有残留 PID namespace。清理顺序是：`waitpid` 拿到退出码；确认 `cgroup.procs` 为空；`rmdir` 子组；如果里面还有进程，往 `cgroup.kill` 写 1，再等一次。跑全量：

```bash
sudo SUBMISSION=~/labs/cn1/cn1 CN1_ROOTFS=~/labs/cn1-rootfs \
  ./judge/run.sh infra02 cn1
```

预期 11–13 行 `PASS`（不支持的检查显示 `SKIP`），`总分：20/20`。通过标志：最后一行是“自动检查全部通过”。

## 验收与测试

judge 的检查项和它们在看什么如下。共 13 项，其中第 10 项（`lsns`）和第 13 项（读 host 的 cgroup 树）在环境不支持时显示 `SKIP`，所以 `PASS` 的行数可能是 11、12 或 13。

| # | 检查 | 它在看什么 |
|---|---|---|
| 1 | run a command inside the rootfs | `echo cn1-ok` 能从容器里出来 |
| 2 | propagate the command exit code | `exit 7` 原样变成 `cn1` 的退出码 |
| 3 | pass stderr through | 容器里的 stderr 没被吞掉 |
| 4 | create a new PID namespace | `/proc/self/ns/pid` 的 inode 与宿主不同 |
| 5 | create a new mount namespace | `/proc/self/ns/mnt` 不同 |
| 6 | create a new network namespace | `/proc/self/ns/net` 不同 |
| 7 | create a new IPC namespace | `/proc/self/ns/ipc` 不同 |
| 8 | switch to the supplied rootfs | 脚本写进 `CN1_ROOTFS` 的 marker 在 `/` 可见 |
| 9 | mount a container-local /proc | `/proc/self/status` 可读，宿主脚本的 PID 不可见 |
| 10 | leave no extra PID namespace | 运行前后 `lsns -t pid` 的行数不增加（`lsns` 读不到时 SKIP） |
| 11 | set a separate hostname | 容器里的 `hostname` 非空且不等于宿主 |
| 12 | accept a memory limit | `--memory 64M` 不破坏命令执行 |
| 13 | set memory.max while running | 容器运行期间确实存在一个 `memory.max=67108864` 的 cgroup（读不到 host cgroup 树时 SKIP） |

自动检查验证的是"上限被写进去了"，不是"超限会被杀"。手工验收补两项：64M 下 `memhog` 被杀、`memory.events` 里 `oom_kill` 至少为 1；退出后 `ls /sys/fs/cgroup | grep cn1` 没有输出。命令被信号杀死时用 128+signal 还是别的码，契约没写。

## 常见错误

| 现象 | 原因 | 处理 |
|---|---|---|
| `fork/exec /proc/self/exe: operation not permitted` | 没有 `CAP_SYS_ADMIN`，或 seccomp 挡了 `clone` | 用 root；WSL2 里确认 systemd 已启用 |
| `pivot_root: invalid argument` | 新根不是挂载点，或 `put_old` 不在新根下面 | 先 bind mount rootfs 到它自己；把 `/` 设为 `MS_PRIVATE` |
| 容器里的 `ps` 还是宿主进程 | `/proc` 没重新挂，或挂在了 PID namespace 之外 | 在子进程里、进入新 PID namespace 之后挂 procfs |
| marker 在 `/` 看不到 | 切到了 rootfs 的副本，或目标不是 `CN1_ROOTFS` | 直接用传入的 `DIR`，不要复制 |
| hostname 和宿主一样 | 只建了 UTS namespace，没调 `sethostname` | 新 UTS namespace 会继承宿主 hostname，必须显式设置 |
| `--memory` 被当成命令 | 解析在第一个非选项处停止，或没处理 `--` | `--` 之后一律当 `CMD`，之前只认 `run`、`--rootfs`、`--memory` |
| `memory.max: no such file or directory` | 父 cgroup 没启用 `memory` 控制器 | 往父组 `cgroup.subtree_control` 写 `+memory` |
| `cgroup.procs: no such process` | 子进程已经退出才写 PID | `Start` 之后立刻写，不要等 `Wait` |
| 退出码永远是 0 | 忽略 `cmd.Wait()` 的错误，直接 `os.Exit(0)` | 用 `*exec.ExitError` 取 `ExitCode()` |
| 运行后多出一个 PID namespace | 子进程留下了后台进程，或 helper 没被 wait | 让 stage-2 成为 PID 1；退出前确认没有孙进程 |
| 内存限制只盖住部分进程 | 写 `cgroup.procs` 前子进程已 fork，孙进程不会自动进来 | 让子进程 exec 前写自己，或用 `clone3` 的 `CLONE_INTO_CGROUP` |

## 调试手册

先看 namespace，不看日志。容器还在跑时，在另一个终端执行：

```bash
lsns -o NS,TYPE,PID,COMMAND
pgrep -a cn1
for ns in pid mnt net uts ipc; do
  stat -Lc "$ns %i" /proc/<pid>/ns/$ns
done
```

`lsns` 里应该出现一条新的 PID namespace，PID 列是你的 helper；`/proc/<pid>/ns/*` 的 inode 与宿主对应文件不同。想进去看，用 `nsenter -t <pid> -p -m -u -i -n -- /bin/sh`；只看网络，用 `nsenter -t <pid> -n -- ip addr`。进不去通常是权限不够，或者进程已经退出。

接着看 mount。`nsenter -t <pid> -m -- cat /proc/self/mountinfo` 里，`/` 应该指向 `CN1_ROOTFS`，`/proc` 的挂载类型是 `proc`。如果 `/` 还是宿主根，说明 `pivot_root` 没成功但错误被吞了。在 `child()` 里每个 syscall 后检查 `errno`，不要用 `_` 接返回值。

cgroup 用文件系统看，不用猜：

```bash
cat /sys/fs/cgroup/cn1-<pid>/memory.max
cat /sys/fs/cgroup/cn1-<pid>/memory.current
cat /sys/fs/cgroup/cn1-<pid>/memory.events
cat /sys/fs/cgroup/cn1-<pid>/cgroup.procs
```

`memory.events` 里的 `oom` 和 `oom_kill` 是累计计数。`oom_kill` 增加说明真的杀了进程；只有 `oom` 增加说明只是进入了 OOM 状态。`cgroup.procs` 为空才能 `rmdir`。

syscall 层面用 `strace`：

```bash
sudo strace -f -e trace=clone,unshare,mount,pivot_root,setns,execve,wait4 \
  ./cn1 run --rootfs ~/labs/cn1-rootfs -- /bin/sh -c 'true'
```

看 `clone` 的 flags 是否包含五个 `CLONE_NEW*`，`pivot_root` 的两个参数是不是同一个 rootfs 下的路径，`execve` 之前有没有失败的 `mount`。`strace` 会拖慢程序，只在最小命令上跑。

## 提交前检查

- [ ] `sudo ./judge/run.sh infra02 cn1` 显示 13 项里没有 `FAIL`（不支持的环境项是 `SKIP`），`总分：20/20`。
- [ ] 手工 OOM 通过：`--memory 64M` 下 `memhog` 被杀，`memory.events` 的 `oom_kill` 至少为 1。
- [ ] `ls /sys/fs/cgroup | grep cn1` 没有输出；`mount | grep cn1-rootfs` 没有输出。
- [ ] 连续跑三次 judge，结果一致；没有偶发的 `cgroup.procs: no such process`。
- [ ] 不看代码能讲清楚：为什么 `/proc` 必须在新 PID namespace 里挂，为什么 `pivot_root` 前要把 `/` 设为 private。
- [ ] 代码没有复制 rootfs、没有硬编码 `~/labs/cn1-rootfs`，`--rootfs` 给什么就用什么。

## 自测问题

1. 为什么 `clone` 时就要带上 `CLONE_NEWPID`，而不是进去以后再 `unshare`？
2. 为什么 `pivot_root` 之前要把 `/` 设为 `MS_PRIVATE`？不设会看到什么？
3. 为什么 `/proc` 必须在新的 PID namespace 里挂载？挂宿主 `/proc` 会通过哪些检查、失败哪些检查？
4. cgroup v2 的 `cgroup.procs` 和 v1 的 `tasks` 有什么区别？写错文件会怎样？
5. 容器退出后，什么情况下会残留一个 PID namespace？怎么用 `lsns` 证明它没了？

### 答案要点

1. `CLONE_NEWPID` 让子进程成为新 namespace 的 1 号。`unshare(CLONE_NEWPID)` 只影响调用者之后创建的子进程，调用者自己还在旧 namespace 里。父进程在 `clone` 时建，才能保证 helper 一开始就是 1 号。
2. 不设 private 时，子进程里的挂载会沿共享的 peer group 传播回宿主，`pivot_root` 可能失败，宿主上也可能出现不该有的挂载点。设成 `MS_PRIVATE|MS_REC` 后，改动只对自己可见。
3. 宿主 `/proc` 是宿主 PID namespace 的 procfs。`/proc/self/ns/pid` 仍然显示进程所在的 PID namespace，所以检查 4 可能通过；但 `/proc` 里能看到宿主所有 PID，检查 9 会失败。新挂 procfs 后，`/proc` 只列当前 namespace 的进程。
4. `cgroup.procs` 移动整个线程组，`tasks` 移动单个线程；v2 只有 `cgroup.procs`。写到父组或写错文件，进程不受子组 `memory.max` 约束。
5. 子进程留下了后台进程，或者 stage-2 不是 PID 1，导致孙进程逃逸。`lsns -t pid` 的行数在运行前后不变，且 `pgrep -a cn1` 没有输出，才能说明没有残留。
