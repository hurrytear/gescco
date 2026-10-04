# 部署记录

## 2026-10-04 配置核对

- Cloudflare Pages 参考项目 `vsike` 连接 GitHub `hurrytear/vsike`。
- 生产分支 `main`，自动部署已启用，静态 HTML 无框架构建。
- 参考域名为 `www.vsike.com`，代理 CNAME 指向 `vsike.pages.dev`；参考根域当时没有网站解析。
- `gescco.com` 创建网站前只有 5 条邮件相关记录：3 条 MX、SPF TXT、DKIM TXT，无网站 A / AAAA / CNAME。

## 本站发布设置

本站使用同一托管模式，并增加文章构建步骤：Markdown → 静态 HTML。

构建命令 `npm run build && npm run check`，输出目录 `dist`，生产分支 `main`。无需环境密钥、数据库或付费插件。绑定根域与 www 域名，统一到根域 URL。

## 更新与回退

1. 修改文章或模板。
2. 本地执行构建与检查，确认页面、链接与示例内容。
3. 提交并推送到 `main`，等待 Pages 部署成功。
4. 访问域名确认部署版本、页面内容与 HTTPS。
5. 如需回退，可在 Pages 部署历史回退到已知正常版本，并在 Git 中还原问题提交，避免后续推送再次发布错误版本。

构建产物 `dist/` 不提交到 Git；Pages 只发布该目录。GitHub 中可看到源代码、文章与构建脚本，运行时无需外部脚本或字体资源。
