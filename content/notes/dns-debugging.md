---
{"title":"DNS 排障：拆开权威记录与递归缓存","category":"网络与代理","kind":"排障手册","date":"2026-10-04","summary":"核对 NS、A/AAAA、CNAME 和 TTL，区分记录错误、缓存差异与真正的连接故障。","tags":["DNS","dig","TLS"]}
---
域名打不开时，先证明解析在哪一步出现差异。以下使用保留的示例域名 `example.com` 与文档 IP `192.0.2.10`，只用于说明命令格式。

## 01 / 查询不同记录类型

```sh
dig example.com NS +noall +answer
dig example.com A +noall +answer
dig example.com AAAA +noall +answer
dig www.example.com CNAME +noall +answer
```

如果返回为空，去掉 `+noall +answer` 查看完整报文：`NXDOMAIN`、`NOERROR` 无答案与 `SERVFAIL` 是不同情况。浏览器优先使用 IPv6 时，错误的 AAAA 记录也可能导致部分用户失败。

## 02 / 比较递归解析与权威答案

```sh
dig @1.1.1.1 example.com A
dig @8.8.8.8 example.com A
dig example.com NS
# 将下方主机名替换为上一步返回的权威 NS
dig @ns1.example.com example.com A +norecurse
```

权威记录正确但递归答案不同，可能与 TTL、负缓存或解析器策略相关。TTL 是缓存有效期，不是全球切换承诺；网络也可能限制外部 DNS 查询。

## 03 / 把 DNS 和 HTTPS 分开验证

在明确知道目标源站 IP、允许直连且证书配置匹配的前提下，可使用 `--resolve` 固定 IP，保留 Host 和 TLS 主机名验证。

```sh
curl --resolve example.com:443:192.0.2.10 \
  --connect-timeout 5 --max-time 10 -I https://example.com/
```

若只在经过 CDN 时失败，继续检查 CDN 的域名绑定、证书状态与源站连接。固定地址仍失败，则查路由、防火墙、TLS 或服务监听。

## 04 / 变更时保留回退依据

记录修改前后的值、TTL、操作时间及两个解析器的结果。计划迁移时提前降低 TTL，并给已有缓存过期留出时间。最后从实际客户端验证页面和证书；仅看控制台记录已经保存，不足以证明访问链路恢复。

## 参考资料

- [ISC BIND：dig 使用手册](https://bind9.readthedocs.io/en/latest/manpages.html#dig-dns-lookup-utility)
- [Cloudflare Pages：自定义域名](https://developers.cloudflare.com/pages/configuration/custom-domains/)
