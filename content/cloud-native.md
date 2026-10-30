# INFRA 02 · 云原生系统

> 14 讲 · 5 个实验 · Linux/WSL2
>
> 核心实验在单机 Linux 或 WSL2 上完成：2 vCPU、4 GB 内存、20 GB 磁盘；不需要 GPU、KVM 或多节点集群。

## 课程说明

云原生很容易学成一套 YAML 语法：`kubectl apply`、`Deployment`、`Service`、`Ingress`。但真正的事故很少出在 YAML 写错，而是出在**多容器**的边界上。比如 init container 没跑完，app 就起来了；sidecar 没退出，Pod 卡在 Terminating；两个容器写同一个 volume，读到一个写了一半的文件；一个容器 OOM 让整个 Pod 进入重启/失败状态；Service 的 VIP 能通，但 sidecar 里的 DNS 不通。

这些问题的共同点是：**多个进程共享一部分资源，但各自的生命周期、权限、资源配额和观测视角不同**。Kubernetes 用 Pod 把“必须一起调度、共享网络和卷”的容器绑在一起，但没有替你想清楚生命周期、信号、文件原子性和故障隔离。这门课逐个讨论这些边界。

十四讲按“从进程到集群”的顺序展开：namespace/cgroup/rootfs → OCI/CRI → 镜像/供应链 → Pod → 生命周期 → 网络 → 服务通信 → 存储 → 调度 → 隔离 → sidecar → 有状态 → 可观测性 → capstone。核心实验不需要 Kubernetes；kind/k3s 是可选进阶。

## 难度曲线

- **CN1**（★★）：namespace、rootfs、cgroup；先跑通一个隔离 shell。
- **CN2**（★★★）：Pod 生命周期和信号；开始处理多进程。
- **CN3**（★★★★）：网络最陡；先手工 veth/bridge，再写 CNI。
- **CN4**（★★★）：工作区原子性；比 CN3 低一档，是 capstone 前的缓冲。
- **CN5**（★★★★★）：组合、混沌测试和故障报告；不要提前开。

完整顺序、最小路径和时间安排见[学习路径](path.html)。

## 怎么开始

1. 读 [第 1 讲 从进程到容器](#cn1) 和 [第 2 讲 容器运行时](#cn2)。
2. 打开 [CN1 任务书](#lab-cn1)，先做一个隔离 shell。
3. 准备 rootfs 和实现后，跑 `SUBMISSION=~/labs/cn1/cn1 CN1_ROOTFS=~/labs/cn1-rootfs ./judge/run.sh infra02 cn1`。
4. 延伸参考（可选）：[OCI Runtime Spec](papers.html)、[`namespaces(7)`](https://man7.org/linux/man-pages/man7/namespaces.7.html)、[cgroup v2 文档](papers.html) 和 [runc 的 `libcontainer`](https://github.com/opencontainers/runc/tree/main/libcontainer)。讲义已经覆盖 CN1 所需的概念。

CN1 是本课程原创的实验：MIT 6.5840 只有五个实验（MapReduce、KV server、Raft、RSM KV、sharded KV），没有容器实验，所以这里没有官方页可以对照，验收标准完全由本仓库的 `judge/contracts/infra02.md` 定义。

作业总览在 [作业与实验](labs.html)；评分标准在 [评分标准](grading.html)。

## 先修要求

- 会 Linux 基本命令，知道进程、文件、socket。
- 会 Go 或 C；能读 RFC/规范。
- 最好做过 INFRA 01 的 Lab 1–2，但不是硬性要求。

## 课程安排

| # | 主题 | 关键问题 | 实验 |
|---|---|---|---|
| 1 | From process to container | 容器到底是什么？ | [CN1](cn1.html) |
| 2 | Runtime and CRI | 谁持有 netns、stdio、僵尸进程？ | [CN1](cn1.html) |
| 3 | Images and supply chain | 为什么 tag 不能保证镜像内容？ | [CN1](cn1.html) |
| 4 | Pod | 为什么 Pod 是最小调度单位？ | [CN2](cn2.html) |
| 5 | Lifecycle and signals | 为什么 Pod 会卡在 Terminating？ | [CN2](cn2.html) |
| 6 | Networking | Pod 如何拿到 IP、访问 Service？ | [CN3](cn3.html) |
| 7 | Service communication | 重试为什么会放大故障？ | [CN3](cn3.html) |
| 8 | Storage | 多文件工作区如何原子提交？ | [CN4](cn4.html) |
| 9 | Scheduling and resources | requests/limits 与 throttling 的关系？ | [CN5](cn5.html) |
| 10 | Isolation and security | 什么时候容器才是安全边界？ | [CN5](cn5.html) |
| 11 | Sidecar and service mesh | 透明代理的代价是什么？ | [CN3](cn3.html) |
| 12 | Stateful multi-container | 谁是 leader，怎么 fence？ | [CN5](cn5.html) |
| 13 | Observability and performance | p99 从哪里来？ | [CN5](cn5.html) |
| 14 | Capstone | 坏了能不能解释？ | [CN5](cn5.html) |

## 实验一览

| # | 实验 | 交付物 | 环境 |
|---|---|---|---|
| CN1 | Build a container from scratch | 隔离 shell + cgroup 内存限制 | Linux/WSL2 |
| CN2 | Mini Pod lifecycle | pause/init/app/sidecar + 信号 | Linux/WSL2 |
| CN3 | CNI and Service | veth/bridge/NAT/DNAT；可选：DNS、超时与重试 | Linux/WSL2；网络受限时用 VM |
| CN4 | Workspace transaction | overlayfs commit/rollback + 崩溃测试 | Linux/WSL2 |
| CN5 | Capstone | 迷你多容器平台 + 混沌测试 | Linux/WSL2 |

## 设计问题

1. Kubernetes 为什么把 Pod 而不是 container 作为调度单位？如果只调度容器，会失去什么？
2. Sidecar 给你 mTLS、重试、指标，但多一次跳转和一套生命周期。什么场景下不值得？设计一个“不用 sidecar 更好”的例子。
3. `ReadWriteOnce` 是卷的访问模式，不是文件锁。设计一个多容器协议，在没有分布式文件系统的情况下做到多文件原子更新。
4. 节点有空闲 CPU，但 Pod 一直 Pending。列出所有可能原因，并区分哪些是调度、哪些是 cgroup、哪些是镜像/网络。
5. 为“长时间运行的 agent 工具”设计一个多容器运行时。你会改 Pod 生命周期、资源计费、可观测性中的哪些部分？
6. 镜像 tag、digest、签名和 SBOM 各自能保证什么？设计一条从源码到运行的供应链，指出其中最弱的一环。
7. 一个服务有 3 个副本，客户端超时 1 秒、失败后重试 2 次。下游变慢时会发生什么？画出请求量和延迟的变化。

## 环境

- 单机 Linux 或 WSL2（Ubuntu 24.04），2 vCPU、4 GB 内存、20 GB 磁盘。
- 核心实验只依赖 namespace、cgroup v2、overlayfs、veth、iptables；不需要 Kubernetes。
- kind/k3s 可选；如果 WSL2 的网络限制影响 CN3，用一台 Linux VM。
- 不需要 GPU、KVM、多节点集群。

## 考核

- CN1 通过本地 judge；其他实验按验收标准自测；CN5 附一份故障报告。
- 能不看代码讲清楚多容器的生命周期、共享资源、失败模式。
- 回答至少 3 个 design questions；代码私有。

## 阅读

[阅读](papers.html) 有论文、白皮书和规范的定位；重点读 OCI Image/Runtime Spec、CNI/CSI Spec、Kubernetes Pod Lifecycle 文档、Borg、Firecracker。

以下是 14 讲的讲义，按课程顺序排列。

## 第 1 讲：从进程到容器 {#cn1}

用一句话说：容器不是轻量虚拟机，而是一个被 namespace 改了视角、被 cgroup 限了资源、被换了根目录的普通进程。

### 第一次 docker run 看到的三个假象

第一次运行 `docker run -it ubuntu bash`，很容易把它当成一台小虚拟机。它启动得比 VM 快，`ps` 里只有自己的进程，文件系统看起来也是独立的，退出后写下的文件全部消失。

这三个现象分别来自三样东西。`ps` 看不到宿主进程，是因为 PID namespace；文件系统独立，是因为 mount namespace 加了一层新的根目录；资源看起来“够用”，是因为 cgroup 给了它一份配额。它们都没有换内核：容器里的 `uname -r` 和宿主一样，系统调用还是由同一个内核执行。

### namespace：把“看得见什么”改掉

Linux 的 namespace 有八种：PID、mount、network、IPC、UTS、user、cgroup、time。和容器最相关的是前五种。

- **PID namespace**：容器里的进程有自己的一套 PID，1 号是容器里的 init 或主进程；宿主上看到的还是普通 PID。
- **mount namespace**：每个 namespace 有一张独立的挂载表，容器可以把镜像的根目录挂成 `/`，不影响宿主。
- **network namespace**：独立的网卡、路由表、端口空间；容器里的 `lo` 默认是 down 的，要手动 `ip link set lo up`。
- **IPC namespace**：独立的 System V IPC 和 POSIX 消息队列。
- **UTS namespace**：独立的 hostname 和 domain name。

`clone(2)` 或 `unshare(2)` 创建这些 namespace；`/proc/<pid>/ns/` 可以看到一个进程属于哪些 namespace。只创建 PID namespace 还不够：容器里的 `/proc` 仍然是宿主的，`ps` 会看到宿主进程。必须在新 mount namespace 里重新挂一个 `proc`，视图才对。

### cgroup：把“能用多少”改掉

cgroup v2 负责资源，不负责隔离。`cpu.max` 限制 CPU 带宽，格式是“配额/周期”；`memory.max` 是硬上限，超过就触发 OOM kill；`memory.high` 是软上限，超过会被限流而不是直接杀；`pids.max` 限制进程数；`io.max` 限制块设备 I/O。

cgroup 是树状的：一个 cgroup 下的所有进程共享配额，子 cgroup 可以再分。容器运行时通常给每个容器建一个 cgroup，Pod 再建一层父 cgroup。要把进程放进某个 cgroup，写 `cgroup.procs`，不是 `tasks`；v2 里没有 `tasks`。父 cgroup 要先在 `cgroup.subtree_control` 里打开对应控制器，子组才能设上限。

### rootfs：把“根在哪”改掉

镜像是一组只读层，运行时用 overlayfs 把它们叠起来，再加一个可写层。`pivot_root(2)` 把进程的根切到新目录，比 `chroot` 更彻底；但 `pivot_root` 要求新根是一个挂载点，而且要把旧根移走。切换前通常要把 `/` 的 mount propagation 设成 private，避免挂载事件传回宿主。

切完根还要挂 `/proc`、`/sys`、`/dev`。少了 `/proc`，`ps`、`free` 和很多程序会出问题；少了 `/dev/null`、`/dev/zero`，shell 重定向就会失败。一个最小 rootfs 至少要有 `/bin/sh`、几个常用命令和这些目录。

### 容器不是安全边界

容器共享宿主内核。内核漏洞、错误配置的 capability、挂载了 Docker socket、以 privileged 运行，都可以逃逸。namespace 和 cgroup 解决的是“看见什么、用多少”，不是“能不能攻破内核”。后面第 10 讲会展开。

**多容器视角**：Pod 里的容器默认各自有 PID、mount namespace，但共享 network namespace 和卷。共享网络意味着它们用同一个 IP、同一组端口；共享卷意味着它们能看到同一批文件。这两条是后面所有多容器问题的根源。

### 和实验的关系

CN1 用 `clone`/`unshare` 从零做一个容器：先建 namespace、挂 `/proc`、`pivot_root` 进最小 rootfs，再加 cgroup 内存限制，最后按 judge 的契约检查退出码、stderr、hostname 和残留 namespace。

### 检查一下自己

1. 为什么容器里的 `ps` 看不到宿主进程？只建 PID namespace 够吗？
2. `memory.high` 和 `memory.max` 的行为有什么不同？
3. `pivot_root` 和 `chroot` 的区别是什么？为什么容器运行时更常用前者？

### 答案要点

1. 不够；还要在新 mount namespace 里重新挂 `/proc`，否则 `/proc` 仍是宿主视图。
2. `memory.high` 超过后限流、让进程变慢；`memory.max` 超过后触发 OOM kill。
3. `chroot` 只改根目录，进程仍可能保留旧根的引用并逃出；`pivot_root` 换掉整个挂载树的根，要求新根是挂载点，隔离更彻底。

**依据**：`namespaces(7)`、`clone(2)`、`pivot_root(2)`、cgroup v2 内核文档、OCI Runtime Spec；CN1 任务书（本课程原创，非 MIT 6.5840 实验）。

## 第 2 讲：谁真正持有容器进程 {#cn2}

用一句话说：kubelet 只发指令，containerd 管镜像和元数据，shim 陪容器活到最后，runc 建完进程就退出。

### 升级 containerd 的那个晚上

节点升级 containerd，`systemctl restart containerd` 之后，`kubectl get pods` 里的 Pod 一个都没重启，业务没有抖。运维松了口气，第二天却在节点上看到几百个 `<defunct>` 进程，`crictl ps` 的容器数也和 kubelet 的记录对不上。要解释这两件事，得先分清这条链上每个进程各自负责什么。

### 四个角色，不是一个守护进程

kubelet 通过容器运行时接口（Container Runtime Interface，CRI）的 gRPC 调 containerd：`RunPodSandbox` 建沙箱，`CreateContainer` 和 `StartContainer` 起业务容器，`StopContainer` 和 `RemoveContainer` 收尾。containerd 管镜像、快照（snapshot）、容器元数据，但不亲自创建进程；它调用符合 OCI Runtime Spec 的运行时，比如 runc。runc 只做一次活：建 namespace、设 cgroup、`pivot_root`、`execve`，然后退出。

真正长期活着的是 shim（containerd-shim）。每个容器一个 shim，它是容器进程的父进程，持有 stdio 管道、记录退出码、回收僵尸。containerd 重启时 shim 还在，容器也就还在；新的 containerd 通过 shim 的 socket 重新接上。`kubectl logs` 能读到容器输出，也是因为 shim 一直握着 stdout 和 stderr 的读端。

pause 容器（pause container）是另一件事。CRI 的沙箱在实现上就是一个 pause 容器，它不跑业务，主要持有 Pod 的 network namespace。业务容器启动时通过 `setns` 加入这个 netns，于是共享 IP、端口和路由表。谁持有 netns，谁就是 Pod 网络的根。

```text
kubelet ──CRI──> containerd ──> shim ──> runc（建完就退出）
                    │             └── 持有 stdio、回收僵尸
                    └── 镜像 / 快照 / 元数据
pause 容器 ── 持有 netns <── setns ── app / sidecar
```

看图时注意两件事：runc 是一次性的，长期陪跑的是 shim。pause 只持有 netns，不持有业务进程。

### 一次 Pod 启动的实际顺序

1. kubelet 调 `RunPodSandbox`，containerd 让 CNI 配好网络，起 pause。
2. kubelet 依次 `CreateContainer` 和 `StartContainer`，runc 建容器，shim 留下。
3. 业务容器 `setns` 进 pause 的 netns，看到同一张网卡。
4. 删除时先 `StopContainer`，再 `RemovePodSandbox`；顺序反了，netns 会提前消失。

在节点上可以验证第 3 步。先在宿主机跑 `sudo lsns -t net -o NS,PID,COMMAND | grep -E 'pause|app'`，再看 `sudo crictl ps`。如果 pause 和 app 两行的 NS 列是同一个值，说明它们确实共享 netns；如果 app 的 NS 不同，先查 CNI 的 `ADD` 有没有成功，再看 kubelet 日志里的 sandbox 错误。不要先怀疑应用。

### 坏掉的时候看到什么

pause 被杀，netns 的**入口**就没了：业务容器已经 `setns` 进去，它们自己持有这个 netns，所以网络不会立刻消失，业务可能继续跑；但 pause 消失后 `/proc/<pause>/ns/net` 不可达，新容器无法再加入，kubelet 会把 sandbox 判成失败并重建。这一点在 [CN2](cn2.html) 里有更完整的讨论：netns 的行为由引用计数决定，不是由"谁创建它"决定。shim 挂了，容器会变成孤儿，退出码和 stdio 都收不回来，`kubectl logs` 只能看到空。运行时和 shim 版本不匹配时，`crictl exec` 可能报找不到容器，而 `ps` 里进程明明还在。如果守护进程的退出策略把整个 cgroup 一起杀掉，shim 也会跟着死，这时"重启 containerd 不影响业务"的假设就不成立。

**多容器视角**：Pod 的沙箱不是抽象名词，它就是一个真实存在的 pause 容器。`crictl ps` 里命令是 `/pause` 的那个就是它。pause 负责持有 netns 的入口和 sandbox 的身份；它没了，网络本身可能还在（因为业务容器仍持有引用），但 Pod 已经不能加入新容器，健康检查却可能仍然通过，这是排查时最容易看错的地方。

### 和实验的关系

[CN2](cn2.html) 的第一步就是自己起一个 pause，让两个子进程 `setns` 进去，把"谁持有 netns"演一遍。做完这一步，CRI 的接口名就不需要背了。

### 检查一下自己

1. containerd 重启后，已经运行的容器为什么不会死？
2. runc 为什么创建完进程就退出？长期监督交给谁？
3. pause 容器被杀，Pod 里的业务容器会怎样？

### 答案要点

1. shim 是容器进程的父进程，持有 stdio 和退出状态；containerd 重启后通过 shim 的 socket 重新接上。
2. runc 只按 runtime spec 建一次进程，建完就退出；长期监督、日志和回收由 shim 负责，这样运行时可以替换。
3. netns 不会随 pause 一起消失：已经 `setns` 进去的业务容器自己持有引用，网络仍在。丢的是 pause 这个入口——新容器无法再加入，kubelet 把 sandbox 判为失败并重建，业务容器通常要重启才能加入新的 sandbox。

**依据**：OCI Runtime Spec；Kubernetes CRI 文档；containerd 架构文档。

**作业**：[CN1](cn1.html) · [CN2](cn2.html) · [作业总览](labs.html)

## 第 3 讲：镜像、digest 与供应链 {#cn3}

用一句话说：tag 只是名字，digest 才是内容；供应链要同时回答“里面有什么”“谁构建的”“拉到的还是不是那一份”。

### 同一个 tag，两次不同的镜像

周五下午，CI 用同一个 tag 构建了两次，`docker pull registry.example/agent:prod` 在开发机和线上拿到的镜像却不一样。回滚时更糟：`prod` 已经被覆盖，旧的 digest 没人记录，只能从头重建。问题不在 Dockerfile，而在把可变的名字当成了不可变的内容。

### 清单、层和 digest

镜像（image）不是一个大文件，而是一份清单加一组内容。manifest 列出 config 和层；config 记录环境变量、入口命令和工作目录；每个层（layer）是一个 tar 包，文件名就是内容的摘要（digest）。拉取时先取 manifest，再按 digest 并行拉层，最后按顺序解压成 rootfs。tag 只是 registry 里指向某个 digest 的可变指针。

```text
tag: prod ──> manifest ──> config（digest）
                      └──> layer 1（digest）
                      └──> layer 2（digest）
```

看图时注意：tag 指向 manifest，manifest 里的每个字段都用 digest 定位内容。

层是内容寻址的，所以相同内容只存一份，构建缓存也按“父层 digest + 指令 + 上下文”命中。代价是层的边界会影响结果：把依赖安装放在源码复制之前，改一行代码只重建最后一层；反过来，每次改代码都要重装依赖。多阶段构建（multi-stage build）把编译环境和运行环境分开，只把产物复制进最终镜像。

“同一个源码构建出同一个 digest”叫可复现构建（reproducible build）。时间戳、文件顺序、包版本、构建路径和网络下载都会破坏它。固定基础镜像的 digest、固定依赖版本、设置 `SOURCE_DATE_EPOCH`，是把这件事做到可验证的最低要求。

### 供应链的三个问题

第一，镜像里有什么，答案是软件物料清单（Software Bill of Materials，SBOM）。第二，是谁、用什么源码构建的，答案是 provenance 和签名（signature）。第三，拉下来的字节是不是当初签的那一份，答案是 digest 校验。三者缺一不可：SBOM 可以生成得不完整，签名只能证明“持有这把私钥的人签过”，不能证明构建过程干净。

部署时的正确顺序是“按 digest 拉取，再验证这个 digest 的签名”，而不是“验证 tag，再按 tag 拉取”。后者中间有一个时间窗，tag 可以被改指到另一个 digest。Kubernetes 的 admission controller 可以在 Pod 创建时检查镜像 digest 和签名，但前提是 spec 里写的是 digest。

### 一次可复现构建的对比

在仓库根目录跑两次 `docker build -t demo:v1 .`，然后 `docker images --digests demo`。如果两次 digest 不同，用 `docker history demo:v1` 找哪一层的 `CREATED` 时间在变；常见来源是 `apt-get update` 和没有固定版本的 `pip install`。再用 `skopeo inspect docker://registry.example/demo:v1 | jq -r .Digest` 确认 registry 上的 digest，把它写进部署清单。

层数也要看：一个 12 层的镜像里，基础层可能占 800 MB，业务层只有 20 MB。

### 边界在哪里

删掉文件不等于从镜像里删掉数据：早一层写入的密钥仍然留在那一层的 tar 里，`docker save` 解包就能看到。SBOM 通常从包数据库生成，静态编译进去的第三方库、`curl | sh` 装的东西可能不在里面。签名密钥泄露后，攻击者可以签一个恶意镜像，验证仍然通过。registry 被攻破时，digest 校验能挡住“内容被换”，挡不住“这个 digest 本来就没被签过”。

**多容器视角**：一个 Pod 里 app、sidecar、init container 可能来自三个仓库。只固定 app 的 digest 不够，sidecar 的 `:latest` 同样会在某次重启后换成新内容。把三个镜像都写进同一个 SBOM 和一个签名策略，才知道整个 Pod 跑的是什么。

### 和实验的关系

[CN1](cn1.html) 把镜像层当作输入的 rootfs，不要求你自己构造镜像。想看 tag 和 digest 在文件系统里分别长什么样，可以对照 `skopeo inspect` 的输出读一遍 OCI 布局；这是延伸阅读，不是 CN1 的交付物。

### 检查一下自己

1. 为什么不能只凭 tag 判断镜像内容？
2. SBOM 和签名分别解决什么问题，各自防不住什么？
3. 为什么应该“先按 digest 拉，再验签”，而不是反过来？

### 答案要点

1. tag 是可变的指针，同一个 tag 可以在任何时候指向新的 digest；只有 digest 绑定内容。
2. SBOM 说明里面有什么，签名说明谁构建并认可了这份内容；SBOM 可能不完整，签名不能证明构建环境干净。
3. 先验 tag 再按 tag 拉，中间 tag 可能被改指；按 digest 拉取后验证同一个 digest，才没有时间窗。

**依据**：OCI Image Spec；SLSA 规范；`cosign` 与 `skopeo` 文档。

## 第 4 讲：为什么 Pod 是最小调度单位 {#cn4}

用一句话说：Pod 把“必须落在同一台机器、共享网络和卷”的容器绑成一个调度单位，代价是它们的资源和故障域也被绑在一起。

### 四个容器，为什么不能拆成四个 Pod

一个推理服务 Pod 里有四个容器：init container 下载模型，app 提供 HTTP，sidecar（边车）采集日志和指标，出问题时再进一个临时容器调试。有人把它们拆成四个独立 Pod，结果 app 读模型要走网络，sidecar 读日志要挂跨节点卷，`localhost:9090` 也不再通。

### Pod 绑定了什么

Pod 是 Kubernetes 的最小调度单位。调度器以 Pod 为单位做过滤和打分，kubelet 以 Pod 为单位创建沙箱（sandbox）、挂卷、起容器。Pod 里的容器共享同一个 network namespace，因此共享 IP 和端口空间，可以直接用 `localhost` 通信；它们也可以挂同一个卷，用文件交换数据。这两条共享是 Pod 存在的理由，也是后面所有多容器问题的根源。

Pod 里的容器分三类。init container 按声明顺序执行，每个都必须成功退出，才会启动下一个；它们可以有独立的镜像和权限，适合做“必须完成的前置条件”。app 和经典 sidecar 并行启动，没有顺序保证。临时容器（ephemeral container）用来调试，不能设资源限制，也不能声明端口。

`restartPolicy` 作用于 Pod 里的每个容器，不是整个 Pod：app 崩溃时只重启 app，已完成的 init container 不会跟着重跑。native sidecar 是例外，它放在 `initContainers` 里但 `restartPolicy: Always`，会在 app 之前启动，在所有普通容器退出之后才终止。

### 调度单位带来的取舍

把容器绑进一个 Pod，省掉 Service、DNS 和跨节点复制，换来的是一组硬约束。Pod 的资源请求是所有普通容器之和，没有一台机器能放下这个和，整个 Pod 就 Pending。Pod 也不能跨节点，任何“这两个进程必须靠得很近”的需求，最后都要落到同一台机器上。

故障域同样被绑住。节点驱逐、Pod 删除、沙箱重建都以 Pod 为单位；一个容器反复 OOM，容器会进入 CrashLoopBackOff，节点内存紧张时 Pod 还可能被驱逐。sidecar 不是免费的，它的 requests 计入 Pod，崩溃也影响 Pod 的就绪状态。这两个容器真的需要一个 Pod 吗？如果只是“部署在一起”，两个 Pod 更清楚。

```text
节点 A
┌────────────── Pod ──────────┐
│ pause（持有 netns）          │
│ init ──> app ⇄ sidecar       │   调度器看到的是
│           共享卷 / localhost │   整个 Pod 的资源之和
└──────────────────────────────┘
```

看图时注意：pause 是网络的锚点，init 在 app 之前串行完成，app 和 sidecar 之间只隔着一个 localhost。

### 一个 Pending 的 Pod

假设节点有 4 核，已经分配了 3.2 核的 requests。新 Pod 的 app 要 500m，sidecar 要 100m，init container 要 800m。普通容器合计 600m，init 最大 800m，Pod 的有效请求取两者较大值，也就是 800m，剩余空间刚够。把 sidecar 的 requests 从 100m 改成 600m，合计变成 1100m，Pod 立刻变成 `0/3 nodes are available: 3 Insufficient cpu`，`kubectl describe pod` 的事件里能看到这句话。

### 坏掉的时候看到什么

两个容器都想监听 8080，第二个会 `bind: address already in use`，因为端口空间是 Pod 级的。init container 失败，app 永远不会启动，Pod 停在 `Init:Error`。打开 `shareProcessNamespace` 后，一个容器可以给另一个容器发信号，这是权限边界的变化，不是调试开关。临时容器不能设 limits，排障时可能把节点内存打满。

**多容器视角**：共享 netns 让 `localhost:8080` 成为容器间的默认通信方式，也让端口冲突变成 Pod 级问题；共享卷让传文件很方便，也让并发写变成 race。init container 适合“必须完成的前置条件”，sidecar 适合“和主容器同生共死的辅助进程”，两者不要混用。

### 和实验的关系

[CN2](cn2.html) 让你实现一个迷你 Pod runner：pause 持有 netns，init 串行，app 和 sidecar 并行，共享一个 emptyDir。验收的第一条就是“init 没完成时 app 不启动”，这条规则只有自己写一遍才会记住。

### 检查一下自己

1. 如果只调度容器而不调度 Pod，会失去什么？
2. init container 和 sidecar 的启动顺序分别是什么？
3. 为什么 sidecar 的 requests 会影响整个 Pod 能不能调度？

### 答案要点

1. 失去共享 netns 和卷的保证，容器可能落在不同节点，`localhost` 和本地文件交换都不成立。
2. init 按顺序串行，全部成功后才启动 app；app 和经典 sidecar 并行，没有顺序保证。native sidecar 在 app 之前启动。
3. 调度器按 Pod 内普通容器 requests 之和计算，sidecar 的份额会让总和超过节点可分配资源，Pod 就 Pending。

**依据**：Kubernetes Pod Lifecycle 文档；Kubernetes 调度器文档；Borg 论文第 2 节。

## 第 5 讲：Terminating 为什么卡住 {#cn5}

用一句话说：删除 Pod 不是发一个信号，而是一条有超时的流水线；任何一段不响应，Pod 就停在 Terminating，优雅退出（graceful shutdown）也无从谈起。

### 三十分钟的删除

发布窗口里，`kubectl delete pod agent-0` 卡在 Terminating，直到 `terminationGracePeriodSeconds` 用完才消失。查下去发现 app 的启动命令写成了 `CMD /app`，PID 1 是 `/bin/sh`，shell 收到 `SIGTERM` 后没有转发给 `/app`；sidecar 又在等一个永远不会关闭的连接。两边都不退出，kubelet 只能等到超时再 `SIGKILL`。

### 信号在 PID namespace 里的特殊规则

容器里的 1 号进程是 PID namespace 的 init。发给它的信号，如果它没有安装 handler，内核会直接忽略，`SIGKILL` 和 `SIGSTOP` 除外。从宿主机发 `SIGTERM` 正好落在这条规则上：如果 PID 1 是业务进程且没处理 `SIGTERM`，信号就丢了。如果 PID 1 是 shell，shell 自己也不一定转发给子进程。

`CMD ["/app"]` 让 `/app` 成为 PID 1；`CMD /app` 变成 `/bin/sh -c /app`，PID 1 是 shell，`SIGTERM` 可能根本到不了 `/app`。`tini`、`dumb-init` 和自己的 signal forwarder 就是为这件事存在的。

init container 只在启动阶段运行，退出码非零会让 Pod 按 `restartPolicy` 重试；它不参与终止流程，删除时只剩 app 和 sidecar。

删除 Pod 的流程大致是：API server 打上 `deletionTimestamp`；endpoint controller 把 Pod 从 Service endpoints 摘掉；kubelet 执行 `preStop`；然后给每个容器发 `SIGTERM`；等 `terminationGracePeriodSeconds`，默认 30 秒；还没退出就 `SIGKILL`。摘 endpoint 是异步的，所以 `preStop` 里常见的 `sleep 5` 是在等在途请求走完，不是在偷懒。

僵尸进程（zombie process）是另一条线。容器里的 PID 1 要负责 `wait` 孤儿进程（orphan process）；如果 PID 1 是业务进程，它通常不会做这件事，僵尸就会堆积，最终耗尽 PID。`PR_SET_CHILD_SUBREAPER` 可以让一个进程成为子收割者（subreaper），收养孤儿；`tini` 作为 PID 1 会回收孤儿，也能用 subreaper 模式在非 PID 1 时收养。`cgroup.kill` 能一次杀掉整个 cgroup，比逐个 `kill` 可靠，但它是强制手段，不适合优雅退出。

### native sidecar 改变了什么

经典 sidecar 只是第二个普通容器，启动和终止都没有顺序保证。native sidecar 放在 `initContainers` 里，带 `restartPolicy: Always`，它会在 app 之前启动，在所有普通容器退出之后才终止。终止顺序反过来，日志 sidecar 才有机会把 app 最后的输出 flush 出去。没有这个保证时，要么在 `preStop` 里自己协调，要么接受日志丢失。

```text
kubectl delete
   │ deletionTimestamp
   ├─> endpoint 摘除（异步）
   ├─> preStop
   ├─> SIGTERM ──> app / sidecar
   │                 │ 不退出
   └─> grace 到期 ──> SIGKILL
```

看图时注意：endpoint 摘除和 SIGTERM 是两条并行的时间线，`preStop` 的长度要覆盖摘除的传播时间。

### 量一次

在开发机上跑 `docker run --rm --name demo alpine sh -c 'sleep 300; echo done'`，另开一个终端 `time docker stop demo`。默认等 10 秒才返回：PID 1 是 shell，`SIGTERM` 在 PID namespace 里被内核丢掉（PID 1 没装 handler 时非 `SIGKILL`/`SIGSTOP` 的信号直接忽略），shell 根本没机会转发。换成 `docker run --rm --name demo alpine sleep 300`，`docker stop` **仍然**要等满 10 秒——`sleep` 是 PID 1，同样没装 `SIGTERM` handler，同样被忽略。两次的差别不在"谁转发"，而在于有没有进程真的响应 `SIGTERM`。

要看到"立刻返回"，得让 PID 1 自己处理信号，例如 `docker run --rm --name demo alpine sh -c 'trap "exit 0" TERM; sleep 300 & wait'`，或直接把这个进程换成 `tini`。Kubernetes 里把 `terminationGracePeriodSeconds` 设成 5，再用 `kubectl delete pod` 观察，能看清 grace 和 `preStop` 谁先到期。

### 坏掉的时候看到什么

`preStop` 配了 60 秒、grace 只有 30 秒，`preStop` 会被打断。sidecar 在等下游连接，app 已经退出，Pod 仍然 Terminating。app 收到 `SIGTERM` 后继续接新请求，摘除还没传播完，请求打到正在关闭的进程上。`--force --grace-period=0` 只是从 API server 删掉记录，容器可能还在节点上跑，卷也没卸载。孤儿进程没人回收时，`ps` 里是一串 `<defunct>`，PID 数量慢慢上涨。

**多容器视角**：优雅退出不是“一个容器的事”。app 要先停止接收新请求，sidecar 要等 app 把日志写完，采集器要等 sidecar flush。谁先谁后，取决于你把谁放在 native sidecar、谁放在普通容器，以及 `preStop` 里做了什么。

### 和实验的关系

[CN2](cn2.html) 的第 4、5 步就是这条流水线：先给 app 发 `SIGTERM`，等它退出，再给 sidecar 发；超时 `SIGKILL`；最后用 subreaper 回收孤儿，并记录每个容器的退出码。跑通之后，再回头看 `kubectl delete` 的日志，顺序就清楚了。

### 检查一下自己

1. 为什么 `docker stop` 有时要等 10 秒？PID 1 没装 handler 和 shell 不转发各起什么作用？2. native sidecar 的终止顺序是什么？为什么这个顺序对日志重要？
3. `SIGKILL` 能解决 Terminating 吗？它留下了什么？

### 答案要点

1. `SIGTERM` 发给 PID 1，没 handler 就被内核忽略，只能等宽限期到期后 `SIGKILL`。`sleep` 作 PID 1 也照样被忽略，所以"换成 `sleep` 就立刻返回"是错的。要让 `docker stop` 快速返回，PID 1 必须装 `SIGTERM` handler（`tini`、`dumb-init`，或自己 `trap` 后退出）。
2. 在所有普通容器退出之后终止；日志 sidecar 因此能读到 app 的最后输出并 flush。
3. 能让容器消失，但绕过清理逻辑，可能留下没卸载的卷、没 flush 的日志和仍在节点上的进程。

**依据**：Kubernetes Pod Lifecycle 文档的 Termination 一节；`signal(7)` 对 PID 1 的说明；`prctl(2)` 的 `PR_SET_CHILD_SUBREAPER`。

## 第 6 讲：Pod 网络是怎么接起来的 {#cn6}

用一句话说：每个 Pod 有一个可路由的 IP，靠的是 netns 里的一对 veth、宿主上的 bridge、一条路由和一条 NAT 规则。

### ping 不通的两个 Pod

两个 Pod 在同一台节点上，`kubectl exec` 进去 `ping` 对方 IP，100% 丢包。`ip addr` 只看到 `lo`，`ip route` 是空的。CNI 的 `ADD` 明明返回了成功，kubelet 也认为 Pod 就绪。继续查，veth 的宿主端在，容器端不在 netns 里；插件在 `ADD` 之后又跑了一次 `DEL`，把刚接好的网卡删了。这类故障看起来像网络，实际是生命周期顺序。

### 从 netns 到 Pod IP

Pod 网络的最小拼图是四样东西。network namespace（netns）给容器一张独立的网卡、路由表和端口空间。veth pair 是一对虚拟网卡，一头放进 netns，一头留在宿主；网桥（bridge）把同一节点上的 veth 接在一起，像一个二层交换机；网络地址转换（NAT）让 Pod 的私有地址能出节点。容器网络接口（Container Network Interface，CNI）是插件规范，`ADD` 负责在给定的 netns 里接 veth、分配 IP、加路由，`DEL` 负责逆操作。

同节点通信走 bridge：Pod A 发 ARP 找 Pod B 的 MAC，bridge 直接转发。跨节点通信有两条路。overlay 把二层帧封进 UDP（VXLAN），宿主只看得到节点间流量；underlay 让宿主直接路由 Pod CIDR，通常靠 BGP 宣告。overlay 不依赖底层网络，但多 50 字节封装，1500 的 MTU 只剩下 1450；underlay 性能好，但要求网络设备配合。

Pod 的 IP 在 Pod 生命周期内不变，重启 Pod 就会换。所以应用不能把 Pod IP 写进配置，稳定的入口要靠 Service，下一讲再展开。`hostNetwork: true` 是另一条路：Pod 直接用宿主 netns，少一层转发，但端口、DNS 和 NetworkPolicy 的语义都会变。

```text
宿主机
  ┌─ cni0 (bridge) ─────────────────┐
  │        │ veth-xxxx               │
  │        │                         │
  └────────┼─────────────────────────┘
           │
     ┌─────┴───── netns ns1 ────────┐
     │ eth0 10.244.1.2/24            │
     │ default via 10.244.1.1        │
     └───────────────────────────────┘
```

看图时注意：容器里看到的 `eth0` 和宿主上的 `veth-xxxx` 是同一根线的两头；Pod 的默认路由指向 bridge 的地址。

### 手工接一根线

在一个干净的 Linux 上，用 root 跑下面几步，能复现 CNI 的核心动作。

```bash
ip link add cni0 type bridge
ip link set cni0 up
ip addr add 10.244.1.1/24 dev cni0
ip netns add ns1
ip link add veth1 type veth peer name eth0 netns ns1
ip link set veth1 master cni0
ip link set veth1 up
ip -n ns1 addr add 10.244.1.2/24 dev eth0
ip -n ns1 link set eth0 up
ip -n ns1 link set lo up
ip -n ns1 route add default via 10.244.1.1
```

然后在另一个 netns 里配 `10.244.1.3/24`，`ip netns exec ns1 ping -c 1 10.244.1.3` 应该通。不通时先看 `bridge link` 里 veth 有没有挂上，再看 `sysctl net.ipv4.ip_forward` 是不是 1，最后看 `iptables -L FORWARD -n -v` 有没有被默认 DROP 掉。

### 坏掉的时候看到什么

忘记 `ip link set lo up`，容器里的 `127.0.0.1` 不通，很多健康检查会直接失败。`ip_forward` 是 0，跨 netns 的包在宿主被丢掉。bridge 没 up，veth 挂上去也没有转发。

Docker 默认把 `FORWARD` 链设成 DROP，自己写的 CNI 规则如果插在错误的位置，会被前面的规则吃掉。`DEL` 在 netns 已经消失后执行，清理会报错，留下孤儿 veth 和 iptables 规则。hairpin（Pod 访问自己的 Service）要额外处理 `route_localnet` 和 `br_netfilter`，具体规则随 CNI 而异。

**多容器视角**：Pod 内容器共享 netns，所以它们用同一个 IP、同一组端口，`localhost` 通，但端口冲突也是 Pod 级的。sidecar 要拦截流量，通常靠 iptables 重定向或 eBPF，这会影响 `localhost` 通信、健康检查端口和出网路径。`hostNetwork: true` 让 Pod 直接用宿主网络，端口冲突、NetworkPolicy 失效、DNS 行为变化都要重新检查。

### 和实验的关系

[CN3](cn3.html) 让你手写一个 CNI 风格的插件：`ADD` 建 netns、veth、bridge、IP、路由和 NAT，`DEL` 全部清理；再加一个 Service VIP 的 DNAT。验收里有一条是“删除 netns 后规则和 veth 被清理”，这正是上面说的孤儿问题。

### 检查一下自己

1. 为什么 Pod 需要一个 pause 容器持有 netns？没有它会怎样？
2. 同节点和跨节点的 Pod 通信分别走哪条路？
3. `hostNetwork: true` 会破坏哪些假设？

### 答案要点

1. netns 需要至少一个进程持有；pause 退出，netns 被销毁，所有业务容器失去网络。
2. 同节点走 bridge 二层转发；跨节点走 overlay 封装或 underlay 路由。
3. 端口变成节点级、NetworkPolicy 往往不生效、DNS 和 `localhost` 的语义都变了。

**依据**：CNI Spec；`ip-netns(8)`、`veth(4)`；Kubernetes Pod 网络文档。

## 第 7 讲：Service、超时与重试放大 {#cn7}

用一句话说：Service 把请求分到某个 Pod，超时决定等多久，重试决定失败后补几次；三者配错，故障会从一台机器扩散到整个服务。

### 一次重试风暴

下午三点，一个后端副本变慢，p99 从 80 ms 涨到 1.2 s。客户端超时（timeout）1 秒，失败重试（retry）2 次。原本每秒 300 个请求，三分之一打到慢副本，100 个请求超时后各补两次，多出 200 个请求，全部压到剩下两个副本上。它们也超时，重试继续放大，整个服务不可用。慢副本是导火索，重试放大（retry amplification）才是放大器。

### VIP 背后发生了什么

Service 的 ClusterIP 是一个虚拟 IP，没有网卡持有它。kube-proxy 在 iptables 里写 DNAT 规则，把发往 VIP 的连接改到某个 Pod IP；IPVS 模式用内核的四层负载均衡；Cilium 用 eBPF 在 socket 层做。DNAT 发生在连接建立时，conntrack 记住这条流，后续包都走同一个后端。所以负载均衡的单位是连接。gRPC 用长连接，一条连接上的所有请求都落在同一个 Pod，副本之间很容易不均。

```text
client ──> Service VIP ──DNAT──> Pod A（慢）
                          └─────> Pod B
```

看图时注意：DNAT 只在建连时选一次后端，重试会重选。

Service 只保证“能到达”，不保证“可靠地到达”。一个请求至少经过 DNS 解析、TCP 建连、TLS 握手、协议编码、负载均衡、超时和重试。每一层失败的样子不同：DNS 失败是名字解析不出来，TCP 失败是连接被拒或超时，TLS 失败是证书或握手，应用层失败才是 5xx。

### 超时和重试要一起设计

连接超时、读超时、总 deadline 是三件事。只设一个“30 秒”通常不够：连接可能在 3 秒内失败，读可能一直等到 30 秒，而上层早就放弃了。deadline 要沿调用链传播，下游知道自己还剩多少时间，才不会做无用功。gRPC 的 deadline 会随 context 传下去，HTTP 可以用自定义 header，但需要每一层都认。

重试要有上限、退避和 jitter，只对可重试的错误重试，只在一层重试。非幂等（idempotent）的 `POST` 盲目重试会重复下单。下游已经过载时，重试等于再加一份负载；指数退避加随机抖动，能让客户端错开，避免同时再来一轮。预算（retry budget）是更稳的做法：整个客户端只允许重试总量的一定比例，比如 10%，超过就快速失败。

### 量一次放大倍数

在 CN3 的环境里，用 `tc netem` 给一个后端加 1 秒延迟，用 `hey -z 30s -c 50 http://10.96.0.10:8080/` 压测。先不加 retry，记录 QPS 和 p99；再把客户端超时调到 500 ms、重试 2 次，观察后端收到的请求数。请求数会明显超过客户端发出的请求数，上限接近 `1 + 重试次数 × 失败率`。

用 `iptables -t nat -L KUBE-SERVICES -n | grep 10.96.0.10` 能看到 VIP 的 DNAT 链。

### 坏掉的时候看到什么

超时比下游 p99 还短，正常请求也会被判定失败，重试把负载翻倍。重试没有 jitter，所有客户端在同一时刻重发，形成脉冲。在 sidecar 和 app 各配一层重试，实际重试次数是乘积。连接池太小会排队，太大则会在故障时把下游压垮。

**多容器视角**：sidecar 做重试时，app 自己可能也在重试，两层叠加就是乘法。健康检查经过代理时，“app 活着”和“代理能出网”是两个状态，探针要能区分。`localhost` 调用看起来没有网络，但代理一挂，出站就全断了。

### 和实验的关系

[CN3](cn3.html) 第 4 阶段用 iptables DNAT 做一个 Service VIP，把流量轮询到两个后端；第 5 阶段讲 hairpin 与 SNAT，可选的 netem 用来注入延迟和丢包，测一次超时、重试和 p99。重点不是把数字调好看，而是能说出"多出来的请求是谁发的"。

### 检查一下自己

1. 为什么重试会放大故障？超时和重试应该怎么配合？
2. 为什么 gRPC 长连接会让 Service 的负载不均？
3. deadline 不沿调用链传播会发生什么？

### 答案要点

1. 失败后每个客户端都补发，下游过载时补发的请求又失败，形成正反馈；超时要大于下游 p99，重试要有上限、退避和预算。
2. DNAT 在连接建立时选一次后端，长连接上的后续请求不会重新负载均衡。
3. 上游已经放弃，下游还在执行；每一层都按自己的超时等待，资源被浪费，故障恢复更慢。

**依据**：Kubernetes Service 与 kube-proxy 文档；gRPC 的 deadline 与 retry 指南；Google SRE 手册的“Handling Overload”一章。

## 第 8 讲：共享工作区怎么原子提交 {#cn8}

用一句话说：多个容器共享一个目录时，读者要么看到旧版本，要么看到新版本；中间状态必须被 `rename` 和 `fsync` 藏起来，这就是原子提交（atomic commit）。

### 读到一半的 JSON

agent 容器往共享卷写 `result.json`，checker 容器每隔 100 ms 读一次。某次运行，checker 报 `unexpected end of JSON input`，重试又好了。日志里 agent 明明写成功了。原因是 agent 直接 `open(O_TRUNC)` 再写，checker 正好在截断之后、写完之前读到空文件或半个文件。POSIX 的 `write` 不保证读者看到完整内容，只保证字节按顺序落进去。

### 镜像层、可写层和 copy-up

容器看到的根文件系统通常是联合文件系统（overlayfs）挂出来的。lowerdir 是镜像的只读层，upperdir 是容器的可写层，merged 是进程看到的视图。第一次写一个来自 lower 的文件时，内核先把整个文件复制到 upper，这叫写时复制（copy-up）；之后写的是 upper 的副本。copy-up 对应用不可见，但大文件要整份复制。

删除也有代价。upper 里用一个 whiteout 文件遮住 lower 的同名文件，lower 并没有被改。打包 upper 做新基线时，whiteout 要一起处理，否则删掉的文件会在新镜像里复活。

要做“原子提交一个工作区”，POSIX 给的工具够用：写临时文件；`fsync` 文件；`rename` 到目标名；`fsync` 父目录。`rename` 在同一条文件系统内是原子的，读者要么看到旧文件，要么看到新文件。`fsync` 文件保证内容落盘，`fsync` 目录保证目录项落盘；少一步，崩溃后可能看到一个指向不存在 inode 的目录项。`O_TMPFILE` 加 `linkat` 可以创建没有名字的临时文件，`renameat2(RENAME_EXCHANGE)` 可以原子交换两个文件。

```text
写者                          读者
 │ open tmp                     │
 │ write ──> fsync(tmp)         │ open result.json
 │ rename(tmp, result.json) ──> │ 看到旧 inode 或新 inode
 │ fsync(dir)                   │ 不会看到半个文件
```

看图时注意：读者已经打开的 fd 仍指向旧 inode，`rename` 不会把它改成新文件；要看到新版本，读者必须重新 `open`。

### 卷的抽象和它的边界

Kubernetes 的卷有几层。`emptyDir` 随 Pod 创建和删除，适合临时缓存；`hostPath` 直接挂节点目录，`subPath` 把卷的一个子目录挂进容器。访问模式 `ReadWriteOnce` 表示卷只能被一个节点以读写方式挂载，它不是“一个容器”，也不是文件锁。`ReadWriteMany` 需要底层存储支持，NFS 和 CephFS 可以，EBS 通常不行。

多容器同时写没有万能办法。要么约定单写者，一个容器负责写，其他只读；要么用 `flock`，但在 NFS 上语义要小心；要么用“临时文件加原子 rename”，让读者永远看到完整版本。

### 一次崩溃测试

在 CN4 的工作区里，先在 lower 放一个 1 GB 的文件：`dd if=/dev/zero of=lower/big bs=1M count=1024`；挂好 overlay 后，`printf x >> merged/big`，同时用 `stat merged/big` 看 inode。第一次写触发 copy-up，inode 会变，耗时可能到秒级。然后在 commit 过程中 `kill -9` 写者，重启后检查：工作区要么是旧基线，要么是新基线，不能是两者的混合。混合通常来自两个错误：`rename` 跨了文件系统，返回 `EXDEV`；或者只 `fsync` 了文件没 `fsync` 目录。

### 坏掉的时候看到什么

`rename` 的目标和临时文件不在同一个挂载点，原子性消失。读者一直持有旧 fd，以为自己在读最新版本。NFS 上 `rename` 的可见性依赖服务器实现。whiteout 没处理，rollback 后删掉的文件又出现了。

**多容器视角**：共享卷的并发写没有银弹。单写者最省心，文件锁要看底层存储，临时文件加原子 rename 能让读者永远看到完整版本。INFRA 03 会把这件事提升为 `workspace.commit` 和 `workspace.rollback` 两个原子操作。

### 和实验的关系

[CN4](cn4.html) 用 overlayfs 做 lower、upper、merged 三层，实现 commit 和 rollback，再用 `kill -9` 做崩溃测试。验收的核心不是“能提交”，而是“commit 期间读者只看到旧版或新版”。

### 检查一下自己

1. `ReadWriteOnce` 为什么不是文件锁？
2. `fsync` 文件之后，为什么还要 `fsync` 目录？
3. 读者已经打开文件时，`rename` 会让它看到新内容吗？

### 答案要点

1. 它描述的是卷能被多少个节点以读写方式挂载，不限制同一节点上多少容器或进程同时写。
2. `fsync` 文件只保证数据块落盘；目录项是另一份元数据，不 `fsync` 目录，崩溃后可能找不到这个文件。
3. 不会。已打开的 fd 仍指向旧 inode，读者要重新 `open` 才能看到新文件。

**依据**：`rename(2)`、`fsync(2)`、`open(2)` 的 `O_TMPFILE`；overlayfs 内核文档；Kubernetes 卷文档。

## 第 9 讲：requests、limits 与 throttling {#cn9}

用一句话说：调度器只看资源请求（requests），cgroup 才执行资源上限（limits）；CPU 超了被限流（throttling），内存超了被杀。

### 有空闲 CPU，Pod 却 Pending

节点 4 核，监控显示 CPU 使用率 35%，新 Pod 却一直 Pending。`kubectl describe pod` 的事件写着 `0/3 nodes are available: 3 Insufficient cpu`。原因不是机器忙，而是已经分配的 requests 加起来到了 3.2 核，新 Pod 要 1 核，没有节点放得下。调度器看的是预留，不是实时用量；35% 是过去一分钟的平均值，和“还能不能再塞一个 Pod”是两件事。

### requests 和 limits 是两套数

requests 是调度器预留的资源，决定 Pod 能落到哪台节点；limits 是运行时上限，由 kubelet 写进 cgroup。两者可以不等。requests 写小了，Pod 容易被塞进已经很挤的节点；limits 写大了，节点可能超卖。生产上常见的是 requests 等于 limits，牺牲一点装箱率，换取可预测的延迟。

服务质量等级（QoS）分三档。Guaranteed 要求所有容器的 CPU 和内存 requests 等于 limits；Burstable 是至少一个容器设了 requests 或 limits，但不相等；BestEffort 是完全没有设置。节点内存紧张时，kubelet 按 QoS 顺序驱逐，BestEffort 先走，Guaranteed 最后。Guaranteed 保证的是驱逐优先级，不是性能；它里面的容器照样会被 CPU 限流。

cgroup v2 的接口比 v1 统一。`cpu.max` 是“配额/周期”，比如 `50000 100000` 表示每 100 ms 最多用 50 ms；`cpu.weight` 是相对权重；`memory.max` 是硬上限，超过就 OOM kill；`memory.high` 是软上限，超过会被限流而不是直接杀；`pids.max` 防 fork 炸弹；`io.max` 做设备级限速。PSI（pressure stall information）能告诉你资源压力有多大，比平均利用率有用。

```text
requests: 500m  ──> 调度器：这台机器还放得下吗？
limits:   500m  ──> kubelet：写进 cpu.max = 50000 100000
                         │
                         └─> 用完配额就等下一个周期，表现为 throttling
```

看图时注意：同一个数字出现在两个地方，作用完全不同；调度成功不代表运行时不会被限流。

### 看一次 throttling

在一个 500m limit 的容器里跑 `stress-ng --cpu 2 --timeout 60s`，同时在宿主机读 cgroup 文件。路径类似 `/sys/fs/cgroup/kubepods.slice/.../cpu.max`，内容是 `50000 100000`；`cpu.stat` 里的 `nr_throttled` 和 `throttled_usec` 会持续上涨。再读 `cpu.pressure`，`some avg10` 能看出有多少时间在等 CPU。容器的平均 CPU 可能只有 40%，但 p99 已经被周期边界上的等待拉高。

### 坏掉的时候看到什么

`memory.max` 设得太小，进程被 OOM kill，退出码 137，`kubectl describe` 显示 `OOMKilled`。`memory.high` 设得合理时，进程会被限流、回收 page cache，不一定死。没有 limits 的 Pod 会挤占同节点其他 Pod，形成 noisy neighbor。requests 虚报会浪费容量，少报会让节点超卖。

init container 取所有 init 的最大值，再和普通容器之和取较大者；sidecar 的 requests 要计入 Pod。临时容器不能设 limits，排障时可能压垮节点。

**多容器视角**：Pod 的有效请求是普通容器之和与 init 最大值的较大者。加一个 sidecar，不只是多一个进程，还把它的 requests 加进了调度账本。Guaranteed Pod 里如果某个容器设了 CPU limit，它仍然会被 throttled；Guaranteed 保证的是驱逐顺序，不是不被限流。

### 和实验的关系

[CN5](cn5.html) 要求给 app 和 sidecar 设 CPU、内存和进程数上限，并演示一次 `memory.max` 下的 OOM。你会在自己的 runner 里看到和 kubelet 一样的事情：写 cgroup 文件、读 `cpu.stat`、处理退出码 137。做完再看 Kubernetes 的 requests/limits，只是同一套机制的声明式外壳。

### 检查一下自己

1. Guaranteed Pod 为什么仍可能被 CPU throttled？
2. `memory.high` 和 `memory.max` 的差别是什么？哪个会杀进程？
3. 节点有空闲 CPU，Pod 却 Pending，可能有哪些原因？

### 答案要点

1. Guaranteed 只影响驱逐优先级；只要容器设了 CPU limit，超过 `cpu.max` 的配额就会被限流。
2. `memory.high` 是软上限，超过会限流和回收；`memory.max` 是硬上限，超过会 OOM kill。
3. requests 之和超过可分配量、污点和亲和性不满足、卷或端口冲突、镜像太大、节点 NotReady。

**依据**：Kubernetes 资源管理与 QoS 文档；cgroup v2 内核文档；Borg 论文的 alloc 与资源隔离一节。

## 第 10 讲：容器什么时候才是安全边界 {#cn10}

用一句话说：默认容器共享宿主内核，只有叠加了能力（capability）、系统调用过滤（seccomp）、路径访问控制（Landlock）、用户命名空间（user namespace）或 VM 级隔离，它才勉强算一条边界。

### 一个挂载了 docker.sock 的 CI runner

CI runner 为了构建镜像，把 `/var/run/docker.sock` 挂进了容器。一个外部 PR 的测试脚本在里面跑 `docker run --privileged -v /:/host alpine chroot /host`，几秒钟就拿到了宿主 root。runner 本身是非 root、只读 rootfs、还开了 seccomp，但这些都没用：docker.sock 等于把宿主的管理接口递给了容器。

### 四层防线，各管一段

capability 把 root 的特权拆成小块。默认 Docker 容器带十几项，比如 `CAP_CHOWN`、`CAP_NET_RAW`、`CAP_SETUID`；`CAP_SYS_ADMIN` 几乎等于 root，能 mount、能改 namespace。正确做法是 `--cap-drop=ALL`，再按需 `--cap-add`。capability 是粗粒度的，它管“能不能调用某类操作”，不管“对哪个路径”。

seccomp 过滤系统调用。它看 syscall 号和参数，能在 `execve`、`mount`、`ptrace` 这些入口上直接返回错误。Docker 的默认 profile 挡掉了一批危险调用，但 seccomp 看不见路径，也看不懂文件描述符的语义；它不能表达“只能读 `/workspace`”。

Landlock 补的就是路径这一层。进程在启动后调用 `landlock_create_ruleset` 和 `landlock_add_rule`，声明自己只能访问哪些目录，再 `landlock_restrict_self` 生效。规则随 fork 和 exec 继承，不能撤销，也不能靠 chroot 绕过。它不需要 root，适合给单个 agent 进程划一个工作区。Landlock 主要管文件系统，网络规则是较新的扩展，内核版本要够。

user namespace 把容器里的 root 映射到宿主的一个非特权 uid。rootless 容器在此基础上再减少一层权限。它降低了“容器内 root 就是宿主 root”的风险，但也扩大了内核的攻击面，因为大量代码开始处理非特权用户创建的 namespace。`no_new_privs` 阻止 setuid 程序提权，`openat2(RESOLVE_BENEATH)` 在打开文件时解析路径，避免 TOCTOU。

```text
应用进程
  ├─ capability：能做哪些特权操作
  ├─ seccomp：能调哪些 syscall
  ├─ Landlock：能碰哪些路径
  └─ user namespace：在宿主上以谁的身份运行
```

看图时注意：四层是叠加的，不是四选一；任何一层配错，另外三层都不会替你兜底。

### 真的需要更强隔离时

gVisor 的 `runsc` 在用户空间实现一个 Linux 兼容内核，容器里的 syscall 被拦截并模拟，宿主内核只看到很少的调用。Kata Containers 用轻量 VM 跑容器，Firecracker 是更小的 microVM，启动快、内存开销小，适合多租户。代价是兼容性、性能和运维复杂度：gVisor 对某些 syscall 和 `/proc` 的支持不完整，Kata 需要硬件虚拟化。Kubernetes 用 `RuntimeClass` 选择运行时。

### 量一次攻击面

在一个普通容器里跑 `capsh --print`，看 `Current:` 那一行；再用 `--cap-drop=ALL` 跑同一个镜像，对比 `grep Cap /proc/self/status` 里的 `CapEff`，后者应该是全 0。然后试 `mount -t proc proc /mnt`，默认配置返回 `EPERM`；加上 `--cap-add=SYS_ADMIN` 再试，在 seccomp 和 AppArmor 放行时会成功。这个对比比读十页文档直观。

### 坏掉的时候看到什么

共享 netns 和卷会绕过一部分隔离：sidecar 能读共享卷，就能读 app 的密钥；能看共享网络，就能嗅探 `localhost`。默认挂载的 service account token 是常见泄漏点，不需要 API 访问的 Pod 应该设 `automountServiceAccountToken: false`。只读 rootfs 不阻止写 `emptyDir`。seccomp 挡不住逻辑漏洞，Landlock 挡不住已经打开的 fd，capability 挡不住内核漏洞。容器逃逸很少是单点，通常是“特权 + 挂载 + 内核漏洞”三者叠加。

**多容器视角**：Pod 里最强的那个容器决定整个 Pod 的安全下限。app 做得再干净，sidecar 以 privileged 运行、挂着宿主目录，攻击者从 sidecar 进来一样能出去。共享卷是数据通道，也是权限通道；共享 netns 是通信通道，也是嗅探通道。

### 和实验的关系

[CN1](cn1.html) 让你从 namespace 和 cgroup 开始，亲手体会“隔离了什么、没隔离什么”；[CN5](cn5.html) 要求 capstone 默认非 root、drop capabilities、只读 rootfs、默认 seccomp。做完再回头看这一讲，清单上的每一项都能对应到一个具体的 cgroup 文件或 syscall。

### 检查一下自己

1. 有了 user namespace，为什么容器里的 root 仍然危险？
2. seccomp 不能阻止什么？为什么它不能替代 Landlock？
3. 为什么说 Pod 的安全下限由最强的容器决定？

### 答案要点

1. user namespace 只改 uid 映射，内核攻击面仍在；容器里的 root 仍能利用内核漏洞或错误挂载逃逸。
2. seccomp 只看 syscall 号和参数，不看路径；Landlock 才能表达“只能访问这个目录”，两者互补。
3. 任何一个容器能以更高权限运行或访问共享资源，整个 Pod 的隔离就被它拉低。

**依据**：`capabilities(7)`、`seccomp(2)`、`landlock(7)`、`user_namespaces(7)`；gVisor 与 Firecracker 论文；Kubernetes Pod Security Standards。

## 第 11 讲：sidecar 的透明代理代价 {#cn11}

用一句话说：sidecar 把双向 TLS（mTLS）、重试和指标从业务里拿出来，代价是多一次跳转、多一套生命周期，以及一个更难排查的故障点。

### 装了 mesh 之后，出站全断了

一个服务接进服务网格，第二天早上下游连接全部超时，但 `curl localhost:8080/healthz` 正常。查下去发现 app 在 sidecar 还没 ready 时就启动了，出站流量被 iptables 重定向到一个还没监听的端口，连接被拒。应用自己觉得自己健康，代理却还没准备好。“能启动”和“能出网”从此是两个状态。

### 流量是怎么被接管的

sidecar 的思路是把网络治理逻辑从业务容器里拿出来，放进一个同 Pod 的代理容器。业务照常连目标地址，代理在 netns 里劫持出站和入站。服务网格（service mesh）把它系统化：控制面下发配置，数据面执行 mTLS、超时、重试和指标。

拦截方式主要有两种。iptables 在 Pod 的 netns 里改写流量，出站请求被重定向到代理端口，入站请求也被劫持，代理再按 listener 和路由规则转发。Istio 的默认端口是 15001（出站）、15006（入站）、15090（指标）。eBPF 在 socket 层做重定向，少一次用户空间转发，Cilium 走这条路。

mTLS 让 Pod 之间的流量加密，并把身份绑定到证书上。SPIFFE 给每个工作负载一个可验证的 ID，代理用它做授权。业务容器看到的是明文，加密和解密都在代理里完成。

```text
app ──> 代理 ──mTLS──> 对端代理 ──> 对端 app
     (iptables 劫持)            (iptables 劫持)
```

看图时注意：业务和代理在同一个 netns，流量被 iptables 劫持；中间隔着两次代理和一次加密握手。

### 代价在哪里

第一是多一跳。本机回环变成“进代理、出代理、过网络、再进对端代理”，p99 通常增加几百微秒到几毫秒。第二是资源：Envoy 每个 Pod 几十 MB 内存，CPU 随连接数上涨。第三是生命周期：代理要在 app 之前 ready、之后退出，否则出站断或日志丢。第四是出错时分清 app 还是代理。

重试也是双刃剑。代理层重试对业务透明，但如果业务自己也有重试，两层叠加就是乘法；下游过载时，代理的重试会放大压力。协议也不透明：L7 能力只对 HTTP、gRPC 有效，MySQL 只能按 TCP 代理；TLS 透传和自定义端口要额外配置。

### 一次 p99 对比

在 CN3 的两个 netns 之间放一个用户态代理，模拟 sidecar。先用 `hey -z 30s -c 50 http://10.244.1.3:8080/` 直连，记录 p50 和 p99；再把请求指向代理，重启压测。直连 p99 假设 12 ms，经过代理可能 14 到 18 ms。杀掉代理，观察 app 是否还能出网，这就是“代理挂了业务断网”的最小复现。

### 坏掉的时候看到什么

代理没 ready，app 出站被拒；端口冲突，Pod 起不来；代理被 OOM，整个 Pod 失去出站。Job 类负载更麻烦：app 跑完退出，sidecar 还在等长连接，Pod 永远不完成。经典 sidecar 没有终止顺序保证，native sidecar 才能让代理在 app 之后退出。ambient mesh 把 L4 能力放到节点级 ztunnel，只给需要 L7 的工作负载配代理。

**多容器视角**：sidecar 是“和主容器共享网络”的典型用法，也是“多容器生命周期”的典型难点。代理要在 app 之前 ready，在 app 之后退出；健康检查要区分“app 活着”和“代理能出网”。`localhost` 通信看似简单，但一旦代理挂了，app 的出站就全断了。

### 和实验的关系

这一讲没有配套实验，是可以自己加的一步延伸：[CN3](cn3.html) 建好两个 netns 之后，在其中一个里跑一个最小 TCP 代理（`socat` 或几十行 Go），让 app 的出站必须经过它，就能观察到多一次跳转、端口冲突、代理先死后死。做完再回头看 [CN5](cn5.html) 里"sidecar 挂了会怎样"的验收问题，就不会只回答"重启它"。

### 检查一下自己

1. sidecar 为什么不能对所有协议透明？哪些协议需要额外配置？
2. 代理层的重试和业务层的重试叠加会发生什么？
3. 为什么 Job 类负载特别容易被 sidecar 卡住？

### 答案要点

1. L7 能力依赖协议解析；非 HTTP 协议只能按 TCP 代理，TLS 透传和自定义端口需要排除或额外配置。
2. 重试次数相乘，下游过载时被放大；还可能重复执行非幂等操作。
3. app 退出后代理仍持有连接、不会自动结束；没有 native sidecar 的终止顺序，Pod 无法完成。

**依据**：Istio 流量管理文档；SPIFFE 规范；Ambient Mesh 设计文档；Envoy 架构文档。

## 第 12 讲：有状态容器的 leader 与 fencing {#cn12}

用一句话说：StatefulSet 给稳定的名字和存储，不给“只有一个 leader”；租约决定谁在位，隔离令牌（fencing token）决定旧 leader 的写还算不算数。

### 两个 leader 同时写

三个副本的存储服务，leader A 因为一次 40 秒的 GC 暂停失去心跳，B 在 15 秒后当选。A 恢复后仍以为自己在线，继续接受客户端写入；B 也在写。两份日志写进同一个卷，后写的覆盖先写的，客户端看到已经确认的数据消失。事后复盘发现，选主逻辑没问题，缺的是存储层的 fencing：旧 leader 的写没有被拒绝。

### 稳定身份不等于单 leader

StatefulSet 给每个 Pod 一个稳定的名字（`pod-0`、`pod-1`）、稳定的网络标识（headless Service）和稳定的存储（PVC 模板）。它按顺序创建，按逆序删除，保证 `pod-0` 先起来。滚动更新时也从最大的序号开始。

这些保证的是“身份和存储不漂移”，不是“同一时刻只有一个 leader”。两个不同序号的 Pod 完全可能同时认为自己是 leader。选主必须由应用或一个协调服务来做。

选主要解决两个问题：怎么在正常情况下只有一个 leader，以及旧 leader 不知道自己已经过期时怎么办。租约（lease）解决第一个：leader 定期续约，租约到期前它有权写；其他副本在到期后可以竞选。隔离令牌（fencing token）解决第二个：每次选主发一个单调递增的编号，存储层拒绝比当前编号小的写。etcd 的 lease、Kubernetes 的 `Lease` 对象、Chubby 的 sequencer，都是这个思路。

### 时间线

```text
A: leader, token=7
t=0    A 被 SIGSTOP
t=15   租约到期，B 当选，token=8
t=40   A 恢复，仍以为自己是 leader
       写 token=7 ──> 存储层比较：7 < 8，拒绝
```

看这张图时注意：A 恢复后不会自动知道 B 存在；让它安全的不是 A 的自觉，而是存储层那一次比较。没有 fencing，A 的写会成功，双主就发生了。

租约依赖时钟。leader 的续约间隔、租约长度、副本的检查间隔，三者要满足“续约间隔 < 租约长度”，并且留出网络延迟的余量。GC 暂停、虚拟机迁移、时钟漂移都会让 leader 在自以为还持有时已经过期。把租约设得很长可以减少误切换，但故障恢复变慢；设得很短，网络抖动就会引发不必要的选主。

### 一次 SIGSTOP 实验

在 CN5 的平台里起三个进程模拟副本，用一个文件或 etcd 的 lease 做选主。用 `kill -STOP <leader_pid>` 暂停 leader 40 秒，观察 B 在租约到期后当选；再 `kill -CONT` 恢复 A，让它尝试写。如果存储层检查 token，A 的写被拒绝；把检查去掉，再跑一次，就能看到两份写都成功。这个对比比任何时序图都清楚。

### 坏掉的时候看到什么

只有租约没有 fencing，GC 暂停和网络分区都会产生双主。fencing token 只在每条写路径都检查时才有效，缓存、批量提交、备份恢复都可能绕过它。租约续约失败但进程还在跑，它会继续服务读请求，读到过期数据。StatefulSet 的有序创建只保证启动顺序，不保证旧 Pod 已经停止；缩容时如果应用没处理 `SIGTERM`，新旧副本可能短暂共存。

**多容器视角**：有状态 Pod 常常是 app 加 backup sidecar 加 metrics sidecar。backup 要等 app 完成 checkpoint，metrics 不能干扰 I/O，init container 可能负责从备份恢复。顺序、权限、资源隔离都要设计，不能假设“sidecar 只是辅助”。backup 读到半个快照，比没有备份更危险。

### 和实验的关系

[CN5](cn5.html) 的混沌矩阵有五类：进程崩溃、网络分区、磁盘满、OOM、时钟跳变。其中"进程崩溃"和"网络分区"是这一讲能用到的两类——但它们只验证"坏了会怎样"，不验证 fencing 本身；CN5 里没有 leader 或 fencing 的验收项。想做这一讲的实验，得自己在平台里加三个进程模拟副本、把 fence token 落到存储层检查；上面那个 `kill -STOP` 场景就是最小版本。验收时会问"两个 Pod 抢同一个卷会怎样"，答案要落到租约、fencing 和存储层的检查，而不是"StatefulSet 会保证"。

### 检查一下自己

1. StatefulSet 为什么需要 headless Service？
2. 两个 Pod 同时认为自己 leader，哪些机制能阻止双写？
3. 为什么只有租约不够？

### 答案要点

1. 每个 Pod 需要稳定的 DNS 名，让客户端和副本能按名字找到它；headless Service 直接返回 Pod IP，不经过 VIP。
2. 租约保证正常情况下的唯一性，fencing token 让存储层拒绝旧 leader 的写；两者叠加才能防双写。
3. 租约依赖时间和心跳，GC 暂停或网络分区会让旧 leader 在过期后仍自认为有效；没有存储层的 fencing，它照样能写。

**依据**：Kubernetes StatefulSet 与 Lease 文档；Chubby 论文的 sequencer 一节；etcd lease 文档。

## 第 13 讲：p99 从哪里来 {#cn13}

用一句话说：平均值会骗人，尾延迟才会暴露排队；要回答“慢在哪”，得同时看指标、日志和追踪。

### 平均 CPU 30%，p99 两秒

值班时看板显示 CPU 平均 30%，内存也平稳，但用户投诉 p99 到了 2 秒。把时间轴拉开，发现问题集中在一分钟内：某个容器每 100 ms 被限流一次，请求正好撞上配额边界，排队 200 ms；重试又把少量请求放大。平均值把这些尖刺抹平了，只有分位数和 throttling 计数能看见。

### 三类信号，各回答一个问题

指标（metrics）回答“多少”。计数器只增不减，适合算速率；仪表盘值可增可减，适合看当前状态；直方图（histogram）把观测值放进桶里，才能算分位数。平均值不能算分位数，也不能把两个实例的 p99 平均成一个 p99。Prometheus 的 `histogram_quantile` 就是在桶边界上做插值，桶划得太粗，p99 会失真。

日志（logs）回答“发生了什么”。多容器 Pod 的日志是几路独立的流，采集器要带上 Pod、容器、请求 ID，否则三路日志对不上。结构化日志比一行文本好查，但也更容易写漏字段。

追踪（traces）回答“时间花在哪”。一个请求跨三个容器，每个容器一段 span，靠 trace context 串起来。OpenTelemetry 是通用的采集和传播方案；采样率太高会拖慢服务，太低会漏掉尾请求。

```text
客户端 span ──> app span ──> sidecar span ──> 下游 span
   │              │              │               │
   └──────────────┴──────────────┴──────────────┘
              同一个 trace ID，四段时间相加才是端到端
```

看图时注意：端到端延迟是各段之和再加排队；只看服务端 span，会把网络和客户端排队漏掉。

### 先分清资源，再看调用链

CPU 看 throttling、run queue 和 context switch；`cpu.stat` 的 `nr_throttled` 和 `throttled_usec` 比利用率更能解释尾延迟。内存看 page cache、RSS、OOM 和 PSI；`memory.pressure` 的 `full` 行能看出有多少时间所有任务都被卡住。I/O 看 `iostat` 的 await 和 util，注意 direct I/O 与 page cache 的区别。网络看 retransmit、连接状态和队列。

分位数要在正确的粒度上算。按 Pod 算、按容器算、按路由算，结论可能完全不同。把多个实例的 p99 取平均是常见错误；正确做法是保留桶，合并后再算，或者直接看最差实例。客户端和服务端各测一次，差值就是网络和排队的成本。

### 一次定位

给 CN2 的迷你 Pod 加一个 HTTP 服务，用 `tc qdisc add dev veth1 root netem delay 100ms` 注入延迟，再用 `hey -z 30s -c 20` 压测。客户端 p50 应该增加约 100 ms，p99 增加得更多。然后用 `curl -s localhost:15000/stats` 或应用自己的指标，对比服务端处理时间和客户端总时间；差值就是网络加代理。最后查 `cpu.stat`，确认没有 throttling 混在里面。

### 坏掉的时候看到什么

只报平均值，故障被抹平。直方图桶太粗，p99 落在最后一个桶里，只能说明“大于 1 秒”。把实例的 p99 平均，得到的是一个不存在的数。trace 采样偏向成功请求，尾延迟永远看不到。

eBPF 挂太多探针，自己成了瓶颈。日志没有 trace ID，三路日志只能靠时间戳猜。多容器 Pod 里只采集 app 的日志，sidecar 的 5xx 完全丢失。

**多容器视角**：一个 Pod 里三个容器，日志有三路，指标有三维标签，trace 要跨三次进程边界。你以为在观察一个服务，其实在观察三个进程加一个 network namespace。先把“容器”作为标签加进去，再谈聚合；否则 sidecar 的错误会被算到 app 头上。

### 和实验的关系

[CN5](cn5.html) 要求每个容器的 CPU、内存、重启次数和日志流都能看到，还要有一个 p99 面板。做法不复杂：在 runner 里按容器记指标，日志带容器名，trace 在进入和离开时各打一个 span。做完这一讲的内容，capstone 的“能不能解释为什么”才有数据支撑。

### 检查一下自己

1. 为什么平均 CPU 会误导？你会看哪些指标判断 throttling？
2. 为什么不能把多个实例的 p99 取平均？
3. 为什么要在客户端和服务端各测一次？

### 答案要点

1. 平均值抹平尖刺；看 `cpu.stat` 的 `nr_throttled`、`throttled_usec` 和 PSI 的 `cpu.pressure`。
2. 分位数不是线性统计量，平均后的数不对应任何真实实例；要合并直方图桶再算。
3. 客户端总时间减去服务端处理时间，差值就是网络、代理和排队的成本。

**依据**：Google SRE 手册的监控与 SLO 章节；Prometheus `histogram_quantile` 文档；cgroup v2 PSI 文档；OpenTelemetry 规范。

## 第 14 讲：Capstone：多容器 Agent 平台 {#cn14}

用一句话说：capstone 不是把 Kubernetes 包一层，而是用前十三讲的机制拼一个能启动、能坏、能解释的迷你平台。

### demo 上的三个问题

演示当天，平台起了三个 Pod。评委问：“sidecar 挂了会怎样？”杀掉 sidecar，app 的出站全断，但健康检查仍然通过，平台没有任何告警。

第二个问题：“节点断电后工作区是什么状态？”没人答得上来。第三个问题：“两个 Pod 抢同一个卷呢？”回答是“应该不会吧”。能跑不等于能解释。

### 把前十三讲拼成一个控制循环

平台的核心是一个控制循环（control loop）。你读一个 Pod 风格的 spec，算出期望状态：哪些容器、什么顺序、共享哪个 netns 和卷、资源上限多少。然后观察当前状态：哪些进程活着、退出码是什么、卷的版本是哪一版。两者不一致就执行动作：启动、停止、重启、提交或回滚工作区。这个循环要幂等（idempotent），重复执行同一个 spec 不会产生额外副作用；要 level-triggered，看到当前状态算下一步，而不是依赖某条事件不丢。

分工直接对应前面的实验。CN1 提供 namespace、cgroup 和 rootfs；CN2 提供 pause、init、app、sidecar 的启动顺序和信号处理；CN3 提供 netns、veth、bridge、NAT 和 Service VIP；CN4 提供 overlayfs 工作区和 commit/rollback。拼起来之后，平台要守住几条不变量：Pod 的 netns 只有一个持有者；init 没成功 app 不起；每个容器都有资源上限；工作区在任意时刻只有一个已提交版本。

```text
spec ──> 期望状态
            │
            ▼
      reconcile 循环 ──> 启动 / 停止 / 重启
            ▲                    │
            │                    ▼
         观察状态 <── 进程、退出码、卷版本、指标
```

看图时注意：循环的每一圈都要能从崩溃中恢复；平台自己被杀掉后重启，应该根据磁盘上的状态继续，而不是从头再来。

### 可观测性和混沌测试是一等公民

最低要求里，可观测性不是加分项。每个容器要有 CPU、内存、重启次数和日志流；整个 Pod 要有一个 p99 面板；工作区要有版本号和提交时间。没有这些，混沌测试只能看到“挂了”，说不出“为什么挂、恢复了多久、影响了谁”。

混沌测试至少覆盖四类：杀容器、OOM、网络分区、磁盘满。每一次都要记录注入前的状态、观察到的现象、恢复路径和未解决的问题。故障报告（postmortem）按时间线写：什么时候注入、第一个异常信号是什么、哪个假设被推翻、下次怎么更早发现。报告里要能回答“如果 sidecar 挂了会怎样”“如果节点断电会怎样”“如果两个 Pod 抢同一个卷会怎样”。

### 一次验收

用 `./mp apply -f pods/agent.yaml` 起一个 Pod，`./mp get pods` 的 `READY` 列应该是 `2/2`（app 和 sidecar）。`kill -9` app 的 PID，五秒内 `RESTARTS` 加 1、Pod 仍是 `Running`；sidecar 不受影响。给 veth 加 `tc qdisc add dev veth1 root netem loss 100%` 持续 30 秒，app 请求失败但进程不退出。在 commit 过程中 `kill -9` 平台，重启后工作区要么是旧版本，要么是新版本，不能混合。命令和验收项的完整清单见 [CN5](cn5.html)。

### 边界和常见失败

最常见的失败是把 capstone 做成 Kubernetes 的包装层：能演示，但底层一坏就说不清。第二常见的是只测 happy path：混沌测试只杀 app，不碰 sidecar、网络和磁盘。第三是权限没限制住，平台以 root 跑，容器有 `CAP_SYS_ADMIN`，验收时被一句“这能逃逸吗”问住。第四是日志和指标只覆盖 app，sidecar 的错误被算到 app 头上。

### 和实验的关系

[CN5](cn5.html) 就是这份清单的验收：能起来、坏了能恢复、能解释为什么、权限限制住。评分看的是能不能在没有 Kubernetes 的机器上把同一件事讲清楚。

### 检查一下自己

1. 为什么 reconcile 必须幂等？重复执行会坏在哪里？
2. 混沌测试要记录哪四类信息？
3. 平台自己崩溃后重启，应该从哪里恢复状态？

### 答案要点

1. 控制器可能因为重试、重启、重复事件多次执行；不幂等会重复启动容器、重复提交工作区。
2. 注入前的状态、观察到的现象、恢复路径、未解决的问题。
3. 从磁盘上的持久状态恢复：已提交的工作区版本、容器期望状态和退出记录，而不是内存里的临时变量。

**依据**：Kubernetes 控制器与 Pod Lifecycle 文档；CN1–CN5 任务书；Google SRE 手册的 postmortem 模板。

## 实验任务书

| # | 实验 | 交付物 | 环境 |
|---|---|---|---|
| CN1 | Build a container from scratch | 隔离 shell + cgroup 内存限制 | Linux/WSL2 |
| CN2 | Mini Pod lifecycle | pause/init/app/sidecar + 信号 | Linux/WSL2 |
| CN3 | CNI and Service | veth/bridge/NAT/DNAT；可选：DNS、超时与重试 | Linux/WSL2；网络受限时用 VM |
| CN4 | Workspace transaction | overlayfs commit/rollback + 崩溃测试 | Linux/WSL2 |
| CN5 | Capstone | 迷你多容器平台 + 混沌测试 | Linux/WSL2 |

每个实验都有独立任务书，按“你将完成什么 → 开始之前 → 阶段拆解 → 常见错误”组织；讲义给原理，任务书给可执行的步骤和验收。

- [CN1：从零做一个容器](cn1.html)
- [CN2：迷你 Pod 生命周期](cn2.html)
- [CN3：CNI 与 Service](cn3.html)
- [CN4：工作区事务](cn4.html)
- [CN5：Capstone——多容器 Agent 平台](cn5.html)
- [CN5 附录：故障报告与混沌测试](cn5-report.html)

### CN1：从零做一个容器 {#lab-cn1}

不用 Docker/containerd，用 `clone`/`unshare`、`pivot_root` 和 cgroup v2 跑起一个隔离的 shell，再接上 judge 的契约测试。完整任务书：[CN1](cn1.html)。

### CN2：迷你 Pod 生命周期 {#lab-cn2}

实现一个 pause 进程持有 netns，让 init、app、sidecar 按顺序启动、共享卷、按信号退出。完整任务书：[CN2](cn2.html)。

### CN3：CNI 与 Service {#lab-cn3}

手写一个最小 CNI 插件：veth、bridge、NAT，再用 DNAT 做一个 Service VIP。完整任务书：[CN3](cn3.html)。

### CN4：工作区事务 {#lab-cn4}

用 overlayfs 和 manifest 让多个容器共享一个工作区，支持原子 commit/rollback 和崩溃恢复。完整任务书：[CN4](cn4.html)。

### CN5：Capstone——多容器 Agent 平台 {#lab-cn5}

把 CN1–CN4 组合成一个能跑、能坏、能解释的迷你平台，附混沌测试和故障报告。完整任务书：[CN5](cn5.html)；报告模板见 [CN5 附录](cn5-report.html)。
