---
{"title":"阿里云同地域 VPC 对等连接：内网互通与专线访问 IDC","category":"网络与代理","kind":"实践笔记","date":"2026-11-20","summary":"配置同地域 VPC 对等连接、双向路由与访问控制，说明对等连接不支持专线传递的限制，并用共享 ECR 或 CEN/TR 打通多个 VPC 与其他 IDC。","tags":["阿里云","VPC","对等连接","ECR","CEN","IDC"]}
---
同地域 VPC 对等连接适合让两个 VPC 的私网业务直接通信。一个 VPC 已接入专线时，另一个 VPC 不会因此自动获得 IDC 的访问能力：对等连接不提供传递路由，需要让两个 VPC 分别接入专线网关 ECR，或通过云企业网 CEN 的企业版转发路由器 TR 组织转发。本文说明这三种路径，并补全其他 IDC 的回程路由。

资料核对于 2026-11-20，以 IPv4 为例。所有网段、主机和名称均为虚构示例；下面是实施步骤与验收方法，没有在真实阿里云账号、专线或 IDC 执行配置。物理专线、VBR 与设备 BGP 的详细步骤可结合本站的[阿里云与 IDC 专线互联笔记](/notes/aliyun-idc-bgp/)阅读。

## 01 / 确定地址与访问目标

本例两个 VPC 位于同一地域，例如杭州；交换机可以位于不同可用区。IDC1 已有专线接入，IDC2 通过现有机房互联连接 IDC1。这里的“同区”指同地域，不要求同一可用区。

```text
地域：cn-hangzhou
VPC-A:       10.60.0.0/16
  vSwitch-A: 10.60.10.0/24
  ECS-A:     10.60.10.10
VPC-B:       10.70.0.0/16
  vSwitch-B: 10.70.10.0/24
  Service-B: 10.70.10.20:443
IDC1:        10.20.0.0/16
IDC2:        10.30.0.0/16
  Service-2: 10.30.10.30:443

初始云端路径：
VPC-A <---- VPC 对等连接 ----> VPC-B

已有云下路径：
VBR ---- 专线 ---- CPE / IDC1 ---- 原有 WAN ---- IDC2
```

先写明谁访问谁：A 访问 B 的 HTTPS 服务，A、B 访问 IDC1 / IDC2 的指定服务，以及获准的 IDC 到云端连接。路由可达不代表所有网段、所有端口都应开放。确认 VPC、IDC、容器、VPN 和互联接口地址没有冲突；本文不处理地址重叠。

## 02 / 创建对等连接前的检查

- 核对两个 VPC 的地域、账号、VPC ID、主辅 CIDR，以及测试 ECS 所在交换机关联的实际路由表。
- 盘点已有 NAT、VPN、ECR、TR、默认路由和更明细的路由；保存变更前的路由表、访问规则及关联关系。
- 准备相应账号权限，按控制台要求开通云数据传输 CDT；跨账号需要双方配合。开通产品与产生收费是不同事项。
- 先准备 B 的健康检查服务和限定来源的安全规则，再安排小范围测试。

首次创建与跨账号接收要求以当前[对等连接操作指南](https://help.aliyun.com/zh/vpc/vpc-peer-to-peer-connection/)为准。同地域对等连接的计费规则不能套用于 ECR、TR、专线端口、运营商线路或诊断工具，实施前分别确认费用。

## 03 / 创建同地域 VPC 对等连接

- 步骤 1：在 VPC 控制台进入“对等连接”，选择发起端 VPC-A 所在地域并创建连接。
- 步骤 2：填写连接名称，选择 VPC-A；接收端选择同地域的 VPC-B，跨账号时填写核实过的接收账号信息。
- 步骤 3：同账号连接自动接受；跨账号由 B 所属账号核对发起方后接受请求。
- 步骤 4：确认连接已建立，记录真实连接 ID，并分别检查两端路由。

同账号创建时，如果选择“VPC系统路由表添加对端VPC CIDR路由”，仍要读回实际条目。该选项针对系统路由表；业务交换机使用自定义路由表时，应检查并补齐对应路由。创建成功只证明连接资源就绪。

## 04 / 在业务路由表配置双向路由

在 A 的业务交换机实际使用的路由表中，添加目的为 B 业务网段、下一跳类型为“VPC对等连接”的路由，选择刚创建的连接。在 B 的有效路由表配置返回 A 的路由。下面是路由清单，不是可直接执行的 CLI：

```text
VPC-A 的有效路由表：
  10.70.0.0/16 -> VPC 对等连接 peer-a-b

VPC-B 的有效路由表：
  10.60.0.0/16 -> VPC 对等连接 peer-a-b

预期流向：
  10.60.10.10 -> peer-a-b -> 10.70.10.20
  10.70.10.20 -> peer-a-b -> 10.60.10.10
```

如果授权范围只有一个交换机，可把对端目的前缀缩小到相应 `/24`，同时保证回程覆盖真实来源。不要重复添加已经存在的等效路由，也不要为图省事把默认路由或整个 `10.0.0.0/8` 指向对等连接。

检查与既有路由的最长前缀匹配关系、条目状态和冲突。Linux 来宾的路由只显示来宾到虚拟网关的路径，不能用它代替云上路由表核对。[VPC 路由表说明](https://help.aliyun.com/zh/vpc/vpc-route-table/)。

## 05 / 放行业务并处理私有 DNS

B 的 ECS 安全组按需求允许来自 `10.60.10.0/24` 的 TCP 443；A 的出方向规则、相关网络 ACL、主机防火墙和应用监听也要允许对应流量。若使用网络 ACL，应同时核对正向和返回流量所需规则。跨 VPC 连通不会自动授予安全组身份或业务权限；RDS 等托管服务还需检查自己的访问白名单或安全组设置。[ECS 安全组实践](https://help.aliyun.com/zh/acsg/best-practices-for-ecs-security-groups-1)。

先用 IP 和正确的 TLS 域名验证网络，再验证 DNS。PrivateZone 的解析范围需要覆盖获准的 VPC；对等连接本身不会替你建立跨网络解析规则。云端解析 IDC 域名可规划出站终端节点与条件转发，IDC 解析云端私有域名可规划入站终端节点；对应路径与 DNS 的 UDP / TCP 53 也要放行。[云上云下 DNS 互通](https://help.aliyun.com/zh/dns/pvtz-implementation-of-on-cloud-off-cloud-domain-name-resolution-exchange-based-on-intranet-dns-resolution)。

## 06 / 为什么不能借对端 VPC 的专线中转

下面的路径不属于原生对等连接支持的传递能力，即使 A 添加 IDC 路由指向对等连接也不能据此打通：

```text
原生对等连接不支持的传递路径：
VPC-A -- 对等连接 --> VPC-B -- VBR / ECR -- 专线 -- IDC

对等连接同样不提供以下路径：
VPC-A -- 对等连接 --> VPC-B -- 对等连接 --> VPC-C
```

阿里云官方组网说明明确列出了对等连接不支持经对端 VBR 访问 IDC 的限制。对等连接连接的是两个 VPC，不会把 B 的其他路由自动传播给 A。给 B 内某台普通 ECS 开启 `ip_forward`，也不会让云产品自动获得这种传递能力。[对等连接与 TR 组合方案](https://help.aliyun.com/zh/landing-zone/solution-135)。

若只需访问 B 上某个代理服务，可以单独设计应用代理，由代理发起到 IDC 的连接；它需要自己的认证、访问控制、容量与高可用设计，来源地址和审计语义也可能改变。它不等同于把 A 的全部内网透明接入专线。需要三层互通时采用下面的 ECR 或 TR 路径。

## 07 / 方案一：两个 VPC 分别接入同一个 ECR

只有少量 VPC，且 A、B 之间已用对等连接互通时，可以保留对等连接，让 A、B 分别关联承载专线的 ECR。A 到 IDC 的流量直接进入 ECR，不经过 B。

```text
VPC-A <---------- 对等连接 ----------> VPC-B
  |                                    |
  +---------------- ECR ---------------+
                     |
                    VBR
                     |
                  专线
                     |
                 CPE / IDC1 ---- WAN ---- IDC2

A -> B:    对等连接
A -> IDC:  A -> ECR -> VBR -> 专线 -> IDC
B -> IDC:  B -> ECR -> VBR -> 专线 -> IDC
```

ECR 只支持 BGP 动态路由，不能照搬旧 VBR 上连的静态路由方案。同一 ECR 下的 VPC 之间不通过 ECR 互通，因此 A 与 B 的对等连接仍有作用；ECR 也不提供它所绑定的 VPC 与 TR 之间的云上中转。[ECR 功能与限制](https://help.aliyun.com/zh/express-connect/user-guide/ecr/)。

- 步骤 1：确认现有专线、VBR 与 BGP 正常；检查 VBR 的 MPBGP 能力与 ECR / VBR 本端 ASN 匹配情况。
- 步骤 2：在 ECR 的 VPC 页签分别关联 A、B；跨账号先完成相应资源授权。
- 步骤 3：审核发布到 IDC 的允许前缀，分别覆盖获准的 A、B 业务网段。匹配模式与增量模式的发布范围不同；清空前缀会恢复明细路由发布，不能当作拒绝所有路由。
- 步骤 4：从 CPE 仅向云端发布获准且实际可达的 IDC1 / IDC2 网段，读回 A、B 的有效路由表，确认 IDC 前缀的动态路径与 ECR 关联一致。
- 步骤 5：确认 CPE 和 IDC 内部都已得到 A、B 的回程路由，再开放测试流量。

一个 VPC 同一时刻只接收单一路由动态源；已关联 TR 且开启路由同步的 VPC 不能直接再关联 ECR。不要为了通过创建检查随意关闭现有同步，应先设计迁移窗口和替代路由。[创建和管理 ECR](https://help.aliyun.com/zh/express-connect/user-guide/create-and-manage-the-leased-line-gateway-ecr)。跨账号的对等连接接受与 ECR 资源授权是两件事，需要分别处理。[跨账号 ECR 授权](https://help.aliyun.com/zh/express-connect/user-guide/cross-account-ecr-authorization)。

已有的“VBR 上连”点到点连接需按存量架构评估迁移；该产品已经停止售卖，不应作为新建共享专线方案。[VBR 上连说明](https://help.aliyun.com/zh/express-connect/user-guide/create-and-manage-a-vbr-to-vpc-connection)。

## 08 / 方案二：通过 CEN 企业版 TR 统一转发

VPC 更多、需要分组隔离或统一路由策略时，可以把 A、B 接入同地域企业版 TR，再让 ECR 关联 TR。已有受支持的 VBR 直连 TR 架构可按实际连接维护，不必为了套用图示立即改造。

```text
VPC-A -- attachment-A --+
                        +-- 企业版 TR -- ECR -- VBR -- 专线 -- IDC1 -- IDC2
VPC-B -- attachment-B --+

本例共享 TR 路由表：
  10.60.0.0/16 -> attachment-A
  10.70.0.0/16 -> attachment-B
  10.20.0.0/16 -> ECR 连接
  10.30.0.0/16 -> ECR 连接

VPC-A / VPC-B 的有效路由表：
  10.20.0.0/16 -> TR 连接
  10.30.0.0/16 -> TR 连接
```

- 步骤 1：创建 A、B 的 VPC 连接，按地域可用区要求选择交换机并预留接口地址。关联 ECR 与目标 TR，核对默认创建的路由关系。
- 步骤 2：确定每个连接的“关联转发”路由表。来自 A 的报文查 A 连接关联的表；IDC 返回报文查 ECR 连接关联的表，两边都必须有正确出口。
- 步骤 3：配置“路由学习”，让目标 TR 路由表得到 A、B 与 IDC 的获准前缀。VPC 系统路由与自定义路由的发布规则不同，不要指望 B 的自定义对等连接路由自动成为共享中转路由。
- 步骤 4：配置“路由同步”或经审核的 VPC 静态路由，使 VPC 知道 IDC 的出口；同时让云端业务前缀经 ECR / BGP 发布到 IDC。

创建 VPC 连接时，“自动为VPC的所有路由表配置指向转发路由器的路由”会添加三段 RFC 1918 汇总路由：`10.0.0.0/8`、`172.16.0.0/12`、`192.168.0.0/16`。它可能改变无关私网流量的出口；本例优先审核具体 IDC 前缀。[创建 VPC 连接](https://help.aliyun.com/zh/cen/user-guide/connect-vpcs/)。

“关联转发”决定入口流量查哪张表，“路由学习”决定网络路由进入哪些 TR 表，“路由同步”决定 TR 路由下发到连接的网络。不能只看到某张 TR 表有路由就宣布全网可达。[关联转发](https://help.aliyun.com/zh/cen/user-guide/associated-forwarding)、[路由学习](https://help.aliyun.com/zh/cen/user-guide/route-learning)。

VPC 开启路由同步会影响其全部路由表；ECR 连接配置了允许前缀时，还要检查实际同步、发布的前缀范围。以上共享 TR 表只表示本例获准的互通域；需要隔离时，应分别设计路由表、传播策略和安全规则。[路由同步](https://help.aliyun.com/zh/cen/user-guide/route-synchronization)。

## 09 / 专线之后还有其他 IDC 时补齐整条路径

本例 IDC2 经 IDC1 的现有 WAN 接入，不是再建立一个 VPC 对等连接。应逐段验证下列条件：

- IDC1 的 CPE 能经机房核心 / WAN 到达 `10.30.0.0/16`，下一跳实际可达。
- CPE 向云端的 BGP 出方向策略允许发布 IDC1 与 IDC2 的业务前缀，云端能看到它们且下一跳正确。
- CPE 从云端收到 A、B 前缀，并按设计传递给 IDC1 核心及 IDC2；不能只停留在边界设备的 BGP 表中。
- IDC2 返回 `10.60.0.0/16`、`10.70.0.0/16` 的路径指向 IDC1 的专线出口，经过的 WAN 与防火墙都允许业务双向通信。

```text
去程路径：
ECS-A -> ECR / TR -> VBR -> 专线 -> CPE -> IDC1 WAN -> IDC2 服务

回程路径：
IDC2 服务 -> IDC2 网关 -> WAN -> IDC1 边界 CPE -> 专线 -> VBR -> ECR / TR -> ECS-A

预期 CPE 路由规划：
  10.30.0.0/16 -> 原有 IDC WAN
  10.60.0.0/16 -> 云端专线，由 BGP 学习
  10.70.0.0/16 -> 云端专线，由 BGP 学习

预期 IDC2 路由规划：
  10.60.0.0/16 -> IDC1 WAN / 边界 CPE
  10.70.0.0/16 -> IDC1 WAN / 边界 CPE
```

这些是本例的路由设计目标，不是要求无条件重分发所有 BGP / IGP 路由。发布汇总前确认整个汇总范围的可达性，按业务限定前缀，防止黑洞或路由泄漏。BGP 邻居 Established 只能说明会话建立，不能证明 IDC2 前缀已发布、已选中或业务允许。

如果 IDC2 有独立专线和 VBR，也可按支持条件让其接入 ECR，为云端访问 IDC2 建立直接路径。但 IDC1 与 IDC2 经云端 ECR 互访是另一项需求：ECR 添加 VBR 的“允许IDC间业务访问”功能默认不开放，需申请并核对条件，不能从云到两个 IDC 都可达推断 IDC 之间也可互访。

## 10 / 保留对等连接时避免路由抢占

A、B 仍需直接互访时，可以保留对等连接，把 IDC 前缀交给 ECR 或 TR，形成明确的目的网段分工。若同步路径同时带来对端 VPC 前缀，应先处理冲突与选路策略，再发布；不要把相同前缀的两条路径当作自动主备。

```text
VPC-A 的目标选路：
  10.70.0.0/16 -> 对等连接
  10.20.0.0/16 -> ECR 动态路径 或 TR 连接
  10.30.0.0/16 -> ECR 动态路径 或 TR 连接

VPC-B 的目标选路：
  10.60.0.0/16 -> 对等连接
  10.20.0.0/16 -> ECR 动态路径 或 TR 连接
  10.30.0.0/16 -> ECR 动态路径 或 TR 连接
```

这里的“或”表示选择一种已规划架构。核对实际下一跳、最长前缀匹配、路由状态以及回程，不能只比较路由条数。原生私网互通通常保留业务源地址；不要为了绕过缺失的回程而随意增加 SNAT，这会改变审计、访问控制和故障定位。

## 11 / 从云路由到真实服务分层验收

先核对控制台中的对等连接状态、业务路由表、ECR / TR 关联、BGP 已收发前缀和 IDC2 回程。可用网络智能服务 NIS 路径分析辅助检查路由、安全组与网络 ACL；它不发送业务数据，反向路径也应另行分析，最后仍要测试真实服务。

在已获准的 Linux 测试 ECS 上，以下命令只观察来宾地址和内核选路；不会显示阿里云虚拟网络内部每一跳：

```sh
ip -br address
ip route get 10.70.10.20
ip route get 10.30.10.30
```

为两个示例域名准备匹配的服务证书与 `/healthz` 端点后，使用 `--resolve` 固定私网目的 IP，并保留域名、SNI 和证书校验；`--noproxy` 避免继承本机代理而误测其他路径。需要按自己的服务修改域名和地址，不要直接探测未获授权的主机。

```sh
curl --noproxy '*' --connect-timeout 3 --max-time 10 \
  --resolve app-b.example.com:443:10.70.10.20 \
  https://app-b.example.com/healthz

curl --noproxy '*' --connect-timeout 3 --max-time 10 \
  --resolve service-idc2.example.com:443:10.30.10.30 \
  https://service-idc2.example.com/healthz
```

再检查测试机实际使用的 DNS，确认得到预期私网地址。若系统未安装 `dig`，先按发行版安装 DNS 诊断工具。

```sh
dig app-b.example.com A
dig service-idc2.example.com A
```

记录测试源、目的、时间、端口和应用响应；需要主动从 IDC 发起云端连接时，也单独验收。HTTP 响应需与服务约定一致，不能把任意 200、一次 ping 成功或 TCP 握手成功当作全部业务通过。Linux 选路和 curl 参数见[ip-route 手册](https://man7.org/linux/man-pages/man8/ip-route.8.html)、[curl 手册](https://curl.se/docs/manpage.html)。

## 12 / 常见故障的定位顺序

- A 到 B 不通：先查连接是否已接受、两端业务交换机用了哪张表、对端与回程路由是否存在，再查安全规则与服务监听。
- A 到 B 通，A 到 IDC 不通：先确认是否误用了“对等连接借 B 专线”的路径；再查 A 是否直接接入 ECR 或 TR。
- IDC1 通、IDC2 不通：查 IDC2 前缀是否被 CPE 发布、云端是否采用，以及 IDC2 到 A / B 的回程，重点检查机房 WAN 和防火墙。
- TR 表中有路由仍不通：查流量入口连接实际关联的表，而非控制台随意打开的一张表，再核对同步到 VPC 的结果。
- VPC 无法关联 ECR：检查已有动态路由源、资源归属授权和产品限制，先制定迁移方案。
- IP 可达、域名失败：查私有解析范围、转发规则及 DNS 网络路径，避免把公共地址解析结果误认成私网互通。
- 握手可达、较大请求卡住：结合专线 / WAN 的 MTU、路径 MTU 发现和设备计数定位，不因 ping 小包成功就排除链路问题。

## 13 / 变更、回退与高可用

- 变更前保存 VPC / TR 有效路由、ECR 发布前缀与模式、CPE BGP 策略、IDC 核心回程及访问规则，标记本次新增项。
- 先准备返回路径与精确访问规则，再按变更计划引入测试前缀或测试源；静态路由灰度与动态路由同步的生效范围不同，需逐项确认。
- 验收后逐步扩大业务范围，检查既有 VPN、专线、互联网出口和其他 VPC 的流量是否改变。
- 回退时恢复本次改动的路由关系、发布策略与规则，先确认旧路径可用，再移除新资源；不要批量清空路由表或拆除原有专线。

两个 VPC 共享一条物理专线仍有单线路故障风险。重要业务需独立规划双线路、不同接入点 / 设备、BGP 选路、收敛及故障演练；创建了两个逻辑连接不等于获得物理冗余。本文提供的拓扑和检查清单须在目标账号与设备上逐项验收后使用。

## 参考资料

- [阿里云：VPC 对等连接](https://help.aliyun.com/zh/vpc/vpc-peer-to-peer-connection/)
- [阿里云：VPC 路由表](https://help.aliyun.com/zh/vpc/vpc-route-table/)
- [阿里云：对等连接与 TR 组合组网及传递限制](https://help.aliyun.com/zh/landing-zone/solution-135)
- [阿里云：ECR 功能与使用限制](https://help.aliyun.com/zh/express-connect/user-guide/ecr/)
- [阿里云：创建和管理 ECR](https://help.aliyun.com/zh/express-connect/user-guide/create-and-manage-the-leased-line-gateway-ecr)
- [阿里云：跨账号 ECR 授权](https://help.aliyun.com/zh/express-connect/user-guide/cross-account-ecr-authorization)
- [阿里云：VBR 上连说明](https://help.aliyun.com/zh/express-connect/user-guide/create-and-manage-a-vbr-to-vpc-connection)
- [阿里云：连接 VPC 与企业版 TR](https://help.aliyun.com/zh/cen/user-guide/connect-vpcs/)
- [阿里云：关联转发](https://help.aliyun.com/zh/cen/user-guide/associated-forwarding)
- [阿里云：路由学习](https://help.aliyun.com/zh/cen/user-guide/route-learning)
- [阿里云：路由同步](https://help.aliyun.com/zh/cen/user-guide/route-synchronization)
- [阿里云：ECS 安全组实践](https://help.aliyun.com/zh/acsg/best-practices-for-ecs-security-groups-1)
- [阿里云：云上云下 DNS 互通](https://help.aliyun.com/zh/dns/pvtz-implementation-of-on-cloud-off-cloud-domain-name-resolution-exchange-based-on-intranet-dns-resolution)
- [ip-route 手册](https://man7.org/linux/man-pages/man8/ip-route.8.html)
- [curl 手册](https://curl.se/docs/manpage.html)
