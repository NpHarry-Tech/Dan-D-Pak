// #6 — Shopee review portal legal pages: privacy-policy / terms-of-service /
// data-deletion must serve HTTP 200 with non-empty content, and index.html must
// link to all three. Serves deploy/review/portal statically (as nginx/Caddy would).
import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const PORTAL = fileURLToPath(new URL('../deploy/review/portal', import.meta.url));
const PAGES = ['privacy-policy.html', 'terms-of-service.html', 'data-deletion.html'];

function serve() {
  return http.createServer((req, res) => {
    const name = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, '') || 'index.html';
    if (name.includes('..')) { res.statusCode = 400; return res.end('bad'); }
    const file = join(PORTAL, name);
    if (!existsSync(file)) { res.statusCode = 404; return res.end('not found'); }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(readFileSync(file));
  });
}

function get(port, path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

test('legal pages serve HTTP 200 with non-empty content; index links all three', async () => {
  const srv = serve();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  try {
    for (const p of PAGES) {
      const res = await get(port, '/' + p);
      assert.equal(res.status, 200, `${p} must return 200`);
      assert.ok(res.body.trim().length > 400, `${p} must have non-empty content`);
      assert.match(res.body, /<title>[^<]+<\/title>/, `${p} must have a title`);
    }
    const idx = await get(port, '/index.html');
    assert.equal(idx.status, 200);
    for (const p of PAGES) {
      assert.match(idx.body, new RegExp(`href=["']${p}["']`), `index must link ${p}`);
    }
  } finally {
    await new Promise((r) => srv.close(r));
  }
});

test('legal pages exist on disk and are bilingual (vi + en markers)', () => {
  for (const p of PAGES) {
    const file = join(PORTAL, p);
    assert.ok(existsSync(file), `${p} exists`);
    const html = readFileSync(file, 'utf8');
    assert.ok(html.includes('Dan-D Pak POS'), `${p} names the product`);
    assert.match(html, /class="en"/, `${p} has English section markers`);
  }
});
