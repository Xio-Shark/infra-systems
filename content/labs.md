# 作业与实验

> 核心实验在单机 Linux 或 WSL2 上完成：2 vCPU、4 GB 内存、20 GB 磁盘；不需要 GPU、KVM 或多节点集群。
>
> 评分标准在 [评分标准](grading.html)。

## 从这里开始

讲义是导读和实验索引：读完对应讲义，再看本页和实验页的任务书，就可以开始。论文、官方页面和规范用来补完整论证，不是前置。

先看[学习路径](path.html)：第 0 周先修，然后 Lab 1→Lab 2→Lab 3→Lab 4→Lab 5；CN1→CN5；AOS1→Capstone。每个实验页顶部都有“难度 / 先修 / 时间 / 最小通过”，不要跳序。

**第一次学，按这个顺序：**

1. **选一门课**：
   - 想学分布式系统和 Go → [INFRA 01](course-map.html)，从 [Lab 1](lab1.html) 开始。
   - 想学容器、Pod、网络 → [INFRA 02](cloud-native.html)，从 [CN1](cn1.html) 开始。
   - 想研究 agent 与内核 → 先完成 [INFRA 01](course-map.html) 的 Lab 1–4，并做过 [INFRA 02](cloud-native.html) 的 CN1–CN2（namespace/cgroup），或具备同等基础；再从 [AOS1](aos1.html) 开始。
2. **每做一个实验**：
   - 先读课程页对应的讲义，知道这个实验在解决什么问题。
   - 打开实验页，先读“你将完成什么”“开始之前”“常见错误”。
   - 在一次性的 Linux/WSL2 环境里实现，跑验收测试。
   - 写 300 字复盘：问题、设计、失败模式、测试结果。
3. **不要同时开两个实验**。INFRA 01 的 Lab 3（Raft）是核心，通常需要 3–5 周；Lab 4/5 会复用它。

如果只是想先跑通一个最小例子，从 [INFRA 01 Lab 1](lab1.html) 或 [INFRA 02 CN1](cn1.html) 开始；两者都不需要 Kubernetes。

## 卡住时

- 回到讲义的“机制”和“失败模式”，写下你认为必须成立的不变量。
- 只跑一个失败测试，保留日志；不要同时改三处。
- 先把路径缩到最小：一个任务、一个请求、一个 shard、一个容器；跑通再加并发和故障。
- 测试通过但讲不清为什么，算没做完；测试失败但能解释边界，比碰巧通过有用。
- 实在卡住：在[课程仓库 Issues](https://github.com/Xio-Shark/infra-systems/issues) 提问，附上 `./judge/run.sh --json` 输出、`go version`、`uname -a`；不要贴完整代码。

## 本地评分 {#judge}

评分脚本在课程仓库的 `judge/` 里。第一次用：

```bash
git clone https://github.com/Xio-Shark/infra-systems.git
cd infra-systems
./judge/run.sh --list
./judge/run.sh infra01 lab1
```

`--quick` 只跑一小部分测试，是冒烟检查，最高显示 `PARTIAL`，不计为通过。

**INFRA 01** 调用你本地的 6.5840 仓库：

```bash
LAB_ROOT=~/labs/6.5840 ./judge/run.sh infra01 lab3
```

`LAB_ROOT` 默认是 `~/labs/6.5840`；克隆到别处时显式指定。

**INFRA 02** 目前有 CN1 的契约测试：

```bash
SUBMISSION=~/labs/cn1/cn1 CN1_ROOTFS=~/labs/cn1-rootfs ./judge/run.sh infra02 cn1
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

Lab 3 是核心；Lab 4/5 复用 Lab 2/3 的代码。接口签名以 `src/` 骨架为准，实验页只写行为和约束。

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
| CN1 | Container from scratch | namespace/cgroup/rootfs, OOM test; optional OCI layout | [CN1](cn1.html) |
| CN2 | Mini Pod lifecycle | pause/init/app/sidecar, signals | [CN2](cn2.html) |
| CN3 | CNI and Service | veth/bridge/NAT/DNAT; optional DNS/timeout/retry | [CN3](cn3.html) |
| CN4 | Workspace transaction | overlayfs commit/rollback, crash test | [CN4](cn4.html) |
| CN5 | Capstone | mini multi-container platform + chaos | [CN5](cn5.html) |

核心实验不需要 Kubernetes；kind/k3s 只用于可选的观察和对照。

## INFRA 03 · Agent OS

> 这门课是探索性内容：Agent OS 没有公认标准，下面的实验和接口设计都是待验证的假设，不代表主流做法。

| # | 实验 | 内容 | 说明 |
|---|---|---|---|
| AOS1 | Typed ABI and sandboxed exec | syscall table, `spawn`/`exec`, isolation | [AOS1](aos1.html) |
| AOS2 | Workspace transaction | commit/rollback, crash recovery | [AOS2](aos2.html) |
| AOS3 | Capability sandbox | handles, attenuation, revocation, escape tests | [AOS3](aos3.html) |
| AOS4 | Snapshot and restore | overlayfs/reflink, consistent restore | [AOS4](aos4.html) |
| AOS5 | Lease, fencing, audit | dual-owner rejection, hash chain, replay | [AOS5](aos5.html) |
| Capstone | Minimal Agent OS | 8–10 operations, chaos tests, report | [Capstone](aos-capstone.html) |

## 工时估计 {#hours}

按 8–10 小时/周、已有 Go/Linux 基础估算；第一次做内核实验通常取上限。15 个实验（含 2 个 capstone）约 200–300 小时，加上讲义和论文约 250–350 小时。

| 实验 | 预计 | 实验 | 预计 |
|---|---|---|---|
| Lab 1 MapReduce | 8–12h | CN1 container | 6–10h |
| Lab 2 KV/lock | 6–10h | CN2 Pod | 8–12h |
| Lab 3 Raft | 30–40h | CN3 CNI/Service | 10–14h |
| Lab 4 RSM/KV | 8–12h | CN4 workspace | 8–12h |
| Lab 5 shardkv | 10–15h | CN5 capstone | 15–25h |
| AOS1 ABI/sandbox | 12–20h | AOS2 workspace | 10–16h |
| AOS3 capability | 12–20h | AOS4 snapshot | 8–14h |
| AOS5 lease/audit | 10–16h | Agent OS capstone | 20–30h |

## 完成标准

- 本地 judge 的必做项通过（`--quick` 不算）；INFRA 01 的 `make` 默认已带 `-race`。
- 能不看代码讲清楚机制、失败模式、每个测试在测什么。
- 每个实验写 300 字复盘：问题、设计、失败模式、测试结果；模板见[评分标准](grading.html#reflection)。

## 环境

- 单机 Linux 或 WSL2（Ubuntu 24.04），2 vCPU、4 GB 内存、20 GB 磁盘。
- 核心实验只依赖 namespace、cgroup v2、overlayfs、seccomp、pidfd、veth、iptables。
- 不需要 GPU、KVM、多节点集群；CRIU、Firecracker、eBPF 是可选的进阶实验。
- 如果 WSL2 缺少某个内核特性（例如 Landlock、overlayfs 挂载），用一台 Linux VM；不要改 Windows 宿主。

安装和检查见[环境](setup.html)。

## 安全

- 内核、namespace、mount、seccomp 实验只在一次性环境里做；不要在生产机、共享服务器或带真实凭证的环境里做。
- 失败要有日志，不要用假成功掩盖。
