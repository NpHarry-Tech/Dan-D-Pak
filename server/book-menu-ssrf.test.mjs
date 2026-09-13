import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import sharp from 'sharp';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-bookmenu-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const { migrate } = await import('./db.js');
migrate();
const BookMenu = await import('./services/bookMenu.js');

// BAO MAT (SSRF): import PubHTML5 khong duoc phep tai ve tu dia chi mang noi bo
// (localhost, LAN, hay metadata cloud 169.254.169.254) du nguoi dung nhap gi.
test('import PubHTML5 tu choi URL tro toi localhost/mang noi bo', async () => {
  await assert.rejects(
    () => BookMenu.importPubhtml5('http://127.0.0.1:1/x/', 'test', 'sala'),
    /mạng nội bộ/,
  );
});

test('import PubHTML5 tu choi metadata endpoint cua cloud', async () => {
  await assert.rejects(
    () => BookMenu.importPubhtml5('http://169.254.169.254/latest/meta-data/', 'test', 'sala'),
    /mạng nội bộ/,
  );
});

test('import PubHTML5 tu choi scheme khong phai http/https', async () => {
  await assert.rejects(
    () => BookMenu.importPubhtml5('file:///etc/passwd', 'test', 'sala'),
    /http\/https/,
  );
});

// BAO MAT (upload file ban / XSS luu tru): server "cong khai" (qua duoc vong
// chan SSRF vi day la IP that, khong phai mang noi bo) van co the tra ve NOI
// DUNG khong phai anh (vd HTML/script) trong config.js cua no. Phai chan o
// TANG NOI DUNG, khong chi tang URL. Dung IP that (khong phai localhost) de
// qua duoc assertPublicHttpUrl, roi gia lap fetch de khong thuc su goi mang.
const PUBLIC_IP_BASE = 'http://93.184.216.34/book/';
function fakeConfigResponse(pages) {
  const text = `var htmlConfig = ${JSON.stringify({ fliphtml5_pages: pages })};`;
  return { ok: true, text: async () => text, headers: { get: () => null } };
}
// 1x1 PNG hop le that su (de sharp/detectImageMime chap nhan) — dung sharp
// tao truc tiep thay vi go tay base64, tranh sai byte.
const TINY_PNG = await sharp({
  create: { width: 1, height: 1, channels: 3, background: { r: 10, g: 20, b: 30 } },
}).png().toBuffer();

test('import PubHTML5 tu choi noi dung khong phai anh du duoc dat ten .html', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('config.js')) return fakeConfigResponse([{ n: 'evil.html' }]);
    const evilHtml = Buffer.from('<script>alert(document.domain)</script>');
    return { ok: true, arrayBuffer: async () => evilHtml.buffer, headers: { get: () => null } };
  };
  try {
    await assert.rejects(
      () => BookMenu.importPubhtml5(PUBLIC_IP_BASE, 'test', 'sala'),
      /ảnh raster hợp lệ/,
    );
  } finally { globalThis.fetch = originalFetch; }
});

test('trang anh that duoc luu voi duoi .webp CO DINH, khong theo ten remote', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('config.js')) return fakeConfigResponse([{ n: 'page-one.html' }]);
    return { ok: true, arrayBuffer: async () => TINY_PNG.buffer, headers: { get: () => null } };
  };
  try {
    const result = await BookMenu.importPubhtml5(PUBLIC_IP_BASE, 'test', 'sala-2');
    const book = result.books.find((b) => b.id === result.activeBookId);
    assert.equal(book.pages.length, 1);
    assert.match(book.pages[0].src, /\.webp$/);
    assert.doesNotMatch(book.pages[0].src, /\.html/);
  } finally { globalThis.fetch = originalFetch; }
});
