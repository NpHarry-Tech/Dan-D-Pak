// NGƯỜI MUA trên HĐĐT phải theo đúng KHÁCH đã gắn vào đơn (chọn ở POS), không ép
// "Bán cho người tiêu dùng". MST+email đủ → hóa đơn công ty; chỉ có tên → cá nhân;
// không khách → consumer. MST mà THIẾU email KHÔNG được làm hỏng thu tiền.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-buyer-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');

const { db, migrate, now } = await import('./db.js');
const Inventory = await import('./services/inventory.js');
const Retail = await import('./services/retail.js');

migrate();
db.prepare(`INSERT OR IGNORE INTO categories (id,branch_id,name) VALUES ('cat_buyer','sala','Test')`).run();
db.prepare(`INSERT INTO shifts (id,branch_id,user_name,shift_key,shift_label,opening_cash,status,opened_at) VALUES (?,?,?,?,?,?,?,?)`)
  .run('shift_buyer', 'sala', 'Tester', 'buyer', 'Buyer', 0, 'open', now());
Inventory.createSku({ id: 'sku_buyer', name: 'Hat dieu', barcode: 'b-buyer', category: 'Hat', price: 20000, stock: 100 }, 'sala');

function buyerOf(orderId) {
  return db.prepare(`SELECT buyer_name, customer_mode FROM e_invoices WHERE order_id=?`).get(orderId);
}

test('khach CO MST + email -> nguoi mua HD = CONG TY (khong phai consumer)', () => {
  const r = Retail.checkout({
    items: [{ sku_id: 'sku_buyer', qty: 1 }],
    payments: [{ method: 'cash', amount: 20000 }],
    branch_id: 'sala', cashier: 'Admin', client_request_id: 'reqCty',
    customer: { name: 'Nguyen Phuc Huy', company: 'Cong ty ABC', tax_code: '0316756674', email: 'huy@abc.vn', phone: '0363045747' },
  });
  const b = buyerOf(r.order_id);
  assert.equal(b.customer_mode, 'COMPANY_TAX_INFO', 'phai la hoa don cong ty');
  assert.notEqual(b.buyer_name, 'Bán cho người tiêu dùng');
  assert.match(b.buyer_name, /ABC|Huy/);
});

test('khach chi co TEN (khong MST) -> nguoi mua CA NHAN dung ten', () => {
  const r = Retail.checkout({
    items: [{ sku_id: 'sku_buyer', qty: 1 }],
    payments: [{ method: 'cash', amount: 20000 }],
    branch_id: 'sala', cashier: 'Admin', client_request_id: 'reqCaNhan',
    customer: { name: 'Tran Thi B', phone: '0900000000' },
  });
  const b = buyerOf(r.order_id);
  assert.equal(b.customer_mode, 'BUYER_PROVIDED_INFO');
  assert.equal(b.buyer_name, 'Tran Thi B');
});

test('KHONG khach -> consumer nhu cu', () => {
  const r = Retail.checkout({
    items: [{ sku_id: 'sku_buyer', qty: 1 }],
    payments: [{ method: 'cash', amount: 20000 }],
    branch_id: 'sala', cashier: 'Admin', client_request_id: 'reqWalkin',
  });
  const b = buyerOf(r.order_id);
  assert.equal(b.customer_mode, 'WALK_IN');
  assert.equal(b.buyer_name, 'Bán cho người tiêu dùng');
});

test('khach co MST nhung THIEU email -> KHONG lam hong thu tien (ha ve an toan)', () => {
  const r = Retail.checkout({
    items: [{ sku_id: 'sku_buyer', qty: 1 }],
    payments: [{ method: 'cash', amount: 20000 }],
    branch_id: 'sala', cashier: 'Admin', client_request_id: 'reqNoEmail',
    customer: { name: 'Cong ty X', company: 'Cong ty X', tax_code: '0316756674' },
  });
  // Thu tien phai thanh cong (khong throw), va van tao duoc ban ghi HDDT.
  assert.ok(r.order_id, 'thu tien thanh cong du thieu email');
  const b = buyerOf(r.order_id);
  // Thieu email cho mode cong ty -> ha ve ca nhan (hien ten) hoac consumer, khong throw.
  assert.notEqual(b.customer_mode, 'COMPANY_TAX_INFO');
});
