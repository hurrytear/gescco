import { readFile, writeFile, mkdir, readdir, cp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { categories, locales } from './i18n.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = path.join(root, 'dist');
const origin = 'https://gescco.com';
const repo = 'https://github.com/hurrytear/gescco';
const escape = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const inline = text => escape(text).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+|\/[\w/?.=#%-]*)\)/g, '<a href="$2">$1</a>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

// Supported Markdown: paragraphs, h2 headings, lists, inline markup and fenced code.
// Raw HTML is escaped. Translations are independent, versioned content files.
function markdown(body, ui) {
  const lines = body.trim().split('\n');
  const html = [], headings = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim(), code = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) code.push(lines[i++]);
      if (i === lines.length) throw new Error('Unclosed code fence');
      i++;
      html.push(`<div class="code-block"><div class="code-top"><span>${escape(lang || 'text')}</span><button type="button" class="copy-code" aria-label="${ui.copyLabel}">${ui.copy}</button></div><pre><code>${escape(code.join('\n'))}</code></pre></div>`);
    } else if (line.startsWith('## ')) {
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
async function saveFile(route, data) {
  const file = path.join(out, route.replace(/^\//, ''));
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, data);
}
async function savePage(route, html) { await saveFile(`${route}index.html`, html); }
const versions = {}, siteRoutes = [];
for (const [locale, ui] of Object.entries(locales)) {
  const contentDir = path.join(root, 'content/notes', locale === 'en' ? 'en' : '');
  const notes = [];
  for (const filename of (await readdir(contentDir)).filter(f => f.endsWith('.md'))) {
    const raw = await readFile(path.join(contentDir, filename), 'utf8');
    const match = raw.match(/^---\n([\s\S]+?)\n---\n([\s\S]+)$/);
    if (!match) throw new Error(`Missing metadata in ${locale}/${filename}`);
    const metadata = JSON.parse(match[1]), slug = filename.slice(0, -3);
    const category = categories.find(c => c[locale] === metadata.category);
    if (!/^[a-z0-9-]+$/.test(slug) || !category || !/^\d{4}-\d{2}-\d{2}$/.test(metadata.date) || !metadata.title || !metadata.summary || !metadata.kind || !Array.isArray(metadata.tags)) throw new Error(`Invalid metadata in ${locale}/${filename}`);
    const minutes = Math.max(3, Math.ceil(locale === 'en' ? match[2].split(/\s+/).length / 200 : match[2].length / 400));
    notes.push({ ...metadata, categoryId: category.id, slug, ...markdown(match[2], ui), body: match[2], minutes });
  }
  notes.sort((a,b) => b.date.localeCompare(a.date) || Number(Boolean(b.featured)) - Number(Boolean(a.featured)) || a.slug.localeCompare(b.slug));
  versions[locale] = notes;
  const href = route => `${ui.prefix}${route}`;
  const count = id => notes.filter(n => n.categoryId === id).length;
  const languages = route => `<div class="language-switch" role="group" aria-label="${ui.languageLabel}"><a href="${route}" lang="zh-CN" hreflang="zh-CN" data-language-link aria-label="${ui.chineseLabel}"${locale === 'zh' ? ' aria-current="true"' : ''}>中文</a><a href="/en${route}" lang="en" hreflang="en" data-language-link aria-label="${ui.englishLabel}"${locale === 'en' ? ' aria-current="true"' : ''}>EN</a></div>`;
  const nav = (current, route) => `<header class="header"><a class="brand" href="${href('/')}" aria-label="${ui.brandLabel}"><span class="brand-mark" aria-hidden="true">&gt;_</span>gescco<span class="brand-dot">.</span></a><nav aria-label="${ui.navLabel}"><a href="${href('/notes/')}"${current === 'notes' ? ' aria-current="page"' : ''}>${ui.notesTitle}</a><a href="${href('/about/')}"${current === 'about' ? ' aria-current="page"' : ''}>${ui.aboutTitle}</a><a class="github-link" href="${repo}">GitHub <span aria-hidden="true">↗</span></a>${languages(route)}</nav></header>`;
  const footer = `<footer class="footer"><a class="brand small" href="${href('/')}">gescco<span class="brand-dot">.</span></a><p>${ui.footerText}</p><div><a href="${href('/about/')}">${ui.aboutSite}</a><a href="${href('/feed.xml')}">RSS ↗</a><a href="${repo}">${ui.source} ↗</a></div><span class="copyright">© 2026 gescco</span></footer><div id="toast" role="status" aria-live="polite" data-copied="${escape(ui.copied)}" data-copy-fallback="${escape(ui.copyFallback)}"></div>`;
  function page({ title, description, route, current = '', body, article, noindex = false }) {
    return `<!doctype html><html lang="${ui.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escape(title)}</title><meta name="description" content="${escape(description)}"><meta name="robots" content="${noindex ? 'noindex,follow' : 'index,follow'}"><link rel="canonical" href="${origin}${href(route)}"><link rel="alternate" hreflang="zh-CN" href="${origin}${route}"><link rel="alternate" hreflang="en" href="${origin}/en${route}"><link rel="alternate" hreflang="x-default" href="${origin}${route}"><meta property="og:type" content="${article ? 'article' : 'website'}"><meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(description)}"><meta property="og:url" content="${origin}${href(route)}"><meta property="og:site_name" content="${escape(ui.siteName)}"><meta property="og:locale" content="${ui.ogLocale}">${article ? `<meta property="article:published_time" content="${article.date}T00:00:00+09:00">` : ''}<link rel="icon" type="image/svg+xml" href="/assets/favicon.svg"><link rel="alternate" type="application/rss+xml" title="${escape(ui.siteName)}" href="${href('/feed.xml')}"><link rel="stylesheet" href="${assets['site.css']}"><script src="${assets['site.js']}" defer></script></head><body><a class="skip" href="#main">${ui.skip}</a><div class="site-shell">${nav(current, route)}${body}${footer}</div></body></html>`;
  }
  const card = (n, i) => `<article class="note-card" data-slug="${n.slug}" data-category="${n.categoryId}"><span class="note-number">${String(i + 1).padStart(2, '0')}</span><div><div class="note-meta"><span class="category-label">${escape(n.category)}</span><span>${escape(n.kind)}</span></div><h3><a href="${href(`/notes/${n.slug}/`)}">${escape(n.title)}<span class="arrow" aria-hidden="true">↗</span></a></h3><p>${escape(n.summary)}</p><div class="note-detail"><span>${n.date.replaceAll('-', '.')}</span><span>${ui.readTime(n.minutes)}</span>${n.tags.map(t => `<span class="tag">${escape(t)}</span>`).join('')}</div></div></article>`;
  const filters = `<div class="filter-chips" role="group" aria-label="${ui.filterLabel}"><button type="button" data-filter="all" aria-pressed="true">${ui.all} <span>${notes.length}</span></button>${categories.map(c => `<button type="button" data-filter="${c.id}" data-legacy-category="${c.zh}" aria-pressed="false">${escape(c[locale])} <span>${count(c.id)}</span></button>`).join('')}</div>`;
  const list = `<section class="library" aria-labelledby="library-heading"><div class="section-heading"><h2 id="library-heading">${ui.libraryTitle} <span class="mono">/ FIELD NOTES</span></h2><span id="results-count" aria-live="polite" data-one="${ui.resultCount(1)}" data-many="${ui.resultCount('{count}')}">${ui.resultCount(notes.length)}</span></div><form class="search" role="search" action="${href('/notes/')}"><label class="sr-only" for="search-input">${ui.searchLabel}</label><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg><input id="search-input" name="q" type="search" placeholder="${ui.searchPlaceholder}" autocomplete="off"><button type="submit" class="search-submit">${ui.search}</button></form>${filters}<div id="note-list">${notes.map(card).join('')}</div><div id="empty-results" class="empty" hidden><h3>${ui.emptyTitle}</h3><p>${ui.emptyText}</p><button id="reset-search" type="button">${ui.resetSearch}</button></div><p id="search-fallback" class="notice" role="status" hidden>${ui.searchFallback}</p><noscript><p class="notice">${ui.noScript}</p></noscript></section>`;
  const side = `<aside class="home-aside"><section class="start-here"><span class="eyebrow">A GOOD PLACE TO START</span><h2>${ui.startTitle}</h2><p>${ui.startText}</p><ol>${['linux-first-look', 'kubernetes-crashloop', 'incident-notes'].map((slug,i) => `<li><a href="${href(`/notes/${slug}/`)}"><span>${String(i + 1).padStart(2,'0')}</span>${ui.startLinks[i]}</a></li>`).join('')}</ol></section><section class="scope"><span class="eyebrow">ON THE SHELF</span><h2>${ui.topicTitle}</h2>${categories.map(c => `<a href="${href('/notes/')}?category=${c.id}">${escape(c[locale])}<span>${String(count(c.id)).padStart(2,'0')} ↗</span></a>`).join('')}</section><div class="editor-note"><span class="tiny-icon" aria-hidden="true">[*]</span><p>${ui.editorText}</p><a href="${href('/about/')}">${ui.readAbout}</a></div></aside>`;
  const hero = `<section class="hero" aria-labelledby="hero-heading"><div class="hero-copy"><div class="eyebrow"><span class="signal-dot" aria-hidden="true"></span> ${ui.heroEyebrow}</div><h1 id="hero-heading">${ui.heroHeading}</h1><p>${ui.heroText}</p><a class="text-link" href="#library-heading">${ui.openLibrary} <span aria-hidden="true">↓</span></a></div><div class="field-cover" aria-hidden="true"><div class="cover-top"><span>gescco / field notes</span><span>VOL. 001</span></div><div class="cover-diagram"><div class="diagram-label">SYSTEM OBSERVED</div><div class="diagram-line"></div><div class="diagram-nodes"><i></i><i></i><i></i></div><div class="diagram-code">$ observe<br><span>→ form a hypothesis</span><br>$ verify<br><span>→ leave a useful note</span></div></div><div class="cover-bottom"><span>observe. understand. improve.</span><span>↗</span></div></div></section><div class="hero-rule"><span>${ui.heroRule}</span><span>LINUX / CLOUD NATIVE / RELIABILITY</span></div>`;
  await savePage(href('/'), page({ title: ui.homeTitle, description: ui.homeDescription, route: '/', body: `<main id="main">${hero}<div class="home-grid">${list}${side}</div></main>` }));
  await savePage(href('/notes/'), page({ title: `${ui.notesTitle} · gescco`, description: ui.notesDescription, route: '/notes/', current: 'notes', body: `<main id="main"><section class="page-intro"><span class="eyebrow">THE NOTEBOOK</span><h1>${ui.notesHeading}</h1><p>${ui.notesIntro}</p></section><div class="home-grid">${list}${side}</div></main>` }));
  for (const n of notes) {
    const related = notes.filter(x => x.slug !== n.slug && x.categoryId === n.categoryId).slice(0, 2);
    const toc = `<aside class="toc" aria-label="${ui.tocLabel}"><span class="eyebrow">IN THIS NOTE</span><nav>${n.headings.map(h => `<a href="#${h.id}">${escape(h.title)}</a>`).join('')}</nav><div class="toc-note">${ui.exampleNote}<br>${ui.updated} ${n.date.replaceAll('-', '.')}</div></aside>`;
    const sourceDir = `content/notes/${locale === 'en' ? 'en/' : ''}`;
    await savePage(href(`/notes/${n.slug}/`), page({ title: `${n.title} · gescco`, description: n.summary, route: `/notes/${n.slug}/`, current: 'notes', article: n, body: `<main id="main"><div class="breadcrumb"><a href="${href('/notes/')}">${ui.notesTitle}</a><span>/</span><a href="${href('/notes/')}?category=${n.categoryId}">${escape(n.category)}</a></div><header class="article-header"><div class="note-meta"><span class="category-label">${escape(n.category)}</span><span>${escape(n.kind)}</span></div><h1>${escape(n.title)}</h1><p>${escape(n.summary)}</p><div class="note-detail"><time datetime="${n.date}">${n.date.replaceAll('-', '.')}</time><span>${ui.readTime(n.minutes)}</span>${n.tags.map(t => `<span class="tag">${escape(t)}</span>`).join('')}</div></header><div class="article-grid">${toc}<article class="prose">${n.html}<div class="article-end"><span>END OF NOTE / ${escape(n.category)}</span><a href="${repo}/blob/main/${sourceDir}${n.slug}.md">${ui.articleSource}</a></div></article></div><section class="related"><div class="section-heading"><h2>${ui.readNext}</h2><a href="${href('/notes/')}">${ui.allNotesLink}</a></div>${(related.length ? related : notes.filter(x => x.slug !== n.slug).slice(0, 2)).map(card).join('')}</section></main>` }));
  }
  const about = `<main id="main"><section class="page-intro"><span class="eyebrow">ABOUT THIS NOTEBOOK</span><h1>${ui.aboutHeading}</h1><p>${ui.aboutIntro}</p></section><article class="prose about-prose">${ui.aboutSections.map(([heading,text]) => `<h2>${heading}</h2><p>${text}</p>`).join('')}<h2>${ui.aboutUpdatesTitle}</h2><p>${ui.aboutUpdates(href('/feed.xml'),repo)}</p><h2>${ui.aboutCorrectionsTitle}</h2><p>${ui.aboutCorrections(repo)}</p></article></main>`;
  await savePage(href('/about/'), page({ title: `${ui.aboutTitle} · ${ui.siteName}`, description: ui.aboutDescription, route: '/about/', current: 'about', body: about }));
  await saveFile(href('/404.html'), page({ title: `${ui.notFoundTitle} · gescco`, description: ui.notFoundDescription, route: '/404.html', noindex: true, body: `<main id="main" class="not-found"><span class="eyebrow">404 / NOTE NOT FOUND</span><h1>${ui.notFoundHeading}</h1><p>${ui.notFoundText}</p><a class="text-link" href="${href('/notes/')}">${ui.backToNotes}</a></main>` }));
  await saveFile(href('/search-index.json'), JSON.stringify(notes.map(({ slug, title, category, categoryId, tags, summary, body }) => ({ slug, title, category, categoryId, tags, summary, body }))));
  const routes = ['/', '/notes/', '/about/', ...notes.map(n => `/notes/${n.slug}/`)];
  siteRoutes.push(...routes.map(route => ({ locale, route, localized: href(route) })));
  await saveFile(href('/feed.xml'), `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${escape(ui.siteName)}</title><link>${origin}${href('/')}</link><description>${escape(ui.feedDescription)}</description><language>${ui.rssLang}</language>${notes.map(n => `<item><title>${escape(n.title)}</title><link>${origin}${href(`/notes/${n.slug}/`)}</link><guid>${origin}${href(`/notes/${n.slug}/`)}</guid><description>${escape(n.summary)}</description><category>${escape(n.category)}</category><pubDate>${new Date(`${n.date}T00:00:00+09:00`).toUTCString()}</pubDate></item>`).join('')}</channel></rss>`);
}
const zhSlugs = versions.zh.map(n => n.slug).sort();
const enSlugs = versions.en.map(n => n.slug).sort();
if (JSON.stringify(zhSlugs) !== JSON.stringify(enSlugs)) throw new Error('Every note must have both Chinese and English versions');
for (const zh of versions.zh) {
  const en = versions.en.find(n => n.slug === zh.slug);
  if (zh.categoryId !== en.categoryId || zh.date !== en.date || zh.headings.length !== en.headings.length) throw new Error(`Translation metadata or section mismatch: ${zh.slug}`);
}
await saveFile('/sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${siteRoutes.map(({route,localized}) => `<url><loc>${origin}${localized}</loc><xhtml:link rel="alternate" hreflang="zh-CN" href="${origin}${route}"/><xhtml:link rel="alternate" hreflang="en" href="${origin}/en${route}"/><xhtml:link rel="alternate" hreflang="x-default" href="${origin}${route}"/></url>`).join('')}</urlset>`);
await saveFile('/robots.txt', `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`);
console.log(`Built ${versions.zh.length} bilingual notes, ${siteRoutes.length} pages, two RSS feeds, search indexes and sitemap → dist/`);
