// Tem vận đơn KHÔNG còn bắt buộc máy in tem cấu hình sẵn: client tự lấy dữ
// liệu thuần (buildShippingLabelPayload / GET /print/shipping-label-data) rồi
// tự dựng PDF + gọi hộp thoại in hệ điều hành. Test này bắt lại đúng 2 việc:
// (1) dữ liệu thuần trả đúng, không cần máy in; (2) đường in-qua-hàng-đợi CŨ
// (POST /print/shipping-label, dành cho chi nhánh có máy in tem vật lý) vẫn
// giữ nguyên hành vi cũ (NO_GO khi chưa cấu hình máy in) — không đổi behavior.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

process.env.SQLITE_PATH = join(mkdtempSync(join(tmpdir(), 'ddp-label-')), 'store.db');
process.env.STORAGE_PATH = join(tmpdir(), 'label-store');

const { db, migrate } = await import('./db.js');
const Print = await import('./services/printing.js');
const { registerPrintingRoutes } = await import('./modules/printing/routes.js');
migrate();

const B = 'sala';
db.prepare(`INSERT INTO orders(id,branch_id,channel,status,total,created_at,online_channel,online_ref,customer_json)
  VALUES('ord1',?,'online','pending',250000,datetime('now'),'website','WEB-1', ?)`)
  .run(B, JSON.stringify({ name: 'Nguyen Van A', phone: '0900000000', address: '123 Le Loi', note: 'Giao gio hanh chinh' }));
db.prepare(`INSERT INTO order_items(id,order_id,name,qty,unit_price,created_at) VALUES('it1','ord1','Hat dieu rang muoi',2,125000,datetime('now'))`).run();
db.prepare(`INSERT INTO external_orders(id,provider,external_order_id,internal_order_id,external_order_code,created_at)
  VALUES('ext1','website','w1','ord1','WEB-1',datetime('now'))`).run();

test('buildShippingLabelPayload: du lieu thuan dung, khong dung den may in', () => {
  const payload = Print.buildShippingLabelPayload(B, 'ord1', '100x150');
  assert.equal(payload.orderCode, 'WEB-1');
  assert.equal(payload.receiver.name, 'Nguyen Van A');
  assert.equal(payload.receiver.phone, '0900000000');
  assert.equal(payload.codAmount, 250000);
  assert.equal(payload.paperWidthMm, 100);
  assert.deepEqual(payload.items, [{ name: 'Hat dieu rang muoi', qty: 2 }]);
});

test('buildShippingLabelPayload: khong tim thay don thi bao loi ro, khong throw mo ho', () => {
  assert.throws(() => Print.buildShippingLabelPayload(B, 'khong-ton-tai'), /Không tìm thấy/);
});

const routes = new Map();
const api = {
  get(path, ...handlers) { routes.set(`GET ${path}`, handlers[handlers.length - 1]); },
  post(path, ...handlers) { routes.set(`POST ${path}`, handlers[handlers.length - 1]); },
};
registerPrintingRoutes(api, {
  wrap: (handler) => handler,
  guardAny: () => (req, res, next) => next(),
  branch: (req) => req.branch_id || B,
  actor: () => 'tester',
});

test('route GET /print/shipping-label-data: tra ve dung payload, khong doi hang doi may in', () => {
  const result = routes.get('GET /print/shipping-label-data')({
    query: { order_id: 'ord1', size: '76x130' }, branch_id: B,
  });
  assert.equal(result.orderCode, 'WEB-1');
  assert.equal(result.paperWidthMm, 76);
});

test('route POST /print/shipping-label (duong cu, may in vat ly): van hoat dong binh thuong sau khi tach buildShippingLabelPayload', () => {
  const result = routes.get('POST /print/shipping-label')({ body: { order_id: 'ord1' }, branch_id: B, headers: {}, query: {} });
  assert.equal(result.ok, true);
  assert.equal(result.jobs, 1);
});
