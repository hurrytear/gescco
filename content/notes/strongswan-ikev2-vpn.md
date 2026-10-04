---
{"title":"strongSwan 搭建 IKEv2 VPN：从证书到路由与 DNS 验收","category":"网络与代理","kind":"实践笔记","date":"2026-10-04","summary":"用 swanctl 搭建支持账号认证的远程接入 VPN，串起证书、地址池、防火墙、分流路由和 DNS，并整理旧版维护中的常见误区。","tags":["strongSwan","IKEv2","VPN","DNS"]}
---
历史维护记录中，VPN 故障经常出现在两个边界：服务已经启动，客户端却没有可用隧道；账号已经认证，目标网段却没有进入客户端路由。本文将这些经验整理为一套可复现的搭建与验收流程，所有域名、账号和地址均为示例，不包含原环境配置或日志。

## 01 / 明确拓扑与适用范围

以下面向全新 Ubuntu 24.04 LTS 主机，采用 IKEv2、服务端证书和 EAP-MSCHAPv2 账号认证，配置入口为 swanctl。使用发行版安全更新，不将历史环境的源码升级步骤直接套到新服务器上。命令需要按所在机器执行，并替换示例值。

```text
客户端 → vpn.example.com → VPN 网关 → 受保护网段
公网入口：192.0.2.10（文档地址，必须替换）
网关内网地址：10.20.0.10
受保护网段：10.20.0.0/24
内网 DNS：10.20.0.53
客户端地址池：10.77.0.0/24
内网测试服务：app.corp.example.com → 10.20.0.80
```

网关必须先能访问受保护网段与 DNS。地址池应避开服务器网络和客户端常见本地网段。这是一套 IPv4 分流方案：仅指定内网进入隧道，其他网络流量仍走客户端原出口；它不提供全流量或 IPv6 隧道保护。

在 Cloudflare 管理域名时，VPN 主机名应使用“仅 DNS”的 A 记录。常规网站代理不承载这里的 IKE/IPsec 流量。不要给该主机名添加不可用的 AAAA 记录。[代理范围说明](https://developers.cloudflare.com/dns/proxy-status/limitations/)。

## 02 / 安装并确认实际运行入口

在新服务器安装下面的软件包。不要同时启用另一套占用相同端口的 starter/charon 服务；已有 VPN 主机应先盘点和备份，再决定迁移方式。

```sh
sudo apt update
sudo apt install charon-systemd strongswan-swanctl strongswan-pki \
  libcharon-extra-plugins libcharon-extauth-plugins \
  libstrongswan-standard-plugins
systemctl cat strongswan
systemctl show strongswan -p ExecStart -p FragmentPath -p DropInPaths
dpkg-query -W charon-systemd strongswan-swanctl
```

charon-systemd 的服务名是 `strongswan`，通过 VICI 接受 swanctl 配置。安装了哪个版本与服务实际启动了哪个程序，必须分别核对。发行版版本号可能落后于上游主版本，但安全修复可能由发行版回补。[服务入口说明](https://docs.strongswan.org/docs/latest/daemons/charon-systemd.html)。

EAP-MSCHAPv2 需要 `eap-identity`、`eap-mschapv2` 及提供 MD4/DES 的加密插件；这里显式安装包含 OpenSSL 插件的标准插件包。不要把 MD4 当成 IKE/ESP 的推荐完整性算法，它在此用于账号认证内部计算。[插件依赖说明](https://docs.strongswan.org/docs/6.0/interop/windowsClients.html)。

## 03 / 签发服务端证书

在离线或受控的签发工作站上安装 `strongswan-pki`，然后执行以下示例。网关名同时写入 CN 和 SAN，证书具备 serverAuth 用途；客户端远端标识也必须匹配这个名字。[证书要求](https://docs.strongswan.org/docs/6.0/interop/windowsCertRequirements.html)。

```sh
umask 077
mkdir -p vpn-pki
cd vpn-pki
pki --gen --type rsa --size 4096 --outform pem > ca-key.pem
pki --self --ca --lifetime 3652 --in ca-key.pem --type rsa \
  --dn "CN=Example VPN Root CA" --outform pem > ca-cert.pem
pki --gen --type rsa --size 3072 --outform pem > server-key.pem
pki --req --type priv --in server-key.pem \
  --dn "CN=vpn.example.com" --san vpn.example.com \
  --outform pem > server-request.pem
pki --issue --type pkcs10 --in server-request.pem \
  --cacert ca-cert.pem --cakey ca-key.pem --lifetime 365 \
  --flag serverAuth --outform pem > server-cert.pem
pki --print --in server-cert.pem
```

只将 `ca-cert.pem`、`server-cert.pem`、`server-key.pem` 安全传到网关；CA 私钥留在签发工作站。在网关上，进入这三个文件所在的临时目录，再安装到以下位置；不要把私钥放进仓库或网页目录。

```sh
sudo install -d -m 700 /etc/swanctl/private
sudo install -d -m 755 /etc/swanctl/x509 /etc/swanctl/x509ca
sudo install -m 600 server-key.pem /etc/swanctl/private/server-key.pem
sudo install -m 644 server-cert.pem /etc/swanctl/x509/server-cert.pem
sudo install -m 644 ca-cert.pem /etc/swanctl/x509ca/ca-cert.pem
```

通过可信渠道给客户端分发 CA 公共证书，并核对指纹。本文使用自建 CA，客户端只需要 CA 证书和账号密码，不需要服务端私钥。记录到期日和续签责任人。[PKI 操作说明](https://docs.strongswan.org/docs/latest/pki/pkiQuickstart.html)。

## 04 / 配置连接、地址池和独立账号

在新网关上编辑 `/etc/swanctl/swanctl.conf`。旧网关不要直接覆盖已有连接。

```conf
connections {
  remote-access {
    version = 2
    local_addrs = %any
    pools = vpn-pool
    send_cert = always
    encap = yes
    fragmentation = yes
    dpd_delay = 30s
    local {
      auth = pubkey
      id = vpn.example.com
      certs = server-cert.pem
    }
    remote {
      auth = eap-mschapv2
      eap_id = %any
    }
    children {
      private-net {
        local_ts = 10.20.0.0/24
        remote_ts = dynamic
        dpd_action = clear
      }
    }
  }
}
pools {
  vpn-pool {
    addrs = 10.77.0.0/24
    dns = 10.20.0.53
  }
}
include conf.d/vpn-secrets.conf
```

`local_ts` 是服务端允许进入隧道的目标网段；`remote_ts = dynamic` 对应协商的客户端虚拟地址。`encap = yes` 强制 ESP 使用 UDP 封装，后续按 UDP 500/4500 放行。默认算法提案用于先完成兼容性验证，正式使用时应按客户端能力统一加密策略并检查实际协商结果。[配置参数说明](https://docs.strongswan.org/docs/latest/swanctl/swanctlConf.html)。

先创建账号文件目录：

```sh
sudo install -d -m 700 /etc/swanctl/conf.d
```

新建 `/etc/swanctl/conf.d/vpn-secrets.conf`，将占位密码换成每人独立、随机生成的高强度密码，然后限制权限。不要使用下面的字面值，也不要多个用户共用账号。

```conf
secrets {
  eap-demo {
    id = vpn-demo
    secret = "REPLACE_WITH_A_UNIQUE_RANDOM_PASSWORD"
  }
}
```

```sh
sudo chmod 600 /etc/swanctl/conf.d/vpn-secrets.conf
sudo chmod 600 /etc/swanctl/swanctl.conf
```

EAP-MSCHAPv2 方案依赖正确验证服务端证书；需要集中账户管理或用户证书时，可另外规划 RADIUS 或 EAP-TLS，不能只改一行认证名称便视为迁移完成。

## 05 / 开启转发并建立回程路由

在网关保存 `/etc/sysctl.d/90-vpn-forward.conf`：

```conf
net.ipv4.ip_forward = 1
```

```sh
sudo sysctl -p /etc/sysctl.d/90-vpn-forward.conf
ip route get 10.20.0.53
ip route get 10.20.0.80
```

目标网段的路由器还必须知道怎样返回客户端地址池。以下只适用于 Linux 内网路由器，下一跳是 VPN 网关内网地址；不要在客户端或公网路由器上盲目执行。

```sh
sudo ip route add 10.77.0.0/24 via 10.20.0.10
```

通过该路由器实际使用的网络管理工具持久化回程路由。云主机还需核对平台对转发主机的限制与路由表设置。优先保留客户端源地址；没有回程路由时再评估限定范围的 SNAT，其代价是内网服务看不到原始客户端 IP。[转发与回程说明](https://docs.strongswan.org/docs/latest/howtos/forwarding.html)。

## 06 / 放行 VPN 与受保护流量

云安全组或上游防火墙允许 UDP 500、4500。网关 INPUT 允许握手，FORWARD 允许解密后的内网访问；只开放握手端口不足以让业务流量通过。

下列命令适用于由 iptables 管理防火墙的实验网关，会立即修改规则。先保存现有规则并保留管理连接；如果使用 UFW、firewalld 或原生 nftables，应在对应管理工具中表达同样策略，避免混用。将 `ens3` 替换为接收 VPN 报文的接口。示例允许账号访问整个受保护网段，实际环境应按账号权限收紧目标和端口。

```sh
sudo iptables-save | sudo tee /root/iptables.before-vpn.rules > /dev/null
sudo iptables -I INPUT 1 -i ens3 -p udp -m multiport \
  --dports 500,4500 -j ACCEPT
sudo iptables -I FORWARD 1 -s 10.77.0.0/24 -d 10.20.0.0/24 \
  -m policy --dir in --pol ipsec -j ACCEPT
sudo iptables -I FORWARD 1 -s 10.20.0.0/24 -d 10.77.0.0/24 \
  -m policy --dir out --pol ipsec \
  -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
```

`policy` 匹配保证放行的是对应 IPsec 流量，而不只是声称来自地址池的普通报文。确认既有 NAT 规则不会改写需要进入 IPsec 的回程流量；如有通用 MASQUERADE，应在其前面加入针对出站 IPsec 的豁免。验证完成后，用当前防火墙管理方式持久化；重启后再次验收。[policy 匹配手册](https://man7.org/linux/man-pages/man8/iptables-extensions.8.html)。

如果该网关确有通用 NAT 规则，可为本示例的加密回程增加以下豁免；没有 NAT 时无需添加：

```sh
sudo iptables -t nat -I POSTROUTING 1 -s 10.20.0.0/24 -d 10.77.0.0/24 \
  -m policy --dir out --pol ipsec -j ACCEPT
```

## 07 / 处理分流 DNS 与旧属性差异

地址池中的 `dns` 下发解析器地址，但操作系统是否采用它还取决于客户端策略。对于支持 IKEv2 分流 DNS 属性的客户端，可在 `/etc/strongswan.conf` 已有 `charon` 配置中合并以下片段；保留原来的插件与 include 配置，不要整文件替换。

```conf
charon {
  plugins {
    attr {
      25 = corp.example.com
    }
  }
}
```

25 对应 `INTERNAL_DNS_DOMAIN`。iOS/macOS 的分流 DNS 还需符合其配置规则；不支持该属性的客户端应通过受控配置文件或系统 DNS 策略配置域名路由，不能假设发送属性就等于生效。[客户端 DNS 说明](https://docs.strongswan.org/docs/latest/interop/ios.html)。

历史配置中的 Unity 28675 是 IKEv1 的 split-DNS 属性，不能照搬成 IKEv2 的域名路由；`ipsec.conf` 的 `rightdns` 也不应写进 swanctl 连接配置。先确认协议、配置入口及客户端支持范围，再选择对应配置。[属性插件说明](https://docs.strongswan.org/docs/latest/plugins/attr.html)。

## 08 / 启动并核对加载结果

完成证书、账号、转发与防火墙设置后执行：

```sh
sudo systemctl enable --now strongswan
sudo swanctl --reload-settings
sudo swanctl --load-all
sudo swanctl --stats
sudo swanctl --list-conns
sudo swanctl --list-certs
sudo swanctl --list-pools
sudo ss -lunp 'sport = :500 or sport = :4500'
sudo journalctl -u strongswan --since '-10 minutes' --no-pager
```

`--load-all` 会将配置与凭证载入正在运行的服务，属于实际变更，不是离线语法检查。检查每项加载结果及日志，确认连接、地址池、证书和所需插件齐全。没有客户端连接时，SA 数量为零是正常现象；它不能证明登录与访问已通过。

后续修改连接或账号时重新加载；更改 DNS 后让测试客户端断开并重连。需要重启服务的升级或插件变更应安排维护窗口，重启会中断现有连接。新增属性的运行时加载能力参考 [reload-settings 说明](https://docs.strongswan.org/docs/latest/swanctl/swanctlReloadSettings.html)。

## 09 / 配置客户端并验收实际链路

客户端创建 IKEv2 连接：服务器及远端标识为 `vpn.example.com`，认证选择用户名与密码，用户为 `vpn-demo`。安装可信 CA，保持服务端名称与证书校验开启；Windows 的 EAP 设置选择 EAP-MSCHAPv2 并限定可信 CA 与服务器名称。不要分发 CA 私钥或服务端私钥。

Windows 已创建名为 `GesccoLab` 的当前用户连接后，可明确开启分流并添加目标路由。全用户连接需要使用对应参数和权限。以下命令会修改该连接：

```powershell
Set-VpnConnection -Name "GesccoLab" -SplitTunneling $true
Add-VpnConnectionRoute -ConnectionName "GesccoLab" -DestinationPrefix "10.20.0.0/24"
```

客户端路由需要实际检查，不能只依据服务端的 `local_ts`。其他客户端使用各自支持的受控配置方式。[分流设置](https://learn.microsoft.com/en-us/powershell/module/vpnclient/set-vpnconnection?view=windowsserver2025-ps)、[连接路由](https://learn.microsoft.com/en-us/powershell/module/vpnclient/add-vpnconnectionroute?view=windowsserver2025-ps)。

测试客户端连接后，服务器检查：

```sh
sudo swanctl --list-sas
sudo ip -s xfrm policy
```

应能看到建立的 IKE_SA、已安装的 CHILD_SA、池内地址以及正确的两端流量选择器，并在业务访问时看到计数增加。在实际客户端测试受保护服务与解析器；以下为 Linux 示例，需要 curl、dig 和系统解析工具：

```sh
ip route get 10.20.0.80
dig @10.20.0.53 app.corp.example.com A
getent ahostsv4 app.corp.example.com
curl --connect-timeout 5 --max-time 15 https://app.corp.example.com/health
```

直接向 DNS 查询成功，只证明 DNS 可达且有记录；系统解析结果正确、应用能连接，才能证明客户端真正使用了所需策略。测试服务应有客户端信任的 HTTPS 证书。还应分别验证允许与禁止的目标端口、隧道断开后的路由清理，以及一次重启后的重连。验收记录写明客户端版本、实际算法、地址池、网段和结果。

## 10 / 排障与迁移时按证据推进

- 只有握手重传：先查公网 DNS、UDP 500/4500、上游安全组和实际监听进程。TCP 探测不能证明 IKE UDP 端口可用。
- `NO_PROPOSAL_CHOSEN`：比较两端实际算法和加载插件。统一客户端策略后再调整提案，不要盲目降低强度。
- 认证失败：分别核对证书 SAN、有效期、信任链、EAP 方法和账号身份；Windows 带域前缀的用户名可能与配置不一致。
- 登录成功但内网不可达：比较实际 CHILD_SA 选择器、客户端路由、目标端口规则和回程路由。接入 RADIUS 时还要核对返回组属性与匹配的连接；使用 Class 分组需确认 `class_group` 等配置，认证成功不代表授权网段正确。
- IP 能访问但域名失败：先测试指定解析器，再检查客户端 DNS 域名策略；重新连接后复测，避免沿用旧租约或缓存判断。
- 小包正常、HTTPS 或大传输卡住：调查 MTU、PMTUD 和被过滤的 ICMP，再决定是否需要有针对性的 MSS 调整。

历史版本维护中，独立安装目录与 systemd 覆盖可能导致“软件包显示旧版本、服务运行新版本”。迁移前保存配置、证书、权限、实际启动命令、插件列表和防火墙；一次只调整一个边界，并保留可回退的安装与启动配置。`ipsec.conf/stroke` 与 `swanctl.conf/VICI` 是不同配置入口，不能只复制字段名。源码构建遗留的 `load_modular` 设置也不能作为所有环境的默认值。

本文是依据历史经验与官方资料整理的通用方案，未在原生产 VPN 上执行这些示例，也不将过去仅完成服务端检查的记录描述为客户端验收成功。实际交付以目标环境的完整链路测试为准。

## 参考资料

- [Cloudflare：DNS 代理限制](https://developers.cloudflare.com/dns/proxy-status/limitations/)
- [strongSwan：charon-systemd](https://docs.strongswan.org/docs/latest/daemons/charon-systemd.html)
- [Ubuntu 24.04：charon-systemd 软件包](https://packages.ubuntu.com/noble-updates/net/charon-systemd)
- [Ubuntu：EAP-MSCHAPv2 插件文件](https://packages.ubuntu.com/noble-updates/amd64/libcharon-extauth-plugins/filelist)
- [Ubuntu：标准加密插件文件](https://packages.ubuntu.com/noble/armhf/libstrongswan-standard-plugins/filelist)
- [strongSwan：Windows 客户端与 EAP 依赖](https://docs.strongswan.org/docs/6.0/interop/windowsClients.html)
- [strongSwan：Windows 证书要求](https://docs.strongswan.org/docs/6.0/interop/windowsCertRequirements.html)
- [strongSwan：证书快速入门](https://docs.strongswan.org/docs/latest/pki/pkiQuickstart.html)
- [strongSwan：swanctl.conf 参数](https://docs.strongswan.org/docs/latest/swanctl/swanctlConf.html)
- [strongSwan：转发、NAT 与 MTU](https://docs.strongswan.org/docs/latest/howtos/forwarding.html)
- [Linux：iptables 扩展手册](https://man7.org/linux/man-pages/man8/iptables-extensions.8.html)
- [strongSwan：iOS/macOS 与分流 DNS](https://docs.strongswan.org/docs/latest/interop/ios.html)
- [strongSwan：attr 属性插件](https://docs.strongswan.org/docs/latest/plugins/attr.html)
- [strongSwan：运行时重载设置](https://docs.strongswan.org/docs/latest/swanctl/swanctlReloadSettings.html)
- [strongSwan：RADIUS 属性与分组](https://docs.strongswan.org/docs/latest/plugins/eap-radius.html)
- [Microsoft：修改 VPN 连接](https://learn.microsoft.com/en-us/powershell/module/vpnclient/set-vpnconnection?view=windowsserver2025-ps)
- [Microsoft：添加 VPN 连接路由](https://learn.microsoft.com/en-us/powershell/module/vpnclient/add-vpnconnectionroute?view=windowsserver2025-ps)
