# INFRA 02 · 云原生系统

> 14 lectures · 5 labs · Linux/WSL2
>
> 核心实验在单机 Linux 或 WSL2 上完成：2 vCPU、4 GB 内存、20 GB 磁盘；不需要 GPU、KVM 或多节点集群。

## 课程说明

云原生很容易学成一套 YAML 语法：`kubectl apply`、`Deployment`、`Service`、`Ingress`。但真正的事故很少出在 YAML 写错，而是出在**多容器**的边界上：init container 没跑完 app 就起来了；sidecar 没退出，Pod 卡在 Terminating；两个容器写同一个 volume，读到一个写了一半的文件；一个容器 OOM，整个 Pod 被驱逐；Service 的 VIP 能通，但 sidecar 里的 DNS 不通。

这些问题的共同点是：**多个进程共享一部分资源，但各自的生命周期、权限、资源配额和观测视角不同**。Kubernetes 用 Pod 把“必须一起调度、共享网络和卷”的容器绑在一起，但没有替你想清楚生命周期、信号、文件原子性和故障隔离。这门课逐个讨论这些边界。

十四讲按“从进程到集群”的顺序展开：namespace/cgroup/rootfs → OCI/CRI → 镜像/供应链 → Pod → 生命周期 → 网络 → 服务通信 → 存储 → 调度 → 隔离 → sidecar → 有状态 → 可观测性 → capstone。核心实验不需要 Kubernetes；kind/k3s 是可选进阶。

## 怎么开始

1. 读 [第 1 讲 从进程到容器](#cn1) 和 [第 2 讲 容器运行时](#cn2)。
2. 打开 [CN1 任务书](#lab-cn1)，先做一个隔离 shell。
3. 准备 rootfs 和实现后，跑 `SUBMISSION=./cn1 CN1_ROOTFS=/path ./judge/run.sh infra02 cn1`。
4. 延伸参考（可选）：[OCI Runtime Spec](papers.html)、[cgroup v2 文档](papers.html) 和 [官方 lab 页](https://pdos.csail.mit.edu/6.5840/labs/lab-container.html)。讲义已经覆盖 CN1 所需的概念。

作业总览在 [作业与实验](labs.html)；评分标准在 [评分标准](grading.html)。

## 先修要求

- 会 Linux 基本命令，知道进程、文件、socket。
- 会 Go 或 C；能读 RFC/规范。
- 最好做过 INFRA 01 的 Lab 1–2，但不是硬性要求。

## 课程安排

| # | 主题 | 关键问题 | 实验 |
|---|---|---|---|
| 1 | From process to container | 容器到底是什么？ | [CN1](#lab-cn1) |
| 2 | Runtime and CRI | 谁持有 netns、stdio、僵尸进程？ | [CN1](#lab-cn1) |
| 3 | Images and supply chain | 为什么 tag 不能保证镜像内容？ | [CN1](#lab-cn1) |
| 4 | Pod | 为什么 Pod 是最小调度单位？ | [CN2](#lab-cn2) |
| 5 | Lifecycle and signals | 为什么 Pod 会卡在 Terminating？ | [CN2](#lab-cn2) |
| 6 | Networking | Pod 如何拿到 IP、访问 Service？ | [CN3](#lab-cn3) |
| 7 | Service communication | 重试为什么会放大故障？ | [CN3](#lab-cn3) |
| 8 | Storage | 多文件工作区如何原子提交？ | [CN4](#lab-cn4) |
| 9 | Scheduling and resources | requests/limits 与 throttling 的关系？ | [CN5](#lab-cn5) |
| 10 | Isolation and security | 什么时候容器才是安全边界？ | [CN5](#lab-cn5) |
| 11 | Sidecar and service mesh | 透明代理的代价是什么？ | [CN3](#lab-cn3) |
| 12 | Stateful multi-container | 谁是 leader，怎么 fence？ | [CN5](#lab-cn5) |
| 13 | Observability and performance | p99 从哪里来？ | [CN5](#lab-cn5) |
| 14 | Capstone | 坏了能不能解释？ | [CN5](#lab-cn5) |

## 实验

| # | 实验 | 交付物 | 环境 |
|---|---|---|---|
| CN1 | Build a container from scratch | 隔离 shell + cgroup 内存限制；可选：手写 OCI layout | Linux/WSL2 |
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

- CN1 通过本地 judge；其他 lab 按验收标准自测；CN5 附一份故障报告。
- 能不看代码讲清楚多容器的生命周期、共享资源、失败模式。
- 回答至少 3 个 design questions；代码私有。

## 阅读

[阅读](papers.html) 有论文、白皮书和规范的定位；重点读 OCI Image/Runtime Spec、CNI/CSI Spec、Kubernetes Pod Lifecycle 文档、Borg、Firecracker。

以下是 14 讲的讲义，按课程顺序排列。

## 第 1 讲：从进程到容器 {#cn1}

第一次看 `docker run`，很容易把它当成一台轻量虚拟机。它启动得比 VM 快，`ps` 里只有自己的进程，文件系统看起来也是独立的。但它不是 VM：它和宿主机共享同一个内核。容器只是一个被改了“视角”的进程——它看到的 PID、网络、挂载点、主机名、IPC 都被 namespace 隔离，资源被 cgroup 限制，根文件系统被换成了镜像里的那一层。

Linux 的 namespace 有八种：PID、mount、network、IPC、UTS、user、cgroup、time。PID namespace 让容器里的进程看不见宿主进程，容器里的 PID 1 是它自己的 1 号；mount namespace 让容器有独立的挂载表；network namespace 让容器有独立的网卡、路由和端口空间；user namespace 让容器里的 root 可以不是宿主机的 root。`clone(2)` 或 `unshare(2)` 创建这些命名空间，`/proc/<pid>/ns/` 可以看到一个进程属于哪些命名空间。

cgroup v2 负责资源，不负责隔离。`cpu.max` 限制 CPU 带宽，`memory.max` 是硬上限，`memory.high` 是软上限（超过会被限流而不是直接杀），`pids.max` 限制进程数，`io.max` 限制块设备 I/O。cgroup 是树状的：一个 cgroup 下的所有进程共享配额，子 cgroup 可以再分。容器运行时通常给每个容器建一个 cgroup，Pod 再建一层父 cgroup。

根文件系统来自镜像。镜像是一组只读层，运行时用 overlayfs 把它们叠起来，再加一个可写层。`pivot_root(2)` 把进程的根切到新目录，比 `chroot` 更彻底；但 `pivot_root` 要求新根是一个挂载点，而且要把旧根移走。你还要挂 `/proc`、`/sys`、`/dev`，否则 `ps`、`free`、`/dev/null` 都会出问题。

容器不等于安全边界。它共享宿主内核，内核漏洞、错误配置的 capability、挂载了 Docker socket、以 privileged 运行，都可以逃逸。后面第 10 讲会展开。

**多容器视角**：Pod 里的容器默认各自有 PID、mount namespace，但共享 network namespace 和卷。共享网络意味着它们用同一个 IP、同一组端口；共享卷意味着它们能看到同一批文件。这两条是后面所有多容器问题的根源。

**实验**：[CN1](#lab-cn1) 用 `clone`/`unshare` 从零做一个容器，再加 cgroup 内存限制。

**自测**

- 为什么容器里的 `ps` 看不到宿主进程？还有哪些东西没有隔离？
- `memory.high` 和 `memory.max` 的行为有什么不同？

**作业**：[CN1](#lab-cn1) · [作业总览](labs.html)

**参考**：[阅读](papers.html)

## 第 2 讲：容器运行时与 CRI {#cn2}

`kubectl apply` 是声明式的，但最终一定要有人 `fork` 一个进程。这条路径大致是：API server 收到 Pod 对象，scheduler 选节点，kubelet 调 CRI，containerd 准备镜像和快照，runc 创建 namespace/cgroup 并 `execve`，最后 `containerd-shim` 留下来看住这个进程。

OCI 定义了两个规范：image spec 规定镜像的层、配置和环境；runtime spec 规定一个容器怎么跑（进程参数、挂载、命名空间、cgroup、capability）。符合 OCI 的运行时不止 runc：`runsc`（gVisor）、`kata-runtime`（轻量 VM）、`crun` 都可以。containerd 不直接管进程，它把“创建容器”交给 runtime，把“容器活着”交给 shim。shim 的作用是让 containerd 重启时容器不死，同时持有 stdio、回收僵尸进程。

CRI 是 kubelet 和运行时之间的接口：`RunPodSandbox` 创建 Pod 的沙箱（通常是 pause 容器），`CreateContainer`/`StartContainer` 创建并启动业务容器，`StopContainer`/`RemoveContainer` 负责收尾。pause 容器非常小，只做一件事：持有 Pod 的 network namespace。业务容器通过 `setns` 加入这个 netns，所以它们共享 IP 和端口空间。

**多容器视角**：Pod 的“沙箱”不是抽象名词，它就是一个真实存在的 pause 容器。你 `crictl ps` 看到的第一个容器通常是它。pause 被杀，Pod 的网络就没了；业务容器即使还活着，也会失去网络。

**动手**：用 `runc` 手写一个 `config.json`，把一个 rootfs 跑起来；如果你有单节点 kind（可选），用 `crictl` 或 `ctr` 观察 pause 容器；没有就手写一个 pause + netns 的沙箱。不要背 CRI 的接口，先看清“谁持有 netns、谁持有 stdio、谁负责回收”。

**自测**

- containerd 重启后，为什么已经运行的容器不会死？
- pause 容器到底持有什么？为什么不能直接用业务容器当沙箱？

**作业**：[CN1](#lab-cn1) · [作业总览](labs.html)

**参考**：[阅读](papers.html)

## 第 3 讲：镜像、构建与供应链 {#cn3}

容器跑起来的根文件系统来自镜像。镜像不是一个单独的文件，而是一组内容加一份清单：manifest 列出 config 和 layers；config 记录环境变量、入口命令、工作目录；每个 layer 是一个 tar 包，用内容的 hash（digest）命名。`docker pull` 先拉 manifest，再按 digest 拉 layer；tag 只是指向 digest 的一个可变名字。

构建镜像时，每条 Dockerfile 指令通常生成一层。层可以缓存，所以指令顺序会影响构建速度：把不常变的依赖安装放在前面，把经常变的源码复制放在后面。多阶段构建（multi-stage build）把编译环境和运行环境分开，只把最后阶段的文件复制进最终镜像，能减小体积，也减少攻击面。

“可复现构建”指同样的源码和构建参数，得到同样的 digest。难点在时间戳、文件顺序、包版本、构建路径和网络。常见做法是固定基础镜像的 digest、固定包版本、设置 `SOURCE_DATE_EPOCH`、避免在构建时下载未固定版本的依赖。

供应链要回答三个问题：这个镜像里有什么（SBOM）、是谁构建的（provenance 和签名）、拉下来的是不是当初构建的那个（digest 校验）。`cosign`、`in-toto`、SLSA 是常见的工具和框架；课程不要求全部用上，但要求你知道 tag 不能作为完整性保证。

**单机练习**：用 `tar` 手工做一个 OCI layout（`oci-layout`、`index.json`、`blobs/sha256/...`），用 `skopeo` 或 `umoci` 检查它能否被识别；对比同一个 Dockerfile 两次构建的 digest，找出不一致的来源。

**自测**

- 为什么不能只凭 tag 判断镜像内容？
- 多阶段构建省掉了什么？它有没有引入新的风险？
- SBOM 和签名分别解决什么问题？它们能防住什么，防不住什么？

**作业**：[CN1](#lab-cn1) · [作业总览](labs.html)

**参考**：[阅读](papers.html)

## 第 4 讲：Pod 是多容器的最小单位 {#cn4}

一个典型的推理服务 Pod 可能有四个容器：init container 下载模型；app 提供 HTTP 服务；sidecar 收集日志和指标；ephemeral container 在出问题时进去调试。它们为什么要放在一个 Pod 里，而不是四个独立的 Pod？

因为 Pod 表达了一组**必须共同调度、共享网络和卷**的约束。它们必须在同一台节点上，必须共享同一个 network namespace，必须能通过 `localhost` 互相访问，必须挂同一个 `emptyDir`。Pod 是 Kubernetes 的原子调度单位：要么一起上来，要么一起不上来。这不是为了方便，而是为了让“本地协作”的容器不需要走 Service、不需要跨节点复制数据。

init container 按顺序执行，每个都必须成功退出，才会启动下一个；它们可以有和 app 不同的镜像、不同的权限。app 容器并行启动，没有顺序保证。sidecar 有两种：经典 sidecar 就是普通的第二个容器，启动顺序不保证；native sidecar 放在 `initContainers` 里，但 `restartPolicy: Always`，它会在 app 之前启动，在 app 之后终止。ephemeral container 用于调试，不能加资源限制，也不能在创建时指定端口。

`shareProcessNamespace: true` 会让 Pod 里的容器共享 PID namespace，此时它们能看见彼此的进程；默认不共享。共享 PID 对调试有用，但也意味着一个容器可以给另一个容器发信号——这是权限边界，不是便利开关。

**多容器视角**：Pod 的共享网络让 `localhost:8080` 成为容器间的默认通信方式，但也让端口冲突变成 Pod 级问题；共享卷让容器间传文件很方便，但也让并发写变成 race。init container 适合做“必须完成的前置条件”，sidecar 适合做“和主容器同生共死的辅助进程”，不要把两者混用。

**实验**：[CN2](#lab-cn2) 实现一个迷你 Pod runner：pause + init + app + sidecar，共享 netns 和卷，验证启动顺序和优雅退出。

**自测**

- 经典 sidecar 为什么不能保证在 app 之前启动？native sidecar 改了什么？
- `shareProcessNamespace` 打开了什么？关闭时容器之间还能怎么发信号？

**作业**：[CN2](#lab-cn2) · [作业总览](labs.html)

**参考**：[阅读](papers.html)

## 第 5 讲：生命周期、信号与优雅退出 {#cn5}

Pod 卡在 Terminating 是最常见的多容器故障之一。表面上看是“删除很慢”，实际原因通常有三类：容器里的 PID 1 不转发信号；sidecar 还在等一个永远不会来的连接；`preStop` 或 `terminationGracePeriodSeconds` 配得太长。

容器里的 1 号进程有特殊语义：它没有默认的信号处理器，内核不会替它忽略 `SIGTERM`，但如果它是 shell，shell 不一定会把信号转发给子进程。`CMD ["/app"]`（exec form）让 `/app` 成为 PID 1；`CMD /app`（shell form）会变成 `/bin/sh -c /app`，PID 1 是 shell，`SIGTERM` 可能根本到不了 `/app`。这就是为什么很多镜像要用 `tini`、`dumb-init` 或自己实现 signal forwarding。

Kubernetes 删除 Pod 的流程大致是：API server 标记 deletionTimestamp；endpoint controller 把 Pod 从 Service endpoints 里摘掉；kubelet 执行 `preStop`；然后给每个容器发 `SIGTERM`；等 `terminationGracePeriodSeconds`（默认 30 秒）；还没退出就 `SIGKILL`。native sidecar 会在普通容器之后终止，给日志 flush 留时间；经典 sidecar 没有这个保证，所以要么自己协调，要么用 native sidecar。

僵尸进程是另一个坑。容器里的 PID 1 要负责 `wait` 孤儿进程；如果 PID 1 是业务进程，它通常不会做这件事，僵尸就会堆积。`PR_SET_CHILD_SUBREAPER` 可以让一个进程收养孤儿；`tini` 默认做这件事。`cgroup.kill` 可以一次杀掉整个 cgroup 的进程，比逐个 `kill` 可靠，但它是强制手段，不适合优雅退出。

**多容器视角**：优雅退出不是“一个容器的事”。app 要先停止接收新请求，sidecar 要等 app 把日志写完，日志采集器要等 sidecar flush。谁先谁后，取决于你把谁放在 native sidecar、谁放在普通容器，以及 `preStop` 里做了什么。

**实验**：[CN2](#lab-cn2) 的第二步：给 app 发 `SIGTERM`，观察 sidecar 和 pause 的行为；实现一个 subreaper，回收孤儿；测量滚动更新期间的 in-flight 请求。

**自测**

- 为什么 `docker stop` 有时要等 10 秒？`SIGTERM` 到底发给了谁？
- native sidecar 的终止顺序是什么？为什么这个顺序对日志很重要？

**作业**：[CN2](#lab-cn2) · [作业总览](labs.html)

**参考**：[阅读](papers.html)

## 第 6 讲：多容器网络 {#cn6}

Pod 网络的目标是：每个 Pod 有一个集群内可路由的 IP；Pod 内的容器共享这个 IP 和端口空间；Pod 之间可以直接通信；Service 提供一个稳定的虚拟 IP。实现这件事的层次不少：network namespace、veth pair、bridge、路由、NAT、conntrack、CNI、kube-proxy、DNS。

创建一个 Pod 网络时，CNI 插件通常会：创建 netns；创建一对 veth，一头放进 netns，一头接到宿主机 bridge；给容器侧分配 IP；加默认路由；在宿主机加 NAT 规则，让容器能出网。overlay 网络（VXLAN）把二层包封进 UDP，underlay 网络（BGP）则让宿主机直接路由 Pod CIDR。Calico、Cilium、Flannel 的差别，很大程度上是“用 overlay 还是 underlay、用 iptables 还是 eBPF”。

Service 的 ClusterIP 是一个虚拟 IP，没有网卡持有它。kube-proxy 在 iptables 里写 DNAT 规则，把发往 VIP 的包改到某个 Pod IP；IPVS 模式用内核的 IPVS；Cilium 用 eBPF 在 socket 层做负载均衡。DNS 由 CoreDNS 提供，Pod 的 `/etc/resolv.conf` 指向它；headless Service 不走 VIP，直接返回 Pod IP，供 StatefulSet 使用。NetworkPolicy 是 L3/L4 的标签选择器，默认拒绝需要显式配置。

**多容器视角**：Pod 内容器共享 netns，所以它们用同一个 IP、同一组端口。sidecar 代理要拦截流量，通常靠 iptables 重定向或 eBPF；这会影响 `localhost` 通信、健康检查端口和出网路径。`hostNetwork: true` 让 Pod 直接用宿主网络，性能更好，但端口冲突、NetworkPolicy 往往不生效、DNS 行为都会变。

**实验**：[CN3](#lab-cn3) 手写一个 CNI 风格的插件：netns、veth、bridge、IP、路由、NAT；再加一个 Service VIP 的 DNAT。

**自测**

- 为什么 Pod 需要一个 pause 容器来持有网络？没有它会怎样？
- `hostNetwork: true` 会破坏哪些假设？

**作业**：[CN3](#lab-cn3) · [作业总览](labs.html)

**参考**：[阅读](papers.html)

## 第 7 讲：服务通信与可靠性 {#cn7}

Pod 网络解决“能到达”，服务通信解决“可靠地到达”。一个请求从客户端到服务端，至少经过 DNS 解析、TCP 建连、TLS 握手、HTTP/gRPC 编码、负载均衡、超时和重试。每一层都可能失败，而且失败的样子不同。

DNS 是常见的尾延迟来源。`/etc/resolv.conf` 里的 `search` 域和 `ndots` 会让短名字先尝试多个后缀；解析失败时，客户端可能等满超时。CoreDNS 的缓存、上游 DNS 的可用性、UDP 丢包都会影响 p99。排查时先分清“名字解析失败”和“连接失败”，不要一律归因于网络。

TCP 建连有握手和 backlog；大量短连接会让 `TIME_WAIT` 堆积。HTTP/1.1 默认一条连接一个请求，HTTP/2 多路复用，gRPC 基于 HTTP/2。连接池能省掉重复建连，但池太小会排队，池太大可能压垮下游。

超时和重试要一起设计。连接超时、读超时、总 deadline 是三件事；只设一个“30 秒”通常不够。重试要有次数上限、指数退避、jitter 和预算；非幂等请求不能盲目重试。重试会放大故障：下游已经过载时，每个客户端再重试三次，流量会变成四倍。

**单机练习**：用两个 netns 加一个用户态代理（`socat`、`nginx` 或自己写的 Go 程序），用 `tc netem` 注入 100ms 延迟和 1% 丢包；用 `wrk` 或 `hey` 测 p50/p99；把超时调小，观察重试和错误率。

**自测**

- 为什么重试会放大故障？超时和重试应该怎么配合？
- DNS 解析失败和 TCP 连接失败，排查手段有什么不同？
- gRPC 的 deadline 怎么跨服务传播？不传播会发生什么？

**作业**：[CN3](#lab-cn3) · [作业总览](labs.html)

**参考**：[阅读](papers.html)

## 第 8 讲：多容器存储与工作区原子性 {#cn8}

多容器共享卷是最方便的 IPC，也是最容易出 race 的地方。两个容器同时写一个文件，POSIX 的 `write` 并不保证“读者看到完整内容”；一个容器写完没 `fsync`，节点崩溃后文件可能只写了一半；一个容器用 `rename` 做原子替换，另一个容器却打开着旧文件，看到的是旧 inode。

Kubernetes 的卷抽象有几层：`emptyDir` 随 Pod 创建和删除，适合临时缓存；`hostPath` 直接挂节点目录，危险但有用；PV/PVC 通过 CSI 接入块存储或网络存储；`subPath` 把卷的一个子目录挂进容器。访问模式 `ReadWriteOnce` 表示卷只能被一个节点以读写方式挂载，不是“一个容器”，也不是文件锁；`ReadWriteMany` 需要底层存储支持，NFS/CephFS 可以，EBS 通常不行。

要做“原子更新一个工作区”，POSIX 给的工具其实够用：写临时文件；`fsync` 文件；`rename` 到目标名；`fsync` 父目录。`rename` 在同一条文件系统内是原子的，读者要么看到旧文件，要么看到新文件，不会看到写了一半的内容。`O_TMPFILE` 可以创建一个没有名字的临时文件，写完再用 `linkat` 挂到目标名；`renameat2(RENAME_EXCHANGE)` 可以原子交换两个文件。overlayfs 的 copy-up 会让第一次写触发整文件复制，大文件要注意；reflink（`FICLONE`）在支持的文件系统上可以做到近似 O(1) 的副本。

**多容器视角**：共享卷的并发写没有万能办法。要么约定单写者（一个容器负责写，其他只读），要么用文件锁（`flock`，但 NFS 上的语义要小心），要么用“临时文件 + 原子 rename”让读者永远看到完整版本。INFRA 03 会把这件事提升为 `workspace.commit` / `workspace.rollback` 两个原子操作。

**实验**：[CN4](#lab-cn4) 用 overlayfs 做一个共享工作区，实现 commit/rollback，并用 `kill -9` 做崩溃测试。

**自测**

- `ReadWriteOnce` 为什么不是文件锁？
- `fsync` 文件之后，为什么还要 `fsync` 目录？

**作业**：[CN4](#lab-cn4) · [作业总览](labs.html)

**参考**：[阅读](papers.html)

## 第 9 讲：调度与资源 {#cn9}

Pod 处于 Pending，常见原因不是“没有 CPU”，而是“没有满足 requests 的节点”。Kubernetes 的调度看的是 requests，不是实时用量；节点上的 kubelet 再用 cgroup 执行 limits。理解这一点，才能理解 QoS、驱逐和 OOM。

requests 是调度器预留的资源，limits 是运行时上限。QoS 分三档：Guaranteed（所有容器的 CPU/内存 requests 等于 limits）、Burstable（至少一个容器有 requests 或 limits，但不相等）、BestEffort（完全没有 requests/limits）。节点内存紧张时，kubelet 按 QoS 顺序驱逐；Guaranteed 最后被驱逐，但不等于“不会被 throttled”。CPU 是压缩资源，超过 `cpu.max` 会被限流；内存是不可压缩资源，超过 `memory.max` 会被 OOM kill。

cgroup v2 的接口比 v1 统一：`cpu.max` 是“配额/周期”，`cpu.weight` 是相对权重，`memory.max` 是硬上限，`memory.high` 是软上限，`memory.low` 是保护线，`io.max` 是设备级限速，`pids.max` 防 fork 炸弹。PSI（pressure stall information）能告诉你资源压力有多大，比看平均利用率有用。

**多容器视角**：Pod 的资源是容器资源之和；sidecar 的 requests 也算进去，所以“加一个 sidecar 不影响性能”通常是错的。init container 的资源按最大值算，不是求和。Guaranteed Pod 里如果某个容器设了 CPU limit，它仍然会被 throttled；Guaranteed 保证的是驱逐优先级，不是性能。

**动手**：直接在 Linux/WSL2 上用 cgroup v2 跑 app + sidecar，给它们设 `cpu.max`/`memory.max`；用 `stress-ng` 制造内存压力，观察 `memory.high` 限流和 `memory.max` OOM；用 `cat /sys/fs/cgroup/.../cpu.stat` 看 throttling，用 PSI 看压力。如果你有单节点 kind，可以把同样的配置翻译成 requests/limits；但不是必需。

**自测**

- Guaranteed Pod 为什么仍可能被 CPU throttled？
- `memory.high` 和 `memory.max` 的差别是什么？哪个会 kill 进程？

**作业**：[CN5](#lab-cn5) · [作业总览](labs.html)

**参考**：[阅读](papers.html)

## 第 10 讲：隔离与安全 {#cn10}

容器安全的第一原则是：**容器不是安全边界，除非你额外做了隔离**。默认的 Docker/containerd 容器共享宿主内核；如果容器以 root 运行、有 `CAP_SYS_ADMIN`、挂载了宿主目录、或者内核有漏洞，逃逸是现实风险。

能加的防线有很多。user namespace 让容器里的 root 映射到宿主的一个非特权 uid；rootless 容器进一步减少宿主权限。capability 把 root 的特权拆成小块，默认应该 `drop all` 再按需添加。seccomp 过滤系统调用，减少攻击面；AppArmor/SELinux 做强制访问控制；Landlock 让进程自己声明“我只能访问这些路径”，而且不能被绕过（比 chroot 可靠）。`no_new_privs` 阻止 setuid 提权；`openat2(RESOLVE_BENEATH)` 在打开文件时解析路径，避免 TOCTOU。

如果这些还不够，可以用 sandbox runtime：gVisor 在用户空间实现一个 Linux 兼容内核，容器里的 syscall 被拦截并模拟；Kata Containers 用轻量 VM 跑容器；Firecracker 是 microVM，启动快、内存开销小，适合多租户。它们的代价是兼容性、性能或运维复杂度。Kubernetes 用 `RuntimeClass` 选择 runtime。

**多容器视角**：共享 netns 和卷会绕过一部分隔离。sidecar 如果能读共享卷，就能读 app 的密钥；sidecar 如果能看共享网络，就能嗅探或劫持 `localhost` 流量。默认挂载的 service account token 也是一个常见泄漏点；不需要 API 访问的 Pod 应该 `automountServiceAccountToken: false`。

**动手**：用非 root 用户跑一个容器，`drop` 所有 capability，启用默认 seccomp；尝试读 `/etc/shadow`、挂载宿主目录、`ptrace` 其他进程；再用 gVisor 的 `runsc` 跑同一个镜像，比较哪些攻击面消失了、哪些兼容性问题出现了。

**自测**

- 有了 user namespace，为什么容器里的 root 仍然危险？
- seccomp 不能阻止什么？为什么它不能替代 Landlock？

**作业**：[CN5](#lab-cn5) · [作业总览](labs.html)

**参考**：[阅读](papers.html)

## 第 11 讲：Sidecar 与服务网格 {#cn11}

Sidecar 的思路是：把网络治理逻辑（mTLS、重试、超时、熔断、指标）从业务容器里拿出来，放进一个同 Pod 的代理容器。业务只连 `localhost`，代理负责出站和入站。Istio、Linkerd、Cilium 都提供这种模式；差别在于代理用什么拦截流量、控制面怎么下发配置。

拦截方式主要有两种：iptables 在 Pod 的 netns 里改写流量，把出站请求重定向到 sidecar 的端口；eBPF 在 socket 层做重定向，减少一次用户空间转发。mTLS 让 Pod 之间的流量加密并绑定身份（SPIFFE）；重试和超时由代理执行；指标和追踪也由代理产生。

代价是真实的：多一次网络跳转，p99 会增加；sidecar 自己要吃 CPU 和内存；重试可能放大下游压力；如果代理没 ready，业务就不能出网。Ambient mesh 试图把 L4 能力放到节点级（ztunnel），只给需要 L7 的工作负载配 sidecar，减少开销。

**多容器视角**：sidecar 是“和主容器共享网络”的典型用法，也是“多容器生命周期”的典型难点。代理要在 app 之前 ready，在 app 之后退出；端口不能和 app 冲突；健康检查要区分“app 活着”和“代理能出网”。`localhost` 通信看似简单，但一旦代理挂了，app 的出站就全断了。

**动手**：如果有单节点 kind（可选），装 Istio 或 Cilium，给一个 app 加 sidecar；否则用两个 netns 加一个用户空间代理进程模拟，重点看多一次跳转、生命周期和端口冲突。用 `wrk` 测加代理前后的 p99；配置一个重试，观察下游请求量；杀掉 sidecar，观察 app 的行为。

**自测**

- Sidecar 为什么不能对所有协议透明？哪些协议需要额外配置？
- 重试为什么会放大故障？超时和重试应该怎么配合？

**作业**：[CN3](#lab-cn3) · [CN5](#lab-cn5) · [作业总览](labs.html)

**参考**：[阅读](papers.html)

## 第 12 讲：有状态多容器 {#cn12}

无状态服务可以随便重启、随便换节点；有状态服务不行。StatefulSet 给每个 Pod 一个稳定的名字（`pod-0`、`pod-1`）、稳定的网络标识（headless Service）和稳定的存储（PVC 模板）。它按顺序创建、按逆序删除，保证 `pod-0` 先起来；但它不保证“同一时刻只有一个 leader”，那要靠应用自己的选主。

Operator 把运维知识写成控制器：watch 自定义资源，比较 desired 和 observed，执行 reconcile。reconcile 必须是幂等的，因为它可能被重复调用；它通常是 level-triggered，不是 edge-triggered：看到当前状态，算出下一步，而不是“收到一个事件就做一件事”。

选主需要 lease 和 fencing。lease 是一段时间内的所有权；fencing token 是单调递增的编号，存储层拒绝比当前 token 小的写。只有 lease 没有 fencing，遇到 GC pause、网络延迟、时钟漂移，旧 leader 可能在 lease 过期后继续写，造成双主。etcd 的 lease、Kubernetes 的 `Lease` 对象、Chubby 的 sequencer，都是这个思路。

**多容器视角**：有状态 Pod 常常是 app + backup sidecar + metrics sidecar。backup 要等 app 完成 checkpoint；metrics 不能干扰 I/O；init container 可能负责从备份恢复。顺序、权限、资源隔离都要设计，不能假设“sidecar 只是辅助”。

**动手**：如果有单节点 kind（可选），用 StatefulSet 跑三个副本；否则用三个进程 + 文件 lease 模拟。杀掉 leader，观察选主和客户端重连；故意让旧 leader 暂停（`SIGSTOP`），看没有 fencing 时会发生什么。

**自测**

- StatefulSet 为什么需要 headless Service？
- 两个 Pod 同时认为自己 leader，哪些机制能阻止双写？

**作业**：[CN5](#lab-cn5) · [作业总览](labs.html)

**参考**：[阅读](papers.html)

## 第 13 讲：可观测性与性能 {#cn13}

系统变慢时，最容易犯的错是看平均 CPU。平均利用率会掩盖 throttling、排队和尾延迟；一个 Pod 的 p99 可能是 2 秒，而 CPU 平均只有 30%。你需要三类信号：metrics 告诉你“多少”，logs 告诉你“发生了什么”，traces 告诉你“时间花在哪”。

Metrics 有 counter、gauge、histogram；histogram 能算分位数，平均值不能。Prometheus 拉取指标，Grafana 展示；RED（rate、errors、duration）适合服务，USE（utilization、saturation、errors）适合资源。Logs 要结构化，带 trace ID、Pod、容器、请求 ID；多容器 Pod 的日志是分开的流，采集器要能区分。Traces 要跨容器传播 context，OpenTelemetry 是通用方案；eBPF 可以在内核层抓网络和 syscall，不需要改代码，但要注意开销和观测盲区。

性能问题要先分清 CPU、内存、I/O、网络。CPU 看 throttling、run queue、context switch；内存看 page cache、RSS、OOM 和 PSI；I/O 看 `iostat` 的 await/util、direct I/O 和 page cache 命中；网络看 retransmit、连接状态和队列。`perf`、`ftrace`、`bpftrace` 能看到更细的调用路径，但它们本身也有开销，不要在生产环境长时间开着。

成本也一样。Kubernetes 的 requests 决定调度和容量预留，usage 决定实际账单；两者差距大，说明 bin packing 不好。Sidecar、日志采集、监控代理都吃资源；多副本、跨可用区流量、冷数据存储都会反映到账单。按 namespace/team/label 做 chargeback，比月底看总账单有用。

**多容器视角**：一个 Pod 里三个容器，日志有三路，指标有三维标签，trace 要跨三次进程边界。你以为在观察一个服务，其实在观察三个进程加一个网络命名空间。先把“容器”作为标签加进去，再谈聚合。

**动手**：给 CN2 的迷你 Pod 加 Prometheus metrics、结构化日志和 OpenTelemetry trace；用 `tc netem` 注入 100ms 延迟，找出 p99 的来源；按容器统计 CPU/内存成本。

**自测**

- 为什么平均 CPU 会误导？你会看哪些指标判断 throttling？
- requests 和 usage 的差值对成本意味着什么？

**作业**：[CN5](#lab-cn5) · [作业总览](labs.html)

**参考**：[阅读](papers.html)

## 第 14 讲：Capstone——多容器 Agent 平台 {#cn14}

这门课的 capstone 不是一个“能跑”的 demo，而是一个能解释故障的迷你平台。你要做一个节点级 agent：读一个 Pod 风格的 spec，创建共享 netns，按顺序跑 init container，启动 app 和 sidecar，挂共享卷，设 cgroup 限制，处理信号和优雅退出，暴露 metrics 和日志，并能注入故障。

最低要求：

- 一个 `mini-pod` 二进制，支持 `init`、`app`、`sidecar` 三种角色，共享 netns 和 volume。
- 资源限制：CPU、内存、进程数；至少能演示 `memory.max` 下的 OOM。
- 生命周期：`SIGTERM` 优雅退出，超时 `SIGKILL`；回收孤儿进程。
- 网络：Pod 有独立 netns，能访问外网；至少一个 Service VIP 或 DNAT 规则。
- 存储：工作区支持原子 commit/rollback；崩溃后不出现写了一半的文件。
- 可观测性：每个容器的 CPU/内存、重启次数、日志流；一个 p99 延迟面板。
- 安全：非 root、drop capabilities、只读 rootfs、默认 seccomp。
- 混沌测试：杀容器、OOM、网络分区、磁盘满，各一次，记录系统行为。

验收看四件事：**能不能起来**、**坏了能不能恢复**、**能不能解释为什么**、**有没有把权限限制住**。不看你用了多少 Kubernetes API。

这个 capstone 的“tool runner”容器其实就是一个 agent 的任务进程。它现在只会跑命令；INFRA 03 会教你怎么给它定义原子操作、事务、快照和审计。

**作业**：[CN5 capstone](#lab-cn5) · [作业总览](labs.html)

**参考**：[阅读](papers.html)

## 实验

这门课有五个实验。讲义是主教材；每个实验都给目标、任务、验收和常见坑，不给完整代码。读完对应讲义再打开任务书就能开始，规范是参考。建议按顺序做；CN4 会复用到 INFRA 03。

### CN1：从零做一个容器 {#lab-cn1}

**目标**：不用 Docker/containerd，用 Linux 原语跑起一个隔离的 shell。

**开始之前**：先读[第 1 讲](#cn1)。准备一个最小 rootfs（`busybox-static` 即可）：`rootfs/bin/busybox`，再建 `/bin/sh` 等 symlink 和 `/proc`、`/sys`、`/dev`、`/tmp` 空目录。第一次先只做“新 PID/mount namespace + 重新挂 `/proc` + 进入 rootfs”，确认 `ps` 只看到容器内进程、`hostname` 与宿主不同；跑通后再加 cgroup 和清理。验收项就是标准，不需要先读论文。

**任务**：

1. 用 `clone(2)` 或 `unshare(2)` 创建 PID、mount、UTS、IPC、network namespace。
2. 在新 mount namespace 里挂 `/proc`，用 `pivot_root` 切换到一个小 rootfs（busybox 即可）。
3. 设置 hostname，确认 `ps` 只看到容器内进程。
4. 创建 cgroup v2 子组，设置 `memory.max=64M`，在容器里跑一个内存分配程序，观察 OOM。
5. 退出后清理 cgroup、netns、挂载点。
6. 可选：把 rootfs 打包成 OCI layout，用 `skopeo inspect` 或 `umoci ls` 验证；对比两次构建的 digest。

**提交接口**：可执行文件 `cn1`，调用方式是 `./cn1 run --rootfs DIR [--memory 64M] -- CMD [ARG...]`；退出码透传，stdout/stderr 原样输出。judge 只通过这个接口检查，不读源码；完整契约在仓库的 `judge/contracts/infra02.md`。

**验收**：容器内 `ps` 只有 shell 和它启动的进程；`hostname` 与宿主不同；内存超过 64M 时进程被 kill；宿主上看不到残留 namespace。

**常见坑**：PID namespace 需要重新挂 `/proc`，否则 `ps` 还是宿主视图；`pivot_root` 前要把 `/` 设为 private mount；cgroup v2 需要把进程写进 `cgroup.procs`，不是 `tasks`；network namespace 里默认只有 loopback，要手动 `ip link set lo up`。

### CN2：多容器 Pod 生命周期 {#lab-cn2}

**目标**：实现一个迷你 Pod runner，理解 init/app/sidecar 的启动、共享和退出。

**开始之前**：先读[第 4 讲](#cn4)和[第 5 讲](#cn5)。先做一个 pause 进程持有 netns，让两个子进程 `setns` 进去，用 `ip netns`/`nsenter` 确认它们看到同一张网卡；再加 init 顺序、共享卷、信号和 subreaper。第一次只验证“init 未完成时 app 不启动”，不要同时做日志和优雅退出。

**任务**：

1. 创建一个 pause 进程，持有 netns；init/app/sidecar 加入同一个 netns。
2. init container 顺序执行，失败则整个 Pod 失败；app 和 sidecar 并行启动。
3. 挂一个共享 `emptyDir`，app 写文件，sidecar 读文件；验证 `localhost` 通信。
4. 删除 Pod：先给 app 发 `SIGTERM`，等它退出，再给 sidecar 发；超时 `SIGKILL`。
5. 实现 subreaper 或 `tini`，回收孤儿进程；记录每个容器的退出码。

**验收**：init 未完成时 app 不启动；app 和 sidecar 能通过 `localhost` 互相访问；删除时没有僵尸进程；日志不丢。

**常见坑**：pause 退出会带走 netns；sidecar 可能比 app 先退出；shell-form 命令不转发 `SIGTERM`；`waitpid` 只能回收自己的子进程，孤儿要靠 subreaper。

### CN3：CNI 与 Service {#lab-cn3}

**目标**：手写一个最小 CNI 插件，理解 Pod 网络和 Service VIP。

**开始之前**：先读[第 6 讲](#cn6)。先在两个 netns 之间建 veth、接 bridge、配 IP，`ping` 通；再加 NAT 和 Service VIP；最后做 NetworkPolicy 和 hairpin。用 `ip -n`、`bridge`、`conntrack -L` 观察每一步，不要一开始就写 CNI 插件。

**任务**：

1. 实现 `ADD`/`DEL`：创建 netns，创建 veth pair，一头进 netns，一头接 bridge；分配 IP，加默认路由。
2. 在宿主机开启 `ip_forward`，加 NAT 规则，让 netns 能访问外网。
3. 启动两个后端（可以是 `python3 -m http.server`），用 iptables DNAT 做一个“Service VIP”，把流量轮询到两个后端。
4. 用 `conntrack` 观察连接；测试 hairpin（Pod 访问自己的 Service）。
5. 加一条 NetworkPolicy 风格的 iptables 规则，默认拒绝，只放行指定端口。
6. 可选：用 `tc netem` 注入延迟和丢包，测一次超时、重试和 p99。

**验收**：两个 netns 能互 ping；能通过 VIP 访问后端；删除 netns 后规则和 veth 被清理；hairpin 至少能说清楚为什么会失败。

**常见坑**：veth 一端在 netns 里要改名；bridge 要 `ip link set up`；NAT 需要 `MASQUERADE`；`br_netfilter` 和 `route_localnet` 会影响 hairpin；iptables 规则顺序很重要。

### CN4：工作区事务 {#lab-cn4}

**目标**：让多个容器共享一个工作区，并支持原子 commit/rollback。

**开始之前**：先读[第 8 讲](#cn8)。先用 overlayfs 挂一个 lower/upper/merged，手动写文件、`commit`、`rollback`；确认读者在 commit 期间只看到旧版或新版；再做崩溃注入。先做单文件，再做多文件 manifest。

**任务**：

1. 用 overlayfs 做一个工作区：lowerdir 是只读基线，upperdir 是可写层，merged 是视图。
2. 写一个 `commit`：把 upperdir 的内容打包成新基线，原子切换到新视图；失败时保留旧基线。
3. 写一个 `rollback`：丢弃 upperdir，恢复基线。
4. 两个容器同时读，一个容器写；保证读者永远看到完整文件（临时文件 + `rename` + `fsync`）。
5. 在 commit 过程中 `kill -9`，重启后检查：要么旧版本，要么新版本，不能混合。

**验收**：读者看不到写了一半的文件；rollback 后文件内容与基线一致；崩溃恢复后状态确定；有并发写时至少能检测冲突。

**常见坑**：overlayfs 的 copy-up 不是原子的；`rename` 只在同一文件系统内原子；`fsync` 目录才算持久化；upperdir 里可能有 whiteout，打包时要处理。

### CN5：Capstone——多容器 Agent 平台 {#lab-cn5}

**目标**：把 CN1–CN4 组合成一个能跑、能坏、能解释的迷你平台。

**开始之前**：先读[第 12 讲](#cn12)、[第 13 讲](#cn13)和[第 14 讲](#cn14)，并把 CN1–CN4 各跑通一次。先组合 CN1+CN2 做一个能启动/停止的 Pod，再加 CN3 的网络和 CN4 的工作区；最后加混沌测试。不要用 Kubernetes 包装层代替底层实现。

**任务**：按第 14 讲的最低要求实现；至少做三种混沌测试（杀容器、OOM、网络分区）；写一份故障报告，说明每次注入后系统的观测、恢复路径和未解决的问题。

**验收**：见第 14 讲的清单；额外要求一次 10 分钟 demo，能现场回答“如果 sidecar 挂了会怎样”“如果节点断电会怎样”“如果两个 Pod 抢同一个卷会怎样”。

**常见坑**：把 capstone 做成“调用 Kubernetes”的包装层，而不是理解底层；只测 happy path；没有把权限限制住；日志和指标只覆盖 app，不覆盖 sidecar。
