// Step 2 multi-device P0 — A/B/C RACE MATRIX qua ROUTE HANDLER THẬT (không chỉ
// service). Đăng ký registerRetailRoutes với middleware mock, bắt handler thật
// rồi drive qua đúng code route (cartDevice/branch/uid + gọi service).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const temp = mkdtempSync(join(tmpdir(), 'ddp-mdhttp-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.DISABLE_DEMO_SEED = 'true';

const { migrate } = await import('./db.js');
const Auth = await import('./services/auth.js');
const Inv = await import('./services/inventory.js');
const { registerRetailRoutes } = await import('./modules/retail/routes.js');
migrate();
// §3: ADD_LINE định giá server-authoritative → cần SKU thật.
for (const [id, price] of [['s1', 1000], ['s', 500]]) {
  Inv.createSku({ id, name: id.toUpperCase(), barcode: 'B_' + id, category: 'X', price, stock: 1000 }, 'sala');
}

const routes = {};
const cap = (m) => (p, ...h) => { routes[`${m} ${p}`] = h[h.length - 1]; };
const api = { get: cap('GET'), post: cap('POST'), put() {}, delete: cap('DELETE'), use() {}, patch() {}, all() {} };
registerRetailRoutes(api, {
  wrap: (fn) => fn,
  guard: () => (_q, _s, n) => n && n(),
  guardAny: () => (_q, _s, n) => n && n(),
  branch: (req) => req.__branch || 'sala',
  visibleBranch: (req) => req.__branch || 'sala',
  actor: (req) => req.user?.username || 'system',
  applyManualConfirm: () => null,
  assertBillEditable: () => null,
});

// Gọi handler route thật.
function call(key, { params = {}, body = {}, user = { id: 'u1', username: 'cashier', name: 'Thu ngân', role: 'cashier' }, branch = 'sala' } = {}) {
  const h = routes[key];
  if (!h) throw new Error(`route không tồn tại: ${key}`);
  return h({ params, body, user, __branch: branch, headers: {}, get: () => null });
}
const create = (device, branch = 'sala') => call('POST /retail/orders', { body: { device }, branch });
const command = (id, body, branch = 'sala') => call('POST /retail/orders/:id/command', { params: { id }, body, branch });
const lease = (id, device, branch = 'sala') => call('POST /retail/orders/:id/lease', { params: { id }, body: { device }, branch });
const lock = (id, device, key, branch = 'sala') => call('POST /retail/orders/:id/checkout/lock', { params: { id }, body: { device, idempotency_key: key }, branch });
const canonical = (id, branch = 'sala') => call('GET /retail/orders/:id', { params: { id }, branch });

let cc = 0; const cid = () => `h${++cc}`;

test('HTTP: A+B tạo order → khác order_id + khác display_sequence', () => {
  const a = create('A'); const b = create('B');
  assert.notEqual(a.order_id, b.order_id);
  assert.notEqual(a.display_sequence, b.display_sequence);
});

test('HTTP: 5 thiết bị tạo đồng loạt → display_sequence KHÔNG trùng', () => {
  const seqs = [];
  for (const d of ['d1', 'd2', 'd3', 'd4', 'd5']) seqs.push(create(d).display_sequence);
  assert.equal(new Set(seqs).size, 5);
});

test('HTTP: A giữ lease, B mở → holder=A', () => {
  const a = create('A');
  const b = lease(a.order_id, 'B');
  assert.equal(b.granted, false);
  assert.equal(b.holder.device, 'A');
});

test('HTTP: stale revision CHANGE_QTY → 409 ORDER_VERSION_CONFLICT', () => {
  const a = create('A');
  const r1 = command(a.order_id, { command_id: cid(), expected_revision: 0, lease_token: a.lease_token, device: 'A', command: 'ADD_LINE', payload: { sku_id: 's1', unit_price: 1000, qty: 1 } });
  assert.equal(r1.revision, 1);
  const line = r1.snapshot.lines[0].line_id;
  command(a.order_id, { command_id: cid(), expected_revision: 1, lease_token: a.lease_token, device: 'A', command: 'CHANGE_QTY', payload: { line_id: line, qty: 2 } });
  assert.throws(
    () => command(a.order_id, { command_id: cid(), expected_revision: 1, lease_token: a.lease_token, device: 'A', command: 'CHANGE_QTY', payload: { line_id: line, qty: 9 } }),
    (e) => e.code === 'ORDER_VERSION_CONFLICT');
});

test('HTTP: A checkout → mutation của B bị chặn ORDER_ALREADY_CHECKING_OUT', () => {
  const a = create('A');
  lock(a.order_id, 'A', 'ka');
  assert.throws(
    () => command(a.order_id, { command_id: cid(), expected_revision: 0, lease_token: a.lease_token, device: 'A', command: 'SET_NOTE', payload: { note: 'x' } }),
    (e) => e.code === 'ORDER_ALREADY_CHECKING_OUT');
});

test('HTTP: A/B/C cùng checkout → đúng 1 finalizer', () => {
  const a = create('A');
  let wins = 0;
  for (const [d, k] of [['A', 'k1'], ['B', 'k2'], ['C', 'k3']]) {
    try { const r = lock(a.order_id, d, k); if (r.granted && !r.idempotent) wins++; }
    catch (e) { assert.equal(e.code, 'ORDER_ALREADY_CHECKING_OUT'); }
  }
  assert.equal(wins, 1);
});

test('HTTP: double-click Pay cùng command_id → idempotent', () => {
  const a = create('A');
  const r1 = lock(a.order_id, 'A', 'same');
  const r2 = lock(a.order_id, 'A', 'same');
  assert.equal(r1.granted, true);
  assert.equal(r2.idempotent, true);
});

test('HTTP: command_id trùng → idempotent, không áp 2 lần', () => {
  const a = create('A');
  const body = { command_id: 'dup', expected_revision: 0, lease_token: a.lease_token, device: 'A', command: 'ADD_LINE', payload: { sku_id: 's', unit_price: 500, qty: 2 } };
  command(a.order_id, body);
  const r2 = command(a.order_id, body);
  assert.equal(r2.idempotent, true);
  assert.equal(canonical(a.order_id).snapshot.lines[0].qty, 2);
});

test('HTTP: cross-branch không đọc/sửa được order', () => {
  const a = create('A', 'sala');
  assert.throws(() => canonical(a.order_id, 'br-other'), (e) => e.code === 'ORDER_NOT_FOUND');
  assert.throws(
    () => command(a.order_id, { command_id: cid(), expected_revision: 0, lease_token: a.lease_token, device: 'A', command: 'SET_NOTE', payload: { note: 'q' } }, 'br-other'),
    (e) => e.code === 'ORDER_NOT_FOUND');
});

test('HTTP: takeover THIẾU quyền → 403 TAKEOVER_APPROVAL_REQUIRED', () => {
  const a = create('A');
  assert.throws(
    () => call('POST /retail/orders/:id/lease/takeover', { params: { id: a.order_id }, body: { device: 'B' }, user: { id: 'u2', username: 'c2', role: 'cashier' } }),
    (e) => e.status === 403 && e.code === 'TAKEOVER_APPROVAL_REQUIRED');
});
