---
{"title":"阿里云与 IDC 专线互联：BGP 接入内网实践","category":"网络与代理","kind":"实践笔记","date":"2026-10-04","summary":"用双专线、VBR 与 ECR 打通阿里云 VPC 和 IDC 内网，配置 BGP 前缀过滤、双向主备选路，并验证回程路由、BFD 与故障切换。","tags":["阿里云","IDC","BGP","专线","混合云"]}
---
专线接入内网，需要把物理链路、BGP 路由交换、云端转发和业务访问逐层打通。本文以同地域、同账号、IPv4 的 IDC 与阿里云 VPC 互联为例，先说明 VBR + 专线网关 ECR 的新建方案，再说明已有云企业网 CEN / 转发路由器 TR 的处理方式。所有地址、ASN 和设备名称均为示例；资料核对于 2026-10-04，未对实际云网络或 IDC 执行配置与故障演练。

## 01 / 先确定组网路径

阿里云高速通道承载物理专线，边界路由器 VBR 对接 IDC 边界设备 CPE，ECR 连接 VBR 与云上网络。本例使用两台 CPE、两条专线和两个 VBR，正常业务优先走 A 链路，B 链路保持 BGP 在线。单专线可从同样的 A 链路步骤开始，但不能据此获得链路冗余。[高速通道入门指引](https://help.aliyun.com/zh/express-connect/getting-started/getting-started-guide)。

```text
IDC LAN 10.20.0.0/16 / AS 65050
        |
  IDC core: iBGP + reachable next hops
        |
        +-- CPE-A -- Circuit A / VLAN 110 -- VBR-A --+
        |                                         |
        +-- CPE-B -- Circuit B / VLAN 120 -- VBR-B --+-- ECR / AS 65010
                                                         |
                                                  VPC 10.60.0.0/16

Existing CEN network:
CPE -- Circuit -- VBR -- ECR -- Enterprise TR -- VPCs
Existing direct attachment:
CPE -- Circuit -- VBR ------- Enterprise TR -- VPCs
```

已有 VBR 直接接入 TR 的网络可以按现有架构维护，不必为了照搬本文迁移。多 VPC 使用 TR 时，要分别核对连接关联、路由学习和 VPC 的实际路由表。旧的 VBR 上连产品已经停止售卖，新方案应按 ECR 等当前接入方式规划。[VBR 上连说明](https://help.aliyun.com/zh/express-connect/user-guide/create-and-manage-a-vbr-to-vpc-connection)。

## 02 / 规划地址、ASN 与发布范围

先完成地址盘点，检查 IDC、VPC、容器网段、VPN 地址池和互联地址是否重叠。重叠地址无法仅靠 BGP 解决，需先调整地址或单独设计地址转换。这里不向专线发布默认路由，也不把整段 RFC 1918 地址都当作需要互通的业务网络。

```text
IDC business prefix:       10.20.0.0/16
Cloud business prefix:     10.60.0.0/16
IDC ASN:                   65050
ECR / VBR local ASN:       65010

Circuit A: VLAN 110 / 172.20.255.0/30
  Alibaba Cloud VBR-A:     172.20.255.1
  Customer CPE-A:          172.20.255.2
Circuit B: VLAN 120 / 172.20.255.4/30
  Alibaba Cloud VBR-B:     172.20.255.5
  Customer CPE-B:          172.20.255.6
Interconnect subnet mask:  255.255.255.252

CPE-A router ID:           192.0.2.11
CPE-B router ID:           192.0.2.12
IDC test host / DNS:       10.20.10.10 / 10.20.0.53
Cloud test host:           10.60.10.20
Test hostname:             app.corp.example.com
```

`192.0.2.11` 和 `192.0.2.12` 是文档地址，用于展示不同的 router ID；生产中换为规划的唯一标识。它们不是 BGP 邻居地址。专线的 BGP 邻居使用各自 /30 内的互联 IP，业务前缀使用网络地址。

ECR 支持自定义 ASN，本例选择 `65010`，IDC 选择 `65050`，实际需避开现有自治域编号；`65025` 是阿里云保留值。ECR 使用非默认 ASN 时，应先关联未配置 BGP 的 VBR，再配置 BGP，让 VBR 继承正确的 ASN。[创建和管理 ECR](https://help.aliyun.com/zh/express-connect/user-guide/create-and-manage-the-leased-line-gateway-ecr)。

## 03 / 交付物理线路并配置 VBR

申请专线、运营商施工、机房跳线和云端端口开通是实际交付流程。开始三层配置前，确认端口状态、光功率、错误计数和约定带宽；双线路应核实不同设备、接入点和物理路径，不能只依据两份线路编号认定冗余。

在高速通道控制台分别创建 VBR-A 和 VBR-B，选择对应的物理专线接口，填写第 02 节的 VLAN、阿里云侧 IP、客户侧 IP 和 /30 掩码。IDC 子接口及运营商交付 VLAN 要与 VBR 一致；共享专线按运营商提供的交付参数配置，不直接套用本例 VLAN。[创建和管理 VBR](https://help.aliyun.com/zh/express-connect/user-guide/create-and-manage-a-vbr)。

先从 CPE 的互联接口检查对端连通，再检查 TCP 179。下面仅用于已配置接口的 Linux / FRR 设备，接口名需替换；ICMP 被限制时，结合 ARP、接口计数和运营商测试判断。

```sh
ip -br address
ip -s link show dev eth1.110
ping -I 172.20.255.2 -c 4 172.20.255.1
sudo tcpdump -ni eth1.110 -c 20 'arp or tcp port 179'
sysctl net.ipv4.ip_forward
```

不要向公网开放 BGP。边界访问规则只允许对应互联 IP 之间的 TCP 179；Linux CPE 还需按发行版方式持久启用转发，并核对转发链和反向路径检查。抓包只用于受控诊断，避免长期保存业务载荷。

## 04 / 关联 ECR，再创建 BGP 邻居

按以下顺序完成本例的云端配置：

- 创建 ECR，ASN 填 `65010`；检查两个 VBR 均支持 ECR 所需的 MPBGP 能力。
- 在 ECR 的 VBR 页签添加 VBR-A、VBR-B，再确认其 BGP 本端 ASN 为 `65010`。
- 在 ECR 关联目标 VPC；本例使用“允许的前缀路由”的匹配模式，发布已确认可达的 `10.60.0.0/16`。
- 在每个 VBR 创建 IPv4 BGP 组，Peer AS 填 IDC 的 `65050`，按计划设置路由条目上限及 BGP 共享密钥。
- VBR-A 的 BGP 邻居 IP 填客户侧 `172.20.255.2`；VBR-B 填 `172.20.255.6`。IDC 配置中的邻居则是阿里云侧 `.1` 和 `.5`。

云侧默认 ASN 常见为 `45104`，但本例以已关联 ECR 后的实际本端 ASN 为准。使用 VBR 直连 ECR 或 TR 时，不需要再执行旧教程中的“宣告 BGP 网段”步骤；该步骤属于 VBR 上连场景。[BGP 配置说明](https://help.aliyun.com/zh/express-connect/user-guide/configure-and-manage-bgp/)。

ECR 的允许前缀设置会改变对 IDC 发布的路由，包含聚合和明细路由撤回行为，不能当作普通防火墙白名单。变更前保存当前发布清单，确认聚合范围内可达性，并同步检查 CPE 的接收策略；本例只接受准确的 `/16`。BGP 密钥需两端一致，实际密钥通过受控渠道配置，不能写入笔记或 Git。[ECR 专线选路示例](https://help.aliyun.com/zh/express-connect/use-cases/local-idc-can-use-ecr-to-route-leased-line-link-to-the-cloud)。

## 05 / IDC 侧 BGP 配置示例

以下采用 FRRouting 10.4 文档中的语法，仅展示专线 eBGP 与前缀策略。它不是华为、H3C、Cisco 或 Juniper 的通用命令，也不包含接口配置、软件安装与 IDC 内部路由的完整部署。使用前核对实际版本，并将密钥占位符替换为两端约定的值。

两台 CPE 必须已能到达 IDC 业务网段，且路由表中存在准确的 `10.20.0.0/16` 路由。本例显式启用 `bgp network import-check`。只有若干 `/24` 路由时，应改为发布已批准的真实前缀；不要为了让 `network` 生效随意添加长期存在的丢弃聚合路由。[FRR BGP 网络发布](https://docs.frrouting.org/en/stable-10.4/bgp.html)。

在 CPE-A 上合并以下配置片段：

```conf
ip prefix-list IDC-EXPORT seq 10 permit 10.20.0.0/16
ip prefix-list CLOUD-IMPORT seq 10 permit 10.60.0.0/16
!
route-map FROM-CLOUD permit 10
 match ip address prefix-list CLOUD-IMPORT
 set local-preference 200
!
route-map TO-CLOUD permit 10
 match ip address prefix-list IDC-EXPORT
!
router bgp 65050
 bgp router-id 192.0.2.11
 bgp network import-check
 neighbor 172.20.255.1 remote-as 65010
 neighbor 172.20.255.1 password REPLACE_WITH_SHARED_SECRET
 address-family ipv4 unicast
  network 10.20.0.0/16
  neighbor 172.20.255.1 activate
  neighbor 172.20.255.1 route-map FROM-CLOUD in
  neighbor 172.20.255.1 route-map TO-CLOUD out
 exit-address-family
!
```

在 CPE-B 上使用对应片段：

```conf
ip prefix-list IDC-EXPORT seq 10 permit 10.20.0.0/16
ip prefix-list CLOUD-IMPORT seq 10 permit 10.60.0.0/16
!
route-map FROM-CLOUD permit 10
 match ip address prefix-list CLOUD-IMPORT
 set local-preference 100
!
route-map TO-CLOUD permit 10
 match ip address prefix-list IDC-EXPORT
 set as-path prepend 65050 65050
!
router bgp 65050
 bgp router-id 192.0.2.12
 bgp network import-check
 neighbor 172.20.255.5 remote-as 65010
 neighbor 172.20.255.5 password REPLACE_WITH_SHARED_SECRET
 address-family ipv4 unicast
  network 10.20.0.0/16
  neighbor 172.20.255.5 activate
  neighbor 172.20.255.5 route-map FROM-CLOUD in
  neighbor 172.20.255.5 route-map TO-CLOUD out
 exit-address-family
!
```

前缀列表没有 `le` 或 `ge`，只匹配写明的网段与掩码；未匹配的路由由这里的策略拒绝。需要新增业务前缀时逐条审查添加，避免直接放开 `0.0.0.0/0 le 32` 或无条件重分发 connected / static。[FRR 前缀过滤](https://docs.frrouting.org/en/stable-10.4/filter.html)。

## 06 / 两个方向分别设计主备选路

IDC 到云端：来自 A 的云路由设置 LOCAL_PREF 200，来自 B 的设置 100。两台 CPE 和 IDC 核心需要通过既有 iBGP 或路由反射器传递这些候选路由，并保证 next hop 可达；按设计使用 `next-hop-self` 等方式。LOCAL_PREF 不是两台独立设备之间自动共享的开关，内部路由未打通时，两个值无法完成整个 IDC 的主备选择。

云端到 IDC：B 链路对同一 IDC 前缀额外 prepend 两次 `65050`，让云端在其他优先级条件相同的情况下偏好 A 的较短 AS_PATH。选择结果还受云端路由策略和更具体前缀影响，必须在 ECR / TR 中确认实际生效路径。[FRR 路由策略](https://docs.frrouting.org/en/stable-10.4/routemap.html)。

两条链路发布相同的业务前缀，才能按这些属性比较路径。如果 A 发布 `/16`、B 发布其中的 `/24`，该 `/24` 流量会优先匹配更具体路由，不能指望 prepend 改回 A。IDC 核心也不能保留永远指向 A 的静态云路由而没有故障跟踪。验收需要同时观察去程与回程，有状态防火墙还应核对路径及会话状态。

## 07 / 逐张核对云端与回程路由

在本例 ECR 直连 VPC 的路径上，核对以下结果：

- CPE-A / CPE-B：收到 `10.60.0.0/16`，向各自 VBR 发布 `10.20.0.0/16`，业务下一跳可达。
- VBR-A / VBR-B：学习到 IDC 前缀，物理专线侧下一跳分别为 `.2` 和 `.6`。
- ECR：能看到两个 VBR 的 IDC 路由及选路结果，也能看到通往 VPC 的业务路由。
- VPC：目标 ECS 所在 vSwitch 实际使用的路由表，有匹配 `10.20.0.0/16`、指向 ECR 的有效回程路由。
- IDC 核心与主机：到云端的路由已进入实际转发表；返回的 IDC 业务流量可从 CPE 进入正确的内网网关。

如果已有 CEN / 企业版 TR，不要直接把同一 VPC 另接 ECR：已关联 TR 且开启路由同步的 VPC 不能同时接收另一个动态路由源。根据现网使用 ECR → TR → VPC，或保留 VBR → TR → VPC，先盘点当前连接和路由源。

TR 中，“关联”决定入站连接查哪张路由表，“路由学习”决定哪些连接的路由进入该表。必须同时检查 ECR / VBR 与 VPC 连接的关联表、学习关系，以及向 ECR / VBR 发布云路由的设置。[TR 路由学习](https://help.aliyun.com/zh/cen/user-guide/route-learning/)、[VBR 连接配置](https://help.aliyun.com/zh/cen/user-guide/connect-vbrs)。

TR 默认创建 VPC 连接时可向 VPC 路由表添加三个私网聚合路由，下一跳指向 TR；这与把所有动态明细路由自动同步给 VPC 是不同机制。无论使用聚合路由、动态同步或明确的静态路由，都需检查业务所在路由表的最长匹配和冲突路由，不能只看 TR 已经学到 IDC 前缀。[VPC 连接与路由设置](https://help.aliyun.com/en/cen/user-guide/connect-vpcs/)。

## 08 / 放行业务与内网 DNS

路由进入转发表后，再按业务端口配置 ECS 安全组、网络 ACL、IDC 防火墙和主机防火墙。规则应使用经过确认的 IDC / VPC 源网段；无状态 ACL 还要考虑响应方向和客户端临时端口。路由白名单不能替代业务访问控制。

本例应用 `app.corp.example.com` 解析为 `10.60.10.20`，由可达的内部 DNS 提供记录。DNS 查询和响应需要可用路径；不能因为 ping 私网 IP 正常，就认为域名访问也正常。保留原源地址有助于审计，本例不对 IDC 与 VPC 互访做 SNAT。

物理专线提供私网传输路径，不能据此推定业务已端到端加密。按数据要求继续使用 TLS，或另行设计双方支持的加密隧道。不要通过关闭应用证书校验来处理专线连通性问题。

## 09 / BFD、告警与业务探测

先让 BGP 和基础业务稳定，再启用双方兼容的 BFD。按实际链路确认单跳 / 多跳、控制报文模式和定时参数，不能把最小间隔直接当作通用值。阿里云 ECR 主备示例采用发送与接收间隔各 1000ms、检测倍数 3；最终以两端能力及协商结果为准，这不是业务恢复时间承诺。[官方 BFD 参数示例](https://help.aliyun.com/zh/express-connect/use-cases/local-idc-can-use-ecr-to-route-leased-line-link-to-the-cloud)。

FRR 还需要启用并运行 bfdd，再把 BFD 与对应 BGP 邻居关联。检查会话状态和实际协商值；BFD 可以加速链路故障检测，但不能判断应用健康，也不能证明路由另一端的所有业务网段可达。[FRR BFD](https://docs.frrouting.org/en/stable-10.4/bfd.html)。

告警至少覆盖邻居 Down、路由条目异常、BFD 变化、端口错误 / 丢包、链路利用率和双向业务探测。根据已批准的发布清单设置接收上限与预警余量，变更聚合模式时计入可能出现的明细路由；不要用过小的硬限制触发邻居反复断开。

## 10 / 分层验收与故障切换

在 CPE-A 上检查邻居、发布路由和转发表，CPE-B 则把邻居地址换为 `172.20.255.5`：

```sh
sudo vtysh -c 'show bgp ipv4 unicast summary'
sudo vtysh -c 'show bgp ipv4 unicast 10.60.0.0/16'
sudo vtysh -c 'show bgp ipv4 unicast neighbors 172.20.255.1 advertised-routes'
sudo vtysh -c 'show ip route 10.60.10.20'
sudo vtysh -c 'show bfd peers'
```

未启用 BFD 时跳过最后一项。记录两个方向的前缀、下一跳、最佳路径与邻居稳定时间；`Established` 只说明会话建立，仍需对照云控制台中的路由和主机访问结果。

从 IDC 测试主机验证应用；工具需已安装，内部 DNS 记录需事先存在。以下使用默认受信任 CA 的 HTTPS 服务，私有 CA 应按规范安装到信任库。

```sh
ip route get 10.60.10.20
ping -c 4 10.60.10.20
dig @10.20.0.53 app.corp.example.com A
curl --connect-timeout 5 --max-time 15 \
  --resolve app.corp.example.com:443:10.60.10.20 \
  https://app.corp.example.com/health
```

`--resolve` 用来独立验证 IP 路径、TLS 和应用，不能代替上一项 DNS 验收。从云端测试机反向检查 `ip route get 10.20.10.10`，再访问 IDC 已批准的测试服务。小包正常、较大请求卡住时，进一步检查全路径 MTU 和 PMTUD；不要盲目降低业务主机 MTU。

在维护窗口或实验环境，确认 B 链路可用后，按批准方案对 A 做一次故障演练。阿里云提供高速通道故障演练功能，可模拟线路故障；也应分别验证 IDC 边界设备和内部路由的故障场景。[高速通道故障演练](https://help.aliyun.com/zh/express-connect/user-guide/failover-test)。

- A 失效：记录邻居 / BFD Down、云端与 IDC 最佳路径转向 B 的时间，以及应用失败率。
- 业务恢复：分别验证两端新连接和持续请求，不以存量 TCP 会话一定无中断作为假设。
- A 恢复：确认预定主路径重新生效、路由无持续抖动、B 仍可作为备用。
- 留档：记录检测、路由收敛、应用恢复三个阶段的耗时，并与目标恢复时间比较。

## 11 / 常见问题按层定位

- 邻居 Idle / Active：查接口、VLAN、/30 地址、TCP 179、两端 ASN 与密钥，先不要调整业务路由。
- Established 但没有 IDC 前缀：查 CPE 是否存在准确的业务路由、`network` 声明和出方向前缀策略。
- IDC 收不到云路由：查 ECR / TR 关联、云路由发布清单与 CPE 入方向过滤是否一致。
- 单向可通：查业务所在 VPC 路由表、IDC 核心回程、防火墙、有状态会话和反向路径检查。
- IP 可访问、域名失败：查内部 DNS 记录、解析服务器的路由与 DNS 防火墙规则。
- 主链路断了仍走 A：查内部静态路由、失效的 next hop、未传播的路由撤回，以及更具体路由是否仍指向 A。
- BFD 反复 Down：查两端模式、实际协商参数、控制报文策略与链路拥塞，不先放宽所有访问规则。

## 12 / 变更记录与回退

变更前保存云端连接关系、有效路由、CPE 配置与双向探测基线。先建立备用路径并验收，再切换主路径偏好；地址、ASN、VLAN 和发布范围不要在同一次切换中全部修改。

回退以恢复原路由策略和发布清单为目标：先确认旧路径可用，再撤回本次新增前缀或还原偏好，验证两端应用及 DNS，最后清理确认不再使用的连接。只有回退路径已验证可用时，才移除替代路由。长期维护保留前缀负责人、线路交付信息、配置版本和最近一次故障演练结果。

## 参考资料

- [阿里云：高速通道入门指引](https://help.aliyun.com/zh/express-connect/getting-started/getting-started-guide)
- [阿里云：VBR 上连与当前接入方式](https://help.aliyun.com/zh/express-connect/user-guide/create-and-manage-a-vbr-to-vpc-connection)
- [阿里云：创建和管理 VBR](https://help.aliyun.com/zh/express-connect/user-guide/create-and-manage-a-vbr)
- [阿里云：创建和管理 ECR](https://help.aliyun.com/zh/express-connect/user-guide/create-and-manage-the-leased-line-gateway-ecr)
- [阿里云：配置和管理 BGP](https://help.aliyun.com/zh/express-connect/user-guide/configure-and-manage-bgp/)
- [阿里云：ECR 专线链路选路](https://help.aliyun.com/zh/express-connect/use-cases/local-idc-can-use-ecr-to-route-leased-line-link-to-the-cloud)
- [阿里云：TR 路由学习](https://help.aliyun.com/zh/cen/user-guide/route-learning/)
- [阿里云：VBR 连接](https://help.aliyun.com/zh/cen/user-guide/connect-vbrs)
- [阿里云：VPC 连接](https://help.aliyun.com/en/cen/user-guide/connect-vpcs/)
- [阿里云：高速通道故障演练](https://help.aliyun.com/zh/express-connect/user-guide/failover-test)
- [FRRouting 10.4：BGP](https://docs.frrouting.org/en/stable-10.4/bgp.html)
- [FRRouting 10.4：Filtering](https://docs.frrouting.org/en/stable-10.4/filter.html)
- [FRRouting 10.4：Route Maps](https://docs.frrouting.org/en/stable-10.4/routemap.html)
- [FRRouting 10.4：BFD](https://docs.frrouting.org/en/stable-10.4/bfd.html)
