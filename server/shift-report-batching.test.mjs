import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-shift-batch-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = process.env.DATA_ENCRYPTION_KEY
  || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const { db, migrate } = await import('./db.js');
const Shifts = await import('./services/shifts.js');
const CashDrawer = await import('./services/cashDrawer.js');
migrate();

test('shift report batches bill lines and preserves each payment breakdown', () => {
  const at = '2026-08-10T01:00:00.000Z';
  db.prepare(`INSERT INTO shifts(id,branch_id,shift_key,shift_label,user_id,user_name,
    opened_at,status,opening_cash) VALUES(?,?,?,?,?,?,?,?,?)`)
    .run('shift_batch', 'sala', 'morning', 'Ca sang', 'u1', 'Thu ngan', at, 'open', 0);
  const order = db.prepare(`INSERT INTO orders(id,branch_id,channel,status,subtotal,
    discount,goods_amount,vat_amount,total,created_at,paid_at,bill_no)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
  order.run('ord_batch_1', 'sala', 'retail', 'paid', 100000, 0, 100000, 0,
    100000, at, at, 'BATCH001');
  order.run('ord_batch_2', 'sala', 'retail', 'paid', 80000, 0, 80000, 0,
    80000, at, at, 'BATCH002');
  const payment = db.prepare(`INSERT INTO payments(id,order_id,shift_id,cashier,total,created_at)
    VALUES(?,?,?,?,?,?)`);
  payment.run('pay_batch_1', 'ord_batch_1', 'shift_batch', 'Thu ngan', 100000, at);
  payment.run('pay_batch_2', 'ord_batch_2', 'shift_batch', 'Thu ngan', 80000, at);
  const line = db.prepare(`INSERT INTO payment_lines(id,payment_id,method,amount,tendered_amount,reference)
    VALUES(?,?,?,?,?,?)`);
  line.run('pl_batch_1', 'pay_batch_1', 'cash', 40000, 40000, null);
  line.run('pl_batch_2', 'pay_batch_1', 'bank_transfer', 60000, 60000, 'TX-1');
  line.run('pl_batch_3', 'pay_batch_2', 'cash', 80000, 100000, null);

  const report = Shifts.shiftReport('shift_batch', 'sala');
  assert.equal(report.bill_count, 2);
  assert.deepEqual(report.bills.find(b => b.payment_id === 'pay_batch_1').lines, [
    { method: 'cash', amount: 40000, reference: null },
    { method: 'bank_transfer', amount: 60000, reference: 'TX-1' },
  ]);
  assert.deepEqual(report.bills.find(b => b.payment_id === 'pay_batch_2').lines,
    [{ method: 'cash', amount: 100000, reference: null }]);
});

test('shift report has three page-wide queries, not one query per payment', () => {
  const source = readFileSync(new URL('./services/shifts.js', import.meta.url), 'utf8');
  const start = source.indexOf('export function shiftReport');
  const end = source.indexOf('export function operationDayReport');
  const body = source.slice(start, end);
  assert.equal((body.match(/db\.prepare\(/g) || []).length, 4,
    'shift row, payments, method totals and one bulk payment-line query');
  assert.match(body, /WHERE p\.shift_id=\?/);
  assert.doesNotMatch(body, /WHERE payment_id=\?/);
});

test('cash drawer batches reimbursement decoration without changing totals or links', () => {
  const at = '2026-08-10T02:00:00.000Z';
  const entry = db.prepare(`INSERT INTO cash_drawer_entries
    (id,branch_id,shift_id,kind,occurred_at,reimburses_entry_id,amount,created_at)
    VALUES(?,?,?,?,?,?,?,?)`);
  entry.run('expense_batch_1', 'sala', 'shift_batch', 'expense', at, null, 100000, at);
  entry.run('expense_batch_2', 'sala', 'shift_batch', 'expense', at, null, 200000, at);
  entry.run('reimburse_batch_1', 'sala', 'shift_batch', 'reimbursement', at,
    'expense_batch_1', 150000, at);
  entry.run('reimburse_batch_legacy', 'sala', 'shift_batch', 'reimbursement', at,
    'expense_batch_2', 20000, at);
  db.prepare(`INSERT INTO branches(id,name,code,active) VALUES(?,?,?,1)`)
    .run('other_cash_branch', 'Other cash', 'OCB');
  entry.run('reimburse_cross_branch', 'other_cash_branch', null, 'reimbursement', at,
    'expense_batch_2', 90000, at);
  const allocation = db.prepare(`INSERT INTO cash_drawer_reimbursement_allocations
    (id,branch_id,reimbursement_id,expense_id,amount,created_at) VALUES(?,?,?,?,?,?)`);
  allocation.run('alloc_batch_1', 'sala', 'reimburse_batch_1', 'expense_batch_1', 100000, at);
  allocation.run('alloc_batch_2', 'sala', 'reimburse_batch_1', 'expense_batch_2', 50000, at);
  allocation.run('alloc_cross_branch', 'other_cash_branch', 'reimburse_cross_branch',
    'expense_batch_2', 90000, at);

  const rows = CashDrawer.entriesForShift('shift_batch', 20);
  const expense1 = rows.find(row => row.id === 'expense_batch_1');
  const expense2 = rows.find(row => row.id === 'expense_batch_2');
  const reimbursement = rows.find(row => row.id === 'reimburse_batch_1');
  const legacy = rows.find(row => row.id === 'reimburse_batch_legacy');
  assert.equal(expense1.reimbursed_amount, 100000);
  assert.equal(expense1.outstanding_amount, 0);
  assert.equal(expense2.reimbursed_amount, 70000);
  assert.equal(expense2.outstanding_amount, 130000);
  assert.equal(reimbursement.linked_expenses.length, 2);
  assert.equal(reimbursement.linked_expense_amount, 150000);
  assert.equal(legacy.linked_expense_id, 'expense_batch_2');
  assert.equal(legacy.linked_expense_amount, 200000);
});

test('cash drawer page decoration uses fixed bulk queries, not per-entry SQL', () => {
  const source = readFileSync(new URL('./services/cashDrawer.js', import.meta.url), 'utf8');
  const start = source.indexOf('function decorateEntries');
  const end = source.indexOf('export function cashSalesForShift');
  const body = source.slice(start, end);
  assert.equal((body.match(/db\.prepare\(/g) || []).length, 4);
  assert.match(body, /IN \(\$\{slots\}\)/);
  assert.doesNotMatch(body, /reimbursementTotalForExpense\(|allocationsForReimbursement\(/);
});
