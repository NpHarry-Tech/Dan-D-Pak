// §1 — Return route authorization: user có 'refund' → chạy trực tiếp; THIẾU quyền
// → BẮT BUỘC approval token one-shot (scope+consume atomic); không approval → 403.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-ret-appr-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = 'development';

const { db, migrate, now } = await import('./db.js');
const { hashPin } = await import('./services/pin.js');
await import('./services/auth.js');
const Inventory = await import('./services/inventory.js');
const Retail = await import('./services/retail.js');
const Approval = await import('./services/approval.js');
const { registerRetailRoutes } = await import('./modules/retail/routes.js');
migrate();

db.prepare(`INSERT INTO shifts (id,branch_id,user_name,shift_key,shift_label,opening_cash,status,opened_at) VALUES (?,?,?,?,?,?,?,?)`)
  .run('sh_ra', 'sala', 'T', 'ra', 'RA', 0, 'open', now());
Inventory.createSku({ id: 'sku_R', name: 'Món', barcode: 'R-1', category: 'X', price: 10000, stock: 100 }, 'sala');
// Manager (có 'refund') để duyệt, PIN 7777.
db.prepare(`INSERT INTO users (id,branch_id,username,name,pin,role,active,branch_access_json)
  VALUES ('u_m','sala','mgr','M',?, 'manager',1,'["sala"]')`).run(hashPin('7777'));

// Bắt handler POST /retail/:id/return.
const routes = {};
const api = { get() {}, put() {}, delete() {}, use() {}, patch() {}, all() {}, post(p, ...h) { routes[`POST ${p}`] = h[h.length - 1]; } };
registerRetailRoutes(api, {
  wrap: (fn) => fn, guard: () => (_q, _s, n) => n && n(), guardAny: () => (_q, _s, n) => n && n(),
  branch: () => 'sala', visibleBranch: () => 'sala', actor: (req) => req.user?.username || 'system',
  applyManualConfirm: () => null, assertBillEditable: () => null,
});
const retHandler = routes['POST /retail/:id/return'];

function paidOrder() {
  const r = Retail.checkout({
    items: [{ sku_id: 'sku_R', qty: 2 }], payments: [{ method: 'cash', amount: 20000 }],
    branch_id: 'sala', cashier: 't', client_request_id: 'ra_' + Math.random(),
  });
  return r.order_id || r.id || db.prepare(`SELECT id FROM orders WHERE branch_id='sala' ORDER BY created_at DESC,rowid DESC LIMIT 1`).get().id;
}
const returnsCount = (oid) => db.prepare(`SELECT COUNT(*) n FROM order_returns WHERE original_order_id=?`).get(oid).n;

test('user có refund → return chạy trực tiếp', async () => {
  const oid = paidOrder();
  const res = await retHandler({ params: { id: oid }, body: {}, user: { id: 'u_m', role: 'manager', username: 'mgr' }, get: () => null });
  assert.equal(res.refund_total, 20000);
  assert.equal(returnsCount(oid), 1);
});

test('user THIẾU refund + KHÔNG approval → 403, KHÔNG mutation', async () => {
  const oid = paidOrder();
  let err = null;
  try { await retHandler({ params: { id: oid }, body: {}, user: { id: 'u_csh', role: 'cashier', username: 'csh' }, get: () => null }); }
  catch (e) { err = e; }
  assert.equal(err?.status, 403);
  assert.equal(err?.code, 'RETURN_APPROVAL_REQUIRED');
  assert.equal(returnsCount(oid), 0, 'không được tạo return khi bị từ chối');
});

test('user THIẾU refund + approval token hợp lệ (Quản lý duyệt) → chạy', async () => {
  const oid = paidOrder();
  const g = Approval.grantApproval({ branch_id: 'sala', action: 'return', target_id: oid, required_perm: 'refund', pin: '7777', requested_by: 'csh' });
  const res = await retHandler({ params: { id: oid }, body: { approval_token: g.token }, user: { id: 'u_csh', role: 'cashier', username: 'csh' }, get: () => null });
  assert.equal(res.refund_total, 20000);
  assert.equal(returnsCount(oid), 1);
});

test('double-click cùng token → lần 2 replay DENY (không double return)', async () => {
  const oid = paidOrder();
  const g = Approval.grantApproval({ branch_id: 'sala', action: 'return', target_id: oid, required_perm: 'refund', pin: '7777' });
  await retHandler({ params: { id: oid }, body: { approval_token: g.token }, user: { id: 'u_csh', role: 'cashier', username: 'csh' }, get: () => null });
  let err = null;
  try { await retHandler({ params: { id: oid }, body: { approval_token: g.token }, user: { id: 'u_csh', role: 'cashier', username: 'csh' }, get: () => null }); }
  catch (e) { err = e; }
  assert.equal(err?.code, 'APPROVAL_REPLAY');
  assert.equal(returnsCount(oid), 1, 'chỉ đúng MỘT return');
});

test('approval token SAI scope (order khác) → DENY', async () => {
  const oid = paidOrder();
  const other = paidOrder();
  const g = Approval.grantApproval({ branch_id: 'sala', action: 'return', target_id: other, required_perm: 'refund', pin: '7777' });
  let err = null;
  try { await retHandler({ params: { id: oid }, body: { approval_token: g.token }, user: { id: 'u_csh', role: 'cashier', username: 'csh' }, get: () => null }); }
  catch (e) { err = e; }
  assert.equal(err?.code, 'APPROVAL_SCOPE_MISMATCH');
  assert.equal(returnsCount(oid), 0);
});
