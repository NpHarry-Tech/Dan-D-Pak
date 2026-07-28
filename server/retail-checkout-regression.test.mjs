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
const Einvoices = await import('./services/einvoice.js');

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

test('retail SKU listing filters "in stock" and sorts BEFORE pagination, not after', () => {
  // Trước đây "Còn hàng" lọc phía app SAU KHI đã cắt trang 40 SKU — nếu phần lớn
  // hết hàng, trang hiện ra rất ít món dù server còn nhiều món khác thoả điều
  // kiện, và app không tự tải bù. Khoá lại: lọc + sắp xếp phải xảy ra TRƯỚC khi
  // cắt trang, để mỗi trang trả về luôn đủ (tối đa) limit món thật sự thoả điều kiện.
  Inventory.createSku({ id: 'sku_filter_out1', name: 'Filter Out SKU 1', price: 50000, stock: 0 }, 'br1');
  Inventory.createSku({ id: 'sku_filter_out2', name: 'Filter Out SKU 2', price: 10000, stock: 0 }, 'br1');
  Inventory.createSku({ id: 'sku_filter_in1', name: 'Filter In SKU 1', price: 30000, stock: 5 }, 'br1');
  Inventory.createSku({ id: 'sku_filter_in2', name: 'Filter In SKU 2', price: 20000, stock: 2 }, 'br1');

  const onlyInStock = Inventory.listSkus('br1', { q: 'filter', page: 1, limit: 1, in_stock: '1' });
  // total phải phản ánh SỐ ĐÃ LỌC (2 món còn hàng), không phải tổng 4 món ban đầu —
  // nếu không app sẽ tưởng còn trang tiếp theo trong khi thực chất trang 1 (limit=1)
  // đã bỏ sót 1 món còn hàng nữa chưa hiện.
  assert.equal(onlyInStock.total, 2);
  assert.ok(onlyInStock.items.every(s => s.stock > 0));

  const priceDesc = Inventory.listSkus('br1', { q: 'filter', page: 1, limit: 10, sort: 'price_desc' });
  const prices = priceDesc.items.map(s => s.price);
  assert.deepEqual(prices, [...prices].sort((a, b) => b - a));

  const stockAsc = Inventory.listSkus('br1', { q: 'filter', page: 1, limit: 10, in_stock: '1', sort: 'stock_asc' });
  assert.deepEqual(stockAsc.items.map(s => s.id), ['sku_filter_in2', 'sku_filter_in1']);
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

test('partial payments are idempotent and deduct stock only when fully settled', () => {
  Inventory.createSku({ id: 'sku_partial', name: 'Partial SKU', price: 10000, stock: 1 }, 'br1');
  const first = Retail.checkout({
    items: [{ sku_id: 'sku_partial', qty: 1 }],
    payments: [{ method: 'cash', amount: 4000 }],
    client_request_id: 'partial_pay_1',
    branch_id: 'br1',
    cashier: 'Tester',
  });
  assert.equal(first.status, 'partially_paid');
  assert.equal(first.remaining_due, 6000);
  assert.equal(db.prepare(`SELECT stock FROM skus WHERE id='sku_partial'`).get().stock, 1);

  const replay = Retail.checkout({
    items: [{ sku_id: 'sku_partial', qty: 1 }],
    payments: [{ method: 'cash', amount: 4000 }],
    client_request_id: 'partial_pay_1',
    branch_id: 'br1',
    cashier: 'Tester',
  });
  assert.equal(replay.idempotent_replay, true);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM payments WHERE order_id=?`).get(first.order_id).n, 1);

  const final = Payments.payOrder(first.order_id, [{ method: 'cash', amount: 6000 }], {
    cashier: 'Tester',
    idempotency_key: 'partial_pay_2',
  }, 'br1');
  assert.equal(final.fully_settled, true);
  assert.equal(db.prepare(`SELECT status FROM orders WHERE id=?`).get(first.order_id).status, 'paid');
  assert.equal(db.prepare(`SELECT stock FROM skus WHERE id='sku_partial'`).get().stock, 0);
  assert.equal(db.prepare(`
    SELECT SUM(pl.amount) total FROM payment_lines pl JOIN payments p ON p.id=pl.payment_id WHERE p.order_id=?
  `).get(first.order_id).total, 10000);
});

test('one paid order can be allocated across multiple active e-invoices', () => {
  Inventory.createSku({ id: 'sku_invoice_split', name: 'Invoice Split SKU', price: 30000, stock: 1 }, 'br1');
  const receipt = Retail.checkout({
    items: [{ sku_id: 'sku_invoice_split', qty: 1 }],
    payments: [{ method: 'cash', amount: 30000 }],
    client_request_id: 'invoice_split_checkout',
    branch_id: 'br1',
    cashier: 'Tester',
  });
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM e_invoices WHERE order_id=?`).get(receipt.order_id).n, 1);
  const second = Einvoices.createInvoiceRequest(
    receipt.order_id,
    'COMPANY_TAX_INFO',
    { company: 'Dan D Pak', tax_code: '0312345678', email: 'invoice@example.com' },
    'br1',
    'Tester',
    { amount: 12000, idempotency_key: 'invoice_split_2' },
  );
  assert.ok(second.id);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM e_invoices WHERE order_id=? AND invoice_status!='CANCELLED'`).get(receipt.order_id).n, 2);
  assert.equal(db.prepare(`SELECT SUM(amount) total FROM invoice_allocations WHERE order_id=?`).get(receipt.order_id).total, 30000);
  const replay = Einvoices.createInvoiceRequest(
    receipt.order_id,
    'COMPANY_TAX_INFO',
    { company: 'Dan D Pak', tax_code: '0312345678', email: 'invoice@example.com' },
    'br1',
    'Tester',
    { amount: 12000, idempotency_key: 'invoice_split_2' },
  );
  assert.equal(replay.id, second.id);
  // A THIRD split, still within the 18000 the auto WALK_IN invoice is currently holding,
  // must succeed — BR-INV-002 does not cap an order at exactly two invoices, it only
  // requires that the sum of all active allocations never exceeds the order total.
  const third = Einvoices.createInvoiceRequest(
    receipt.order_id,
    'NO_BUYER_INFO',
    {},
    'br1',
    'Tester',
    { amount: 5000, idempotency_key: 'invoice_split_3' },
  );
  assert.ok(third.id);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM e_invoices WHERE order_id=? AND invoice_status!='CANCELLED'`).get(receipt.order_id).n, 3);
  assert.equal(db.prepare(`SELECT SUM(amount) total FROM invoice_allocations WHERE order_id=?`).get(receipt.order_id).total, 30000);
  // A request that exceeds what's ACTUALLY left (13000 now: 30000 - 12000 - 5000) must still be rejected.
  assert.throws(() => Einvoices.createInvoiceRequest(
    receipt.order_id,
    'NO_BUYER_INFO',
    {},
    'br1',
    'Tester',
    { amount: 20000, idempotency_key: 'invoice_split_overflow' },
  ), /exceeds remaining/);
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

test('modifier prices come from the menu, not from what the client claims', () => {
  db.prepare(`INSERT INTO menu_items (id,category_id,name,price,price_includes_vat,vat_rate,station,modifiers_json) VALUES (?,?,?,?,?,?,?,?)`)
    .run('menu_mods', 'cat_test', 'Trà Sữa', 50000, 1, 8, 'bar',
      JSON.stringify([{ group: 'Size', name: 'Lớn', price: 20000 }]));

  // Client (đã bị hook / request tự chế) khai topping tính phí với giá 0.
  const order = Orders.createOrUpdateOrder({
    branch_id: 'br1',
    channel: 'takeaway',
    items: [{
      menu_item_id: 'menu_mods',
      qty: 1,
      mods: [{ group: 'Size', name: 'Lớn', price: 0 }],
    }],
    actor: 'Tester',
  });
  // Server phải tính theo giá thực đơn (50000 + 20000), bỏ qua price=0 của client.
  assert.equal(order.subtotal, 70000);
  const line = order.items[0];
  assert.equal(JSON.parse(line.mods_json)[0].price, 20000);

  // Giá bịa cao hơn cũng không được chấp nhận — luôn lấy giá thực đơn.
  const inflated = Orders.createOrUpdateOrder({
    branch_id: 'br1',
    channel: 'takeaway',
    items: [{
      menu_item_id: 'menu_mods',
      qty: 1,
      mods: [{ group: 'Size', name: 'Lớn', price: 999000 }],
    }],
    actor: 'Tester',
  });
  assert.equal(inflated.subtotal, 70000);

  // Topping không có trong thực đơn bị từ chối, không âm thầm tính giá 0.
  assert.throws(() => Orders.createOrUpdateOrder({
    branch_id: 'br1',
    channel: 'takeaway',
    items: [{
      menu_item_id: 'menu_mods',
      qty: 1,
      mods: [{ group: 'Size', name: 'Khổng Lồ', price: 0 }],
    }],
    actor: 'Tester',
  }), /không có trong thực đơn/);
});

test('a self-order tablet cannot reach staff-only order actions', () => {
  db.prepare(`INSERT INTO menu_items (id,category_id,name,price,price_includes_vat,vat_rate,station) VALUES (?,?,?,?,?,?,?)`)
    .run('menu_kiosk', 'cat_test', 'Cà Phê', 40000, 1, 8, 'bar');
  const base = {
    branch_id: 'br1',
    channel: 'dine_in',
    source: 'customer_ipad',
    actor: 'Khách',
    items: [{ menu_item_id: 'menu_kiosk', qty: 1 }],
  };

  // Đơn hợp lệ từ iPad vẫn chạy, và luôn phải chờ nhân viên xác nhận.
  const ok = Orders.createOrUpdateOrder({ ...base });
  assert.equal(ok.items[0].status, 'pending_confirm');

  // Không được đẩy món sang bill đang mở của bàn khác.
  assert.throws(
    () => Orders.createOrUpdateOrder({ ...base, order_id: ok.id }),
    /không được gộp vào bill có sẵn/);

  // Không được tự thêm hàng retail vào bill.
  assert.throws(
    () => Orders.createOrUpdateOrder({ ...base, items: [{ sku_id: 'sku_search', qty: 1 }] }),
    /chỉ được gọi món trong thực đơn/);

  // Không được trỏ bill sang máy POS/máy in khác.
  assert.throws(
    () => Orders.createOrUpdateOrder({ ...base, linked_printer_id: 'bill' }),
    /không được chỉ định máy POS/);
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
