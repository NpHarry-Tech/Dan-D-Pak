import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-history-year-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');

const { db, migrate } = await import('./db.js');
const History = await import('./services/history.js');
const Einvoices = await import('./services/einvoice.js');
const Invoices = await import('./services/invoices.js');
const Customers = await import('./services/customers.js');

migrate();
db.prepare(`INSERT OR IGNORE INTO branches (id,name,active) VALUES ('history_year','History year',1)`).run();

test.after(() => {
  try { db.close(); } catch {}
  rmSync(temp, { recursive: true, force: true });
});

test('sales history browses every bill in the rolling year with server pagination', () => {
  const insert = db.prepare(`INSERT INTO orders
    (id,branch_id,channel,status,total,created_at,paid_at,bill_no,customer_json)
    VALUES (?,?,?,?,?,?,?,?,?)`);
  const recent = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
  for (let index = 1; index <= 205; index++) {
    insert.run(`hist_${index}`, 'history_year', 'retail', 'paid', index,
      recent, recent, `HIST${String(index).padStart(4, '0')}`,
      JSON.stringify({ name: `Khách ${index}` }));
  }
  const tooOld = new Date(Date.now() - 366 * 24 * 60 * 60 * 1000).toISOString();
  insert.run('hist_too_old', 'history_year', 'retail', 'paid', 1,
    tooOld, tooOld, 'HIST-TOO-OLD', '{}');

  const first = History.listOrderHistory('history_year', { q: 'HIST', page: 1, limit: 200 });
  const second = History.listOrderHistory('history_year', { q: 'HIST', page: 2, limit: 200 });
  assert.equal(first.length, 200);
  assert.equal(second.length, 5);
  assert.ok(![...first, ...second].some(row => row.id === 'hist_too_old'));
  assert.equal(History.listOrderHistory('history_year', { q: 'HIST0205' })[0].bill_no, 'HIST0205');
  assert.equal(History.listOrderHistory('history_year', { q: 'Khách 17' })[0].customer_name, 'Khách 17');
});

test('invoice form upgrades the consumer placeholder, receipt name and customer directory', () => {
  const paidAt = new Date().toISOString();
  db.prepare(`INSERT INTO orders
    (id,branch_id,channel,status,total,created_at,paid_at,bill_no,customer_json)
    VALUES ('named_invoice_order','history_year','retail','paid',50000,?,?,?,'{}')`)
    .run(paidAt, paidAt, 'BILL-NAMED-001');

  const placeholder = Einvoices.createInvoiceRequest(
    'named_invoice_order', 'WALK_IN', {}, 'history_year', 'Cashier');
  assert.equal(placeholder.buyer_name, 'Bán cho người tiêu dùng');

  const upgraded = Einvoices.createInvoiceRequest(
    'named_invoice_order',
    'COMPANY_TAX_INFO',
    {
      company: 'CÔNG TY KHÁCH MỚI',
      name: 'Nguyễn Khách Mới',
      tax_code: '0312345678',
      address: 'Thủ Đức, TP.HCM',
      email: 'khachmoi@example.com',
    },
    'history_year',
    'Cashier',
  );

  assert.equal(upgraded.id, placeholder.id, 'must upgrade, not duplicate, the pending invoice');
  assert.equal(upgraded.buyer_name, 'CÔNG TY KHÁCH MỚI');
  assert.equal(Invoices.ledger('history_year', { q: 'BILL-NAMED-001' }).items[0].buyer.name,
    'CÔNG TY KHÁCH MỚI');
  assert.equal(History.orderReceipt('named_invoice_order', 'history_year').customer.name,
    'CÔNG TY KHÁCH MỚI');
  assert.equal(Customers.listCustomers('history_year', '0312345678').length, 1,
    'new invoice buyer must be saved into Customers automatically');
});

test('personal invoice with only a new customer name is saved once in Customers', () => {
  const paidAt = new Date().toISOString();
  db.prepare(`INSERT INTO orders
    (id,branch_id,channel,status,total,created_at,paid_at,bill_no,customer_json)
    VALUES ('name_only_invoice','history_year','retail','paid',75000,?,?,?,'{}')`)
    .run(paidAt, paidAt, 'BILL-NAME-ONLY');

  Einvoices.createInvoiceRequest(
    'name_only_invoice',
    'BUYER_PROVIDED_INFO',
    { name: 'Trần Khách Mới' },
    'history_year',
    'Cashier',
  );

  const saved = Customers.listCustomers('history_year', 'Trần Khách Mới');
  assert.equal(saved.length, 1);
  assert.equal(saved[0].name, 'Trần Khách Mới');

  Customers.silentSaveFromInvoice({ name: 'Trần Khách Mới' }, 'history_year');
  assert.equal(Customers.listCustomers('history_year', 'Trần Khách Mới').length, 1,
    'an exact repeated name-only save must not create unlimited duplicates');
});

test('customer phone is optional and every supplied identity field is searchable', () => {
  const companyOnly = Customers.upsertCustomer({
    company: 'Công ty Không Điện Thoại',
    tax_code: '0319999999',
    address: '12 Đường Tìm Được',
    partner_type: 'customer',
  }, 'history_year');
  assert.equal(companyOnly.phone, '');
  assert.equal(companyOnly.name, 'Công ty Không Điện Thoại');
  assert.equal(Customers.listCustomers('history_year', '0319999999')[0].id, companyOnly.id);
  assert.equal(Customers.listCustomers('history_year', 'Đường Tìm Được')[0].id, companyOnly.id);

  const emailOnly = Customers.upsertCustomer({
    email: 'only-email@example.com', partner_type: 'customer',
  }, 'history_year');
  assert.equal(Customers.listCustomers('history_year', 'only-email@example.com')[0].id, emailOnly.id);
});

test('invoice backfill accepts an existing active placeholder despite legacy branch key', () => {
  const paidAt = new Date().toISOString();
  db.prepare(`INSERT INTO orders
    (id,branch_id,channel,status,total,created_at,paid_at,bill_no,customer_json)
    VALUES ('legacy_backfill_order','history_year','retail','paid',88000,?,?,?,?)`)
    .run(paidAt, paidAt, 'BILL-LEGACY-BACKFILL', JSON.stringify({
      name: 'Khách backfill', phone: '0909000001',
    }));
  const placeholder = Einvoices.createInvoiceRequest(
    'legacy_backfill_order', 'WALK_IN', {}, 'history_year', 'system');
  db.prepare(`UPDATE e_invoices SET idempotency_key='legacy-placeholder-key' WHERE id=?`)
    .run(placeholder.id);

  const first = Einvoices.backfillPaidBills(1000);
  const second = Einvoices.backfillPaidBills(1000);

  // Existing legal invoice intent is authoritative. A renamed/migrated branch
  // must not make the 10-second worker rewrite the same buyer forever.
  assert.ok(first.created >= 0); // other fixtures may genuinely lack an invoice
  assert.equal(second.created, 0, 'the next 10-second worker pass must not select it again');
  assert.equal(
    db.prepare(`SELECT idempotency_key FROM e_invoices WHERE id=?`).get(placeholder.id).idempotency_key,
    'legacy-placeholder-key',
  );
  assert.equal(
    db.prepare(`SELECT COUNT(*) n FROM audit_log
      WHERE action='invoice.buyer_updated' AND actor='system_backfill'`).get().n,
    0,
    'legal detail belongs in e_invoice_audit, not the main activity feed',
  );
});

test('self-service buyer upgrade updates the immutable provider request and receipt', () => {
  const paidAt = new Date().toISOString();
  db.prepare(`INSERT INTO orders
    (id,branch_id,channel,status,total,created_at,paid_at,bill_no,customer_json)
    VALUES ('self_upgrade_invoice','history_year','retail','paid',99000,?,?,?,'{}')`)
    .run(paidAt, paidAt, 'BILL-SELF-UPGRADE');
  const placeholder = Einvoices.createInvoiceRequest(
    'self_upgrade_invoice', 'WALK_IN', {}, 'history_year', 'system');

  const result = Einvoices.customerRequest('self_upgrade_invoice', {
    decision: 'issue',
    customer: { name: 'Lê Khách QR' },
  }, 'history_year');

  assert.equal(result.invoice.id, placeholder.id);
  assert.equal(result.invoice.buyer_name, 'Lê Khách QR');
  const providerRequest = typeof result.invoice.request_snapshot === 'string'
    ? JSON.parse(result.invoice.request_snapshot)
    : result.invoice.request_snapshot;
  assert.equal(providerRequest.customer_mode, 'BUYER_PROVIDED_INFO');
  assert.equal(providerRequest.buyer.name, 'Lê Khách QR');
  assert.equal(History.orderReceipt('self_upgrade_invoice', 'history_year').customer.name,
    'Lê Khách QR');
  assert.equal(Customers.listCustomers('history_year', 'Lê Khách QR').length, 1);
});

test('buyer upgrade is blocked after a provider attempt starts', () => {
  const paidAt = new Date().toISOString();
  db.prepare(`INSERT INTO orders
    (id,branch_id,channel,status,total,created_at,paid_at,bill_no,customer_json)
    VALUES ('started_invoice','history_year','retail','paid',120000,?,?,?,'{}')`)
    .run(paidAt, paidAt, 'BILL-STARTED');
  const invoice = Einvoices.createInvoiceRequest(
    'started_invoice', 'WALK_IN', {}, 'history_year', 'system');
  db.prepare(`UPDATE e_invoices SET attempt_count=1 WHERE id=?`).run(invoice.id);

  assert.throws(
    () => Einvoices.upgradeBuyer(
      'started_invoice', { name: 'Không Được Ghi Đè' }, 'history_year', 'Cashier'),
    /Hóa đơn đã bắt đầu gửi/,
  );
  assert.equal(Einvoices.get(invoice.id).buyer_name, 'Bán cho người tiêu dùng');
});

test('e-invoice reads and mutations cannot cross branch boundaries', async () => {
  db.prepare(`INSERT OR IGNORE INTO branches (id,name,active) VALUES ('other_branch','Other',1)`).run();
  const paidAt = new Date().toISOString();
  db.prepare(`INSERT INTO orders
    (id,branch_id,channel,status,total,created_at,paid_at,bill_no,customer_json)
    VALUES ('other_branch_invoice','other_branch','retail','paid',88000,?,?,?,'{}')`)
    .run(paidAt, paidAt, 'BILL-OTHER-BRANCH');
  const invoice = Einvoices.createInvoiceRequest(
    'other_branch_invoice', 'WALK_IN', {}, 'other_branch', 'system');
  db.prepare(`UPDATE e_invoices SET invoice_status='FAILED' WHERE id=?`).run(invoice.id);

  assert.equal(Einvoices.getInvoiceByOrder('other_branch_invoice', 'history_year'), null);
  assert.equal(Einvoices.get(invoice.id, 'history_year'), null);
  assert.throws(
    () => Einvoices.upgradeBuyer(
      'other_branch_invoice', { name: 'Sai Chi Nhánh' }, 'history_year', 'Cashier'),
    /Chưa có bản ghi HĐĐT/,
  );
  await assert.rejects(
    Einvoices.retryInvoice(invoice.id, 'Cashier', 'history_year'),
    /Không tìm thấy yêu cầu hóa đơn/,
  );
  assert.equal(Einvoices.get(invoice.id, 'other_branch').invoice_status, 'FAILED');
});

test('legacy invoice compatibility is branch-scoped and read-only', () => {
  const issuedAt = new Date().toISOString();
  db.prepare(`INSERT INTO invoices
    (id,branch_id,order_id,invoice_no,lookup_code,status,customer_json,total,issued_at)
    VALUES ('legacy_other_invoice','other_branch','other_branch_invoice','00000001','LOOKUP-OTHER','issued','{}',88000,?)`)
    .run(issuedAt);
  db.prepare(`UPDATE orders SET invoice_id='legacy_other_invoice' WHERE id='other_branch_invoice'`).run();

  assert.equal(Invoices.get('legacy_other_invoice', 'history_year'), null);
  assert.equal(Invoices.cancel, undefined,
    'legacy local-only cancellation must not coexist with provider cancellation');
  assert.equal(Invoices.get('legacy_other_invoice', 'other_branch').status, 'issued');
  assert.equal(db.prepare(`SELECT invoice_id FROM orders WHERE id='other_branch_invoice'`).get().invoice_id,
    'legacy_other_invoice');
});
