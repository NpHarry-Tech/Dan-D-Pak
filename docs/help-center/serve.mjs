import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT || 4173);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.csv': 'text/csv; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml' };

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.startsWith('/assets/help/')) {
      const asset = pathname.slice('/assets/help/'.length);
      pathname = ['app.js', 'content.js', 'content-operations.js', 'content-detail.js', 'styles.css'].includes(asset)
        ? `/${asset}`
        : `/assets/${asset}`;
    }
    let target = normalize(join(root, pathname.replace(/^\/+/, '')));
    if (!target.startsWith(root)) throw new Error('Invalid path');
    try {
      const info = await stat(target);
      if (info.isDirectory()) target = join(target, 'index.html');
      await stat(target);
    } catch {
      target = join(root, 'index.html');
    }
    const body = await readFile(target);
    res.writeHead(200, { 'content-type': mime[extname(target)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch (error) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`Dan D Pak Help Center: http://127.0.0.1:${port}/vi/`));
