# AOS4 · Snapshot and restore

> **课程**：[INFRA 03 · Agent OS](agent-os.html) · **实验 4/5**
>
> **先读**：[第 7 讲](agent-os.html#aos7) · **验收**：人工验收，清单见下
>
> **参考**：[overlayfs 内核文档](https://docs.kernel.org/filesystems/overlayfs.html) · [cgroup v2](https://docs.kernel.org/admin-guide/cgroup-v2.html) · [`FICLONE`](https://man7.org/linux/man-pages/man2/ioctl_ficlone.2.html)
>
> [返回作业](labs.html) · [上一个：AOS3](aos3.html) · [下一个：AOS5](aos5.html)

## 你将完成什么

做完后，你会有一个能拍快照、切分支、原子恢复的 daemon，并且能说清楚一次“恢复”到底恢复了什么。最小验收是三条命令：

```bash
cd ~/labs/aos4
./aos4 snapshot create --workspace ws --id s1
./aos4 snapshot list --workspace ws
./aos4 snapshot restore --workspace ws --id s1
```

`create` 返回 `snapshot_id`、`parent`、`tree_sha256` 和 `gaps`；`list` 按创建顺序列出快照；`restore` 返回新的 `version` 和 `tree_sha256`。跑完后，`sha256sum` 的文件树要和快照记录一致，读旧版本的进程不会看到半个文件。

分清两种快照，比复制目录更重要：文件快照保存目录树、文件内容、权限和扩展属性；进程/内核状态快照保存地址空间、寄存器、fd 表、socket、cgroup 归属和时钟。前者便宜、可移植；后者昂贵、边界多。课程只要求把文件快照做对，进程快照作为选做，并且必须在报告里列出漏掉的状态。

## 开始之前

读[第 7 讲](agent-os.html#aos7)。第 7 讲给了三层快照和一致性窗口；这一页把它落到接口和测试。

环境检查：

```bash
uname -r
stat -fc %T /sys/fs/cgroup        # 期望 cgroup2fs
grep overlay /proc/filesystems    # 期望看到 nodev overlay
mkdir -p /tmp/aos4-probe && cd /tmp/aos4-probe
truncate -s 1G base.img
cp --reflink=always base.img clone.img && echo reflink-ok || echo reflink-unsupported
```

最后一行在 ext4 上通常输出 `reflink-unsupported`，在 btrfs 或开了 reflink 的 XFS 上输出 `reflink-ok`。前者走 overlayfs，后者走 `FICLONE`。

目录布局建议沿用 AOS1 的 daemon：

```text
~/labs/aos4/
  cmd/aosd/            # AOS1 daemon
  cmd/aos4/            # CLI
  internal/abi/        # 类型；本实验加 snapshot/restore/list
  internal/workspace/  # manifest、版本、原子切换
  internal/snapshot/   # 快照后端
  internal/freeze/     # freeze 与 events
  scripts/             # 分支、崩溃、一致性测试
```

请求字段不要改：`abi`、`op`、`idem`、`cap`、`args`、`deadline_ms`，回复仍是 `status`、`result`、`effects`、`evidence`。AOS2 的 `commit` 语义也不要改；快照叠在 commit 之上。

时间预算 8–14 小时。建议分配：文件快照 3 小时，原子恢复 2 小时，三分支 1 小时，一致快照 3 小时，边界报告 2 小时。

## 快照里有什么，没有什么

先把状态清单写出来，再写代码。下面这张表是本实验的核心交付物之一。

| 状态 | 文件快照 | 进程快照 | 说明 |
|---|---|---|---|
| 工作区文件、目录、权限、xattr、内容 hash | 有 | 有 | 文件快照的主体 |
| 进程地址空间、寄存器、线程 | 无 | 有 | `fork_context` 的 CoW 只覆盖用户态页 |
| fd 表、fd offset、flags | 无 | 有 | 文件快照只保存文件名，不保存“谁开着它” |
| socket、管道、epoll | 无 | 部分 | 外部 TCP 连接通常不能迁移 |
| cgroup 归属、资源限制 | 无 | 有 | 恢复后要重新放回 cgroup |
| 时钟、deadline、随机种子 | 无 | 部分 | `CLOCK_MONOTONIC` 不能跨恢复 |
| 租约、epoch、审计游标 | 无 | 无 | 属于外部协调状态，见 AOS5 |
| 已发出的 HTTP 请求、扣款、消息 | 无 | 无 | 只能靠事务日志和补偿 |

最后两行是“不能快照”的部分。文件快照恢复后，进程内存里的缓存、打开的 fd、socket 连接都还是旧的；agent 如果直接复用这些对象，会写到一个已经过期的世界里。恢复后要重新 `open` 工作区、重新建立连接、重新申请 lease，并把这一步写进 `restore` 的返回值和审计。

`fork_context` 常被当成“轻量快照”。`fork` 的 CoW 只共享用户态页；fd 表是复制引用，socket 仍是内核对象，cgroup 归属是继承，POSIX 定时器和进程 CPU 时钟不会继承。它适合分叉思考分支，不适合当崩溃恢复的检查点。

## 接口与数据流

最小接口：

```go
type Snapshot struct {
    ID           string    // s1, s2
    Parent       string    // 空表示从基线创建
    Kind         string    // "files" 或 "files+freeze"
    CreatedAt    time.Time
    TreeSHA256   string
    Gaps         []string  // 明确列出的未快照状态
}

CreateSnapshot(workspace, parent, kind string) (Snapshot, error)
Restore(workspace, id string) (version int, treeSHA256 string, err error)
List(workspace string) ([]Snapshot, error)
```

快照的状态机只有四步：

```text
open ──freeze──> frozen ──clone/fsync──> sealed ──thaw──> open
                     │
                     └──失败──> open（丢弃临时目录，不登记快照）
```

`restore` 的状态机是 `staging → verified → switched → old-retained`。`verified` 之前不能切换，`switched` 之后旧版本保留到没有读者为止。切换用 symlink 或 manifest 指针的 `rename` 完成。

一次一致快照的时序：

```text
agent        daemon              cgroup            fs
  │ snapshot   │                   │               │
  │───────────>│ write 1 freeze    │               │
  │            │──────────────────>│               │
  │            │ poll cgroup.events│               │
  │            │<──── frozen 1 ────│               │
  │            │ fsync files+dirs  │               │
  │            │──────────────────────────────────>│
  │            │ clone/reflink or new overlay      │
  │            │ write manifest + fsync             │
  │            │ write 0 thaw      │               │
  │<── snap id ─│                  │               │
```

看图注意两点：`frozen=1` 必须在 `fsync` 前；manifest 的 `fsync` 必须在返回前。少任何一个，崩溃后都可能出现“快照登记了，但内容没落盘”。

## 阶段拆解

### 阶段 1：先让文件快照可验证

只加记录 manifest 这件事。遍历工作区，对每个普通文件记录相对路径、大小、模式、`sha256`；对目录记录模式；把清单写成 `manifest.json`，再对文件树算 `tree_sha256`。快照本体可以先用普通复制，慢但正确。

跑：

```bash
cd ~/labs/aos4
./aos4 snapshot create --workspace ws --id s1
jq -r '.result.tree_sha256' /tmp/aos4/s1/reply.json
```

预期是一个 64 位十六进制串。通过标志：`manifest.json` 能独立重算出同一个 hash；删掉一个文件后 hash 必须变化。

### 阶段 2：把复制换成 overlayfs 或 reflink

换后端，不改接口。reflink 后端逐文件调用 `FICLONE`，失败回退普通复制并记入 `gaps`。overlayfs 后端快照的是 `upperdir`：把它复制或 reflink 成 `snapshots/<id>/upper`，lower 保持只读；恢复时复制成新 upper，快照不动。

注意 overlayfs 的限制：同一个 `upperdir` 或 `workdir` 不能被两个挂载同时使用，否则 `mount` 返回 `EBUSY`；`lowerdir` 可以是另一个 overlayfs，但 whiteout 和 `overlay.*` xattr 在嵌套时要转义。只复制 `upperdir` 时要保留 whiteout 和 xattr，否则重新挂到原 lower 上，删掉的文件会复活；压平 merged 视图会丢掉层关系。

跑：

```bash
./aos4 snapshot create --workspace ws --id s2 --parent s1
./aos4 snapshot list --workspace ws
```

预期 `s2` 的 `parent` 是 `s1`。通过标志：从 `s1` 恢复后改文件不影响 `s2`；`s2` 删掉的文件从 `s1` 恢复后仍在。

### 阶段 3：恢复要原子，读者不能看到半个版本

加“版本目录 + symlink 切换”。restore 用快照 upper 的副本挂成 `gen/N`，校验 manifest，再 `rename` 一个临时 symlink 到 `current`。旧版本目录保留，等读者关闭后再清理。

跑一个持续读的进程：

```bash
cd ~/labs/aos4
(while true; do cat ws/current/a.txt >> /tmp/reader.log 2>&1 || true; done) &
./aos4 snapshot restore --workspace ws --id s1
```

预期 `/tmp/reader.log` 里每一行都是完整内容，不出现半行。通过标志：恢复前后 `sha256sum` 与 `s1` 的 manifest 一致；读者进程没有 `ENOENT`。

### 阶段 4：做三个分支，证明互不污染

从同一个基线创建 `b1`、`b2`、`b3`，每个分支改不同文件，再各自 commit。只加“分支指针和 parent 链”，不加快照机制。

跑：

```bash
for b in b1 b2 b3; do ./aos4 snapshot create --workspace ws --id "$b" --parent base; done
./aos4 exec --workspace ws --branch b1 -- sh -c 'echo one > a.txt'
./aos4 exec --workspace ws --branch b2 -- sh -c 'echo two > b.txt'
./aos4 exec --workspace ws --branch b3 -- sh -c 'rm c.txt'
```

通过标志：三个分支的 manifest hash 两两不同；`b3` 删除的 `c.txt` 不出现在另外两个分支；从 `b2` 恢复不会带回 `b1` 的 `a.txt`。

### 阶段 5：一致快照，和“直接复制”对照

加 `cgroup.freeze`：写 `1`，轮询 `cgroup.events` 直到 `frozen 1`，`fsync` 文件和目录，拍快照，写 `0` 解冻。不要用 `sleep` 代替轮询。

对照实验：让一个 writer 持续写 1 MB 的文件，同时分别做“直接复制”和“freeze + fsync + 复制”。对每次复制出的文件算 hash，和 writer 记录的“每次写完的完整 hash”比对。

```bash
cd ~/labs/aos4
./scripts/torn-write.sh --mode direct --seconds 10
./scripts/torn-write.sh --mode freeze --seconds 10
```

预期 `direct` 至少出现一次 hash 不在完整集合里，`freeze` 一次都不出现。如果 `direct` 也没抓到，增大文件或延长运行时间，不要因此删掉这个测试。

### 阶段 6（选做）：进程快照的边界

用 CRIU 对一个只写文件的简单进程做 checkpoint/restore，重点不是跑通工具，而是填表：哪些 fd 恢复了，哪些 socket 没恢复，cgroup 归属要不要重建，进程还认为自己持有哪个 lease。CRIU 对网络、GPU、复杂 fd 的支持有限（具体范围随版本而异），失败写进 `gaps`。

## 验收清单

人工验收，提交时附命令记录和日志片段；每条都要可复现。

- [ ] 三个命令各一份 JSON 回复，字段完整。
- [ ] `restore` 后 `sha256sum` 与 manifest 一致，附 diff 为空。
- [ ] 三个分支 hash 两两不同，附 `list`。
- [ ] 一致快照日志里能看到 `frozen 1` 出现在 clone 之前，附 `cgroup.events` 前后两行。
- [ ] `direct` 对照至少有一次 torn write，或说明为什么在你的环境复现不了。
- [ ] 崩溃测试：在 snapshot 的 clone 后、manifest 写入前 `kill -9`，重启后 `list` 里没有半成品。
- [ ] `gaps` 字段列出至少 6 类未快照状态，报告里逐类解释。
- [ ] 300 字复盘：不变量、取舍、最先暴露问题的测试、已知风险。

## 常见错误

| 现象 | 原因 | 处理 |
|---|---|---|
| `mount` 返回 `EBUSY` | 同一个 `upperdir`/`workdir` 被两个 overlay 挂载使用 | 每次快照新建 upper/work，不复用 |
| `cp --reflink=always` 失败 | ext4 不支持 reflink，或跨文件系统 | 捕获错误回退普通复制，在 `gaps` 记录 |
| 快照 hash 对不上 | writer 还在跑，或漏了 `fsync` 目录 | 先确认 `frozen 1`，再 `fsync` 文件和父目录 |
| 恢复后删掉的文件又出现 | 只复制 upperdir，丢了 whiteout/xattr | 保留 whiteout 和 xattr，或用压平视图重建基线 |
| 读者偶发 `ENOENT` | restore 先删旧目录再建新目录 | 版本目录 + symlink 原子切换，旧版本延迟清理 |
| `restore` 后 agent 写旧 fd | 文件快照不含 fd，agent 复用了旧句柄 | 恢复后重新 `open`，把重连写进返回值 |
| `cgroup.events` 一直 `frozen 0` | 有进程在冻结竞态中 fork 或被迁移进来 | 轮询并设超时；必要时先停新请求再冻结 |
| 快照里有明文 token | 把整个环境或配置目录拍进去了 | 排除 secrets，或在 manifest 里只存 hash |

## 调试手册

先确认 overlay 挂在哪、用的是什么后端：

```bash
findmnt -T ~/labs/aos4/ws/current
mount | grep overlay
dmesg | tail -20
```

`findmnt` 的 `FSTYPE` 是 `overlay` 还是 `ext4`，决定了你该看 whiteout 还是 reflink。`dmesg` 里 `overlayfs:` 开头的行通常比应用层错误信息更直接。

reflink 是否生效，不要用 `du` 判断：它把共享块算到每个文件头上。用 `filefrag -v` 看 shared 标志，或比较 `df` 增量；不同 e2fsprogs 版本的输出格式随版本而异。

冻结是否完成，只看 `cgroup.events`：

```bash
cat /sys/fs/cgroup/aos4/ws/cgroup.events
# populated 1
# frozen 1
```

`populated` 表示还有活进程，`frozen` 表示冻结完成。轮询要设截止时间；冻结的进程仍可能被杀死或被移出 cgroup。

进程身份用 `pidfd`，不要用 PID。`pidfd_open` 拿到的 fd 在进程退出后变成可读，`poll` 能等到；`waitid(P_PIDFD)` 可以等子进程。PID 会被复用，日志里只写 PID，事后无法判断是哪个进程。

审计游标单独存：恢复时把最后一条事件的 `seq` 和 `hash` 写进 `restore` 的 `effects`。不要把审计日志一起回滚，否则恢复后的事件会覆盖真实历史。

## 提交前检查

- [ ] 三个后端路径都跑过：普通复制、reflink 或 overlayfs、freeze 版本。
- [ ] 崩溃注入点至少覆盖 clone 后、manifest 写入前、symlink 切换前。
- [ ] 没有残留的 overlay 挂载、临时版本目录和后台 writer。
- [ ] 报告里有一张“状态 → 是否快照 → 恢复后怎么办”的表。
- [ ] 能不看代码讲清楚：为什么文件快照和进程快照不是同一个瞬间。

## 自测问题

1. 文件快照恢复后，为什么不能直接复用 agent 进程里已有的 fd 和 socket？
2. `fork_context` 的 CoW 覆盖了哪些状态？哪些没有覆盖？
3. 为什么“先 freeze 再 snapshot”比“直接 copy”更一致？freeze 本身还漏了什么？
4. overlayfs 快照为什么要保留 whiteout？只复制 `upperdir` 会怎样？
5. reflink 的 `FICLONE` 对单个文件是原子的，为什么整个工作区仍然可能不一致？

### 答案要点

1. fd 指向的是旧 inode 和旧连接；恢复后文件可能已经换版本，socket 对端也可能已经断开。必须重新 `open`、重新连接、重新申请 lease。
2. 覆盖用户态页和页表；不覆盖 fd 表语义、socket、cgroup 归属、定时器、进程 CPU 时钟，也不覆盖其他线程。
3. freeze 让进程停在一致点，`fsync` 把已写数据落盘，快照才看到稳定状态。freeze 不覆盖外部副作用，也不保证没有 fork 竞态，所以要等 `frozen 1` 并处理超时。
4. whiteout 表示“这个文件被删了”；只复制 `upperdir` 而丢掉 whiteout，重新挂到原 lower 上时旧文件会复活。压平 merged 视图不复活文件，但丢层关系。
5. `FICLONE` 只保证单个文件在克隆瞬间一致；工作区有多个文件、目录和删除标记，跨文件的顺序仍然需要 freeze 或 manifest 来固定。
