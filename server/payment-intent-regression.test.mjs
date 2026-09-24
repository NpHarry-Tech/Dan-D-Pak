import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-payment-intent-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.PRINT_DISPATCH = 'agent';

const { db, migrate, now } = await import('./db.js');
const Inventory = await import('./services/inventory.js');
const Retail = await import('./services/retail.js');
const Payments = await import('./services/payments.js');
const Settings = await import('./services/settings.js');
const History = await import('./services/history.js');

migrate();
db.prepare(`INSERT INTO shifts (id,branch_id,user_name,shift_key,shift_label,opening_cash,status,opened_at)
  VALUES (?,?,?,?,?,?,?,?)`).run('shift_pi', 'sala', 'Tester', 'test', 'Test', 0, 'open', now());
Settings.updateSettings({ operations_config: { payment: {
  bankCode: 'VCB', bankAccount: '1020352657', accountName: 'DAN D PAK', transferPrefix: 'BCM-VF',
} } }, 'sala');
Settings.updateIntegrations({ channels: { sepay: { enabled: true, apiKey: 'intent-key' } } }, 'sala');

test('reference = orders.pay_ref: sanitized 12-digit code [reg3][DDMMYY][rand3], unique per order, and STABLE for the life of the cart', async () => {
  Inventory.createSku({ id: 'sku_pi_1', name: 'PI one', price: 10000, stock: 5 }, 'sala');
  const first = Retail.createDraftOrder({ items: [{ sku_id: 'sku_pi_1', qty: 1 }], branch_id: 'sala' });
  const second = Retail.createDraftOrder({ items: [{ sku_id: 'sku_pi_1', qty: 1 }], branch_id: 'sala' });
  const qr1 = await Payments.generateCustomerPaymentQr(first.id, { method: 'qrcode' }, 'sala');
  const qr2 = await Payments.generateCustomerPaymentQr(second.id, { method: 'qrcode' }, 'sala');
  // Dạng mới: 12 chữ số [3 số máy POS][DDMMYY][3 số ngẫu nhiên], không tiền tố chữ.
  // Mã CHÍNH LÀ orders.pay_ref — cấp lúc mở đơn, không phải dãy đối soát riêng nữa.
  assert.match(qr1.reference, /^\d{12}$/);
  assert.equal(qr1.reference, db.prepare(`SELECT pay_ref FROM orders WHERE id=?`).get(first.id).pay_ref);
  assert.notEqual(qr1.reference, qr2.reference);
  // Đi theo giỏ hàng: tạo lại QR cho CÙNG đơn vẫn ra đúng một mã (không đổi).
  const qr1again = await Payments.generateCustomerPaymentQr(first.id, { method: 'qrcode' }, 'sala');
  assert.equal(qr1again.reference, qr1.reference);
});

test('bank auto-confirm requires exact account, reference and amount', async () => {
  Inventory.createSku({ id: 'sku_pi_2', name: 'PI exact', price: 15000, stock: 3 }, 'sala');
  const order = Retail.createDraftOrder({ items: [{ sku_id: 'sku_pi_2', qty: 1 }], branch_id: 'sala' });
  const qr = await Payments.generateCustomerPaymentQr(order.id, { method: 'qrcode' }, 'sala');
  const auth = { authorization: 'Apikey intent-key' };
  assert.equal(Payments.handleSepayWebhook({ id: 'wrong_amount', transferType: 'in', transferAmount: 14999,
    content: qr.reference, accountNumber: qr.bankAccount }, auth, 'sala').status, 'unmatched');
  assert.equal(Payments.handleSepayWebhook({ id: 'substring', transferType: 'in', transferAmount: 15000,
    content: `PAY ${qr.reference}`, accountNumber: qr.bankAccount }, auth, 'sala').status, 'unmatched');
  assert.equal(Payments.handleSepayWebhook({ id: 'exact', transferType: 'in', transferAmount: 15000,
    content: qr.reference, accountNumber: qr.bankAccount }, auth, 'sala').status, 'paid');
  assert.equal(db.prepare(`SELECT status FROM orders WHERE id=?`).get(order.id).status, 'paid');
  const intent = db.prepare(`SELECT * FROM payment_intents WHERE order_id=?`).get(order.id);
  assert.equal(intent.state, 'SUCCEEDED');
  assert.ok(intent.payment_id);
  assert.ok(intent.payment_line_id);
  assert.equal(intent.bill_no, db.prepare(`SELECT bill_no FROM orders WHERE id=?`).get(order.id).bill_no);
  const internal = History.orderReceipt(order.id, 'sala');
  assert.equal(internal.payment_reconciliation[0].reference, qr.reference);
  assert.equal(JSON.stringify(internal.lines).includes(qr.reference), false);
  assert.equal(JSON.stringify(db.prepare(`SELECT snapshot_json FROM sale_snapshots WHERE order_id=?`).get(order.id)).includes(qr.reference), false);
});

test('leading 3 digits = POS register number (per branch), stable per device; orders with no machine get 000', () => {
  Inventory.createSku({ id: 'sku_reg', name: 'Reg', price: 12000, stock: 9 }, 'sala');
  const reg = (o) => db.prepare(`SELECT pay_ref FROM orders WHERE id=?`).get(o.id).pay_ref.slice(0, 3);
  const a1 = Retail.createDraftOrder({ items: [{ sku_id: 'sku_reg', qty: 1 }], branch_id: 'sala', device_id: 'dev_reg_A' });
  const b1 = Retail.createDraftOrder({ items: [{ sku_id: 'sku_reg', qty: 1 }], branch_id: 'sala', device_id: 'dev_reg_B' });
  const a2 = Retail.createDraftOrder({ items: [{ sku_id: 'sku_reg', qty: 1 }], branch_id: 'sala', device_id: 'dev_reg_A' });
  const none = Retail.createDraftOrder({ items: [{ sku_id: 'sku_reg', qty: 1 }], branch_id: 'sala' });
  assert.equal(reg(a1), reg(a2), 'cùng máy → cùng số hiệu register');
  assert.notEqual(reg(a1), reg(b1), 'máy khác → số hiệu khác');
  assert.equal(reg(none), '000', 'đơn không gắn máy → 000');
});

test('expired QR receiving money is retained as late reconciliation and never closes order', async () => {
  Inventory.createSku({ id: 'sku_pi_late', name: 'PI late', price: 17000, stock: 3 }, 'sala');
  const order = Retail.createDraftOrder({ items: [{ sku_id: 'sku_pi_late', qty: 1 }], branch_id: 'sala' });
  const qr = await Payments.generateCustomerPaymentQr(order.id, { method: 'qrcode' }, 'sala');
  db.prepare(`UPDATE payment_intents SET expires_at=? WHERE id=?`).run('2000-01-01T00:00:00.000Z', qr.payment_intent_id);
  const result = Payments.handleSepayWebhook({ id: 'late_exact', transferType: 'in', transferAmount: 17000,
    content: qr.reference, accountNumber: qr.bankAccount }, { authorization: 'Apikey intent-key' }, 'sala');
  assert.equal(result.status, 'late_received');
  assert.equal(db.prepare(`SELECT status FROM orders WHERE id=?`).get(order.id).status, 'open');
  assert.equal(db.prepare(`SELECT state FROM payment_intents WHERE id=?`).get(qr.payment_intent_id).state, 'LATE_RECEIVED');
});
