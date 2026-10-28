# 作业与实验

> 核心实验在单机 Linux 或 WSL2 上完成：2 vCPU、4 GB 内存、20 GB 磁盘；不需要 GPU、KVM 或多节点集群。
>
> 评分标准在 [评分标准](grading.html)。

## 从这里开始

**第一次学，按这个顺序：**

1. **选一门课**：
   - 想学分布式系统和 Go → [INFRA 01](course-map.html)，从 [Lab 1](lab1.html) 开始。
   - 想学容器、Pod、网络 → [INFRA 02](cloud-native.html)，从 [CN1](cloud-native.html#lab-cn1) 开始。
   - 想研究 agent 与内核 → 先完成 [INFRA 01](course-map.html) 的 Lab 1–4，或具备同等基础；再从 [AOS1](agent-os.html#lab-aos1) 开始。
2. **每做一个 lab**：
   - 先读课程页对应的讲义，知道这个 lab 在解决什么问题。
   - 打开 lab 页，读“目标”“任务”“验收”“常见坑”。
   - 在一次性的 Linux/WSL2 环境里实现，跑验收测试。
   - 写 300 字复盘：问题、设计、失败模式、测试结果。
3. **不要同时开两个 lab**。INFRA 01 的 Lab 3（Raft）是核心，通常需要 2–3 周；Lab 4/5 会复用它。

如果只是想先跑通一个最小例子，从 [INFRA 01 Lab 1](lab1.html) 或 [INFRA 02 CN1](cloud-native.html#lab-cn1) 开始；两者都不需要 Kubernetes。

## 本地评分 {#judge}

```bash
./judge/run.sh --list
./judge/run.sh infra01 lab1
./judge/run.sh --all --quick
```

**INFRA 01** 调用你本地的 6.5840 仓库：

```bash
LAB_ROOT=~/labs/6.5840 ./judge/run.sh infra01 lab3
```

**INFRA 02** 目前有 CN1 的契约测试：

```bash
SUBMISSION=./cn1 CN1_ROOTFS=/path/to/rootfs ./judge/run.sh infra02 cn1
```

没有 `SUBMISSION` / `CN1_ROOTFS` 时显示 `SKIP`，不会假装通过。评分标准在 `judge/courses/*.json` 和 `judge/tests/`；接口在 `judge/contracts/`。INFRA 02/03 的其余实验接口还没冻结，按 `cn1.sh` 的格式补。

## INFRA 01 · 分布式系统

| # | 实验 | 内容 | 说明 |
|---|---|---|---|
| 1 | MapReduce | coordinator/worker, RPC, timeout/retry, atomic rename | [Lab 1](lab1.html) |
| 2 | KV Server | linearizable Put/Get, version, at-most-once, lock | [Lab 2](lab2.html) |
| 3 | Raft | election, log replication, persistence, snapshot | [Lab 3](lab3.html) |
| 4 | Fault-tolerant KV | replicated state machine on Raft, snapshots | [Lab 4](lab4.html) |
| 5 | Sharded KV | shards, config changes, fault-tolerant controller | [Lab 5](lab5.html) |

Lab 3 是核心；Lab 4/5 复用 Lab 2/3 的代码。

```bash
cd ~/labs/6.5840/src

make mr          # Lab 1
make kvsrv1      # Lab 2 KV
make lock1       # Lab 2 lock
make raft1       # Lab 3
make rsm1        # Lab 4A
make kvraft1     # Lab 4B/C
make shardkv     # Lab 5
```

## INFRA 02 · 云原生系统

| # | 实验 | 内容 | 说明 |
|---|---|---|---|
| CN1 | Container from scratch | namespace/cgroup/rootfs, OOM test; optional OCI layout | [CN1](cloud-native.html#lab-cn1) |
| CN2 | Mini Pod lifecycle | pause/init/app/sidecar, signals | [CN2](cloud-native.html#lab-cn2) |
| CN3 | CNI and Service | veth/bridge/NAT/DNAT; optional DNS/timeout/retry | [CN3](cloud-native.html#lab-cn3) |
| CN4 | Workspace transaction | overlayfs commit/rollback, crash test | [CN4](cloud-native.html#lab-cn4) |
| CN5 | Capstone | mini multi-container platform + chaos | [CN5](cloud-native.html#lab-cn5) |

核心实验不需要 Kubernetes；kind/k3s 只用于可选的观察和对照。

## INFRA 03 · Agent OS

> 这门课是探索性内容：Agent OS 没有公认标准，下面的实验和接口设计都是待验证的假设，不代表主流做法。

| # | 实验 | 内容 | 说明 |
|---|---|---|---|
| AOS1 | Typed ABI and sandboxed exec | syscall table, `spawn`/`exec`, isolation | [AOS1](agent-os.html#lab-aos1) |
| AOS2 | Workspace transaction | commit/rollback, crash recovery | [AOS2](agent-os.html#lab-aos2) |
| AOS3 | Capability sandbox | handles, attenuation, revocation, escape tests | [AOS3](agent-os.html#lab-aos3) |
| AOS4 | Snapshot and restore | overlayfs/reflink, consistent restore | [AOS4](agent-os.html#lab-aos4) |
| AOS5 | Lease, fencing, audit | dual-owner rejection, hash chain, replay | [AOS5](agent-os.html#lab-aos5) |
| Capstone | Minimal Agent OS | 8–10 operations, chaos tests, report | [Capstone](agent-os.html#lab-aos-capstone) |

## 完成标准

- 本地 judge 的必做项通过；INFRA 01 的 `make` 还要过 `-race`。
- 能不看代码讲清楚机制、失败模式、每个测试在测什么。
- 每个 lab 写 300 字复盘：问题、设计、失败模式、测试结果。

## 环境

- 单机 Linux 或 WSL2（Ubuntu 24.04），2 vCPU、4 GB 内存、20 GB 磁盘。
- 核心实验只依赖 namespace、cgroup v2、overlayfs、seccomp、pidfd、veth、iptables。
- 不需要 GPU、KVM、多节点集群；CRIU、Firecracker、eBPF 是可选的进阶实验。
- 如果 WSL2 缺少某个内核特性（例如 Landlock、overlayfs 挂载），用一台 Linux VM；不要改 Windows 宿主。

安装和检查见 [Environment](setup.html)。

## 安全

- 内核、namespace、mount、seccomp 实验只在一次性环境里做；不要在生产机、共享服务器或带真实凭证的环境里做。
- 失败要有日志，不要用假成功掩盖。
