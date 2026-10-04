# gescco · 运维笔记

公开的中英文运维技术笔记，默认中文。网站：<https://gescco.com>，英文版：<https://gescco.com/en/>。

## 页面设计

采用独立的明亮主题：蓝白底色与暖黄色渐变、橙色强调、彩色分类标签及卡片式笔记目录。文章使用浅色阅读区和代码框；手机上自动切换为单列布局。中英文使用同一套视觉设计，无外部字体、图片或脚本依赖。

## 本地运行

需要 Node.js 22 或更新版本，无需安装依赖。

```sh
npm run dev
```

打开 <http://127.0.0.1:4173>。修改内容后重新构建，刷新浏览器。

```sh
npm run build
npm run check
```

## 新增文章

在 `content/notes/` 新建英文短横线命名的 `.md` 文件。顶部是 JSON 元数据，以 `---` 包围：

```text
---
{"title":"文章标题","category":"Linux","kind":"实践笔记","date":"2026-10-04","summary":"摘要","tags":["关键词"]}
---

正文。

## 01 / 小节标题

段落、无序列表、行内代码、HTTPS 链接和 fenced code block。

## 参考资料

- [官方文档](https://docs.kernel.org/)
```

在 `content/notes/en/` 创建同名英文 `.md` 文件，翻译标题、摘要、正文、标签与章节标题。英文分类对应为 Linux、Kubernetes、Networking & proxies、Observability、Data & reliability；`kind` 使用英文描述，日期和章节数量保持对应。命令语义及操作前提应一致。

支持分类：Linux、Kubernetes、网络与代理、可观测性、数据与可靠性。Markdown 渲染器仅支持本项目使用的子集，不支持原始 HTML、复杂表格与嵌套列表；所有原始 HTML 会转义。两种语言的文章页、目录、全文检索、RSS、sitemap 自动生成。构建会检查译文配对；导航的语言切换保留对应文章、分类、检索词及章节锚点。中文使用根路径，英文使用 `/en/`，不按浏览器语言自动跳转；每次直接打开根首页都默认中文。CSS 和 JS 文件名带内容散列，避免更新后读取旧资源。

## Cloudflare Pages

沿用 `hurrytear/vsike` 的 GitHub → Pages 自动发布模式。

| 项目 | 配置 |
| --- | --- |
| 仓库 | `hurrytear/gescco` |
| 生产分支 | `main` |
| 框架 | None |
| 构建命令 | `npm run build && npm run check` |
| 输出目录 | `dist` |
| Node.js | 22 |
| 域名 | `gescco.com`、`www.gescco.com` |

在 Pages 项目中绑定两个自定义域名，由 Pages 创建对应 DNS 记录。`www` 的请求通过 Cloudflare 域名重定向规则跳转到根域名，并保留路径和查询参数；Pages 的 `_redirects` 只用于站内路径跳转。已有邮件记录保留。推送到 `main` 后自动构建部署；构建检查失败时不会替换当前生产站点。

## 内容约定

只写公开资料与通用技术方法。使用示例域名、示例命名空间和保留文档 IP；不提交凭证、内部地址、业务信息或真实日志。会修改状态的命令必须说明适用前提。发布前核对技术资料和命令；修正有记录，文章日期以实际整理日期更新。

详见 [部署记录](docs/deployment.md)。
