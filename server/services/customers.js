// Customer directory — remembers buyers (incl. full invoice info) so special
// customers can carry a default perk (free / % / amount off) into retail & POS.
import { db, uid, now, audit } from '../db.js';
import { emit } from '../realtime.js';
import { archiveCustomer } from './archive.js';
import { getLoyaltyConfig } from './settings.js';

const PERKS = ['none', 'pct', 'amount', 'free'];
const PARTNER_TYPES = ['customer', 'supplier', 'both', 'staff'];

function normalizeRow(r) {
  if (!r) return null;
  const favorite_items = parseJson(r.favorite_items_json, []);
  const partner_type = PARTNER_TYPES.includes(r.partner_type) ? r.partner_type : 'customer';
  return {
    ...r,
    partner_type,
    is_customer: partner_type === 'customer' || partner_type === 'both',
    is_supplier: partner_type === 'supplier' || partner_type === 'both',
    is_staff: partner_type === 'staff',
    active: r.active === undefined || r.active === null ? 1 : (parseInt(r.active) ? 1 : 0),
    auto_invoice: r.auto_invoice === undefined || r.auto_invoice === null ? 0 : (parseInt(r.auto_invoice) ? 1 : 0),
    perk_value: parseInt(r.perk_value) || 0,
    loyalty_points: parseInt(r.loyalty_points) || 0,
    loyalty_tier: r.loyalty_tier || '',
    total_orders: parseInt(r.total_orders) || 0,
    total_spent: parseInt(r.total_spent) || 0,
    favorite_items,
    profile_summary: favorite_items.length ? `Hay mua: ${favorite_items.slice(0, 3).map(i => i.name).join(', ')}` : '',
  };
}

function pickPartnerType(v) { return PARTNER_TYPES.includes(v) ? v : 'customer'; }

function parseJson(raw, fallback) {
  try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
}

function matchesTerm(c, term) {
  if (!term) return true;
  return [c.code, c.name, c.phone, c.tax_code, c.company, c.email, c.contact_person, c.address, c.preferences, c.allergies, c.profile_summary]
    .some(v => String(v || '').toLowerCase().includes(term));
}

// Sales-side customer picker (POS/retail/invoice). Suppliers never show here.
export function listCustomers(branch_id = 'br1', q = '') {
  const rows = db.prepare(`SELECT * FROM customers WHERE branch_id=? AND active!=0 ORDER BY updated_at DESC, created_at DESC`).all(branch_id);
  const term = String(q || '').trim().toLowerCase();
  // Khách hàng + nhân viên (CBNV) đều chọn được ở POS để áp ưu đãi mặc định. NCC thì không.
  const out = rows.map(normalizeRow).filter(c => c.is_customer || c.is_staff);
  return out.filter(c => matchesTerm(c, term)).slice(0, 200);
}

// Full contacts directory (Liên hệ): customers + suppliers, filterable by type.
export function listPartners(branch_id = 'br1', { type = 'all', q = '', includeInactive = false } = {}) {
  const rows = db.prepare(`SELECT * FROM customers WHERE branch_id=? ORDER BY updated_at DESC, created_at DESC`).all(branch_id);
  const term = String(q || '').trim().toLowerCase();
  let out = rows.map(normalizeRow);
  if (!includeInactive) out = out.filter(c => c.active !== 0);
  if (type === 'customer') out = out.filter(c => c.is_customer);
  else if (type === 'supplier') out = out.filter(c => c.is_supplier);
  else if (type === 'staff') out = out.filter(c => c.is_staff);
  return out.filter(c => matchesTerm(c, term)).slice(0, 500);
}

export function partnerCounts(branch_id = 'br1') {
  const all = db.prepare(`SELECT * FROM customers WHERE branch_id=? AND active!=0`).all(branch_id).map(normalizeRow);
  return {
    all: all.length,
    customer: all.filter(c => c.is_customer).length,
    supplier: all.filter(c => c.is_supplier).length,
    staff: all.filter(c => c.is_staff).length,
  };
}

export function getCustomer(id, branch_id = 'br1') {
  if (!id) return null;
  return normalizeRow(db.prepare(`SELECT * FROM customers WHERE id=? AND branch_id=?`).get(id, branch_id));
}

export function findByTaxCode(tax_code, branch_id = 'br1') {
  const tc = String(tax_code || '').trim();
  if (!tc) return null;
  return normalizeRow(db.prepare(`SELECT * FROM customers WHERE branch_id=? AND tax_code=?`).get(branch_id, tc));
}

export function findByPhone(phone, branch_id = 'br1') {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return null;
  return normalizeRow(db.prepare(`
    SELECT * FROM customers
    WHERE branch_id=?
      AND REPLACE(REPLACE(REPLACE(phone,' ',''),'.',''),'-','') LIKE ?
    ORDER BY updated_at DESC, created_at DESC
    LIMIT 1`).get(branch_id, `%${digits.slice(-9)}`));
}

function pickPerk(v) { return PERKS.includes(v) ? v : 'none'; }
function str(v, max = 300) { return String(v ?? '').trim().slice(0, max); }
function birthday(v) {
  const s = str(v, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

function cleanCustomerCode(v) {
  return str(v, 40).replace(/\s+/g, '').toUpperCase();
}

function nextCustomerCode(branch_id = 'br1') {
  const row = db.prepare(`
    SELECT COALESCE(MAX(CAST(SUBSTR(code, 3) AS INTEGER)), 0) AS n
    FROM customers
    WHERE branch_id=? AND code GLOB 'DC[0-9]*'`).get(branch_id);
  return `DC${String((Number(row?.n) || 0) + 1).padStart(6, '0')}`;
}

function loyaltyTier(points, cfg) {
  const tiers = Array.isArray(cfg?.tiers) ? cfg.tiers : [];
  let picked = null;
  for (const t of tiers) {
    if ((parseInt(points) || 0) >= (parseInt(t.fromPoints) || 0)) picked = t;
  }
  return picked || tiers[0] || null;
}

function roundedPoints(value, mode = 'floor') {
  if (mode === 'ceil') return Math.ceil(value);
  if (mode === 'round') return Math.round(value);
  return Math.floor(value);
}

function birthdayToday(customer) {
  const b = String(customer?.birthday || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b)) return false;
  return b.slice(5) === new Date().toISOString().slice(5, 10);
}

function loyaltyEarn(customer, amount, cfg) {
  const currentPoints = parseInt(customer?.loyalty_points) || 0;
  if (!cfg?.enabled) return { points: 0, tier: loyaltyTier(currentPoints, cfg)?.name || '' };
  if (cfg.phoneRequired && !String(customer?.phone || '').trim()) {
    return { points: 0, tier: loyaltyTier(currentPoints, cfg)?.name || '' };
  }
  const total = Math.max(0, parseInt(amount) || 0);
  let points = 0;
  const amountRule = cfg.earn?.amount || {};
  if (amountRule.enabled && total >= (parseInt(amountRule.minSpend) || 0)) {
    const unit = Math.max(1, parseInt(amountRule.spend) || 1);
    points += roundedPoints(total / unit, amountRule.rounding) * (parseInt(amountRule.points) || 0);
  }
  const orderRule = cfg.earn?.order || {};
  if (orderRule.enabled && total >= (parseInt(orderRule.minSpend) || 0)) {
    points += parseInt(orderRule.points) || 0;
  }
  const tier = loyaltyTier(currentPoints, cfg);
  let multiplier = Number(tier?.earnMultiplier) || 1;
  if (cfg.earn?.birthday?.enabled && birthdayToday(customer)) {
    multiplier *= Number(cfg.earn.birthday.multiplier) || 1;
  }
  const earned = Math.max(0, Math.floor(points * multiplier));
  return {
    points: earned,
    tier: loyaltyTier(currentPoints + earned, cfg)?.name || tier?.name || '',
  };
}

export function upsertCustomer(body = {}, branch_id = 'br1') {
  const name = str(body.name, 200);
  const existing = body.id ? db.prepare(`SELECT * FROM customers WHERE id=? AND branch_id=?`).get(body.id, branch_id) : null;
  const code = cleanCustomerCode(body.code) || existing?.code || nextCustomerCode(branch_id);
  const dup = db.prepare(`SELECT id FROM customers WHERE branch_id=? AND code=? AND id!=?`).get(branch_id, code, existing?.id || '');
  if (dup) throw new Error('Mã khách hàng đã tồn tại');
  if (!name) throw new Error('Thiếu tên liên hệ');
  const perk_type = pickPerk(body.perk_type);
  let perk_value = Math.max(0, parseInt(body.perk_value) || 0);
  if (perk_type === 'pct' && perk_value > 100) perk_value = 100;
  if (perk_type === 'free') perk_value = 0;
  if (perk_type === 'none') perk_value = 0;
  const partner_type = pickPartnerType(body.partner_type);
  const active = body.active === undefined ? 1 : (parseInt(body.active) ? 1 : 0);
  const auto_invoice = body.auto_invoice === undefined ? 0 : (parseInt(body.auto_invoice) ? 1 : 0);
  const fields = {
    code,
    name,
    avatar: str(body.avatar, 600),
    phone: str(body.phone, 40),
    email: str(body.email, 160),
    tax_code: str(body.tax_code, 40),
    company: str(body.company, 300),
    address: str(body.address, 600),
    address_detail: str(body.address_detail, 300),
    address_ward: str(body.address_ward, 120),
    address_province: str(body.address_province, 120),
    ward_code: str(body.ward_code, 20),
    province_code: str(body.province_code, 20),
    birthday: birthday(body.birthday),
    preferences: str(body.preferences, 800),
    allergies: str(body.allergies, 800),
    perk_type,
    perk_value,
    note: str(body.note, 600),
    partner_type,
    contact_person: str(body.contact_person, 200),
    active,
    auto_invoice,
  };
  if (existing) {
    db.prepare(`UPDATE customers SET code=?,name=?,avatar=?,phone=?,email=?,tax_code=?,company=?,address=?,address_detail=?,address_ward=?,address_province=?,ward_code=?,province_code=?,birthday=?,preferences=?,allergies=?,perk_type=?,perk_value=?,note=?,partner_type=?,contact_person=?,active=?,auto_invoice=?,updated_at=? WHERE id=? AND branch_id=?`)
      .run(fields.code, fields.name, fields.avatar, fields.phone, fields.email, fields.tax_code, fields.company, fields.address, fields.address_detail, fields.address_ward, fields.address_province, fields.ward_code, fields.province_code, fields.birthday, fields.preferences, fields.allergies, fields.perk_type, fields.perk_value, fields.note, fields.partner_type, fields.contact_person, fields.active, fields.auto_invoice, now(), existing.id, branch_id);
    audit('customer.update', { id: existing.id, name: fields.name, partner_type: fields.partner_type }, branch_id);
    emit('customers:updated', { id: existing.id }, branch_id);
    const out = getCustomer(existing.id, branch_id);
    archiveCustomer(out);
    return out;
  }
  const id = uid('cus_');
  db.prepare(`INSERT INTO customers (id,branch_id,code,name,avatar,phone,email,tax_code,company,address,address_detail,address_ward,address_province,ward_code,province_code,birthday,preferences,allergies,perk_type,perk_value,note,partner_type,contact_person,active,auto_invoice,loyalty_points,total_orders,total_spent,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,0,0,?,?)`)
    .run(id, branch_id, fields.code, fields.name, fields.avatar, fields.phone, fields.email, fields.tax_code, fields.company, fields.address, fields.address_detail, fields.address_ward, fields.address_province, fields.ward_code, fields.province_code, fields.birthday, fields.preferences, fields.allergies, fields.perk_type, fields.perk_value, fields.note, fields.partner_type, fields.contact_person, fields.active, fields.auto_invoice, now(), now());
  audit('customer.create', { id, name: fields.name, partner_type: fields.partner_type }, branch_id);
  emit('customers:updated', { id, created: true }, branch_id);
  const out = getCustomer(id, branch_id);
  archiveCustomer(out);
  return out;
}

export function deleteCustomer(id, branch_id = 'br1') {
  const c = getCustomer(id, branch_id);
  if (!c) throw new Error('Khách hàng không tồn tại');
  archiveCustomer({ ...c, deleted: true, deleted_at: now() });
  db.prepare(`DELETE FROM customers WHERE id=? AND branch_id=?`).run(id, branch_id);
  audit('customer.delete', { id, name: c.name }, branch_id);
  emit('customers:updated', { id, deleted: true }, branch_id);
  return { ok: true };
}

// Bump lifetime stats and loyalty points after a paid order (best-effort).
export function recordPurchase(customerRef, amount = 0, branch_id = 'br1', order_id = null) {
  try {
    if (!customerRef) return;
    let customer = typeof customerRef === 'string'
      ? getCustomer(customerRef, branch_id)
      : (customerRef.id ? getCustomer(customerRef.id, branch_id) : null);
    if (!customer && typeof customerRef === 'object' && customerRef.phone) {
      customer = findByPhone(customerRef.phone, branch_id);
    }
    if (!customer?.id) return;
    const cfg = getLoyaltyConfig(branch_id);
    const earned = loyaltyEarn(customer, amount, cfg);
    const nextPoints = (parseInt(customer.loyalty_points) || 0) + earned.points;
    db.prepare(`UPDATE customers SET total_orders=total_orders+1,total_spent=total_spent+?,loyalty_points=?,loyalty_tier=?,last_visit_at=?,updated_at=? WHERE id=? AND branch_id=?`)
      .run(Math.max(0, parseInt(amount) || 0), nextPoints, earned.tier || customer.loyalty_tier || '', now(), now(), customer.id, branch_id);
    rebuildCustomerInsights(customer.id, branch_id);
    if (earned.points > 0) audit('customer.loyalty_earn', { id: customer.id, points: earned.points, order_id }, branch_id);
    const out = getCustomer(customer.id, branch_id);
    archiveCustomer({ ...out, last_order_id: order_id || undefined });
  } catch { /* ignore */ }
}

export function rebuildCustomerInsights(id, branch_id = 'br1') {
  if (!id) return [];
  const rows = db.prepare(`
    SELECT oi.menu_item_id, oi.sku_id, oi.name, SUM(oi.qty) qty, SUM(oi.qty * oi.unit_price) spent
    FROM order_items oi
    JOIN orders o ON o.id=oi.order_id
    WHERE o.branch_id=? AND o.status='paid' AND o.customer_json LIKE ? AND oi.status!='cancelled'
    GROUP BY COALESCE(oi.menu_item_id, oi.sku_id), oi.name
    ORDER BY qty DESC, spent DESC, oi.name ASC
    LIMIT 12`).all(branch_id, `%${id}%`);
  const favoriteItems = rows.map(r => ({
    type: r.menu_item_id ? 'menu' : 'sku',
    id: r.menu_item_id || r.sku_id || '',
    name: r.name,
    qty: Number(r.qty) || 0,
    spent: Number(r.spent) || 0,
  }));
  db.prepare(`UPDATE customers SET favorite_items_json=?, last_profiled_at=?, updated_at=? WHERE id=? AND branch_id=?`)
    .run(JSON.stringify(favoriteItems), now(), now(), id, branch_id);
  return favoriteItems;
}

// Tên placeholder cho khách tự lưu từ SĐT (self-order check-in) — khách chưa
// có hồ sơ chính thức. 'Khách hàng chưa đặt tên' là placeholder bản cũ.
export const UNREGISTERED_NAME = 'Khách hàng chưa đăng ký thành viên';
const PLACEHOLDER_NAMES = new Set([UNREGISTERED_NAME, 'Khách hàng chưa đặt tên']);

// Tự lưu/bổ sung hồ sơ khách từ thông tin HÓA ĐƠN sau bữa ăn — hoàn toàn ÂM
// THẦM (không toast, không label phía UI): khách đã chịu khai tên/SĐT/email
// khi xuất HĐ thì thông tin đó tự chảy vào mục Khách hàng.
//  • Chỉ chạy khi có SĐT (khóa nhận diện); không có SĐT thì thôi.
//  • Khách đã có hồ sơ: chỉ BỔ SUNG chỗ trống (tên placeholder → tên thật,
//    email/MST/địa chỉ đang trống) — không bao giờ đè dữ liệu đã có.
//  • Không được ném lỗi: lưu khách thất bại không được chặn phát hành HĐ.
export function silentSaveFromInvoice(buyer = {}, branch_id = 'br1') {
  try {
    const phone = String(buyer.phone || '').replace(/\D/g, '');
    if (phone.length < 8 || phone.length > 12) return null;
    const name = String(buyer.name || '').trim().slice(0, 200);
    const existing = findByPhone(phone, branch_id);
    if (!existing) {
      const customer = upsertCustomer({
        name: name || UNREGISTERED_NAME,
        phone,
        email: String(buyer.email || '').trim(),
        tax_code: String(buyer.tax_code || '').trim(),
        address: String(buyer.address || '').trim(),
      }, branch_id);
      audit('customer.auto_from_invoice', { id: customer.id, phone }, branch_id, 'system');
      return customer;
    }
    const patch = {};
    if (name && PLACEHOLDER_NAMES.has(String(existing.name || '').trim())) patch.name = name;
    if (!String(existing.email || '').trim() && String(buyer.email || '').trim()) patch.email = String(buyer.email).trim();
    if (!String(existing.tax_code || '').trim() && String(buyer.tax_code || '').trim()) patch.tax_code = String(buyer.tax_code).trim();
    if (!String(existing.address || '').trim() && String(buyer.address || '').trim()) patch.address = String(buyer.address).trim();
    if (!Object.keys(patch).length) return existing;
    const sets = Object.keys(patch).map(k => `${k}=?`).join(', ');
    db.prepare(`UPDATE customers SET ${sets}, updated_at=? WHERE id=? AND branch_id=?`)
      .run(...Object.values(patch), now(), existing.id, branch_id);
    audit('customer.auto_from_invoice', { id: existing.id, phone, filled: Object.keys(patch) }, branch_id, 'system');
    return { ...existing, ...patch };
  } catch {
    return null; // lưu hồ sơ khách là việc phụ — không bao giờ phá flow hóa đơn
  }
}

// iPad self-order: khách nhập SĐT ở đầu bữa. SĐT lạ → TỰ TẠO khách mới (tên
// placeholder — nhân viên đổi sau trong Liên hệ). Trả về hồ sơ + danh sách
// MÓN HAY GỌI (chỉ hiện từ lần ăn thứ 3 — tức đã có ≥2 bill paid).
export function selfOrderCheckin(phone, branch_id = 'br1') {
  const clean = String(phone || '').replace(/\D/g, '');
  if (clean.length < 8 || clean.length > 12) throw new Error('Số điện thoại không hợp lệ');
  let customer = findByPhone(clean, branch_id);
  let isNew = false;
  if (!customer) {
    // Khách mới chỉ có SĐT: vẫn lưu hồ sơ đầy đủ (tích điểm được ngay), tên
    // tạm là placeholder — nhân viên bổ sung tên sau ở Liên hệ, hoặc tự lấy
    // từ hóa đơn VAT nếu khách xuất HĐ sau bữa ăn (silentSaveFromInvoice).
    customer = upsertCustomer({ name: UNREGISTERED_NAME, phone: clean }, branch_id);
    isNew = true;
    audit('customer.self_checkin_new', { id: customer.id, phone: clean }, branch_id, 'ipad');
  }
  const visits = parseInt(customer.total_orders) || 0;
  let favorites = [];
  if (visits >= 2) {
    let fav = [];
    try { fav = JSON.parse(customer.favorite_items_json || '[]'); } catch { /* rebuild dưới */ }
    if (!Array.isArray(fav) || !fav.length) fav = rebuildCustomerInsights(customer.id, branch_id);
    const menuIds = fav.filter(f => f.type === 'menu' && f.id).map(f => f.id).slice(0, 8);
    if (menuIds.length) {
      const marks = menuIds.map(() => '?').join(',');
      const rows = db.prepare(`SELECT id,name,price,image,emoji FROM menu_items
        WHERE id IN (${marks}) AND available=1 AND hidden=0 AND deleted_at IS NULL`).all(...menuIds);
      const byId = new Map(rows.map(r => [r.id, r]));
      favorites = fav
        .filter(f => byId.has(f.id))
        .map(f => ({ ...byId.get(f.id), times: f.qty }));
    }
  }
  return {
    ok: true,
    is_new: isNew,
    customer: {
      id: customer.id,
      name: customer.name || '',
      phone: customer.phone || clean,
      loyalty_points: parseInt(customer.loyalty_points) || 0,
      loyalty_tier: customer.loyalty_tier || '',
      visits,
    },
    favorites,
  };
}

// Compute the discount a customer's default perk grants on a given base amount.
export function perkDiscount(customer, base = 0) {
  if (!customer) return 0;
  const b = Math.max(0, Math.round(base) || 0);
  if (customer.perk_type === 'free') return b;
  if (customer.perk_type === 'pct') return Math.min(b, Math.floor(b * (Math.max(0, customer.perk_value) || 0) / 100));
  if (customer.perk_type === 'amount') return Math.min(b, Math.max(0, customer.perk_value) || 0);
  return 0;
}

// Look up company name/address from a Vietnamese tax code via the free VietQR
// business directory (used to prefill invoice info the first time an MST is typed).
export async function lookupTaxCode(taxCode) {
  const tc = String(taxCode || '').replace(/\s+/g, '');
  if (!/^\d{10}(\d{3})?$/.test(tc)) throw new Error('Mã số thuế phải gồm 10 hoặc 13 chữ số');
  const local = db.prepare(`SELECT * FROM customers WHERE tax_code=?`).get(tc);
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(`https://api.vietqr.io/v2/business/${tc}`, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    clearTimeout(t);
    if (res.ok) {
      const json = await res.json();
      const d = json?.data;
      if (d && (d.name || d.shortName)) {
        return { ok: true, source: 'vietqr', tax_code: tc, company: d.name || d.shortName || '', name: d.shortName || d.name || '', address: d.address || '', existed: local ? { id: local.id, name: local.name } : null };
      }
    }
  } catch { /* fall through to local / not-found */ }
  if (local) return { ok: true, source: 'local', tax_code: tc, company: local.company || local.name, name: local.name, address: local.address || '', existed: { id: local.id, name: local.name } };
  return { ok: false, tax_code: tc, message: 'Không tra cứu được thông tin theo MST này. Vui lòng nhập tay (có thể do mạng hoặc MST chưa có trên cơ sở dữ liệu công khai).' };
}
