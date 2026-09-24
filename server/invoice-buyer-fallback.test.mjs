// NGƯỜI MUA trên HĐĐT phải theo đúng KHÁCH đã gắn vào đơn (chọn ở POS), không ép
// "Bán cho người tiêu dùng". Chỉ xuất thông tin doanh nghiệp khi khách yêu cầu
// rõ ràng và có đủ MST + tên + địa chỉ; email chỉ là kênh nhận, không phải điều
// kiện pháp lý. Khách được gắn vào đơn nhưng không yêu cầu hóa đơn vẫn là consumer.
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

test('khach yeu cau HD va co MST + ten + dia chi -> nguoi mua HD = CONG TY', () => {
  const r = Retail.checkout({
    items: [{ sku_id: 'sku_buyer', qty: 1 }],
    payments: [{ method: 'cash', amount: 20000 }],
    branch_id: 'sala', cashier: 'Admin', client_request_id: 'reqCty',
    issue_einvoice: true,
    invoice_customer: { invoice_request: true, name: 'Nguyen Phuc Huy', company: 'Cong ty ABC', tax_code: '0316756674', address: '1 Nguyen Hue', email: 'huy@abc.vn', phone: '0363045747' },
  });
  const b = buyerOf(r.order_id);
  assert.equal(b.customer_mode, 'COMPANY_TAX_INFO', 'phai la hoa don cong ty');
  assert.notEqual(b.buyer_name, 'Bán cho người tiêu dùng');
  assert.match(b.buyer_name, /ABC|Huy/);
});

test('khach chi duoc gan vao don nhung khong yeu cau HD -> consumer', () => {
  const r = Retail.checkout({
    items: [{ sku_id: 'sku_buyer', qty: 1 }],
    payments: [{ method: 'cash', amount: 20000 }],
    branch_id: 'sala', cashier: 'Admin', client_request_id: 'reqCaNhan',
    issue_einvoice: true,
    customer: { name: 'Tran Thi B', phone: '0900000000' },
  });
  const b = buyerOf(r.order_id);
  assert.equal(b.customer_mode, 'WALK_IN');
  assert.equal(b.buyer_name, 'Bán cho người tiêu dùng');
});

test('KHONG khach -> consumer nhu cu', () => {
  const r = Retail.checkout({
    items: [{ sku_id: 'sku_buyer', qty: 1 }],
    payments: [{ method: 'cash', amount: 20000 }],
    branch_id: 'sala', cashier: 'Admin', client_request_id: 'reqWalkin',
    issue_einvoice: true,
  });
  const b = buyerOf(r.order_id);
  assert.equal(b.customer_mode, 'WALK_IN');
  assert.equal(b.buyer_name, 'Bán cho người tiêu dùng');
});

test('khach yeu cau HD cong ty du MST + ten + dia chi nhung thieu email van hop le', () => {
  const r = Retail.checkout({
    items: [{ sku_id: 'sku_buyer', qty: 1 }],
    payments: [{ method: 'cash', amount: 20000 }],
    branch_id: 'sala', cashier: 'Admin', client_request_id: 'reqNoEmail',
    issue_einvoice: true,
    invoice_customer: { invoice_request: true, name: 'Cong ty X', company: 'Cong ty X', tax_code: '0316756674', address: '2 Le Loi' },
  });
  // Thu tien phai thanh cong (khong throw), va van tao duoc ban ghi HDDT.
  assert.ok(r.order_id, 'thu tien thanh cong du thieu email');
  const b = buyerOf(r.order_id);
  assert.equal(b.customer_mode, 'COMPANY_TAX_INFO');
});
