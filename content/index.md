# 从分布式系统到 Agent OS

> 三门课：分布式系统、云原生与多容器、Agent OS（探索课）。
>
> 实验在单机 Linux 或 WSL2 上运行；2 vCPU、4 GB 内存、20 GB 磁盘即可，不需要 GPU 或多台机器。INFRA 01 也可以在 macOS 上做；INFRA 02/03 需要 Linux VM 或 WSL2。

## 第一次来

先选一门课，再按课程页的“怎么开始”做第一个实验。第一次来先读[导引](start.html)。

| 你想学 | 先看 | 第一个作业 | 评分 |
|---|---|---|---|
| 分布式、Go、Raft | [INFRA 01](course-map.html) | [Lab 1](lab1.html) | `./judge/run.sh infra01 lab1` |
| 容器、Kubernetes 底层 | [INFRA 02](cloud-native.html) | [CN1](cn1.html) | `./judge/run.sh infra02 cn1` |
| agent 与内核（探索） | [INFRA 03](agent-os.html) | [AOS1](aos1.html) | 先按任务书自测 |

CN1 需要 `SUBMISSION` 和 `CN1_ROOTFS` 两个环境变量；完整命令见[环境](setup.html#cn1-rootfs)。没有变量时 judge 显示 `SKIP`，不会假装通过。

课程仓库（含 `judge/`、任务书和全部讲义）：

```bash
git clone https://github.com/Xio-Shark/infra-systems.git
cd infra-systems
```

下面的 `./judge/run.sh` 都在这个目录里运行；6.5840 的实验代码在另一个目录（见[环境](setup.html)）。

作业都在 [作业与实验](labs.html)；评分标准在 [评分标准](grading.html)；阅读材料在 [阅读](papers.html)。

## 课程说明

INFRA 01 讨论多台机器上的副本和共识；INFRA 02 讨论一台机器上的容器、网络和存储；INFRA 03 探索 agent 调用工具时，内核应该提供哪些操作。

INFRA 01 读 MapReduce、GFS、Paxos、Raft、Spanner、Ray，写 MapReduce、KV、Raft、RSM、sharded KV。

INFRA 02 读 OCI/CNI/CSI 规范、Kubernetes 文档、Borg、Firecracker，做容器、Pod、网络、工作区事务。

INFRA 03 读 seL4、gVisor、AIOS、Saga，设计一组新的原子操作，把 agent 的操作交给内核执行。

> **INFRA 03 是探索课。** Agent OS 没有公认的标准，本页的操作表、原子性主张和系统结构都是研究性假设，不一定正确，也可能被更好的方案取代。课程要求你证明或推翻它们。

三门课共享三个问题：**谁在写？什么时候算完成？失败后看到什么？** 第一门课用副本回答，第二门课用容器和编排回答，第三门课用 capability 和事务回答。

## 课程

| 课程 | 名称 | 讲数 | 实验 | 先修 |
|---|---|---|---|---|
| INFRA 01 | [分布式系统](course-map.html) | 21 + demo | 5 | Go、操作系统基础 |
| INFRA 02 | [云原生系统](cloud-native.html) | 14 | 5 | Linux/WSL2、C 或 Go |
| INFRA 03 | [Agent OS](agent-os.html) | 12 | 5 + capstone | INFRA 01 Lab 1–4 + INFRA 02 CN1–CN2，或同等基础 |

## 先修要求

- 会一门编译型语言。INFRA 01 用 Go；INFRA 02/03 用 Go 或 C。
- 知道进程、线程、锁、文件系统、socket；知道 syscall 是什么。
- 不需要先学完 OS 课；INFRA 03 需要你在 Linux 里动过 namespace、cgroup、mount。

## 环境

- 单机 Linux 或 WSL2（Ubuntu 24.04），2 vCPU、4 GB 内存、20 GB 空闲磁盘。
- 不需要 GPU、KVM、多节点集群。kind/k3s、CRIU、Firecracker、eBPF 都是可选进阶；核心实验只依赖 namespace、cgroup v2、overlayfs、seccomp、pidfd、veth、iptables。
- 内核实验在一次性环境里做；不要在生产机、共享服务器或带真实凭证的环境里做。
- 安装与检查：[环境](setup.html)。

## 考核

INFRA 01 和 CN1 有本地评分脚本，放在课程仓库的 `judge/` 目录；INFRA 02 的 CN2–CN5、INFRA 03 按任务书人工验收：

```bash
./judge/run.sh --list
./judge/run.sh infra01 lab1
```

完成一门课的标准：

- 评分脚本的必做项通过；
- 能不看代码讲清楚机制、失败模式和测试在测什么；
- 能回答课程页的设计问题。

用法见 [作业与实验](labs.html#judge)。

## 阅读

讲义是导读；论文、白皮书和规范是深入参考：MapReduce、GFS、Paxos、Raft、Spanner、Borg、Firecracker、gVisor、seL4、AIOS，以及 OCI、CNI、CSI 规范。每篇的定位和阅读重点见 [阅读](papers.html)。

## 时间安排

| 节奏 | 安排 |
|---|---|
| 8–10 小时/周（推荐） | 24–30 周：INFRA 01 第 1–8 周；INFRA 02 第 9–16 周；INFRA 03 第 17–26 周；留 2–4 周缓冲 |
| 15–20 小时/周（冲刺） | 14–18 周：INFRA 01 第 1–6 周；INFRA 02 第 7–11 周；INFRA 03 第 12–17 周 |

冲刺路径是 14–18 周；按 8–10 小时/周，整套通常要 24–30 周。每个实验的粗估工时见[作业与实验](labs.html#hours)。
