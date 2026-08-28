import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-shopee-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const { migrate } = await import('./db.js');
migrate();
const Settings = await import('./services/settings.js');
const Shopee = await import('./services/shopeeConnector.js');

const PARTNER_ID = '2001';
const PARTNER_KEY = 'test-partner-key';
const SHOP_ID = '55501';

test('capability chuyen trang thai theo credential thuc te, khong gia vo da ket noi', () => {
  let cap = Shopee.shopeeCapabilities('sala');
  assert.equal(cap.configured, false);
  assert.equal(cap.status, 'pending_credentials');

  Settings.updateIntegrations({ channels: { shopee: { enabled: true, environment: 'production',
    partnerId: PARTNER_ID, secretKey: PARTNER_KEY } } }, 'sala');
  cap = Shopee.shopeeCapabilities('sala');
  assert.equal(cap.configured, true);
  assert.equal(cap.authorized, false);
  assert.equal(cap.status, 'pending_authorization');

  Settings.updateIntegrations({ channels: { shopee: { shopId: SHOP_ID, accessToken: 'AT-123' } } }, 'sala');
  cap = Shopee.shopeeCapabilities('sala');
  assert.equal(cap.authorized, true);
  assert.equal(cap.status, 'active');
});

test('auth-link ky dung chuan public (partner_id + path + timestamp)', () => {
  const link = Shopee.shopeeAuthLink('sala', 'https://x/auth/shopee/callback');
  const u = new URL(link);
  assert.equal(u.pathname, '/api/v2/shop/auth_partner');
  const ts = u.searchParams.get('timestamp');
  const expect = crypto.createHmac('sha256', PARTNER_KEY)
    .update(`${PARTNER_ID}/api/v2/shop/auth_partner${ts}`).digest('hex');
  assert.equal(u.searchParams.get('sign'), expect);
  assert.equal(u.searchParams.get('partner_id'), PARTNER_ID);
});

test('push chu ky HMAC(url|body) hop le duoc chap nhan; sai chu ky bi tu choi', async () => {
  const url = 'https://api.example.com/webhooks/shopee';
  // code != 3 → khong goi mang, chi kiem tra chu ky + dedup nghiep vu.
  const body = JSON.stringify({ shop_id: SHOP_ID, code: 1, data: { note: 'shop_authorization' } });
  const good = crypto.createHmac('sha256', PARTNER_KEY).update(`${url}|${body}`).digest('hex');

  const ok = await Shopee.handleShopeePush(Buffer.from(body), { authorization: good }, [url]);
  assert.equal(ok.accepted, true);
  assert.equal(ok.code, 1);

  await assert.rejects(
    () => Shopee.handleShopeePush(Buffer.from(body), { authorization: 'deadbeef' }, [url]),
    (e) => e.status === 401);
});

test('push body-only signature cung duoc chap nhan (fallback)', async () => {
  const body = JSON.stringify({ shop_id: SHOP_ID, code: 1 });
  const bodyOnly = crypto.createHmac('sha256', PARTNER_KEY).update(body).digest('hex');
  const ok = await Shopee.handleShopeePush(Buffer.from(body), { authorization: bodyOnly }, ['https://any/x']);
  assert.equal(ok.accepted, true);
});
