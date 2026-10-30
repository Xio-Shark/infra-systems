# AOS 验收脚本

INFRA 03 的五个实验都是人工验收：没有参考实现，也没有官方 grader。这里提供的是**契约测试**——它们只通过任务书里写明的 CLI 和文件系统观察，不 import 你的内部包，判定标准写在脚本里。

## 怎么用

每个实验的脚本放在 `starters/aos/<实验>/tests/`，复制到你的实验目录再用：

```bash
mkdir -p ~/labs/aos2 && cp -r starters/aos/aos2/tests ~/labs/aos2/
cd ~/labs/aos2 && ./tests/read-loop.sh --files 1 --iters 2000
```

脚本默认从当前目录找可执行文件（`./aos2`、`./aosctl` 等）；用 `AOS_BIN=` 覆盖：

```bash
AOS_BIN=~/labs/aos2/bin/aos2 ./tests/read-loop.sh
```

## 它们能证明什么、不能证明什么

**能**：契约层面的一致性——命令是否存在、退出码、输出字段、崩溃后的可判定状态、拒绝是否来自内核而不是脚本自己打印的假错误。

**不能**：证明你的实现设计正确，也不能替代任务书里的"能不看代码讲清楚"。这些脚本**没有**对着任何参考实现跑通过；它们是把任务书里的验收条款翻译成可执行断言。如果你发现断言和任务书不一致，以任务书为准，并在仓库提 issue。

## 约定

- 所有脚本 `set -uo pipefail`，失败时以非零退出，并打印 `FAIL <用例> <原因>`。
- 通过时打印 `OK <用例>`，最后一行汇总，例如 `summary ok=6 fail=0`。
- 需要 root 的用例会先检查 `id -u`，不满足时打印 `SKIP` 而不是假装通过。
- 脚本只用 POSIX shell 工具和 `python3`（解析 JSON）；不依赖 Go 或任何第三方包。
