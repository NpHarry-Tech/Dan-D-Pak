import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-lazada-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const { migrate } = await import('./db.js');
migrate();
const Settings = await import('./services/settings.js');
const Lazada = await import('./services/lazadaConnector.js');

const APP_KEY = '100001';
const APP_SECRET = 'lazada-app-secret';

test('ky TOP: prepend apiPath + ghep key+value sort, HMAC-SHA256 hex IN HOA', () => {
  const apiPath = '/orders/get';
  const params = {
    app_key: APP_KEY, sign_method: 'sha256', timestamp: '1700000000000',
    access_token: 'AT-9', created_after: '2026-08-01T00:00:00+07:00', sort_by: 'created_at',
  };
  // Tính độc lập theo đúng chuẩn TOP.
  const keys = Object.keys(params).sort();
  let base = apiPath;
  for (const k of keys) base += k + params[k];
  const expect = crypto.createHmac('sha256', APP_SECRET).update(base, 'utf8').digest('hex').toUpperCase();
  const got = Lazada.lazadaSign(apiPath, params, APP_SECRET);
  assert.equal(got, expect);
  assert.match(got, /^[0-9A-F]{64}$/); // hex hoa
});

test('sign bo qua field "sign" va gia tri rong', () => {
  const a = Lazada.lazadaSign('/x', { app_key: APP_KEY, timestamp: '1', sign: 'IGNORED', empty: '' }, APP_SECRET);
  const b = Lazada.lazadaSign('/x', { app_key: APP_KEY, timestamp: '1' }, APP_SECRET);
  assert.equal(a, b);
});

test('auth-link tro dung Lazada oauth authorize voi client_id', () => {
  Settings.updateIntegrations({ channels: { lazada: { enabled: true, environment: 'production',
    appId: APP_KEY, secretKey: APP_SECRET } } }, 'sala');
  const link = Lazada.lazadaAuthLink('sala', 'https://x/auth/lazada/callback');
  const u = new URL(link);
  assert.equal(u.host, 'auth.lazada.com');
  assert.equal(u.searchParams.get('client_id'), APP_KEY);
  assert.equal(u.searchParams.get('response_type'), 'code');
});

test('capability chuyen trang thai theo credential, khong gia vo da ket noi', () => {
  // Bat dau lai o chi nhanh khac de trang thai sach.
  let cap = Lazada.lazadaCapabilities('br1');
  assert.equal(cap.status, 'pending_credentials');

  Settings.updateIntegrations({ channels: { lazada: { enabled: true, appId: APP_KEY, secretKey: APP_SECRET } } }, 'br1');
  cap = Lazada.lazadaCapabilities('br1');
  assert.equal(cap.configured, true);
  assert.equal(cap.status, 'pending_authorization');

  Settings.updateIntegrations({ channels: { lazada: { accessToken: 'AT-1', sellerId: '777' } } }, 'br1');
  cap = Lazada.lazadaCapabilities('br1');
  assert.equal(cap.authorized, true);
  assert.equal(cap.status, 'active');
});
