// KHÔNG IM LẶNG MẤT BILL (Gate-1). Sự cố báo cáo: "thanh toán thành công nhưng
// không thấy bill in". Trên nguồn hiện tại, thanh toán commit rồi in qua OUTBOX
// bền (worker retry) → bill KHÔNG mất; nhưng receipt trước đây KHÔNG cho client
// biết bill đã in thật, agent đã nhận hay còn chờ. receipt.print_status dùng
// state thật ('queued'|'claimed'|'printed'|'pending'), không gọi 'sent' là đã in.
// Payment TUYỆT ĐỐI không phụ thuộc máy in.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-printstatus-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = process.env.DATA_ENCRYPTION_KEY
  || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const { migrate, db } = await import('./db.js');
const Orders = await import('./services/orders.js');
const Pay = await import('./services/payments.js');
const AppSettings = await import('./services/settings.js');
const Catalog = await import('./services/catalog.js');

migrate();
const BR = 'sala';
AppSettings.updateSettings({ operations_config: { shifts: { requireOpenShift: false } } }, BR);
const nhom = Catalog.createCategory({ name: 'Test' }, BR);
db.prepare(`INSERT INTO menu_items (id,branch_id,category_id,name,price) VALUES (?,?,?,?,?)`)
  .run('mi_p', BR, nhom.id, 'Tra dao', 40000);
Catalog.cacheBust('menu:');

const soKhoanThu = (id) => db.prepare(`SELECT COUNT(*) n FROM payments WHERE order_id=?`).get(id).n;

test('không có máy in → payment vẫn xong MỘT lần, receipt.print_status="pending"', () => {
  const o = Orders.createOrUpdateOrder({
    branch_id: BR, channel: 'retail', actor: 'test',
    items: [{ menu_item_id: 'mi_p', qty: 1 }],
  });
  const receipt = Pay.payOrder(o.id, [{ method: 'cash', amount: 40000 }],
    { idempotency_key: 'p1', cashier: 'thu-ngan' }, BR);

  assert.equal(receipt.fully_settled, true, 'payment thành công bất kể máy in');
  assert.equal(db.prepare(`SELECT status FROM orders WHERE id=?`).get(o.id).status, 'paid');
  assert.equal(soKhoanThu(o.id), 1, 'đúng một khoản thu');
  // KHÔNG có tuyến máy in trong test env → phải báo 'pending' (không im lặng).
  assert.equal(receipt.print_status, 'pending',
    'receipt phải NÓI RÕ bill chưa in được để UI cảnh báo + cho in lại');
  // Outbox bền vẫn còn để worker thử lại → bill không mất.
  const outbox = db.prepare(
    `SELECT status FROM receipt_print_outbox WHERE payment_id=? LIMIT 1`).get(receipt.payment_id);
  assert.ok(outbox, 'phải có dòng outbox in bền để retry');
  assert.notEqual(outbox.status, 'done', 'chưa in được nên chưa done — worker sẽ retry');
});
