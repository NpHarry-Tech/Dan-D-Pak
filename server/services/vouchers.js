// Retail promotion/voucher service.
// Supports order-level vouchers and SKU-level promotions shown on the POS cart.
import { db, uid, now, audit } from '../db.js';
import { emit } from '../realtime.js';

const TYPES = ['pct', 'amount'];
const SCOPES = ['order', 'sku'];

export function listVouchers(branch_id = 'br1') {
  return db.prepare(`
    SELECT v.*, s.name AS sku_name, s.emoji AS sku_emoji
    FROM vouchers v
    LEFT JOIN skus s ON s.id=v.sku_id
    WHERE v.branch_id=?
    ORDER BY v.active DESC, v.created_at DESC`).all(branch_id).map(normalizeRow);
}

export function listActiveVouchers(branch_id = 'br1') {
  return listVouchers(branch_id).filter(isUsableToday);
}

export function createVoucher(body, branch_id = 'br1') {
  const v = normalizeInput(body);
  ensureSku(v, branch_id);
  ensureUniqueCode(v.code, branch_id);
  const id = body.id || uid('v_');
  db.prepare(`INSERT INTO vouchers
    (id,branch_id,code,name,type,value,scope,sku_id,min_total,active,starts_at,ends_at,note,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, branch_id, v.code, v.name, v.type, v.value, v.scope, v.sku_id, v.min_total,
    v.active, v.starts_at, v.ends_at, v.note, now(), now());
  audit('voucher.create', { id, name: v.name, scope: v.scope, sku_id: v.sku_id }, branch_id);
  emit('vouchers:updated', { id, created: true }, branch_id);
  return getVoucher(id, branch_id);
}

export function updateVoucher(id, body, branch_id = 'br1') {
  const cur = db.prepare(`SELECT * FROM vouchers WHERE id=? AND branch_id=?`).get(id, branch_id);
  if (!cur) throw new Error('Voucher không tồn tại');
  const v = normalizeInput(body, cur);
  ensureSku(v, branch_id);
  ensureUniqueCode(v.code, branch_id, id);
  db.prepare(`UPDATE vouchers SET
      code=?, name=?, type=?, value=?, scope=?, sku_id=?, min_total=?,
      active=?, starts_at=?, ends_at=?, note=?, updated_at=?
    WHERE id=? AND branch_id=?`).run(
    v.code, v.name, v.type, v.value, v.scope, v.sku_id, v.min_total,
    v.active, v.starts_at, v.ends_at, v.note, now(), id, branch_id);
  audit('voucher.update', { id, name: v.name }, branch_id);
  emit('vouchers:updated', { id, updated: true }, branch_id);
  return getVoucher(id, branch_id);
}

export function toggleVoucher(id, active, branch_id = 'br1') {
  const cur = db.prepare(`SELECT * FROM vouchers WHERE id=? AND branch_id=?`).get(id, branch_id);
  if (!cur) throw new Error('Voucher không tồn tại');
  const on = active === undefined ? (cur.active ? 0 : 1) : (active ? 1 : 0);
  db.prepare(`UPDATE vouchers SET active=?, updated_at=? WHERE id=? AND branch_id=?`).run(on, now(), id, branch_id);
  audit(on ? 'voucher.enable' : 'voucher.disable', { id, name: cur.name }, branch_id);
  emit('vouchers:updated', { id, active: !!on }, branch_id);
  return getVoucher(id, branch_id);
}

export function getVoucher(id, branch_id = 'br1') {
  const row = db.prepare(`
    SELECT v.*, s.name AS sku_name, s.emoji AS sku_emoji
    FROM vouchers v
    LEFT JOIN skus s ON s.id=v.sku_id
    WHERE v.id=? AND v.branch_id=?`).get(id, branch_id);
  return row ? normalizeRow(row) : null;
}

export function calculateRetailDiscount(lines, voucher_id = null, branch_id = 'br1') {
  const active = listActiveVouchers(branch_id);
  const skuVouchers = active.filter(v => v.scope === 'sku');
  const subtotal = lines.reduce((s, l) => s + l.qty * l.price, 0);
  const appliedSkuPromos = [];
  let lineDiscount = 0;

  for (const [line_index, line] of lines.entries()) {
    const base = line.qty * line.price;
    const candidates = skuVouchers
      .filter(v => v.sku_id === line.sku_id && base >= (v.min_total || 0))
      .map(v => ({ voucher: v, amount: voucherAmount(v, base, line.qty) }))
      .filter(x => x.amount > 0)
      .sort((a, b) => b.amount - a.amount);
    const best = candidates[0];
    if (!best) continue;
    const amount = Math.min(base, best.amount);
    lineDiscount += amount;
    appliedSkuPromos.push({
      line_index,
      sku_id: line.sku_id,
      voucher_id: best.voucher.id,
      code: best.voucher.code,
      name: best.voucher.name,
      amount,
    });
  }

  const baseAfterLinePromos = Math.max(0, subtotal - lineDiscount);
  let orderDiscount = 0;
  let orderVoucher = null;
  if (voucher_id) {
    const v = active.find(x => x.id === voucher_id && x.scope === 'order');
    if (!v) throw new Error('Voucher không khả dụng hoặc đã tắt');
    if (baseAfterLinePromos < (v.min_total || 0)) throw new Error('Chưa đạt giá trị tối thiểu của voucher');
    orderDiscount = Math.min(baseAfterLinePromos, voucherAmount(v, baseAfterLinePromos, 1));
    orderVoucher = brief(v, orderDiscount);
  }

  const discount = Math.min(subtotal, Math.round(lineDiscount + orderDiscount));
  return {
    subtotal,
    lineDiscount: Math.round(lineDiscount),
    orderDiscount: Math.round(orderDiscount),
    discount,
    total: Math.max(0, subtotal - discount),
    appliedSkuPromos,
    orderVoucher,
  };
}

function normalizeInput(body = {}, cur = {}) {
  const type = body.type !== undefined ? normalizeType(body.type) : (cur.type || 'pct');
  const scope = body.scope !== undefined || body.applies_to !== undefined
    ? normalizeScope(body.scope ?? body.applies_to)
    : (cur.scope || 'order');
  const name = pickText(body.name, cur.name);
  if (!name) throw new Error('Thiếu tên voucher');
  const value = pickInt(body.value, cur.value ?? cur.val ?? 0);
  if (type === 'pct' && (value <= 0 || value > 100)) throw new Error('Giảm theo % phải từ 1 đến 100');
  if (type === 'amount' && value <= 0) throw new Error('Số tiền giảm phải lớn hơn 0');
  const starts_at = pickDate(body.starts_at, cur.starts_at);
  const ends_at = pickDate(body.ends_at, cur.ends_at);
  if (starts_at && ends_at && starts_at > ends_at) throw new Error('Ngày bắt đầu không được sau ngày kết thúc');
  const sku_id = scope === 'sku' ? pickText(body.sku_id, cur.sku_id) : null;
  if (scope === 'sku' && !sku_id) throw new Error('Voucher gán sản phẩm cần chọn SKU');
  return {
    code: normalizeCode(body.code !== undefined ? body.code : cur.code),
    name,
    type,
    value,
    scope,
    sku_id,
    min_total: Math.max(0, pickInt(body.min_total, cur.min_total || 0)),
    active: body.active !== undefined ? (body.active ? 1 : 0) : (cur.active === undefined ? 1 : (cur.active ? 1 : 0)),
    starts_at,
    ends_at,
    note: body.note !== undefined ? (String(body.note || '').trim() || null) : (cur.note || null),
  };
}

function ensureSku(v, branch_id) {
  if (v.scope !== 'sku') return;
  const sku = db.prepare(`SELECT id FROM skus WHERE id=? AND branch_id=? AND active=1`).get(v.sku_id, branch_id);
  if (!sku) throw new Error('SKU gán voucher không tồn tại');
}

function ensureUniqueCode(code, branch_id, exceptId = null) {
  if (!code) return;
  const found = db.prepare(`SELECT id FROM vouchers WHERE branch_id=? AND UPPER(code)=UPPER(?)`).get(branch_id, code);
  if (found && found.id !== exceptId) throw new Error('Mã voucher đã tồn tại');
}

function normalizeType(v) {
  if (v === 'amt' || v === 'amount') return 'amount';
  if (v === 'pct') return 'pct';
  if (TYPES.includes(v)) return v;
  throw new Error('Loại voucher không hợp lệ');
}

function normalizeScope(v) {
  const s = v === 'product' || v === 'item' ? 'sku' : (v || 'order');
  if (!SCOPES.includes(s)) throw new Error('Phạm vi voucher không hợp lệ');
  return s;
}

function normalizeCode(v) {
  const s = String(v || '').trim().toUpperCase();
  return s || null;
}

function pickText(v, fallback) {
  if (v === undefined || v === null) return fallback ? String(fallback).trim() : null;
  const s = String(v).trim();
  return s || null;
}

function pickInt(v, fallback = 0) {
  if (v === undefined || v === null || v === '') return parseInt(fallback) || 0;
  const n = parseInt(v);
  return Number.isFinite(n) ? n : 0;
}

function pickDate(v, fallback) {
  if (v === undefined) return fallback || null;
  const s = String(v || '').trim();
  return s ? s.slice(0, 10) : null;
}

function normalizeRow(r) {
  return {
    ...r,
    active: !!r.active,
    value: parseInt(r.value) || 0,
    min_total: parseInt(r.min_total) || 0,
    usable: isUsableToday(r),
  };
}

function isUsableToday(v) {
  if (!v.active) return false;
  const today = now().slice(0, 10);
  if (v.starts_at && v.starts_at > today) return false;
  if (v.ends_at && v.ends_at < today) return false;
  return true;
}

function voucherAmount(v, base, qty = 1) {
  if (v.type === 'pct') return Math.floor(base * (v.value || 0) / 100);
  const amount = v.scope === 'sku' ? (v.value || 0) * qty : (v.value || 0);
  return Math.min(base, amount);
}

function brief(v, amount = 0) {
  return {
    id: v.id,
    code: v.code,
    name: v.name,
    type: v.type,
    value: v.value,
    scope: v.scope,
    sku_id: v.sku_id,
    amount,
  };
}
