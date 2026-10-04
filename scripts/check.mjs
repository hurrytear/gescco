import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { locales } from './i18n.mjs';
const out = fileURLToPath(new URL('../dist/', import.meta.url));
const files = [];
async function walk(dir) { for (const entry of await readdir(dir, {withFileTypes:true})) { const p = path.join(dir,entry.name); if(entry.isDirectory()) await walk(p); else files.push(p); } }
await walk(out);
let links = 0;
for (const file of files.filter(f=>f.endsWith('.html'))) {
  const html = await readFile(file,'utf8');
  const locale = path.relative(out,file).startsWith(`en${path.sep}`) ? 'en' : 'zh';
  assert.ok(html.includes(`<html lang="${locales[locale].lang}">`), `Wrong document language in ${file}`);
  assert.match(html, /<meta name="description" content="[^"]+">/);
  assert.match(html, /<link rel="canonical" href="https:\/\/gescco.com\//);
  for (const language of ['zh-CN', 'en', 'x-default']) {
    const alternate = html.match(new RegExp(`<link rel="alternate" hreflang="${language}" href="([^\"]+)"`));
    assert.ok(alternate, `Missing language alternate ${language} in ${file}`);
    const route = new URL(alternate[1]).pathname;
    assert.ok((await stat(path.join(out, route, route.endsWith('/') ? 'index.html' : ''))).isFile(), `Missing translation target ${route}`);
  }
  if (locale === 'en') {
    const visible = html.replace(/<[^>]*>/g, '').replaceAll('中文', '');
    assert.ok(!/[\u3400-\u9fff]/u.test(visible), `Untranslated visible text in ${file}`);
  }
  assert.ok(!/<(?:script|style)\b[^>]*>(?!<\/script>)/.test(html), `Unexpected inline code: ${file}`);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(ids.length, new Set(ids).size, `Duplicate IDs in ${file}`);
  for (const match of html.matchAll(/(?:href|src)="([^\"]+)"/g)) {
    const target = match[1].split('?')[0];
    if(target.startsWith('#')) { assert.ok(ids.includes(target.slice(1)), `Missing anchor ${target}`); continue; }
    if(!target.startsWith('/')) continue;
    let p = path.join(out,target);
    if(target.endsWith('/')) p = path.join(p,'index.html');
    assert.ok((await stat(p)).isFile(), `Missing target ${target}`); links++;
  }
}
const versions = {};
for (const [locale, ui] of Object.entries(locales)) {
  const notes = JSON.parse(await readFile(path.join(out,ui.prefix,'search-index.json'),'utf8'));
  versions[locale] = notes;
  assert.equal(new Set(notes.map(n=>n.slug)).size, notes.length);
  for(const n of notes) {
    assert.ok(n.body.includes(`## ${ui.references}`), `${locale}/${n.slug}: missing references`);
    assert.ok(n.body.length > 700, `${locale}/${n.slug}: insufficient content`);
    assert.ok(!/taou\.com|maimai\.feishu|BEGIN .*PRIVATE KEY|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]+/.test(n.body), `${locale}/${n.slug}: private data pattern`);
  }
}
const executableBlocks = body => [...body.matchAll(/```(\w+)\n([\s\S]*?)```/g)].filter(m=>m[1] !== 'text').map(m=>m[2].split('\n').filter(line=>!line.trim().startsWith('#')).join('\n'));
const referenceUrls = body => [...body.matchAll(/\]\((https:\/\/[^\s)]+)\)/g)].map(m=>m[1]).sort();
for (const zh of versions.zh) {
  const en = versions.en.find(n=>n.slug === zh.slug);
  assert.ok(en, `Missing English translation: ${zh.slug}`);
  assert.deepEqual(executableBlocks(en.body), executableBlocks(zh.body), `Translated commands differ: ${zh.slug}`);
  assert.deepEqual(referenceUrls(en.body), referenceUrls(zh.body), `Translated references differ: ${zh.slug}`);
}
console.log(`Checked ${files.filter(f=>f.endsWith('.html')).length} HTML pages, ${links} local links, ${versions.zh.length} complete translation pairs, command parity, language metadata and anchors.`);
