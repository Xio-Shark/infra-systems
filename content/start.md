# 导引

## 第一次来

| 你想学 | 先看 | 第一个作业 | 评分 |
|---|---|---|---|
| 分布式、Go、Raft | [INFRA 01](course-map.html) | [Lab 1](lab1.html) | `./judge/run.sh infra01 lab1` |
| 容器、Kubernetes 底层 | [INFRA 02](cloud-native.html) | [CN1](cloud-native.html#lab-cn1) | `./judge/run.sh infra02 cn1` |
| agent 与内核（探索） | [INFRA 03](agent-os.html) | [AOS1](agent-os.html#lab-aos1) | 先按任务书自测 |

## 怎么用

讲义是主教材。每讲先讲问题和机制，读完讲义和 lab 页的任务书就能开始实验；论文、官方页面和规范是查细节的参考，不必先读。

## 每门课的第一步

- **INFRA 01**：读[第 1 讲 MapReduce](lectures.html#lec1)，打开 [Lab 1](lab1.html)，实现后跑 `LAB_ROOT=~/labs/6.5840 ./judge/run.sh infra01 lab1`。
- **INFRA 02**：读[第 1 讲 从进程到容器](cloud-native.html#cn1)，打开 [CN1](cloud-native.html#lab-cn1)，实现后跑 `SUBMISSION=./cn1 CN1_ROOTFS=/path ./judge/run.sh infra02 cn1`。
- **INFRA 03**：读[第 1 讲 从 shell 到 syscall](agent-os.html#aos1)，打开 [AOS1](agent-os.html#lab-aos1)，先按任务书的验收项自测。

## 作业、评分、参考

- **作业**：都在 [作业与实验](labs.html)。每个 lab 页顶部有“先读 / 参考 / 评分 / 上一个 / 下一个”。
- **评分**：见 [评分标准](grading.html)；测试和评分规则在仓库的 `judge/` 目录。
- **参考**：见 [阅读](papers.html)；论文标题和规范都可以点击跳转。
- **环境**：见 [环境](setup.html)；单机 Linux 或 WSL2 即可。

## 环境安全

内核实验在一次性 Linux/WSL2 环境里做；不要在生产机、共享服务器或带真实凭证的环境里做。
