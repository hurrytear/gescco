import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const out = fileURLToPath(new URL('../dist/', import.meta.url));
const files = [];
async function walk(dir) { for (const entry of await readdir(dir, {withFileTypes:true})) { const p = path.join(dir,entry.name); if(entry.isDirectory()) await walk(p); else files.push(p); } }
await walk(out);
let links = 0;
for (const file of files.filter(f=>f.endsWith('.html'))) {
  const html = await readFile(file,'utf8');
  assert.match(html, /<html lang="zh-CN">/);
  assert.match(html, /<meta name="description" content="[^"]+">/);
  assert.match(html, /<link rel="canonical" href="https:\/\/gescco.com\//);
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
const notes = JSON.parse(await readFile(path.join(out,'search-index.json'),'utf8'));
assert.equal(new Set(notes.map(n=>n.slug)).size, notes.length);
for(const n of notes) {
  assert.ok(n.body.includes('## 参考资料'), `${n.slug}: missing references`);
  assert.ok(n.body.length > 700, `${n.slug}: insufficient content`);
  assert.ok(!/taou\.com|maimai\.feishu|BEGIN .*PRIVATE KEY|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]+/.test(n.body), `${n.slug}: private data pattern`);
}
console.log(`Checked ${files.filter(f=>f.endsWith('.html')).length} HTML pages, ${links} local links, ${notes.length} substantive notes, anchors and metadata.`);
