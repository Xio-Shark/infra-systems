# 评分标准

## 分数构成

| 课程 | 自动评分 | 书面部分 | 通过条件 |
|---|---|---|---|
| INFRA 01 | 5 个 lab，各 20 分 | 每个 lab 300 字复盘 | 自动 100 分 + 复盘 |
| INFRA 02 | CN1 已可自动评分；其余按任务书验收 | CN5 故障报告 | 必做项通过 |
| INFRA 03 | 接口冻结后补 | capstone 报告 | 必做项通过 |

## 怎么跑

在仓库根目录：

```bash
./judge/run.sh --list
./judge/run.sh infra01 lab1
./judge/run.sh --all --quick
```

INFRA 01 需要你本地的 6.5840 仓库：

```bash
LAB_ROOT=~/labs/6.5840 ./judge/run.sh infra01 lab3
```

INFRA 02 的 CN1 需要提交可执行文件和 rootfs：

```bash
SUBMISSION=./cn1 CN1_ROOTFS=/path/to/rootfs ./judge/run.sh infra02 cn1
```

没有实现或接口未冻结时，judge 显示 `SKIP`，不会假装通过。

## 评分代码在哪

- `judge/courses/*.json`：lab 列表、权重、超时。
- `judge/tests/<course>/<lab>.sh`：检查项，输出 `CHECK PASS/FAIL` 和 `SCORE`。
- `judge/contracts/`：提交接口。
- `judge/README.md`：怎么加一个 lab。

评分规则和测试在 `judge/`；改测试等于改标准。

## 通过标准

- 必做项全部 PASS；
- INFRA 01 的 `make` 还要过 `-race`；
- 能不看代码讲清楚机制、失败模式和每个测试在测什么；
- 每个 lab 写 300 字复盘：问题、设计、失败模式、测试结果；
- 代码私有，不公开可直接复制的答案。

## 没有标准答案

lab 页不给可直接复制的实现；judge 只检查可观察行为，不限制你的设计。

Agent OS 的接口还没冻结，评分标准会随接口调整；以任务书和 `judge/contracts/` 为准。
