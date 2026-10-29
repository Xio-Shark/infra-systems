# CN3 · CNI 与 Service

> **课程**：[INFRA 02 · 云原生系统](cloud-native.html) · **实验 3/5**
>
> **先读**：[第 6 讲](cloud-native.html#cn6)、[第 7 讲](cloud-native.html#cn7) · **接口**：[contracts/infra02.md](https://github.com/Xio-Shark/infra-systems/blob/main/judge/contracts/infra02.md)（CN2–CN5 未冻结）
>
> **验收**：人工清单（见“验收与测试”）；judge 接口未冻结
>
> [上一个：CN2](cn2.html) · [返回作业](labs.html) · [下一个：CN4](cn4.html)
>
> **难度** ★★★★ · **先修** CN1/CN2 + 第 6、7 讲 · **时间** 10–14 小时 · **最小通过** veth/bridge/NAT；**完整通过** CNI + Service VIP + hairpin

## 你将完成什么

你要写一个最小 CNI 插件 `minicni`，它接收 `ADD` 和 `DEL`，给一个 network namespace 接上 veth、bridge、IP 和默认路由；再在宿主机上用 iptables 做一个 Service VIP，把发往 VIP 的新连接轮流 DNAT 到两个后端。最后你要能解释：为什么 Pod 访问 Service 时，返回包可能绕过宿主，以及为什么要给这类流量做 SNAT。

验收是人工的。插件这样调用：

```bash
sudo CNI_COMMAND=ADD CNI_CONTAINERID=pod-a CNI_NETNS=/var/run/netns/pod-a \
  CNI_IFNAME=eth0 CNI_PATH=/opt/cni/bin ./minicni < testdata/net.json
```

预期 stdout 是一段 JSON，里面有 `interfaces`、`ips` 和 `routes`，退出码 0。然后 `ip -n pod-a addr` 能看到 `10.22.0.2/16`，`ip netns exec pod-a ping -c1 10.22.0.3` 能通，`curl http://10.96.0.10/` 会在两个后端之间轮换。`DEL` 之后，veth、iptables 规则和状态文件都要消失，重复 `DEL` 仍然退出 0。

重点不是写一个能上生产的 CNI，而是把 Pod 网络拆成可观察的几步：namespace、veth、bridge、路由、NAT、conntrack、DNAT。每一步都用 `ip`、`bridge`、`iptables`、`conntrack` 看一眼，再写进插件。

## 开始之前

先读[第 6 讲](cloud-native.html#cn6)和[第 7 讲](cloud-native.html#cn7)。第 6 讲给出 Pod 网络和 Service 的层次；第 7 讲解释 DNS、超时和重试为什么会把网络问题放大。CN3 只做第 6 讲的底层，第 7 讲的压测是可选加分。

环境检查，需要 root：

```bash
ip netns add cn3-test && ip netns list        # 预期列出 cn3-test
ip netns del cn3-test
sysctl net.ipv4.ip_forward                    # 预期 0 或 1，实验里要设成 1
iptables --version                            # 预期 nf_tables 或 legacy
conntrack -V                                  # 预期 conntrack-tools 版本
modprobe br_netfilter 2>/dev/null || true
sysctl net.bridge.bridge-nf-call-iptables     # 可选；做 NetworkPolicy 时才需要 1
```

`iptables` 报 `No chain/target/match by that name` 时，先确认用的是 `iptables-nft` 还是 legacy，不要把两套规则混在一起。

目录布局建议如下。插件本身是普通可执行文件，CNI 运行时只通过环境变量和 stdin/stdout 跟它说话。

```text
~/labs/cn3/
  go.mod
  cmd/minicni/main.go
  internal/cni/config.go     # stdin 的 NetworkConfig
  internal/cni/result.go     # stdout 的 Result
  internal/cni/plugin.go     # ADD/DEL 的实际动作
  internal/cni/state.go      # /var/lib/minicni/<network>/<containerid>
  testdata/net.json
  setup.sh                   # 建 bridge、开转发、加 NAT
  teardown.sh
  minicni
```

时间预算 10–14 小时。先用 shell 把两个 netns 连通，再把命令翻译成 Go。

## 代码地图

- `config.go`：解析 stdin 的 `NetworkConfig`，至少读 `cniVersion`、`name`、`type`、`bridge`、`subnet`。
- `result.go`：生成 `ADD` 的 `Result`。`ips[].interface` 是 `interfaces` 数组的下标，写错会让运行时把 IP 配到错误的网卡。
- `plugin.go`：`ADD` 建 veth、接 bridge、配 IP、加路由；`DEL` 按容器 ID 找状态，删 veth 和规则，释放 IP。
- `state.go`：把容器 ID、IP、宿主侧 veth 名写到 `/var/lib/minicni/<network>/<containerid>`；IP 用 `next` 计数器从 2 开始分配。`DEL` 时 `CNI_NETNS` 可能为空，没有状态文件就不知道该删哪个 veth。
- `setup.sh`：建 `cni0`、设 `ip_forward`、加 MASQUERADE 和 FORWARD 规则；`teardown.sh` 反向清理。

`minicni` 只往 stdout 写 JSON。日志、调试信息一律写 stderr，否则运行时会解析失败。

## 接口与数据流

CNI 插件是一个可执行文件，运行时通过环境变量传参数，通过 stdin 传网络配置，通过 stdout 收结果。最小实现要认这几个变量：

| 变量 | 含义 |
|---|---|
| `CNI_COMMAND` | `ADD`、`DEL`，较新的 spec 还有 `CHECK` |
| `CNI_CONTAINERID` | 容器 ID，`DEL` 时唯一的查找键 |
| `CNI_NETNS` | network namespace 的路径，可能是 `/var/run/netns/x`，也可能是 `/proc/<pid>/ns/net`；`DEL` 时可能为空 |
| `CNI_IFNAME` | 容器里的网卡名，通常是 `eth0` |
| `CNI_ARGS` | 额外的 `KEY=VALUE;KEY2=VALUE2`，最小实现可以忽略 |
| `CNI_PATH` | 插件搜索路径，插件自己不用，运行时用 |

`CHECK` 和 `VERSION` 的支持范围随 CNI spec 版本变化，以你用的运行时为准。

stdin 是一份 JSON，最小配置如下：

```json
{"cniVersion":"1.0.0","name":"minicni","type":"minicni",
 "bridge":"cni0","subnet":"10.22.0.0/16"}
```

`ADD` 成功时 stdout 输出 `Result`，失败时输出 error JSON 并以非零退出。error JSON 至少要有 `cniVersion`、`code`、`msg`：

```json
{"cniVersion":"1.0.0","code":7,"msg":"failed to create veth","details":"veth exists"}
```

一次 `ADD` 的数据流：

```text
runtime
  │ env: CNI_COMMAND=ADD, CNI_NETNS=<path>, CNI_IFNAME=eth0
  │ stdin: NetworkConfig
  ▼
minicni
  ├─ 打开 CNI_NETNS，拿到 netns fd
  ├─ 建 veth：宿主端 vethXXXX，容器端 eth0
  ├─ 宿主端接 cni0，容器端配 IP、加默认路由
  ├─ 写状态文件
  └─ stdout: Result{interfaces, ips, routes}
```

看什么：`CNI_NETNS` 是路径不是名字；插件要能处理任意路径，不能只支持 `ip netns` 建出来的命名 netns。`ADD` 必须可重复执行而不留下第二对 veth，`DEL` 必须在 netns 已经消失时也能清理宿主侧资源。

Go 的主干很短，动作都在 `add` 和 `del` 里：

```go
func main() {
    switch os.Getenv("CNI_COMMAND") {
    case "ADD":
        var cfg Config
        if err := json.NewDecoder(os.Stdin).Decode(&cfg); err != nil {
            fail(cfg.CNIVersion, 1, err)
        }
        res := add(cfg, os.Getenv("CNI_CONTAINERID"),
            os.Getenv("CNI_NETNS"), os.Getenv("CNI_IFNAME"))
        json.NewEncoder(os.Stdout).Encode(res)
    case "DEL":
        del(os.Getenv("CNI_CONTAINERID")) // 幂等；找不到也算成功
    default:
        fail("1.0.0", 2, fmt.Errorf("unsupported command"))
    }
}
```

## 阶段拆解

### 阶段 1：用 shell 连通两个 netns

目标：不写插件，先手工建 bridge、veth、IP 和路由，让两个 netns 互 ping。工作目录 `~/labs/cn3`。

```bash
ip link add cni0 type bridge
ip addr add 10.22.0.1/16 dev cni0
ip link set cni0 up
ip netns add pod-a
ip link add veth-a type veth peer name eth0 netns pod-a
ip link set veth-a master cni0 up
ip -n pod-a link set eth0 up
ip -n pod-a addr add 10.22.0.2/16 dev eth0
ip -n pod-a route add default via 10.22.0.1
ip netns exec pod-a ping -c1 10.22.0.1
```

对 `pod-b` 重复一遍，地址用 `10.22.0.3`，然后 `ip netns exec pod-a ping -c1 10.22.0.3`。预期第一个 ping 通网关，第二个 ping 通对端；`bridge link show` 里能看到两个 veth 都挂在 `cni0` 上。通过标志：两个 netns 同子网互通，`ip -n pod-a route` 有默认路由。

阶段 2 开始前先清理：`ip netns del pod-a; ip netns del pod-b; ip link del cni0`，否则 `eth0` 和 IP 会与插件新建的冲突。清理后跑 `./setup.sh`（至少建 `cni0`）；手工测试前先 `ip netns add pod-a` 和 `ip netns add pod-b`，CNI 运行时负责建 netns，插件只打开它。对 `pod-b` 再执行一次同样的 ADD，地址会是 `10.22.0.3`。

### 阶段 2：包成 CNI 插件

目标：把上面的命令翻译成 `ADD`，把反向操作翻译成 `DEL`，并处理状态。先手工调用：

```bash
sudo CNI_COMMAND=ADD CNI_CONTAINERID=pod-a CNI_NETNS=/var/run/netns/pod-a \
  CNI_IFNAME=eth0 ./minicni < testdata/net.json | jq .
sudo CNI_COMMAND=DEL CNI_CONTAINERID=pod-a ./minicni
sudo CNI_COMMAND=DEL CNI_CONTAINERID=pod-a ./minicni   # 第二次也应退出 0
```

预期第一条输出 `"address":"10.22.0.2/16"`，第二条删掉 veth 和规则，第三条不报错。通过标志：`ip link` 里没有该容器对应的宿主端 veth（名字由容器 ID 生成）；`/var/lib/minicni/minicni/pod-a` 被删除；重复 `ADD` 同一容器 ID 返回同一份结果，不会建出第二对 veth。

veth 的宿主端名字要控制在 15 个字符以内，常用 `veth` 加容器 ID 的前 8 位。容器端名字来自 `CNI_IFNAME`，直接用它，不要硬编码 `eth0`。`DEL` 时如果 `CNI_NETNS` 为空，仍然要按状态文件删宿主端 veth 和 iptables 规则。

### 阶段 3：让 netns 访问外网

目标：开转发，加 NAT，让 `pod-a` 能 ping 外网、能发 HTTP。改 `setup.sh`：

```bash
sysctl -w net.ipv4.ip_forward=1
iptables -t nat -A POSTROUTING -s 10.22.0.0/16 ! -o cni0 -j MASQUERADE
iptables -A FORWARD -i cni0 -j ACCEPT
iptables -A FORWARD -o cni0 -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
```

跑：

```bash
ip netns exec pod-a ping -c1 1.1.1.1
ip netns exec pod-a curl -s -o /dev/null -w '%{http_code}\n' http://example.com
conntrack -L -s 10.22.0.2 | head
```

预期 ping 通，curl 返回 200 或 301，`conntrack` 里能看到源地址被改成宿主地址。通过标志：去掉 MASQUERADE 后外网不通、加回来就通；`! -o cni0` 保证 Pod 到 Pod 的流量不被 NAT。最小 rootfs 里如果没有 `/etc/resolv.conf`，先拷一份进去，否则你会把 DNS 失败误判成 NAT 失败。

### 阶段 4：Service VIP 和 DNAT 轮询

目标：在本机加一个不属于任何网卡的 VIP `10.96.0.10`，把发往它的 80 端口新连接轮流 DNAT 到两个后端。先起两个内容不同的 HTTP 服务：

```bash
mkdir -p /tmp/backend-a /tmp/backend-b
echo A > /tmp/backend-a/index.html
echo B > /tmp/backend-b/index.html
ip netns exec pod-a python3 -m http.server 80 --directory /tmp/backend-a &
ip netns exec pod-b python3 -m http.server 80 --directory /tmp/backend-b &
ip link add svc0 type dummy
ip addr add 10.96.0.10/32 dev svc0
ip link set svc0 up
```

加 DNAT 规则。`--ctstate NEW` 让计数器只看新连接，避免重传把比例打乱：

```bash
iptables -t nat -N MINICNI-SVC
iptables -t nat -A PREROUTING -d 10.96.0.10 -p tcp --dport 80 -j MINICNI-SVC
iptables -t nat -A MINICNI-SVC -m conntrack --ctstate NEW \
  -m statistic --mode nth --every 2 --packet 0 -j DNAT --to-destination 10.22.0.2:80
iptables -t nat -A MINICNI-SVC -m conntrack --ctstate NEW \
  -m statistic --mode nth --every 2 --packet 1 -j DNAT --to-destination 10.22.0.3:80
```

跑六次新连接：

```bash
for i in $(seq 1 6); do
  ip netns exec pod-a curl -s http://10.96.0.10/
done
```

预期输出交替出现 `A` 和 `B`，`conntrack -L -p tcp --dport 80` 能看到两条不同的 DNAT 目标。通过标志：至少各命中两次；同一个 TCP 连接内的多个请求只走一个后端。DNAT 只在连接的第一个包上做，后续包由 conntrack 直接映射。

### 阶段 5：hairpin 和可选策略

目标：让 Pod 访问 VIP 时，返回包也能经过宿主。只做 DNAT 时，`pod-a` 访问 VIP 可能超时。原因是后端和客户端在同一个 bridge 上，后端的回复直接按二层发给客户端，源地址是后端 IP，不是 VIP；客户端 socket 连的是 VIP，会把回复丢掉。

处理办法是在 DNAT 之前给这类流量打 mark，在 POSTROUTING 里对 mark 做 MASQUERADE：

```bash
iptables -t nat -I PREROUTING 1 -s 10.22.0.0/16 -d 10.96.0.10 -j MARK --set-mark 0x4000
iptables -t nat -A POSTROUTING -m mark --mark 0x4000 -j MASQUERADE
```

用 `-I PREROUTING 1` 插到最前；用 `-A` 会排在 DNAT 后面，永远不生效。这样后端看到的源地址变成宿主，回复先回宿主，conntrack 再还原 DNAT 和 SNAT，客户端看到 VIP。`conntrack -L` 的回复方向里，目的地址是宿主 `10.22.0.1`，源地址是后端 IP。如果 VIP 用 `127.0.0.1`，还要开 `net.ipv4.conf.all.route_localnet=1`；`10.96.0.10` 不需要。

可选的 NetworkPolicy：加载 `br_netfilter`，把 `net.bridge.bridge-nf-call-iptables` 设为 1，在 FORWARD 里先放行已建立连接，再默认 DROP，只放行 `cni0` 到 `cni0` 的 80 端口。可选的 netem：在 `pod-a` 的 `eth0` 上加 100 ms 延迟和 1% 丢包，测一次超时和重试。

## 验收与测试

| 验收项 | 怎么查 | 预期 |
|---|---|---|
| 两个 netns 互通 | `ip netns exec pod-a ping -c1 10.22.0.3` | 1 个包收到 |
| 插件 ADD 输出合法 | 按上面的 `ADD` 调用接 `jq .ips[0].address` | `10.22.0.2/16` |
| 插件 DEL 幂等 | 连续执行两次 `DEL` | 两次都退出 0 |
| 外网可达 | `ip netns exec pod-a curl http://example.com` | HTTP 200 或 301 |
| NAT 生效 | `conntrack -L -s 10.22.0.2` | 源地址被改成宿主地址 |
| VIP 轮询 | 六次 `curl http://10.96.0.10/` | A/B 各至少两次 |
| 连接粘性 | 同一个连接发多个请求 | 只命中一个后端 |
| hairpin 可解释 | `conntrack -L` 看双向映射 | 能指出 SNAT 前后的源和目的 |
| 清理干净 | `DEL` 后 `ip link`、`iptables -t nat -S` | 没有残留 veth 和规则 |

CN3 的验收以表里的命令为准，把 `conntrack` 和 `iptables -t nat -S` 的前后对比留在笔记里。

## 常见错误

| 现象 | 原因 | 处理 |
|---|---|---|
| `RTNETLINK answers: File exists` | 容器里已有 `eth0`，或宿主 veth 名冲突 | 用容器 ID 生成唯一名字；`DEL` 后确认旧 veth 已删 |
| `Cannot find device "eth0"` | 对端没移进 netns，或 netns 路径写错 | 用 `ip link add <veth> type veth peer name eth0 netns <path>`；先 `ip netns list` |
| ping 网关不通 | `cni0` 没 up，veth 没挂到 bridge，IP 没配 | `bridge link show`、`ip -n pod-a addr`、`ip -n pod-a route` |
| ping 通，外网不通 | `ip_forward=0`，没有 MASQUERADE，或 FORWARD 被 DROP | 按顺序查 `sysctl`、`iptables -t nat -L`、`iptables -L -n -v` 计数器 |
| VIP 不通 | VIP 不在本机，Pods 没有到它的路由 | 把 VIP 加到 dummy 网卡，确认 `ip route get 10.96.0.10` 走本机 |
| VIP 只命中一个后端 | 客户端复用了连接，或规则没有 `--ctstate NEW` | 每次新建连接测；确认 conntrack 计数 |
| hairpin 超时 | 返回包绕过宿主，源地址不是 VIP | 在 PREROUTING 打 mark，在 POSTROUTING 做 MASQUERADE |
| `DEL` 留下 veth | `CNI_NETNS` 为空时没按容器 ID 清理 | 状态文件记宿主 veth 名；`DEL` 不依赖 netns 存在 |
| 运行时解析 JSON 失败 | 插件把日志写到了 stdout | 所有日志改到 stderr |
| `iptables: No chain/target/match by that name` | nft 和 legacy 混用 | 统一用 `iptables-nft`，或改用 `nft` |

## 调试手册

网络问题从下往上查：link、addr、route、bridge、nat、conntrack。每一层都有对应的只读命令。

```bash
ip -n pod-a link show
ip -n pod-a addr show
ip -n pod-a route show
bridge link show
bridge fdb show dev veth-a
ip route get 10.96.0.10
sysctl net.ipv4.ip_forward net.ipv4.conf.all.rp_filter
```

`ip -n` 只对命名 netns 有效。插件拿到的是任意路径，调试时用 `nsenter --net=/var/run/netns/pod-a -- ip addr`，或者 `nsenter -t <pid> -n -- ip addr`。veth 两端可以用 `ip -d link show` 看 peer 关系。

iptables 看规则和计数器，不要只看 `-L`：

```bash
iptables -t nat -S
iptables -t nat -L PREROUTING -n -v
iptables -t nat -L POSTROUTING -n -v
iptables -t filter -L FORWARD -n -v
```

计数器不涨，说明包没走到这条链。Pod 发出的包在 PREROUTING 和 FORWARD 里应该能看到；FORWARD 不涨时先查 `br_netfilter`。

conntrack 是 Service 的核心：

```bash
conntrack -L -p tcp --dport 80
conntrack -L -s 10.22.0.2
conntrack -E -p tcp --dport 80
```

`-L` 看当前映射，`-E` 实时看新建和销毁。DNAT 之后，conntrack 会同时记录原始五元组和回复方向。改完 iptables 规则后旧连接仍走旧映射，测试轮询要用新连接。

抓包只在最后一层用：

```bash
tcpdump -ni cni0 -c 20 'tcp port 80'
tcpdump -ni any -c 20 'host 10.96.0.10'
```

先确认包到了哪个接口、源和目的地址是什么，再回去改规则。

## 提交前检查

- [ ] `ADD` 输出合法 JSON，stdout 没有任何日志；`DEL` 两次都成功。
- [ ] 两个 netns 互 ping，外网 HTTP 可达，`conntrack` 能看到 NAT。
- [ ] VIP 六次新连接至少各命中一次；同一连接只命中一个后端。
- [ ] hairpin 能复现失败，也能用 mark + MASQUERADE 修好，并解释原因。
- [ ] `DEL` 后没有残留 veth、iptables 规则、状态文件；`setup.sh` 和 `teardown.sh` 能重复执行。
- [ ] 不看代码能讲清楚：veth 两端分别在哪、DNAT 在哪条链、为什么返回包可能不经过宿主。

## 自测问题

1. 为什么 `ADD` 拿到的 `CNI_NETNS` 是路径而不是 netns 名字？这对实现有什么要求？
2. 为什么 `DEL` 在 `CNI_NETNS` 为空时还要能工作？状态文件里至少要存什么？
3. DNAT 规则写在 PREROUTING 和 OUTPUT 上，分别服务哪类流量？
4. 为什么 Pod 访问 Service 时，后端的回复可能绕过宿主？只做 DNAT 会看到什么现象？
5. `conntrack` 如何影响“轮询”？为什么同一个 TCP 连接不会换后端？

### 答案要点

1. netns 可以是命名 netns，也可以是进程的 `/proc/<pid>/ns/net`。插件必须 `open` 这个路径再 `setns`，不能假设它是命名 netns。
2. 容器删除时 netns 可能已经先消失，运行时仍会调 `DEL` 清理宿主侧资源。状态文件至少要有容器 ID、宿主 veth 名、IP 和 network 名，才能删 veth、释放地址、清规则。
3. PREROUTING 处理从外部进入宿主的包，Pod 访问 VIP 走这里；OUTPUT 处理宿主自己发起的连接。两者都要有对应的 DNAT 规则。
4. 后端和客户端在同一个 bridge 上时，回复按二层直接发给客户端，不经过宿主，源地址是后端 IP 而不是 VIP。客户端连的是 VIP，会把这样的包丢掉。给 Pod 到 VIP 的流量打 mark 并 MASQUERADE，能让回复先回宿主，由 conntrack 还原。
5. DNAT 只在连接的第一个包上做，conntrack 记住映射，后续包直接沿用。轮询按新连接计数，所以长连接和连接池会让流量集中在少数后端。
