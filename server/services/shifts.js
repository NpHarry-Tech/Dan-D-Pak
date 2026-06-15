// Shift management: opening cash count, payment grouping, and close-shift report.
import { db, uid, now, audit } from '../db.js';
import { getOperationsConfig } from './settings.js';
import { emit } from '../realtime.js';

function parseJson(raw, fallback) {
  try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
}

function cashTotal(counts = {}) {
  return Object.entries(counts || {}).reduce((sum, [denom, qty]) => {
    const d = parseInt(denom) || 0;
    const q = parseInt(qty) || 0;
    return sum + d * q;
  }, 0);
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
  const opening_cash = Number.isFinite(Number(body.opening_cash)) ? Math.max(0, parseInt(body.opening_cash) || 0) : cashTotal(counts);
  const id = uid('sh_');
  db.prepare(`INSERT INTO shifts
    (id,branch_id,user_id,user_name,shift_key,shift_label,opening_cash,opening_count_json,status,opened_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(id, branch_id, user.id || null, user.name || user.username || null, picked.key, picked.label, opening_cash, JSON.stringify(counts), 'open', now());
  audit('shift.open', { shift: picked.label, opening_cash, user: user.username || user.name || '' }, branch_id, user.username || 'system');
  emit('shift:updated', { status: 'open', shift_label: picked.label }, branch_id);
  return { shift: getActiveShift(branch_id), config: cfg };
}

export function closeShift(body = {}, user = {}, branch_id = 'br1') {
  const shift = getActiveShift(branch_id);
  if (!shift) throw new Error('Chua co ca dang mo de ket ca.');
  const cfg = getOperationsConfig(branch_id);
  const labels = cfg.shifts.labels.filter(x => x.enabled !== false);
  const picked = labels.find(x => x.key === body.shift_key) || labels.find(x => x.key === shift.shift_key) || labels[0] || { key: shift.shift_key, label: shift.shift_label };
  const counts = body.counts && typeof body.counts === 'object' ? body.counts : {};
  const closing_cash = Number.isFinite(Number(body.closing_cash)) ? Math.max(0, parseInt(body.closing_cash) || 0) : cashTotal(counts);
  const report = shiftReport(shift.id, branch_id);
  db.prepare(`UPDATE shifts SET shift_key=?, shift_label=?, closing_cash=?, closing_count_json=?, status='closed', closed_at=? WHERE id=?`)
    .run(picked.key, picked.label, closing_cash, JSON.stringify(counts), now(), shift.id);
  audit('shift.close', {
    shift: picked.label,
    opening_cash: shift.opening_cash,
    closing_cash,
    expected_cash: report.expected_cash,
    revenue: report.total_revenue,
  }, branch_id, user.username || 'system');
  emit('shift:updated', { status: 'closed', shift_label: picked.label }, branch_id);
  return { shift: publicShift(db.prepare(`SELECT * FROM shifts WHERE id=?`).get(shift.id)), report: { ...report, closing_cash } };
}

export function currentShift(branch_id = 'br1') {
  const shift = getActiveShift(branch_id);
  return { shift, config: getOperationsConfig(branch_id), report: shift ? shiftReport(shift.id, branch_id) : null };
}

export function listShifts(branch_id = 'br1', limit = 40) {
  return db.prepare(`SELECT * FROM shifts WHERE branch_id=? ORDER BY opened_at DESC LIMIT ?`).all(branch_id, limit)
    .map(publicShift);
}

export function shiftReport(shift_id, branch_id = 'br1') {
  const shift = publicShift(db.prepare(`SELECT * FROM shifts WHERE id=? AND branch_id=?`).get(shift_id, branch_id));
  if (!shift) throw new Error('Ca lam viec khong ton tai.');
  const payments = db.prepare(`
    SELECT p.id payment_id, p.order_id, p.total, p.created_at, o.channel, o.table_id, t.code table_code
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
    number: p.order_id.slice(-6).toUpperCase(),
    lines: billLines.all(p.payment_id),
  }));
  const methodTotals = Object.fromEntries(lines.map(l => [l.method, Number(l.amount) || 0]));
  const cash = Number(methodTotals.cash) || 0;
  const transfer = ['bank_transfer', 'internet_banking', 'qrcode', 'qr', 'momo', 'zalopay']
    .reduce((s, k) => s + (Number(methodTotals[k]) || 0), 0);
  const pos = ['card', 'visa', 'pos_card'].reduce((s, k) => s + (Number(methodTotals[k]) || 0), 0);
  const total_revenue = payments.reduce((s, p) => s + (Number(p.total) || 0), 0);
  return {
    shift,
    bill_count: payments.length,
    total_revenue,
    opening_cash: shift.opening_cash,
    cash_sales: cash,
    transfer_sales: transfer,
    pos_sales: pos,
    expected_cash: shift.opening_cash + cash,
    method_totals: methodTotals,
    method_lines: lines,
    bills,
  };
}
