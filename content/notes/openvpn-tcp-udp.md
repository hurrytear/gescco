---
{"title":"OpenVPN 安装与配置：UDP、TCP 双模式实践","category":"网络与代理","kind":"实践笔记","date":"2026-10-04","summary":"在 Ubuntu 上搭建 OpenVPN，完整配置 UDP 与 TCP 服务端和客户端，处理证书、转发、DNS、全流量出口及证书吊销。","tags":["OpenVPN","UDP","TCP","VPN"]}
---
OpenVPN 的安装不复杂，真正需要串起来的是证书身份、传输协议、隧道路由与客户端解析策略。本文以全新 Ubuntu 24.04 LTS、发行版 OpenVPN 2.6 和 Easy-RSA 3 为例，分别提供 UDP 和 TCP 配置；使用社区版，不依赖 Access Server 管理界面。示例需要在自己的实验环境替换参数并验证，本文没有实际部署 VPN 服务。

## 01 / 先确定 UDP、TCP 与网络规划

通常优先使用 UDP；网络不允许 UDP 时，可以评估 TCP。TCP 隧道承载 TCP 业务时，两层重传与队头阻塞可能在丢包链路上放大延迟。两种传输方式仍需相同的证书与加密校验，不能把 TCP 当作更强的身份认证方案。[传输协议说明](https://build.openvpn.net/man/openvpn-2.6/openvpn.8.html)。

```text
公网 VPN 主机名：vpn.example.com
公网入口：192.0.2.20（保留文档地址，必须替换）
网关内网地址：10.20.0.10
受保护网段：10.20.0.0/24
内网 DNS：10.20.0.53
内网测试服务：app.corp.example.com → 10.20.0.80

UDP 实例：UDP 1194 / tun-udp / 地址池 10.88.0.0/24
TCP 实例：TCP 443  / tun-tcp / 地址池 10.89.0.0/24
```

可以只运行一种方式，也可以运行两个独立实例。双实例必须使用不同隧道接口和地址池，避免路由冲突；地址池也应避开客户端本地网络。网关应已有到内网的可用路由，内网 DNS 应包含测试服务记录。本例默认只把指定内网放入 IPv4 隧道；全流量出口另见后文。

TCP 443 必须没有被同一监听地址上的网站或其他服务占用；否则使用独立地址或改成其他已获准的端口，并同步修改客户端和防火墙。TCP 443 上的 OpenVPN 不是 HTTPS 网站。Cloudflare 中的 VPN A 记录应设为“仅 DNS”，常规网站代理不承载这些连接。[Cloudflare 代理限制](https://developers.cloudflare.com/dns/proxy-status/limitations/)。

## 02 / 安装软件并确认服务模板

在网关上执行。已有 VPN 主机应先备份配置，再决定新实例名称，不能覆盖正在使用的文件。

```sh
sudo apt update
sudo apt install openvpn easy-rsa openssl iptables
openvpn --version
test -c /dev/net/tun
systemctl cat openvpn-server@.service
sudo ss -lntup
```

确认实际版本为本例适用的 2.6 系列，并安装发行版安全更新。`/dev/net/tun` 不可用时，先检查宿主机或容器的 TUN 与网络管理权限。

本文采用 `/etc/openvpn/server/udp.conf` 对应 `openvpn-server@udp`，`tcp.conf` 对应 `openvpn-server@tcp`。不要与旧教程中 `/etc/openvpn/*.conf` 对应的 `openvpn@名称` 混用。以本机服务模板中的工作目录和启动参数为准。[服务模板源码](https://github.com/OpenVPN/openvpn/blob/release/2.6/distro/systemd/openvpn-server%40.service.in)。

## 03 / 分开创建 CA、网关与客户端私钥

在受控的 CA 工作站安装 Easy-RSA，再创建全新的签发目录。CA 使用加密私钥，交互输入高强度口令，并为 CA 设置可识别名称。不要对已有 PKI 重复运行 `init-pki`。

```sh
umask 077
make-cadir ~/openvpn-ca
cd ~/openvpn-ca
export EASYRSA_KEY_SIZE=3072
./easyrsa init-pki
./easyrsa build-ca
```

CA 工作站保存 CA 私钥、签发数据库与备份，不把它们复制到公网网关。然后在网关的普通管理员账户下生成自己的私钥与请求，CN 保持为 `vpn-server`：

```sh
umask 077
make-cadir ~/openvpn-server-pki
cd ~/openvpn-server-pki
export EASYRSA_KEY_SIZE=3072
./easyrsa init-pki
./easyrsa gen-req vpn-server nopass
```

网关私钥不设交互口令，便于服务自动启动，后续由文件权限保护。在 Linux 客户端本机或受控的客户端配置工作站安装 Easy-RSA，生成独立客户端私钥；不使用 `nopass`，客户端连接时输入私钥口令，CN 保持为 `client-01`。

```sh
umask 077
make-cadir ~/openvpn-client-pki
cd ~/openvpn-client-pki
export EASYRSA_KEY_SIZE=3072
./easyrsa init-pki
./easyrsa gen-req client-01
```

为每台设备生成不同名称和证书。只把两个 `pki/reqs/*.req` 请求传给 CA；服务端与客户端私钥留在各自所在机器。若由配置工作站代为生成客户端材料，应通过安全渠道交付指定设备。[Easy-RSA 工作流程](https://easy-rsa.readthedocs.io/en/latest/)。

## 04 / 签发证书并安装网关材料

在 CA 工作站，将收到的请求存放到 `~/vpn-requests/`，检查来源与请求身份后执行。签发时确认提示，服务端使用 server 类型，客户端使用 client 类型。

```sh
cd ~/openvpn-ca
./easyrsa import-req ~/vpn-requests/vpn-server.req vpn-server
./easyrsa sign-req server vpn-server
./easyrsa import-req ~/vpn-requests/client-01.req client-01
./easyrsa sign-req client client-01
./easyrsa gen-crl
openssl verify -CAfile pki/ca.crt -purpose sslserver pki/issued/vpn-server.crt
openssl verify -CAfile pki/ca.crt -purpose sslclient pki/issued/client-01.crt
```

将 `pki/ca.crt`、`pki/issued/vpn-server.crt`、`pki/crl.pem` 传回网关。进入这三个公共文件的接收目录，再执行安装；私钥路径来自网关自己的 PKI 目录。

```sh
sudo install -d -m 755 /etc/openvpn/server /etc/openvpn/pki
sudo install -m 644 ca.crt /etc/openvpn/pki/ca.crt
sudo install -m 644 vpn-server.crt /etc/openvpn/pki/vpn-server.crt
sudo install -m 644 crl.pem /etc/openvpn/pki/crl.pem
sudo install -m 600 ~/openvpn-server-pki/pki/private/vpn-server.key \
  /etc/openvpn/pki/vpn-server.key
sudo openvpn --genkey tls-crypt /etc/openvpn/pki/tls-crypt.key
sudo chmod 600 /etc/openvpn/pki/tls-crypt.key
sudo -u nobody test -r /etc/openvpn/pki/crl.pem
```

最后一项检查必须成功：进程降权后仍需读取 CRL。公共证书目录可遍历，私钥与 tls-crypt 文件只允许管理员读取。不要把服务配置直接指向管理员家目录，服务模板可能限制访问该目录。

通过可信渠道给客户端交付 `ca.crt`、`client-01.crt` 和网关生成的 `tls-crypt.key`，核对 CA 指纹；客户端继续使用自己生成的 `client-01.key`。tls-crypt 是本例共享的控制通道密钥，不能替代每台设备的客户端证书，也不需要 `key-direction`。[TLS 与身份校验参数](https://github.com/OpenVPN/openvpn/blob/release/2.6/doc/man-sections/tls-options.rst)。

## 05 / 配置 UDP 服务端

保存以下完整配置到 `/etc/openvpn/server/udp.conf`，文件权限设为 600：

```conf
port 1194
proto udp4
dev tun-udp
dev-type tun
topology subnet
server 10.88.0.0 255.255.255.0

ca /etc/openvpn/pki/ca.crt
cert /etc/openvpn/pki/vpn-server.crt
key /etc/openvpn/pki/vpn-server.key
crl-verify /etc/openvpn/pki/crl.pem
dh none
remote-cert-tls client
verify-client-cert require
tls-crypt /etc/openvpn/pki/tls-crypt.key
tls-version-min 1.2
data-ciphers AES-256-GCM:AES-128-GCM
allow-compression no
disable-dco

push "route 10.20.0.0 255.255.255.0"
push "dhcp-option DNS 10.20.0.53"
keepalive 10 120
persist-key
persist-tun
user nobody
group nogroup
verb 3
```

本例使用常规 TUN 数据路径，显式关闭 DCO 卸载，先建立便于排查的基础配置；性能优化时再单独验证 DCO。数据通道仅协商列出的 AES-GCM 算法，关闭压缩；`dh none` 使用 ECDH，避免套用旧教程的静态共享密钥模式或 BF-CBC。默认不增加用户名密码认证。

## 06 / 配置 TCP 服务端

保存以下完整配置到 `/etc/openvpn/server/tcp.conf`，文件权限同样设为 600。可以复用同一网关证书与 CA，但实例名称、接口和地址池独立。

```conf
port 443
proto tcp4-server
dev tun-tcp
dev-type tun
topology subnet
server 10.89.0.0 255.255.255.0

ca /etc/openvpn/pki/ca.crt
cert /etc/openvpn/pki/vpn-server.crt
key /etc/openvpn/pki/vpn-server.key
crl-verify /etc/openvpn/pki/crl.pem
dh none
remote-cert-tls client
verify-client-cert require
tls-crypt /etc/openvpn/pki/tls-crypt.key
tls-version-min 1.2
data-ciphers AES-256-GCM:AES-128-GCM
allow-compression no
disable-dco

push "route 10.20.0.0 255.255.255.0"
push "dhcp-option DNS 10.20.0.53"
keepalive 10 120
persist-key
persist-tun
user nobody
group nogroup
verb 3
```

服务端必须使用 `tcp4-server`，客户端使用 `tcp4-client`。不要只改端口、不改协议，也不要把 UDP 的专用选项机械复制到 TCP 配置。两种方式均需客户端能够使用上述算法与证书格式；旧版本客户端应先升级再测试兼容性。[官方服务端示例](https://github.com/OpenVPN/openvpn/blob/release/2.6/sample/sample-config-files/server.conf)。

## 07 / 开启转发、放行流量并补回程

在网关保存 `/etc/sysctl.d/91-openvpn-forward.conf`，再加载：

```conf
net.ipv4.ip_forward = 1
```

```sh
sudo sysctl -p /etc/sysctl.d/91-openvpn-forward.conf
ip route get 10.20.0.53
ip route get 10.20.0.80
```

云安全组允许 UDP 1194 和 TCP 443，网关也要放行对应协议。以下适用于 iptables 管理的实验网关，会立即修改规则；使用 UFW、firewalld 或原生 nftables 时，通过当前管理工具实现同样规则，不混用。`ens3` 替换为公网入口接口，只运行一种实例时只添加该实例的规则，并保留管理连接。

```sh
sudo iptables-save | sudo tee /root/iptables.before-openvpn.rules > /dev/null
sudo iptables -I INPUT 1 -i ens3 -p udp --dport 1194 -j ACCEPT
sudo iptables -I INPUT 1 -i ens3 -p tcp --dport 443 -j ACCEPT
sudo iptables -I FORWARD 1 -i tun-udp -s 10.88.0.0/24 -d 10.20.0.0/24 -j ACCEPT
sudo iptables -I FORWARD 1 -o tun-udp -s 10.20.0.0/24 -d 10.88.0.0/24 \
  -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
sudo iptables -I FORWARD 1 -i tun-tcp -s 10.89.0.0/24 -d 10.20.0.0/24 -j ACCEPT
sudo iptables -I FORWARD 1 -o tun-tcp -s 10.20.0.0/24 -d 10.89.0.0/24 \
  -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
```

这些是允许规则，不会自动建立完整的默认拒绝策略。正式环境应按账号授权限定目标和端口，检查规则顺序；仅下发路由不构成访问控制。

内网服务使用的路由器需有回程路由。以下只在对应 Linux 内网路由器执行，下一跳为 VPN 网关内网地址；只运行一种实例时仅添加对应地址池。

```sh
sudo ip route add 10.88.0.0/24 via 10.20.0.10
sudo ip route add 10.89.0.0/24 via 10.20.0.10
```

通过现有网络与防火墙管理工具持久化，检查云平台的转发限制与路由表。分流内网访问优先使用回程路由，避免不必要的 NAT 隐藏客户端地址。[Ubuntu 安装与转发说明](https://ubuntu.com/server/docs/how-to/security/install-openvpn/)。

## 08 / 分别启动两个实例并配置客户端

仅启动自己需要的实例；下面演示同时运行两种方式：

```sh
sudo chmod 600 /etc/openvpn/server/udp.conf /etc/openvpn/server/tcp.conf
sudo systemctl enable --now openvpn-server@udp openvpn-server@tcp
sudo systemctl status openvpn-server@udp openvpn-server@tcp --no-pager
sudo journalctl -u openvpn-server@udp -u openvpn-server@tcp \
  --since '-10 minutes' --no-pager
sudo ss -lunp 'sport = :1194'
sudo ss -ltnp 'sport = :443'
ip -br address show tun-udp
ip -br address show tun-tcp
```

UDP 客户端保存为 `client-udp.ovpn`。以下面向 OpenVPN 2.6 社区客户端，证书和密钥放在配置所在目录：

```conf
client
dev tun
proto udp4
remote vpn.example.com 1194
resolv-retry infinite
nobind
persist-key
persist-tun
ca ca.crt
cert client-01.crt
key client-01.key
remote-cert-tls server
verify-x509-name vpn-server name
tls-crypt tls-crypt.key
tls-version-min 1.2
data-ciphers AES-256-GCM:AES-128-GCM
allow-compression no
verb 3
```

TCP 客户端保存为 `client-tcp.ovpn`：

```conf
client
dev tun
proto tcp4-client
remote vpn.example.com 443
resolv-retry infinite
nobind
persist-key
persist-tun
ca ca.crt
cert client-01.crt
key client-01.key
remote-cert-tls server
verify-x509-name vpn-server name
tls-crypt tls-crypt.key
tls-version-min 1.2
data-ciphers AES-256-GCM:AES-128-GCM
allow-compression no
verb 3
```

`verify-x509-name` 在此精确校验服务端证书 CN `vpn-server`，它与连接用的 DNS 名不是同一个字段；生成请求时若更改 CN，也必须同步修改客户端。`remote-cert-tls server` 校验证书的服务端用途，不能删除这两个校验来绕过证书错误。

在 Linux 客户端进入上述文件所在目录，执行其中一种连接，输入客户端私钥口令：

```sh
sudo openvpn --config ./client-udp.ovpn
```

测试 TCP 时先断开 UDP，再使用：

```sh
sudo openvpn --config ./client-tcp.ovpn
```

同一台设备不要同时连接这两份配置，以免两条相同目标路由互相影响。Windows 社区 GUI 使用同样配置和对应文件；其他导入型客户端若要求单文件，可将 CA、客户端证书、客户端私钥和 tls-crypt 材料按 `<ca>`、`<cert>`、`<key>`、`<tls-crypt>` 内联格式嵌入。内联配置包含凭证，应按私钥管理，不放入 GitHub、网页或工单。

## 09 / 验证并配置客户端 DNS

服务端 push DNS 不等于每个平台都已应用。Windows 社区客户端可以处理相关设置；Linux 直接运行 OpenVPN 时通常需要 DNS 集成脚本或网络管理工具，不能只看日志中的 PUSH_REPLY。

对使用 systemd-resolved、系统解析实际接入该服务的 Linux 测试客户端，可临时配置分流 DNS。以下 `tun0` 必须替换为该客户端实际创建的接口；不要写服务端的接口名。

```sh
ip -br address
sudo resolvectl dns tun0 10.20.0.53
sudo resolvectl domain tun0 '~corp.example.com'
sudo resolvectl default-route tun0 no
resolvectl status tun0
resolvectl query app.corp.example.com
```

这只把指定域名的系统解析交给内网 DNS；其他域名继续使用已有策略。属于当前接口的临时设置，接口重建后需重新应用；正式部署应使用受控的客户端连接与断开集成。手动撤销可执行 `sudo resolvectl revert tun0`；接口消失时相关设置也会清除。[resolvectl 手册](https://manpages.ubuntu.com/manpages/noble/man1/resolvectl.1.html)。

## 10 / 可选：把 VPN 作为全流量出口

如果用途是通过网关访问互联网，需要另外规划出口转发和 NAT。在需要提供此功能的服务端配置中加入：

```conf
push "redirect-gateway def1"
```

下面以 UDP 实例、公网出口 `ens3` 为例。只有确认网关允许提供互联网出口时才添加；不要把仅供分流内网访问的网关直接改成全流量出口。

```sh
sudo iptables -I FORWARD 1 -i tun-udp -o ens3 -s 10.88.0.0/24 -j ACCEPT
sudo iptables -I FORWARD 1 -i ens3 -o tun-udp -d 10.88.0.0/24 \
  -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
sudo iptables -t nat -I POSTROUTING 1 -s 10.88.0.0/24 ! -d 10.20.0.0/24 \
  -o ens3 -j MASQUERADE
```

TCP 实例需要分别对 `tun-tcp` 与 `10.89.0.0/24` 建立相应规则；只修改 push 指令不足以完成出口配置。上面排除了内网目标的 NAT，内网仍依赖回程路由。全流量模式下 DNS 也需具备外部解析能力并配置到客户端；上一节仅为内网域名提供分流 DNS，不会自动接管所有 DNS 查询。

本例仅覆盖 IPv4。`redirect-gateway def1` 不会自动把 IPv6 放入隧道，不能因此宣称所有流量均受 VPN 保护；需要另行设计并验收 IPv6 或客户端的对应限制策略。

## 11 / 用实际业务分别验收 UDP 与 TCP

逐一连接两份客户端配置，记录连接时间、服务端实例、分配地址、协商算法与测试结果。日志中的 `Initialization Sequence Completed` 只代表 OpenVPN 初始化完成，还需从实际客户端验证路由、DNS 与业务。

```sh
ip route get 10.20.0.80
dig @10.20.0.53 app.corp.example.com A
getent ahostsv4 app.corp.example.com
curl --connect-timeout 5 --max-time 15 https://app.corp.example.com/health
```

以上 Linux 验收命令需要相应工具，目标 HTTPS 服务须有客户端信任的证书。指定解析器查询成功，只证明 DNS 可达；系统解析及应用访问成功，才能证明客户端策略完整生效。还应测试禁止的目标端口、断开后的路由清理，以及服务器重启后的重连。全流量模式另需检查客户端实际出口与 IPv6 行为。

排障时沿以下顺序推进：

- 无法连接：核对 A 记录、实际监听进程、安全组和协议。TCP 端口可达不能证明 UDP 可达，也不能证明证书认证已通过。
- TLS 握手失败：查证书用途、CA、CN 校验、到期时间和两端 tls-crypt 密钥，核对主机时钟。
- 无共同算法：比较 `data-ciphers` 与客户端版本；升级或明确兼容策略，不直接恢复旧压缩与弱算法。
- 已连接却访问不了内网：检查地址池冲突、客户端路由、FORWARD 计数、回程路由和内网服务防火墙。
- IP 正常、域名失败：区分指定 DNS 查询、系统解析和应用自己的 DNS 策略；检查 DNS 集成是否随重连生效。
- TCP 明显卡顿或大传输停滞：同时检查链路丢包、TCP 嵌套重传、MTU 与 PMTUD；在允许 UDP 的网络对照测试，避免盲目调整所有缓冲区。

## 12 / 证书吊销、更新与回退

设备丢失或客户端私钥泄露时，在 CA 工作站吊销对应证书并重新生成 CRL：

```sh
cd ~/openvpn-ca
./easyrsa revoke client-01
./easyrsa gen-crl
openssl crl -in pki/crl.pem -noout -issuer -lastupdate -nextupdate
```

将新 CRL 传到网关，在接收目录检查有效期，再通过临时文件替换，避免更新时读到截断内容：

```sh
openssl crl -in crl.pem -noout -issuer -lastupdate -nextupdate
sudo install -m 644 crl.pem /etc/openvpn/pki/crl.pem.new
sudo mv /etc/openvpn/pki/crl.pem.new /etc/openvpn/pki/crl.pem
sudo -u nobody test -r /etc/openvpn/pki/crl.pem
```

OpenVPN 会在证书验证时读取 CRL；发布 CRL 不等于现有连接立刻断开。需要立即终止连接时，应通过已受控配置的管理接口终止对应会话，或停止、重启相关实例；后者会影响该实例所有用户。本例没有启用管理接口。

检查吊销设备无法重新连接，同时有效设备仍能连接。CRL 缺失、过期或不可读必须处理，不能只看配置中存在 `crl-verify`。为证书与 CRL 到期安排更新，备份签发数据库、服务配置和防火墙回退依据。更新服务配置后仅重启需要变更的实例，并复测两种连接方式。

## 参考资料

- [OpenVPN 2.6 参数手册](https://build.openvpn.net/man/openvpn-2.6/openvpn.8.html)
- [OpenVPN：TLS 与证书参数](https://github.com/OpenVPN/openvpn/blob/release/2.6/doc/man-sections/tls-options.rst)
- [OpenVPN：官方服务端配置示例](https://github.com/OpenVPN/openvpn/blob/release/2.6/sample/sample-config-files/server.conf)
- [OpenVPN：systemd 服务模板](https://github.com/OpenVPN/openvpn/blob/release/2.6/distro/systemd/openvpn-server%40.service.in)
- [OpenVPN：社区版搭建指南](https://openvpn.net/community-docs/how-to.html)
- [Easy-RSA：密钥、请求、签发与吊销](https://easy-rsa.readthedocs.io/en/latest/)
- [Easy-RSA 3.1.7：配置变量](https://raw.githubusercontent.com/OpenVPN/easy-rsa/v3.1.7/easyrsa3/vars.example)
- [Ubuntu：OpenVPN 安装与转发](https://ubuntu.com/server/docs/how-to/security/install-openvpn/)
- [Ubuntu 24.04：Easy-RSA 软件包](https://packages.ubuntu.com/noble/easy-rsa)
- [Ubuntu：resolvectl 手册](https://manpages.ubuntu.com/manpages/noble/man1/resolvectl.1.html)
- [Cloudflare：DNS 代理限制](https://developers.cloudflare.com/dns/proxy-status/limitations/)
