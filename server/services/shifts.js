// Shift management: opening cash count, payment grouping, and close-shift report.
import { db, uid, now, audit } from '../db.js';
import { parseJson } from '../core/util.js';
import { getOperationsConfig } from './settings.js';
import { emit } from '../realtime.js';
import * as CashDrawer from './cashDrawer.js';
import * as einvoice from './einvoice.js';
import * as Auth from './auth.js';


function cashTotal(counts = {}) {
  return Object.entries(counts || {}).reduce((sum, [denom, qty]) => {
    const d = parseInt(denom) || 0;
    const q = parseInt(qty) || 0;
    return sum + d * q;
  }, 0);
}

function dayBounds(ref = new Date()) {
  const d = ref instanceof Date ? new Date(ref) : new Date(ref || Date.now());
  if (Number.isNaN(d.getTime())) return dayBounds(new Date());
  d.setHours(0, 0, 0, 0);
  const start = d.toISOString();
  d.setHours(24, 0, 0, 0);
  return { start, end: d.toISOString() };
}

function publicShift(row) {
  if (!row) return null;
  return {
    ...row,
    opening_cash: Number(row.opening_cash) || 0,
    closing_cash: row.closing_cash === null || row.closing_cash === undefined ? null : Number(row.closing_cash) || 0,
    opening_count: parseJson(row.opening_count_json, {}),
    closing_count: parseJson(row.closing_count_json, null),
  };
}

export function getActiveShift(branch_id = 'br1') {
  return publicShift(db.prepare(`SELECT * FROM shifts WHERE branch_id=? AND status='open' ORDER BY opened_at DESC LIMIT 1`).get(branch_id));
}

export function openShift(body = {}, user = {}, branch_id = 'br1') {
  const current = getActiveShift(branch_id);
  if (current) throw new Error('Dang co ca dang mo. Hay ket ca hien tai truoc khi mo ca moi.');
  const cfg = getOperationsConfig(branch_id);
  const labels = cfg.shifts.labels.filter(x => x.enabled !== false);
  const picked = labels.find(x => x.key === body.shift_key) || labels[0] || { key: 'shift', label: 'Ca lam viec' };
  const counts = body.counts && typeof body.counts === 'object' ? body.counts : {};
  const counted_cash = Number.isFinite(Number(body.opening_cash)) ? Math.max(0, parseInt(body.opening_cash) || 0) : cashTotal(counts);
  const manual_cash = body.cash_manual === true || body.cash_manual === '1' || body.cash_manual === 1;
  const opening_cash = manual_cash ? counted_cash : CashDrawer.defaultOpeningCash(branch_id, cfg);
  const id = uid('sh_');
  db.prepare(`INSERT INTO shifts
    (id,branch_id,user_id,user_name,shift_key,shift_label,opening_cash,opening_count_json,status,opened_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(id, branch_id, user.id || null, user.name || user.username || null, picked.key, picked.label, opening_cash, JSON.stringify(counts), 'open', now());
  audit('shift.open', { shift: picked.label, opening_cash, counted_cash, cash_manual: manual_cash, user: user.username || user.name || '' }, branch_id, user.username || 'system');
  emit('shift:updated', { status: 'open', shift_label: picked.label }, branch_id);
  return { shift: getActiveShift(branch_id), config: cfg };
}

export function closeShift(body = {}, user = {}, branch_id = 'br1') {
  const shift = getActiveShift(branch_id);
  if (!shift) throw new Error('Chua co ca dang mo de ket ca.');

  // E-invoice compliance block check
  const stats = einvoice.getShiftInvoiceSummary(branch_id, shift.id);
  if (!stats.can_close) {
    const overridePin = body.manager_override_pin;
    let approved = false;
    if (overridePin) {
      const approvedBy = Auth.verifyManagerOwnerPin(overridePin, branch_id);
      if (approvedBy) {
        approved = true;
        audit('shift.close_override', { shift: shift.shift_label, user: user.username || '', manager: approvedBy.name || approvedBy.username }, branch_id, user.username || 'system');
      }
    }
    if (!approved) {
      const err = new Error('Không thể kết ca: Vẫn còn hóa đơn lỗi hoặc chưa xuất (Thiếu: ' + stats.missing_count + ', Lỗi: ' + stats.failed_count + '). Nhập PIN Quản lý để bỏ qua.');
      err.status = 409;
      err.code = 'EINVOICE_BLOCK';
      err.stats = stats;
      throw err;
    }
  }
  const cfg = getOperationsConfig(branch_id);
  const labels = cfg.shifts.labels.filter(x => x.enabled !== false);
  const picked = labels.find(x => x.key === body.shift_key) || labels.find(x => x.key === shift.shift_key) || labels[0] || { key: shift.shift_key, label: shift.shift_label };
  const counts = body.counts && typeof body.counts === 'object' ? body.counts : {};
  const closing_cash = Number.isFinite(Number(body.closing_cash)) ? Math.max(0, parseInt(body.closing_cash) || 0) : cashTotal(counts);
  const report = shiftReport(shift.id, branch_id);
  const closed_at = now();
  db.prepare(`UPDATE shifts SET shift_key=?, shift_label=?, closing_cash=?, closing_count_json=?, status='closed', closed_at=? WHERE id=?`)
    .run(picked.key, picked.label, closing_cash, JSON.stringify(counts), closed_at, shift.id);
  const day_report = operationDayReport(branch_id, closed_at);
  audit('shift.close', {
    shift: picked.label,
    opening_cash: shift.opening_cash,
    closing_cash,
    expected_cash: report.expected_cash,
    revenue: report.total_revenue,
    day_revenue: day_report.total_revenue,
  }, branch_id, user.username || 'system');
  emit('shift:updated', { status: 'closed', shift_label: picked.label, day_report }, branch_id);
  return { shift: publicShift(db.prepare(`SELECT * FROM shifts WHERE id=?`).get(shift.id)), report: { ...report, closing_cash }, day_report };
}

export function currentShift(branch_id = 'br1') {
  const shift = getActiveShift(branch_id);
  const config = getOperationsConfig(branch_id);
  return {
    shift,
    config,
    report: shift ? shiftReport(shift.id, branch_id) : null,
    day_report: operationDayReport(branch_id),
    drawer: CashDrawer.currentDrawer(branch_id),
    opening_suggestion: CashDrawer.defaultOpeningCash(branch_id, config),
  };
}

export function listShifts(branch_id = 'br1', limit = 40) {
  return db.prepare(`SELECT * FROM shifts WHERE branch_id=? ORDER BY opened_at DESC LIMIT ?`).all(branch_id, limit)
    .map(publicShift);
}

export function shiftReport(shift_id, branch_id = 'br1') {
  const shift = publicShift(db.prepare(`SELECT * FROM shifts WHERE id=? AND branch_id=?`).get(shift_id, branch_id));
  if (!shift) throw new Error('Ca lam viec khong ton tai.');
  const payments = db.prepare(`
    SELECT p.id payment_id, p.order_id, p.total, p.created_at, o.channel, o.table_id, o.bill_no, t.code table_code
    FROM payments p
    JOIN orders o ON o.id=p.order_id
    LEFT JOIN tables t ON t.id=o.table_id
    WHERE p.shift_id=?
    ORDER BY p.created_at`).all(shift_id);
  const lines = db.prepare(`
    SELECT pl.method, SUM(pl.amount) amount, COUNT(*) count
    FROM payment_lines pl JOIN payments p ON p.id=pl.payment_id
    WHERE p.shift_id=?
    GROUP BY pl.method
    ORDER BY amount DESC`).all(shift_id);
  const billLines = db.prepare(`SELECT method,amount,reference FROM payment_lines WHERE payment_id=? ORDER BY rowid`);
  const bills = payments.map(p => ({
    ...p,
    number: p.bill_no || p.order_id.slice(-6).toUpperCase(),
    lines: billLines.all(p.payment_id),
  }));
  const methodTotals = Object.fromEntries(lines.map(l => [l.method, Number(l.amount) || 0]));
  const cash = Number(methodTotals.cash) || 0;
  const transfer = ['bank_transfer', 'internet_banking', 'qrcode', 'qr', 'momo', 'zalopay']
    .reduce((s, k) => s + (Number(methodTotals[k]) || 0), 0);
  const pos = ['card', 'visa', 'pos_card'].reduce((s, k) => s + (Number(methodTotals[k]) || 0), 0);
  const total_revenue = payments.reduce((s, p) => s + (Number(p.total) || 0), 0);
  const drawer = CashDrawer.summaryForShift(shift_id, branch_id);
  const drawer_expenses = drawer?.expenses || 0;
  const drawer_reimbursements = drawer?.reimbursements || 0;
  const expected_cash = shift.opening_cash + cash - drawer_expenses + drawer_reimbursements;
  return {
    shift,
    bill_count: payments.length,
    total_revenue,
    opening_cash: shift.opening_cash,
    cash_sales: cash,
    drawer_expenses,
    drawer_reimbursements,
    transfer_sales: transfer,
    pos_sales: pos,
    expected_cash,
    cash_drawer_entries: CashDrawer.entriesForShift(shift_id, 80),
    drawer,
    method_totals: methodTotals,
    method_lines: lines,
    bills,
  };
}

export function operationDayReport(branch_id = 'br1', endAt = null) {
  const ref = endAt ? new Date(endAt) : new Date();
  const bounds = dayBounds(ref);
  const firstShift = db.prepare(`
    SELECT opened_at FROM shifts
    WHERE branch_id=? AND opened_at>=? AND opened_at<?
    ORDER BY opened_at ASC LIMIT 1`).get(branch_id, bounds.start, bounds.end);
  const lastShift = db.prepare(`
    SELECT opened_at,closed_at,status FROM shifts
    WHERE branch_id=? AND opened_at>=? AND opened_at<?
    ORDER BY opened_at DESC LIMIT 1`).get(branch_id, bounds.start, bounds.end);
  const start = firstShift?.opened_at || bounds.start;
  const end = endAt || (lastShift?.status === 'closed' && lastShift.closed_at ? lastShift.closed_at : now());
  const payments = db.prepare(`
    SELECT p.id payment_id, p.order_id, p.total, p.created_at, o.channel, o.table_id, t.code table_code
    FROM payments p
    JOIN orders o ON o.id=p.order_id
    LEFT JOIN tables t ON t.id=o.table_id
    WHERE o.branch_id=? AND p.created_at>=? AND p.created_at<=?
    ORDER BY p.created_at`).all(branch_id, start, end);
  const lines = db.prepare(`
    SELECT pl.method, SUM(pl.amount) amount, COUNT(*) count
    FROM payment_lines pl
    JOIN payments p ON p.id=pl.payment_id
    JOIN orders o ON o.id=p.order_id
    WHERE o.branch_id=? AND p.created_at>=? AND p.created_at<=?
    GROUP BY pl.method
    ORDER BY amount DESC`).all(branch_id, start, end);
  const methodTotals = Object.fromEntries(lines.map(l => [l.method, Number(l.amount) || 0]));
  const cash = Number(methodTotals.cash) || 0;
  const transfer = ['bank_transfer', 'internet_banking', 'qrcode', 'qr', 'momo', 'zalopay']
    .reduce((s, k) => s + (Number(methodTotals[k]) || 0), 0);
  const pos = ['card', 'visa', 'pos_card'].reduce((s, k) => s + (Number(methodTotals[k]) || 0), 0);
  const byChannel = {};
  for (const p of payments) byChannel[p.channel] = (byChannel[p.channel] || 0) + (Number(p.total) || 0);
  const total_revenue = payments.reduce((s, p) => s + (Number(p.total) || 0), 0);
  const shift_count = db.prepare(`
    SELECT COUNT(*) n FROM shifts
    WHERE branch_id=? AND opened_at>=? AND opened_at<?`).get(branch_id, bounds.start, bounds.end).n;
  return {
    start,
    end,
    source: firstShift ? 'shift' : 'calendar',
    closed: !!(lastShift?.status === 'closed' && lastShift.closed_at && end === lastShift.closed_at),
    shift_count,
    bill_count: payments.length,
    total_revenue,
    cash_sales: cash,
    transfer_sales: transfer,
    pos_sales: pos,
    method_totals: methodTotals,
    method_lines: lines,
    by_channel: byChannel,
  };
}
