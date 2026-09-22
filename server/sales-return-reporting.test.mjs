import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-return-reporting-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = process.env.DATA_ENCRYPTION_KEY
  || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const { db, migrate, now } = await import('./db.js');
const Inventory = await import('./services/inventory.js');
const Retail = await import('./services/retail.js');
const Returns = await import('./services/returns.js');
const Orders = await import('./services/orders.js');
const Reports = await import('./services/reports.js');
const ReportCenter = await import('./services/reportCenter.js');
const Shifts = await import('./services/shifts.js');

migrate();
db.prepare(`INSERT OR IGNORE INTO branches (id,name,code,active,sort) VALUES ('sala','Sala','SALA',1,0)`).run();
db.prepare(`INSERT INTO shifts (id,branch_id,user_name,shift_key,shift_label,opening_cash,status,opened_at)
  VALUES ('shift_return_report','sala','Tester','test','Test',0,'open',?)`).run(now());
Inventory.createSku({ id: 'sku_return_report', name: 'Return reporting item', price: 100000, stock: 10 }, 'sala');

const receipt = Retail.checkout({
  items: [{ sku_id: 'sku_return_report', qty: 1 }],
  payments: [{ method: 'cash', amount: 100000 }],
  client_request_id: 'return_reporting_sale',
  branch_id: 'sala',
  cashier: 'Tester',
});
Returns.createReturn(receipt.order_id, {
  branch_id: 'sala',
  actor: 'Tester',
  reason: 'Test full return',
  idempotency_key: 'return_reporting_full',
});

db.prepare(`INSERT INTO branches (id,name,code,active,sort) VALUES ('partial','Partial','PART',1,1)`).run();
db.prepare(`INSERT INTO shifts (id,branch_id,user_name,shift_key,shift_label,opening_cash,status,opened_at)
  VALUES ('shift_partial_report','partial','Tester','test','Test',0,'open',?)`).run(now());
const partialWarehouse = Inventory.createWarehouse(
  { name: 'Partial warehouse', type: 'retail', sales_channels: ['retail'] }, 'partial');
Inventory.createSku({ id: 'sku_partial_report', name: 'Partial return item', price: 60000, stock: 10,
  warehouse_id: partialWarehouse.id }, 'partial');
const partialReceipt = Retail.checkout({
  items: [{ sku_id: 'sku_partial_report', qty: 2 }],
  payments: [{ method: 'cash', amount: 120000 }],
  client_request_id: 'partial_return_reporting_sale',
  branch_id: 'partial',
  cashier: 'Tester',
});
const partialItem = Orders.getOrder(partialReceipt.order_id).items[0];
Returns.createReturn(partialReceipt.order_id, {
  branch_id: 'partial',
  actor: 'Tester',
  reason: 'Test partial return',
  items: [{ order_item_id: partialItem.id, qty: 1 }],
  idempotency_key: 'return_reporting_partial',
});

test('dashboard reports gross sales, returns and net revenue separately', () => {
  const report = Reports.dashboard('sala');
  assert.equal(report.grossRevenue, 100000);
  assert.equal(report.returnedAmount, 100000);
  assert.equal(report.revenue, 0);
  assert.equal(report.bills, 1);
  assert.equal(Number(report.methods.find(row => row.method === 'cash')?.amt), 0);
});

test('sales report subtracts returns from totals, days and products', () => {
  const report = ReportCenter.buildReport('sales_overview', 'sala', { period: 'year' });
  const summary = Object.fromEntries(report.summary.map(row => [row.label, row]));
  assert.equal(summary['Doanh số gộp'].raw, 100000);
  assert.equal(summary['Giảm trừ trả hàng'].raw, 100000);
  assert.equal(summary['Giảm trừ trả hàng'].tone, 'negative');
  assert.equal(summary['Doanh thu'].raw, 0);

  const day = report.sections.find(section => section.title === 'Doanh thu theo ngày').rows[0];
  assert.equal(day.gross, 100000);
  assert.equal(day.returns, 100000);
  assert.equal(day.revenue, 0);

  const product = report.sections.find(section => section.title === 'Tổng hợp theo sản phẩm')
    .rows.find(row => row.item_name === 'Return reporting item');
  assert.equal(product.qty, 0);
  assert.equal(product.amount, 0);
  assert.equal(report.sections.find(section => section.title === 'Chi tiết trả hàng / giảm trừ').rows.length, 1);
});

test('shift and operation-day reports keep one bill and expose the deduction', () => {
  const shift = Shifts.shiftReport('shift_return_report', 'sala');
  assert.equal(shift.bill_count, 1);
  assert.equal(shift.gross_sales, 100000);
  assert.equal(shift.returned_amount, 100000);
  assert.equal(shift.total_revenue, 0);
  assert.equal(shift.cash_sales, 0);

  const day = Shifts.operationDayReport('sala');
  assert.equal(day.bill_count, 1);
  assert.equal(day.gross_sales, 100000);
  assert.equal(day.returned_amount, 100000);
  assert.equal(day.total_revenue, 0);
});

test('partial return keeps only the unreturned quantity and revenue', () => {
  const dashboard = Reports.dashboard('partial');
  assert.equal(dashboard.grossRevenue, 120000);
  assert.equal(dashboard.returnedAmount, 60000);
  assert.equal(dashboard.revenue, 60000);

  const report = ReportCenter.buildReport('sales_overview', 'partial', { period: 'year' });
  const summary = Object.fromEntries(report.summary.map(row => [row.label, row]));
  assert.equal(summary['Doanh thu'].raw, 60000);
  const product = report.sections.find(section => section.title === 'Tổng hợp theo sản phẩm')
    .rows.find(row => row.item_name === 'Partial return item');
  assert.equal(product.qty, 1);
  assert.equal(product.amount, 60000);
});
