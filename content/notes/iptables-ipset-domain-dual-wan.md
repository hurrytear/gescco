---
{"title":"iptables + ipset 双公网网关：按域名选择不同出口","category":"网络与代理","kind":"实践笔记","date":"2026-10-07","summary":"用 dnsmasq、ipset、连接标记、策略路由和 SNAT 实现双公网出口分流，说明多网卡回程、DNS 与 TTL 边界、故障保护、持久化和验收回退。","tags":["iptables","ipset","dnsmasq","双出口","策略路由","CONNMARK"]}
---
一台 Linux 网关连接两条公网线路时，可以让指定域名相关的连接走 WAN2，其余连接走 WAN1。实现链路是：dnsmasq 将查询结果写入 ipset，iptables 为新连接选择并保存标记，`ip rule` 按标记查独立路由表，最后在对应出口执行 SNAT。

**这是一套根据 DNS 结果进行目标 IP 分流的方案。iptables 并不识别 HTTPS 请求中的域名；共享 IP 上的其他域名也可能一起被分流。** 适合可管理 DNS、接受 IP 级分类误差的办公网或实验网；需要严格按每个请求的域名选择出口时，应使用应用代理等其他设计。

本文以 Ubuntu Server 24.04 LTS 的 IPv4 专用网关为例，资料核对于 2026-10-07。以下使用示例内网、文档公网地址及保留域名；必须替换为自己的接口、地址和获准测试域名。配置未在真实公网网关执行，不包含运营商链路实测。

## 01 / 拓扑、流量范围和标记规划

```text
LAN clients: 10.20.0.0/24
  default gateway + DNS: 10.20.0.1
              |
          lan0: 10.20.0.1/24
          Linux gateway
              |                    |
wan1: 198.51.100.2/24      wan2: 203.0.113.2/24
gateway: 198.51.100.1      gateway: 203.0.113.1
table: 101                table: 102
mark: 0x1/0xff            mark: 0x2/0xff

portal.example.com -> dw_wan1 -> WAN1
cdn.example.net    -> dw_wan2 -> WAN2
other destinations           -> WAN1
```

假设三张接口已正确配置地址，两条 WAN 均能独立通信，主路由表有 LAN 直连路由和经 WAN1 的默认路由。这里是两个独立公网下一跳，不是对同一出口叠加两条无差别默认路由。

- 只分类从 `lan0` 进入、源地址属于 `10.20.0.0/24` 的转发连接；网关自身的 DNS、更新和 `curl` 属于 OUTPUT，不在本例分流范围。
- 两个 WAN 地址固定，因此使用 SNAT；动态 PPPoE/DHCP 应改用对应接口的 MASQUERADE，并由链路事件更新网关与路由表。
- 预留 mark 低 8 位 `0xff`、表号 101/102 和规则优先级 1001/1002；必须与 VPN、容器、QoS 和其他策略路由协调，不能直接覆盖已有用途。
- 本例没有公网入站 DNAT、网关 WAN2 管理服务或跨网段内网转发。它们需要额外的入站连接标记、源地址路由和 ACL，不能照搬出站规则假定回程已解决。
- LAN 的 IPv6 转发在基线中不可用。若已有 IPv6 出口，需单独实现 IPv6 集合、规则和路由，或在接入策略中关闭该路径；只配置 IPv4 不会阻止 IPv6 绕行。

## 02 / 先核对软件、规则归属与备份

在专用实验网关上准备 `iptables`、`ipset`、`dnsmasq`、`iproute2`、`conntrack`、`dnsutils` 和 `tcpdump`。若使用 Ubuntu 软件包，安装 dnsmasq 可能启动服务，先核对现有 DNS 监听者。以下只读命令用于确认版本、后端和当前网络：

```sh
# Gateway: inspect without changing firewall or routing state.
iptables --version
ipset --version
dnsmasq --version
ip -br address
ip -4 route show table all
ip -4 rule show
sudo iptables-save
sudo ipset list -name
sudo ss -lntup
```

`dnsmasq --version` 的编译选项必须包含 `ipset`，而不是 `no-ipset`。`iptables-nft` 与 `iptables-legacy` 的规则视图不同；所有保存、恢复和查看命令必须使用同一后端。`ipset` 也不是原生 nftables set，不能把 `ipset=` 随意改成 `nftset=` 而保留剩余规则。先验证当前内核和后端支持 `set`、`MARK`、`CONNMARK` 与 conntrack 扩展。

若 UFW、firewalld、Docker 或其他工具管理网关规则，应把策略纳入它们的生命周期，不能让多个管理器反复覆盖。本例要求有带外控制台，且只接入受控测试客户端；现有 INPUT 管理规则和默认拒绝入站策略保留。初次应用期间暂停测试客户端业务，避免分阶段配置影响正在建立的连接。

```sh
# Gateway: retain this directory and shell variable for rollback.
umask 077
egress_backup_dir=$(mktemp -d "$PWD/domain-egress-before.XXXXXX")
sudo iptables-save > "$egress_backup_dir/iptables.v4"
sudo ipset save > "$egress_backup_dir/ipset.save"
ip -4 rule show > "$egress_backup_dir/rules.txt"
ip -4 route show table all > "$egress_backup_dir/routes.txt"
sysctl net.ipv4.ip_forward \
  net.ipv4.conf.all.rp_filter net.ipv4.conf.lan0.rp_filter \
  net.ipv4.conf.wan1.rp_filter net.ipv4.conf.wan2.rp_filter \
  > "$egress_backup_dir/sysctl.txt"
```

另外备份 dnsmasq 配置、接口管理配置及相关 systemd unit。上面的路由文本用于核对，不是可以直接喂给 `ip route restore` 的二进制备份。后续命令均在网关执行，除非明确标为 LAN 客户端；它们是有状态变更，只应在完成地址替换和冲突检查后运行。

## 03 / 创建域名集合与内部目的地址豁免

确认 `dw_wan1`、`dw_wan2`、`dw_bypass4` 尚不存在，再创建集合。前两个保存 IPv4 主机地址，第三个保存不应套用公网出口分类的网段。集合需要先于 dnsmasq 和引用它们的 iptables 规则存在。

```sh
# Gateway: first installation; abort on unexpected existing set names.
sudo ipset create dw_wan1 hash:ip family inet hashsize 1024 maxelem 65536
sudo ipset create dw_wan2 hash:ip family inet hashsize 1024 maxelem 65536
sudo ipset create dw_bypass4 hash:net family inet

for network in \
  0.0.0.0/8 10.0.0.0/8 100.64.0.0/10 127.0.0.0/8 \
  169.254.0.0/16 172.16.0.0/12 192.168.0.0/16 \
  198.18.0.0/15 224.0.0.0/4 240.0.0.0/4 \
  198.51.100.0/24 203.0.113.0/24; do
  sudo ipset add dw_bypass4 "$network"
done
```

最后两项是本例 WAN 直连网段，真实部署时按实际拓扑替换；企业内部使用的公网地址、VPN 和专线路由也应加入豁免。豁免只表示继续走原有路由与 ACL，不表示自动允许访问。

这里有意不配置 timeout，避免集合元素先于客户端 DNS 缓存到期而使新连接走错出口。代价是旧地址会积累，必须建立第 10 节的清理与容量监控；不能把这份最小案例当作无需维护的永久名单。集合类型、超时与交换行为参见 [ipset 官方手册](https://ipset.netfilter.org/ipset.man.html)。

## 04 / 两张策略路由表与反向路径检查

先确认表 101/102 和优先级 1001/1002 没有其他用途，再为各表写入自己的 WAN 直连路由、LAN 回程和默认路由。本例只新增独立表，不替换主表默认路由；主表仍负责网关本机流量和未分类回包。

```sh
# Gateway: tables and priorities are reserved exclusively for this example.
sudo ip -4 route add table 101 10.20.0.0/24 dev lan0 scope link
sudo ip -4 route add table 101 198.51.100.0/24 dev wan1 scope link src 198.51.100.2
sudo ip -4 route add table 101 default via 198.51.100.1 dev wan1 metric 10
sudo ip -4 route add unreachable default table 101 metric 32760

sudo ip -4 route add table 102 10.20.0.0/24 dev lan0 scope link
sudo ip -4 route add table 102 203.0.113.0/24 dev wan2 scope link src 203.0.113.2
sudo ip -4 route add table 102 default via 203.0.113.1 dev wan2 metric 10
sudo ip -4 route add unreachable default table 102 metric 32760

sudo ip -4 rule add priority 1001 fwmark 0x1/0xff lookup 101
sudo ip -4 rule add priority 1002 fwmark 0x2/0xff lookup 102
ip -4 rule show
```

`unreachable default` 是同表中较低优先级的拒绝路由。当正常默认路由被撤销时，避免空表查询直接落到主表的 WAN1。它不是链路探测：网关仍在但运营商远端故障时，内核不会自动判定并切换线路。后面的 FORWARD 出口约束还会拦截标记与出口不一致的包，防止表被误删后的错误绕行。参见 [ip-rule 手册](https://man7.org/linux/man-pages/man8/ip-rule.8.html) 与 [ip-route 手册](https://man7.org/linux/man-pages/man8/ip-route.8.html)。

对这个确实存在两条回程的网关，在开启转发后将两个 WAN 的 `rp_filter` 设为 loose 模式。WAN2 入包的源地址可能在主表中经 WAN1 才是最佳反向路由，strict 检查会丢弃合法回复。不要全局关闭来源检查。

```sh
# Gateway: record old values first; enable only for this routing role.
sudo sysctl -w net.ipv4.ip_forward=1
sudo sysctl -w net.ipv4.conf.wan1.rp_filter=2
sudo sysctl -w net.ipv4.conf.wan2.rp_filter=2
sudo sysctl -w net.ipv4.conf.lan0.rp_filter=1
sysctl net.ipv4.conf.all.rp_filter \
  net.ipv4.conf.lan0.rp_filter net.ipv4.conf.wan1.rp_filter \
  net.ipv4.conf.wan2.rp_filter net.ipv4.conf.all.src_valid_mark
```

Linux 取 `all` 与接口的 `rp_filter` 较大值；若 `all=2`，LAN 也会实际采用 loose，需结合原有安全策略调整。开启 `ip_forward` 可能重置部分主机/路由器参数，因此按顺序应用并复查。本文只在 LAN 出站方向恢复连接标记，不能直接假定把 `src_valid_mark=1` 套在所有多出口方案上都正确。参见 [Linux 内核网络参数](https://docs.kernel.org/networking/ip-sysctl.html)。

## 05 / dnsmasq 把解析结果送入集合

将下面内容合并到网关的 `/etc/dnsmasq.d/70-domain-egress.conf`，确认主配置和 systemd 启动参数确实加载这个目录。`198.51.100.53` 代表已经可达的上游递归 DNS，并非公共可用的真实服务器；保留已有内网域、DNSSEC 和 DHCP 配置，不要覆盖整份服务配置。

dnsmasq 只绑定回环和 LAN 地址。INPUT 应只允许可信 LAN 使用 TCP/UDP 53，避免开放公共递归服务；本例的允许规则在下一节。`no-resolv` 配合显式上游，避免把查询再送回自身形成环路。本例不新增 DHCP 服务；由已有 DHCP 下发网关 `10.20.0.1` 和唯一受控 DNS `10.20.0.1`，不要同时下发不更新这些集合的“备用 DNS”。

```ini
# Merge into the effective dnsmasq configuration.
listen-address=127.0.0.1,10.20.0.1
bind-interfaces
no-resolv
server=198.51.100.53
cache-size=1000

ipset=/portal.example.com/dw_wan1
ipset=/cdn.example.net/dw_wan2
```

域名规则覆盖该域名及其子域查询，但不会主动枚举或预取所有子域。只有观察到相关解析结果后才会加入地址。测试域名必须在受控上游 DNS 中有可用记录，或替换为你拥有且可测试的真实域名；不要用本机 `hosts` 或 `address=` 回答来代替对真实转发 DNS 路径的验证。参见 [dnsmasq 官方手册的 ipset 选项](https://dnsmasq.org/docs/dnsmasq-man.html)。

存在 CNAME、多级 CDN、其他资源域、HTTPS/SVCB 地址提示或应用内缓存时，应逐个核对客户端实际使用的地址是否进入集合。不要把“配置了主站域名”当作已覆盖整个网站。两个出口使用不同 DNS 视角时，可增加按域指定的上游，但还要核对网关本机查询的实际路由；选择 resolver 不等于设置业务出口。

```sh
# Gateway: check the same effective configuration used by the service.
sudo dnsmasq --test --conf-file=/etc/dnsmasq.conf
# After verifying includes, listeners, existing clients and upstream reachability:
sudo systemctl restart dnsmasq
sudo systemctl status dnsmasq --no-pager
sudo journalctl -u dnsmasq -n 40 --no-pager
```

启动参数如果额外指定配置文件或目录，语法检查也必须带上相同参数。检查启动日志是否出现缺失集合、无 ipset 编译支持或向集合写入失败；解析有结果不代表 ipset 更新一定成功。先把集合写入问题解决，再放行分流客户端。

## 06 / 标记、SNAT 和出口约束的完整规则片段

下面保存为网关上的 `domain-egress.v4`。它只声明本方案的四条专用链，不定义或清空内建链，也不改变 INPUT/FORWARD 的默认策略。先确认 `DW_CLASS`、`DW_NAT`、`DW_INPUT`、`DW_FORWARD` 尚不存在。

**这是受控实验网中允许 LAN 主动访问两条 WAN 的规则。** 正式网络若按目标、端口、用户进一步限制访问，应把这里的 ACCEPT 收窄或交给现有 ACL；不要把宽泛放行放到企业规则前面。标记与出口不一致的 DROP 必须位于宽泛的 ESTABLISHED 放行之前。

```iptables
*mangle
:DW_CLASS - [0:0]
-A DW_CLASS -m addrtype --dst-type LOCAL -j RETURN
-A DW_CLASS -m set --match-set dw_bypass4 dst -j RETURN
-A DW_CLASS -j CONNMARK --restore-mark --nfmask 0xff --ctmask 0xff
-A DW_CLASS -m mark ! --mark 0x0/0xff -j RETURN
-A DW_CLASS -m conntrack ! --ctstate NEW -j RETURN
-A DW_CLASS -m set --match-set dw_wan2 dst -j MARK --set-xmark 0x2/0xff
-A DW_CLASS -m mark --mark 0x0/0xff -m set --match-set dw_wan1 dst -j MARK --set-xmark 0x1/0xff
-A DW_CLASS -m mark --mark 0x0/0xff -j MARK --set-xmark 0x1/0xff
-A DW_CLASS -j CONNMARK --save-mark --nfmask 0xff --ctmask 0xff
COMMIT

*nat
:DW_NAT - [0:0]
-A DW_NAT -s 10.20.0.0/24 -o wan1 -m mark --mark 0x1/0xff -j SNAT --to-source 198.51.100.2
-A DW_NAT -s 10.20.0.0/24 -o wan2 -m mark --mark 0x2/0xff -j SNAT --to-source 203.0.113.2
COMMIT

*filter
:DW_INPUT - [0:0]
:DW_FORWARD - [0:0]
-A DW_INPUT -i lan0 -s 10.20.0.0/24 -d 10.20.0.1 -p udp --dport 53 -j ACCEPT
-A DW_INPUT -i lan0 -s 10.20.0.0/24 -d 10.20.0.1 -p tcp --dport 53 -j ACCEPT

-A DW_FORWARD -i lan0 ! -s 10.20.0.0/24 -j DROP
-A DW_FORWARD -m conntrack --ctstate INVALID -j DROP
-A DW_FORWARD -i lan0 -s 10.20.0.0/24 -m mark --mark 0x1/0xff ! -o wan1 -j DROP
-A DW_FORWARD -i lan0 -s 10.20.0.0/24 -m mark --mark 0x2/0xff ! -o wan2 -j DROP
-A DW_FORWARD -i lan0 -s 10.20.0.0/24 -p udp --dport 53 -j REJECT
-A DW_FORWARD -i lan0 -s 10.20.0.0/24 -p tcp --dport 53 -j REJECT
-A DW_FORWARD -i lan0 -s 10.20.0.0/24 -p tcp --dport 853 -j REJECT
-A DW_FORWARD -i lan0 -s 10.20.0.0/24 -p udp --dport 853 -j REJECT
-A DW_FORWARD -i lan0 -s 10.20.0.0/24 -o wan1 -m mark --mark 0x1/0xff -m conntrack --ctstate NEW,ESTABLISHED,RELATED -j ACCEPT
-A DW_FORWARD -i lan0 -s 10.20.0.0/24 -o wan2 -m mark --mark 0x2/0xff -m conntrack --ctstate NEW,ESTABLISHED,RELATED -j ACCEPT
-A DW_FORWARD -i wan1 -o lan0 -d 10.20.0.0/24 -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
-A DW_FORWARD -i wan2 -o lan0 -d 10.20.0.0/24 -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
COMMIT
```

先在目标网关测试，再用 `--noflush` 装入尚未挂接的专用链；确保集合已存在。该选项保留其他链，但文件中再次声明的同名自定义链会被清空后重建，所以不能借此覆盖未知同名链。各表提交不是覆盖整套网络的单一事务；命令失败时先排查，不要继续挂接。参见 [iptables-restore 手册](https://man7.org/linux/man-pages/man8/iptables-restore.8.html)。

```sh
# Gateway: validate first, then load dedicated chains without built-in hooks.
sudo iptables-restore --wait 5 --test --noflush < domain-egress.v4
sudo iptables-restore --wait 5 --noflush < domain-egress.v4

# First installation only: inspect positions and avoid duplicate hooks.
sudo iptables -w 5 -t filter -I INPUT 1 -j DW_INPUT
sudo iptables -w 5 -t filter -I FORWARD 1 -j DW_FORWARD
sudo iptables -w 5 -t nat -I POSTROUTING 1 -j DW_NAT
# Activate classification last, after routes, guards and SNAT are ready.
sudo iptables -w 5 -t mangle -I PREROUTING 1 -i lan0 -s 10.20.0.0/24 -j DW_CLASS
```

内建链的具体插入位置必须结合已有 ACL、NAT 豁免和打标规则审查；本例的第 1 条只适用于已确认归属的实验基线。规则不重定向客户端 DNS，而是拒绝通过转发路径访问其他 TCP/UDP 53 和常见的 853；访问网关 DNS 走 INPUT，仍可用。HTTPS 上的 DoH 无法只凭端口 443 与普通网站可靠区分，需终端管理、受控代理或应用级准入配合。

## 07 / 为什么默认连接也要保存 CONNMARK

`MARK` 修改当前数据包的 mark，`CONNMARK` 保存到连接跟踪条目。规则只操作低 8 位，保留高位给其他协作功能；前提是低位确实由本方案独占。掩码和 SNAT 语义参见 [iptables 扩展手册](https://man7.org/linux/man-pages/man8/iptables-extensions.8.html)。

- 新连接：先排除网关本机和内部目的地址，再恢复连接标记；没有标记且状态为 NEW 时，先匹配 WAN2 集合，再匹配 WAN1 集合，最后给默认流量也赋 `0x1`。
- 后续出站包：从同一 conntrack 条目恢复 `0x1` 或 `0x2`，立即结束分类；集合增删不会让已经分类的连接改道。
- 同一 IP 同时进入两集合：本例明确 WAN2 优先。这只是冲突策略，并不能区分同 IP 上的两个域名；应监控交集并由业务决定是否接受。
- WAN 回包：不经过这个仅挂在 `lan0` 的分类器。conntrack 执行反向 NAT，主表的 LAN 路由把包送回客户端；不在两个 WAN 入站方向重新按目标集合选出口。
- NAT：只在新连接建立映射时选择转换，后续沿用连接状态。修改 SNAT 规则不会自动迁移已有连接；不能期待 NAT 计数器与每个数据包等量增长。

默认流量若始终保持 mark=0，某个 IP 后来进入 WAN2 集合，持续中的连接就可能被重新分类。这里保存默认 `0x1`，并只处理 NEW，避免这个问题。部署前已建立且没有分类标记的连接不会被追溯打标，应在维护窗口让客户端正常结束并重新连接，而不是清空整台网关的 conntrack。

## 08 / 从 DNS、路由到公网源地址逐层验收

先在受控上游 DNS 中让 `cdn.example.net` 的 A 记录返回测试服务器 `192.0.2.80`，`portal.example.com` 返回另一台测试服务器 `192.0.2.81`；真实验收改为可达且有日志权限的域名与目标。示例地址不能作为真实 Internet 服务器。清除测试客户端相关缓存或用新进程查询，并从 LAN 客户端执行：

```sh
# LAN client: these names need controlled upstream DNS records.
dig @10.20.0.1 cdn.example.net A +noall +answer
dig @10.20.0.1 portal.example.com A +noall +answer
```

在网关确认实际返回的每个 A 地址进入对应集合；多 A 记录不能只查第一条。下面 `ip route get` 使用显式 mark，是检查路由表而不是证明 iptables 已正确分类，必须继续结合真实流量的规则计数器验收。

```sh
# Gateway: use the actual DNS answers if they differ from the lab records.
sudo ipset test dw_wan2 192.0.2.80
sudo ipset test dw_wan1 192.0.2.81
ip -4 route get 192.0.2.80 from 10.20.0.10 iif lan0 mark 0x2
ip -4 route get 192.0.2.81 from 10.20.0.10 iif lan0 mark 0x1
sudo iptables -t mangle -nvL DW_CLASS --line-numbers
sudo iptables -t filter -nvL DW_FORWARD --line-numbers
sudo iptables -t nat -nvL DW_NAT --line-numbers
sudo conntrack -L -f ipv4 --mark 0x2/0xff
```

继续从配置了网关 DNS 的 LAN 客户端新建 HTTPS 连接。测试服务需有匹配域名的有效证书；不以关闭 TLS 校验来“证明成功”。普通 `curl` 使用操作系统解析器，不会继承前一条 `dig @...` 的服务器选择，因此先确认客户端系统 DNS。

```sh
# LAN client: use authorized HTTPS services with valid domain certificates.
curl -4 --connect-timeout 5 --max-time 15 https://cdn.example.net/
curl -4 --connect-timeout 5 --max-time 15 https://portal.example.com/
```

从受控远端服务日志确认 WAN2 请求的源地址为第二条公网地址，WAN1 为第一条。也可在网关两个 WAN 上分别限量抓取测试目标，检查出站接口和 SNAT 后的源地址；不要采集无关用户流量。看一个公共“我的 IP”网站只能说明该网站自己的出口，不能证明另一个域名走了哪条线路。

```sh
# Gateway: run in separate terminals during a new authorized test connection.
sudo tcpdump -ni wan1 -c 10 'host 192.0.2.80 and tcp port 443'
sudo tcpdump -ni wan2 -c 10 'host 192.0.2.80 and tcp port 443'
```

最低验收还包括：默认新连接走 WAN1、目标新连接走 WAN2、同时命中时的优先级、已有连接在域名集合变化后保持出口、失败 WAN 不偷偷转到另一 WAN、DNS 绕过受限、IPv6 路径符合范围。限量抓包在没匹配到足够报文时不会自动结束，可用 Ctrl+C 停止。

## 09 / 故障排查与双出口切换的边界

- DNS 有结果但集合为空：先确认客户端查询经过本机 dnsmasq，再检查编译选项、配置 include、地址族、写入权限、集合容量与日志；不要先改路由。
- mark 正确但出口不对：核对更高优先级的 `ip rule`、实际表内容、后续修改 mark 的规则、流量卸载与规则管理器。本文要求分类流量经过这些 Netfilter 链，已有 flowtable/硬件加速路径必须单独验证或排除。
- WAN2 发出但没有回复：核对 SNAT 后源地址是否属于 WAN2、上游是否允许该地址、ARP/下一跳是否可达、回程 ACL 和 `rp_filter`；应用 MTU 与 ICMP 差错也要检查。
- 改名单后仍走旧出口：先确认是否复用了旧 TCP/QUIC 连接；域名集合只决定新连接，不强行迁移旧连接。
- 相同 IP 的两个网站不能分开：这是目的 IP 分类的限制，不是再加一条域名字符串匹配就能解决。HTTPS、连接复用、共享 CDN 都要求重新评估代理方案。

本例采用指定线路不可用时不换出口的策略。若要自动切换，应按出口分别探测真实服务路径，明确哪些域名允许换公网源地址，并仅为获准的新连接改变分类。已有 TCP/QUIC 连接的 NAT 状态仍绑定旧公网地址，通常需要重连；两个公网地址不能让普通连接无缝漂移。

## 10 / TTL、缓存、共享 IP 与集合维护

dnsmasq 的 `ipset=` 负责把观察到的地址加入集合，并不提供一份“域名到 IP 到 TTL”的完整生命周期数据库。不要假定给集合设置 `timeout 300`，就等同于每条 DNS 记录的 TTL；客户端、应用缓存及已有解析路径可能与集合过期时间不同。

本例的无超时集合能避免直接的时间差漏分流，但会保留旧 IP。域名从 WAN2 改到 WAN1 或删除域名配置，也不会自动移除此前加入的地址；它们甚至可能已被分配给其他站点。上线前应确定可接受的保留期、共享 IP 冲突规则和容量告警。

- 小规模受控环境：维护完整的实际域名清单、最近解析结果和观察时间；在维护窗口停止新业务，重新查询并校验，处理客户端缓存后重建集合。不要在仍接收业务时直接 `ipset flush dw_wan2`。
- 长期运行：用能跟踪域名、别名、地址来源、TTL 和宽限期的控制程序维护快照。一个地址可能由多个域名引用，只有所有引用到期后才能移除。
- 原子更新：同类型临时集合经过校验后可用 `ipset swap` 切换，但仍要解决 dnsmasq 同时写入造成的丢更新。需要串行化写入、暂停接入或可靠重放增量；一次 swap 本身并不是完整同步协议。
- 开机恢复：恢复经校验的近期快照并主动预热关键域名，再允许新业务。客户端可能保留网关重启前的 DNS 缓存，空集合启动会使其新连接错误走默认出口。

监控至少包括集合大小与交集、写入失败、DNS 解析失败、规则计数器、conntrack 使用量，以及两条 WAN 的业务成功率。对域名分类准确性要求超过这些边界时，应调整架构，不能把 DNS 观察当成可靠的逐请求身份识别。

## 11 / 持久化要同时覆盖集合、规则和路由

`iptables-save` 只保存防火墙规则，不会保存 ipset 内容、`ip rule`、路由表、接口地址、sysctl 或 dnsmasq 配置。单独执行 `netfilter-persistent save` 不能代表这套方案已完整持久化。

按现有网络管理器编排启动流程，而不是把初次安装命令原样塞进 `rc.local`：

- 第一步：恢复接口地址、主表路由和经审核的 sysctl；初始 FORWARD 保持拒绝，确认两条 WAN 的实际就绪状态。`network-online.target` 是否有效还取决于对应 wait-online 服务。
- 第二步：创建集合并恢复可信快照；只有核对名称、类型与所有权后才采用 `ipset -exist`。再恢复表 101/102、拒绝兜底路由和唯一的策略规则。
- 第三步：在集合存在后恢复防火墙。使用完整的 `iptables-save` 快照时不再重复手工加 hook；采用本文专用链文件时，通过 `iptables -C` 检查每条 hook，防止服务重启后重复插入。
- 第四步：启动 dnsmasq、验证集合写入、预热关键域名，并按约定解决客户端旧缓存；全部成功后才恢复新业务接入。
- 第五步：DHCP 续租、PPPoE 重拨、网络管理器重载或防火墙重载时，重建实际下一跳并复查 hook、集合与策略规则。失败时保持拒绝，不要自动放开默认路由。

同样顺序可以由 systemd oneshot 服务或发行版网络 hook 实现，但脚本必须检查地址、已存在规则的归属和每一步退出状态。路由可用 `replace` 更新本方案独占的条目；`ip rule add` 会产生重复规则，应先精确核对对应优先级，而不是盲目重复执行或清空整个 RPDB。

最终必须做一次受控重启验收，验证客户端持有旧 DNS 缓存时仍能正确分类。保存配置成功与开机恢复成功是两项不同检查。

## 12 / 回退顺序与影响范围

在控制台维护窗口先停止测试客户端新建连接，保留 DNS 与原管理入口。已有 NAT/连接标记不会随规则删除自动消失，应让相关客户端关闭连接并在恢复后重连；不要运行全局 `conntrack -F`。

以下精确移除本例四条 hook；如果启动脚本曾重复插入，先用 `iptables -S` 核对，只删除属于本方案的实例。移除防火墙 hook 后再移除路由规则，避免尚在分类的流量落入错误主表。

```sh
# Gateway: maintenance window with affected client traffic stopped.
sudo iptables -w 5 -t mangle -D PREROUTING -i lan0 -s 10.20.0.0/24 -j DW_CLASS
sudo iptables -w 5 -t nat -D POSTROUTING -j DW_NAT
sudo iptables -w 5 -t filter -D FORWARD -j DW_FORWARD
sudo iptables -w 5 -t filter -D INPUT -j DW_INPUT

sudo ip -4 rule del priority 1001 fwmark 0x1/0xff lookup 101
sudo ip -4 rule del priority 1002 fwmark 0x2/0xff lookup 102
# These tables must still be owned exclusively by this example.
sudo ip -4 route flush table 101
sudo ip -4 route flush table 102
```

恢复 dnsmasq 的旧配置并验证重启，确认没有进程继续引用这三个集合；恢复原防火墙访问规则、sysctl 及已变更的持久化配置，再清理专用链与集合。仅删除本次新建资源；若表、链或集合已被其他业务接管，不执行这些清理命令。

```sh
# Gateway: hooks removed and dnsmasq no longer references these sets.
sudo iptables -w 5 -t mangle -F DW_CLASS
sudo iptables -w 5 -t mangle -X DW_CLASS
sudo iptables -w 5 -t nat -F DW_NAT
sudo iptables -w 5 -t nat -X DW_NAT
sudo iptables -w 5 -t filter -F DW_INPUT
sudo iptables -w 5 -t filter -X DW_INPUT
sudo iptables -w 5 -t filter -F DW_FORWARD
sudo iptables -w 5 -t filter -X DW_FORWARD
sudo ipset destroy dw_wan1
sudo ipset destroy dw_wan2
sudo ipset destroy dw_bypass4
```

确认回到原本预期的 DNS、默认路由和公网源地址后再恢复业务。如果改动期间没有其他并行配置变化，也可按已审核的变更方案使用备份恢复完整规则；不要为了回退本篇配置而覆盖其他人的新规则。不得清空内建链或删除无关路由。

## 参考资料

- [dnsmasq 官方手册：ipset、上游 DNS 与监听配置](https://dnsmasq.org/docs/dnsmasq-man.html)
- [ipset 官方手册：集合、timeout、restore 与 swap](https://ipset.netfilter.org/ipset.man.html)
- [iptables 扩展手册：set、MARK、CONNMARK 与 SNAT](https://man7.org/linux/man-pages/man8/iptables-extensions.8.html)
- [iptables-restore 手册：测试与 noflush 行为](https://man7.org/linux/man-pages/man8/iptables-restore.8.html)
- [ip-rule 手册：策略路由与 fwmark](https://man7.org/linux/man-pages/man8/ip-rule.8.html)
- [ip-route 手册：路由表与 unreachable 路由](https://man7.org/linux/man-pages/man8/ip-route.8.html)
- [Linux 内核：ip_forward、rp_filter 与 src_valid_mark](https://docs.kernel.org/networking/ip-sysctl.html)
- [Netfilter conntrack-tools 官方手册](https://conntrack-tools.netfilter.org/manual.html)
