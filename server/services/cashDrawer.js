import { db, uid, now, audit } from '../db.js';
import { archiveCashDrawerEntry } from './archive.js';

function parseAmount(v) {
  const n = Math.round(Number(v) || 0);
  if (n <= 0) throw new Error('Số tiền phải lớn hơn 0');
  return n;
}
function cleanText(v, max = 800) {
  return String(v ?? '').trim().slice(0, max);
}
function parseDate(v) {
  if (!v) return now();
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new Error('Ngày giờ không hợp lệ');
  return d.toISOString();
}
function publicEntry(row) {
  if (!row) return null;
  return {
    ...row,
    amount: Number(row.amount) || 0,
    balance_before: Number(row.balance_before) || 0,
    balance_after: Number(row.balance_after) || 0,
  };
}
function activeShift(branch_id = 'br1') {
  return db.prepare(`SELECT * FROM shifts WHERE branch_id=? AND status='open' ORDER BY opened_at DESC LIMIT 1`).get(branch_id);
}
export function cashSalesForShift(shift_id) {
  if (!shift_id) return 0;
  return Number(db.prepare(`
    SELECT COALESCE(SUM(pl.amount),0) amount
    FROM payment_lines pl
    JOIN payments p ON p.id=pl.payment_id
    WHERE p.shift_id=? AND pl.method='cash'`).get(shift_id)?.amount) || 0;
}
export function movementTotalsForShift(shift_id) {
  if (!shift_id) return { expenses: 0, reimbursements: 0, count: 0 };
  const rows = db.prepare(`
    SELECT kind, COALESCE(SUM(amount),0) amount, COUNT(*) count
    FROM cash_drawer_entries
    WHERE shift_id=?
    GROUP BY kind`).all(shift_id);
  const out = { expenses: 0, reimbursements: 0, count: 0 };
  for (const r of rows) {
    if (r.kind === 'expense') out.expenses = Number(r.amount) || 0;
    if (r.kind === 'reimbursement') out.reimbursements = Number(r.amount) || 0;
    out.count += Number(r.count) || 0;
  }
  return out;
}
export function expectedCashForShift(shift = {}, shift_id = shift?.id) {
  const opening = Number(shift?.opening_cash) || 0;
  const cashSales = cashSalesForShift(shift_id);
  const mv = movementTotalsForShift(shift_id);
  return opening + cashSales - mv.expenses + mv.reimbursements;
}
export function defaultOpeningCash(branch_id = 'br1', cfg = {}) {
  const last = db.prepare(`
    SELECT closing_cash, opening_cash FROM shifts
    WHERE branch_id=? AND status='closed'
    ORDER BY closed_at DESC, opened_at DESC LIMIT 1`).get(branch_id);
  if (last && last.closing_cash !== null && last.closing_cash !== undefined) return Number(last.closing_cash) || 0;
  const open = db.prepare(`
    SELECT opening_cash FROM shifts
    WHERE branch_id=?
    ORDER BY opened_at DESC LIMIT 1`).get(branch_id);
  if (open) return Number(open.opening_cash) || 0;
  return Math.max(0, Math.round(Number(cfg?.shifts?.defaultDrawerCash) || 0));
}
export function entriesForShift(shift_id, limit = 40) {
  if (!shift_id) return [];
  return db.prepare(`
    SELECT * FROM cash_drawer_entries
    WHERE shift_id=?
    ORDER BY occurred_at DESC, created_at DESC
    LIMIT ?`).all(shift_id, Math.max(1, Math.min(200, parseInt(limit) || 40))).map(publicEntry);
}
export function currentDrawer(branch_id = 'br1', limit = 40) {
  const sh = activeShift(branch_id);
  if (!sh) return { shift: null, summary: null, entries: [] };
  const mv = movementTotalsForShift(sh.id);
  const cash_sales = cashSalesForShift(sh.id);
  const expected_cash = (Number(sh.opening_cash) || 0) + cash_sales - mv.expenses + mv.reimbursements;
  return {
    shift: sh,
    summary: {
      shift_id: sh.id,
      opening_cash: Number(sh.opening_cash) || 0,
      cash_sales,
      expenses: mv.expenses,
      reimbursements: mv.reimbursements,
      expected_cash,
      base_cash: Number(sh.opening_cash) || 0,
      shortage_to_base: Math.max(0, (Number(sh.opening_cash) || 0) - expected_cash),
      movement_count: mv.count,
    },
    entries: entriesForShift(sh.id, limit),
  };
}
export function listEntries(branch_id = 'br1', query = {}) {
  const limit = Math.max(1, Math.min(500, parseInt(query.limit) || 100));
  const params = [branch_id];
  let where = 'branch_id=?';
  if (query.shift_id) { where += ' AND shift_id=?'; params.push(String(query.shift_id)); }
  if (query.kind) { where += ' AND kind=?'; params.push(String(query.kind)); }
  if (query.from) { where += ' AND occurred_at>=?'; params.push(new Date(String(query.from) + 'T00:00:00').toISOString()); }
  if (query.to) { where += ' AND occurred_at<=?'; params.push(new Date(String(query.to) + 'T23:59:59.999').toISOString()); }
  return db.prepare(`
    SELECT * FROM cash_drawer_entries
    WHERE ${where}
    ORDER BY occurred_at DESC, created_at DESC
    LIMIT ?`).all(...params, limit).map(publicEntry);
}
export function createEntry(kind, body = {}, user = {}, branch_id = 'br1') {
  if (!['expense', 'reimbursement'].includes(kind)) throw new Error('Loại giao dịch két không hợp lệ');
  const sh = activeShift(branch_id);
  if (!sh) throw new Error('Cần mở ca trước khi ghi nhận thu/chi tiền két');
  const amount = parseAmount(body.amount);
  const before = expectedCashForShift(sh, sh.id);
  const after = before + (kind === 'expense' ? -amount : amount);
  if (after < 0) throw new Error('Số tiền chi lớn hơn tiền mặt đang có trong két');
  const entry = {
    id: uid(kind === 'expense' ? 'ce_' : 'cr_'),
    branch_id,
    shift_id: sh.id,
    kind,
    occurred_at: parseDate(body.occurred_at),
    counterparty: cleanText(body.counterparty || body.paid_to || body.reimbursed_by, 240),
    reason: cleanText(body.reason, 500),
    product: cleanText(body.product, 500),
    invoice_image: cleanText(body.invoice_image, 7_500_000),
    note: cleanText(body.note, 1200),
    actor_id: user?.id || null,
    actor_name: cleanText(body.actor_name || user?.name || user?.username || '', 160),
    amount,
    balance_before: before,
    balance_after: after,
    created_at: now(),
  };
  if (kind === 'expense' && !entry.reason) throw new Error('Cần nhập lý do chi tiền');
  if (kind === 'expense' && !entry.counterparty) throw new Error('Cần nhập bên nhận tiền / NCC');
  if (kind === 'reimbursement' && !entry.counterparty) entry.counterparty = entry.actor_name || 'Kế toán / nhân viên hoàn';
  db.prepare(`
    INSERT INTO cash_drawer_entries
    (id,branch_id,shift_id,kind,occurred_at,counterparty,reason,product,invoice_image,note,actor_id,actor_name,amount,balance_before,balance_after,created_at)
    VALUES (@id,@branch_id,@shift_id,@kind,@occurred_at,@counterparty,@reason,@product,@invoice_image,@note,@actor_id,@actor_name,@amount,@balance_before,@balance_after,@created_at)
  `).run(entry);
  archiveCashDrawerEntry(entry);
  audit(kind === 'expense' ? 'cash.expense' : 'cash.reimbursement', {
    id: entry.id,
    shift_id: entry.shift_id,
    amount: entry.amount,
    counterparty: entry.counterparty,
    reason: entry.reason,
    product: entry.product,
    balance_after: entry.balance_after,
  }, branch_id, user?.username || user?.name || 'system');
  return publicEntry(entry);
}
