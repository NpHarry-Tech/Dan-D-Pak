import { db, uid, now, audit } from '../db.js';
import { cleanText } from '../core/util.js';
import { archiveCashDrawerEntry } from './archive.js';
import { businessDateEndUtc, businessDateStartUtc } from '../core/businessClock.js';

function parseAmount(v) {
  const n = Math.round(Number(v) || 0);
  if (n <= 0) throw new Error('Số tiền phải lớn hơn 0');
  return n;
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
    reimbursed_amount: Number(row.reimbursed_amount) || 0,
    outstanding_amount: Number(row.outstanding_amount) || 0,
    linked_expense_amount: Number(row.linked_expense_amount) || 0,
  };
}
function activeShift(branch_id = 'sala') {
  return db.prepare(`SELECT * FROM shifts WHERE branch_id=? AND status='open' ORDER BY opened_at DESC LIMIT 1`).get(branch_id);
}
function entryTitle(row = {}) {
  return cleanText(row.product || row.reason || row.counterparty || row.id || 'Khoản chi', 180);
}
function reimbursementTotalForExpense(entry_id) {
  if (!entry_id) return 0;
  const allocated = Number(db.prepare(`
    SELECT COALESCE(SUM(a.amount),0) amount
    FROM cash_drawer_reimbursement_allocations a
    JOIN cash_drawer_entries r ON r.id=a.reimbursement_id
    WHERE a.expense_id=? AND r.kind='reimbursement'`).get(entry_id)?.amount) || 0;
  const legacy = Number(db.prepare(`
    SELECT COALESCE(SUM(amount),0) amount
    FROM cash_drawer_entries
    WHERE kind='reimbursement' AND reimburses_entry_id=?
      AND NOT EXISTS (
        SELECT 1 FROM cash_drawer_reimbursement_allocations a
        WHERE a.reimbursement_id=cash_drawer_entries.id
      )`).get(entry_id)?.amount) || 0;
  return allocated + legacy;
}
function allocationsForReimbursement(reimbursement_id) {
  if (!reimbursement_id) return [];
  return db.prepare(`
    SELECT a.*, e.product, e.reason, e.counterparty, e.occurred_at expense_occurred_at, e.amount expense_amount
    FROM cash_drawer_reimbursement_allocations a
    JOIN cash_drawer_entries e ON e.id=a.expense_id
    WHERE a.reimbursement_id=?
    ORDER BY e.occurred_at ASC, e.created_at ASC`).all(reimbursement_id).map(a => ({
      ...a,
      amount: Number(a.amount) || 0,
      expense_amount: Number(a.expense_amount) || 0,
      title: entryTitle(a),
    }));
}
function decorateEntry(row) {
  if (!row) return null;
  const out = publicEntry(row);
  if (out.kind === 'expense') {
    out.reimbursed_amount = reimbursementTotalForExpense(out.id);
    out.outstanding_amount = Math.max(0, out.amount - out.reimbursed_amount);
  }
  if (out.kind === 'reimbursement' && out.reimburses_entry_id) {
    out.linked_expenses = allocationsForReimbursement(out.id);
    const exp = out.linked_expenses.length
      ? null
      : db.prepare(`SELECT * FROM cash_drawer_entries WHERE id=? AND kind='expense'`).get(out.reimburses_entry_id);
    if (exp) {
      out.linked_expense_id = exp.id;
      out.linked_expense_title = entryTitle(exp);
      out.linked_expense_amount = Number(exp.amount) || 0;
      out.linked_expense_at = exp.occurred_at;
    }
    if (out.linked_expenses.length) {
      out.linked_expense_id = out.linked_expenses[0].expense_id;
      out.linked_expense_title = out.linked_expenses.map(x => x.title).join(', ');
      out.linked_expense_amount = out.linked_expenses.reduce((s, x) => s + x.amount, 0);
      out.linked_expense_at = out.linked_expenses[0].expense_occurred_at;
    }
  }
  return out;
}
function decorateEntries(rows = []) {
  if (!rows.length) return [];
  const mapKey = (branch, id) => `${branch || ''}\u0000${id || ''}`;
  const expenseIds = rows.filter(row => row.kind === 'expense').map(row => row.id);
  const reimbursementIds = rows.filter(row => row.kind === 'reimbursement').map(row => row.id);
  const reimbursedByExpense = new Map();
  const allocationsByReimbursement = new Map();
  const legacyExpenseById = new Map();

  if (expenseIds.length) {
    const slots = expenseIds.map(() => '?').join(',');
    for (const row of db.prepare(`SELECT a.branch_id,a.expense_id,COALESCE(SUM(a.amount),0) amount
      FROM cash_drawer_reimbursement_allocations a
      JOIN cash_drawer_entries r ON r.id=a.reimbursement_id
      WHERE a.expense_id IN (${slots}) AND r.kind='reimbursement'
        AND r.branch_id=a.branch_id
      GROUP BY a.branch_id,a.expense_id`).all(...expenseIds)) {
      reimbursedByExpense.set(mapKey(row.branch_id, row.expense_id), Number(row.amount) || 0);
    }
    for (const row of db.prepare(`SELECT r.branch_id,r.reimburses_entry_id expense_id,
        COALESCE(SUM(r.amount),0) amount
      FROM cash_drawer_entries r
      WHERE r.kind='reimbursement' AND r.reimburses_entry_id IN (${slots})
        AND NOT EXISTS (SELECT 1 FROM cash_drawer_reimbursement_allocations a
          WHERE a.reimbursement_id=r.id)
      GROUP BY r.branch_id,r.reimburses_entry_id`).all(...expenseIds)) {
      const key = mapKey(row.branch_id, row.expense_id);
      reimbursedByExpense.set(key,
        (reimbursedByExpense.get(key) || 0) + (Number(row.amount) || 0));
    }
  }

  if (reimbursementIds.length) {
    const slots = reimbursementIds.map(() => '?').join(',');
    for (const row of db.prepare(`SELECT a.*,e.branch_id expense_branch_id,
        e.product,e.reason,e.counterparty,e.occurred_at expense_occurred_at,e.amount expense_amount
      FROM cash_drawer_reimbursement_allocations a
      JOIN cash_drawer_entries e ON e.id=a.expense_id
      WHERE a.reimbursement_id IN (${slots})
      ORDER BY a.reimbursement_id,e.occurred_at,e.created_at`).all(...reimbursementIds)) {
      if (row.branch_id !== row.expense_branch_id) continue;
      const key = mapKey(row.branch_id, row.reimbursement_id);
      const bucket = allocationsByReimbursement.get(key) || [];
      bucket.push({ ...row, amount: Number(row.amount) || 0,
        expense_amount: Number(row.expense_amount) || 0, title: entryTitle(row) });
      allocationsByReimbursement.set(key, bucket);
    }
    const legacyIds = [...new Set(rows
      .filter(row => row.kind === 'reimbursement' && row.reimburses_entry_id
        && !(allocationsByReimbursement.get(mapKey(row.branch_id, row.id))?.length))
      .map(row => row.reimburses_entry_id))];
    if (legacyIds.length) {
      const legacySlots = legacyIds.map(() => '?').join(',');
      for (const row of db.prepare(`SELECT * FROM cash_drawer_entries
        WHERE kind='expense' AND id IN (${legacySlots})`).all(...legacyIds)) {
        legacyExpenseById.set(mapKey(row.branch_id, row.id), row);
      }
    }
  }

  return rows.map(row => {
    const out = publicEntry(row);
    if (out.kind === 'expense') {
      out.reimbursed_amount = reimbursedByExpense.get(mapKey(out.branch_id, out.id)) || 0;
      out.outstanding_amount = Math.max(0, out.amount - out.reimbursed_amount);
    }
    if (out.kind === 'reimbursement' && out.reimburses_entry_id) {
      out.linked_expenses = allocationsByReimbursement.get(mapKey(out.branch_id, out.id)) || [];
      const exp = out.linked_expenses.length ? null
        : legacyExpenseById.get(mapKey(out.branch_id, out.reimburses_entry_id));
      if (exp && exp.branch_id === out.branch_id) {
        out.linked_expense_id = exp.id;
        out.linked_expense_title = entryTitle(exp);
        out.linked_expense_amount = Number(exp.amount) || 0;
        out.linked_expense_at = exp.occurred_at;
      }
      if (out.linked_expenses.length) {
        out.linked_expense_id = out.linked_expenses[0].expense_id;
        out.linked_expense_title = out.linked_expenses.map(item => item.title).join(', ');
        out.linked_expense_amount = out.linked_expenses.reduce((sum, item) => sum + item.amount, 0);
        out.linked_expense_at = out.linked_expenses[0].expense_occurred_at;
      }
    }
    return out;
  });
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
export function summaryForShift(shift_id, branch_id = 'sala') {
  if (!shift_id) return null;
  const sh = db.prepare(`SELECT * FROM shifts WHERE id=? AND branch_id=?`).get(shift_id, branch_id);
  if (!sh) return null;
  const mv = movementTotalsForShift(shift_id);
  const cash_sales = cashSalesForShift(shift_id);
  const opening_cash = Number(sh.opening_cash) || 0;
  const expected_cash = opening_cash + cash_sales - mv.expenses + mv.reimbursements;
  return {
    shift_id,
    opening_cash,
    cash_sales,
    expenses: mv.expenses,
    reimbursements: mv.reimbursements,
    expected_cash,
    base_cash: opening_cash,
    shortage_to_base: Math.max(0, opening_cash - expected_cash),
    movement_count: mv.count,
  };
}
export function defaultOpeningCash(branch_id = 'sala', cfg = {}) {
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
  const rows = db.prepare(`
    SELECT * FROM cash_drawer_entries
    WHERE shift_id=?
    ORDER BY occurred_at DESC, created_at DESC
    LIMIT ?`).all(shift_id, Math.max(1, Math.min(200, parseInt(limit) || 40)));
  return decorateEntries(rows);
}
export function reimbursableExpenses(branch_id = 'sala', limit = 80) {
  const rows = db.prepare(`
    SELECT e.*, s.shift_label,
      (SELECT COALESCE(SUM(a.amount),0)
       FROM cash_drawer_reimbursement_allocations a
       JOIN cash_drawer_entries r ON r.id=a.reimbursement_id
       WHERE a.expense_id=e.id AND r.kind='reimbursement')
      +
      (SELECT COALESCE(SUM(r.amount),0)
       FROM cash_drawer_entries r
       WHERE r.kind='reimbursement' AND r.reimburses_entry_id=e.id
         AND NOT EXISTS (
           SELECT 1 FROM cash_drawer_reimbursement_allocations a
           WHERE a.reimbursement_id=r.id
         )) reimbursed_amount
    FROM cash_drawer_entries e
    LEFT JOIN shifts s ON s.id=e.shift_id
    WHERE e.branch_id=? AND e.kind='expense'
    ORDER BY e.occurred_at DESC, e.created_at DESC
    LIMIT 300`).all(branch_id).map(row => {
      const out = publicEntry(row);
      out.reimbursed_amount = Number(row.reimbursed_amount) || 0;
      out.outstanding_amount = Math.max(0, out.amount - out.reimbursed_amount);
      out.title = entryTitle(out);
      return out;
    }).filter(x => x.outstanding_amount > 0);
  return rows.slice(0, Math.max(1, Math.min(200, parseInt(limit) || 80)));
}
export function currentDrawer(branch_id = 'sala', limit = 40) {
  const sh = activeShift(branch_id);
  if (!sh) return { shift: null, summary: null, entries: [], reimbursable_expenses: reimbursableExpenses(branch_id, 80) };
  return {
    shift: sh,
    summary: summaryForShift(sh.id, branch_id),
    entries: entriesForShift(sh.id, limit),
    reimbursable_expenses: reimbursableExpenses(branch_id, 80),
  };
}
export function listEntries(branch_id = 'sala', query = {}) {
  const limit = Math.max(1, Math.min(500, parseInt(query.limit) || 100));
  const params = [branch_id];
  let where = 'branch_id=?';
  if (query.shift_id) { where += ' AND shift_id=?'; params.push(String(query.shift_id)); }
  if (query.kind) { where += ' AND kind=?'; params.push(String(query.kind)); }
  if (query.from) { where += ' AND occurred_at>=?'; params.push(businessDateStartUtc(query.from).toISOString()); }
  if (query.to) { where += ' AND occurred_at<=?'; params.push(businessDateEndUtc(query.to).toISOString()); }
  const rows = db.prepare(`
    SELECT * FROM cash_drawer_entries
    WHERE ${where}
    ORDER BY occurred_at DESC, created_at DESC
    LIMIT ?`).all(...params, limit);
  return decorateEntries(rows);
}
export function createEntry(kind, body = {}, user = {}, branch_id = 'sala') {
  if (!['expense', 'reimbursement'].includes(kind)) throw new Error('Loại giao dịch két không hợp lệ');
  const sh = activeShift(branch_id);
  if (!sh) throw new Error('Cần mở ca trước khi ghi nhận thu/chi tiền két');
  const amount = parseAmount(body.amount);
  const before = expectedCashForShift(sh, sh.id);
  const after = before + (kind === 'expense' ? -amount : amount);
  if (after < 0) throw new Error('Số tiền chi lớn hơn tiền mặt đang có trong két');
  const rawExpenseIds = kind === 'reimbursement'
    ? (Array.isArray(body.reimburses_entry_ids)
      ? body.reimburses_entry_ids
      : Array.isArray(body.expense_ids)
        ? body.expense_ids
        : [body.reimburses_entry_id || body.expense_id || body.reimburse_for].filter(Boolean))
    : [];
  const expenseIds = [...new Set(rawExpenseIds.map(x => cleanText(x, 80)).filter(Boolean))];
  const linkedExpenses = [];
  const allocationPlan = [];
  if (expenseIds.length) {
    let totalOutstanding = 0;
    for (const id of expenseIds) {
      const row = db.prepare(`SELECT * FROM cash_drawer_entries WHERE id=? AND branch_id=? AND kind='expense'`).get(id, branch_id);
      if (!row) throw new Error('Khoản chi cần hoàn không tồn tại');
      const outstanding = Math.max(0, (Number(row.amount) || 0) - reimbursementTotalForExpense(row.id));
      if (outstanding <= 0) throw new Error(`Khoản chi "${entryTitle(row)}" đã được hoàn đủ`);
      linkedExpenses.push({ row, outstanding });
      totalOutstanding += outstanding;
    }
    if (amount > totalOutstanding) throw new Error('Số tiền hoàn lớn hơn tổng số còn thiếu của các khoản chi đã chọn');
    let remaining = amount;
    for (const item of linkedExpenses) {
      if (remaining <= 0) break;
      const allocated = Math.min(item.outstanding, remaining);
      if (allocated > 0) allocationPlan.push({ expense: item.row, amount: allocated });
      remaining -= allocated;
    }
  }
  const linkedExpense = allocationPlan[0]?.expense || null;
  const reimburses_entry_id = linkedExpense?.id || '';
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
    reimburses_entry_id: reimburses_entry_id || null,
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
  if (kind === 'reimbursement' && linkedExpense && !entry.reason) entry.reason = 'Hoàn chi';
  db.prepare(`
    INSERT INTO cash_drawer_entries
    (id,branch_id,shift_id,kind,occurred_at,counterparty,reason,product,invoice_image,reimburses_entry_id,note,actor_id,actor_name,amount,balance_before,balance_after,created_at)
    VALUES (@id,@branch_id,@shift_id,@kind,@occurred_at,@counterparty,@reason,@product,@invoice_image,@reimburses_entry_id,@note,@actor_id,@actor_name,@amount,@balance_before,@balance_after,@created_at)
  `).run(entry);
  entry.drawer_balance_summary = {
    balance_before: before,
    change_amount: amount,
    balance_after: after,
    operation: kind === 'expense' ? 'subtract_expense' : 'add_reimbursement',
  };
  entry.drawer_total_note = kind === 'expense'
    ? `Két trước ${before} VND - chi ${amount} VND = két sau ${after} VND`
    : `Két trước ${before} VND + hoàn chi ${amount} VND = két sau ${after} VND`;
  if (allocationPlan.length) {
    const insAlloc = db.prepare(`
      INSERT INTO cash_drawer_reimbursement_allocations
      (id,branch_id,reimbursement_id,expense_id,amount,created_at)
      VALUES (?,?,?,?,?,?)`);
    for (const alloc of allocationPlan) {
      insAlloc.run(uid('cra_'), branch_id, entry.id, alloc.expense.id, alloc.amount, entry.created_at);
    }
    entry.reimbursement_allocations = allocationPlan.map(x => ({
      expense_id: x.expense.id,
      title: entryTitle(x.expense),
      amount: x.amount,
    }));
  }
  archiveCashDrawerEntry(entry);
  audit(kind === 'expense' ? 'cash.expense' : 'cash.reimbursement', {
    id: entry.id,
    shift_id: entry.shift_id,
    amount: entry.amount,
    counterparty: entry.counterparty,
    reason: entry.reason,
    product: entry.product,
    reimburses_entry_id: entry.reimburses_entry_id,
    linked_expense: linkedExpense ? { id: linkedExpense.id, title: entryTitle(linkedExpense), amount: linkedExpense.amount } : null,
    linked_expenses: allocationPlan.map(x => ({ id: x.expense.id, title: entryTitle(x.expense), amount: x.amount })),
    balance_before: entry.balance_before,
    balance_after: entry.balance_after,
    drawer_total_note: entry.drawer_total_note,
  }, branch_id, user?.username || user?.name || 'system');
  return decorateEntry(entry);
}
