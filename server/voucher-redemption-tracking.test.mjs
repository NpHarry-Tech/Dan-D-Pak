// HIEU NANG + DUNG: voucher "usageLimit: once" truoc day kiem bang LIKE-scan
// KHONG INDEX toan bo orders/order_items moi lan sua gio hang o POS. Gio ghi
// nhan qua bang voucher_redemptions (index-backed) tai dung thoi diem CHOT
// THANH TOAN (payOrder trong payments.js goi recordVoucherRedemptions).
//
// Test nay khoa lai: (1) khach da dung voucher "once" thi khong duoc ap lai,
// (2) khach KHAC van dung duoc binh thuong, (3) du lieu LICH SU (don da paid
// tu TRUOC khi bang nay ton tai) van duoc bu dung qua backfill luc migrate().
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-voucher-redeem-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const { db, migrate, now } = await import('./db.js');
migrate();
const V = await import('./services/vouchers.js');

const B = 'sala';
const line = { sku_id: 'sku_once', qty: 1, price: 50000, name: 'Combo trưa' };
db.prepare(`INSERT INTO skus (id, branch_id, name, price, unit, active)
  VALUES ('sku_once', ?, 'Combo trưa', 50000, 'cái', 1)`).run(B);

function insertPaidOrder(id, { customerId, voucherId, lineVoucherId } = {}) {
  const customerJson = customerId ? JSON.stringify({ id: customerId, phone: '' }) : null;
  db.prepare(`INSERT INTO orders
    (id, branch_id, channel, status, subtotal, discount, total, created_at, paid_at, customer_json, voucher_id)
    VALUES (?, ?, 'retail', 'paid', 50000, 0, 50000, ?, ?, ?, ?)`)
    .run(id, B, now(), now(), customerJson, voucherId || null);
  if (lineVoucherId) {
    db.prepare(`INSERT INTO order_items
      (id, order_id, name, qty, unit_price, station, sla_minutes, mods_json, status, created_at, promo_json)
      VALUES (?, ?, 'Combo trưa', 1, 50000, 'retail', 0, '[]', 'served', ?, ?)`)
      .run(`${id}_item`, id, now(), JSON.stringify({ voucher_id: lineVoucherId }));
  }
}

test('voucher "once" bi chan tai ap cho CUNG mot khach sau khi da chot thanh toan', () => {
  const v = V.createVoucher({
    name: 'CTKM 1 lần/khách', code: 'ONCE_A', scope: 'sku', sku_id: 'sku_once',
    type: 'amount', value: 10000, usageLimit: 'once',
  }, B);

  const customerA = { id: 'cus_a', phone: '' };
  const before = V.calculateRetailDiscount([{ ...line, voucher_id: v.id }], null, B, { customer: customerA });
  assert.equal(before.discount, 10000, 'lần đầu phải được áp CTKM');

  // Mô phỏng đơn ĐÃ CHỐT thanh toán thật (đúng những gì payOrder() sẽ có: order
  // với voucher_id + customer_json).
  insertPaidOrder('order_paid_a', { customerId: customerA.id, voucherId: v.id });
  V.recordVoucherRedemptions('order_paid_a', B);

  // Client vẫn gửi voucher_id (UI cũ chưa refresh) sau khi khách đã dùng —
  // server phải TỪ CHỐI RÕ RÀNG, không được âm thầm bỏ qua rồi thu tiền đủ.
  assert.throws(
    () => V.calculateRetailDiscount([{ ...line, voucher_id: v.id }], null, B, { customer: customerA }),
    /khong kha dung/,
    'khách đã dùng rồi thì KHÔNG được áp lại',
  );

  const customerB = { id: 'cus_b', phone: '' };
  const otherCustomer = V.calculateRetailDiscount([{ ...line, voucher_id: v.id }], null, B, { customer: customerB });
  assert.equal(otherCustomer.discount, 10000, 'khách KHÁC vẫn dùng được bình thường');

  V.deleteVoucher(v.id, B);
});

test('voucher ap cap DONG (promo_json) cung duoc ghi nhan "da dung"', () => {
  const v = V.createVoucher({
    name: 'CTKM dòng 1 lần', code: 'ONCE_LINE', scope: 'sku', sku_id: 'sku_once',
    type: 'amount', value: 5000, usageLimit: 'once',
  }, B);
  const customer = { id: 'cus_line', phone: '' };

  const before = V.calculateRetailDiscount([{ ...line, voucher_id: v.id }], null, B, { customer });
  assert.equal(before.discount, 5000, 'chưa dùng thì vẫn phải áp được');

  insertPaidOrder('order_paid_line', { customerId: customer.id, lineVoucherId: v.id });
  V.recordVoucherRedemptions('order_paid_line', B);

  assert.throws(
    () => V.calculateRetailDiscount([{ ...line, voucher_id: v.id }], null, B, { customer }),
    /khong kha dung/,
    'voucher ghi nhận qua promo_json của dòng cũng phải chặn tái sử dụng',
  );
  V.deleteVoucher(v.id, B);
});

test('du lieu LICH SU (don paid tu truoc khi co bang redemption) van duoc bu qua backfill', () => {
  const v = V.createVoucher({
    name: 'CTKM cũ', code: 'LEGACY_ONCE', scope: 'sku', sku_id: 'sku_once',
    type: 'amount', value: 7000, usageLimit: 'once',
  }, B);
  const legacyCustomer = { id: 'cus_legacy', phone: '' };

  const before = V.calculateRetailDiscount([{ ...line, voucher_id: v.id }], null, B, { customer: legacyCustomer });
  assert.equal(before.discount, 7000, 'trước khi có đơn lịch sử thì vẫn áp được bình thường');

  // Chèn thẳng đơn "lịch sử" — KHÔNG gọi recordVoucherRedemptions (mô phỏng dữ
  // liệu có TỪ TRƯỚC khi tính năng này tồn tại) — rồi chạy lại backfill logic
  // bằng cách gọi lại migrate() (idempotent, nhưng backfill chỉ chạy khi bảng
  // voucher_redemptions còn trống — ở đây ta xoá sạch bảng để mô phỏng đúng
  // tình huống "bảng vừa được tạo trên DB cũ đã có dữ liệu").
  insertPaidOrder('order_legacy', { customerId: legacyCustomer.id, voucherId: v.id });
  db.prepare(`DELETE FROM voucher_redemptions`).run();
  migrate();

  assert.throws(
    () => V.calculateRetailDiscount([{ ...line, voucher_id: v.id }], null, B, { customer: legacyCustomer }),
    /khong kha dung/,
    'đơn lịch sử phải được bù vào bảng redemption qua backfill lúc migrate()',
  );
  V.deleteVoucher(v.id, B);
});
