// Customer directory — remembers buyers (incl. full invoice info) so special
// customers can carry a default perk (free / % / amount off) into retail & POS.
import { db, uid, now, audit } from '../db.js';
import { emit } from '../realtime.js';

const PERKS = ['none', 'pct', 'amount', 'free'];

function normalizeRow(r) {
  if (!r) return null;
  return {
    ...r,
    perk_value: parseInt(r.perk_value) || 0,
    total_orders: parseInt(r.total_orders) || 0,
    total_spent: parseInt(r.total_spent) || 0,
  };
}

export function listCustomers(branch_id = 'br1', q = '') {
  const rows = db.prepare(`SELECT * FROM customers WHERE branch_id=? ORDER BY updated_at DESC, created_at DESC`).all(branch_id);
  const term = String(q || '').trim().toLowerCase();
  const out = rows.map(normalizeRow);
  if (!term) return out.slice(0, 200);
  return out.filter(c =>
    [c.name, c.phone, c.tax_code, c.company, c.email].some(v => String(v || '').toLowerCase().includes(term))
  ).slice(0, 200);
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

function pickPerk(v) { return PERKS.includes(v) ? v : 'none'; }
function str(v, max = 300) { return String(v ?? '').trim().slice(0, max); }

export function upsertCustomer(body = {}, branch_id = 'br1') {
  const name = str(body.name, 200);
  if (!name) throw new Error('Thiếu tên khách hàng');
  const perk_type = pickPerk(body.perk_type);
  let perk_value = Math.max(0, parseInt(body.perk_value) || 0);
  if (perk_type === 'pct' && perk_value > 100) perk_value = 100;
  if (perk_type === 'free') perk_value = 0;
  if (perk_type === 'none') perk_value = 0;
  const fields = {
    name,
    phone: str(body.phone, 40),
    email: str(body.email, 160),
    tax_code: str(body.tax_code, 40),
    company: str(body.company, 300),
    address: str(body.address, 600),
    perk_type,
    perk_value,
    note: str(body.note, 600),
  };
  const existing = body.id ? db.prepare(`SELECT * FROM customers WHERE id=? AND branch_id=?`).get(body.id, branch_id) : null;
  if (existing) {
    db.prepare(`UPDATE customers SET name=?,phone=?,email=?,tax_code=?,company=?,address=?,perk_type=?,perk_value=?,note=?,updated_at=? WHERE id=? AND branch_id=?`)
      .run(fields.name, fields.phone, fields.email, fields.tax_code, fields.company, fields.address, fields.perk_type, fields.perk_value, fields.note, now(), existing.id, branch_id);
    audit('customer.update', { id: existing.id, name: fields.name }, branch_id);
    emit('customers:updated', { id: existing.id }, branch_id);
    return getCustomer(existing.id, branch_id);
  }
  const id = uid('cus_');
  db.prepare(`INSERT INTO customers (id,branch_id,name,phone,email,tax_code,company,address,perk_type,perk_value,note,total_orders,total_spent,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,0,0,?,?)`)
    .run(id, branch_id, fields.name, fields.phone, fields.email, fields.tax_code, fields.company, fields.address, fields.perk_type, fields.perk_value, fields.note, now(), now());
  audit('customer.create', { id, name: fields.name }, branch_id);
  emit('customers:updated', { id, created: true }, branch_id);
  return getCustomer(id, branch_id);
}

export function deleteCustomer(id, branch_id = 'br1') {
  const c = getCustomer(id, branch_id);
  if (!c) throw new Error('Khách hàng không tồn tại');
  db.prepare(`DELETE FROM customers WHERE id=? AND branch_id=?`).run(id, branch_id);
  audit('customer.delete', { id, name: c.name }, branch_id);
  emit('customers:updated', { id, deleted: true }, branch_id);
  return { ok: true };
}

// Bump lifetime stats after a paid order (best-effort, never throws into checkout).
export function recordPurchase(id, amount = 0, branch_id = 'br1') {
  try {
    if (!id) return;
    db.prepare(`UPDATE customers SET total_orders=total_orders+1, total_spent=total_spent+?, updated_at=? WHERE id=? AND branch_id=?`)
      .run(Math.max(0, parseInt(amount) || 0), now(), id, branch_id);
  } catch { /* ignore */ }
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
