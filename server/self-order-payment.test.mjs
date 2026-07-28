// Thanh toán ở màn KHÁCH TỰ GỌI MÓN phải chốt tiền bằng đúng cơ chế của POS:
// số tiền do server tính, nội dung chuyển khoản do server sinh, và bill chỉ đóng
// khi ĐỐI TÁC ngân hàng báo tiền về (webhook) — không phải khi khách bấm nút.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-selforder-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = process.env.DATA_ENCRYPTION_KEY
  || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const { db, migrate, now } = await import('./db.js');
const Orders = await import('./services/orders.js');
const Payments = await import('./services/payments.js');
const AppSettings = await import('./services/settings.js');

migrate();

db.prepare(`INSERT INTO menu_items (id,category_id,name,price,price_includes_vat,vat_rate,station) VALUES (?,?,?,?,?,?,?)`)
  .run('mi_tra', 'cat_t', 'Tra Sua', 60000, 1, 8, 'bar');
// Bán hàng yêu cầu có ca đang mở — giống hệt điều kiện của POS.
db.prepare(`INSERT INTO shifts (id,branch_id,user_name,shift_key,shift_label,opening_cash,status,opened_at) VALUES (?,?,?,?,?,?,?,?)`)
  .run('shift_selforder', 'br1', 'Tester', 'test', 'Test', 0, 'open', now());

function selfOrder() {
  return Orders.createOrUpdateOrder({
    branch_id: 'br1', channel: 'dine_in', source: 'customer_ipad', actor: 'Khach',
    items: [{ menu_item_id: 'mi_tra', qty: 2 }],
  });
}

test('QR của khách tự gọi món lấy số tiền từ server, không từ client', async () => {
  const order = selfOrder();
  // Món iPad gửi lên nằm ở pending_confirm → CHƯA cho tạo QR, tránh khách trả
  // tiền cho đơn nhân viên chưa xác nhận.
  await assert.rejects(() => Payments.generateCustomerPaymentQr(order.id, {}, 'br1'), /cho nhan vien xac nhan/);

  Orders.confirmPendingItems(order.id, [], 'br1', 'Thu ngan');
  const qr = await Payments.generateCustomerPaymentQr(order.id, {}, 'br1');
  const fresh = Orders.getOrder(order.id);
  assert.equal(qr.amount, fresh.total);            // đúng bằng công nợ còn lại
  assert.ok(String(qr.reference || '').length > 0); // có nội dung CK để đối soát
});

test('khách bấm "đã chuyển khoản" KHÔNG tự đóng bill — chờ đối tác/nhân viên', () => {
  const order = selfOrder();
  Orders.confirmPendingItems(order.id, [], 'br1', 'Thu ngan');

  const res = Payments.customerQrPay(order.id, { method: 'qrcode' }, 'br1');
  assert.equal(res.status, 'awaiting_staff');
  assert.equal(Orders.getOrder(order.id).status, 'open');   // vẫn mở, chưa thu tiền
  assert.equal(Payments.paidForOrder(order.id), 0);
});

test('bill TRẢ TRƯỚC MỘT PHẦN vẫn gửi món vào bếp được', () => {
  // Lỗi thật gặp trên máy POS: khách trả trước một phần rồi gọi thêm món. Bàn
  // hiện món "Chờ xác nhận", nhưng bấm "Gửi món vào bếp" báo "Bill không tồn tại
  // hoặc đã đóng" — vì confirmPendingItems chỉ nhận status='open', trong khi cả
  // hệ (getOpenOrderForTable, listPendingConfirmations, payOrder…) đều coi
  // partially_paid là bill CÒN MỞ. Món hiện ra mà không xác nhận được.
  db.prepare(`INSERT INTO tables (id,branch_id,zone,code,seats,status) VALUES (?,?,?,?,?,?)`)
    .run('t_TEST9', 'br1', 'Tầng trệt', 'T9', 4, 'free');
  const order = Orders.createOrUpdateOrder({
    branch_id: 'br1', channel: 'dine_in', source: 'staff_pos', table_id: 't_TEST9',
    actor: 'Thu ngan', items: [{ menu_item_id: 'mi_tra', qty: 2 }],
  });
  Orders.confirmPendingItems(order.id, [], 'br1', 'Thu ngan');
  const fresh = Orders.getOrder(order.id);

  // Trả thiếu → đơn chuyển sang partially_paid.
  Payments.payOrder(order.id, [{ method: 'cash', amount: 20000 }], { cashier: 'Thu ngan' }, 'br1');
  assert.equal(Orders.getOrder(order.id).status, 'partially_paid');
  assert.ok(Payments.paidForOrder(order.id) < fresh.total);

  // Gọi thêm món trên chính bàn đó → phải vào đúng bill cũ, không tạo bill mới.
  const more = Orders.createOrUpdateOrder({
    branch_id: 'br1', channel: 'dine_in', source: 'staff_pos', table_id: order.table_id,
    actor: 'Thu ngan', items: [{ menu_item_id: 'mi_tra', qty: 1 }],
  });
  assert.equal(more.id, order.id);

  // Và gửi bếp được — đây là thao tác từng báo lỗi.
  const confirmed = Orders.confirmPendingItems(order.id, [], 'br1', 'Thu ngan');
  assert.ok(confirmed);
  assert.equal(
    Orders.getOrder(order.id).items.filter(i => i.status === 'pending_confirm').length,
    0);
});

test('webhook SePay của đối tác mới là thứ đóng bill — giống hệt POS', () => {
  AppSettings.updateIntegrations({
    channels: { sepay: { enabled: true, apiKey: 'k_test_sepay', accountNumber: '' } },
  }, 'br1');

  const order = selfOrder();
  Orders.confirmPendingItems(order.id, [], 'br1', 'Thu ngan');
  const fresh = Orders.getOrder(order.id);
  const ref = Payments.customerQrPay(order.id, { method: 'qrcode' }, 'br1').reference;

  // Sai API key → từ chối (fail-closed), bill không bị đóng.
  assert.throws(
    () => Payments.handleSepayWebhook(
      { id: 'tx_bad', transferType: 'in', transferAmount: fresh.total, content: ref },
      { authorization: 'Apikey sai_key' }, 'br1'),
    /Sai API key/);
  assert.equal(Orders.getOrder(order.id).status, 'open');

  // Đúng API key + đúng nội dung + đủ tiền → bill tự đóng.
  Payments.handleSepayWebhook(
    { id: 'tx_ok', transferType: 'in', transferAmount: fresh.total, content: ref },
    { authorization: 'Apikey k_test_sepay' }, 'br1');
  assert.equal(Orders.getOrder(order.id).status, 'paid');
  assert.equal(Payments.paidForOrder(order.id), fresh.total);
});
