# Environment

> 所有核心实验在单机 Linux 或 WSL2 上完成：2 vCPU、4 GB 内存、20 GB 空闲磁盘。不需要 GPU、KVM 或多节点集群。
>
> 8 GB 内存更舒服；4 GB 足够跑 INFRA 01/02 和大部分 INFRA 03 实验。

## 1. Choose an environment

| 环境 | 适用 | 说明 |
|---|---|---|
| Linux（Ubuntu 24.04） | 全部课程 | 推荐；VM 或裸机 |
| WSL2 + Ubuntu 24.04 | 全部课程 | Windows 推荐；需要 systemd + cgroup v2 |
| macOS | INFRA 01 的 Go lab | 内核实验需要 Linux VM |

INFRA 02/03 需要 namespace、cgroup v2、mount、overlayfs、seccomp；这些在 WSL2 里通常都有。如果某个特性缺失，用一台 Linux VM，不要改 Windows 宿主。

## 2. WSL2 setup

在 Windows PowerShell：

```powershell
wsl --install -d Ubuntu-24.04
```

进入 Ubuntu 后，编辑 `/etc/wsl.conf`：

```ini
[boot]
systemd=true
```

回到 PowerShell：

```powershell
wsl --shutdown
```

重新打开 Ubuntu，检查：

```bash
uname -r
stat -fc cgroup2 /sys/fs/cgroup     # 应输出 cgroup2fs
sudo unshare -pf --mount-proc /bin/sh     # 应进入新的 PID/mount namespace
```

如果 `cgroup2fs` 没有挂载，先确认 systemd 已启用；仍然不行就换 Linux VM。

## 3. Common tools

```bash
sudo apt update
sudo apt install -y build-essential git make curl jq iproute2 iptables nftables \
  conntrack-tools strace libseccomp-dev attr fio
```

INFRA 01 需要 Go 1.22+：

```bash
sudo apt install -y golang-go
go version
```

也可以用官方 tarball；不要把 Go 装到需要 root 才能写的工作区。

## 4. INFRA 01：Go 与 lab 仓库

```bash
cd ~/labs
git clone git://g.csail.mit.edu/6.5840-golabs-2026 6.5840
cd 6.5840/src
```

如果 `git://` 被网络挡住，先试 HTTPS（MIT 的证书可能不匹配）：

```bash
git clone https://g.csail.mit.edu/6.5840-golabs-2026 6.5840
```

目录结构：

```text
6.5840/
  src/
    go.mod
    mr/                 Lab 1
    kvsrv1/             Lab 2
      lock/             Lab 2 lock
    raft1/              Lab 3
    kvraft1/            Lab 4
      rsm/              Lab 4A
    shardkv1/           Lab 5
    main/               入口程序，不要改
    mrapps/             示例 MapReduce 应用
    labrpc/             模拟网络 RPC
    labgob/             编码器
    tester1/            测试工具
  Makefile
```

构建与测试：

```bash
make mr          # Lab 1
make kvsrv1      # Lab 2 KV
make lock1       # Lab 2 lock
make raft1       # Lab 3
make rsm1        # Lab 4A
make kvraft1     # Lab 4B/C
make shardkv     # Lab 5
```

单测：

```bash
make RUN="-run Wc" mr
make RUN="-run 3A" raft1
make RUN="-run 4B" kvraft1
make RUN="-run 5A" shardkv
```

Lab 1 第一次跑 `make mr` 会挂住，因为 `Done()` 永远返回 false。这是预期的；先实现 `Done()`，或临时改成 `true` 看失败输出。

## 5. INFRA 02/03：kernel checks

```bash
# network namespace
sudo ip netns add lab && sudo ip netns list && sudo ip netns del lab

# overlayfs
mkdir -p /tmp/ovl/{lower,upper,work,merged}
echo hello > /tmp/ovl/lower/a
sudo mount -t overlay overlay \
  -o lowerdir=/tmp/ovl/lower,upperdir=/tmp/ovl/upper,workdir=/tmp/ovl/work \
  /tmp/ovl/merged
cat /tmp/ovl/merged/a
sudo umount /tmp/ovl/merged

# Landlock（可选；没有就跳过）
cat /sys/kernel/security/lsm

# seccomp / pidfd 头文件
ls /usr/include/seccomp.h
man pidfd_open
```

cgroup v2 的基本操作：

```bash
sudo mkdir /sys/fs/cgroup/lab
cat /sys/fs/cgroup/lab/cgroup.controllers
# 用一个测试进程，不要把当前 shell 放进 64M 的 cgroup
```

如果 `unshare` 报 `Operation not permitted`，确认你在 WSL2/Linux 里、有 root，或 user namespace 没有被发行版禁用。Ubuntu 24.04 对非特权 user namespace 有 AppArmor 限制；在 VM 里调整，不要改宿主。

## 6. Optional advanced tools

这些不是核心实验的硬性要求；没有对应硬件就跳过。

| 工具 | 用途 | 要求 |
|---|---|---|
| `bpftrace` | 内核 tracepoint/kprobe 观测 | root、内核头文件/BTF |
| `criu` | 进程 checkpoint/restore | 内核配置；WSL2 可能失败 |
| `runc` / `bubblewrap` | OCI runtime / 沙箱对照 | 用户态即可 |
| `skopeo` / `umoci` | 检查、打包 OCI 镜像 | 用户态即可；INFRA 02 第 3 讲 |
| `stress-ng` | CPU/内存压力测试 | 用户态即可；INFRA 02 第 9 讲 |
| `wrk` / `hey` | HTTP 压测、p99 | 用户态即可；INFRA 02 第 7/11 讲 |
| `kind` | 单节点 Kubernetes 对照 | Docker；可选 |
| Firecracker | microVM、snapshot | `/dev/kvm`；没有 KVM 就跳过 |

安装示例：

```bash
sudo apt install -y bpftrace runc bubblewrap criu stress-ng skopeo umoci
```

`criu check` 失败不代表课程做不下去；AOS4 的核心是工作区快照，CRIU 是选做。

## 7. Git and code privacy

INFRA 01 要求代码私有。建议：

```bash
cd ~/labs/6.5840
git checkout -b my-labs
git add ...
git commit -m "lab1: pass wc"
```

如果要推到 GitHub，仓库必须设为 private；不要开 GitHub Actions 跑 lab 测试，不要把代码贴到博客/Issue/论坛。公开的是笔记、设计图和失败报告，不是代码。

## 8. Debugging

- `go test -race`：必开；Raft/RSM 的竞态很容易漏。
- `go test -run TestName -count=100`：重复跑，抓偶发 bug。
- `go test -v`：看每个测试的输出。
- `fmt.Printf` / `log.Printf`：最有效的调试工具；把输出重定向到文件。
- `dlv`：需要断点时用；不要一上来就单步。
- Raft 测试失败会生成可视化 HTML（porcupine timeline），看事件顺序。
- `strace -f -e trace=...`：看 syscall；会拖慢程序，不要当生产审计。
- `dmesg` / `journalctl -k`：看 OOM、namespace、overlayfs 错误。
- cgroup：`/sys/fs/cgroup/.../memory.events`、`cpu.stat`、`cgroup.events`。

## 9. Common issues

| 错误 | 原因 | 解决 |
|---|---|---|
| `make mr` 挂住 | `Done()` 永远 false | 实现 `Done()`，或临时改 true 看失败 |
| `main/mrworker` 不存在 | Makefile 并发构建 | 手动 `go build -o main/mrworker main/mrworker.go` |
| `plugin.Open` 失败 | `.so` 没构建或路径不对 | `make mr-build`；用 `../../mrapps/wc.so` |
| `labgob` 警告字段小写 | RPC/日志结构体字段没大写 | 改成大写 |
| `-race` 报竞态 | 共享状态没锁 | 加锁；不要在持锁时发 RPC |
| `raft1` 测试超时 | 忙等、RPC 太多、commit 不前进 | 看 term/commitIndex/nextIndex |
| `make raft1` 很慢 | 正常，3D 在 `-race` 下约 5 分钟 | 耐心等；不要 Ctrl-C |
| `unshare: Operation not permitted` | 权限/user namespace | 用 root 或 Linux VM |
| cgroup v2 没挂载 | WSL2 没启用 systemd | 启用 systemd；否则用 VM |
| overlayfs 挂载失败 | 文件系统/权限 | 换 Linux VM 或 ext4 路径 |
| `iptables` 规则不生效 | nftables/iptables 混用 | 安装 `iptables-nft`，或直接用 `nft` |
| `bpftrace` 失败 | 缺内核头文件/BTF | 可选；跳过或用 `strace` |

## 10. Workload

- 每周 8–10 小时；Raft 阶段可以到 12 小时。
- 每个 lab 先读课程页和 lab 页，再画状态机/时序图，再写代码。
- 每完成一个 lab，写 300 字：问题、设计、失败模式、测试结果。
- 不要同时开两个 lab；Raft 的 bug 会污染后面的 lab。
