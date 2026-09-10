// Gõ nhanh nhiều món trong CÙNG một lượt gửi (client coalesce nhiều dòng làm 1
// request, xem submitOrder()/_drainSubmitQueue trong pos_provider.dart) — 1
// dòng lỗi nghiệp vụ (hết hàng/tạm hết) KHÔNG được kéo sập các dòng khác
// trong cùng lượt đó. Trước đây createOrUpdateOrder chạy trong 1 transaction
// tất-cả-hoặc-không: 1 dòng throw là ROLLBACK toàn bộ, món hợp lệ đi kèm cũng
// mất theo dù thật ra không có vấn đề gì.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

process.env.SQLITE_PATH = join(mkdtempSync(join(tmpdir(), 'ddp-partialbatch-')), 'store.db');
process.env.STORAGE_PATH = join(tmpdir(), 'partialbatch-store');
process.env.DATA_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const { db, migrate } = await import('./db.js');
const Orders = await import('./services/orders.js');
migrate();

const B = 'sala';
db.prepare(`INSERT INTO categories (id,branch_id,name) VALUES ('cat_pb','sala','Test')`).run();
db.prepare(`INSERT INTO shifts (id,branch_id,user_name,status,opened_at) VALUES ('sh_pb','sala','Cashier','open',?)`)
  .run(new Date().toISOString());
db.prepare(`INSERT INTO menu_items (id,branch_id,category_id,name,price,vat_rate,station,available)
  VALUES ('mi_ok','sala','cat_pb','Mon con hang',50000,8,'kitchen',1)`).run();
db.prepare(`INSERT INTO menu_items (id,branch_id,category_id,name,price,vat_rate,station,available)
  VALUES ('mi_out','sala','cat_pb','Mon tam het',60000,8,'kitchen',0)`).run();

let tableSeq = 0;
function tableId() {
  const id = `t_pb_${++tableSeq}`;
  db.prepare(`INSERT INTO tables (id,branch_id,zone,code,seats,status) VALUES (?,?,?,?,4,'free')`)
    .run(id, B, 'Test', `PB${tableSeq}`);
  return id;
}

test('1 dong tam het KHONG lam mat dong con lai trong cung 1 lot gui', () => {
  const order = Orders.createOrUpdateOrder({
    branch_id: B, table_id: tableId(), source: 'cashier',
    items: [
      { menu_item_id: 'mi_out', qty: 1 },
      { menu_item_id: 'mi_ok', qty: 2 },
    ],
  });
  assert.equal(order.items.length, 1, 'chi dong hop le duoc tao');
  assert.equal(order.items[0].menu_item_id, 'mi_ok');
  assert.equal(order.items[0].qty, 2);
  assert.equal(order.skipped_items.length, 1, 'dong loi duoc bao lai, khong am tham mat');
  assert.equal(order.skipped_items[0].index, 0, 'dung vi tri dong trong payload goc');
  assert.match(order.skipped_items[0].reason, /tạm hết/);
});

test('TAT CA dong deu loi -> throw (khong tao don rong)', () => {
  const before = db.prepare(`SELECT COUNT(*) n FROM orders`).get().n;
  assert.throws(() => Orders.createOrUpdateOrder({
    branch_id: B, table_id: tableId(), source: 'cashier',
    items: [
      { menu_item_id: 'mi_out', qty: 1 },
      { sku_id: 'sku_khong_ton_tai', qty: 1 },
    ],
  }), /tạm hết|không tồn tại/);
  const after = db.prepare(`SELECT COUNT(*) n FROM orders`).get().n;
  assert.equal(after, before, 'khong tao don khi khong dong nao thanh cong');
});

test('khong co dong nao loi -> skipped_items rong', () => {
  const order = Orders.createOrUpdateOrder({
    branch_id: B, table_id: tableId(), source: 'cashier',
    items: [{ menu_item_id: 'mi_ok', qty: 1 }],
  });
  assert.deepEqual(order.skipped_items, []);
});
