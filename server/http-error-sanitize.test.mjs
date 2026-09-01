// §4.4/§6.4 — errorHandler KHÔNG để lỗi SQLite thô lọt ra client; lỗi nghiệp vụ
// (có e.code/e.status) giữ nguyên.
import test from 'node:test';
import assert from 'node:assert/strict';
import { errorHandler } from './core/http.js';

function fakeRes() {
  return {
    _status: 0, _json: null, headersSent: false,
    status(s) { this._status = s; return this; },
    json(j) { this._json = j; return this; },
  };
}
const req = { method: 'POST', originalUrl: '/api/retail/checkout' };
const run = (err) => { const res = fakeRes(); errorHandler(err, req, res, () => {}); return res; };

test('UNIQUE constraint thô → 409 DATA_CONFLICT, KHÔNG lộ chi tiết SQLite', () => {
  const res = run(new Error('UNIQUE constraint failed: orders.branch_id, orders.pay_ref'));
  assert.equal(res._status, 409);
  assert.equal(res._json.code, 'DATA_CONFLICT');
  assert.doesNotMatch(res._json.message, /UNIQUE|constraint|pay_ref|SQLITE/i);
  assert.doesNotMatch(res._json.error, /UNIQUE|constraint|pay_ref|SQLITE/i);
});

test('no such table → 500 INTERNAL_ERROR, message sạch', () => {
  const res = run(new Error('SQLITE_ERROR: no such table: orders_x'));
  assert.equal(res._status, 500);
  assert.equal(res._json.code, 'INTERNAL_ERROR');
  assert.doesNotMatch(res._json.message, /SQLITE|no such table|orders_x/i);
});

test('lỗi NGHIỆP VỤ (e.code + e.status) giữ nguyên', () => {
  const e = Object.assign(new Error('Đơn đã thanh toán.'), { code: 'ORDER_FINALIZED', status: 409 });
  const res = run(e);
  assert.equal(res._status, 409);
  assert.equal(res._json.code, 'ORDER_FINALIZED');
  assert.match(res._json.message, /thanh toán/i);
});

test('lỗi nghiệp vụ 400 thường đi qua errorPayload (giữ message)', () => {
  const e = Object.assign(new Error('Giỏ hàng trống'), { status: 400 });
  const res = run(e);
  assert.equal(res._status, 400);
  assert.match(res._json.error, /trống/i);
});
