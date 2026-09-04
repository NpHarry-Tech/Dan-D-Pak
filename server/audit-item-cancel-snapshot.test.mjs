// NHẬT KÝ HUỶ MÓN PHẢI ĐỌC ĐƯỢC (Gate-4). Sự cố 2026-09-04: item.cancel chỉ ghi
// mã món mờ + lý do chung → support không biết huỷ MÓN GÌ, bàn nào, bill nào.
// Fix: ghi SNAPSHOT (tên món, SKU, số lượng, đơn giá, bàn, bill) ngay trong lệnh
// huỷ, từ dữ liệu đã tải sẵn — đọc được cả khi sau này món đổi tên/xoá.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-cancelsnap-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = process.env.DATA_ENCRYPTION_KEY
  || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const { migrate, db } = await import('./db.js');
const Orders = await import('./services/orders.js');
const AppSettings = await import('./services/settings.js');
const Catalog = await import('./services/catalog.js');

migrate();
const BR = 'sala';
AppSettings.updateSettings({ operations_config: { shifts: { requireOpenShift: false } } }, BR);

const nhom = Catalog.createCategory({ name: 'Test' }, BR);
db.prepare(`INSERT INTO menu_items (id,branch_id,category_id,name,price) VALUES (?,?,?,?,?)`)
  .run('mi_c', BR, nhom.id, 'Bo luc lac', 90000);
Catalog.cacheBust('menu:');
db.prepare(`INSERT OR REPLACE INTO tables (id,branch_id,code,zone,seats,status)
  VALUES ('B01',?,'B01','TANG 1',4,'busy')`).run(BR);

function auditCancelMoiNhat() {
  const row = db.prepare(
    `SELECT detail FROM audit_log WHERE action='item.cancel' ORDER BY created_at DESC, rowid DESC LIMIT 1`).get();
  return row ? JSON.parse(row.detail) : null;
}

test('item.cancel ghi SNAPSHOT đọc được: tên món, SKU, SL, bàn, đơn', () => {
  const order = Orders.createOrUpdateOrder({
    branch_id: BR, table_id: 'B01', channel: 'dine_in', source: 'staff_pos',
    actor: 'thu-ngan', items: [{ menu_item_id: 'mi_c', qty: 3 }],
  });
  const oi = db.prepare(`SELECT id,name,qty,unit_price FROM order_items WHERE order_id=?`).get(order.id);

  Orders.cancelItem(oi.id, 'khach doi y', BR, 'thu-ngan');

  const d = auditCancelMoiNhat();
  assert.ok(d, 'phai co dong audit item.cancel');
  assert.equal(d.item, oi.id, 'van giu ma ky thuat cho support');
  assert.equal(d.reason, 'khach doi y');
  assert.equal(d.item_name, 'Bo luc lac', 'phai co TEN mon doc duoc');
  assert.equal(d.qty, 3, 'phai co so luong');
  assert.equal(d.unit_price, oi.unit_price);
  assert.equal(d.order_id, order.id, 'phai truy nguoc duoc ve don');
  assert.equal(d.table_id, 'B01', 'phai biet ban nao');
});

test('snapshot tên món KHÔNG đổi khi menu đổi tên sau đó', () => {
  const order = Orders.createOrUpdateOrder({
    branch_id: BR, table_id: 'B01', channel: 'dine_in', source: 'staff_pos',
    actor: 'thu-ngan', items: [{ menu_item_id: 'mi_c', qty: 1 }],
  });
  const oi = db.prepare(`SELECT id FROM order_items WHERE order_id=? ORDER BY created_at DESC LIMIT 1`).get(order.id);
  Orders.cancelItem(oi.id, 'het hang', BR, 'thu-ngan');
  const tenLucHuy = auditCancelMoiNhat().item_name;

  db.prepare(`UPDATE menu_items SET name='TEN MOI HOAN TOAN' WHERE id='mi_c'`).run();
  // Đọc lại đúng dòng audit đó — tên vẫn là tên lúc huỷ (đã snapshot).
  assert.equal(auditCancelMoiNhat().item_name, tenLucHuy);
  assert.equal(tenLucHuy, 'Bo luc lac');
});
