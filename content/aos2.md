# AOS2 · Workspace transaction

> **课程**：[INFRA 03 · Agent OS](agent-os.html) · **实验 2/5**
>
> **先读**：[第 4 讲](agent-os.html#aos4)、[第 6 讲](agent-os.html#aos6) · **验收**：人工验收，清单见下
>
> [返回作业](labs.html) · [上一个：AOS1](aos1.html) · [下一个：AOS3](aos3.html)
>
> **难度** ★★★ · **先修** AOS1 · **时间** 10–16 小时 · **最小通过** 单文件 commit/rollback；**完整通过** manifest + journal + 崩溃恢复

## 你将完成什么

这个实验要让一组文件变更要么整体可见，要么完全不可见，并且在进程被杀、机器重启之后仍然说得清处于哪个版本。你会做一个 `aos2` CLI 和一个库：工作区（workspace）按代（generation）保存，每次提交产生一个不可变的新代，`current` 符号链接原子地指向它。读者只认符号链接解析出的那个目录，所以不会读到一半新一半旧。

验收有四组。第一组是读者：循环读 100 个写着 `gen=N` 的文件，跑 2000 轮，输出必须是 `torn=0 mixed=0`。第二组是崩溃：在每个提交阶段 `kill -9`，重启后 `recover`，`status` 只能报旧版本或新版本，不能混合；`recover` 连跑两次结果相同。第三组是回滚：整棵树的 sha256 与目标版本一致。第四组是副作用：外部调用超时返回 `indeterminate`，账本查得到它是否生效；回滚报告要列出不可回滚项，不能只说 `complete`。

跑通的样子：

```bash
cd ~/labs/aos2
./aos2 commit --ws ws --base 0 --put src/main.go=incoming/main.go
```

```json
{"status":"ok","result":{"version":1,"generation":"gen/1","tree_sha256":"9c1f0a2b3c4d5e6f7a8b9c0d1e2f3a4b"},"effects":[],"evidence":"audit:2201"}
```

## 开始之前

先读第 4 讲和第 6 讲。第 4 讲给你 `rename`、`fsync`、`O_TMPFILE` 的边界，第 6 讲给你 intent、commit、rollback、`indeterminate` 的状态机。

环境检查：

```bash
stat -fc %T ~/labs/aos2/ws                 # ext2/ext3、xfs 或 btrfs
stat -c '%d %n' ~/labs/aos2/ws ~/labs/aos2/ws/.staging
# 两行设备号相同
go version                                 # go1.22 或更新
```

ext4 会显示成 `ext2/ext3`，这是魔数命名，不是文件系统类型错误。暂存目录必须和工作区在同一个文件系统；放到 `/tmp`（常常是 tmpfs）会让 `rename` 跨设备失败。不要用 overlayfs 起步，先把目录和 rename 的语义做对。

目录布局：

```text
~/labs/aos2/
├── cmd/aos2/              # init/commit/rollback/status/recover
├── internal/ws/           # manifest、generation、原子发布
├── internal/txn/          # 状态机、journal、恢复
├── internal/effects/      # 副作用账本与补偿
├── testdata/fake-api/     # 本地 HTTP：charge/refund/lookup/send
└── tests/                 # 读者循环、崩溃矩阵，不改
```

时间预算 10–16 小时。建议顺序：单文件原子替换 2 小时，多代与 manifest 3 小时，journal 与恢复 5 小时，回滚与冲突 2 小时，副作用账本 2 小时。

## 代码地图

`internal/ws/publish.go` 负责建新代、`fsync` 整棵树、切换 `current`；`manifest.go` 定义 manifest 结构和读写。`internal/txn/state.go` 是状态机，`journal.go` 追加写记录，`recover.go` 在启动时重放。`internal/effects/ledger.go` 记录每个外部副作用的状态和补偿入口。CLI 只解析参数、发请求、打印 JSON，不直接改文件。

`tests/` 是验收标准，不能改。读者循环和崩溃矩阵只通过 CLI 和文件系统观察，不 import 你的包。

## 接口与数据流

一次提交的目录结构是这样：

```text
ws/
├── gen/0/                     # 基线，只读
├── gen/1/                     # 新代，完整文件树
├── gen/1/.manifest            # 文件列表、hash、父代
├── current -> gen/1           # 唯一切换点
├── .staging/                  # 本次变更的临时文件
├── txn/<id>/journal.jsonl     # 状态机日志
└── manifest.lock              # 写者互斥
```

提交分六步：

1. 写者拿 `flock(manifest.lock)`，读当前版本并与 `base` 比较。
2. 写一条 `intent` 记录并 `fsync` journal，记下基线版本、变更列表和副作用列表。
3. 用硬链接或复制把未变的文件放进 `gen/N`，把暂存的新文件写进去，逐个 `fsync`，写 `.manifest` 并 `fsync`，再 `fsync` 代目录。
4. 追加 `prepared` 并 `fsync`。
5. `rename` 一个临时符号链接覆盖 `current`，再 `fsync` 工作区目录。
6. 追加 `committed` 并 `fsync`，释放锁。

```text
intent ──stage──> prepared ──switch──> committed
   │                  │                    │
   └──abort──> aborted└──crash──> recover ─┘
```

看两件事：提交点是 `current` 的 `rename`，不是 `committed` 记录；崩溃后从最后一条 journal 记录决定往前还是往后走。

把六个步骤和两个崩溃点连起来看：

<div class="anim" data-anim="workspace-tx">
<p class="anim-fallback">这个动画需要 JavaScript；正文的步骤说明仍然完整。</p>
</div>

状态机落到文件，每一行都要能重放：

```go
type TxnState string
const (
    StateIntent    TxnState = "intent"
    StatePrepared  TxnState = "prepared"
    StateCommitted TxnState = "committed"
    StateAborted   TxnState = "aborted"
)

type JournalRecord struct {
    Seq         int      `json:"seq"`
    State       TxnState `json:"state"`
    Base        int      `json:"base"`
    Generation  string   `json:"generation,omitempty"`
    ManifestSHA string   `json:"manifest_sha,omitempty"`
    At          time.Time `json:"at"`
}

type Manifest struct {
    Version        int         `json:"version"`
    Generation     string      `json:"generation"`
    Parent         int         `json:"parent"`
    RolledBackFrom int         `json:"rolled_back_from,omitempty"`
    Files          []FileEntry `json:"files"`
    TreeSHA256     string      `json:"tree_sha256"`
}
type FileEntry struct {
    Path   string `json:"path"`
    SHA256 string `json:"sha256"`
    Mode   uint32 `json:"mode"`
    Size   int64  `json:"size"`
}
```

恢复规则要写死。判断顺序是先看 `current` 指向的代是否完整，再看 journal。最后一条是 `intent`，说明还没准备好，删掉未完成的代和暂存，回到基线。最后一条是 `prepared` 且 `gen/N/.manifest` 的 hash 对得上，可以选择继续切换或放弃，两种都合法，但要固定一种并写进报告；默认放弃更保守。

`current` 已经指向 `gen/N` 但 journal 没有 `committed`，说明崩溃发生在切换之后、记账之前，恢复时补记 `committed`，不要回滚。`committed` 记录必须在切换并 `fsync` 之后写，顺序反了，恢复就会相信一个没有真正生效的提交。

读者协议同样重要。读者打开 `current` 一次，用 `O_PATH|O_DIRECTORY` 拿到目录 fd，之后所有文件都用 `openat(curfd, "src/main.go")` 相对这个 fd 打开。每次读文件都重新解析 `current`，会在两次打开之间跨过提交，看到混合版本。旧代不能立刻删；用引用计数或宽限期，至少等读者关闭目录 fd 再回收，否则读者会拿到 `ENOENT`。

副作用单独记账，和文件变更放在同一个 intent 里：

```go
type Effect struct {
    ID       string `json:"id"`
    Kind     string `json:"kind"`     // http、message、cloud
    Target   string `json:"target"`
    Idem     string `json:"idem"`
    Rollback string `json:"rollback"` // none、compensate、irreversible
    State    string `json:"state"`    // pending、confirmed、failed、indeterminate
}
```

超时不是失败，是 `indeterminate`。恢复时先按 `idem` 查账本和外部系统的 `lookup`，确认生效就补 `confirmed`，确认没生效才重试。补偿不是撤销：退款是另一笔交易，可能失败；邮件和 webhook 发出去就收不回。回滚报告分三栏写：已丢弃的文件变更、已补偿的副作用、不可回滚的副作用。

## 阶段拆解

阶段 1 做单文件原子替换。在目标目录里写临时文件，`fsync` 文件，`rename` 成目标名，`fsync` 目录。跑 `./tests/read-loop.sh --files 1 --iters 2000`，预期 `torn=0`。如果出现半行，检查是不是用了 `O_TRUNC` 原地写。

阶段 2 加代和 manifest。每次提交建一个新目录，未变文件硬链接过去，新文件写进去；`current` 用 `rename` 切换。读者循环读 100 个文件，每轮只解析一次 `current`。跑 `./tests/read-loop.sh --files 100 --iters 500`，预期 `mixed=0`，并且每轮的 `gen=` 全部相同。

阶段 3 加 journal 和恢复。按上面的六步写记录，每次写入后 `fsync`。用 build tag `crashinject` 提供 `AOS2_CRASH_AT=after_intent|after_stage|after_prepared|before_switch|after_switch`，测试脚本在这些点发 `kill -9`。跑 `./tests/crash-matrix.sh`，每行输出 `case=before_switch state=old mixed=0` 这样的结果；再跑一次 `recover`，输出不变。

阶段 4 加回滚。提交前的回滚就是丢弃暂存和未完成的代，返回基线版本。提交后的回滚产生一个新版本，树内容等于目标版本，manifest 里记 `rolled_back_from`；历史不改写，版本号继续递增。跑 `./tests/rollback.sh`，预期 `tree_match=true`，并且 `status` 显示新版本号。

阶段 5 加冲突检测。写者持 `flock` 串行化提交，切换前再比较一次当前版本与 `base`；不等就返回 `conflict`，带上 `current_version`。两个写者同时提交同一基线，只能有一个成功。跑 `./tests/conflict.sh`，预期 `ok=1 conflict=1 lost_update=0`。

阶段 6 加副作用账本。`testdata/fake-api` 提供 `charge`、`refund`、`lookup`、`send` 四个端点；`charge` 在注入延迟时让客户端超时。跑 `./tests/effects.sh`，预期 `indeterminate=1 compensated=1 irreversible=1`，回滚报告里三栏都有内容。

## 验收清单

没有 judge，人工验收。提交 `evidence/`，每个用例一个子目录，包含 `cmd.txt`、`out.txt`、`state/`（manifest、journal、树 hash）和 `notes.md`。清单：

- [ ] `read-loop` 输出 `torn=0 mixed=0`，证据里有 2000 轮日志。
- [ ] `crash-matrix` 每个崩溃点都是 `old` 或 `new`，没有 `mixed`；`recover` 连跑两次输出相同。
- [ ] 回滚后整棵树的 sha256 等于目标版本，报告写明这是新版本。
- [ ] 并发提交只有一个成功，失败方拿到 `conflict` 和 `current_version`。
- [ ] 超时的外部调用记为 `indeterminate`，恢复后能通过 `lookup` 定论。
- [ ] 回滚报告列出不可回滚的副作用，不只写 `complete`。
- [ ] 版本比较只含内容 hash、mode、size，不含 atime。
- [ ] 300 字复盘，按[评分标准](grading.html#reflection)的五问。

## 常见错误

| 现象 | 原因 | 处理 |
|---|---|---|
| 读者看到半行或半个文件 | 原地写目标文件，或没 `fsync` 就 `rename` | 写临时文件，`fsync` 后 `rename`；读者只读已发布的代 |
| 同一轮读到两个 `gen` | 读者每个文件都重新解析 `current` | 解析一次，持有目录 fd；旧代延迟回收 |
| `rename: EXDEV` | 暂存目录和工作区不在同一个文件系统 | 把暂存放到 `ws/.staging`；不要用 `/tmp` |
| 崩溃后出现半个代 | 文件或目录没 `fsync`，或先切 `current` 再写完 | 所有文件、manifest、代目录都 `fsync`；切换是最后一步 |
| 回滚后 hash 不匹配 | 删除没记录，或从错误父代复制 | manifest 记录完整文件列表；回滚按目标代重建 |
| 两个写者都提交成功 | 没加写锁，或检查版本与切换之间有窗口 | 写者持 `flock` 覆盖准备到切换 |
| 大量假冲突 | 把 atime 或目录 mtime 算进版本 | 只比较内容 hash、mode、size |
| 恢复后外部扣款发生两次 | 重试前没查幂等账本 | 先 `lookup(idem)`，确认未生效才重试 |

## 调试手册

先跑单个用例并留日志：`./tests/crash-matrix.sh --case before_switch 2>&1 | tee /tmp/aos2-crash.log`。看最后 40 行，确认崩溃点、恢复后的版本和 `mixed` 计数。

文件操作看 `strace`：

```bash
strace -f -e trace=openat,rename,renameat2,fsync,flock,unlink,rmdir \
  -o /tmp/aos2.strace ./aos2 commit --ws ws --base 0 --put a.txt=staging/a.txt
```

`rename` 之前必须有对临时文件和父目录的 `fsync`；`rename` 之后必须有对 `ws` 目录的 `fsync`。看不到目录 `fsync`，崩溃矩阵里的“半个代”就不是偶发。

看目录 fd 和旧代：`ls -l /proc/<reader>/fd`，被回收的旧代路径会显示 `(deleted)`；`cat /proc/<reader>/fdinfo/<fd>` 能看偏移和 flags。读者报 `ENOENT`，先查回收。

看 journal：`jq -c . ws/txn/*/journal.jsonl`。状态序列必须是 `intent → prepared → committed`，或者以 `aborted` 结束。`aos2 status --ws ws` 应打印当前版本、代目录和 journal 最后一条。审计里的 txn id 要和 journal 对上，对不上说明有人绕过 CLI 改了工作区。

并发用 `flock -n ws/manifest.lock -c 'sleep 5' &` 占住锁，再启动一次提交，确认它等待而不是并行写。`kill -9` 只测进程崩溃，页缓存还在，测不出掉电时的写顺序；要测掉电语义，用虚拟机里的 `dm-flakey` 或直接 reset，课程不强制，但报告要写清你测到哪一层。

## 提交前检查

- [ ] 读者零撕裂、零混合，证据里有 2000 轮日志。
- [ ] 崩溃矩阵覆盖五个注入点，每行都是 `old` 或 `new`。
- [ ] `recover` 幂等，连续两次输出一致。
- [ ] 回滚后的树 hash 等于目标版本，报告说明版本号为什么增加。
- [ ] 冲突返回 `conflict` 和 `current_version`，没有丢失更新。
- [ ] 副作用账本完整，不可回滚项在报告里单独列出。
- [ ] 没有把 atime、目录 mtime 纳入版本比较。
- [ ] 300 字复盘写完。

## 自测问题

1. 多文件提交的线性化点在哪？为什么不是最后一个文件的 `rename`？
2. 为什么 `committed` 记录写在切换之后？崩溃在切换和记账之间怎么办？
3. 回滚一个已经提交的事务，为什么产生新版本，而不是把版本号改回去？
4. 哪些副作用不能回滚？补偿和撤销差在哪？
5. `kill -9` 能证明 `fsync` 的写顺序正确吗？
6. 读者为什么要持有代目录的 fd，而不是每次打开 `current`？

### 答案要点

1. 在 `current` 的原子切换。多个文件各自 `rename` 时，读者可能看到一部分新、一部分旧；只有切换那一刻整棵树才换版本。
2. 切换才是提交点，记录只是证据。崩溃在两者之间时，`current` 已指向新代，恢复应补记 `committed`，不能回滚。
3. 历史不可改写，已经读过的读者和已经留下的证据都指向旧版本；回滚是“用新版本表达旧内容”，外部副作用也不会因此消失。
4. 已发出的邮件、webhook、扣款、云资源、网络包都收不回；补偿是做另一笔操作抵消，可能失败，也可能不完美。
5. 不能。`kill -9` 只杀进程，页缓存和磁盘顺序仍在；要测写顺序得模拟掉电或块设备故障。
6. 重新解析 `current` 会在两次打开之间跨过提交；持有目录 fd 相当于固定了一个快照。
