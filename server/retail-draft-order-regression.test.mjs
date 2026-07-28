// Đơn nháp cho chuyển khoản: trước đây đơn retail chỉ được tạo lúc bấm "Xác nhận"
// cuối cùng, nên webhook SePay/Casso/payOS không có "đơn đang mở" để khớp trong lúc
// khách đang quét QR → tiền về thật nhưng bill không tự đóng được. Test này khoá lại
// hành vi: đơn nháp được tạo THẬT ('open', chưa trừ kho) khi mở QR, webhook khớp đúng
// nội dung chuyển khoản thì tự đóng bill (đúng cơ chế processIncomingCredit đã có sẵn
// cho đơn tại bàn), và đơn nháp bị hủy an toàn nếu khách đổi ý / chưa có tiền về.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-retail-draft-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const { db, migrate, now } = await import('./db.js');
const Inventory = await import('./services/inventory.js');
const Retail = await import('./services/retail.js');
const Payments = await import('./services/payments.js');
const Settings = await import('./services/settings.js');

migrate();
db.prepare(`INSERT INTO shifts (id,branch_id,user_name,shift_key,shift_label,opening_cash,status,opened_at) VALUES (?,?,?,?,?,?,?,?)`)
  .run('shift_draft', 'br1', 'Tester', 'test', 'Test', 0, 'open', now());
Settings.updateIntegrations({ channels: { sepay: { enabled: true, apiKey: 'test-sepay-key' } } }, 'br1');

test('draft order is created open, unpaid, without deducting stock', () => {
  Inventory.createSku({ id: 'sku_draft_a', name: 'Draft SKU A', price: 20000, stock: 5 }, 'br1');
  const order = Retail.createDraftOrder({
    items: [{ sku_id: 'sku_draft_a', qty: 2 }],
    branch_id: 'br1',
    cashier: 'Tester',
  });
  assert.equal(order.status, 'open');
  assert.equal(order.total, 40000);
  assert.equal(db.prepare(`SELECT stock FROM skus WHERE id='sku_draft_a'`).get().stock, 5);
});

test('SePay webhook auto-settles a draft order it can find (no manual confirm needed)', () => {
  Inventory.createSku({ id: 'sku_draft_b', name: 'Draft SKU B', price: 15000, stock: 3 }, 'br1');
  const order = Retail.createDraftOrder({
    items: [{ sku_id: 'sku_draft_b', qty: 1 }],
    branch_id: 'br1',
    cashier: 'Tester',
  });
  // billNoDigits() bên server bỏ hẳn chữ "Dan" đầu bill_no — chỉ ghép phần số vào
  // sau tiền tố (tránh lặp "DANBILLDAN..." không cần thiết).
  const ref = 'DANBILL' + order.bill_no.replace(/^\D+/, '');
  const result = Payments.handleSepayWebhook({
    id: 'sepay_tx_1',
    transferType: 'in',
    transferAmount: 15000,
    content: `NGUYEN VAN A CHUYEN KHOAN ${ref} THANH TOAN`,
  }, { authorization: 'Apikey test-sepay-key' }, 'br1');

  assert.equal(result.status, 'paid');
  assert.equal(result.order_id, order.id);
  const settled = db.prepare(`SELECT status FROM orders WHERE id=?`).get(order.id);
  assert.equal(settled.status, 'paid');
  assert.equal(db.prepare(`SELECT stock FROM skus WHERE id='sku_draft_b'`).get().stock, 2);
});

test('ALREADY_SETTLED: settling an order whose recorded payments already cover the total fails gracefully (Vietnamese + 409), not a raw English crash', () => {
  // payOrder() có 1 nhánh phòng thủ cho khi status vẫn 'partially_paid' (chưa kịp
  // chuyển 'paid') nhưng tổng tiền đã ghi nhận qua payment_lines đã đủ — dựng thẳng
  // trạng thái DB này để khoá đúng nhánh code payments.js vừa sửa (trước đây ném
  // nguyên văn tiếng Anh "Order has no remaining balance" cho thu ngân).
  Inventory.createSku({ id: 'sku_draft_c', name: 'Draft SKU C', price: 10000, stock: 2 }, 'br1');
  const order = Retail.createDraftOrder({
    items: [{ sku_id: 'sku_draft_c', qty: 1 }],
    branch_id: 'br1',
    cashier: 'Tester',
  });
  db.prepare(`UPDATE orders SET status='partially_paid' WHERE id=?`).run(order.id);
  db.prepare(`INSERT INTO payments (id,order_id,total,created_at) VALUES (?,?,?,?)`)
    .run('pay_sim_1', order.id, order.total, now());
  db.prepare(`INSERT INTO payment_lines (id,payment_id,method,amount,tendered_amount) VALUES (?,?,?,?,?)`)
    .run('pl_sim_1', 'pay_sim_1', 'cash', order.total, order.total);

  assert.throws(
    () => Payments.payOrder(order.id, [{ method: 'cash', amount: order.total }], { cashier: 'Tester' }, 'br1'),
    (err) => {
      assert.equal(err.code, 'ALREADY_SETTLED');
      assert.equal(err.status, 409);
      assert.doesNotMatch(err.message, /remaining balance/i);
      return true;
    },
  );
});

test('a late webhook credit for a bill that already closed is parked as unmatched, not silently applied twice', () => {
  Inventory.createSku({ id: 'sku_draft_c2', name: 'Draft SKU C2', price: 10000, stock: 2 }, 'br1');
  const order = Retail.createDraftOrder({
    items: [{ sku_id: 'sku_draft_c2', qty: 1 }],
    branch_id: 'br1',
    cashier: 'Tester',
  });
  // billNoDigits() bên server bỏ hẳn chữ "Dan" đầu bill_no — chỉ ghép phần số vào
  // sau tiền tố (tránh lặp "DANBILLDAN..." không cần thiết).
  const ref = 'DANBILL' + order.bill_no.replace(/^\D+/, '');
  // Thu ngân xác nhận tay TRƯỚC khi webhook kịp về (race thật ngoài đời) — order
  // rời khỏi tập 'open'/'partially_paid' nên webhook không còn gì để khớp nữa.
  Payments.payOrder(order.id, [{ method: 'cash', amount: 10000 }], { cashier: 'Tester' }, 'br1');

  const late = Payments.handleSepayWebhook({
    id: 'sepay_tx_late',
    transferType: 'in',
    transferAmount: 10000,
    content: `KHACH CHUYEN NHAM ${ref} SAU KHI DA TRA TIEN MAT`,
  }, { authorization: 'Apikey test-sepay-key' }, 'br1');

  assert.equal(late.status, 'unmatched');
  assert.equal(db.prepare(`SELECT stock FROM skus WHERE id='sku_draft_c2'`).get().stock, 1);
});

test('voidDraftOrder cancels an unpaid draft but refuses once payment exists', () => {
  Inventory.createSku({ id: 'sku_draft_d', name: 'Draft SKU D', price: 5000, stock: 1 }, 'br1');
  const draft = Retail.createDraftOrder({
    items: [{ sku_id: 'sku_draft_d', qty: 1 }],
    branch_id: 'br1',
    cashier: 'Tester',
  });
  Retail.voidDraftOrder(draft.id, 'br1');
  assert.equal(db.prepare(`SELECT status FROM orders WHERE id=?`).get(draft.id).status, 'void');
  // Kho không bị đụng tới vì đơn nháp chưa bao giờ settle.
  assert.equal(db.prepare(`SELECT stock FROM skus WHERE id='sku_draft_d'`).get().stock, 1);

  // Đơn đã đóng đủ (status='paid') → chặn ở kiểm tra trạng thái trước tiên.
  Inventory.createSku({ id: 'sku_draft_e', name: 'Draft SKU E', price: 5000, stock: 1 }, 'br1');
  const paid = Retail.createDraftOrder({
    items: [{ sku_id: 'sku_draft_e', qty: 1 }],
    branch_id: 'br1',
    cashier: 'Tester',
  });
  Payments.payOrder(paid.id, [{ method: 'cash', amount: 5000 }], { cashier: 'Tester' }, 'br1');
  assert.throws(() => Retail.voidDraftOrder(paid.id, 'br1'), /đã đóng/);

  // Đã trả một phần (vẫn 'partially_paid') → chặn ở kiểm tra đã có thanh toán,
  // để không "hủy" một đơn mà khách đã thật sự chuyển tiền vào.
  Inventory.createSku({ id: 'sku_draft_f', name: 'Draft SKU F', price: 20000, stock: 1 }, 'br1');
  const partial = Retail.createDraftOrder({
    items: [{ sku_id: 'sku_draft_f', qty: 1 }],
    branch_id: 'br1',
    cashier: 'Tester',
  });
  Payments.payOrder(partial.id, [{ method: 'cash', amount: 5000 }], { cashier: 'Tester' }, 'br1');
  assert.equal(db.prepare(`SELECT status FROM orders WHERE id=?`).get(partial.id).status, 'partially_paid');
  assert.throws(() => Retail.voidDraftOrder(partial.id, 'br1'), /đã có thanh toán/);
});

test('a webhook redelivery for a previously-unmatched external_id gets a real second chance once the order exists', () => {
  // Race thật ngoài đời: khách chuyển khoản cực nhanh trước khi đơn nháp kịp tạo
  // xong (hoặc webhook tới lúc đơn tạm thời không "open"), lần đầu ghi 'unmatched'.
  // SePay gửi lại (hoặc merchant tự bấm "Gửi lại" trong Lịch sử gửi) sau khi đơn đã
  // sẵn sàng — trước đây bị chặn vĩnh viễn ở bước check trùng external_id, y hệt
  // cảm giác "hên xui" người dùng gặp phải. Giờ lần gửi lại phải khớp và đóng bill.
  const first = Payments.handleSepayWebhook({
    id: 'sepay_retry_1',
    transferType: 'in',
    transferAmount: 15000,
    content: 'CHUYEN KHOAN NHAM LUC DON CHUA SAN SANG KHONG KHOP BILL NAO',
  }, { authorization: 'Apikey test-sepay-key' }, 'br1');
  assert.equal(first.status, 'unmatched');

  Inventory.createSku({ id: 'sku_retry_a', name: 'Retry SKU A', price: 15000, stock: 2 }, 'br1');
  const order = Retail.createDraftOrder({
    items: [{ sku_id: 'sku_retry_a', qty: 1 }],
    branch_id: 'br1',
    cashier: 'Tester',
  });
  // billNoDigits() bên server bỏ hẳn chữ "Dan" đầu bill_no — chỉ ghép phần số vào
  // sau tiền tố (tránh lặp "DANBILLDAN..." không cần thiết).
  const ref = 'DANBILL' + order.bill_no.replace(/^\D+/, '');

  const retry = Payments.handleSepayWebhook({
    id: 'sepay_retry_1', // CÙNG external_id — mô phỏng gửi lại
    transferType: 'in',
    transferAmount: 15000,
    content: `NGUYEN VAN A CHUYEN KHOAN ${ref} THANH TOAN LAN 2`,
  }, { authorization: 'Apikey test-sepay-key' }, 'br1');

  assert.equal(retry.status, 'paid');
  assert.equal(retry.order_id, order.id);
  assert.equal(db.prepare(`SELECT status FROM orders WHERE id=?`).get(order.id).status, 'paid');
  assert.equal(
    db.prepare(`SELECT status FROM bank_transactions WHERE external_id='sepay_retry_1'`).get().status,
    'paid',
  );
});

test('a custom transfer prefix (e.g. "TEST") never carries the bill_no\'s own "Dan" letters along with it', () => {
  // Người dùng đổi "Tiền tố nội dung CK" thành "TEST" và mong mã đối soát ra
  // "TEST270726004" — trước đây ra "TESTDAN270726004" (thừa "DAN" của chính số
  // hoá đơn "Dan270726004", không liên quan gì tới tiền tố cấu hình riêng).
  Settings.updateIntegrations({ channels: { sepay: { enabled: true, apiKey: 'test-sepay-key' } } }, 'br1');
  const opsBefore = Settings.updateSettings({
    operations_config: { payment: { transferPrefix: 'TEST' } },
  }, 'br1').operations_config;
  assert.equal(opsBefore.payment.transferPrefix, 'TEST');

  Inventory.createSku({ id: 'sku_prefix_a', name: 'Prefix SKU A', price: 12000, stock: 2 }, 'br1');
  const order = Retail.createDraftOrder({
    items: [{ sku_id: 'sku_prefix_a', qty: 1 }],
    branch_id: 'br1',
    cashier: 'Tester',
  });
  const digitsOnly = order.bill_no.replace(/^\D+/, '');
  assert.ok(digitsOnly.length > 0 && !/[A-Za-z]/.test(digitsOnly));

  // Nội dung chuyển khoản CHỈ chứa "TEST" + số — KHÔNG có chữ "DAN" nào — vẫn
  // phải khớp đúng đơn.
  const result = Payments.handleSepayWebhook({
    id: 'sepay_prefix_1',
    transferType: 'in',
    transferAmount: 12000,
    content: `NGUYEN VAN A CHUYEN KHOAN TEST${digitsOnly} THANH TOAN`,
  }, { authorization: 'Apikey test-sepay-key' }, 'br1');

  assert.equal(result.status, 'paid');
  assert.equal(result.order_id, order.id);

  // Đặt lại tiền tố mặc định để không ảnh hưởng các test khác chạy sau trong file này.
  Settings.updateSettings({
    operations_config: { payment: { transferPrefix: 'DANBILL' } },
  }, 'br1');
});
