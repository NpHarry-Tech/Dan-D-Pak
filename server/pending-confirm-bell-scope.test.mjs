// Chuông/badge "chờ xác nhận" (listPendingConfirmations, GET /orders/pending-confirmation)
// chỉ được báo món KHÁCH TỰ GỌI (source customer_tablet/self_order) — món nhân
// viên tự thêm trên chính máy mình (source cashier) CŨNG ở status pending_confirm
// (chờ bấm "Xác nhận" gửi bếp, xem needsStaffConfirm trong createOrUpdateOrder)
// nhưng không cần tự báo cho mình, đã có sẵn nút "Xác nhận" ngay tại bàn.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

process.env.SQLITE_PATH = join(mkdtempSync(join(tmpdir(), 'ddp-pendingbell-')), 'store.db');
process.env.STORAGE_PATH = join(tmpdir(), 'pendingbell-store');
process.env.DATA_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const { db, migrate } = await import('./db.js');
const Orders = await import('./services/orders.js');
migrate();

const B = 'sala';
db.prepare(`INSERT INTO categories (id,branch_id,name) VALUES ('cat_p','sala','Test')`).run();
db.prepare(`INSERT INTO shifts (id,branch_id,user_name,status,opened_at) VALUES ('sh_p','sala','Cashier','open',?)`)
  .run(new Date().toISOString());
db.prepare(`INSERT INTO menu_items (id,branch_id,category_id,name,price,vat_rate,station,available)
  VALUES ('mi_p','sala','cat_p','Mì test',50000,8,'kitchen',1)`).run();

let tableSeq = 0;
function tableId() {
  const id = `t_pb_${++tableSeq}`;
  db.prepare(`INSERT INTO tables (id,branch_id,zone,code,seats,status) VALUES (?,?,?,?,4,'free')`)
    .run(id, B, 'Test', `PB${tableSeq}`);
  return id;
}

test('Nhan vien tu them mon tren may minh (cashier) -> KHONG len chuong/danh sach cho xac nhan', () => {
  const before = Orders.listPendingConfirmations(B).flatMap(g => g.items.map(i => i.id));
  const order = Orders.createOrUpdateOrder({
    branch_id: B, table_id: tableId(), source: 'cashier',
    items: [{ menu_item_id: 'mi_p', qty: 1 }],
  });
  const item = order.items.find(i => i.status === 'pending_confirm');
  assert.ok(item, 'mon phai o pending_confirm (dine-in van phai bam Xac nhan)');
  const after = Orders.listPendingConfirmations(B).flatMap(g => g.items.map(i => i.id));
  assert.ok(!after.includes(item.id), 'mon cashier tu them KHONG duoc xuat hien trong danh sach chuong');
  assert.equal(after.length, before.length, 'danh sach chuong khong doi khi nhan vien tu them mon');
});

test('Khach tu goi mon qua tablet (self_order) -> CO len chuong/danh sach cho xac nhan', () => {
  const t = tableId();
  const order = Orders.createOrUpdateOrder({
    branch_id: B, table_id: t, source: 'self_order',
    items: [{ menu_item_id: 'mi_p', qty: 1 }],
  });
  const item = order.items.find(i => i.status === 'pending_confirm');
  assert.ok(item, 'mon khach tu goi cung phai o pending_confirm');
  const after = Orders.listPendingConfirmations(B).flatMap(g => g.items.map(i => i.id));
  assert.ok(after.includes(item.id), 'mon khach tu goi PHAI xuat hien trong danh sach chuong');
});
