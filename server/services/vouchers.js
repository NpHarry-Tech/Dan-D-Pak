// Retail promotion/voucher service.
// One compact voucher table covers order-level discounts, line promos, and
// birthday/time-window campaigns.
import { db, uid, now, audit } from '../db.js';
import { parseJson } from '../core/util.js';
import { emit } from '../realtime.js';
import { perkDiscount } from './customers.js';

const TYPES = ['pct', 'amount', 'buy_x_get_1'];
// order    = toan bill
// sku      = one SKU, optionally one lot/date
// all_sku  = every product, calculated per cart line
const SCOPES = ['order', 'sku', 'all_sku'];
const BIRTHDAY_MODES = ['off', 'day', 'month'];
const USAGE_LIMITS = ['unlimited', 'once'];
const WEEKDAY_LABEL = { 1: 'T2', 2: 'T3', 3: 'T4', 4: 'T5', 5: 'T6', 6: 'T7', 7: 'CN' };

export function listVouchers(branch_id = 'br1') {
  return db.prepare(`
    SELECT v.*, s.name AS sku_name, s.emoji AS sku_emoji
    FROM vouchers v
    LEFT JOIN skus s ON s.id=v.sku_id
    WHERE v.branch_id=?
    ORDER BY v.active DESC, v.created_at DESC`).all(branch_id).map(normalizeRow);
}
export function listActiveVouchers(branch_id = 'br1') {
  return listVouchers(branch_id).filter(v => isUsableNow(v, { ignoreCustomer: true }));
}

export function createVoucher(body, branch_id = 'br1') {
  const v = normalizeInput(body);
  ensureSku(v, branch_id);
  ensureUniqueCode(v.code, branch_id);
  const id = body.id || uid('v_');
  db.prepare(`INSERT INTO vouchers
    (id,branch_id,code,name,type,value,scope,sku_id,lot_no,min_total,active,starts_at,ends_at,schedule_json,scope_json,note,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, branch_id, v.code, v.name, v.type, v.value, v.scope, v.sku_id, v.lot_no, v.min_total,
    v.active, v.starts_at, v.ends_at, JSON.stringify(v.schedule), JSON.stringify(v.scope_config),
    v.note, now(), now());
  audit('voucher.create', { id, name: v.name, scope: v.scope, sku_id: v.sku_id, lot_no: v.lot_no }, branch_id);
  emit('vouchers:updated', { id, created: true }, branch_id);
  return getVoucher(id, branch_id);
}

export function updateVoucher(id, body, branch_id = 'br1') {
  const cur = db.prepare(`SELECT * FROM vouchers WHERE id=? AND branch_id=?`).get(id, branch_id);
  if (!cur) throw new Error('Voucher khong ton tai');
  const v = normalizeInput(body, cur);
  ensureSku(v, branch_id);
  ensureUniqueCode(v.code, branch_id, id);
  db.prepare(`UPDATE vouchers SET
      code=?, name=?, type=?, value=?, scope=?, sku_id=?, lot_no=?, min_total=?,
      active=?, starts_at=?, ends_at=?, schedule_json=?, scope_json=?, note=?, updated_at=?
    WHERE id=? AND branch_id=?`).run(
    v.code, v.name, v.type, v.value, v.scope, v.sku_id, v.lot_no, v.min_total,
    v.active, v.starts_at, v.ends_at, JSON.stringify(v.schedule), JSON.stringify(v.scope_config),
    v.note, now(), id, branch_id);
  audit('voucher.update', { id, name: v.name }, branch_id);
  emit('vouchers:updated', { id, updated: true }, branch_id);
  return getVoucher(id, branch_id);
}

export function toggleVoucher(id, active, branch_id = 'br1') {
  const cur = db.prepare(`SELECT * FROM vouchers WHERE id=? AND branch_id=?`).get(id, branch_id);
  if (!cur) throw new Error('Voucher khong ton tai');
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

export function calculateRetailDiscount(lines, voucher_id = null, branch_id = 'br1', opts = {}) {
  const active = listVouchers(branch_id).filter(v => isUsableNow(v, { customer: opts.customer }));
  const skuVouchers = active.filter(v => v.scope === 'sku' || v.scope === 'all_sku');
  // CTKM cấp SẢN PHẨM (scope 'sku' và 'all_sku', gồm cả "mua X tặng 1") CHỈ được áp
  // cho dòng HÀNG RETAIL THẬT (có sku_id). Món F&B (menu_item, không có sku_id) TUYỆT
  // ĐỐI không dính — không thể có chuyện "mua 5 tặng 1" cho món ăn. Giảm giá cấp BILL
  // (voucher đơn / ưu đãi khách / giảm tay) thì vẫn áp bình thường cho cả hai.
  const matchesLine = (v, line, lineLotNo) => {
    if (!line.sku_id) return false;
    if (v.scope === 'all_sku') return true;
    return v.sku_id === line.sku_id && (!v.lot_no || v.lot_no === lineLotNo);
  };
  const subtotal = lines.reduce((s, l) => s + l.qty * l.price, 0);
  const appliedSkuPromos = [];
  let lineDiscount = 0;

  for (const [line_index, line] of lines.entries()) {
    const base = line.qty * line.price;
    let amount = 0;
    let freeUnits = 0;
    const usedNames = new Set();
    const descParts = [];

    let lineLotNo = null;
    if (line.lot_id) {
      const lot = db.prepare(`SELECT lot_no FROM stock_lots WHERE id=?`).get(line.lot_id);
      if (lot) lineLotNo = lot.lot_no;
    }

    const selectedVoucherId = line.voucher_id || null;
    const lineSkuVouchers = selectedVoucherId
      ? skuVouchers.filter(v => v.id === selectedVoucherId && matchesLine(v, line, lineLotNo))
      : [];
    if (selectedVoucherId && !lineSkuVouchers.length) {
      // Nói rõ nguyên nhân: món F&B không có sku_id nên KHÔNG áp được CTKM sản phẩm.
      throw new Error(!line.sku_id
        ? `Món "${line.name || 'F&B'}" là món F&B nên không áp được khuyến mại theo sản phẩm (CTKM sản phẩm chỉ dành cho hàng retail).`
        : 'Voucher san pham khong kha dung hoac da tat');
    }

    const buyXMatches = lineSkuVouchers.filter(v =>
      v.type === 'buy_x_get_1' && matchesLine(v, line, lineLotNo)
    );
    const customPromo = buyXMatches.find(v => v.scope === 'sku') || buyXMatches[0];
    if (customPromo && line.price > 0) {
      const x = Math.max(1, parseInt(customPromo.value) || 0);
      freeUnits = Math.floor((Number(line.qty) || 0) / (x + 1));
      if (freeUnits > 0) {
        const a = Math.min(base, freeUnits * line.price);
        amount += a;
        usedNames.add(customPromo.name);
        descParts.push(`tang ${freeUnits} ${line.name || 'san pham'}`);
      }
    }

    const remaining = Math.max(0, base - amount);
    const best = lineSkuVouchers
      .filter(v =>
        v.type !== 'buy_x_get_1' &&
        matchesLine(v, line, lineLotNo) &&
        base >= (v.min_total || 0)
      )
      .map(v => ({ voucher: v, amount: Math.min(remaining, voucherAmount(v, remaining, line.qty)) }))
      .filter(x => x.amount > 0)
      .sort((a, b) => b.amount - a.amount)[0];
    let voucher = null;
    if (best) {
      amount += best.amount;
      voucher = best.voucher;
      usedNames.add(best.voucher.name);
      descParts.push(`giam ${formatVnd(best.amount)}`);
    }

    if (amount <= 0) continue;
    amount = Math.min(base, amount);
    lineDiscount += amount;
    const source = voucher || customPromo;
    const name = [...usedNames].join(' + ') || source?.name || source?.code || 'Khuyen mai';
    appliedSkuPromos.push({
      line_index,
      sku_id: line.sku_id,
      voucher_id: source?.id || null,
      code: source?.code || '',
      name,
      amount: Math.round(amount),
      type: source?.type || '',
      value: source?.value || 0,
      free_units: freeUnits,
      free_product_name: freeUnits > 0 ? (line.name || '') : '',
      description: descParts.length ? `${name}: ${descParts.join(', ')}` : name,
    });
  }

  const baseAfterLinePromos = Math.max(0, subtotal - lineDiscount);
  let orderDiscount = 0;
  let orderVoucher = null;
  if (voucher_id) {
    const v = active.find(x => x.id === voucher_id && x.scope === 'order');
    if (!v) throw new Error('Voucher khong kha dung hoac da tat');
    if (baseAfterLinePromos < (v.min_total || 0)) throw new Error('Chua dat gia tri toi thieu cua voucher');
    orderDiscount = Math.min(baseAfterLinePromos, voucherAmount(v, baseAfterLinePromos, 1));
    orderVoucher = brief(v, orderDiscount);
  }

  const remainAfterVoucher = Math.max(0, baseAfterLinePromos - orderDiscount);
  const extraDiscount = Math.min(remainAfterVoucher, Math.max(0, Math.round(Number(opts.extraDiscount) || 0)));

  const discount = Math.min(subtotal, Math.round(lineDiscount + orderDiscount + extraDiscount));
  return {
    subtotal,
    lineDiscount: Math.round(lineDiscount),
    orderDiscount: Math.round(orderDiscount),
    extraDiscount,
    discount,
    total: Math.max(0, subtotal - discount),
    appliedSkuPromos,
    orderVoucher,
  };
}

/// KẾ HOẠCH GIẢM GIÁ DÙNG CHUNG cho CẢ Retail LẪN F&B — một engine duy nhất, cùng
/// thứ tự áp, nên hai bên không thể lệch nhau:
///   1) CTKM theo sản phẩm  → CHỈ dòng hàng retail (có sku_id); món F&B không dính.
///   2) Voucher đơn (scope 'order') → áp cả bill (cả F&B lẫn retail).
///   3) Ưu đãi khách hàng (perk)    → tính trên phần còn lại sau (1)+(2).
///   4) Giảm tay (manual)           → cộng vào phần "extra", bị kẹp không quá tổng.
/// [lines]: [{ sku_id?, qty, price, lot_id?, voucher_id?, name }]
export function buildDiscountPlan(lines, {
  voucher_id = null,
  customer = null,
  manual_discount = 0,
  branch_id = 'br1',
} = {}) {
  // Lượt 1: biết phần còn lại SAU khuyến mại sản phẩm + voucher đơn để tính perk đúng gốc.
  const pre = calculateRetailDiscount(lines, voucher_id, branch_id, { customer });
  const baseForExtra = Math.max(0, pre.subtotal - pre.lineDiscount - pre.orderDiscount);
  const customerPerk = customer ? perkDiscount(customer, baseForExtra) : 0;
  const manual = Math.max(0, Math.round(Number(manual_discount) || 0));
  const plan = calculateRetailDiscount(lines, voucher_id, branch_id, {
    customer,
    extraDiscount: customerPerk + manual,
  });
  return {
    ...plan,
    customerPerk,
    manual,
    breakdown: {
      product_promos: plan.lineDiscount,
      voucher: plan.orderDiscount,
      customer_perk: customerPerk,
      manual,
    },
  };
}

function normalizeInput(body = {}, cur = {}) {
  const type = body.type !== undefined ? normalizeType(body.type) : (cur.type || 'pct');
  const scope = body.scope !== undefined || body.applies_to !== undefined
    ? normalizeScope(body.scope ?? body.applies_to)
    : (cur.scope || 'order');
  const name = pickText(body.name, cur.name);
  if (!name) throw new Error('Thieu ten chuong trinh');
  const value = pickInt(body.value, cur.value ?? cur.val ?? 0);
  if (type === 'pct' && (value <= 0 || value > 100)) throw new Error('Giam theo % phai tu 1 den 100');
  if (type === 'amount' && value <= 0) throw new Error('So tien giam phai lon hon 0');
  if (type === 'buy_x_get_1' && value <= 0) throw new Error('So luong mua X phai lon hon 0');
  const starts_at = pickDateTime(body.starts_at, cur.starts_at);
  const ends_at = pickDateTime(body.ends_at, cur.ends_at);
  if (starts_at && ends_at && compareDateTime(starts_at, ends_at) > 0) {
    throw new Error('Thoi gian bat dau khong duoc sau thoi gian ket thuc');
  }
  const sku_id = scope === 'sku' ? pickText(body.sku_id, cur.sku_id) : null;
  if (scope === 'sku' && !sku_id) throw new Error('Voucher gan san pham can chon SKU');
  const lot_no = scope === 'sku' ? pickText(body.lot_no, cur.lot_no) : null;
  return {
    code: normalizeCode(body.code !== undefined ? body.code : cur.code),
    name,
    type,
    value,
    scope,
    sku_id,
    lot_no,
    min_total: Math.max(0, pickInt(body.min_total, cur.min_total || 0)),
    active: body.active !== undefined ? (body.active ? 1 : 0) : (cur.active === undefined ? 1 : (cur.active ? 1 : 0)),
    starts_at,
    ends_at,
    schedule: normalizeSchedule(body, cur),
    scope_config: normalizeScopeConfig(body, cur),
    note: body.note !== undefined ? (String(body.note || '').trim() || null) : (cur.note || null),
  };
}

function normalizeSchedule(body = {}, cur = {}) {
  const curSchedule = parseJson(cur.schedule_json, {});
  const raw = body.schedule && typeof body.schedule === 'object'
    ? body.schedule
    : {
        months: body.months ?? body.schedule_months,
        monthDays: body.monthDays ?? body.month_days ?? body.days,
        weekdays: body.weekdays,
        timeStart: body.timeStart ?? body.time_start,
        timeEnd: body.timeEnd ?? body.time_end,
        birthdayMode: body.birthdayMode ?? body.birthday_mode,
        usageLimit: body.usageLimit ?? body.usage_limit,
      };
  const hasRaw = Object.values(raw).some(v => v !== undefined);
  const src = hasRaw ? raw : curSchedule;
  const birthdayMode = BIRTHDAY_MODES.includes(String(src.birthdayMode || src.birthday_mode || 'off'))
    ? String(src.birthdayMode || src.birthday_mode || 'off')
    : 'off';
  const usageLimit = USAGE_LIMITS.includes(String(src.usageLimit || src.usage_limit || 'unlimited'))
    ? String(src.usageLimit || src.usage_limit || 'unlimited')
    : 'unlimited';
  return {
    months: intList(src.months, 1, 12),
    monthDays: intList(src.monthDays ?? src.month_days ?? src.days, 1, 31),
    weekdays: intList(src.weekdays, 1, 7),
    timeStart: normalizeTime(src.timeStart ?? src.time_start),
    timeEnd: normalizeTime(src.timeEnd ?? src.time_end),
    birthdayMode,
    usageLimit,
  };
}

function normalizeScopeConfig(body = {}, cur = {}) {
  const curScope = parseJson(cur.scope_json, {});
  const raw = body.scope_config && typeof body.scope_config === 'object'
    ? body.scope_config
    : {
        customerGroups: body.customerGroups ?? body.customer_groups,
        staffIds: body.staffIds ?? body.staff_ids,
        branches: body.branches,
      };
  const hasRaw = Object.values(raw).some(v => v !== undefined);
  const src = hasRaw ? raw : curScope;
  return {
    customerGroups: textList(src.customerGroups ?? src.customer_groups),
    staffIds: textList(src.staffIds ?? src.staff_ids),
    branches: textList(src.branches),
  };
}

function ensureSku(v, branch_id) {
  if (v.scope !== 'sku') return;
  const sku = db.prepare(`SELECT id FROM skus WHERE id=? AND branch_id=? AND active=1`).get(v.sku_id, branch_id);
  if (!sku) throw new Error('SKU gan voucher khong ton tai');
}

function ensureUniqueCode(code, branch_id, exceptId = null) {
  if (!code) return;
  const found = db.prepare(`SELECT id FROM vouchers WHERE branch_id=? AND UPPER(code)=UPPER(?)`).get(branch_id, code);
  if (found && found.id !== exceptId) throw new Error('Ma voucher da ton tai');
}

function normalizeType(v) {
  if (v === 'amt' || v === 'amount') return 'amount';
  if (v === 'pct') return 'pct';
  if (TYPES.includes(v)) return v;
  throw new Error('Loai voucher khong hop le');
}

function normalizeScope(v) {
  const s = v === 'product' || v === 'item' ? 'sku' : (v || 'order');
  if (!SCOPES.includes(s)) throw new Error('Pham vi voucher khong hop le');
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

function pickDateTime(v, fallback) {
  if (v === undefined) return fallback || null;
  const s = String(v || '').trim();
  return s ? s.slice(0, 16) : null;
}

function compareDateTime(a, b) {
  const ta = dateTimeMs(a, false);
  const tb = dateTimeMs(b, true);
  if (Number.isFinite(ta) && Number.isFinite(tb)) return ta - tb;
  return String(a).localeCompare(String(b));
}

function dateTimeMs(value, endOfDay = false) {
  const s = String(value || '').trim();
  if (!s) return NaN;
  const iso = s.length <= 10
    ? `${s}T${endOfDay ? '23:59:59' : '00:00:00'}`
    : s.replace(' ', 'T');
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : NaN;
}

function normalizeRow(r) {
  const schedule = normalizeSchedule({}, r);
  const scope_config = normalizeScopeConfig({}, r);
  const row = {
    ...r,
    active: !!r.active,
    value: parseInt(r.value) || 0,
    min_total: parseInt(r.min_total) || 0,
    schedule,
    scope_config,
  };
  row.usable = isUsableNow(row, { ignoreCustomer: true });
  row.schedule_label = scheduleLabel(row);
  row.scope_label = scopeLabel(scope_config);
  return row;
}

function isUsableNow(v, { customer = null, ignoreCustomer = false, at = new Date() } = {}) {
  if (!v.active) return false;
  const t = at.getTime();
  if (v.starts_at && dateTimeMs(v.starts_at, false) > t) return false;
  if (v.ends_at && dateTimeMs(v.ends_at, true) < t) return false;

  const schedule = v.schedule || normalizeSchedule({}, v);
  const month = at.getMonth() + 1;
  const day = at.getDate();
  const weekday = at.getDay() === 0 ? 7 : at.getDay();
  if (schedule.months?.length && !schedule.months.includes(month)) return false;
  if (schedule.monthDays?.length && !schedule.monthDays.includes(day)) return false;
  if (schedule.weekdays?.length && !schedule.weekdays.includes(weekday)) return false;
  if (!timeAllowed(schedule, at)) return false;

  if (!ignoreCustomer && schedule.birthdayMode && schedule.birthdayMode !== 'off') {
    const bd = parseBirthday(customer?.birthday);
    if (!bd) return false;
    if (schedule.birthdayMode === 'month' && bd.month !== month) return false;
    if (schedule.birthdayMode === 'day' && (bd.month !== month || bd.day !== day)) return false;
  }
  if (!ignoreCustomer && schedule.usageLimit === 'once' && hasCustomerUsedVoucher(customer, v.id, v.branch_id)) {
    return false;
  }
  return true;
}

function timeAllowed(schedule = {}, at = new Date()) {
  const start = minutesOfDay(schedule.timeStart);
  const end = minutesOfDay(schedule.timeEnd);
  if (start == null && end == null) return true;
  const cur = at.getHours() * 60 + at.getMinutes();
  if (start != null && end != null) {
    if (start <= end) return cur >= start && cur <= end;
    return cur >= start || cur <= end;
  }
  if (start != null) return cur >= start;
  return cur <= end;
}

function voucherAmount(v, base, qty = 1) {
  if (v.type === 'pct') return Math.floor(base * (v.value || 0) / 100);
  if (v.type === 'buy_x_get_1') return 0;
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
    lot_no: v.lot_no,
    amount,
    description: `${v.name}${amount > 0 ? `: giam ${formatVnd(amount)}` : ''}`,
  };
}

function intList(value, min, max) {
  const arr = Array.isArray(value)
    ? value
    : String(value ?? '').split(',').map(s => s.trim()).filter(Boolean);
  return [...new Set(arr.map(v => parseInt(v)).filter(n => Number.isFinite(n) && n >= min && n <= max))]
    .sort((a, b) => a - b);
}

function textList(value) {
  const arr = Array.isArray(value)
    ? value
    : String(value ?? '').split(',').map(s => s.trim()).filter(Boolean);
  return [...new Set(arr.map(v => String(v || '').trim()).filter(Boolean))];
}

function normalizeTime(value) {
  const s = String(value || '').trim();
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(s);
  if (!m) return '';
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

function minutesOfDay(value) {
  const s = normalizeTime(value);
  if (!s) return null;
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
}

function parseBirthday(value) {
  const s = String(value || '').trim();
  if (!s) return null;
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s) || /^(\d{1,2})[/-](\d{1,2})/.exec(s);
  if (!m) return null;
  if (m.length === 4) {
    return { month: parseInt(m[2]), day: parseInt(m[3]) };
  }
  return { month: parseInt(m[2]), day: parseInt(m[1]) };
}

function hasCustomerUsedVoucher(customer, voucherId, branch_id = 'br1') {
  if (!customer || !voucherId) return false;
  const needles = [];
  if (customer.id) needles.push(`%"id":"${likeEscape(customer.id)}"%`);
  if (customer.phone) needles.push(`%"phone":"${likeEscape(customer.phone)}"%`);
  if (!needles.length) return false;
  const promoNeedle = `%"voucher_id":"${likeEscape(voucherId)}"%`;
  for (const needle of needles) {
    const orderVoucher = db.prepare(`
      SELECT 1 FROM orders
      WHERE branch_id=? AND status='paid' AND voucher_id=? AND customer_json LIKE ? ESCAPE '\\'
      LIMIT 1`).get(branch_id, voucherId, needle);
    if (orderVoucher) return true;
    const lineVoucher = db.prepare(`
      SELECT 1
      FROM order_items oi
      JOIN orders o ON o.id=oi.order_id
      WHERE o.branch_id=? AND o.status='paid'
        AND o.customer_json LIKE ? ESCAPE '\\'
        AND oi.promo_json LIKE ? ESCAPE '\\'
      LIMIT 1`).get(branch_id, needle, promoNeedle);
    if (lineVoucher) return true;
  }
  return false;
}

function likeEscape(value) {
  return String(value || '').replace(/[\\%_]/g, ch => `\\${ch}`).replace(/"/g, '\\"');
}

function scheduleLabel(v) {
  const s = v.schedule || {};
  const parts = [];
  const window = [v.starts_at, v.ends_at].filter(Boolean).join(' -> ');
  if (window) parts.push(window);
  if (s.birthdayMode === 'month') parts.push('thang sinh nhat');
  if (s.birthdayMode === 'day') parts.push('ngay sinh nhat');
  if (s.months?.length) parts.push(`thang ${s.months.join(',')}`);
  if (s.monthDays?.length) parts.push(`ngay ${s.monthDays.join(',')}`);
  if (s.weekdays?.length) parts.push(s.weekdays.map(d => WEEKDAY_LABEL[d] || d).join(', '));
  if (s.timeStart || s.timeEnd) parts.push(`${s.timeStart || '00:00'}-${s.timeEnd || '23:59'}`);
  if (s.usageLimit === 'once') parts.push('1 lan/khach');
  return parts.join(' | ') || 'Luon ap dung';
}

function scopeLabel(scope = {}) {
  const parts = [];
  if (scope.branches?.length) parts.push(`chi nhanh: ${scope.branches.length}`);
  if (scope.customerGroups?.length) parts.push(`nhom KH: ${scope.customerGroups.join(', ')}`);
  if (scope.staffIds?.length) parts.push(`nhan vien: ${scope.staffIds.length}`);
  return parts.join(' | ') || 'Tat ca';
}

function formatVnd(n) {
  return `${Math.round(Number(n) || 0).toLocaleString('vi-VN')}d`;
}
