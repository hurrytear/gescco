import { readFile, writeFile, mkdir, readdir, cp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = path.join(root, 'dist');
const origin = 'https://gescco.com';
const repo = 'https://github.com/hurrytear/gescco';
const categories = ['Linux', 'Kubernetes', '网络与代理', '可观测性', '数据与可靠性'];
const escape = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const xml = escape;
const inline = text => escape(text).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+|\/[\w/?.=#%-]*)\)/g, '<a href="$2">$1</a>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

// Deliberately small Markdown subset: headings, paragraphs, lists and fenced code.
// Raw HTML is escaped. Content is versioned and reviewed before publication.
function markdown(body) {
  const lines = body.trim().split('\n');
  const html = [], headings = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const code = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) code.push(lines[i++]);
      if (i === lines.length) throw new Error('Unclosed code fence');
      i++;
      html.push(`<div class="code-block"><div class="code-top"><span>${escape(lang || 'text')}</span><button type="button" class="copy-code" aria-label="复制代码">复制</button></div><pre><code>${escape(code.join('\n'))}</code></pre></div>`);
    } else if (/^## /u.test(line)) {
      const title = line.slice(3), id = `section-${headings.length + 1}`;
      headings.push({ title, id });
      html.push(`<h2 id="${id}">${inline(title)}</h2>`); i++;
    } else if (line.startsWith('- ')) {
      const items = [];
      while (i < lines.length && lines[i].startsWith('- ')) items.push(`<li>${inline(lines[i++].slice(2))}</li>`);
      html.push(`<ul>${items.join('')}</ul>`);
    } else {
      const p = [];
      while (i < lines.length && lines[i].trim() && !/^(## |```|- )/.test(lines[i])) p.push(lines[i++]);
      html.push(`<p>${inline(p.join(' '))}</p>`);
    }
  }
  return { html: html.join('\n'), headings };
}

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(path.join(root, 'public'), out, { recursive: true });
const assets = {};
for (const filename of ['site.css', 'site.js']) {
  const data = await readFile(path.join(root, 'public/assets', filename));
  const hash = createHash('sha256').update(data).digest('hex').slice(0, 10);
  const name = filename.replace('.', `.${hash}.`);
  await writeFile(path.join(out, 'assets', name), data);
  await rm(path.join(out, 'assets', filename));
  assets[filename] = `/assets/${name}`;
}
const notes = [];
for (const filename of (await readdir(path.join(root, 'content/notes'))).filter(f => f.endsWith('.md'))) {
  const raw = await readFile(path.join(root, 'content/notes', filename), 'utf8');
  const match = raw.match(/^---\n([\s\S]+?)\n---\n([\s\S]+)$/);
  if (!match) throw new Error(`Missing metadata in ${filename}`);
  const metadata = JSON.parse(match[1]), slug = filename.slice(0, -3);
  if (!/^[a-z0-9-]+$/.test(slug) || !categories.includes(metadata.category) || !/^\d{4}-\d{2}-\d{2}$/.test(metadata.date) || !metadata.title || !metadata.summary || !Array.isArray(metadata.tags)) throw new Error(`Invalid metadata in ${filename}`);
  const rendered = markdown(match[2]);
  notes.push({ ...metadata, slug, ...rendered, body: match[2], minutes: Math.max(3, Math.ceil(match[2].length / 400)) });
}
notes.sort((a,b) => b.date.localeCompare(a.date) || Number(Boolean(b.featured)) - Number(Boolean(a.featured)) || a.slug.localeCompare(b.slug));
const nav = (current) => `<header class="header"><a class="brand" href="/" aria-label="gescco 首页"><span class="brand-mark" aria-hidden="true">&gt;_</span>gescco<span class="brand-dot">.</span></a><nav aria-label="主导航"><a href="/notes/"${current === 'notes' ? ' aria-current="page"' : ''}>全部笔记</a><a href="/about/"${current === 'about' ? ' aria-current="page"' : ''}>关于</a><a class="github-link" href="${repo}">GitHub <span aria-hidden="true">↗</span></a></nav></header>`;
const footer = `<footer class="footer"><a class="brand small" href="/">gescco<span class="brand-dot">.</span></a><p>记录方法，让下一次排障更有依据。</p><div><a href="/about/">关于本站</a><a href="/feed.xml">RSS ↗</a><a href="${repo}">源代码 ↗</a></div><span class="copyright">© 2026 gescco</span></footer><div id="toast" role="status" aria-live="polite"></div>`;
function page({ title, description, route, current = '', body, article }) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escape(title)}</title><meta name="description" content="${escape(description)}"><meta name="robots" content="index,follow"><link rel="canonical" href="${origin}${route}"><meta property="og:type" content="${article ? 'article' : 'website'}"><meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(description)}"><meta property="og:url" content="${origin}${route}"><meta property="og:site_name" content="gescco 运维笔记">${article ? `<meta property="article:published_time" content="${article.date}T00:00:00+09:00">` : ''}<link rel="icon" type="image/svg+xml" href="/assets/favicon.svg"><link rel="alternate" type="application/rss+xml" title="gescco 运维笔记" href="/feed.xml"><link rel="stylesheet" href="${assets['site.css']}"><script src="${assets['site.js']}" defer></script></head><body><a class="skip" href="#main">跳转到正文</a><div class="site-shell">${nav(current)}${body}${footer}</div></body></html>`;
}
const count = c => notes.filter(n => n.category === c).length;
const card = (n, i) => `<article class="note-card" data-slug="${n.slug}" data-category="${escape(n.category)}"><span class="note-number">${String(i + 1).padStart(2, '0')}</span><div><div class="note-meta"><span class="category-label">${escape(n.category)}</span><span>${escape(n.kind)}</span></div><h3><a href="/notes/${n.slug}/">${escape(n.title)}<span class="arrow" aria-hidden="true">↗</span></a></h3><p>${escape(n.summary)}</p><div class="note-detail"><span>${n.date.replaceAll('-', '.')}</span><span>${n.minutes} 分钟阅读</span>${n.tags.map(t => `<span class="tag">${escape(t)}</span>`).join('')}</div></div></article>`;
const filters = `<div class="filter-chips" role="group" aria-label="按分类筛选"><button type="button" data-filter="全部" aria-pressed="true">全部 <span>${notes.length}</span></button>${categories.map(c => `<button type="button" data-filter="${escape(c)}" aria-pressed="false">${escape(c)} <span>${count(c)}</span></button>`).join('')}</div>`;
const list = `<section class="library" aria-labelledby="library-heading"><div class="section-heading"><h2 id="library-heading">笔记目录 <span class="mono">/ FIELD NOTES</span></h2><span id="results-count" aria-live="polite">${notes.length} 篇笔记</span></div><form class="search" role="search" action="/notes/"><label class="sr-only" for="search-input">搜索运维笔记</label><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg><input id="search-input" name="q" type="search" placeholder="搜索问题、命令或技术关键词…" autocomplete="off"><button type="submit" class="search-submit">搜索</button></form>${filters}<div id="note-list">${notes.map(card).join('')}</div><div id="empty-results" class="empty" hidden><h3>还没有匹配的笔记</h3><p>试试其他关键词，或回到全部分类。</p><button id="reset-search" type="button">查看全部笔记 →</button></div><noscript><p class="notice">下方展示全部文章；启用 JavaScript 后可以检索和筛选。</p></noscript></section>`;
const side = `<aside class="home-aside"><section class="start-here"><span class="eyebrow">A GOOD PLACE TO START</span><h2>从一个问题开始。</h2><p>先留下证据，再缩小范围，最后验证恢复。</p><ol><li><a href="/notes/linux-first-look/"><span>01</span>主机变慢，先看现场 ↗</a></li><li><a href="/notes/kubernetes-crashloop/"><span>02</span>容器重启，追到退出 ↗</a></li><li><a href="/notes/incident-notes/"><span>03</span>故障之后，留下方法 ↗</a></li></ol></section><section class="scope"><span class="eyebrow">ON THE SHELF</span><h2>按主题阅读</h2>${categories.map(c => `<a href="/notes/?category=${encodeURIComponent(c)}">${escape(c)}<span>${String(count(c)).padStart(2, '0')} ↗</span></a>`).join('')}</section><div class="editor-note"><span class="tiny-icon" aria-hidden="true">[*]</span><p>通用方法、示例命令与官方资料。每篇笔记都标明适用前提，方便核对与复用。</p><a href="/about/">阅读本站说明 →</a></div></aside>`;
const hero = `<section class="hero" aria-labelledby="hero-heading"><div class="hero-copy"><div class="eyebrow"><span class="signal-dot" aria-hidden="true"></span> OPERATIONS / 运维笔记</div><h1 id="hero-heading">把排障过程，<br>写成可复用的<span class="accent">笔记。</span></h1><p>关于系统、网络与可靠性的技术记录。<br>从现象到证据，从临时处理到长期改进。</p><a class="text-link" href="#library-heading">打开笔记目录 <span aria-hidden="true">↓</span></a></div><div class="field-cover" aria-hidden="true"><div class="cover-top"><span>gescco / field notes</span><span>VOL. 001</span></div><div class="cover-diagram"><div class="diagram-label">SYSTEM OBSERVED</div><div class="diagram-line"></div><div class="diagram-nodes"><i></i><i></i><i></i></div><div class="diagram-code">$ observe<br><span>→ form a hypothesis</span><br>$ verify<br><span>→ leave a useful note</span></div></div><div class="cover-bottom"><span>observe. understand. improve.</span><span>↗</span></div></div></section><div class="hero-rule"><span>技术记录 · 持续整理</span><span>LINUX / CLOUD NATIVE / RELIABILITY</span></div>`;
async function save(route, html) {
  const dir = path.join(out, route);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'index.html'), html);
}
await save('', page({ title: 'gescco · 运维笔记', description: '关于 Linux、Kubernetes、网络、可观测性与可靠性的公开技术笔记。以证据驱动排障，记录可复用的方法。', route: '/', body: `<main id="main">${hero}<div class="home-grid">${list}${side}</div></main>` }));
await save('notes', page({ title: '全部笔记 · gescco', description: '浏览和检索 gescco 的公开运维笔记，按 Linux、Kubernetes、网络、可观测性与可靠性分类阅读。', route: '/notes/', current: 'notes', body: `<main id="main"><section class="page-intro"><span class="eyebrow">THE NOTEBOOK</span><h1>全部笔记<span class="accent">。</span></h1><p>从一个具体问题，找到一条可验证的排障路径。</p></section><div class="home-grid">${list}${side}</div></main>` }));
for (const n of notes) {
  const related = notes.filter(x => x.slug !== n.slug && x.category === n.category).slice(0, 2);
  const toc = `<aside class="toc" aria-label="文章目录"><span class="eyebrow">IN THIS NOTE</span><nav>${n.headings.map(h => `<a href="#${h.id}">${escape(h.title)}</a>`).join('')}</nav><div class="toc-note">通用示例 · 请核对环境<br>最后整理 ${n.date.replaceAll('-', '.')}</div></aside>`;
  await save(`notes/${n.slug}`, page({ title: `${n.title} · gescco`, description: n.summary, route: `/notes/${n.slug}/`, current: 'notes', article: n, body: `<main id="main"><div class="breadcrumb"><a href="/notes/">全部笔记</a><span>/</span><a href="/notes/?category=${encodeURIComponent(n.category)}">${escape(n.category)}</a></div><header class="article-header"><div class="note-meta"><span class="category-label">${escape(n.category)}</span><span>${escape(n.kind)}</span></div><h1>${escape(n.title)}</h1><p>${escape(n.summary)}</p><div class="note-detail"><time datetime="${n.date}">${n.date.replaceAll('-', '.')}</time><span>${n.minutes} 分钟阅读</span>${n.tags.map(t => `<span class="tag">${escape(t)}</span>`).join('')}</div></header><div class="article-grid">${toc}<article class="prose">${n.html}<div class="article-end"><span>END OF NOTE / ${escape(n.category)}</span><a href="${repo}/blob/main/content/notes/${n.slug}.md">查看文章源文件 ↗</a></div></article></div><section class="related"><div class="section-heading"><h2>继续阅读</h2><a href="/notes/">全部笔记 →</a></div>${(related.length ? related : notes.filter(x => x.slug !== n.slug).slice(0, 2)).map(card).join('')}</section></main>` }));
}
const about = `<main id="main"><section class="page-intro"><span class="eyebrow">ABOUT THIS NOTEBOOK</span><h1>把经验留下来<span class="accent">。</span></h1><p>gescco 是一份公开的运维技术笔记。</p></section><article class="prose about-prose"><h2>这里记录什么</h2><p>记录 Linux、容器平台、网络、监控、备份与发布中的通用方法。每篇从一个具体问题出发，给出可核对的证据、下一步调查方向和恢复验证方法。首批文章依据公开技术文档整理，不描述任何真实公司的内部系统或事故。</p><h2>如何使用笔记</h2><p>命令中的服务名、命名空间、域名和 IP 都是示例。使用前核对操作系统、工具版本、集群上下文与权限。会修改状态的恢复和回退操作，在文章中标明前置条件。技术文档会变化，应同时核对文末官方资料与当前环境。</p><h2>公开内容的边界</h2><p>本站只收录通用原理、公开资料与示例。文章中不包含访问凭证、内部地址、业务数据、客户信息或未公开组织细节。公开分享日志、配置及截图之前，同样需要去除敏感内容。</p><h2>阅读与更新</h2><p>文章按主题归档，可通过目录检索，也可以订阅 <a href="/feed.xml">RSS</a>。代码与文章源文件保存在 <a href="${repo}">GitHub 仓库</a>，修改经过版本记录后发布。</p><h2>参考与更正</h2><p>文章底部列出官方参考资料，便于进一步核实。发现问题时，可在 GitHub 上<a href="${repo}/issues">提出更正</a>；请只提供已去除敏感信息的示例与说明。</p></article></main>`;
await save('about', page({ title: '关于 · gescco 运维笔记', description: 'gescco 记录公开、通用、可核对的运维技术方法，以及内容范围与更正方式。', route: '/about/', current: 'about', body: about }));
await writeFile(path.join(out, '404.html'), page({ title: '未找到页面 · gescco', description: '这个页面不存在，请回到运维笔记目录继续阅读。', route: '/404.html', body: '<main id="main" class="not-found"><span class="eyebrow">404 / NOTE NOT FOUND</span><h1>这页笔记<br>还没写到这里。</h1><p>检查一下地址，或回到目录继续阅读。</p><a class="text-link" href="/notes/">回到全部笔记 →</a></main>' }));
await writeFile(path.join(out, 'search-index.json'), JSON.stringify(notes.map(({ slug, title, category, tags, summary, body }) => ({ slug, title, category, tags, summary, body }))));
const routes = ['/', '/notes/', '/about/', ...notes.map(n => `/notes/${n.slug}/`)];
await writeFile(path.join(out, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${routes.map(r => `<url><loc>${origin}${r}</loc></url>`).join('')}</urlset>`);
await writeFile(path.join(out, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`);
await writeFile(path.join(out, 'feed.xml'), `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>gescco 运维笔记</title><link>${origin}/</link><description>系统、网络与可靠性的公开技术记录</description><language>zh-cn</language>${notes.map(n => `<item><title>${xml(n.title)}</title><link>${origin}/notes/${n.slug}/</link><guid>${origin}/notes/${n.slug}/</guid><description>${xml(n.summary)}</description><category>${xml(n.category)}</category><pubDate>${new Date(`${n.date}T00:00:00+09:00`).toUTCString()}</pubDate></item>`).join('')}</channel></rss>`);
console.log(`Built ${notes.length} notes, ${routes.length} pages, RSS, search index and sitemap → dist/`);
