---
{"title":"GRE 隧道搭建与安全：EG3210 和 Linux 的公网、NAT 两种方案","category":"网络与代理","kind":"实践笔记","date":"2026-10-05","summary":"以锐捷 EG3210 与 Linux 为例，给出双端公网和一端 NAT 的 GRE 配置、逐项注释、协议 47 映射条件、访问控制、IPsec 保护、MTU 验收与回退方法。","tags":["GRE","EG3210","Linux","NAT","IPsec"]}
---
GRE 可以把两个网络通过三层隧道连接起来，适合承载路由流量和某些组播需求。本文以锐捷 RG-EG3210 和 Linux 为例，说明“双端公网 IP”与“Linux 有公网 IP、EG3210 在 NAT 后面”两种情况。配置采用虚构地址；资料核对于 2026-10-05，未连接实际网关或执行隧道部署。

**GRE 本身不加密，也不认证对端。公网承载生产业务时，应先落实 IPsec 等加密保护，再接入业务。下面的原生 GRE 示例用于理解封装、路由和受控实验，不代表已经完成安全 VPN 部署。**

## 01 / GRE 的协议与安全边界

IPv4 外层的原生 GRE 使用 **IP 协议号 47**，不是 TCP 47，也不是 UDP 47。防火墙应选择 GRE / IP protocol 47；普通“端口映射”页面如果只能填 TCP / UDP 端口，不能满足要求。它与 PPTP 的控制连接也不是同一件事，不需要为了普通 GRE 开放 TCP 1723。[GRE 协议定义](https://www.rfc-editor.org/rfc/rfc2784.html)。

GRE 的外层地址负责把包送到隧道终点，隧道地址用于两端三层通信，业务网段则是要互访的内部网络，三者不能混用。本文使用三层 `gre`，不使用二层 `gretap`，也不把办公广播域直接延伸到公网。

GRE key 是可选的流标识，在报文中可见，不是密码或预共享密钥；校验和也不是加密完整性保护。为降低初次互通的变量，示例不启用 key、checksum 或 sequence 扩展；需要它们时，两端能力和收发设置必须对应。[GRE key 与序号扩展](https://www.rfc-editor.org/rfc/rfc2890.html)。

只允许指定公网来源，可以减少扫描和误接入，但不能替代密码学认证。安全控制至少包含外层对端限制、解封装后的内层来源与业务 ACL、加密保护、路由边界和管理面隔离。

## 02 / EG3210 的型号、固件与变更前提

先区分 RG-EG3210 与 RG-EG3210 V2，并记录实际 RGOS 版本、接口、现有路由、NAT 和安全域。官网产品规格列出 GRE 与 IPsec 能力；**具体的 IPv4-over-IPv4 模式、CLI 和加密算法仍须按实际固件确认**，不能只凭型号认定所有模式和命令都相同。[RG-EG3210 产品规格](https://www.ruijie.com.cn/cp/aq-zhwg/eg3210/)。

EG3200 系列官方实施手册的“VPN 功能配置 → GRE over ipsec”章节给出 `interface tunnel`、`tunnel source`、`tunnel destination` 和静态路由的用法，并说明该章节的 GRE 配置通过 CLI 完成。下文据此整理基本配置结构；是否存在 Web 入口、是否需要显式指定 GRE 模式，以当前版本为准。[EG3200 官方实施手册](https://www.ruijie.com.cn/fw/wd/82344/)。

- 步骤 1：备份运行配置与启动配置，保留 Console / 独立管理通道和原有远程入口。
- 步骤 2：在当前固件帮助和对应手册中确认 Tunnel 支持 GRE over IPv4；如果只支持其他封装模式，停止套用本文 IPv4 示例。
- 步骤 3：确认 Tunnel 编号、Linux 接口名、地址和路由没有冲突，两端 LAN 网段不重叠。
- 步骤 4：先准备访问控制和回程路由，再在维护窗口建立隧道；验收后才保存设备配置。
- 步骤 5：云服务器安全组、主机防火墙、边界设备和运营商链路都需允许所选外层协议。网页能访问不代表 GRE 可以通过。

本文采用已安装 iproute2 的 Linux，接口名约定为 `wan0`、`lan0`。实际可能是 `eth0`、`ens3` 等；公网 IP 必须实际配置在隧道终端接口上。云主机若只看到私网地址、公网地址由云平台映射，应按 NAT 场景核对平台的协议支持。

## 03 / 场景 A：双端公网 IP 的地址规划

两端已有正常的 WAN 和 LAN 配置，Linux 在此充当 IDC 的三层网关，`lan0` 已配置 `10.60.0.1/24`。公网示例地址来自文档保留段，**不能直接在 Internet 使用**；部署时替换为自己的地址、网关和网段。

```text
Office LAN 10.20.0.0/24
        |
        EG3210
        WAN: 198.51.100.10/24, gateway: 198.51.100.1
        Tunnel 1: 172.20.255.1/30
        |
        | Internet: IPv4 + GRE, protocol 47
        |
        Linux
        wan0: 203.0.113.20/24, gateway: 203.0.113.1
        gre-office: 172.20.255.2/30
        lan0: 10.60.0.1/24
        |
IDC LAN 10.60.0.0/24

EG3210 route: 10.60.0.0/24 -> Tunnel 1
Linux route: 10.20.0.0/24 -> 172.20.255.1 via gre-office
Public peer /32 routes remain on the physical WAN path.
```

GRE 对端公网地址的路由必须走底层 WAN，不能再指向 GRE 隧道，否则会递归封装或形成黑洞。这里只增加对端 LAN 的特定路由，不把默认路由切进隧道。若业务网段重叠，先重新规划或设计独立的地址转换方案，不直接添加冲突路由。

## 04 / 场景 A：EG3210 端配置与注释

以下为基于官方手册的 RGOS CLI 基本结构，在确认当前 Tunnel 默认 / 已选模式是 GRE over IPv4 后使用。保留现有 WAN 地址、默认路由、NAT 和安全域配置；不要把完整的其他型号配置覆盖到设备上。

```text
configure terminal
ip route 203.0.113.20 255.255.255.255 198.51.100.1
interface tunnel 1
 tunnel source 198.51.100.10
 tunnel destination 203.0.113.20
 ip address 172.20.255.1 255.255.255.252
 exit
ip route 10.60.0.0 255.255.255.0 tunnel 1
end
```

- `203.0.113.20/32` 路由：把 Linux 公网对端固定到实际 WAN 下一跳；多 WAN 环境还需核对策略路由和出口选择。
- `tunnel source`：填写 EG3210 本机 WAN 的实际地址，不能填写隧道地址。
- `tunnel destination`：填写 Linux 对端在外层可达的地址。
- `ip address`：设置隧道内部地址，`/30` 的两端分别为 `.1` 和 `.2`。
- `ip route 10.60.0.0 ... tunnel 1`：只把 IDC 业务网段送入该隧道。

若当前版本要求 `tunnel mode gre ip` 或接口启用命令，按设备帮助补充；本文没有将这些版本相关命令列为全型号必需项。还应在当前固件支持的接口 MTU 设置中将 Tunnel 的内层 MTU 与 Linux 协调为 1400；如果命令为 `ip mtu 1400`，先通过接口帮助确认语法。1400 是本示例的起始值，测量方法见第 10 节。

为办公网到 IDC 的互访配置 NAT 豁免，确认原来的 Internet 源 NAT 不会把 `10.20.0.0/24 → 10.60.0.0/24` 改成公网或其他地址。在安全域 / ACL 中允许批准的内网业务和必要诊断，而不是让所有 Tunnel 流量进入可信区。具体 NAT 豁免和 ACL 命令依实际 RGOS 版本配置。

## 05 / 场景 A：Linux 端临时配置

先查看现状并确认 `wan0` 上实际具有本例的公网地址。下面的建立命令是运行时配置，重启后通常消失；先在受控实验环境执行，不用它们替换现有网络管理工具。`local` 必须是本机已经持有的地址。[Linux ip-tunnel 手册](https://man7.org/linux/man-pages/man8/ip-tunnel.8.html)。

```sh
# 先确认接口地址、路由和已有隧道，避免覆盖现有配置。
ip -br address
ip route show
ip tunnel show

# 只加载 GRE 内核模块，不关闭防火墙。
sudo modprobe ip_gre

# 外层公网对端始终走 WAN；网关必须替换为真实下一跳。
sudo ip route add 198.51.100.10/32 via 203.0.113.1 dev wan0

# local 是 Linux 本机地址，remote 是 EG3210 公网地址。
# dev 约束外层出口；没有 key，TTL 固定为 64。
sudo ip tunnel add gre-office mode gre \
  local 203.0.113.20 remote 198.51.100.10 dev wan0 ttl 64

# 隧道地址是内层地址；两端使用同一 /30，地址不能相同。
sudo ip address add 172.20.255.2/30 dev gre-office
sudo ip link set dev gre-office mtu 1400 up

# 办公网回程进入 GRE，不修改 Linux 的默认路由。
sudo ip route add 10.20.0.0/24 via 172.20.255.1 dev gre-office
```

如果路由或接口已存在，先判断归属和差异；不要为了继续执行而盲目使用 `replace` 或删除它们。Linux 只与 EG3210 做隧道地址互通时不需要 IP 转发；要连接两侧 LAN，才需要转发、FORWARD 规则和所有业务主机的回程路由。

```sh
# 记录原值；只有充当 LAN 路由网关时才启用 IPv4 转发。
sysctl net.ipv4.ip_forward
sudo sysctl -w net.ipv4.ip_forward=1

# 先观察反向路径检查。正常对称路由不必放宽。
sysctl net.ipv4.conf.all.rp_filter
sysctl net.ipv4.conf.wan0.rp_filter
sysctl net.ipv4.conf.gre-office.rp_filter

# 仅在确认合法的非对称路径被 strict 模式丢弃后考虑 loose 模式。
# 按实际受影响接口选择；不要直接关闭所有接口的来源校验。
# sudo sysctl -w net.ipv4.conf.wan0.rp_filter=2
# sudo sysctl -w net.ipv4.conf.gre-office.rp_filter=2
```

Linux 的 `rp_filter=1` 检查最佳反向路径，`2` 检查来源是否经任意接口可达，实际使用 `all` 与接口值中的最大值。先修正路由再考虑调整；启用 `ip_forward` 还可能重置部分 IPv4 主机 / 路由器参数，变更后重新核对安全设置。[Linux IPv4 转发与反向路径检查](https://docs.kernel.org/networking/ip-sysctl.html)。

办公主机应通过 EG3210 返回 `10.60.0.0/24`；IDC 主机应通过 `10.60.0.1` 返回 `10.20.0.0/24`，或由现有 IDC 核心网关配置对应静态路由。不要用全量 MASQUERADE 掩盖回程缺失和来源检查问题。

## 06 / 场景 B：Linux 公网、EG3210 在 NAT 后

这个场景增加一台可管理的上游 NAT 网关。EG3210 的 WAN 实际地址是 `10.0.0.2`，NAT 网关的内网接口为 `10.0.0.1`，对外固定地址为 `198.51.100.30`；Linux 仍是 `203.0.113.20`。Tunnel 和两侧 LAN 地址与场景 A 相同。

```text
Office LAN 10.20.0.0/24
        |
EG3210 WAN 10.0.0.2/24, gateway 10.0.0.1
Tunnel 1: 172.20.255.1/30
        |
Upstream NAT gateway
inside: 10.0.0.1/24
outside: 198.51.100.30 (fixed public IP)
GRE protocol mapping: 198.51.100.30 <-> 10.0.0.2
restricted public peer: 203.0.113.20
        |
Internet
        |
Linux wan0: 203.0.113.20
gre-office: 172.20.255.2/30
        |
IDC LAN 10.60.0.0/24

EG3210: source 10.0.0.2, destination 203.0.113.20
Linux: local 203.0.113.20, remote 198.51.100.30
```

**可行前提是上游能够双向转发并转换 IP 协议 47，且这个映射能明确落到该 EG3210。**可采用针对 GRE 的静态 DNAT / SNAT，或经过严格防火墙限制的专用一对一 NAT。不要因为路由器有“PPTP passthrough”开关就认为它支持本文普通 GRE；两者报文和连接跟踪处理可能不同。

在独立实验环境建立以下配置；如果从场景 A 切换，先按回退步骤移除该实验隧道和对应路由，再建立场景 B，不同时叠加两套同名配置。

```text
configure terminal
ip route 203.0.113.20 255.255.255.255 10.0.0.1
interface tunnel 1
 tunnel source 10.0.0.2
 tunnel destination 203.0.113.20
 ip address 172.20.255.1 255.255.255.252
 exit
ip route 10.60.0.0 255.255.255.0 tunnel 1
end
```

这里 EG3210 的 `tunnel source` 必须用它本机的私网 WAN 地址。`198.51.100.30` 属于上游 NAT，不能凭空配置为 EG3210 的本机源地址。Linux 的 `remote` 则必须用 NAT 对外地址：

```sh
# 本段替代场景 A 的 Linux 建立命令，不重复建立同名隧道。
sudo modprobe ip_gre
sudo ip route add 198.51.100.30/32 via 203.0.113.1 dev wan0
sudo ip tunnel add gre-office mode gre \
  local 203.0.113.20 remote 198.51.100.30 dev wan0 ttl 64
sudo ip address add 172.20.255.2/30 dev gre-office
sudo ip link set dev gre-office mtu 1400 up
sudo ip route add 10.20.0.0/24 via 172.20.255.1 dev gre-office
```

如果反过来是 Linux 在 NAT 后，原则完全对应：Linux 的 `local` 使用本机私网接口地址，EG3210 的 `tunnel destination` 使用 NAT 对外地址，上游把 GRE 定向映射到 Linux。业务路由和隧道内部地址仍保持成对规划。

只有普通 PAT、不可管理的运营商 CGNAT、上游明确丢弃 GRE、映射存在竞争，或公网地址不断变化时，本文固定对端原生 GRE 方案没有可靠保证。NAT 后一侧先发包或持续 ping，不等于获得通用 NAT 穿透能力；DDNS 也不会自动更新已经设置好的固定隧道对端。此时考虑 NAT-T IPsec 或双方支持的 VPN / 中继方案。

## 07 / 上游 NAT 的协议映射示例

以下 nftables 示例用于说明 **第三台上游 NAT 网关** 的转换条件，不是在公网 Linux 隧道服务器上执行。假设它的 WAN 接口叫 `wan0`，持有或被正确路由到公网地址 `198.51.100.30`，并且能够到达 EG3210 的 `10.0.0.2`。这只适用于一个明确的对端与一个内网终端；多终端共享公网地址要另行验证映射和连接跟踪能力。[nftables 地址转换](https://wiki.nftables.org/wiki-nftables/index.php/Performing_Network_Address_Translation_%28NAT%29)。

```nft
# 上游 Linux NAT 的示意文件；不能覆盖已有 NAT 规则。
table ip gre_nat_sample {
  chain prerouting {
    type nat hook prerouting priority dstnat; policy accept;
    # 只把指定公网对端发来的 GRE 交给 EG3210。
    iifname "wan0" ip saddr 203.0.113.20 ip daddr 198.51.100.30 ip protocol 47 counter dnat to 10.0.0.2
  }
  chain postrouting {
    type nat hook postrouting priority srcnat; policy accept;
    # EG3210 发给该对端的 GRE，使用固定对外地址。
    oifname "wan0" ip saddr 10.0.0.2 ip daddr 203.0.113.20 ip protocol 47 counter snat to 198.51.100.30
  }
}
```

保存为实验文件 `gre-nat-sample.nft` 后，先查看现有规则并检查语法，不直接加载：

```sh
# 仅在上游 Linux NAT 网关检查；--check 不安装规则。
sudo nft list ruleset
sudo nft --check --file gre-nat-sample.nft
```

上游还需 IPv4 转发和限定源 / 目的地址的 FORWARD 放行；**NAT 规则本身不是访问授权**。DNAT 后的过滤目的地址是 `10.0.0.2`；回包的路由、连接跟踪、现有 NAT 优先级和硬件加速也需验证。不要使用全端口 DMZ 或关闭整个防火墙来试通，更不能声称这段片段已在所有家用 NAT、云 NAT 或 EG 固件上验证。

## 08 / 外层 GRE 与内层业务分别过滤

在原生 GRE 实验中，Linux WAN 的 INPUT 只允许真实对端发来的协议 47。场景 A 来源是 `198.51.100.10`，场景 B 则是 `198.51.100.30`；有 OUTPUT 默认拒绝策略时，外发 GRE 也需对应放行。安全组应支持选择 GRE / 协议号，而不是填写端口。

下面是 **合并到现有 nftables 链中的规则片段**，不是可直接加载的完整文件。以场景 A 为例，IDC 只开放测试服务器 `10.60.0.10` 的 TCP 443；业务 ACL 要按实际需求调整。[nftables 报文匹配](https://wiki.nftables.org/wiki-nftables/index.php/Matching_packet_headers)。

```nft
# INPUT：物理 WAN 上的外层 GRE；放在现有终止性拒绝规则前。
iifname "wan0" ip saddr 198.51.100.10 ip daddr 203.0.113.20 ip protocol 47 counter accept
# 同接口其他 GRE 来源拒绝；规划在会绕过它的宽泛放行规则前。
iifname "wan0" ip protocol 47 counter drop

# INPUT：允许对端隧道地址诊断请求 / 回应，其他本机服务默认拒绝。
iifname "gre-office" ip saddr 172.20.255.1 ip daddr 172.20.255.2 icmp type { echo-request, echo-reply } counter accept
# 在此拒绝前按需加入其他明确允许的本机业务和必要 ICMP 差错。
iifname "gre-office" counter drop

# FORWARD：先做内层来源检查，再进入已有的状态与业务放行逻辑。
iifname "gre-office" ip saddr != 10.20.0.0/24 counter drop
# 只允许办公网访问批准的 IDC HTTPS 服务。
iifname "gre-office" oifname "lan0" ip saddr 10.20.0.0/24 ip daddr 10.60.0.10 tcp dport 443 ct state { new, established } counter accept
# 返回流量同样绑定接口、地址和已建立状态。
iifname "lan0" oifname "gre-office" ip saddr 10.60.0.10 ip daddr 10.20.0.0/24 tcp sport 443 ct state established counter accept
# 没有匹配业务规则的隧道转发拒绝，两个方向都限制。
iifname "gre-office" counter drop
oifname "gre-office" counter drop
```

INPUT 与 FORWARD 是不同的链；发送到 Linux 本机的业务还需要本机 INPUT 规则。这里的隧道 ping 规则也不能自动允许对端 LAN 的任意 ping。把必要的 ICMP 差错 / PMTU 处理合并进现有策略，避免大包黑洞；不要简单拒绝全部 ICMP。

检查 `ct state established,related` 的位置、其他 base chain、UFW / firewalld、flowtable 和硬件卸载。将对应链中的这组隧道限制放在可能提前接受所有隧道流量的宽泛放行之前；需要的 ICMP 差错处理应在最后的隧道拒绝之前明确安排。较早链中的 `accept` 不能保证后续链不会再拒绝。对 EG3210 同样分别约束公网外层和解封装后的办公 / IDC 业务，默认不允许跨隧道访问 SSH、Web 管理和其他管理网段。

## 09 / 公网生产使用：先加 IPsec 保护

EG3200 官方手册展示了 GRE over IPsec 的结构，但历史章节使用 3DES、MD5、DH2 等旧参数。本文只参考其 GRE 配置结构，**不把旧算法或示例口令作为安全配置推荐**。应核对实际 RGOS 与 Linux strongSwan 的共同能力，优先采用受支持的 IKEv2、可靠的对端认证及当前安全策略允许的算法。

- 步骤 1：确定必须保留 GRE 的原因。仅做两侧 IPv4 子网的单播互访时，可以直接采用站点到站点 IPsec，减少额外封装。
- 步骤 2：确实需要 GRE 时，选择双方支持的 GRE over IPsec 结构，明确 IPsec transport / tunnel 模式、GRE 源目的地址、身份与流量选择器。固定公网原生 GRE 的选择器应覆盖外层端点间的协议 47，而不是误填隧道 `/30` 或只保护业务网段。
- 步骤 3：对 NAT 场景核对 IPsec NAT-T 和 GRE 嵌套兼容性，通常由 NAT 后一侧主动建立 IKE。也可以设计“IPsec tunnel 先保护一对私有 GRE 端点”的方案，此时 GRE 地址、路由和选择器都要重新规划，不能继续照搬第 06 节的原生 GRE 映射配置。
- 步骤 4：认证与安全算法协商成功后，再验证 GRE 流量确实增加正确 CHILD_SA 的双向加解密计数。IKE 已连接不等于 GRE 已受保护。
- 步骤 5：配置失败关闭策略，避免 SA 消失后同一 GRE 流量以明文从 WAN 发出；保持管理入口独立，使用受控方法测试这一故障情形。

IPsec NAT-T 将 ESP 封装到 UDP 4500，通常还需 UDP 500 的 IKE 建连；没有采用 UDP 封装的 ESP 使用 IP 协议 50。**UDP 4500 是 IPsec 的 NAT 穿越，不能理解为把原生 GRE 改成了 UDP。**经 IPsec 保护的方案应按该方案放行 IKE / ESP，并拒绝公网明文 GRE；不要无条件留下第 08 节的原生 GRE 放行规则。[ESP 的 UDP 封装](https://www.rfc-editor.org/rfc/rfc3948.html)、[strongSwan NAT-T](https://docs.strongswan.org/docs/latest/features/natTraversal.html)。

Linux 可使用 `swanctl --list-sas` 检查协商状态，并在本机查看 XFRM 策略和外层抓包。设备上的 GRE 状态、IPsec 状态与流量计数都需核对。抓包和 XFRM state 可能含业务内容或密钥材料，保留在受控环境，不上传完整输出到公共文章。本站的 [strongSwan 安装笔记](/notes/strongswan-ikev2-vpn/)介绍 Linux 组件，但其中远程接入的 EAP 配置不能直接当作 EG3210 站点互联配置。

## 10 / MTU、MSS 与隧道状态

不带可选字段的 IPv4 + GRE 至少增加 20 + 4 = 24 字节；底层 IP MTU 为 1500 时，简单情况下内层上限是 1476。PPPoE、GRE key、额外封装和 IPsec 会改变预算；不能把 1476 当成所有部署的固定值。本文以 **内层 MTU 1400** 起步，两端协调后测量，仍不足时继续降低。

```sh
# 检查外层对端走 WAN，业务网段走 GRE。
ip route get 198.51.100.10
ip route get 10.20.0.10
ip -d link show dev gre-office
ip -s link show dev gre-office

# 从 Linux 隧道地址测试对端；先确保 EG3210 允许此诊断。
ping -I 172.20.255.2 -c 4 172.20.255.1

# IPv4 ICMP: 1372 字节数据 + 20 IP + 8 ICMP = 1400 字节。
# -M do 禁止分片；失败时分层检查，再逐步降低数据长度。
ping -I 172.20.255.2 -M do -s 1372 -c 4 172.20.255.1

# 仅在受控测试时观察原生 GRE 的外层；不要公开原始抓包。
sudo tcpdump -ni wan0 'ip proto 47 and host 198.51.100.10'
```

场景 B 将上面两个公网对端检查中的 `198.51.100.10` 改为 `198.51.100.30`。IPsec 方案则检查它实际使用的 IKE / ESP 外层；加密正常时不应在 WAN 上看到业务的明文 GRE。[Linux ping 的 PMTU 选项](https://man7.org/linux/man-pages/man8/ping.8.html)。

MTU 1400 时，标准 IPv4 / TCP 头部下的 MSS 起始预算为 1360。必要时在现有防火墙支持的 TCP SYN MSS 调整位置配置，并测试两个方向；MSS 只影响 TCP，不能解决 UDP / ICMP 的尺寸问题。保留必要的 ICMP fragmentation-needed 反馈，不把关闭 PMTU 或忽略 DF 作为首选修复。

接口显示 UP，只说明本地接口状态，不代表对端在线或业务可达。Linux GRE 不提供与所有厂商 GRE keepalive 通用互通的保证；使用实际业务探测，或在双方明确支持时采用 BFD / 动态路由检测。初期先用静态路由，避免将整个办公网路由表无过滤地传播给对端。

## 11 / 持久化配置与重启验收

运行时 `ip` 命令不会自动成为持久配置。下面仅针对 **WAN 已由 systemd-networkd 管理** 的系统；NetworkManager、Netplan 或 cloud-init 管理的主机应在原管理方式中配置，不让两个工具同时接管接口。

场景 A 可建立 `/etc/systemd/network/30-gre-office.netdev`：

```ini
# 场景 A；场景 B 只把 Remote 改为 198.51.100.30。
[NetDev]
Name=gre-office
Kind=gre
MTUBytes=1400

[Tunnel]
Local=203.0.113.20
Remote=198.51.100.10
TTL=64
```

再建立 `/etc/systemd/network/30-gre-office.network`，设置内层地址与业务路由：

```ini
[Match]
Name=gre-office

[Network]
Address=172.20.255.2/30
LinkLocalAddressing=no

[Route]
Destination=10.20.0.0/24
Gateway=172.20.255.1
```

将下面字段 **合并到已经匹配 `wan0` 的现有 `.network` 文件对应节中**，不要新写一个不完整 WAN 文件遮盖现有配置。保留原 WAN 地址、默认路由、DNS 等；有现成对端 `/32` 路由时不重复添加。

```ini
# 合并到现有 WAN 的 [Network]，不是独立完整配置。
[Network]
Tunnel=gre-office

# 场景 B 将 Destination 改为 198.51.100.30/32。
[Route]
Destination=198.51.100.10/32
Gateway=203.0.113.1
```

以上字段分别见 [systemd.netdev](https://man7.org/linux/man-pages/man5/systemd.netdev.5.html) 和 [systemd.network](https://man7.org/linux/man-pages/man5/systemd.network.5.html)。配置检查通过后，在有 Console 的维护窗口重新加载并重配相关接口；重配 WAN 可能中断远程连接。若先用临时命令验证，需安排手动隧道与 networkd 管理的交接，避免同名接口冲突。

将确实需要的 `ip_forward` 等设置纳入本机既有 sysctl 管理，并保持防火墙与 IPsec 失败关闭策略能先于业务生效。EG3210 则使用当前版本的配置保存功能。分别重启两端和上游 NAT 后复测：地址、路由、加密状态、访问限制和业务均恢复，才算完成持久化验收。

## 12 / 分层验收、常见故障与回退

- 步骤 1：确认两端本机源地址与物理出口正确，公网对端 `/32` 路由没有进入 GRE。ICMP 被禁时不能仅凭公网 ping 失败判断底层不通。
- 步骤 2：双端公网先核对协议 47；NAT 场景同时检查上游转换前后的源 / 目的地址和两个方向计数。
- 步骤 3：测试隧道 `.1` 与 `.2`，核对 MTU；一端看到外层包却没有内层流量时，检查源目的配置、GRE 扩展、ACL 和 `rp_filter`。
- 步骤 4：从真实办公主机访问批准的 IDC 服务，并验证回程；隧道 ping 通但 LAN 不通时，检查转发、业务 ACL、LAN 网关与 NAT 豁免。
- 步骤 5：验证未批准服务、其他内网来源和管理网段被拒绝；生产方案还必须确认外层加密和 SA 失效时没有明文回退。
- 步骤 6：在受控环境测试大包、空闲后恢复、上游重启和两端重启，并记录业务丢包 / 延迟与计数变化。

小 ping 能通、HTTPS 或大文件卡住，多半需要检查 MTU / PMTU，而不是继续增加宽泛放行。空闲后失联或只有先发包才能恢复，优先核对 NAT 状态与超时。多 WAN 或云环境出现单向通信时，检查策略路由、反向路径校验、安全组和不同出口的地址转换。

回退时先撤销新业务路由，恢复原业务路径，再删除本次新建隧道；仅移除本次新增的 NAT / ACL / 持久配置，恢复记录过的 sysctl 值。不要清空整个规则集或关闭原有接口。以场景 A 的 Linux 临时配置为例：

```sh
# 仅删除确实由本次实验新建的条目；已有配置不能照删。
sudo ip route del 10.20.0.0/24 via 172.20.255.1 dev gre-office
sudo ip tunnel del gre-office
sudo ip route del 198.51.100.10/32 via 203.0.113.1 dev wan0
```

场景 B 对应删除本次新增的 `198.51.100.30/32` 路由。EG3210 删除本次业务路由和 Tunnel，保留已有配置；持久化文件应先撤销，否则网络管理工具可能再次创建接口。回退后确认原 Internet 出口、管理入口和必要业务恢复，并检查 GRE / NAT 计数不再增长。

## 参考资料

- [RFC 2784：GRE](https://www.rfc-editor.org/rfc/rfc2784.html)
- [RFC 2890：GRE key 与序号扩展](https://www.rfc-editor.org/rfc/rfc2890.html)
- [锐捷 RG-EG3210 产品规格](https://www.ruijie.com.cn/cp/aq-zhwg/eg3210/)
- [EG3200 系列实施手册，GRE over ipsec 章节](https://www.ruijie.com.cn/fw/wd/82344/)
- [Linux ip-tunnel](https://man7.org/linux/man-pages/man8/ip-tunnel.8.html)
- [Linux IP sysctl](https://docs.kernel.org/networking/ip-sysctl.html)
- [nftables NAT](https://wiki.nftables.org/wiki-nftables/index.php/Performing_Network_Address_Translation_%28NAT%29)
- [nftables 报文匹配](https://wiki.nftables.org/wiki-nftables/index.php/Matching_packet_headers)
- [RFC 3948：ESP 的 UDP 封装](https://www.rfc-editor.org/rfc/rfc3948.html)
- [strongSwan NAT Traversal](https://docs.strongswan.org/docs/latest/features/natTraversal.html)
- [Linux ping](https://man7.org/linux/man-pages/man8/ping.8.html)
- [systemd.netdev](https://man7.org/linux/man-pages/man5/systemd.netdev.5.html)
- [systemd.network](https://man7.org/linux/man-pages/man5/systemd.network.5.html)
