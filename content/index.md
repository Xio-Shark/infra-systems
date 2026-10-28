# 从分布式系统到 Agent OS

> 三门课，一条线：分布式系统 → 云原生与多容器 → Agent OS（探索课）。
>
> 核心实验在单机 Linux 或 WSL2 上完成：2 vCPU、4 GB 内存、20 GB 空闲磁盘；不需要 GPU、KVM 或多节点集群。

## 课程说明

Infra Systems 讨论同一个问题的三种场景：**多个程序如何共享资源、保持正确、失败后恢复**。

INFRA 01 把这些程序放到多台机器上：副本、任期、提交、线性一致。你读 MapReduce、GFS、Paxos、Raft、Spanner、Ray，写 MapReduce、KV、Raft、RSM、sharded KV。

INFRA 02 把它们放到一台机器上的多个容器里：namespace、cgroup、镜像、Pod、CNI、CSI、sidecar。你读 OCI/CNI/CSI 规范、Kubernetes 文档、Borg、Firecracker，做容器、Pod、网络、工作区事务。

INFRA 03 把这些程序换成 agent：它通过工具改变系统状态，但失败后不一定能回滚、权限不容易限制、行为不容易验证。你读 seL4、gVisor、AIOS、Saga，设计一组新的原子操作，把 agent 的操作交给内核执行。

> **INFRA 03 是探索课。** Agent OS 没有公认的标准，本页的操作表、原子性主张和系统结构都是研究性假设，不一定正确，也可能被更好的方案取代。课程要求你证明或推翻它们。

三门课共享三个问题：**谁在写？什么时候算完成？失败后看到什么？** 第一门课用副本回答，第二门课用容器和编排回答，第三门课用 capability 和事务回答。

## 课程

| 课程 | 名称 | 讲数 | 实验 | 先修 |
|---|---|---|---|---|
| INFRA 01 | [分布式系统](course-map.html) | 21 | 5 | Go、操作系统基础 |
| INFRA 02 | [云原生系统](cloud-native.html) | 14 | 5 | Linux/WSL2、C 或 Go |
| INFRA 03 | [Agent OS](agent-os.html) | 12 | 5 + capstone | INFRA 01 或同等基础 |

## 先修要求

- 会一门编译型语言。INFRA 01 用 Go；INFRA 02/03 用 Go 或 C。
- 知道进程、线程、锁、文件系统、socket；知道 syscall 是什么。
- 不需要先学完 OS 课；INFRA 03 需要你在 Linux 里动过 namespace、cgroup、mount。

## 环境

- 单机 Linux 或 WSL2（Ubuntu 24.04），2 vCPU、4 GB 内存、20 GB 空闲磁盘。
- 不需要 GPU、KVM、多节点集群。kind/k3s、CRIU、Firecracker、eBPF 都是可选进阶；核心实验只依赖 namespace、cgroup v2、overlayfs、seccomp、pidfd、veth、iptables。
- 内核实验在一次性环境里做；不要在生产机、共享服务器或带真实凭证的环境里做。
- 安装与检查：[Environment](setup.html)。

## 考核

自学版没有分数。完成一门课的标准：

- 实验通过验收测试；
- 能不看代码讲清楚机制、失败模式和测试在测什么；
- 能回答课程页的 design questions；
- 代码私有，不公开可直接复制的答案。

## 阅读

阅读以论文、白皮书和规范为主：MapReduce、GFS、Paxos、Raft、Spanner、Borg、Firecracker、gVisor、seL4、AIOS，以及 OCI、CNI、CSI 规范。每篇的定位和阅读重点见 [阅读](papers.html)。

## 课程规则

独立完成、代码私有、不抄答案；内核实验只在一次性的 VM/WSL2 里做；不使用真实凭证。详见 [Policies](rules.html)。

## 时间安排

| 周 | 课程 | 内容 |
|---|---|---|
| 1–6 | INFRA 01 | MapReduce → Raft → RSM → sharded KV |
| 7–10 | INFRA 02 | image → container → Pod → network/storage → capstone |
| 11–14 | INFRA 03 | isolation → transactions → snapshots → ABI → capstone |

按每周 8–10 小时设计；可以压缩或拉长。
