# CN4 · 工作区事务

> **课程**：[INFRA 02 · 云原生系统](cloud-native.html) · **实验 4/5**
>
> **先读**：[第 8 讲](cloud-native.html#cn8) · **验收**：人工验收，清单见下
>
> [返回作业](labs.html) · [上一个：CN3](cn3.html) · [下一个：CN5](cn5.html)
>
> **难度** ★★★ · **先修** CN1/CN2 + 第 8 讲 · **时间** 8–12 小时 · **最小通过** 单文件 commit/rollback；**完整通过** manifest + 崩溃恢复
>
> **和 AOS2 的关系**：CN4 和 [AOS2](aos2.html) 讲的是同一件事——多文件原子发布——但角度不同。CN4 从容器侧出发：多个容器共享一个 overlayfs 工作区，重点是 copy-up、whiteout 和"为什么换 mount 不能原子"。AOS2 从 agent 运行时出发：同一个工作区要被 agent 反复改写和回滚，重点转向 journal 状态机、冲突检测和外部副作用账本。两个都做是有意的，但**不要照着 CN4 抄一遍再交 AOS2**：提交点、恢复规则和验收项都不一样，报告里要写清你复用和重写了哪些部分。只打算做一门时，做 CN4（它更基础），AOS2 的阶段 5–6（冲突与副作用）可以当延伸阅读。

## 你将完成什么

多个容器共享一个工作区，一个写者改文件，其他读者读。读者要么看到上一版，要么看到新一版，看不到写了一半的文件；`commit` 把所有改动作为一个整体发布；`rollback` 丢掉未提交的改动；在任意一步 `kill -9`，重启后状态仍然确定。

验收用一个 `cn4` 命令跑：

```bash
cd ~/labs/cn4
sudo ./cn4 init --root /srv/ws
sudo ./cn4 begin
echo hello | sudo ./cn4 write notes/a.txt
sudo ./cn4 commit -m "first"
sudo ./cn4 status
```

预期最后一行：

```text
seq=1 state=committed files=1
```

然后 `sudo ./cn4 verify` 输出 `ok seq=1 files=1 deleted=0`。崩溃测试在阶段 3，反复杀进程后要 `recover` 后 `verify` 通过。

## 开始之前

先读[第 8 讲](cloud-native.html#cn8)。这一讲给了 POSIX 的原子替换顺序和 overlayfs 的 copy-up，实验把它落到一个能验收的工作区上。

环境检查：

```bash
uname -r                       # 建议 5.15 以上
grep overlay /proc/filesystems # 应看到 nodev overlay
id -u                          # 0；挂载需要 root 或等价 capability
```

macOS 不能直接做这个实验，用一台 Linux 虚拟机即可。不要在 Docker 容器里挂 overlay：upperdir 落在另一个 overlay 上通常会被拒绝，报 `invalid argument`（以实际行为为准）。

目录布局固定如下，后面命令都按它写：

```text
/srv/ws/
  versions/000001/        已提交基线，提交后设为只读
  current -> versions/000001
  txn/upper/              当前事务的可写层
  txn/work/               overlay 的 workdir，必须空且与 upper 同文件系统
  merged/                 写者看到的合并视图
  journal/txn.json        事务状态
```

时间预算 8–12 小时。前 2 小时手工敲 mount 和文件操作，先看清 inode 和目录项怎么变，再写状态机。

## 代码地图

没有骨架代码，目录和接口由你定，建议按职责拆开：

- `cmd/cn4/`：命令行入口，只做参数解析和退出码。
- `internal/layout/`：建目录、挂载、卸载、清理。
- `internal/txn/`、`internal/manifest/`、`internal/publish/`：状态机、清单、版本切换。
- `test/`：崩溃注入脚本和不变量检查。

验收只看 `cn4` 的外部行为，内部可以换实现。不要在 `versions/` 里直接改文件；临时文件也不要放到 `/tmp`，跨文件系统的 `rename` 会返回 `EXDEV`。

## 接口与数据流：overlayfs 给什么，不给什么

overlayfs 一次挂载有四个位置：

```text
lowerdir = /srv/ws/versions/000001   只读基线
upperdir = /srv/ws/txn/upper         本事务的写入和 whiteout
workdir  = /srv/ws/txn/work          内核内部使用，必须空
merged   = /srv/ws/merged            合并视图，写者从这里看
```

读一个文件时，upper 有就用 upper，没有就落到 lower。第一次写 lower 里的文件会触发 copy-up：内核把整个文件复制到 upper，再改副本。大文件第一次写会明显变慢，磁盘也可能瞬间多占一份空间。删除 lower 里的文件不会删原文件，upper 里会出现一个 0/0 的字符设备，叫 whiteout（白障）；删除整个目录会加 `trusted.overlay.opaque`。如果绕过 merged 直接打包 upper，不处理这两样，已删除的文件会在新基线里复活。

`workdir` 必须和 `upperdir` 同文件系统，挂载时必须是空目录，也不能和别的挂载共用。挂载失败先查这三条。挂载期间不要直接改 lower 或 upper；overlayfs 文档明确说底层目录被改动时行为未定义。所有写都走 merged，提交时也只读 merged。

关键的一点：**overlayfs 的挂载本身不能原子替换**。`mount` 和 `umount` 改的是挂载命名空间，已经打开的文件描述符继续指向旧 inode；`mount --move` 撞上已有挂载点通常会返回 `EBUSY`。所以原子性不能来自“换一个 mount”，只能来自一个可以原子改名的间接层。这里用版本目录加符号链接：

```text
current -> versions/000002
```

提交时新建一个临时符号链接，`rename` 到 `current`，再 `fsync` 所在目录。`rename` 在同一条文件系统内原子，读者解析 `current` 时要么拿到旧目标，要么拿到新目标。

另外，在 `merged` 里用 `rename` 覆盖 lower 里的同名文件时，内核可能先 copy-up，原子性依赖内核版本，以实际行为为准。

一次解析只保证一个路径。读者分两次打开 `current/a` 和 `current/b`，两次之间可能发生提交，于是读到跨版本的两个文件。要拿到一致快照，读者先 `open("current", O_DIRECTORY)` 拿到目录 fd，再用 `openat(dirfd, ...)` 读所有文件；目录 fd 把版本钉住，即使 `current` 随后改指向。

还有一条边界：读者各自挂载版本目录，`merged` 只给写者用。`commit` 换的是 `current`，已打开旧版本的读者继续看旧版；要让运行中的容器换版本，得重启或重新挂载。

## 提交的状态机

事务状态只有五个：

```text
IDLE --begin--> STAGING --commit--> COMMITTING --swap--> COMMITTED
                   |                     |
                   +--rollback--> ABORTED
COMMITTING --crash, current 仍指向旧版--> ABORTED
COMMITTING --crash, current 已指向新版--> COMMITTED
COMMITTED/ABORTED --cleanup--> IDLE
```

`journal/txn.json` 至少存 `txn`、`base`、`target`、`state`、`started`。恢复不重放日志，而是看事实：`current` 指向哪个版本，那个版本目录里的清单是否完整。指向新版且校验通过就算提交成功，否则丢弃 `target`、保留旧版。恢复因此是 level-triggered，不依赖“崩溃时执行到第几步”。rollback 先卸载 merged，只丢弃 upper 和未发布的 target，`current` 不动。

提交的顺序固定：

1. 拿写者锁，拒绝新的写请求。
2. 确认写者已停，所有临时文件都已 `rename` 并 `fsync`。
3. 从 merged 读可见文件，复制到 `versions/<target>/`，再生成清单。
4. 把清单写进 `versions/<target>/manifest.jsonl`，同样走临时文件、`fsync`、`rename`、`fsync` 目录。
5. 写 journal，`state=committing`，`fsync`。
6. 建 `current.tmp` 符号链接，`rename` 到 `current`，`fsync` 工作区根目录。
7. 写 `state=committed`，`fsync`，卸载 merged，丢弃 upper 和 work，准备下一个事务。

单文件发布也是同一套顺序：写临时文件，`fsync` 文件，`rename` 到目标名，`fsync` 父目录。`fsync` 文件保证数据和元数据落盘，`rename` 保证读者看不到半个文件，`fsync` 目录保证改名在崩溃后还在。少了最后一步，`rename` 返回成功也可能在断电后消失。

清单每行一个 JSON 对象，按路径排序：

```json
{"seq":2,"parent":1,"created":"2026-10-29T12:00:00Z"}
{"path":"notes/a.txt","type":"file","mode":"0644","size":6,"sha256":"..."}
{"path":"notes/old.txt","type":"deleted"}
```

路径必须是相对路径，拒绝 `..` 和重复项；`type` 至少覆盖 `file`、`dir`、`symlink`、`deleted`。`verify` 逐条检查存在性、大小和哈希，再确认 `deleted` 的路径确实不存在。

## 阶段 1：单文件先看到旧版或新版

先手工做一遍：

```bash
sudo mkdir -p /srv/ws/{versions/000001,txn/upper,txn/work,merged}
echo old | sudo tee /srv/ws/versions/000001/a.txt
sudo mount -t overlay overlay \
  -o lowerdir=/srv/ws/versions/000001,upperdir=/srv/ws/txn/upper,workdir=/srv/ws/txn/work \
  /srv/ws/merged
cat /srv/ws/merged/a.txt      # old
```

然后在 `merged` 里把 `new` 写进 `a.txt.tmp`，`fsync`，`mv` 成 `a.txt`，再 `fsync` 目录。另开终端循环 `cat merged/a.txt`，只应看到 `old` 或 `new`。

通过标志：循环 1000 次都只看到完整的 `old` 或 `new`。`stat` 能看到 `txn/upper/a.txt` 出现，lower 里的旧文件没变。

## 阶段 2：多文件作为一个版本

把三个文件放进一次提交，读者按上一节的规则拿目录 fd 读。读者循环打开 `current`，读 `a`、`b`、`c`，打印版本号；写者连续提交 200 次，每次三个文件同时改。

通过标志：三元组只出现全旧或全新。对每个文件单独 `open("current/a")`、`open("current/b")`，几乎一定会在某个时刻看到混合，这是间接层的边界。

再补两个用例：删掉的文件提交后不能复活；第二个写者提交时返回 `E_STALE_BASE`，不覆盖别人的提交。

## 阶段 3：在每个缝上杀一次

在代码里留一个环境变量 `CN4_CRASH_AT`，取值是提交步骤的名字：`after-fsync`、`after-rename`、`after-manifest`、`after-intent`、`after-swap`、`during-flatten`。到达该点时直接 `kill(getpid(), SIGKILL)`，不走 defer。

每个点跑一遍：

```bash
sudo CN4_CRASH_AT=after-intent ./cn4 commit -m crash
sudo ./cn4 recover
sudo ./cn4 verify
sudo ./cn4 status
```

通过标志：`recover` 退出码为 0；`verify` 通过；`status` 的 `state` 是 `committed` 或 `aborted`；`current` 指向崩溃前那个版本或新版本，不能指向不存在的目录。六个点各跑 3 次，结果要一致。

**`kill -9` 测不出 fsync。** SIGKILL 只杀进程，page cache 里的数据仍然由内核持有、迟早会写回磁盘，所以一个完全不调用 `fsync` 的实现也能通过上面六项——它测的是"进程崩溃后的恢复逻辑"，不是"掉电后的持久性"。这两件事要分开验证：

- **进程崩溃**：用上面的 `CN4_CRASH_AT` + `kill -9`，检查恢复逻辑和至少一次语义。这是 CN4 的主线，必须做。
- **掉电/内核崩溃**：需要让 page cache 真的丢掉。最省事的做法是把工作区放在 loop 设备上，用 `echo 1 > /proc/sys/vm/drop_caches` 之前先 `umount` 不了（还挂着），所以实际可用的做法是跑在 VM 里对 VM 执行 `virsh destroy`、或用 `dm-flakey`/`dm-log-writes` 制造有序掉电。没有这些条件时，退一步用 `strace -e trace=fsync,fdatasync,rename` 证明"每个 rename 之前都有对应文件的 fsync、之后都有父目录的 fsync"，把 strace 输出附在报告里，并注明"未做掉电测试"。

清单里只要求第一项；第二项做不到就如实写没做，不要用 `kill -9` 的结果冒充掉电测试的结果。

## 验收清单

- [ ] `init`、`begin`、`write`、`commit`、`rollback`、`status`、`verify`、`recover` 八个子命令都能用，退出码符合约定。
- [ ] 单文件循环 1000 次，读者没有看到半个文件。
- [ ] 多文件提交 200 次，持有目录 fd 的读者没有看到混合版本。
- [ ] 六个崩溃点各 3 次，`recover` 后 `verify` 全部通过。
- [ ] 用 `strace -e trace=fsync,fdatasync,rename` 证明每个 `rename` 前有文件 fsync、后有父目录 fsync；做了掉电测试的附结果，没做就写明。
- [ ] 两个写者冲突时返回 `E_STALE_BASE`，不静默覆盖。
- [ ] 退出时 `merged` 已卸载，没有残留的 overlay 挂载和临时文件。
- [ ] 能不看代码讲清 lower、upper、work、merged 各自的作用，以及为什么换 mount 做不到原子。
- [ ] 写了 300 字复盘：不变量、取舍、最先暴露问题的测试、遗留风险（模板见[评分标准](grading.html#reflection)）。

## 常见错误：现象、原因、处理

| 现象 | 原因 | 处理 |
|---|---|---|
| `mount: wrong fs type`，或 `overlay` 不在 `/proc/filesystems` | 内核没开 overlayfs，或在容器里 | 换 Linux 虚拟机或加载模块 |
| `mount: invalid argument` | workdir 不为空、与 upper 不同文件系统，或 upper 本身在 overlay 上 | 清空 workdir；把 upper 和 work 放到同一块盘 |
| 读者看到三个文件版本不一致 | 每个文件单独解析了 `current` | 先打开目录 fd，再 `openat` |
| 崩溃后文件是 0 字节 | `rename` 前没 `fsync` 文件 | 按“写、fsync 文件、rename、fsync 目录”重排 |
| 重启后新文件不见了，旧文件还在 | `rename` 后没 `fsync` 父目录 | 补目录 fsync；根目录也要 fsync |
| 提交后已删除的文件又出现 | 打包 upper 时没处理 whiteout 或 opaque | 遍历时识别 0/0 字符设备和 `trusted.overlay.opaque` |
| 两个写者互相覆盖 | 没有比较 `base` 和当前 `seq` | 提交前做比较交换，失败返回 `E_STALE_BASE` |

## 调试手册

先看挂载和 inode，再看代码。`findmnt -T /srv/ws/merged` 确认四个目录对不对；`stat -c '%i %h %n'` 对比 lower、upper、merged 里的同一个文件，能直接看出有没有 copy-up。whiteout 在 `ls -la` 里显示为 `c 0, 0`。

看系统调用顺序用：

```bash
sudo strace -f -e trace=openat,rename,renameat,fsync,unlink ./cn4 commit -m probe
```

正常顺序里，`fsync` 出现在 `rename` 之前，目录的 `fsync` 出现在 `rename` 之后。顺序反了，崩溃测试迟早会抓到。

只复现一个崩溃点，不要一次改多处。把 `CN4_CRASH_AT` 设成一个值，跑 `recover`，打印 `journal/txn.json`、`current` 的指向和 `versions/` 列表。三者对不上，先怀疑 journal 没 fsync，再怀疑 `current` 切换后没 fsync 根目录。

`dmesg` 里有 overlayfs warning 先处理，再调应用逻辑。清理残留：`sudo umount /srv/ws/merged`，删 `txn/upper` 和 `txn/work`，重建。

## 提交前检查

- [ ] 阶段 1 到 3 各连跑 3 次；有偶发失败就写清触发条件。
- [ ] 没有残留挂载、临时文件、后台进程。
- [ ] 文档写清“运行中的容器不会自动换版本”这个边界。
- [ ] 能回答下面的自测题，再写复盘。

## 自测问题

1. lower、upper、work、merged 各是什么？workdir 为什么必须为空，且和 upper 同文件系统？
2. 为什么不能靠重新 mount overlay 来发布新版本？
3. 为什么 `rename` 之前要 `fsync` 文件，之后要 `fsync` 目录？
4. 读者怎样保证三个文件属于同一版本？两次 `open` 会出什么问题？
5. 崩溃发生在 `current` 切换前后，恢复逻辑为什么可以一样？
6. whiteout 和 opaque 目录分别解决什么问题？不处理会怎样？

### 答案要点

1. lower 是只读基线，upper 存本事务的写入和 whiteout，work 是内核工作区，merged 是合并视图。work 必须空，避免混入上次挂载的状态；和 upper 同文件系统，内核才能用 rename 搬运文件。
2. mount 和 umount 改挂载命名空间，已打开的 fd 不跟着变，`mount --move` 遇到已有挂载点还 `EBUSY`。原子性只能放在能 rename 的指针上，即符号链接。
3. `fsync` 文件把数据和元数据刷下去，避免 rename 后指向一个没写完的 inode；`fsync` 目录把目录项改动持久化，否则崩溃后改名可能丢失。
4. 打开 `current` 一次拿到目录 fd，之后都用 `openat`。两次 `open("current/a")` 之间可能提交，第二次就落到新版本上。
5. 恢复看事实不看步骤：`current` 指向的版本完整就认提交，否则丢弃 target。两种崩溃走同一条判断。
6. whiteout 表示“这个 lower 文件被删了”，opaque 表示“这个目录不再向下合并”。不处理就会把删除的文件带回新基线，或者把旧目录内容混进来。
