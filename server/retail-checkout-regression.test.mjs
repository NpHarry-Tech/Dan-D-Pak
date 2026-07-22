import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-retail-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');

const { db, migrate, now } = await import('./db.js');
const { PERMANENT_ROOT } = await import('./services/archive.js');
const Inventory = await import('./services/inventory.js');
const Catalog = await import('./services/catalog.js');
const Orders = await import('./services/orders.js');
const Payments = await import('./services/payments.js');
const Tax = await import('./services/tax.js');
const Retail = await import('./services/retail.js');
const CashDrawer = await import('./services/cashDrawer.js');
const Customers = await import('./services/customers.js');

migrate();

test('shared search stays consistent across catalog, inventory and contacts', () => {
  Inventory.createSku({
    id: 'sku_search', name: 'Sữa Hạnh Nhân', barcode: '893-search',
    category: 'Đồ uống', price: 10000, stock: 1,
  }, 'br1');
  const skuPage = Inventory.listSkus('br1', { q: 'sua uong', page: 1, limit: 40 });
  assert.deepEqual(skuPage.items.map(row => row.id), ['sku_search']);

  db.prepare(`INSERT INTO menu_items (id,category_id,name,description,price,station) VALUES (?,?,?,?,?,?)`)
    .run('menu_search', 'cat_search', 'Cà Phê Sữa', 'Đá lạnh', 30000, 'bar');
  const menuPage = Catalog.listMenu({ page: 1, q: 'ca lanh' });
  assert.deepEqual(menuPage.items.map(row => row.id), ['menu_search']);

  Customers.upsertCustomer({ name: 'Nguyễn An', company: 'Công ty Hạt Việt', phone: '0900000000' }, 'br1');
  const contacts = Customers.listCustomers('br1', 'nguyen hat');
  assert.equal(contacts.length, 1);
  assert.equal(contacts[0].name, 'Nguyễn An');
});

test('retail checkout separates change and deduplicates retries', () => {
  const shiftId = 'shift_test';
  db.prepare(`INSERT INTO shifts (id,branch_id,user_name,shift_key,shift_label,opening_cash,status,opened_at) VALUES (?,?,?,?,?,?,?,?)`)
    .run(shiftId, 'br1', 'Tester', 'test', 'Test', 0, 'open', now());
  Inventory.createSku({ id: 'sku_paid', name: 'Paid SKU', price: 30000, stock: 3 }, 'br1');

  const payload = {
    items: [{ sku_id: 'sku_paid', qty: 1 }],
    payments: [{ method: 'cash', amount: 100000 }],
    client_request_id: 'checkout_retry_1',
    branch_id: 'br1',
    cashier: 'Tester',
  };
  const first = Retail.checkout(payload);
  const replay = Retail.checkout(payload);

  assert.equal(first.total, 30000);
  assert.equal(first.paid, 100000);
  assert.equal(first.change, 70000);
  assert.equal(replay.order_id, first.order_id);
  assert.equal(replay.paid, 100000);
  assert.equal(replay.change, 70000);
  assert.equal(replay.idempotent_replay, true);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM orders WHERE client_request_id='checkout_retry_1'`).get().n, 1);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM payments`).get().n, 1);
  assert.equal(db.prepare(`SELECT stock FROM skus WHERE id='sku_paid'`).get().stock, 2);
  const paymentLine = db.prepare(`SELECT amount,tendered_amount FROM payment_lines`).get();
  assert.equal(paymentLine.amount, 30000);
  assert.equal(paymentLine.tendered_amount, 100000);
  assert.equal(CashDrawer.cashSalesForShift(shiftId), 30000);
  assert.equal(PERMANENT_ROOT, join(temp, 'storage', 'permanent-storage'));
});

test('sellable SKU without a price is blocked', () => {
  Inventory.createSku({ id: 'sku_free', name: 'Unpriced SKU', price: 0, stock: 1 }, 'br1');
  assert.throws(() => Retail.checkout({
    items: [{ sku_id: 'sku_free', qty: 1 }],
    payments: [],
    client_request_id: 'checkout_unpriced_1',
    branch_id: 'br1',
  }), /SKU chưa có giá bán/);
  assert.equal(db.prepare(`SELECT stock FROM skus WHERE id='sku_free'`).get().stock, 1);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM orders WHERE client_request_id='checkout_unpriced_1'`).get().n, 0);
});

test('retail VAT supports tax-exclusive and tax-inclusive prices', () => {
  Inventory.createSku({ id: 'sku_net', name: 'Net SKU', price: 100000, vat: 10, price_includes_vat: false, stock: 1 }, 'br1');
  Inventory.createSku({ id: 'sku_gross', name: 'Gross SKU', price: 108000, vat: 8, price_includes_vat: true, stock: 1 }, 'br1');
  const receipt = Retail.checkout({
    items: [{ sku_id: 'sku_net', qty: 1 }, { sku_id: 'sku_gross', qty: 1 }],
    payments: [{ method: 'cash', amount: 218000 }],
    client_request_id: 'checkout_vat_1',
    branch_id: 'br1',
    cashier: 'Tester',
  });
  assert.equal(receipt.subtotal, 218000);
  assert.equal(receipt.goods_amount, 200000);
  assert.equal(receipt.vat_amount, 18000);
  assert.equal(receipt.total, 218000);
  assert.deepEqual(receipt.items.map(item => [item.unit_price, item.vat_rate]), [[110000, 10], [108000, 8]]);
  assert.deepEqual(Tax.orderVatTotals(receipt.items, 109000), {
    subtotal: 218000, goods_amount: 100000, vat_amount: 9000, total: 109000,
  });
});

test('F&B VAT is added from the authoritative menu setting', () => {
  db.prepare(`INSERT INTO menu_items (id,category_id,name,price,price_includes_vat,vat_rate,station) VALUES (?,?,?,?,?,?,?)`)
    .run('menu_net', 'cat_test', 'Net Menu Item', 100000, 0, 8, 'kitchen');
  assert.equal(Catalog.getMenuItem('menu_net').sale_price, 108000);
  const order = Orders.createOrUpdateOrder({
    branch_id: 'br1',
    channel: 'takeaway',
    items: [{ menu_item_id: 'menu_net', qty: 1 }],
    actor: 'Tester',
  });
  assert.equal(order.subtotal, 108000);
  assert.equal(order.goods_amount, 100000);
  assert.equal(order.vat_amount, 8000);
  const receipt = Payments.payOrder(order.id, [{ method: 'cash', amount: 108000 }], { cashier: 'Tester' }, 'br1');
  assert.equal(receipt.total, 108000);
  assert.equal(receipt.vat_amount, 8000);
});

test('legacy overpayments are corrected once during migration', () => {
  const legacy = new DatabaseSync(join(temp, 'legacy.db'));
  legacy.exec(`
    CREATE TABLE payments (id TEXT PRIMARY KEY,order_id TEXT NOT NULL,total INTEGER NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE payment_lines (id TEXT PRIMARY KEY,payment_id TEXT NOT NULL,method TEXT NOT NULL,amount INTEGER NOT NULL,reference TEXT);
    INSERT INTO payments VALUES ('pay_old','order_old',30000,'2026-07-22T00:00:00.000Z');
    INSERT INTO payment_lines VALUES ('line_old','pay_old','cash',100000,NULL);
  `);
  migrate(legacy);
  migrate(legacy);
  const line = legacy.prepare(`SELECT amount,tendered_amount FROM payment_lines WHERE id='line_old'`).get();
  assert.equal(line.amount, 30000);
  assert.equal(line.tendered_amount, 100000);
  legacy.close();
});

test.after(() => {
  db.close();
  rmSync(temp, { recursive: true, force: true });
});
