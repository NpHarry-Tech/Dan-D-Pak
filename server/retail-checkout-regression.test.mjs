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
const Invoices = await import('./services/invoices.js');
const Vouchers = await import('./services/vouchers.js');
const ReportCenter = await import('./services/reportCenter.js');
const History = await import('./services/history.js');

migrate();
db.prepare(`INSERT OR IGNORE INTO categories (id,branch_id,name) VALUES ('cat_test','sala','Test')`).run();

test('shared search stays consistent across catalog, inventory and contacts', () => {
  Inventory.createSku({
    id: 'sku_search', name: 'Sữa Hạnh Nhân', barcode: '893-search',
    category: 'Đồ uống', price: 10000, stock: 1,
  }, 'sala');
  const skuPage = Inventory.listSkus('sala', { q: 'sua uong', page: 1, limit: 40 });
  assert.deepEqual(skuPage.items.map(row => row.id), ['sku_search']);

  db.prepare(`INSERT INTO categories (id,branch_id,name) VALUES ('cat_search','sala','Search')`).run();
  db.prepare(`INSERT INTO menu_items (id,category_id,name,description,price,station) VALUES (?,?,?,?,?,?)`)
    .run('menu_search', 'cat_search', 'Cà Phê Sữa', 'Đá lạnh', 30000, 'bar');
  const menuPage = Catalog.listMenu({ page: 1, q: 'ca lanh' });
  assert.deepEqual(menuPage.items.map(row => row.id), ['menu_search']);

  Customers.upsertCustomer({ name: 'Nguyễn An', company: 'Công ty Hạt Việt', phone: '0900000000' }, 'sala');
  const contacts = Customers.listCustomers('sala', 'nguyen hat');
  assert.equal(contacts.length, 1);
  assert.equal(contacts[0].name, 'Nguyễn An');
});

test('bill promotion excludes lines that already have a product promotion', () => {
  for (const id of ['sku_promo_a', 'sku_promo_b', 'sku_promo_c']) {
    Inventory.createSku({ id, name: id, price: 100000, stock: 10 }, 'sala');
  }
  Vouchers.createVoucher({
    id: 'promo_buy5', name: 'Mua 5 tang 1', code: 'BUY5', type: 'buy_x_get_1',
    value: 5, scope: 'sku', sku_id: 'sku_promo_b', active: true,
  }, 'sala');
  Vouchers.createVoucher({
    id: 'promo_order10', name: 'Giam 10% don tren 200k', code: 'ORDER10', type: 'pct',
    value: 10, scope: 'order', min_total: 200000, active: true,
  }, 'sala');
  const plan = Vouchers.buildDiscountPlan([
    { sku_id: 'sku_promo_a', name: 'Item A', qty: 1, price: 100000 },
    { sku_id: 'sku_promo_b', name: 'Item B', qty: 6, price: 20000, voucher_id: 'promo_buy5' },
    { sku_id: 'sku_promo_c', name: 'Item C', qty: 1, price: 100000 },
  ], { voucher_id: 'promo_order10', branch_id: 'sala' });

  assert.equal(plan.lineDiscount, 20000);
  assert.equal(plan.orderDiscount, 20000);
  assert.equal(plan.total, 280000);
  assert.deepEqual(plan.appliedSkuPromos.map(p => [p.line_index, p.type, p.amount]), [
    [1, 'buy_x_get_1', 20000],
    [0, 'order', 10000],
    [2, 'order', 10000],
  ]);
});

test('checkout, report detail and combo all use the same authoritative net price', () => {
  db.prepare(`INSERT INTO shifts (id,branch_id,user_name,shift_key,shift_label,opening_cash,status,opened_at) VALUES (?,?,?,?,?,?,?,?)`)
    .run('shift_combo_report', 'sala', 'Tester', 'combo-report', 'Combo report', 0, 'open', now());
  Inventory.createSku({ id: 'sku_combo_report', name: 'Pistachios Beverage', price: 200000, stock: 10 }, 'sala');
  Vouchers.createVoucher({
    id: 'combo_report_500', name: 'Sữa hạt 3 giá 500k', code: 'PISTACHIOS500',
    scope: 'combo', type: 'fixed', value: 500000, active: true,
    scope_config: { skus: ['sku_combo_report'], groups: [], qty: 3 },
  }, 'sala');
  const receipt = Retail.checkout({
    items: [{ sku_id: 'sku_combo_report', qty: 3 }],
    payments: [{ method: 'cash', amount: 500000 }],
    selected_combos: ['combo_report_500'],
    client_request_id: 'combo_report_same_price', branch_id: 'sala', cashier: 'Tester',
  });
  assert.equal(receipt.total, 500000);
  const report = ReportCenter.buildReport('sales_overview', 'sala', { period: 'year' });
  const detail = report.sections.find(section => section.title === 'Chi tiết giao dịch');
  const row = detail.rows.find(r => r.item_name === 'Pistachios Beverage');
  assert.equal(row.amount, 500000);
  assert.equal(Math.round(row.effective_unit_price * row.qty), 500000);
  assert.equal(row.price_fmt, '166.667đ');
  db.prepare(`UPDATE shifts SET status='closed',closed_at=? WHERE id='shift_combo_report'`).run(now());
});

test('retail provisional receipt does not allocate an order or bill number', () => {
  Inventory.createSku({ id: 'sku_preview', name: 'Preview SKU', price: 108000, stock: 3, vat: 8 }, 'sala');
  const before = db.prepare(`SELECT COUNT(*) n FROM orders`).get().n;
  const receipt = Retail.previewReceipt({
    items: [{ sku_id: 'sku_preview', qty: 1 }], branch_id: 'sala', cashier: 'Tester', note: 'ABC123456XYZ',
  });
  assert.equal(receipt.preview, true);
  assert.equal(receipt.bill_no, '');
  assert.equal(receipt.number, '');
  assert.equal(receipt.note, 'ABC123456XYZ');
  assert.equal(receipt.goods_amount, 100000);
  assert.equal(receipt.vat_amount, 8000);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM orders`).get().n, before);
});

test('retail SKU listing filters "in stock" and sorts BEFORE pagination, not after', () => {
  // Trước đây "Còn hàng" lọc phía app SAU KHI đã cắt trang 40 SKU — nếu phần lớn
  // hết hàng, trang hiện ra rất ít món dù server còn nhiều món khác thoả điều
  // kiện, và app không tự tải bù. Khoá lại: lọc + sắp xếp phải xảy ra TRƯỚC khi
  // cắt trang, để mỗi trang trả về luôn đủ (tối đa) limit món thật sự thoả điều kiện.
  Inventory.createSku({ id: 'sku_filter_out1', name: 'Filter Out SKU 1', price: 50000, stock: 0 }, 'sala');
  Inventory.createSku({ id: 'sku_filter_out2', name: 'Filter Out SKU 2', price: 10000, stock: 0 }, 'sala');
  Inventory.createSku({ id: 'sku_filter_in1', name: 'Filter In SKU 1', price: 30000, stock: 5 }, 'sala');
  Inventory.createSku({ id: 'sku_filter_in2', name: 'Filter In SKU 2', price: 20000, stock: 2 }, 'sala');

  const onlyInStock = Inventory.listSkus('sala', { q: 'filter', page: 1, limit: 1, in_stock: '1' });
  // total phải phản ánh SỐ ĐÃ LỌC (2 món còn hàng), không phải tổng 4 món ban đầu —
  // nếu không app sẽ tưởng còn trang tiếp theo trong khi thực chất trang 1 (limit=1)
  // đã bỏ sót 1 món còn hàng nữa chưa hiện.
  assert.equal(onlyInStock.total, 2);
  assert.ok(onlyInStock.items.every(s => s.stock > 0));

  const priceDesc = Inventory.listSkus('sala', { q: 'filter', page: 1, limit: 10, sort: 'price_desc' });
  const prices = priceDesc.items.map(s => s.price);
  assert.deepEqual(prices, [...prices].sort((a, b) => b - a));

  const stockAsc = Inventory.listSkus('sala', { q: 'filter', page: 1, limit: 10, in_stock: '1', sort: 'stock_asc' });
  assert.deepEqual(stockAsc.items.map(s => s.id), ['sku_filter_in2', 'sku_filter_in1']);
});

test('retail checkout separates change and deduplicates retries', () => {
  const shiftId = 'shift_test';
  db.prepare(`INSERT INTO shifts (id,branch_id,user_name,shift_key,shift_label,opening_cash,status,opened_at) VALUES (?,?,?,?,?,?,?,?)`)
    .run(shiftId, 'sala', 'Tester', 'test', 'Test', 0, 'open', now());
  Inventory.createSku({ id: 'sku_paid', name: 'Paid SKU', price: 30000, stock: 3 }, 'sala');

  const payload = {
    items: [{ sku_id: 'sku_paid', qty: 1 }],
    payments: [{ method: 'cash', amount: 100000 }],
    client_request_id: 'checkout_retry_1',
    branch_id: 'sala',
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
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM payments WHERE order_id=?`).get(first.order_id).n, 1);
  assert.equal(db.prepare(`SELECT stock FROM skus WHERE id='sku_paid'`).get().stock, 2);
  const snapshot = db.prepare(`SELECT * FROM sale_snapshots WHERE order_id=?`).get(first.order_id);
  assert.ok(snapshot, 'payment success phải tạo sale snapshot trong cùng transaction');
  assert.equal(JSON.parse(snapshot.snapshot_json).total, first.total);
  assert.match(snapshot.pricing_hash, /^[a-f0-9]{64}$/);
  assert.throws(
    () => db.prepare(`UPDATE sale_snapshots SET snapshot_json='{}' WHERE id=?`).run(snapshot.id),
    /immutable/,
    'sale snapshot đã chốt không được sửa',
  );
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM sale_snapshots WHERE order_id=?`).get(first.order_id).n, 1,
    'idempotent replay không được tạo snapshot thứ hai');
  const paymentLine = db.prepare(`SELECT pl.amount,pl.tendered_amount FROM payment_lines pl
    JOIN payments p ON p.id=pl.payment_id WHERE p.order_id=?`).get(first.order_id);
  assert.equal(paymentLine.amount, 30000);
  assert.equal(paymentLine.tendered_amount, 100000);
  assert.equal(CashDrawer.cashSalesForShift(shiftId), 30000);
  assert.equal(PERMANENT_ROOT, join(temp, 'storage', 'permanent-storage'));
  const report = ReportCenter.buildReport('sales_overview', 'sala', { period: 'year' });
  const daily = report.sections.find(section => section.title === 'Doanh thu theo ngày');
  assert.ok(daily?.rows.length, 'server phải trả doanh thu theo ngày cho màn báo cáo phone');
  const authoritativeRevenue = db.prepare(`SELECT SUM(total) total FROM orders WHERE status='paid'`).get().total;
  assert.equal(report.summary[0].raw, authoritativeRevenue,
    'doanh thu phai bang tong orders.total da chot, khong cong lai tu gia goc');
});

test('paid bill snapshots survive later product edits and catalogue deletion', () => {
  db.prepare(`INSERT INTO shifts (id,branch_id,user_name,shift_key,shift_label,opening_cash,status,opened_at)
    VALUES (?,?,?,?,?,?,?,?)`).run('shift_snapshot_sale', 'sala', 'Tester', 'snapshot-sale', 'Snapshot sale', 0, 'open', now());
  Inventory.createSku({ id: 'sku_snapshot_sale', code: 'OLD-CODE', barcode: '8930000099999',
    name: 'Tên lúc bán', unit: 'hộp', price: 116000, vat: 8, stock: 2 }, 'sala');
  const receipt = Retail.checkout({
    items: [{ sku_id: 'sku_snapshot_sale', qty: 1 }],
    payments: [{ method: 'cash', amount: 116000 }],
    client_request_id: 'snapshot_sale_boundary', branch_id: 'sala', cashier: 'Tester',
  });
  const before = History.orderReceipt(receipt.order_id, 'sala');
  assert.deepEqual({ name: before.items[0].name, price: before.items[0].unit_price,
    vat: before.items[0].vat_rate, code: before.items[0].item_code,
    barcode: before.items[0].item_barcode, unit: before.items[0].unit },
  { name: 'Tên lúc bán', price: 116000, vat: 8, code: 'OLD-CODE', barcode: '8930000099999', unit: 'hộp' });

  Inventory.updateSku('sku_snapshot_sale', { name: 'Tên hiện tại', code: 'NEW-CODE',
    barcode: '8930000011111', unit: 'chai', price: 999000, vat: 10 }, 'sala');
  Inventory.deleteSku('sku_snapshot_sale', 'sala');
  const after = History.orderReceipt(receipt.order_id, 'sala');
  assert.deepEqual(after.items, before.items, 'bill cũ không được đọc lại dữ liệu sản phẩm hiện tại');
  assert.throws(() => db.prepare(`UPDATE order_items SET unit_price=1 WHERE order_id=?`).run(receipt.order_id),
    /immutable/, 'dữ kiện dòng bill đã thanh toán phải bị khóa ở DB');
  assert.throws(() => db.prepare(`DELETE FROM order_items WHERE order_id=?`).run(receipt.order_id),
    /cannot be deleted/, 'không được xóa dòng bill đã thanh toán');

  const report = ReportCenter.buildReport('sales_overview', 'sala', { period: 'year' });
  const detail = report.sections.find(section => section.title === 'Chi tiết giao dịch');
  const row = detail.rows.find(r => r.order_id === receipt.order_id);
  assert.equal(row.item_name, 'Tên lúc bán');
  assert.equal(row.sku_code, 'OLD-CODE');
  assert.equal(row.sku_barcode, '8930000099999');
  assert.equal(row.unit_price, 116000);
  assert.equal(row.vat_rate, 8);
});

test('partial payments are idempotent and deduct stock only when fully settled', () => {
  Inventory.createSku({ id: 'sku_partial', name: 'Partial SKU', price: 10000, stock: 1 }, 'sala');
  const first = Retail.checkout({
    items: [{ sku_id: 'sku_partial', qty: 1 }],
    payments: [{ method: 'cash', amount: 4000 }],
    client_request_id: 'partial_pay_1',
    branch_id: 'sala',
    cashier: 'Tester',
  });
  assert.equal(first.status, 'partially_paid');
  assert.equal(first.remaining_due, 6000);
  assert.equal(db.prepare(`SELECT stock FROM skus WHERE id='sku_partial'`).get().stock, 1);

  const replay = Retail.checkout({
    items: [{ sku_id: 'sku_partial', qty: 1 }],
    payments: [{ method: 'cash', amount: 4000 }],
    client_request_id: 'partial_pay_1',
    branch_id: 'sala',
    cashier: 'Tester',
  });
  assert.equal(replay.idempotent_replay, true);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM payments WHERE order_id=?`).get(first.order_id).n, 1);

  const final = Payments.payOrder(first.order_id, [{ method: 'cash', amount: 6000 }], {
    cashier: 'Tester',
    idempotency_key: 'partial_pay_2',
  }, 'sala');
  assert.equal(final.fully_settled, true);
  assert.equal(db.prepare(`SELECT status FROM orders WHERE id=?`).get(first.order_id).status, 'paid');
  assert.equal(db.prepare(`SELECT stock FROM skus WHERE id='sku_partial'`).get().stock, 0);
  assert.equal(db.prepare(`
    SELECT SUM(pl.amount) total FROM payment_lines pl JOIN payments p ON p.id=pl.payment_id WHERE p.order_id=?
  `).get(first.order_id).total, 10000);
  const ledger = Invoices.ledger('sala', { q: first.order_id });
  assert.equal(ledger.total, 1);
  assert.equal(ledger.items[0].bill_status, 'PAID');
  assert.equal(ledger.items[0].invoice_no, '');
  assert.equal(ledger.items[0].paid_total, 10000);
  const detail = Invoices.ledgerDetail(first.order_id, 'sala');
  assert.equal(detail.payment_history.length, 2);
  assert.ok(detail.timeline.some(row => row.action === 'SNAPSHOT_CREATED'));
  assert.equal(detail.item_snapshot[0].name, 'Partial SKU');
});

test('payment fail phải rollback voucher và promo metadata cùng transaction', () => {
  Inventory.createSku({ id: 'sku_price_rollback', name: 'Price rollback SKU', price: 15000, stock: 1 }, 'sala');
  const order = Orders.createOrUpdateOrder({
    branch_id: 'sala', channel: 'retail',
    items: [{ sku_id: 'sku_price_rollback', qty: 1 }],
    actor: 'Tester',
  });
  const item = db.prepare(`SELECT id FROM order_items WHERE order_id=?`).get(order.id);
  db.prepare(`UPDATE skus SET stock=0 WHERE id='sku_price_rollback'`).run();
  db.prepare(`UPDATE stock_lots SET qty_on_hand=0 WHERE item_type='sku' AND item_id='sku_price_rollback'`).run();

  assert.throws(() => Payments.payOrder(order.id, [{ method: 'cash', amount: 15000 }], {
    cashier: 'Tester',
    idempotency_key: 'price_metadata_rollback',
    voucher: { id: 'voucher_should_rollback', code: 'ROLLBACK' },
    promotions: [{ item_id: item.id, type: 'amount', amount: 1000 }],
  }, 'sala'), /Không đủ tồn/);

  const unchangedOrder = db.prepare(`SELECT voucher_id,voucher_code,status FROM orders WHERE id=?`).get(order.id);
  assert.equal(unchangedOrder.voucher_id, null);
  assert.equal(unchangedOrder.voucher_code, null);
  assert.equal(unchangedOrder.status, 'open');
  assert.equal(db.prepare(`SELECT promo_json FROM order_items WHERE id=?`).get(item.id).promo_json, null);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM payments WHERE order_id=?`).get(order.id).n, 0);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM sale_snapshots WHERE order_id=?`).get(order.id).n, 0);
});

test('one paid order cannot be split across multiple active e-invoices', () => {
  Inventory.createSku({ id: 'sku_invoice_split', name: 'Invoice Split SKU', price: 30000, stock: 1 }, 'sala');
  const receipt = Retail.checkout({
    items: [{ sku_id: 'sku_invoice_split', qty: 1 }],
    payments: [{ method: 'cash', amount: 30000 }],
    client_request_id: 'invoice_split_checkout',
    branch_id: 'sala',
    cashier: 'Tester',
  });
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM e_invoices WHERE order_id=?`).get(receipt.order_id).n, 1);
  assert.throws(() => Einvoices.createInvoiceRequest(
    receipt.order_id,
    'COMPANY_TAX_INFO',
    { company: 'Dan D Pak', tax_code: '0312345678', email: 'invoice@example.com' },
    'sala',
    'Tester',
    { amount: 12000, idempotency_key: 'invoice_split_2' },
  ), (error) => error?.code === 'SPLIT_INVOICE_DISABLED' && error?.status === 409);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM e_invoices WHERE order_id=? AND invoice_status!='CANCELLED'`).get(receipt.order_id).n, 1);
  assert.equal(db.prepare(`SELECT SUM(amount) total FROM invoice_allocations WHERE order_id=?`).get(receipt.order_id).total, 30000);

  const replay = Einvoices.createInvoiceRequest(
    receipt.order_id,
    'COMPANY_TAX_INFO',
    { company: 'Dan D Pak', tax_code: '0312345678', email: 'invoice@example.com' },
    'sala',
    'Tester',
    { idempotency_key: 'whole_invoice_replay' },
  );
  assert.equal(replay.id, db.prepare(`SELECT id FROM e_invoices WHERE order_id=?`).get(receipt.order_id).id);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM e_invoices WHERE order_id=?`).get(receipt.order_id).n, 1);
});

test('sellable SKU without a price is blocked', () => {
  Inventory.createSku({ id: 'sku_free', name: 'Unpriced SKU', price: 0, stock: 1 }, 'sala');
  assert.throws(() => Retail.checkout({
    items: [{ sku_id: 'sku_free', qty: 1 }],
    payments: [],
    client_request_id: 'checkout_unpriced_1',
    branch_id: 'sala',
  }), /SKU chưa có giá bán/);
  assert.equal(db.prepare(`SELECT stock FROM skus WHERE id='sku_free'`).get().stock, 1);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM orders WHERE client_request_id='checkout_unpriced_1'`).get().n, 0);
});

test('retail VAT supports tax-exclusive and tax-inclusive prices', () => {
  Inventory.createSku({ id: 'sku_net', name: 'Net SKU', price: 100000, vat: 10, price_includes_vat: false, stock: 1 }, 'sala');
  Inventory.createSku({ id: 'sku_gross', name: 'Gross SKU', price: 108000, vat: 8, price_includes_vat: true, stock: 1 }, 'sala');
  const receipt = Retail.checkout({
    items: [{ sku_id: 'sku_net', qty: 1 }, { sku_id: 'sku_gross', qty: 1 }],
    payments: [{ method: 'cash', amount: 218000 }],
    client_request_id: 'checkout_vat_1',
    branch_id: 'sala',
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
    branch_id: 'sala',
    channel: 'takeaway',
    items: [{ menu_item_id: 'menu_net', qty: 1 }],
    actor: 'Tester',
  });
  assert.equal(order.subtotal, 108000);
  assert.equal(order.goods_amount, 100000);
  assert.equal(order.vat_amount, 8000);
  const receipt = Payments.payOrder(order.id, [{ method: 'cash', amount: 108000 }], { cashier: 'Tester' }, 'sala');
  assert.equal(receipt.total, 108000);
  assert.equal(receipt.vat_amount, 8000);
});

test('modifier prices come from the menu, not from what the client claims', () => {
  db.prepare(`INSERT INTO menu_items (id,category_id,name,price,price_includes_vat,vat_rate,station,modifiers_json) VALUES (?,?,?,?,?,?,?,?)`)
    .run('menu_mods', 'cat_test', 'Trà Sữa', 50000, 1, 8, 'bar',
      JSON.stringify([{ group: 'Size', name: 'Lớn', price: 20000 }]));

  // Client (đã bị hook / request tự chế) khai topping tính phí với giá 0.
  const order = Orders.createOrUpdateOrder({
    branch_id: 'sala',
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
    branch_id: 'sala',
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
    branch_id: 'sala',
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
    branch_id: 'sala',
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
