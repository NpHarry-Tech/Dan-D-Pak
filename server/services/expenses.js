// Expenses (Chi phí): general business expense ledger, kept reconciled with the
// cash drawer. A 'drawer' expense posts ONE cash_drawer entry on the open shift
// (reusing cashDrawer.js) so the drawer balance stays correct and nothing is
// double-counted; a 'direct' expense (kế toán chi trực tiếp / chuyển khoản) is
// recorded in the ledger only and never touches the drawer.
import { db, uid, now, audit } from '../db.js';
import { emit } from '../realtime.js';
import { getCustomer } from './customers.js';
import { createEntry as createDrawerEntry } from './cashDrawer.js';

const SOURCES = ['drawer', 'direct'];
const DEFAULT_CATEGORIES = ['Thuê mặt bằng', 'Điện nước', 'Lương nhân viên', 'Marketing', 'Nguyên vật liệu', 'Vận chuyển', 'Sửa chữa & bảo trì', 'Khác'];

function intval(v) { return Math.round(Number(v) || 0); }
function str(v, max = 400) { return String(v ?? '').trim().slice(0, max); }
function parseDate(v) {
  if (!v) return now();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? now() : d.toISOString();
}

// ---------- categories ----------
export function listCategories(branch_id = 'br1') {
  let rows = db.prepare(`SELECT * FROM expense_categories WHERE branch_id=? AND active=1 ORDER BY sort, name`).all(branch_id);
  if (!rows.length) {
    const ins = db.prepare(`INSERT INTO expense_categories (id,branch_id,name,sort,active,created_at) VALUES (?,?,?,?,1,?)`);
    DEFAULT_CATEGORIES.forEach((name, i) => ins.run(uid('ecat_'), branch_id, name, i * 10, now()));
    rows = db.prepare(`SELECT * FROM expense_categories WHERE branch_id=? AND active=1 ORDER BY sort, name`).all(branch_id);
  }
  return rows;
}

export function upsertCategory(body = {}, branch_id = 'br1') {
  const name = str(body.name, 120);
  if (!name) throw new Error('Thiếu tên danh mục');
  if (body.id) {
    db.prepare(`UPDATE expense_categories SET name=?, sort=? WHERE id=? AND branch_id=?`)
      .run(name, intval(body.sort), body.id, branch_id);
    return db.prepare(`SELECT * FROM expense_categories WHERE id=?`).get(body.id);
  }
  const id = uid('ecat_');
  db.prepare(`INSERT INTO expense_categories (id,branch_id,name,sort,active,created_at) VALUES (?,?,?,?,1,?)`)
    .run(id, branch_id, name, intval(body.sort), now());
  emit('expenses:updated', { category: id }, branch_id);
  return db.prepare(`SELECT * FROM expense_categories WHERE id=?`).get(id);
}

export function deleteCategory(id, branch_id = 'br1') {
  db.prepare(`UPDATE expense_categories SET active=0 WHERE id=? AND branch_id=?`).run(id, branch_id);
  emit('expenses:updated', { category: id, deleted: true }, branch_id);
  return { ok: true };
}

// ---------- expenses ----------
function nextCode(branch_id) {
  const ymd = new Date().toISOString().slice(2, 10).replaceAll('-', '');
  const prefix = `CP-${ymd}-`;
  const last = db.prepare(`SELECT code FROM expenses WHERE branch_id=? AND code LIKE ? ORDER BY code DESC LIMIT 1`).get(branch_id, prefix + '%');
  const seq = last ? (parseInt(String(last.code).slice(prefix.length)) || 0) + 1 : 1;
  return prefix + String(seq).padStart(3, '0');
}

function expenseOut(r) {
  return { ...r, amount: intval(r.amount), source: SOURCES.includes(r.source) ? r.source : 'direct' };
}

export function listExpenses(branch_id = 'br1', filters = {}) {
  const params = [branch_id];
  let where = 'branch_id=?';
  if (filters.category_id) { where += ' AND category_id=?'; params.push(String(filters.category_id)); }
  if (filters.source && SOURCES.includes(filters.source)) { where += ' AND source=?'; params.push(filters.source); }
  if (filters.from) { where += ' AND expense_date>=?'; params.push(new Date(String(filters.from) + 'T00:00:00').toISOString()); }
  if (filters.to) { where += ' AND expense_date<=?'; params.push(new Date(String(filters.to) + 'T23:59:59.999').toISOString()); }
  const rows = db.prepare(`SELECT * FROM expenses WHERE ${where} ORDER BY expense_date DESC, created_at DESC LIMIT 500`).all(...params);
  const term = String(filters.q || '').trim().toLowerCase();
  const out = rows.map(expenseOut).filter(e => !term || [e.code, e.payee_name, e.category_name, e.note].some(v => String(v || '').toLowerCase().includes(term)));
  return { expenses: out, summary: summarize(out) };
}

function summarize(rows) {
  const byCat = new Map();
  let total = 0, drawer = 0, direct = 0;
  for (const e of rows) {
    total += e.amount;
    if (e.source === 'drawer') drawer += e.amount; else direct += e.amount;
    const key = e.category_name || 'Khác';
    byCat.set(key, (byCat.get(key) || 0) + e.amount);
  }
  const categories = [...byCat.entries()].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount);
  return { total, drawer, direct, count: rows.length, categories };
}

function resolvePayee(payee_id, branch_id) {
  if (!payee_id) return { id: null, name: '' };
  const p = getCustomer(payee_id, branch_id);
  if (!p) return { id: null, name: '' };
  return { id: p.id, name: p.company || p.name };
}

export function createExpense(body = {}, branch_id = 'br1', user = {}) {
  const amount = intval(body.amount);
  if (amount <= 0) throw new Error('Số tiền chi phải lớn hơn 0');
  const source = SOURCES.includes(body.source) ? body.source : 'direct';
  const cat = body.category_id
    ? db.prepare(`SELECT * FROM expense_categories WHERE id=? AND branch_id=?`).get(body.category_id, branch_id)
    : null;
  const category_name = cat ? cat.name : str(body.category_name, 120);
  const payee = resolvePayee(str(body.payee_id, 80), branch_id);
  const expense_date = parseDate(body.expense_date);
  const note = str(body.note, 800);
  const invoice_image = str(body.invoice_image, 7_500_000);

  let drawer_entry_id = null;
  let method = str(body.method, 30);
  if (source === 'drawer') {
    // Reuse the cash drawer so the open shift's balance reflects this expense.
    const entry = createDrawerEntry('expense', {
      amount,
      occurred_at: expense_date,
      counterparty: payee.name || category_name || 'Chi phí',
      reason: note || category_name || 'Chi phí',
      product: category_name || 'Chi phí',
      invoice_image,
      actor_name: user?.name || user?.username,
    }, user, branch_id);
    drawer_entry_id = entry.id;
    method = 'cash';
  }

  const id = uid('exp_');
  const code = nextCode(branch_id);
  db.prepare(`INSERT INTO expenses (id,branch_id,code,category_id,category_name,payee_id,payee_name,source,method,amount,expense_date,note,invoice_image,drawer_entry_id,actor_name,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, branch_id, code, cat?.id || null, category_name, payee.id, payee.name, source, method, amount, expense_date, note, invoice_image, drawer_entry_id, str(user?.name || user?.username, 120), now(), now());
  audit('expense.create', { id, code, amount, source, category: category_name, drawer_entry_id }, branch_id, user?.username || user?.name);
  emit('expenses:updated', { id, created: true }, branch_id);
  if (drawer_entry_id) emit('shift:updated', { source: 'expense' }, branch_id);
  return expenseOut(db.prepare(`SELECT * FROM expenses WHERE id=?`).get(id));
}

export function updateExpense(id, body = {}, branch_id = 'br1', user = {}) {
  const e = db.prepare(`SELECT * FROM expenses WHERE id=? AND branch_id=?`).get(id, branch_id);
  if (!e) throw new Error('Khoản chi không tồn tại');
  if (e.drawer_entry_id) throw new Error('Khoản chi này đã trừ vào két — chỉnh sửa trong sổ quỹ/ca để không lệch tiền mặt');
  const cat = body.category_id ? db.prepare(`SELECT * FROM expense_categories WHERE id=? AND branch_id=?`).get(body.category_id, branch_id) : null;
  const payee = resolvePayee(str(body.payee_id, 80), branch_id);
  db.prepare(`UPDATE expenses SET category_id=?,category_name=?,payee_id=?,payee_name=?,method=?,amount=?,expense_date=?,note=?,invoice_image=?,updated_at=? WHERE id=? AND branch_id=?`)
    .run(cat?.id || null, cat ? cat.name : str(body.category_name, 120), payee.id, payee.name, str(body.method, 30), intval(body.amount), parseDate(body.expense_date), str(body.note, 800), str(body.invoice_image, 7_500_000), now(), id, branch_id);
  audit('expense.update', { id, amount: intval(body.amount) }, branch_id, user?.username || user?.name);
  emit('expenses:updated', { id }, branch_id);
  return expenseOut(db.prepare(`SELECT * FROM expenses WHERE id=?`).get(id));
}

export function deleteExpense(id, branch_id = 'br1', user = {}) {
  const e = db.prepare(`SELECT * FROM expenses WHERE id=? AND branch_id=?`).get(id, branch_id);
  if (!e) throw new Error('Khoản chi không tồn tại');
  if (e.drawer_entry_id) throw new Error('Khoản chi này đã trừ vào két — không xóa từ Chi phí để tránh lệch quỹ');
  db.prepare(`DELETE FROM expenses WHERE id=? AND branch_id=?`).run(id, branch_id);
  audit('expense.delete', { id, code: e.code }, branch_id, user?.username || user?.name);
  emit('expenses:updated', { id, deleted: true }, branch_id);
  return { ok: true };
}
