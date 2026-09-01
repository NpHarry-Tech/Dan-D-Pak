// §20 RETURN test matrix — bill đã thanh toán BẤT BIẾN; trả một phần; enforce
// qty/refund; restock đúng 1 lần; disposition; branch scope; idempotent.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-return-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');

const { db, migrate, now } = await import('./db.js');
const Inventory = await import('./services/inventory.js');
const Retail = await import('./services/retail.js');
const Orders = await import('./services/orders.js');
const Returns = await import('./services/returns.js');

migrate();
db.prepare(`INSERT INTO shifts (id,branch_id,user_name,shift_key,shift_label,opening_cash,status,opened_at) VALUES (?,?,?,?,?,?,?,?)`)
  .run('shift_ret', 'sala', 'Tester', 'ret', 'Ret', 0, 'open', now());
Inventory.createSku({ id: 'sku_A', name: 'Áo', barcode: 'A-1', category: 'X', price: 10000, stock: 100 }, 'sala');
Inventory.createSku({ id: 'sku_B', name: 'Bút', barcode: 'B-1', category: 'X', price: 15000, stock: 100 }, 'sala');

function stock(id) { return Number(db.prepare(`SELECT stock FROM skus WHERE id=?`).get(id).stock); }
function mkPaidOrder() {
  const r = Retail.checkout({
    items: [{ sku_id: 'sku_A', qty: 3 }, { sku_id: 'sku_B', qty: 2 }],
    payments: [{ method: 'cash', amount: 60000 }],
    branch_id: 'sala', cashier: 'tester', client_request_id: 'req_' + Math.random(),
  });
  const id = r.order_id || r.id || db.prepare(`SELECT id FROM orders WHERE branch_id='sala' ORDER BY created_at DESC, rowid DESC LIMIT 1`).get().id;
  return id;
}
const itemsOf = (oid) => Orders.getOrder(oid).items;

test('partial return: trả 1/3 áo → refund đúng, bill gốc CÒN NGUYÊN (paid), restock +1', () => {
  const oid = mkPaidOrder();
  const a = itemsOf(oid).find(i => i.sku_id === 'sku_A');
  const before = stock('sku_A');
  const res = Returns.createReturn(oid, { items: [{ order_item_id: a.id, qty: 1 }], branch_id: 'sala', actor: 't' });
  assert.equal(res.refund_total, 10000);
  assert.equal(stock('sku_A'), before + 1, 'restock đúng 1');
  const order = Orders.getOrder(oid);
  assert.equal(order.status, 'paid', 'bill gốc phải còn nguyên (không void) §6');
  assert.equal(Returns.returnedQtyByItem(oid)[a.id], 1);
});

test('second partial trong remaining + qty>remaining bị DENY (§8)', () => {
  const oid = mkPaidOrder();
  const a = itemsOf(oid).find(i => i.sku_id === 'sku_A'); // sold 3
  Returns.createReturn(oid, { items: [{ order_item_id: a.id, qty: 2 }], branch_id: 'sala', actor: 't' });
  // remaining = 1 → trả 2 phải DENY
  assert.throws(() => Returns.createReturn(oid, { items: [{ order_item_id: a.id, qty: 2 }], branch_id: 'sala', actor: 't' }),
    /vượt số đã bán/);
  // trả nốt 1 → ok
  const r = Returns.createReturn(oid, { items: [{ order_item_id: a.id, qty: 1 }], branch_id: 'sala', actor: 't' });
  assert.equal(r.refund_total, 10000);
  // đã trả hết áo → trả thêm DENY (§18)
  assert.throws(() => Returns.createReturn(oid, { items: [{ order_item_id: a.id, qty: 1 }], branch_id: 'sala', actor: 't' }),
    /(vượt số đã bán|đã trả hết)/);
});

test('branch mismatch → DENY (§20-6)', () => {
  const oid = mkPaidOrder();
  assert.throws(() => Returns.createReturn(oid, { branch_id: 'other', actor: 't' }),
    (e) => e.status === 403);
});

test('idempotent: cùng Idempotency-Key → đúng MỘT return, KHÔNG restock 2 lần (§29)', () => {
  const oid = mkPaidOrder();
  const a = itemsOf(oid).find(i => i.sku_id === 'sku_A');
  const before = stock('sku_A');
  const k = 'idem-' + oid;
  const r1 = Returns.createReturn(oid, { items: [{ order_item_id: a.id, qty: 1 }], branch_id: 'sala', actor: 't', idempotency_key: k });
  const r2 = Returns.createReturn(oid, { items: [{ order_item_id: a.id, qty: 1 }], branch_id: 'sala', actor: 't', idempotency_key: k });
  assert.equal(r2.idempotent, true);
  assert.equal(r1.return_id, r2.return_id);
  assert.equal(stock('sku_A'), before + 1, 'không restock 2 lần');
});

test('disposition damaged → KHÔNG cộng kho (§9)', () => {
  const oid = mkPaidOrder();
  const b = itemsOf(oid).find(i => i.sku_id === 'sku_B');
  const before = stock('sku_B');
  Returns.createReturn(oid, { items: [{ order_item_id: b.id, qty: 1, disposition: 'damaged' }], branch_id: 'sala', actor: 't' });
  assert.equal(stock('sku_B'), before, 'hàng hỏng không được cộng lại kho');
});

test('mixed tender (§4): refund BÁM tender gốc (cash+card), không quy cash mù', () => {
  const r = Retail.checkout({
    items: [{ sku_id: 'sku_A', qty: 2 }],
    payments: [{ method: 'cash', amount: 10000 }, { method: 'card', amount: 10000 }],
    branch_id: 'sala', cashier: 't', client_request_id: 'mix_' + Math.random(),
  });
  const oid = r.order_id || r.id || db.prepare(`SELECT id FROM orders WHERE branch_id='sala' ORDER BY created_at DESC, rowid DESC LIMIT 1`).get().id;
  const a = itemsOf(oid).find(i => i.sku_id === 'sku_A');
  const res = Returns.createReturn(oid, { items: [{ order_item_id: a.id, qty: 1 }], branch_id: 'sala', actor: 't' });
  assert.equal(res.refund_total, 10000);
  for (const b of res.refund_breakdown) {
    assert.ok(['cash', 'card'].includes(b.method), 'refund method phải thuộc tender gốc: ' + b.method);
  }
  const res2 = Returns.createReturn(oid, { branch_id: 'sala', actor: 't' }); // trả nốt
  assert.equal(res.refund_total + res2.refund_total, 20000, 'tổng refund = tổng đã thu');
  // tổng payment ròng của bill về 0 (đã hoàn hết) — không double subtract
  const net = db.prepare(`SELECT COALESCE(SUM(pl.amount),0) s FROM payment_lines pl JOIN payments p ON p.id=pl.payment_id WHERE p.order_id=?`).get(oid).s;
  assert.equal(Number(net), 0, 'net tender = 0 sau khi hoàn toàn bộ');
});

test('full return (items rỗng) → refund = total, bill gốc vẫn tồn tại (§20-15)', () => {
  const oid = mkPaidOrder();
  const res = Returns.createReturn(oid, { branch_id: 'sala', actor: 't', reason: 'trả toàn bộ' });
  assert.equal(res.refund_total, 60000);
  assert.equal(res.full, true);
  assert.ok(Orders.getOrder(oid), 'bill gốc vẫn còn trong history');
  // history link được
  const rets = Returns.listReturnsForOrder(oid, 'sala');
  assert.equal(rets.length, 1);
  assert.ok(rets[0].items.length >= 1);
});
