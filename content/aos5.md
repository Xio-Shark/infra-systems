# AOS5 · Lease, fencing, audit

> **课程**：[INFRA 03 · Agent OS](agent-os.html) · **实验 5/5**
>
> **先读**：[第 9 讲](agent-os.html#aos9) · [第 10 讲](agent-os.html#aos10) · **验收**：人工验收，清单见下
>
> [返回作业](labs.html) · [上一个：AOS4](aos4.html) · [下一个：Capstone](aos-capstone.html)
>
> **难度** ★★★★ · **先修** AOS2/AOS3 · **时间** 10–16 小时 · **最小通过** lease + fencing；**完整通过** 双主拒绝 + 审计链 + 重放

## 你将完成什么

两个 agent 都认为自己是同一工作区的 owner，都开始写；最后写的赢，中间文件被覆盖，审计里两个人都说“我提交了”。这个实验要让你做出一个能拒绝这种写入的系统：租约（lease）负责授予一段时间的所有权，fencing token（栅栏令牌）负责让资源端拒绝过期的 owner，审计日志负责在事后回答“谁在什么时候写了什么”。

最小验收三条命令：

```bash
cd ~/labs/aos5
./aos5 lease acquire --resource ws --owner A --ttl 10s
./aos5 write --resource ws --epoch 1 --data x
./aos5 audit verify --log /tmp/aos5/audit.jsonl
```

第三条输出 `verified until seq=N`。核心场景：A 拿到 `epoch=1` 后被 `SIGSTOP` 暂停，租约过期，B 拿到 `epoch=2` 并写入；A 恢复后继续用 `epoch=1` 写，必须收到 `status: "fenced"` 和 `max_epoch: 2`。拒绝必须发生在存储端，不能靠 A 自己检查时间。

## CLI 契约 {#cli}

`tests/` 下的脚本只通过下面这些命令和你说话；参数名可以不同，语义必须一致。所有命令 stdout 是单行 JSON，成功退出 0。

| 命令 | 语义 |
|---|---|
| `aos5 lease acquire --resource R --owner O --ttl 2s` | 返回 `{"epoch":N}`；旧租约过期后发更大的 epoch |
| `aos5 lease state --resource R` | 返回 `{"max_epoch":N,"owner":…,"expires":…}`；`max_epoch` 是存储端持久化的值 |
| `aos5 lease renew --resource R --owner O --epoch N` | 续约；epoch 已过期返回 `expired` |
| `aos5 lease release --resource R --owner O --epoch N` | 主动释放 |
| `aos5 write --resource R --epoch N --data D` | 存储端比较 `epoch < max_epoch` 就返回 `fenced` + `max_epoch`，否则写入 |
| `aos5 audit verify --log FILE` | 从 `seq=1` 逐条校验 hash chain，输出 `verified until seq=N`，坏的第一条报 `seq=<n>` |
| `aos5 audit query --task T [--from N] [--limit N]` | 按 task 和 seq 范围过滤 |
| `aos5 audit replay --task T --workspace DIR` | 从事件流重建工作区 |

`write` 的失败信息必须带 `max_epoch`，调用方才能判断自己落后多少；`fence-stress.sh` 和 `dual-owner.sh` 都依赖这一点。审计日志的路径由 `--log` 指定，默认 `/tmp/aos5/audit.jsonl`。

## 开始之前

先读[第 9 讲](agent-os.html#aos9)和[第 10 讲](agent-os.html#aos10)。第 9 讲解释租约为什么需要单调 token；第 10 讲解释为什么 agent 自己写的日志不是证据。AOS2 的 commit 路径要已经能跑，AOS4 的快照可以选做。

环境检查：

```bash
uname -r
stat -fc %T /sys/fs/cgroup        # 期望 cgroup2fs
jq --version                      # 审计查询和测试脚本会用到
sha256sum --version | head -1
kill -STOP $$ && kill -CONT $$    # 确认能暂停自己，返回提示符即成功
```

最后一条会短暂暂停当前 shell。如果 `kill` 不可用，检查是否在受限容器里；本实验需要能发 `SIGSTOP`/`SIGCONT`。

目录布局沿用 AOS1 的 daemon：

```text
~/labs/aos5/
  cmd/aosd/            # AOS1 daemon
  cmd/aos5/            # CLI
  internal/lease/      # 租约、epoch 持久化
  internal/fence/      # max_epoch、写检查
  internal/audit/      # 追加写、hash chain、重放
  internal/workspace/  # AOS2 commit + fence
  tests/               # 双主、篡改、fence 压测（从 starters/aos/aos5/tests/ 复制）
```

不要改 AOS2 的 `rename` + `fsync` 顺序，也不要让客户端决定 `epoch` 是否有效。`epoch` 只能由租约服务发，检查只能由存储端做。审计 schema 在阶段 4 定下后不要改字段名。

时间预算 10–16 小时：租约 3 小时，fencing 3 小时，双主 2 小时，审计链 4 小时，重放和报告 3 小时。

## 租约、栅栏和审计的接口

租约字段不多，但每个都要有明确来源：

```go
type Lease struct {
    ID       string
    Resource string
    Owner    string
    Epoch    uint64        // fencing token，按 resource 单调递增
    TTL      time.Duration
    Expires  time.Time     // 租约服务的时钟，不是客户端时钟
}
```

对外暴露四个操作：

```text
Acquire(resource, owner, ttl) -> {lease_id, epoch, expires_at}
Renew(lease_id, epoch)        -> {expires_at} | {status: "expired"}
Release(lease_id, epoch)      -> {status: "ok"}
Write(resource, epoch, idem, data)
                              -> {status: "ok"|"fenced"|"conflict", max_epoch}
```

`Write` 是 `commit` 的替身，真实实现要把 `epoch` 带进 commit。`max_epoch` 必须和写原子更新：先读后写会给旧 owner 留窗口。可靠做法是单写者加锁，或把 `max_epoch` 写进同一条 WAL 记录。

租约的状态机：

```text
free --acquire--> granted --renew--> granted
granted --expire--> expired --acquire--> granted (epoch + 1)
granted --release--> free（epoch 不复用）
```

epoch 必须持久化，同一 resource 的 token 只能由一个权威来源递增。只存在内存里不够：进程崩溃重启，计数器回到 0，旧 owner 的 `epoch=1` 可能重新通过检查。每次授予前先把新 epoch `fsync` 到磁盘，再返回给 client。

双主场景的时序：

```text
A(epoch=1)   lease service      storage(max_epoch)      B
    │ acquire     │                    │                │
    │────────────>│                    │                │
    │<── epoch 1 ─│                    │                │
    │ write(1) ──────────────────────>│ max=1, ok      │
    │ SIGSTOP     │                    │                │
    │             │ 2s 后过期           │                │
    │             │<──── acquire ──────│────────────────│
    │             │──── epoch 2 ──────>│                │
    │             │                    │<── write(2) ───│
    │             │                    │ max=2, ok      │
    │ SIGCONT     │                    │                │
    │ write(1) ──────────────────────>│ REJECT fenced  │
```

看图时只盯一列：`storage.max_epoch`。租约服务说“过期了”不算数，A 自己说“我还没过期”也不算数；只有存储端比较 token 并拒绝，旧 owner 才真的写不进去。

把 A/B 双主场景走一遍：

<div class="anim" data-anim="aos-lease">
<p class="anim-fallback">这个动画需要 JavaScript；正文的步骤说明仍然完整。</p>
</div>

审计记录建议用下面的字段，顺序固定：

```text
seq, ts, actor, task, op, args_hash, result, epoch, prev_hash, hash
h_i = SHA-256(h_{i-1} || canonical(event_i)), h_0 = 32 个零字节
```

`canonical` 要固定键顺序、数字格式和空白；不要对“重新序列化后的 JSON”算 hash，要对实际写入的字节算。日志追加写，`fsync` 之后再向调用方确认。hash chain 能发现中间某条被改、被删或被插入；它不能发现末尾截断、整份替换，也不能证明“某件事没有发生”。要发现截断，得把链头 hash 定期写到外部存储或控制台，作为锚点。

## 阶段拆解

### 阶段 1：先让租约可过期、可续约

实现三个租约操作，不接工作区。TTL 用服务端单调时钟算，客户端时间只用于显示。过期可以惰性处理：`Acquire` 时发现旧租约过期就发新 epoch；不要依赖后台扫描的及时性。

跑：

```bash
cd ~/labs/aos5
./aos5 lease acquire --resource ws --owner A --ttl 2s
sleep 3
./aos5 lease acquire --resource ws --owner B --ttl 2s
```

预期第二次的 `epoch` 比第一次大 1。通过标志：`Renew` 用旧 epoch 返回 `expired`；`Release` 后立刻 `Acquire` 拿到更大的 epoch；杀掉租约服务再启动，下一个 epoch 仍然更大。

### 阶段 2：把 fencing 放进写路径

加一件事：存储端持久化 `max_epoch`，每次写先比较 `epoch < max_epoch` 就拒绝，否则更新 `max_epoch` 并写数据。检查必须在 commit 的临界区里，不能先查再写、中间放开锁。

跑一个直接构造的旧 token：

```bash
./aos5 write --resource ws --epoch 1 --data old
./aos5 write --resource ws --epoch 2 --data new
./aos5 write --resource ws --epoch 1 --data stale
```

预期第三条返回 `fenced`，文件内容是 `new`。通过标志：`max_epoch` 在重启后不回退；两条并发写不会都成功；失败信息里带 `max_epoch`，调用方能判断自己落后了多少。

### 阶段 3：用 SIGSTOP 模拟 GC pause

写一个双进程脚本：A acquire 后进入循环写；主进程 `kill -STOP A`，等 TTL 过去，让 B acquire 并写；`kill -CONT A`，收集 A 的下一次写结果。

```bash
cd ~/labs/aos5
./tests/dual-owner.sh --ttl 2s --pause 3s --iterations 20
```

预期 20 次里 A 的恢复写全部是 `fenced`，B 的写全部成功，最终文件内容是 B 的值。通过标志：日志里能按时间对齐 `A stop`、`lease expire`、`B acquire epoch 2`、`A write rejected`；没有一次出现 A 覆盖 B。

租约过期不等于旧 owner 停止运行。A 可能被 GC 暂停、被调度器饿死、被 `SIGSTOP`、或者网络分区；恢复后它仍以为自己持有租约。TTL 只能让服务端把所有权给别人，不能阻止 A 继续发写请求；只有资源端检查 fencing token 才能拒绝。

### 阶段 4：追加写审计日志和 hash chain

只加审计，不改租约和 fence。每条事件一行 JSON；写入用 `O_APPEND`，单写者或文件锁保证顺序；`fsync` 后再返回。记录成功、失败和被拒绝的写，`fenced` 也要进日志，否则事后看不出旧 owner 试过。

跑篡改测试：

```bash
./tests/tamper.sh --log /tmp/aos5/audit.jsonl --mode middle
./tests/tamper.sh --log /tmp/aos5/audit.jsonl --mode delete
./tests/tamper.sh --log /tmp/aos5/audit.jsonl --mode truncate
```

预期 `middle` 和 `delete` 在第一个坏掉的 `seq` 处失败；`truncate` 默认仍然通过。这不是 bug，是 hash chain 的边界；报告里要写清楚，并给出锚点方案：每次启动把当前链头写到另一个只追加的文件，或打印到不可修改的 CI 日志。

### 阶段 5：查询、重放和锚点

加 `audit.query` 和 `replay`。查询按 `task`、`seq` 范围过滤，返回前先验证链；重放从事件流重建工作区的关键步骤，比如 `commit` 的文件 hash 集合，再和当时的 manifest 比对。非确定性操作（时间、随机数、外部 API）要记录结果，重放时读记录，不要重新执行。

跑：

```bash
./aos5 audit query --task demo-42 --from 1 --limit 100
./aos5 audit replay --task demo-42 --workspace /tmp/aos5/replay
sha256sum /tmp/aos5/replay/* | sort > /tmp/aos5/replay.sha
diff /tmp/aos5/expected.sha /tmp/aos5/replay.sha
```

预期 `diff` 为空。通过标志：删掉中间一条事件后重放失败；改掉一条事件的 `result` 后 `verify` 在对应 `seq` 报错；重放不会重复执行已经完成的副作用。

## 验收清单

人工验收，提交时附命令记录、日志片段和失败注入点。仓库 `starters/aos/aos5/tests/` 有三个脚本可直接跑：`dual-owner.sh`（暂停旧 owner）、`tamper.sh`（改/删/截断日志）、`fence-stress.sh`（并发写压测）。复制到 `~/labs/aos5/tests/` 再用。

- [ ] `Acquire/Renew/Release` 的正常、过期、重启三种路径各一份输出。
- [ ] 租约服务 `kill -9` 重启后，下一个 `epoch` 严格大于重启前，附两次 `Acquire` 输出。
- [ ] 旧 epoch 写入返回 `fenced`，并带 `max_epoch`，附文件内容证明没被覆盖。
- [ ] 双主脚本 20 次全部通过，附时间对齐的日志摘要。
- [ ] `audit verify` 对正常日志输出 `verified until seq=N`。
- [ ] 中间篡改和删除各被定位到 `seq`；尾部截断的行为被明确记录为未检测。
- [ ] 重放后的文件 hash 与当时 manifest 一致，附 `diff` 为空。
- [ ] 300 字复盘：不变量、取舍、最先暴露问题的测试、已知风险。

## 常见错误

| 现象 | 原因 | 处理 |
|---|---|---|
| 租约过期后旧 owner 还能写 | 只在租约服务检查，存储端没检查 token | 把 `epoch` 带进 commit，在临界区比较 `max_epoch` |
| 两个 owner 同时写成功 | 检查与写之间有窗口，或 `max_epoch` 没持久化 | 单写者加锁，或把 `max_epoch` 和写放进同一条 WAL 记录 |
| 重启后 epoch 变小 | 计数器只在内存里 | 授予前 `fsync` 新 epoch；启动时读回计数器并与存储端取大者 |
| `audit verify` 对正常日志也失败 | JSON 键顺序或数字格式不稳定 | 对实际字节算 hash，固定 canonical 编码 |
| 改了中间一条却验证通过 | 验证从中间开始，或跳过了 `prev_hash` | 从 `seq=1` 逐条验证，检查 `seq` 连续 |
| 截断尾部没被发现 | hash chain 本身不防截断 | 把链头写到外部锚点；在报告里声明边界 |
| 审计日志里有 token | 直接记录了原始参数 | 只记 `args_hash` 和长度，敏感字段脱敏 |
| 旧 owner 偶发写成功 | TTL 太短或 `SIGSTOP` 没生效 | 先确认进程状态是 `T`，TTL 至少 2 秒，重复 20 次 |

## 调试手册

租约日志要同时写 `now_mono`、`expires_mono`、`epoch`、`owner`。TTL 只用服务端单调时钟算，wall clock 只给人看；两者对不上，才能判断是续约太晚还是时钟跳变。

`SIGSTOP` 是否生效，看进程状态：

```bash
kill -STOP "$pid"
cat /proc/"$pid"/status | grep '^State:'
# State: T (stopped)
kill -CONT "$pid"
```

状态不是 `T`，后面的场景就没有意义。恢复后先看写请求有没有到存储端；没到是客户端问题，到了却被接受才是 fencing 的 bug。

fencing 的竞态用压力测试抓：

```bash
./tests/fence-stress.sh --writers 8 --iterations 1000 --jitter 5ms
```

脚本让多个 writer 交错写，检查 `max_epoch` 单调不减、每个成功写的 epoch 不小于当时的最大值；读取 `max_epoch` 用 `./aos5 lease state --resource RES`（返回 `{"max_epoch":N}`），所以这个子命令也要实现。出现回退，先查更新是不是在锁外。

验证脚本要独立于写入代码：按行读，检查 `seq` 连续，逐条重算 `hash`，再把链头和锚点比对。只算最后一条无法定位第一个坏 `seq`。

重放失败先分两类：事件流不完整，看 `seq` 缺口；重放不确定，把时间、随机数和外部返回值记进事件，重放时只读不执行。

## 提交前检查

- [ ] 租约、fence、audit 三层各自有独立测试，不依赖 UI 或模型。
- [ ] 双主脚本重复 20 次，没有一次旧 owner 写成功。
- [ ] 审计日志的 `fsync` 策略和性能代价写进报告。
- [ ] 明确写出 hash chain 不能证明什么，以及锚点补了什么。
- [ ] 没有把真实 token 或用户数据写进日志。

## 自测问题

1. 租约过期后，旧 owner 为什么还能继续发写请求？谁来拒绝？
2. fencing token 为什么必须按 resource 单调递增并持久化？只保证“每次加一”够不够？
3. 检查 `epoch` 和写入为什么必须在同一个临界区？分开会留下什么窗口？
4. hash chain 能发现哪类篡改？不能发现哪类？锚点补上了哪一部分？
5. 重放一次任务时，哪些事件不能重新执行？应该记录什么？

### 答案要点

1. 过期只是服务端的判断，旧 owner 可能被暂停、分区或还没收到通知；它恢复后仍会写。必须由存储端比较 token 并拒绝。
2. 不持久化，服务重启后 token 会回退，旧 owner 的写可能重新变成“最大”；多个 issuer 各自发号，也可能发出相同或乱序的 token。
3. 分开会出现“检查时最大是 1，写入时新 owner 已经拿到 2”的窗口，旧写会覆盖新写。检查和更新 `max_epoch` 必须和写数据一起原子完成。
4. 能发现中间条目的修改、删除和插入；不能发现末尾截断、整份日志替换，也不能证明没记录的事件不存在。锚点把链头固定到外部，补上截断检测。
5. 外部 API 调用、发消息、扣款、创建资源都不能重放；要记录请求 ID、响应和幂等键，重放时读记录或查幂等表。
