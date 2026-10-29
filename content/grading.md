# 评分标准

## 分数构成

| 课程 | 自动评分 | 书面部分 | 通过条件 |
|---|---|---|---|
| INFRA 01 | 5 个实验，各 20 分 | 每个实验 300 字复盘 | 自动 100 分 + 复盘 |
| INFRA 02 | CN1 自动检查；CN2–CN5 按任务书验收 | CN5 故障报告 | 必做项通过 |
| INFRA 03 | 暂不提供自动评分；AOS1–Capstone 人工验收 | capstone 报告 | 必做项通过 |

## 怎么跑

在课程仓库根目录（含 `judge/`）：

```bash
git clone https://github.com/Xio-Shark/infra-systems.git
cd infra-systems
./judge/run.sh --list
LAB_ROOT=~/labs/6.5840 ./judge/run.sh infra01 lab1
```

`LAB_ROOT` 默认是 `~/labs/6.5840`；克隆到别处时显式指定。

INFRA 01 需要你本地的 6.5840 仓库：

```bash
LAB_ROOT=~/labs/6.5840 ./judge/run.sh infra01 lab3
```

INFRA 02 的 CN1 需要提交可执行文件和 rootfs：

```bash
SUBMISSION=~/labs/cn1/cn1 CN1_ROOTFS=~/labs/cn1-rootfs ./judge/run.sh infra02 cn1
```

没有实现或接口未冻结时，judge 显示 `SKIP`，不会假装通过。

`--quick` 只跑一小部分测试，是冒烟检查，最高 `PARTIAL`，不计为通过。`--json` 的退出码仍然是 0（全部 PASS）或 1（有 SKIP/PARTIAL/FAIL/ERROR）。

INFRA 01 的 `make` 目标默认带 `-race`（MIT Makefile 的 `RACE=-race`），judge 不额外加参数。

## 评分代码在哪

- `judge/courses/*.json`：实验列表、权重、超时。
- `judge/tests/<course>/<lab>.sh`：检查项，输出 `CHECK PASS/FAIL` 和 `SCORE`。
- `judge/contracts/`：提交接口。
- `judge/README.md`：怎么加一个实验。

评分规则和测试在 `judge/`；改测试等于改标准。

judge 是本地自测工具，不防作弊：`LAB_ROOT` 指向的 6.5840 Makefile/tester、`judge/tests/` 都能被修改。自动分只作为自检证据；课程通过条件里的“能讲清楚”和复盘不能由它验证。`--all` 是所有可自动检查实验的合计，不是单门课分数。

## 通过标准

- 必做项全部 PASS（`--quick` 不算）；
- INFRA 01 的 `make` 默认已带 `-race`；
- 能不看代码讲清楚机制、失败模式和每个测试在测什么；
- 每个实验写 300 字复盘，按[复盘模板](#reflection)；
- 代码私有，不公开可直接复制的答案。

## 复盘模板 {#reflection}

每个实验写 300 字，按下面五问作答，不要写成流水账：

1. 这个实验的核心不变量是什么？你最初误解了哪一条？
2. 你的设计做了哪些取舍？为什么选它，而不是更简单或更复杂的方案？
3. 哪个测试最先暴露问题？失败时的现象和根因是什么？
4. 你修了什么？有没有留下未解释的偶发失败或已知风险？
5. 如果把它放进多容器平台或 agent runtime，哪个假设会先失效？

自评三档：

- **合格**：五问都有具体答案，能引用测试或日志。
- **好**：能说清一个反例或边界，并给出下次会先写的测试。
- **不足**：只复述代码或测试输出，没有不变量、取舍和失败根因。

## 没有标准答案

实验页不给可直接复制的实现；judge 只检查可观察行为，不限制你的设计。

Agent OS 的接口还没冻结，评分标准会随接口调整；以任务书和 `judge/contracts/` 为准。
