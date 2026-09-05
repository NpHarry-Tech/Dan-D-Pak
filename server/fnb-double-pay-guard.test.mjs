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
const Retail = await import('./services/retail.js');
const Inventory = await import('./services/inventory.js');
const AppSettings = await import('./services/settings.js');
const { setRealtimeEmitter } = await import('./core/realtimeBus.js');
const { readRecentAuditArchive } = await import('./services/archive.js');

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

test('audit payment.done thất bại → rollback tiền/đơn/bàn/outbox và không emit success', () => {
  db.prepare(`INSERT INTO tables (id,branch_id,zone,code,seats,status)
    VALUES ('t_atomic_pay',?,'Tầng 1','A-01',4,'free')`).run(BR);
  const order = Orders.createOrUpdateOrder({
    branch_id: BR, table_id: 't_atomic_pay', channel: 'dine_in', actor: 'test',
    items: [{ menu_item_id: 'mi_dbl', qty: 1 }],
  });
  Orders.confirmPendingItems(order.id, [], BR, 'thu-ngan');
  const outboxBefore = db.prepare(`SELECT COUNT(*) n FROM receipt_print_outbox`).get().n;
  const seen = [];
  setRealtimeEmitter((event, payload, branch) => seen.push({ event, payload, branch }));
  db.exec(`CREATE TRIGGER fail_payment_done_audit
    BEFORE INSERT ON audit_log
    WHEN NEW.action='payment.done'
    BEGIN SELECT RAISE(ABORT, 'forced payment audit failure'); END`);

  let failure = null;
  try {
    Pay.payOrder(order.id, [{ method: 'cash', amount: 50000 }], {
      idempotency_key: 'atomic-audit-failure', cashier: 'thu-ngan',
    }, BR);
  } catch (error) {
    failure = error;
  } finally {
    db.exec('DROP TRIGGER fail_payment_done_audit');
    setRealtimeEmitter(null);
  }

  assert.match(String(failure?.message || ''), /forced payment audit failure/,
    'audit bắt buộc thất bại phải làm payment thất bại');
  assert.equal(db.prepare(`SELECT status FROM orders WHERE id=?`).get(order.id).status, 'open');
  assert.equal(db.prepare(`SELECT status FROM tables WHERE id='t_atomic_pay'`).get().status, 'busy');
  assert.equal(soKhoanThu(order.id), 0, 'không được giữ payment sau rollback');
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM receipt_print_outbox`).get().n, outboxBefore,
    'không được tạo outbox mới sau rollback');
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM audit_log WHERE action='payment.done'
    AND detail LIKE ?`).get(`%${order.id}%`).n, 0);
  assert.equal(readRecentAuditArchive(2).filter(entry =>
    entry.action === 'payment.done' && String(entry.detail || '').includes(order.id)).length, 0,
  'không được để footprint archive thành công cho transaction rollback');
  assert.deepEqual(seen.filter(entry =>
    ['payment:done', 'table:updated', 'stats:dirty'].includes(entry.event)), [],
  'không được emit success/table state trước commit');
});

test('realtime NÉM SAU commit → payment vẫn committed, receipt canonical, không nhân đôi', () => {
  const o = moDon();
  let calls = 0;
  // Tầng realtime misbehave (ném) SAU khi đã COMMIT — tuyệt đối không được làm
  // payment rollback / nhân đôi / khiến API báo thất bại (risk 1B).
  setRealtimeEmitter(() => { calls += 1; throw new Error('realtime down'); });
  let receipt = null;
  let err = null;
  try {
    receipt = Pay.payOrder(o.id, [{ method: 'cash', amount: 50000 }],
      { idempotency_key: 'rt-throw', cashier: 'thu-ngan' }, BR);
  } catch (e) {
    err = e;
  } finally {
    setRealtimeEmitter(null);
  }
  assert.equal(err, null, 'realtime lỗi KHÔNG được làm payOrder ném ra ngoài');
  assert.ok(calls > 0, 'emitter phải thực sự được gọi (đã đi qua nhánh realtime)');
  assert.equal(receipt?.fully_settled, true, 'receipt canonical đã committed');
  assert.ok(receipt.payment_id, 'receipt có payment_id committed');
  assert.equal(trangThai(o.id), 'paid', 'đơn vẫn đóng — KHÔNG rollback vì realtime lỗi');
  assert.equal(soKhoanThu(o.id), 1, 'đúng một khoản thu, không nhân đôi');

  // Retry cùng key sau khi realtime từng lỗi → replay đúng payment cũ, không thu lần hai.
  const r2 = Pay.payOrder(o.id, [{ method: 'cash', amount: 50000 }],
    { idempotency_key: 'rt-throw', cashier: 'thu-ngan' }, BR);
  assert.equal(r2.payment_id, receipt.payment_id, 'retry trả đúng payment đã commit');
  assert.equal(soKhoanThu(o.id), 1, 'retry không tạo khoản thu thứ hai');
});

test('Retail audit failure rolls back order, stock, payment and all side effects', () => {
  Inventory.createSku({
    id: 'sku_atomic_retail', code: 'ATOMIC-RETAIL', name: 'Atomic Retail',
    price: 30000, stock: 2,
  }, BR);
  const before = {
    orders: db.prepare(`SELECT COUNT(*) n FROM orders`).get().n,
    payments: db.prepare(`SELECT COUNT(*) n FROM payments`).get().n,
    outbox: db.prepare(`SELECT COUNT(*) n FROM receipt_print_outbox`).get().n,
    stock: db.prepare(`SELECT stock FROM skus WHERE id='sku_atomic_retail'`).get().stock,
  };
  const seen = [];
  setRealtimeEmitter((event, payload, branch) => seen.push({ event, payload, branch }));
  db.exec(`CREATE TRIGGER fail_retail_order_audit
    BEFORE INSERT ON audit_log
    WHEN NEW.action='order.send'
    BEGIN SELECT RAISE(ABORT, 'forced retail order audit failure'); END`);

  let failure = null;
  try {
    Retail.checkout({
      branch_id: BR, cashier: 'thu-ngan', client_request_id: 'atomic-retail-failure',
      items: [{ sku_id: 'sku_atomic_retail', qty: 1 }],
      payments: [{ method: 'cash', amount: 30000 }],
    });
  } catch (error) {
    failure = error;
  } finally {
    db.exec('DROP TRIGGER fail_retail_order_audit');
    setRealtimeEmitter(null);
  }

  assert.match(String(failure?.message || ''), /forced retail order audit failure/);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM orders`).get().n, before.orders);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM payments`).get().n, before.payments);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM receipt_print_outbox`).get().n, before.outbox);
  assert.equal(db.prepare(`SELECT stock FROM skus WHERE id='sku_atomic_retail'`).get().stock, before.stock);
  assert.equal(readRecentAuditArchive(2).filter(entry =>
    entry.action === 'order.send' && String(entry.detail || '').includes('atomic-retail-failure')).length, 0);
  assert.deepEqual(seen.filter(entry =>
    ['order:new', 'inventory:updated', 'payment:done', 'stats:dirty'].includes(entry.event)), []);
});
