# 导引

## 第一次来

| 你想学 | 先看 | 第一个实验 | 评分 |
|---|---|---|---|
| 分布式、Go、Raft | [INFRA 01](course-map.html) | [Lab 1](lab1.html) | `./judge/run.sh infra01 lab1` |
| 容器、Kubernetes 底层 | [INFRA 02](cloud-native.html) | [CN1](cn1.html) | `./judge/run.sh infra02 cn1` |
| agent 与内核（探索） | [INFRA 03](agent-os.html) | [AOS1](aos1.html) | 先按任务书自测 |

CN1 的评分命令需要两个环境变量：

```bash
SUBMISSION=~/labs/cn1/cn1 CN1_ROOTFS=~/labs/cn1-rootfs ./judge/run.sh infra02 cn1
```

没有设置时 judge 显示 `SKIP`，不会假装通过。

## 第 0 步：拿到课程仓库

```bash
git clone https://github.com/Xio-Shark/infra-systems.git
cd infra-systems
```

`judge/` 和全部任务书都在这里；6.5840 的实验代码在另一个目录（见[环境](setup.html)）。下面的 `./judge/run.sh` 都从这个目录运行。

## 怎么用

讲义是导读和实验索引。每讲先讲问题和机制，读完讲义和实验任务书就能开始实验。论文、官方页面和规范用来补完整论证，不必先读；做完实验后，至少读对应章节。

按什么顺序做、每个实验多难、时间不够时怎么砍，见[学习路径](path.html)。

## 每门课的第一步

- **INFRA 01**：读[第 1 讲 MapReduce](lectures.html#lec1)，打开 [Lab 1](lab1.html)，实现后跑 `LAB_ROOT=~/labs/6.5840 ./judge/run.sh infra01 lab1`。
- **INFRA 02**：读[第 1 讲 从进程到容器](cloud-native.html#cn1)，打开 [CN1](cn1.html)，实现后跑 `SUBMISSION=~/labs/cn1/cn1 CN1_ROOTFS=~/labs/cn1-rootfs ./judge/run.sh infra02 cn1`。
- **INFRA 03**：读[第 1 讲 从 shell 到 syscall](agent-os.html#aos1)，打开 [AOS1](aos1.html)，先按任务书的验收项自测。

## 实验、评分、参考

- **实验与作业**：都在 [作业与实验](labs.html)。每个实验页顶部有“先读 / 参考 / 评分 / 上一个 / 下一个”。
- **评分**：见 [评分标准](grading.html)；测试和评分规则在仓库的 `judge/` 目录。
- **参考**：见 [阅读](papers.html)；论文标题和规范都可以点击跳转。
- **环境**：见 [环境](setup.html)；INFRA 01 可以在 macOS 上做，INFRA 02/03 需要 Linux VM 或 WSL2。

## 环境安全

内核实验在一次性 Linux/WSL2 环境里做；不要在生产机、共享服务器或带真实凭证的环境里做。
