import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { safeEqual } from './core/util.js';
import { decryptBytes, encryptBytes, encryptSecret, decryptSecret } from './core/crypto.js';
import { newToken, tokenDigest } from './services/pin.js';
import {
  currentRequestMetadata,
  requestContextMiddleware,
} from './core/requestContext.js';

test('webhook secrets use timing-safe comparison and document uploads deduplicate by content', () => {
  assert.equal(safeEqual('same-secret', 'same-secret'), true);
  assert.equal(safeEqual('same-secret', 'wrong-secret'), false);

  const payments = fs.readFileSync(new URL('./services/payments.js', import.meta.url), 'utf8');
  for (const secret of ['cfg.apiKey', 'cfg.webhookSecret', 'cfg.username']) {
    assert.match(payments, new RegExp(`safeEqual\\([^\\n]+${secret.replace('.', '\\.')}`));
  }

  const documents = fs.readFileSync(new URL('./modules/documents/routes.js', import.meta.url), 'utf8');
  assert.match(documents, /createHash\('sha256'\)/);
  assert.match(documents, /content_hash=\?/);
});

test('server secrets use authenticated encryption and session tokens are not stored raw', () => {
  process.env.DATA_ENCRYPTION_KEY =
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const encrypted = encryptSecret('sensitive-value', 'security-test');
  assert.equal(encrypted.includes('sensitive-value'), false);
  assert.equal(decryptSecret(encrypted, 'security-test'), 'sensitive-value');
  assert.throws(() => decryptSecret(encrypted, 'wrong-context'));
  const encryptedFile = encryptBytes(Buffer.from('database-bytes'), 'backup-test');
  assert.equal(decryptBytes(encryptedFile, 'backup-test').toString(), 'database-bytes');
  assert.throws(() => decryptBytes(encryptedFile, 'wrong-context'));

  const token = newToken();
  const digest = tokenDigest(token);
  assert.match(token, /^tk_[0-9a-f]{48}$/);
  assert.match(digest, /^sha256\$[0-9a-f]{64}$/);
  assert.equal(digest.includes(token), false);
});

test('request audit context keeps complete device metadata', () => {
  const headers = {
    'x-device-id': 'dev_tablet_1',
    'x-device-name': 'SM-T225',
    'x-app-version': '2026.07.23.2',
    'x-build-number': '31',
    'x-platform': 'android',
    'x-os-version': 'Android 13',
    'x-correlation-id': 'co_test',
  };
  requestContextMiddleware({ headers }, {}, () => {
    assert.deepEqual(currentRequestMetadata(), {
      device_id: 'dev_tablet_1',
      device_name: 'SM-T225',
      app_version: '2026.07.23.2',
      build_number: '31',
      platform: 'android',
      os_version: 'Android 13',
      correlation_id: 'co_test',
    });
  });
});

test('cancel order item stays behind the sell permission guard', () => {
  const routes = fs.readFileSync(new URL('./modules/orders/routes.js', import.meta.url), 'utf8');
  assert.match(routes, /api\.post\('\/orders\/items\/:id\/cancel', guard\('sell'\)/);
});

test('creating products requires the dedicated warehouse item permission', () => {
  const routes = fs.readFileSync(new URL('./modules/inventory/routes.js', import.meta.url), 'utf8');
  assert.match(routes, /api\.post\('\/skus', guard\('warehouse\.item'\)/);
  assert.match(routes, /api\.post\('\/skus\/image-upload', guard\('warehouse\.item'\)/);
});
