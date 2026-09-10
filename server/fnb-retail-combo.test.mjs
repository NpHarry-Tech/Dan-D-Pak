// Combo (scope 'combo') cho hàng RETAIL bán TRONG đơn F&B (thêm qua "Thêm
// retail" ở POS nhà hàng) — buildOrderDiscountPlan (F&B) giờ nhận selected_combos
// giống hệt Retail POS, thay vì luôn bỏ qua (mặc định null = tự áp mọi combo).
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

process.env.SQLITE_PATH = join(mkdtempSync(join(tmpdir(), 'ddp-fnbcombo-')), 'store.db');
process.env.STORAGE_PATH = join(tmpdir(), 'fnbcombo-store');
process.env.DATA_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const { db, migrate } = await import('./db.js');
const Orders = await import('./services/orders.js');
const Pay = await import('./services/payments.js');
const V = await import('./services/vouchers.js');
migrate();

const B = 'sala';
// Mỗi test 1 bàn RIÊNG — dùng chung 1 bàn thì các đơn mở nối đuôi vào CÙNG 1
// order (createOrUpdateOrder tìm đơn mở theo bàn), cộng dồn combo giữa các test.
let tableSeq = 0;
function tableId() {
  const id = `t_combo_${++tableSeq}`;
  db.prepare(`INSERT INTO tables (id,branch_id,zone,code,seats,status) VALUES (?,?,?,?,4,'free')`)
    .run(id, B, 'Test', `CB${tableSeq}`);
  return id;
}
db.prepare(`INSERT INTO categories (id,branch_id,name) VALUES ('cat_c','sala','Test')`).run();
db.prepare(`INSERT INTO shifts (id,branch_id,user_name,status,opened_at) VALUES ('sh_c','sala','Cashier','open',?)`)
  .run(new Date().toISOString());
db.prepare(`INSERT INTO skus (id,branch_id,barcode,name,price,stock,unit,warehouse_id,active)
  VALUES ('sku_a','sala','BA','Bắp phô mai',80000,100,'hộp','wh_retail',1)`).run();
db.prepare(`INSERT INTO skus (id,branch_id,barcode,name,price,stock,unit,warehouse_id,active)
  VALUES ('sku_b','sala','BB','Bắp caramel',80000,100,'hộp','wh_retail',1)`).run();

const voucher = V.createVoucher({
  name: 'Mua 2 bắp 100k', code: 'FNB_COMBO', scope: 'combo', type: 'fixed', value: 100000,
  scope_config: { skus: ['sku_a', 'sku_b'], qty: 2 },
}, B);

function freshOrder() {
  return Orders.createOrUpdateOrder({
    branch_id: B, table_id: tableId(), source: 'staff_pos',
    items: [{ sku_id: 'sku_a', qty: 1 }, { sku_id: 'sku_b', qty: 1 }],
  });
}

test('F&B: khong truyen selected_combos (mac dinh) -> tu ap combo (hanh vi cu)', () => {
  const order = freshOrder();
  const plan = Pay.buildOrderDiscountPlan(order.id, { branch_id: B });
  assert.equal(plan.discount, 60000, '2 bap 160k -> combo 100k, giam 60k');
});

test('F&B: selected_combos=[id] -> ap dung combo do (opt-in, giong Retail)', () => {
  const order = freshOrder();
  const plan = Pay.buildOrderDiscountPlan(order.id, { branch_id: B, selected_combos: [voucher.id] });
  assert.equal(plan.discount, 60000);
});

test('F&B: selected_combos=[] -> KHONG ap combo nao (opt-out, giong Retail)', () => {
  const order = freshOrder();
  const plan = Pay.buildOrderDiscountPlan(order.id, { branch_id: B, selected_combos: [] });
  assert.equal(plan.discount, 0, 'khong chon combo nao thi khong duoc tu y ap');
});
