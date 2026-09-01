// Shopee review flow (§1/§2/§7) — fail-closed khi CHƯA có Sandbox credential thật;
// KHÔNG dựng OAuth URL với placeholder. Có creds thật → URL builder + signature OK.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-shopee-guard-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = 'development';

const { migrate } = await import('./db.js');
migrate();
const ConnPlat = await import('./services/connectionPlatform.js');
const REDIRECT = 'https://api-review.dandpakpos.io.vn';

function startShopee() {
  return ConnPlat.startConnect('shopee', { branch_id: 'sala', user_id: 'tester', redirectBase: REDIRECT });
}

test('§2 placeholder credential → fail-closed SHOPEE_SANDBOX_NOT_CONFIGURED, KHÔNG dựng URL', () => {
  process.env.SHOPEE_PARTNER_ID = 'REPLACE_WITH_SANDBOX_PARTNER_ID';
  process.env.SHOPEE_PARTNER_KEY = 'REPLACE_WITH_SANDBOX_PARTNER_KEY';
  let err = null;
  try { startShopee(); } catch (e) { err = e; }
  assert.ok(err, 'phải ném lỗi khi credential còn placeholder');
  assert.equal(err.code, 'SHOPEE_SANDBOX_NOT_CONFIGURED');
});

test('§2 empty credential → fail-closed', () => {
  process.env.SHOPEE_PARTNER_ID = '';
  process.env.SHOPEE_PARTNER_KEY = '';
  let err = null;
  try { startShopee(); } catch (e) { err = e; }
  assert.equal(err?.code, 'SHOPEE_SANDBOX_NOT_CONFIGURED');
});

test('§7 credential thật → OAuth URL builder + signature + attempt nonce', () => {
  process.env.SHOPEE_PARTNER_ID = '2000123';
  process.env.SHOPEE_PARTNER_KEY = 'shpk_deadbeefcafe1234567890';
  const res = startShopee();
  assert.ok(res.attempt_id && res.attempt_id.startsWith('mpatt_'), 'phải tạo attempt nonce');
  assert.match(res.url, /partner_id=2000123/, 'URL phải chứa partner_id thật');
  assert.match(res.url, /sign=[0-9a-f]+/i, 'URL phải có chữ ký HMAC');
  assert.ok(!/REPLACE_WITH/.test(res.url), 'URL không được chứa placeholder');
});
