// CHỈNH GIÁ DÒNG + GHI CHÚ DÒNG cho món F&B (menu_item) — ĐỒNG BỘ với Retail.
// Trước đây nhánh menu_item bỏ qua line.price nên không giảm giá trực tiếp được.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

process.env.SQLITE_PATH = join(mkdtempSync(join(tmpdir(), 'ddp-fnbov-')), 'store.db');
process.env.STORAGE_PATH = join(tmpdir(), 'fnbov-store');

const { db, migrate } = await import('./db.js');
const Orders = await import('./services/orders.js');
migrate();

function tableId() {
  return db.prepare(`SELECT id FROM tables WHERE branch_id='sala' LIMIT 1`).get()?.id;
}

// menu_items.category_id NOT NULL — tao 1 danh muc dung chung cho test.
db.prepare(`INSERT INTO categories (id,branch_id,name) VALUES ('cat_t','sala','Test')`).run();
// Ban hang can ca dang mo.
db.prepare(`INSERT INTO shifts (id,branch_id,user_name,status,opened_at) VALUES ('sh_t','sala','Cashier','open',?)`)
  .run(new Date().toISOString());

test('menu_item: line.price + orig_price + note duoc ap dung (chinh gia dong F&B)', () => {
  db.prepare(`INSERT INTO menu_items (id,branch_id,category_id,name,price) VALUES (?,?,?,?,?)`)
    .run('mi_ov', 'sala', 'cat_t', 'Ca phe sua', 50000);

  const full = Orders.createOrUpdateOrder({
    branch_id: 'sala', table_id: tableId(), source: 'staff_pos',
    items: [{ menu_item_id: 'mi_ov', qty: 2, price: 30000, orig_price: 50000, note: 'it duong' }],
  });

  const it = db.prepare(`SELECT * FROM order_items WHERE order_id=? AND menu_item_id='mi_ov'`).get(full.id);
  assert.ok(it, 'phai tao order_item');
  assert.equal(it.unit_price, 30000, 'unit_price = gia da chinh');
  assert.equal(it.orig_price, 50000, 'orig_price = gia niem yet (bill in goc -> sau)');
  assert.equal(it.note, 'it duong', 'ghi chu dong duoc luu');
});

test('menu_item KHONG gui override -> unit = orig = gia niem yet (khong doi hanh vi cu)', () => {
  db.prepare(`INSERT INTO menu_items (id,branch_id,category_id,name,price) VALUES (?,?,?,?,?)`)
    .run('mi_no', 'sala', 'cat_t', 'Tra da', 10000);

  const full = Orders.createOrUpdateOrder({
    branch_id: 'sala', table_id: tableId(), source: 'staff_pos',
    items: [{ menu_item_id: 'mi_no', qty: 1 }],
  });

  const it = db.prepare(`SELECT * FROM order_items WHERE order_id=? AND menu_item_id='mi_no'`).get(full.id);
  assert.equal(it.unit_price, 10000);
  assert.equal(it.orig_price, 10000);
});
