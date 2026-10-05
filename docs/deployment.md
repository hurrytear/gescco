# 部署记录

## 2026-10-04 配置核对

- Cloudflare Pages 参考项目 `vsike` 连接 GitHub `hurrytear/vsike`。
- 生产分支 `main`，自动部署已启用，静态 HTML 无框架构建。
- 参考域名为 `www.vsike.com`，代理 CNAME 指向 `vsike.pages.dev`；参考根域当时没有网站解析。
- `gescco.com` 创建网站前只有 5 条邮件相关记录：3 条 MX、SPF TXT、DKIM TXT，无网站 A / AAAA / CNAME。

## 本站发布设置

本站使用同一托管模式，并增加文章构建步骤：Markdown → 静态 HTML。

中英文内容独立生成：根路径默认中文，`/en/` 为英文。首页、目录、关于、全部文章、检索索引及 RSS 都有对应语言版本。语言切换保留文章、分类、检索词及章节，页面提供 `lang`、canonical 和 hreflang；sitemap 收录两种语言。

源代码已推送 GitHub `hurrytear/gescco`。Cloudflare Pages 项目 `gescco` 已创建，生产分支自动部署已启用。`gescco.com` 与 `www.gescco.com` 已添加为自定义域名，两条代理 CNAME 均指向 `gescco.pages.dev`；原有 5 条邮件记录保留。

构建命令 `npm run build && npm run check`，输出目录 `dist`，生产分支 `main`，环境变量 `NODE_VERSION=22`。无需环境密钥、数据库或付费插件。

域名重定向规则 `gescco www to canonical HTTPS` 已启用：匹配 `(http.host eq "www.gescco.com")`，目标 `concat("https://gescco.com", http.request.uri.path)`，状态码 301，保留查询字符串。此规则位于 Cloudflare 域名配置中；Pages 的 `_redirects` 不支持以完整域名作为源地址，只保留站内路径规则。

上线检查确认：根域 HTTPS 返回 200；`https://www.gescco.com/en/notes/?q=DNS` 返回 301，目标为 `https://gescco.com/en/notes/?q=DNS`。本地构建检查覆盖 24 个 HTML 页面、428 个站内链接、8 组完整译文以及命令与参考链接一致性；两个 RSS 均包含 8 篇文章，sitemap 收录 22 个内容页面并提供语言对应关系。

## 更新与回退

1. 修改文章或模板。
2. 本地执行构建与检查，确认页面、链接与示例内容。
3. 提交并推送到 `main`，等待 Pages 部署成功。
4. 访问域名确认部署版本、页面内容与 HTTPS。
5. 如需回退，可在 Pages 部署历史回退到已知正常版本，并在 Git 中还原问题提交，避免后续推送再次发布错误版本。

构建产物 `dist/` 不提交到 Git；Pages 只发布该目录。GitHub 中可看到源代码、文章与构建脚本，运行时无需外部脚本或字体资源。

## 明亮主题更新

按用户要求换用独立的蓝白与暖黄色主题，重新设计首页终端插画、彩色卡片目录和浅色文章页；目录由侧栏布局改为全宽卡片布局。已验证中英文搜索与切换、390px 首页及 320px 文章页面无水平溢出。更新后的构建检查通过 24 个 HTML 页面和 430 个站内链接，8 组文章译文及示例命令保持一致。

## strongSwan 文章更新

新增中英文 `strongswan-ikev2-vpn`：以 Ubuntu 24.04、charon-systemd 和 swanctl 为例，覆盖证书签发、EAP 账号、地址池、分流路由、转发规则、DNS 及客户端验收。结合历史维护经验整理版本入口、配置迁移和 RADIUS 分组排障，不包含原环境的地址、凭证或日志。示例依据官方资料核对，未在原生产 VPN 执行。

该次更新后共 9 组文章译文；构建检查覆盖 26 个 HTML 页面、472 个站内链接，以及示例命令和参考链接一致性。两种语言的检索、RSS 和 sitemap 自动加入新文章。

## OpenVPN 文章更新

新增中英文 `openvpn-tcp-udp`，按用户要求分别给出 UDP 1194 和 TCP 443 的完整服务端与客户端配置，双实例使用独立接口和地址池。内容涵盖 Easy-RSA 证书签发、分流路由、转发规则、客户端 DNS、可选全流量出口与证书吊销。示例均为公开的通用配置，未执行实际 VPN 部署。

长文章的桌面目录增加窗口高度限制与独立滚动，避免末尾章节超出较矮窗口；手机布局仍为正常展开的目录。

线上发现 Cloudflare 将代码中的 `openvpn-server@.service` 误判为邮箱并替换内容。生成器按 Cloudflare 官方支持的 `email_off` HTML 标记保护代码块，确保命令能够原样显示与复制，未修改域名的全局邮箱保护配置。参见 [Email Address Obfuscation](https://developers.cloudflare.com/waf/tools/scrape-shield/email-address-obfuscation/)。

该次更新后共 10 组文章译文；构建检查覆盖 28 个 HTML 页面、510 个站内链接、语言和章节对应关系，以及示例命令和参考链接一致性。搜索、RSS 与 sitemap 自动收录新文章。

## 阿里云与 IDC 专线 BGP 文章更新

新增中英文 `aliyun-idc-bgp`，以双专线、双 CPE、VBR + ECR 为例，说明 IPv4 地址与 ASN 规划、ECR 关联顺序、BGP 邻居、前缀过滤和两个方向的主备选路。使用 FRRouting 10.4 配置片段展示 LOCAL_PREF 与 AS_PATH prepend，并明确 IDC 内部 iBGP、next hop 可达性和真实业务路由的前提。

文章同时说明已有 CEN / 企业版 TR 的路由关联、学习、VPC 回程与动态路由源限制，覆盖业务访问控制、内部 DNS、BFD、分层验收、故障演练及回退。依据阿里云和 FRRouting 官方资料核对；仅使用通用示例地址和密钥占位符，没有配置实际专线或执行故障演练。

该次更新后共 11 组文章译文；构建检查覆盖 30 个 HTML 页面、548 个站内链接、语言和章节对应关系，以及示例命令和参考链接一致性。搜索、双语 RSS 与 sitemap 自动收录新文章。

## RDS 备份恢复与 4 小时延迟从库文章更新

新增中英文 `rds-idc-delayed-replica`，以 RDS MySQL 8.0 高可用本地盘物理备份和兼容的 IDC MySQL 8.0.26+ 为例，覆盖备份下载与安全传输、按格式解包、prepare、独立目录恢复、本地管理入口、实例标识与继承参数检查、GTID 基线验证、TLS 复制连接和 `SOURCE_DELAY=14400`。

区分云盘快照与本地盘备份、归档日志与在线 Binlog，说明源日志保留需覆盖执行延迟和中断恢复、relay log 容量规划、重启保护、实际延迟验收、监控及误操作后的冻结恢复。资料依据阿里云、MySQL 和 Percona 官方文档核对，示例使用通用地址与凭证占位符；没有下载实际备份、连接数据库或执行恢复与复制操作。

当前共 12 组文章译文；构建检查覆盖 32 个 HTML 页面、590 个站内链接，以及双语示例命令、参考链接、语言元数据和章节锚点。新文章两种语言各 8 个 Shell 代码块通过 Bash 语法检查；本地浏览器验证中英文切换保留延迟配置章节，页面无水平溢出。搜索、双语 RSS 与 sitemap 自动收录新文章。
