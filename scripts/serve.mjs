import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const dir = path.resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const port = Number(process.env.PORT || 4173);
const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.xml':'application/xml; charset=utf-8','.txt':'text/plain; charset=utf-8'};
createServer(async (req,res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let file = path.resolve(dir, `.${decodeURIComponent(url.pathname)}`);
    if (file !== dir && !file.startsWith(dir + path.sep)) { res.writeHead(403); res.end(); return; }
    let info;
    try { info = await stat(file); } catch {}
    if (info?.isDirectory()) {
      if (!url.pathname.endsWith('/')) { res.writeHead(301, {Location: url.pathname + '/' + url.search}); res.end(); return; }
      file = path.join(file, 'index.html');
    }
    let data, status = 200;
    try { data = await readFile(file); } catch { data = await readFile(path.join(dir, '404.html')); status = 404; file = '404.html'; }
    res.writeHead(status, {'Content-Type':types[path.extname(file)] || 'application/octet-stream','X-Content-Type-Options':'nosniff'});
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch { res.writeHead(400); res.end('Bad request'); }
}).listen(port, '127.0.0.1', () => console.log(`Preview: http://127.0.0.1:${port}`));
