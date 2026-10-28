# 术语表

> 按主题分组。英文是课程和论文里的原词，中文是帮助理解的解释，不一定是唯一译法。

## 分布式系统基础

| 英文 | 中文 | 解释 |
|---|---|---|
| distributed system | 分布式系统 | 多台机器通过网络协作，对用户像一个系统 |
| node / peer / server | 节点 / 对等体 / 服务器 | 参与协议的一个进程 |
| fault tolerance | 容错 | 部分组件坏了，系统仍能工作 |
| replication | 复制 | 把同一份状态放在多台机器上 |
| consistency | 一致性 | 多个副本对外的行为是否符合某种模型 |
| linearizability | 线性一致性 | 每个操作看起来在某个瞬间原子生效，且尊重实时顺序 |
| serializability | 可串行化 | 并发事务的结果等价于某个串行顺序 |
| consensus | 共识 | 多个节点对某个值达成一致 |
| quorum / majority | 多数派 | 超过一半的节点；任何两个多数派有交集 |
| leader election | 领导者选举 | 选一个节点负责协调 |
| log | 日志 | 有序的操作记录 |
| commit | 提交 | 一个日志条目被多数派持久化，不能再丢 |
| apply | 应用 | 把已提交的日志交给状态机执行 |
| state machine replication | 状态机复制 | 所有副本按同一顺序执行同一组命令 |
| RPC | 远程过程调用 | 像调用本地函数一样调用远端函数 |
| partition | 网络分区 | 网络被切成几块，块之间不能通信 |
| crash failure | 崩溃故障 | 节点停止工作，但不发错误消息 |
| Byzantine failure | 拜占庭故障 | 节点可能发错误/恶意消息 |
| idempotent | 幂等 | 执行一次和执行多次结果相同 |
| at-most-once | 最多一次 | 操作最多执行一次，可能没执行 |
| exactly-once | 恰好一次 | 操作恰好执行一次（通常需要去重状态） |
| fencing token | 栅栏令牌 | 单调递增的编号，用来拒绝旧 leader 的写 |
| lease | 租约 | 一段时间内有效的授权 |
| heartbeat | 心跳 | 定期发送的信号，证明自己还活着 |
| timeout | 超时 | 等不到响应就认为失败 |
| straggler | 慢节点 | 拖慢整个任务的节点 |
| tail latency | 尾延迟 | p99/p999 这类最慢请求的延迟 |

## Raft

| 英文 | 中文 | 解释 |
|---|---|---|
| term | 任期 | 单调递增的编号，一次选举一个 term |
| votedFor | 投票给谁 | 当前 term 投给了哪个 candidate |
| follower / candidate / leader | 跟随者 / 候选人 / 领导者 | Raft 的三种状态 |
| RequestVote | 请求投票 | 候选人拉票的 RPC |
| AppendEntries | 追加日志 | leader 复制日志/发心跳的 RPC |
| PrevLogIndex / PrevLogTerm | 前一条日志的索引/任期 | follower 用来检查日志连续性 |
| commitIndex | 提交索引 | 已知被多数派复制的最大 index |
| lastApplied | 已应用索引 | 已交给状态机的最大 index |
| nextIndex | 下一条索引 | leader 对每个 follower 维护 |
| matchIndex | 匹配索引 | 已知 follower 复制到的最大 index |
| election restriction | 选举限制 | 候选人日志必须至少和 voter 一样新 |
| log compaction | 日志压缩 | 用快照替换旧日志 |
| snapshot | 快照 | 某个 index 之前的状态序列化 |
| InstallSnapshot | 安装快照 | leader 把快照发给落后的 follower |
| Figure 8 | 图 8 | 论文里说明“不能直接提交旧 term entry”的例子 |

## Lab 1：MapReduce

| 英文 | 中文 | 解释 |
|---|---|---|
| coordinator | 协调者 | 原论文叫 master，负责分任务 |
| worker | 工作进程 | 执行 map/reduce |
| map task | map 任务 | 一个输入文件一个 |
| reduce task | reduce 任务 | 一个输出分区一个 |
| intermediate file | 中间文件 | `mr-X-Y` |
| partition | 分区 | `ihash(key) % nReduce` |
| atomic rename | 原子重命名 | `os.Rename`，避免留下写了一半的文件 |
| backup task | 备用任务 | 给慢任务再发一份 |

## Lab 2：KV / 锁

| 英文 | 中文 | 解释 |
|---|---|---|
| Clerk | 客户端库 | 封装 RPC 和重试 |
| version | 版本号 | 每次成功 Put 加 1 |
| ErrVersion | 版本不匹配 | Put 的 version 和服务端不一致 |
| ErrNoKey | key 不存在 | Get 或 Put 返回 |
| ErrMaybe | 结果未知 | 重发后收到 ErrVersion，可能执行了 |
| lock | 锁 | 用 KV 的 Put/Get 实现 |
| Acquire / Release | 获取 / 释放 | 锁的两个操作 |

## Lab 4/5

| 英文 | 中文 | 解释 |
|---|---|---|
| RSM | 复制状态机 | replicated state machine |
| shard | 分片 | 把 key 按范围分到不同组 |
| shard group | 分片组 | 负责一组 shard 的 Raft 集群 |
| configuration | 配置 | shard → shard group 的映射 |
| controller | 控制器 | 执行配置变更的客户端 |
| FreezeShard / InstallShard / DeleteShard | 冻结/安装/删除分片 | 迁移 shard 的三步 |
| ErrWrongGroup | 分片组不对 | 客户端找错了组 |

## 论文/课程里的系统

| 英文 | 中文 | 解释 |
|---|---|---|
| MapReduce | 映射归约 | 批处理编程模型 |
| GFS | Google 文件系统 | 大文件、chunkserver、lease |
| Paxos | Paxos | 共识算法 |
| ZooKeeper | ZooKeeper | 协调服务，znode/watch |
| Spanner | Spanner | 全球分布式 SQL，TrueTime |
| Chain Replication | 链式复制 | 主备链，强一致 |
| FaRM | FaRM | RDMA + OCC + 复制 |
| IronFleet | IronFleet | 机器验证的分布式系统 |
| Memcached | Memcached | 大规模缓存 |
| AWS Lambda | Lambda | Serverless |
| Ray | Ray | 分布式 Python |
| SUNDR | SUNDR | 不可信存储上的 fork consistency |
| Bitcoin | 比特币 | PoW + 最长链 |
| PBFT | 实用拜占庭容错 | 3f+1 个节点容忍 f 个拜占庭错误 |
| TrueTime | TrueTime | Spanner 的全局时间 API |
| 2PC | 两阶段提交 | 分布式事务的原子提交协议 |
| OCC | 乐观并发控制 | 先执行，提交时检查冲突 |
| MVCC | 多版本并发控制 | 用版本/时间戳做并发控制 |

## 云原生与容器

| 英文 | 中文 | 解释 |
|---|---|---|
| container | 容器 | 被 namespace/cgroup/rootfs 限制了视角的进程，不是轻量 VM |
| image | 镜像 | 一组只读层加配置，容器运行时用它拼出 rootfs |
| layer | 层 | 镜像的最小复用单位；多个镜像可以共享底层 |
| manifest | 清单 | 列出镜像的 config 和 layers；tag 最终指向它 |
| digest | 内容摘要 | 镜像层或配置的 hash；内容变了，digest 就变 |
| registry | 镜像仓库 | 存镜像的地方，如 Docker Hub、Harbor |
| multi-stage build | 多阶段构建 | 编译环境和运行环境分开，只把最后阶段的文件复制进最终镜像 |
| SBOM | 软件物料清单 | 列出镜像里有哪些包和版本 |
| SLSA | 供应链完整性等级 | 描述构建过程可信度的框架 |
| OCI | 开放容器倡议 | 镜像和运行时规范；runc、runsc、kata 都遵守 |
| container runtime | 容器运行时 | 真正创建 namespace/cgroup 并 exec 进程的组件 |
| runc | runc | 最常用的 OCI runtime；创建完容器后退出，由 shim 看住 |
| containerd | containerd | 管镜像、快照、容器的守护进程；kubelet 通过 CRI 调它 |
| CRI | 容器运行时接口 | kubelet 和运行时之间的 gRPC 接口 |
| shim | shim | 留在容器旁边的轻量进程；containerd 重启时容器不死 |
| pause container | pause 容器 | 持有 Pod network namespace 的沙箱容器 |
| Pod | Pod | Kubernetes 的最小调度单位；多容器共享 netns 和卷 |
| init container | 初始化容器 | 按顺序执行、必须成功退出的前置容器 |
| sidecar | 边车 | 和主容器同 Pod、共享网络/卷的辅助容器 |
| ephemeral container | 临时容器 | 用来调试的容器，不能加资源限制 |
| native sidecar | 原生边车 | 放在 initContainers 里但 `restartPolicy: Always` 的边车 |
| namespace | 命名空间 | 隔离 PID、mount、net、IPC、UTS、user、cgroup、time 的内核机制 |
| cgroup | 控制组 | 限制和统计 CPU、内存、I/O、进程数的内核机制 |
| cgroup v2 | cgroup v2 | 统一层级的 cgroup；`cpu.max`、`memory.max`、`cgroup.kill` |
| rootfs | 根文件系统 | 容器看到的 `/`；通常由镜像层 + 可写层组成 |
| pivot_root | 切换根 | 把进程根切到新挂载点，比 chroot 更彻底 |
| overlayfs | 联合文件系统 | 把多个只读层和一个可写层叠成一个视图 |
| copy-up | 写时复制 | overlayfs 第一次写只读层文件时，先复制到可写层 |
| whiteout | 删除标记 | overlayfs 里表示“这个文件被删了”的特殊标记 |
| veth pair | 虚拟网卡对 | 一头在容器 netns，一头在宿主 bridge 的成对网卡 |
| bridge | 网桥 | 把多个 veth 接到同一个二层域的虚拟交换机 |
| CNI | 容器网络接口 | 插件规范；ADD/DEL/CHECK 创建和清理 Pod 网络 |
| ClusterIP | 集群虚拟 IP | Service 的稳定 VIP；没有网卡持有，由 kube-proxy/eBPF 转发 |
| kube-proxy | kube-proxy | 实现 Service 的组件；iptables、IPVS 或 eBPF 模式 |
| CoreDNS | CoreDNS | 集群 DNS；Pod 的 `/etc/resolv.conf` 指向它 |
| headless Service | 无头 Service | 不分配 VIP，直接返回 Pod IP；StatefulSet 常用 |
| DNS | 域名系统 | 把服务名解析成 IP；`resolv.conf` 的 `search` 和 `ndots` 会影响延迟 |
| deadline | 截止时间 | 一个请求的总时间预算；应该跨服务传播 |
| jitter | 随机抖动 | 给重试和退避加随机量，避免所有客户端同时重试 |
| connection pool | 连接池 | 复用 TCP 连接，减少握手和 TLS 开销 |
| NetworkPolicy | 网络策略 | L3/L4 的标签选择器；默认拒绝需要显式配置 |
| PVC / PV | 持久卷声明/持久卷 | 用户申请存储和集群提供存储的抽象 |
| CSI | 容器存储接口 | 存储插件规范；负责 provision、attach、mount、snapshot |
| emptyDir | 临时卷 | 随 Pod 创建和删除的节点本地目录 |
| hostPath | 宿主路径 | 直接挂节点目录；危险但常用于系统组件 |
| requests | 资源请求 | 调度器预留的资源；决定 Pod 能调度到哪 |
| limits | 资源上限 | 运行时 cgroup 的上限；CPU 超了限流，内存超了 OOM |
| QoS | 服务质量 | Guaranteed、Burstable、BestEffort 三档驱逐优先级 |
| eviction | 驱逐 | 节点资源紧张时 kubelet 按 QoS 赶走 Pod |
| preemption | 抢占 | 高优先级 Pod 赶走低优先级 Pod，以便调度 |
| PSI | 压力停滞信息 | 内核暴露的 CPU/内存/I/O 压力指标 |
| RuntimeClass | 运行时类 | 选择 gVisor、Kata、Firecracker 等 sandbox runtime |
| gVisor | gVisor | 用户态实现 Linux 兼容内核的 sandbox runtime |
| Kata Containers | Kata | 用轻量 VM 跑容器的 runtime |
| Firecracker | Firecracker | AWS 的 microVM；启动快、内存开销小、支持快照 |
| service mesh | 服务网格 | 用 sidecar/节点代理做 mTLS、重试、超时、观测 |
| mTLS | 双向 TLS | 客户端和服务端互相验证证书 |
| SPIFFE | SPIFFE | 给工作负载发身份的标准；服务网格常用 |
| StatefulSet | 有状态副本集 | 给 Pod 稳定名字、网络标识和存储的控制器 |
| operator | 运维控制器 | 把运维知识写成 controller，watch 自定义资源并 reconcile |
| reconcile | 调和 | 比较期望状态和实际状态，幂等地推进到目标状态 |
| OOMKilled | 内存超限被杀 | 容器超过 `memory.max` 后被内核 OOM killer 杀掉 |
| terminationGracePeriodSeconds | 终止宽限期 | 发 SIGTERM 后等多久再 SIGKILL；默认 30 秒 |
| preStop | 终止前钩子 | 容器收到 SIGTERM 前执行的钩子；常用于摘流量、sleep |
| shareProcessNamespace | 共享进程命名空间 | 让 Pod 内容器看见彼此进程；默认关闭 |

## Agent OS 与内核

| 英文 | 中文 | 解释 |
|---|---|---|
| Agent OS | Agent 操作系统 | 给 agent 提供原子操作、能力、事务、审计的系统层；目前是探索方向，不是桌面 OS |
| syscall ABI | 系统调用二进制接口 | 操作表、参数类型、错误码、返回值；LLM 和内核的契约 |
| capability | 能力 | 不可伪造的权限句柄；可衰减、转交、撤销，替代路径字符串 |
| capability attenuation | 能力衰减 | 派生一个权限更小的子句柄，而不是复制全部权限 |
| ambient authority | 环境权限 | 进程默认继承的权限；agent 不应依赖它 |
| TOCTOU | 检查与使用竞态 | 检查路径和真正打开之间，攻击者换了 symlink |
| Landlock | Landlock | 让进程声明可访问路径的内核 LSM；不能被路径绕过 |
| seccomp | seccomp | 过滤系统调用的内核机制；减少攻击面，不是完整沙箱 |
| no_new_privs | 不提权 | 阻止 setuid/setgid 提权的进程标志 |
| user namespace | 用户命名空间 | 让容器里的 root 映射到宿主非特权 uid |
| pidfd | pidfd | 指向进程的文件描述符；无 race 地发信号/等待 |
| subreaper | 子进程收养者 | 收养孤儿进程并负责 wait 的进程 |
| cgroup.kill | 杀整个 cgroup | 一次杀掉 cgroup 里所有进程，比逐个 kill 可靠 |
| cgroup.freeze | 冻结 cgroup | 暂停 cgroup 内所有进程，用于一致快照 |
| O_TMPFILE | 匿名临时文件 | 创建没有名字的文件，写完再 link 到目标名 |
| renameat2 | 原子重命名扩展 | 支持 `RENAME_EXCHANGE`、`RENAME_NOREPLACE` |
| RENAME_EXCHANGE | 原子交换 | 原子地交换两个文件的名字 |
| directory fsync | 目录 fsync | 保证目录项（文件名、inode 链接）落盘 |
| reflink | 引用链接 | 文件系统级 CoW 复制；`FICLONE` ioctl |
| FICLONE | FICLONE | 把一个文件的内容以 CoW 方式克隆到另一个文件 |
| CRIU | CRIU | 用户态 checkpoint/restore 工具；保存进程和 fd 状态 |
| userfaultfd | 用户态缺页 | 把缺页处理交给用户态；用于快照、迁移、内存去重 |
| CoW | 写时复制 | 共享旧数据，写时才复制；快照和 fork 的基础 |
| checkpoint | 检查点 | 保存某一时刻的状态，之后可以恢复 |
| restore | 恢复 | 从检查点重建状态；注意外部副作用不可恢复 |
| intent log | 意图日志 | 先记录“要做什么”，再执行；崩溃后据此恢复 |
| commit point | 提交点 | 操作被认为是“已生效”的瞬间；之后不能回滚 |
| rollback | 回滚 | 撤销未提交的变更；不是所有副作用都能回滚 |
| compensation | 补偿 | 用另一个操作抵消已发生的副作用；可能失败 |
| saga | Saga | 把长事务拆成一组本地事务，每个配一个补偿 |
| idempotency key | 幂等键 | 绑定 agent/任务/工作区/操作序号的去重键 |
| indeterminate | 结果未知 | 超时/崩溃后不知道副作用有没有发生；不能盲重试 |
| outbox | 发件箱 | 把“要发的消息”和业务写放在同一个本地事务里 |
| epoch | 纪元 | 单调递增的所有权/配置版本；用于拒绝旧写 |
| split-brain | 脑裂 | 两个节点同时认为自己是 leader，可能双写 |
| audit log | 审计日志 | 追加写、可验证的系统事件记录；不是普通日志 |
| hash chain | 哈希链 | 每条事件包含前一条的 hash；篡改会被发现 |
| provenance | 来源追踪 | 记录数据/操作从哪来、经过谁、变成什么 |
| eBPF | eBPF | 在内核事件上跑沙箱程序；可观测、网络、安全 |
| tracepoint | 跟踪点 | 内核预定义的观测点；比 kprobe 稳定 |
| fanotify | fanotify | 监控文件系统访问的内核接口；有盲区 |
| inotify | inotify | 监控文件变更的接口；只告诉变了，不告诉谁改的 |
| seccomp user notification | seccomp 用户通知 | 把 syscall 拦截交给用户态 supervisor 决定 |
| microkernel | 微内核 | 只把 IPC、调度、内存放内核，其余在用户态 |
| unikernel | 单内核 | 应用和 OS 编成一个地址空间，适合单任务 |
| library OS | 库操作系统 | OS 作为库链接进应用，减少 syscall 边界 |
| microVM | 微虚拟机 | 轻量 VM；Firecracker 是代表，隔离强于容器 |
| WASM | WebAssembly | 沙箱字节码；能力模型清晰，适合纯计算工具 |
| seL4 | seL4 | 形式验证的微内核；capability 原生 |

## Go 相关

| 英文 | 中文 | 解释 |
|---|---|---|
| goroutine | 协程 | Go 的轻量线程 |
| channel | 通道 | goroutine 之间传消息 |
| mutex | 互斥锁 | `sync.Mutex` |
| condition variable | 条件变量 | `sync.Cond` |
| race detector | 竞态检测器 | `go test -race` |
| plugin | 插件 | `.so` 文件，动态加载 Map/Reduce |
| labrpc | 实验 RPC | 课程提供的模拟网络 RPC |
| labgob | 实验 gob | 课程提供的编码器，检查字段大小写 |
