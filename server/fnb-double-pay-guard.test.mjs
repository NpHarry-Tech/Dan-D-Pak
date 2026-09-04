// F&B — MỘT ĐƠN, MỘT LẦN THU TIỀN. Khoá bất biến chống THU TIỀN KÉP.
//
// Sự cố báo cáo 2026-09-04: "thanh toán xong, bàn vẫn mở, thanh toán lần hai
// được → thu tiền kép". Test này chứng minh trên NGUỒN HIỆN TẠI (fd4faee) rằng
// đường thanh toán F&B đã chặn đúng:
//   1) trả đủ rồi bấm lại với MÃ KHÁC (double-click sinh op mới) → BỊ TỪ CHỐI,
//      không phát sinh khoản thu thứ hai (chốt điều kiện + đơn immutable);
//   2) retry với CÙNG MÃ (mất mạng sau commit) → trả lại ĐÚNG payment cũ, không
//      thu lần hai (idempotent replay).
// Nếu test này đỏ trên một build nào đó thì build đó là bản CŨ cần thay, không
// phải nguồn hiện tại.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-dblpay-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = process.env.DATA_ENCRYPTION_KEY
  || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const { migrate, db } = await import('./db.js');
const Orders = await import('./services/orders.js');
const Pay = await import('./services/payments.js');
const AppSettings = await import('./services/settings.js');

migrate();
const BR = 'sala';

// Bỏ ràng buộc ca để tập trung vào bất biến thu tiền kép.
AppSettings.updateSettings({ operations_config: { shifts: { requireOpenShift: false } } }, BR);

const Catalog = await import('./services/catalog.js');
const nhom = Catalog.createCategory({ name: 'Test' }, BR);
db.prepare(`INSERT INTO menu_items (id,branch_id,category_id,name,price) VALUES (?,?,?,?,?)`)
  .run('mi_dbl', BR, nhom.id, 'Ca phe', 50000);
Catalog.cacheBust('menu:');

function moDon() {
  return Orders.createOrUpdateOrder({
    branch_id: BR, channel: 'retail', actor: 'test',
    items: [{ menu_item_id: 'mi_dbl', qty: 1 }],
  });
}
const soKhoanThu = (id) => db.prepare(`SELECT COUNT(*) n FROM payments WHERE order_id=?`).get(id).n;
const tongThu = (id) => db.prepare(`SELECT COALESCE(SUM(total),0) s FROM payments WHERE order_id=?`).get(id).s;
const trangThai = (id) => db.prepare(`SELECT status FROM orders WHERE id=?`).get(id).status;

test('trả đủ rồi bấm lại MÃ KHÁC → bị từ chối, KHÔNG thu lần hai', () => {
  const o = moDon();
  const r1 = Pay.payOrder(o.id, [{ method: 'cash', amount: 50000 }], { idempotency_key: 'k1', cashier: 'thu-ngan' }, BR);
  assert.equal(r1.fully_settled, true);
  assert.equal(trangThai(o.id), 'paid');
  assert.equal(soKhoanThu(o.id), 1);

  // Double-click / máy khác bấm lại với op id MỚI.
  assert.throws(
    () => Pay.payOrder(o.id, [{ method: 'cash', amount: 50000 }], { idempotency_key: 'k2', cashier: 'thu-ngan' }, BR),
    /đã đóng|đã được thanh toán|không còn/i,
    'đơn đã đóng phải từ chối lần thu thứ hai');

  assert.equal(soKhoanThu(o.id), 1, 'vẫn chỉ MỘT khoản thu — không thu tiền kép');
  assert.equal(tongThu(o.id), 50000, 'doanh thu không được nhân đôi');
  assert.equal(trangThai(o.id), 'paid');
});

test('retry CÙNG MÃ (mất mạng sau commit) → trả lại payment cũ, không thu lần hai', () => {
  const o = moDon();
  const r1 = Pay.payOrder(o.id, [{ method: 'cash', amount: 50000 }], { idempotency_key: 'same-op', cashier: 'thu-ngan' }, BR);
  const r2 = Pay.payOrder(o.id, [{ method: 'cash', amount: 50000 }], { idempotency_key: 'same-op', cashier: 'thu-ngan' }, BR);
  assert.equal(r2.idempotent_replay, true, 'cùng mã phải là replay, không chạy lại');
  assert.equal(r2.payment_id, r1.payment_id, 'phải trả về đúng payment đã commit');
  assert.equal(soKhoanThu(o.id), 1, 'chỉ một khoản thu dù gọi hai lần');
});

test('đơn đã đóng thì thêm/xóa món cũng bị chặn (bàn không thể mở lại để bán tiếp)', () => {
  const o = moDon();
  Pay.payOrder(o.id, [{ method: 'cash', amount: 50000 }], { idempotency_key: 'k3', cashier: 'thu-ngan' }, BR);
  assert.equal(trangThai(o.id), 'paid');
  // Nối thêm món vào ĐÚNG đơn đã đóng phải bị từ chối (đơn immutable).
  assert.throws(
    () => Orders.createOrUpdateOrder({
      branch_id: BR, channel: 'retail', actor: 'test', order_id: o.id,
      items: [{ menu_item_id: 'mi_dbl', qty: 1 }],
    }),
    /không tồn tại hoặc đã đóng|đã đóng/i,
    'đơn đã đóng không được nối thêm món');
});
