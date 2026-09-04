// HARAVAN subscribe thất bại phải ĐIỀU TRA ĐƯỢC (Gate-8/S13). Sự cố 2026-09-04:
// "Nhận từ Haravan • 1" đỏ mà không rõ HTTP status/nguyên nhân. Trước đây lỗi
// chỉ bong lên dạng message; nay ghi chẩn đoán CÓ CẤU TRÚC (status/endpoint/
// haravan_message/latency, KHÔNG token) vào sync_logs và gắn vào error.diagnostic.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-haravan-diag-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = process.env.DATA_ENCRYPTION_KEY
  || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
// Token bí mật để chứng minh KHÔNG lọt vào chẩn đoán.
process.env.HARAVAN_ACCESS_TOKEN = 'SECRET_TOKEN_MUST_NOT_LEAK';

const { migrate, db } = await import('./db.js');
migrate();
const Haravan = await import('./services/haravanConnector.js');

const SAFE_KEYS = ['endpoint', 'haravan_code', 'haravan_message', 'http_status',
  'latency_ms', 'method', 'shop_domain', 'stage'];

test('subscribe 401 → ném kèm diagnostic CÓ CẤU TRÚC, KHÔNG lộ token', async () => {
  globalThis.fetch = async () => ({
    ok: false,
    status: 401,
    json: async () => ({ error: true, message: 'access token expired', code: 'unauthorized' }),
  });

  let caught;
  try { await Haravan.subscribeWebhook('demo-shop.myharavan.com'); }
  catch (e) { caught = e; }

  assert.ok(caught, 'phải ném lỗi');
  const d = caught.diagnostic;
  assert.ok(d, 'phải có diagnostic');
  assert.equal(d.stage, 'http');
  assert.equal(d.http_status, 401);
  assert.equal(d.method, 'POST');
  assert.equal(d.haravan_message, 'access token expired');
  assert.equal(d.haravan_code, 'unauthorized');
  assert.equal(d.shop_domain, 'demo-shop.myharavan.com');
  assert.equal(typeof d.latency_ms, 'number');
  assert.ok(String(d.endpoint).includes('webhook.haravan.com/api/subscribe'));
  // REDACTION: đúng bộ khóa an toàn, không có header/authorization/token value.
  assert.deepEqual(Object.keys(d).sort(), [...SAFE_KEYS].sort());
  const blob = JSON.stringify(d).toLowerCase();
  assert.ok(!blob.includes('bearer'), 'không được có "bearer"');
  assert.ok(!blob.includes('authorization'), 'không được có header authorization');
  assert.ok(!JSON.stringify(d).includes('SECRET_TOKEN_MUST_NOT_LEAK'), 'token TUYỆT ĐỐI không lọt');
});

test('ghi sync_logs status=failed kèm raw_payload chẩn đoán (redacted)', async () => {
  globalThis.fetch = async () => ({
    ok: false, status: 403,
    json: async () => ({ error: true, message: 'insufficient scope' }),
  });
  try { await Haravan.subscribeWebhook('demo-shop.myharavan.com'); } catch { /* expected */ }
  const row = db.prepare(
    `SELECT status,topic,raw_payload FROM sync_logs WHERE topic='webhook/subscribe' ORDER BY created_at DESC, rowid DESC LIMIT 1`).get();
  assert.ok(row, 'phải có dòng sync_logs');
  assert.equal(row.status, 'failed');
  const payload = JSON.parse(row.raw_payload);
  assert.equal(payload.http_status, 403);
  assert.ok(!JSON.stringify(payload).includes('SECRET_TOKEN_MUST_NOT_LEAK'));
});

test('lỗi mạng (DNS/TLS) → diagnostic stage=network, có cause', async () => {
  globalThis.fetch = async () => {
    throw Object.assign(new Error('getaddrinfo ENOTFOUND webhook.haravan.com'), { code: 'ENOTFOUND' });
  };
  let caught;
  try { await Haravan.subscribeWebhook('demo-shop.myharavan.com'); } catch (e) { caught = e; }
  assert.ok(caught?.diagnostic);
  assert.equal(caught.diagnostic.stage, 'network');
  assert.equal(caught.diagnostic.cause, 'ENOTFOUND');
  assert.equal(caught.diagnostic.shop_domain, 'demo-shop.myharavan.com');
});
