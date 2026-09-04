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
const OWNER = 'Nguyễn Phúc Huy';
const EMAIL = 'nguyenphuchuy263@gmail.com';
const VI_ADDRESS = 'Căn 00.08, tòa Sarimi A1, số 74 đường Nguyễn Cơ Thạch';
const EN_ADDRESS = 'Apartment 00.08, Sarimi A1 Building, 74 Nguyen Co Thach Street';
const FORBIDDEN = /owner-to-provide|OWNER_TO_PROVIDE|example\.com|contact@example|TODO|TBD|placeholder|TO BE PROVIDED|Chủ dự án cung cấp/i;

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
    const idx = await get(port, '/');
    assert.equal(idx.status, 200, 'index route must return 200');
    assert.ok(idx.body.trim().length > 400, 'index must have non-empty content');
    for (const p of PAGES) {
      const res = await get(port, '/' + p);
      assert.equal(res.status, 200, `${p} must return 200`);
      assert.ok(res.body.trim().length > 400, `${p} must have non-empty content`);
      assert.match(res.body, /<title>[^<]+<\/title>/, `${p} must have a title`);
    }
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
    assert.ok(html.includes(OWNER), `${p} names the responsible operator`);
    assert.ok(html.includes(EMAIL), `${p} has the official contact email`);
    assert.match(html, /mailto:nguyenphuchuy263@gmail\.com/, `${p} has a valid email link`);
    assert.ok(html.includes(VI_ADDRESS) || html.includes(EN_ADDRESS), `${p} has the official address`);
    assert.doesNotMatch(html, FORBIDDEN, `${p} has no legal placeholder or sample contact`);
    assert.doesNotMatch(html, /bcmarketing[\s\S]{0,80}(legal entity|operator|data controller)/i,
      `${p} does not identify bcmarketing as the responsible entity`);
  }
});

test('index uses bilingual legal links and contains no conflicting legal identity', () => {
  const html = readFileSync(join(PORTAL, 'index.html'), 'utf8');
  for (const label of ['Privacy Policy / Chính sách quyền riêng tư',
    'Terms of Service / Điều khoản dịch vụ', 'Data Deletion / Xóa dữ liệu']) {
    assert.ok(html.includes(label), `index contains bilingual label: ${label}`);
  }
  assert.doesNotMatch(html, FORBIDDEN, 'index has no legal placeholder or sample contact');
  assert.doesNotMatch(html, /bcmarketing[\s\S]{0,80}(legal entity|operator|data controller)/i,
    'index does not identify bcmarketing as the responsible entity');
});
