---
{"title":"dnsmasq DNS 代理：过滤与不过滤 IPv6 的区别","category":"网络与代理","kind":"实践笔记","date":"2026-10-26","summary":"区分 DNS 转发、AAAA 记录过滤与 IPv6 路由，用可复现的查询对比 dnsmasq filter-AAAA 的效果、适用场景和回退。","tags":["dnsmasq","DNS","IPv6","AAAA","双栈"]}
---
把 dnsmasq 当 DNS 代理使用时，“过滤 IPv6”通常指隐藏 DNS 回答里的 **AAAA 记录**，而不是关闭 IPv6 协议。该选择会改变客户端拿到的地址，也可能改变后续连接的出口；它并不会自动配置路由或阻止客户端使用其他解析器。资料核对于 2026-10-26。

## 01 / 先分清三条独立的路径

客户端向 dnsmasq 发查询，dnsmasq 再问上游，这是 **DNS 转发**。A 记录给出 IPv4 地址，AAAA 记录给出 IPv6 地址；DNS 报文自身可以通过 IPv4 或 IPv6 传输，这与查询 A/AAAA 无关。[RFC 4472 的说明](https://www.rfc-editor.org/info/rfc4472/)明确指出，IPv4 传输也能查询 AAAA，IPv6 传输也能查询 A。

客户端取得地址后如何连接，是另外一条路径。双栈应用可以查询两类记录，并按连接状况在 IPv6 与 IPv4 间尝试；[Happy Eyeballs v2](https://www.rfc-editor.org/rfc/rfc8305.html)描述了这一机制。dnsmasq 返回 AAAA 不代表 IPv6 出口一定可用；过滤 AAAA 也不等于关闭网卡的 IPv6、路由器通告、DHCPv6 或防火墙的 IPv6 通路。

## 02 / 同一配置下，对比保留与过滤 AAAA

下面是隔离测试用的 DNS 转发器，只监听本机 `127.0.0.1:1053`。`192.0.2.54` 是文档保留地址，**必须替换为可达的测试上游**，否则两种模式都会失败。先检查该端口是否被占用，备份现有配置，不要将示例直接加到生产网关的全局 dnsmasq 服务中。[dnsmasq 手册](https://dnsmasq.org/docs/dnsmasq-man.html)说明了 `no-resolv`、`server` 和 `filter-AAAA` 的作用。

```ini
# /path/to/lab-dnsmasq.conf (示意路径；上游地址必须替换)
port=1053
listen-address=127.0.0.1
bind-interfaces
no-resolv
server=192.0.2.54
```

**不过滤：**保持上述配置，不设置 `filter-AAAA`。dnsmasq 从上游转发并缓存常见记录类型；若目标域名本来有 AAAA，客户端通常能取得其 IPv6 地址，然后由应用和系统网络策略决定连接地址。

**过滤：**在同一配置中添加下面一行。dnsmasq 的 `filter-AAAA` 会从回答中移除 AAAA 记录，A 记录不因此被删除。它是实例级的回答过滤，不是只对某个域名生效的出口规则；客户端可能仍得到 CNAME 等其他记录。AAAA 回答为空不等于域名不存在，也不能把 `NOERROR` 空答案误读为 `NXDOMAIN`。

```ini
filter-AAAA
```

过滤影响的是经过**这个 dnsmasq 实例**的查询。客户端的旧缓存、直接使用其他 DNS、应用内 DoH、IPv6 地址直连，或其他提供地址提示的记录，都不能单靠这一选项管住。特别是 IPv6-only / DNS64 / NAT64 环境，隐藏 AAAA 可能导致原本可用的服务无法访问。

## 03 / 从上游、代理和真实客户端验证

在一台允许测试的主机上，先选一个**已确认同时存在 A 和 AAAA** 的测试域名，将 `dual.example.com` 替换成它，并替换上游示例地址。仅查询 `example.com` 却不确认权威记录是否存在，无法判断过滤是否生效。以下命令只做查询和语法检查；如需启动测试实例，先确认端口与现有 DNS 服务不冲突，并由维护人员在隔离环境操作。

```sh
dnsmasq --test --conf-file=/path/to/lab-dnsmasq.conf
dig @192.0.2.54 dual.example.com A +noall +comments +answer
dig @192.0.2.54 dual.example.com AAAA +noall +comments +answer
dig @127.0.0.1 -p 1053 dual.example.com A +noall +comments +answer
dig @127.0.0.1 -p 1053 dual.example.com AAAA +noall +comments +answer
```

预期是：上游同时有 A/AAAA；不过滤时代理也返回两类地址；开启过滤后代理仍返回 A，但不返回 AAAA。检查完整响应状态、CNAME 与 TTL，别只看 `+short` 的空行。还应从实际客户端确认 DNS 指向这台代理，并分别观察 IPv4、IPv6 的路由与连接结果；本机 `dig @127.0.0.1` 成功并不能证明其他设备走了它。

## 04 / 什么时候该过滤，以及如何回退

- **双栈链路正常：**通常保留 AAAA，监测两种协议的 DNS 与连接。过滤会无差别隐藏 IPv6 目的地址，可能牺牲 IPv6-only 服务。
- **暂时只有 IPv4 出口：**过滤 AAAA 可作为明确告知客户端优先使用 IPv4 的临时兼容策略，但先确认所需服务有 A 记录；它不能代替修复坏掉的 IPv6 路由。
- **按域名分流或双 WAN：**仅按 IPv4 DNS 结果填充 ipset、配置 IPv4 NAT 时，未受管控的 IPv6 连接可能走另一条出口。应单独设计 IPv6 分类与路由，或在网关网络层明确限制不支持的 IPv6 路径；`filter-AAAA` 不是安全边界。相关设计见本站[双公网域名分流笔记](/notes/iptables-ipset-domain-dual-wan/)。

回退时从测试配置移除 `filter-AAAA`，确认语法和原监听配置，按维护窗口重新加载对应实例，再从客户端复查两类记录及连接。等待或清理客户端既有 DNS 缓存后再对比，避免把旧答案误判为新策略；不要为了 DNS 过滤直接关闭整网的 IPv6。

## 参考资料

- [dnsmasq 官方手册：转发、监听与 filter-AAAA](https://dnsmasq.org/docs/dnsmasq-man.html)
- [RFC 4472：DNS 记录与传输协议独立](https://www.rfc-editor.org/info/rfc4472/)
- [RFC 8305：Happy Eyeballs v2](https://www.rfc-editor.org/rfc/rfc8305.html)
