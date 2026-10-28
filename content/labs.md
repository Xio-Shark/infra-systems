# Assignments

> 15 个编号实验 + 1 个 capstone。核心实验在单机 Linux 或 WSL2 上完成：2 vCPU、4 GB 内存、20 GB 磁盘；不需要 GPU、KVM 或多节点集群。
>
> 实验只给目标、任务、验收和常见坑，不给可直接提交的代码。

## INFRA 01 · Distributed Systems

| # | Lab | Build | Notes |
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

## INFRA 02 · Cloud-Native Systems

| # | Lab | Build | Notes |
|---|---|---|---|
| CN1 | Container from scratch | namespace/cgroup/rootfs, OOM test; optional OCI layout | [CN1](cloud-native.html#lab-cn1) |
| CN2 | Mini Pod lifecycle | pause/init/app/sidecar, signals | [CN2](cloud-native.html#lab-cn2) |
| CN3 | CNI and Service | veth/bridge/NAT/DNAT; optional DNS/timeout/retry | [CN3](cloud-native.html#lab-cn3) |
| CN4 | Workspace transaction | overlayfs commit/rollback, crash test | [CN4](cloud-native.html#lab-cn4) |
| CN5 | Capstone | mini multi-container platform + chaos | [CN5](cloud-native.html#lab-cn5) |

核心实验不需要 Kubernetes；kind/k3s 只用于可选的观察和对照。

## INFRA 03 · Agent OS

| # | Lab | Build | Notes |
|---|---|---|---|
| AOS1 | Typed ABI and sandboxed exec | syscall table, `spawn`/`exec`, isolation | [AOS1](agent-os.html#lab-aos1) |
| AOS2 | Workspace transaction | commit/rollback, crash recovery | [AOS2](agent-os.html#lab-aos2) |
| AOS3 | Capability sandbox | handles, attenuation, revocation, escape tests | [AOS3](agent-os.html#lab-aos3) |
| AOS4 | Snapshot and restore | overlayfs/reflink, consistent restore | [AOS4](agent-os.html#lab-aos4) |
| AOS5 | Lease, fencing, audit | dual-owner rejection, hash chain, replay | [AOS5](agent-os.html#lab-aos5) |
| Capstone | Minimal Agent OS | 8–10 operations, chaos tests, report | [Capstone](agent-os.html#lab-aos-capstone) |

## Completion criteria

- 实验通过验收测试；INFRA 01 的 `make` 要过 `-race`。
- 能不看代码讲清楚机制、失败模式、每个测试在测什么。
- 每个 lab 写 300 字：问题、设计、失败模式、如果换一个系统会怎样。
- 代码私有；不公开可直接复制的答案。

## Environment

- 单机 Linux 或 WSL2（Ubuntu 24.04），2 vCPU、4 GB 内存、20 GB 磁盘。
- 核心实验只依赖 namespace、cgroup v2、overlayfs、seccomp、pidfd、veth、iptables。
- 不需要 GPU、KVM、多节点集群；CRIU、Firecracker、eBPF 是可选的进阶实验。
- 如果 WSL2 缺少某个内核特性（例如 Landlock、overlayfs 挂载），用一台 Linux VM；不要改 Windows 宿主。

安装和检查见 [Environment](setup.html)。

## Safety

- 内核、namespace、mount、seccomp 实验只在一次性环境里做；先快照，做完重装。
- 不要在生产机、共享服务器、公司集群上做；不要挂载宿主目录或 Docker socket。
- 不要用真实 token、云凭证、生产数据库；用 fake tool、本地文件、临时数据库。
- 权限逃逸、网络扫描、DoS 测试只打自己的环境；不要扫校园网、公司网或云上邻居。
- 失败要有日志和报告；不要用假成功掩盖。
- 做完清理 cgroup、namespace、mount、iptables 规则和临时凭证。
