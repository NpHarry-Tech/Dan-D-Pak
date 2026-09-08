import test from 'node:test';
import assert from 'node:assert/strict';

import { errorPayload } from './core/errors.js';
import { sanitizeObject, sanitizeText, sanitizeUrl } from './core/redaction.js';

test('diagnostic text never exposes authorization or provider secrets', () => {
  const input = 'Authorization: Bearer abc.def.ghi apiKey=live-key password=hunter2 pin=1234';
  const out = sanitizeText(input);
  for (const secret of ['abc.def.ghi', 'live-key', 'hunter2', '1234']) {
    assert.equal(out.includes(secret), false);
  }
  assert.match(out, /REDACTED/);
});

test('nested diagnostic objects redact sensitive keys', () => {
  const out = sanitizeObject({
    ok: false,
    accessToken: 'provider-token',
    nested: { clientSecret: 'provider-secret', safe: 'business-code' },
  });
  assert.equal(out.accessToken, '[REDACTED]');
  assert.equal(out.nested.clientSecret, '[REDACTED]');
  assert.equal(out.nested.safe, 'business-code');
});

test('URLs retain route but redact signed/token query parameters', () => {
  const out = sanitizeUrl('/api/export?id=7&token=secret&signature=signed-value');
  assert.match(out, /^\/api\/export\?/);
  assert.equal(out.includes('secret'), false);
  assert.equal(out.includes('signed-value'), false);
});

test('500 error payload is generic and omits internal details', () => {
  const error = Object.assign(new Error('provider token=real-secret'), {
    status: 500,
    code: 'PROVIDER_FAILED',
    details: { authorization: 'Bearer real-secret' },
  });
  const payload = errorPayload(error, 'INTERNAL_ERROR');
  assert.equal(payload.message, 'Request failed');
  assert.equal('details' in payload, false);
  assert.equal(JSON.stringify(payload).includes('real-secret'), false);
});

test('unclassified implementation errors do not expose database paths', () => {
  const payload = errorPayload(new Error(
    'SQLITE_CANTOPEN: C:\\private\\tenant\\store.db token=db-secret'));
  assert.equal(payload.message, 'Request failed');
  assert.equal(JSON.stringify(payload).includes('store.db'), false);
  assert.equal(JSON.stringify(payload).includes('db-secret'), false);
});

test('4xx business details remain useful but are recursively sanitized', () => {
  const error = Object.assign(new Error('Approval token=do-not-show'), {
    status: 400,
    details: { field: 'approval', apiKey: 'do-not-show' },
  });
  const payload = errorPayload(error);
  assert.equal(payload.details.field, 'approval');
  assert.equal(payload.details.apiKey, '[REDACTED]');
  assert.equal(JSON.stringify(payload).includes('do-not-show'), false);
});

// orders.js/inventory.js/payments.js… ném `throw new Error('lý do')` KHÔNG gán
// .status ở HÀNG TRĂM chỗ — đây là quy ước chuẩn của codebase để báo lỗi
// nghiệp vụ, không phải sự cố hệ thống. Trước khi sửa, errorPayload từng coi
// MỌI Error không .status là "internal" và thay bằng "Request failed" chung
// chung, khiến người dùng không bao giờ biết lý do thật (vd hết hàng, order
// trống). Đây là bug đã gặp thực tế trên production, không được tái diễn.
test('plain business Error without .status reaches the client with its real message', () => {
  for (const msg of ['Order trống', 'Hết hàng: Cá Thu Chiên Sốt Cà (còn 0)', 'SKU không tồn tại: sku_123']) {
    const payload = errorPayload(new Error(msg));
    assert.equal(payload.message, msg);
    assert.equal(payload.error, msg);
    assert.equal(payload.code, 'BAD_REQUEST');
  }
});
