import { db, audit } from '../db.js';

export function safeJson(raw, fallback) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  if (typeof raw !== 'string') return raw;
  try { return JSON.parse(raw); } catch { return fallback; }
}

export function listMenu({ forCustomer = false, includeDeleted = false } = {}) {
  const categories = db.prepare(`SELECT * FROM categories ORDER BY sort`).all();
  const rows = db.prepare(`SELECT * FROM menu_items ORDER BY sort`).all()
    .filter(r => includeDeleted || !r.deleted_at)
    .filter(r => !forCustomer || !r.hidden);
  return { categories, items: rows.map(r => normalizeMenuItem(r, { forCustomer, includeRecipe: !forCustomer })) };
}

export function getMenuItem(id, opts = {}) {
  const row = db.prepare(`SELECT * FROM menu_items WHERE id=?`).get(id);
  return row ? normalizeMenuItem(row, opts) : null;
}

export function getMenuItemForOrder(id) {
  const item = getMenuItem(id, { forCustomer: true });
  if (!item || item.deleted_at || item.hidden) throw new Error('Item not found or hidden: ' + id);
  if (!item.available_flag) throw new Error('Item temporarily out of stock: ' + item.name);
  if (!item.schedule_available) throw new Error('Item not available during this time slot: ' + item.name);
  return item;
}

export function normalizeMenuItem(row, { forCustomer = false, includeRecipe = false } = {}) {
  const schedule = safeJson(row.schedule_json, { mode: 'always' }) || { mode: 'always' };
  const scheduleAvailable = isScheduleAvailable(schedule);
  const visible = !row.deleted_at && !row.hidden;
  const canOrder = !!row.available && visible && scheduleAvailable;
  const recipe = includeRecipe || forCustomer ? getRecipe(row.id) : null;
  const ingredients = safeJson(row.ingredients_json, []);
  const out = {
    ...row,
    available_flag: !!row.available,
    hidden: !!row.hidden,
    available: forCustomer ? canOrder : !!row.available,
    can_order: canOrder,
    schedule_available: scheduleAvailable,
    availability_reason: !visible ? 'hidden' : !row.available ? 'manual' : !scheduleAvailable ? 'schedule' : null,
    modifiers: safeJson(row.modifiers_json, []),
    addons: enrichAddons(row.addons_json),
    ingredients: ingredients.length ? ingredients : (recipe || []).map(r => r.name),
    allergens: safeJson(row.allergens_json, []),
    schedule,
  };
  if (includeRecipe) out.recipe = recipe || getRecipe(row.id);
  return out;
}

export function isScheduleAvailable(schedule, at = new Date()) {
  const s = schedule || { mode: 'always' };
  if (!s.mode || s.mode === 'always') return true;

  if (s.mode === 'date') {
    if (!s.date) return false;
    if (s.date !== localDate(at)) return false;
  }

  const days = Array.isArray(s.days) ? s.days.map(Number) : [];
  if ((s.mode === 'weekly' || s.mode === 'time') && days.length && !days.includes(at.getDay())) {
    return false;
  }

  if (s.all_day) return true;
  return isNowInTimeRange(at, s.start, s.end);
}

function isNowInTimeRange(at, start = '00:00', end = '23:59') {
  const nowM = at.getHours() * 60 + at.getMinutes();
  const startM = toMinutes(start, 0);
  const endM = toMinutes(end, 23 * 60 + 59);
  if (startM <= endM) return nowM >= startM && nowM <= endM;
  return nowM >= startM || nowM <= endM;
}

function toMinutes(v, fallback) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v || ''));
  if (!m) return fallback;
  return Math.max(0, Math.min(23, +m[1])) * 60 + Math.max(0, Math.min(59, +m[2]));
}

function localDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---- Add-ons (combos & extras) ----
// An add-on can reference a real menu item (ref_item_id) so its availability and
// price stay in sync with the system, or be a standalone extra/topping.
export function normalizeAddons(addons) {
  if (!Array.isArray(addons)) return [];
  return addons.map((a, i) => ({
    key: a.key || ('ad_' + i + '_' + Math.random().toString(36).slice(2, 6)),
    name: String(a.name || '').trim(),
    kind: a.kind === 'combo' ? 'combo' : 'extra',     // combo = side dish; extra = topping/extra
    type: a.type === 'free' ? 'free' : 'paid',         // free = complimentary; paid = add-on/surcharge
    price: Math.max(0, parseInt(a.price) || 0),
    ref_item_id: a.ref_item_id || null,                // link to another menu item
    available: a.available !== false,                  // for standalone extras
  })).filter(a => a.name || a.ref_item_id);
}

function refAvailability(ref_item_id) {
  const r = db.prepare(`SELECT name,emoji,image,price,available,hidden,deleted_at,schedule_json FROM menu_items WHERE id=?`).get(ref_item_id);
  if (!r) return { exists: false, available: false };
  const sched = safeJson(r.schedule_json, { mode: 'always' });
  // Add-on availability ignores `hidden`: an item can be hidden from the main menu
  // yet still sellable as an add-on. Only the green toggle (available), schedule,
  // and deletion gate it. Turn off the toggle to make the add-on show "Temporarily unavailable".
  const available = !!r.available && !r.deleted_at && isScheduleAvailable(sched);
  return { exists: true, available, name: r.name, emoji: r.emoji, image: r.image, price: r.price };
}

// Returns add-ons with live availability + effective price resolved.
export function enrichAddons(addonsRaw) {
  const list = safeJson(addonsRaw, []) || [];
  return (Array.isArray(list) ? list : []).map(a => {
    const out = {
      key: a.key, name: a.name, kind: a.kind || 'extra',
      type: a.type === 'free' ? 'free' : 'paid',
      price: Number(a.price) || 0, ref_item_id: a.ref_item_id || null,
      emoji: a.emoji || null, available: a.available !== false,
    };
    if (a.ref_item_id) {
      const ref = refAvailability(a.ref_item_id);
      out.available = ref.exists ? ref.available : false;
      out.ref_exists = ref.exists;
      if (ref.exists) {
        if (!out.name) out.name = ref.name;
        if (!out.emoji) out.emoji = ref.emoji;
        if (out.type !== 'free' && !out.price) out.price = ref.price;
      }
    }
    if (out.type === 'free') out.price = 0;
    return out;
  });
}

export function parseList(v) {
  if (Array.isArray(v)) return v.map(x => String(x).trim()).filter(Boolean);
  return String(v || '').split(',').map(x => x.trim()).filter(Boolean);
}

export function normalizeSchedule(v) {
  const s = safeJson(v, { mode: 'always' }) || { mode: 'always' };
  if (!['always', 'daily', 'weekly', 'time', 'date'].includes(s.mode)) return { mode: 'always' };
  if (s.mode === 'always') return { mode: 'always' };
  return {
    mode: s.mode === 'time' ? 'weekly' : s.mode,
    days: Array.isArray(s.days) ? s.days.map(Number).filter(d => d >= 0 && d <= 6) : [],
    date: s.date || null,
    all_day: !!s.all_day,
    start: s.start || '00:00',
    end: s.end || '23:59',
  };
}

export function getRecipe(menu_item_id) {
  return db.prepare(`
    SELECT r.inventory_item_id, r.qty, i.name, i.unit
    FROM recipes r
    JOIN inventory_items i ON i.id=r.inventory_item_id
    WHERE r.menu_item_id=?
    ORDER BY i.name`).all(menu_item_id);
}

export function replaceRecipe(menu_item_id, recipe = [], branch_id = 'br1') {
  db.prepare(`DELETE FROM recipes WHERE menu_item_id=?`).run(menu_item_id);
  const ins = db.prepare(`INSERT INTO recipes (menu_item_id,inventory_item_id,qty) VALUES (?,?,?)`);
  const seen = new Set();
  for (const line of Array.isArray(recipe) ? recipe : []) {
    const inventory_item_id = line.inventory_item_id || line.item_id;
    const qty = parseFloat(line.qty);
    if (!inventory_item_id || !qty || qty <= 0 || seen.has(inventory_item_id)) continue;
    const item = db.prepare(`SELECT id FROM inventory_items WHERE id=? AND branch_id=? AND active=1`).get(inventory_item_id, branch_id);
    if (!item) continue;
    ins.run(menu_item_id, inventory_item_id, qty);
    seen.add(inventory_item_id);
  }
}

// ---- Categories CRUD ----
export function listCategories() {
  return db.prepare(`SELECT * FROM categories ORDER BY sort,name`).all();
}
export function createCategory(body, branch_id = 'br1') {
  const name = String(body.name || '').trim();
  if (!name) throw new Error('Category name is required');
  const id = 'c_' + Math.random().toString(36).slice(2, 8);
  const sort = (db.prepare(`SELECT COALESCE(MAX(sort),0)+1 n FROM categories`).get().n) || 1;
  db.prepare(`INSERT INTO categories (id,name,icon,sort) VALUES (?,?,?,?)`).run(id, name, body.icon || '🍽️', sort);
  audit('category.create', { id, name }, branch_id);
  return db.prepare(`SELECT * FROM categories WHERE id=?`).get(id);
}
export function updateCategory(id, body, branch_id = 'br1') {
  const cur = db.prepare(`SELECT * FROM categories WHERE id=?`).get(id);
  if (!cur) throw new Error('Category not found');
  db.prepare(`UPDATE categories SET name=?, icon=? WHERE id=?`).run(
    String(body.name || '').trim() || cur.name, body.icon || cur.icon, id);
  audit('category.update', { id }, branch_id);
  return db.prepare(`SELECT * FROM categories WHERE id=?`).get(id);
}
export function deleteCategory(id, branch_id = 'br1') {
  const cur = db.prepare(`SELECT * FROM categories WHERE id=?`).get(id);
  if (!cur) throw new Error('Category not found');
  const used = db.prepare(`SELECT COUNT(*) n FROM menu_items WHERE category_id=? AND deleted_at IS NULL`).get(id).n;
  if (used) throw new Error(`Cannot delete: category contains ${used} item(s). Move or delete the items first.`);
  db.prepare(`DELETE FROM categories WHERE id=?`).run(id);
  audit('category.delete', { id, name: cur.name }, branch_id);
  return { ok: true };
}

export function hideMenuItem(id, hidden = true, branch_id = 'br1') {
  const row = db.prepare(`SELECT * FROM menu_items WHERE id=?`).get(id);
  if (!row) throw new Error('Item not found');
  db.prepare(`UPDATE menu_items SET hidden=? WHERE id=?`).run(hidden ? 1 : 0, id);
  audit(hidden ? 'menu.hide' : 'menu.unhide', { id, name: row.name }, branch_id);
  return getMenuItem(id);
}

export function deleteMenuItem(id, branch_id = 'br1') {
  const row = db.prepare(`SELECT * FROM menu_items WHERE id=?`).get(id);
  if (!row) throw new Error('Item not found');
  const used = db.prepare(`SELECT COUNT(*) n FROM order_items WHERE menu_item_id=?`).get(id).n;
  if (used) {
    db.prepare(`UPDATE menu_items SET deleted_at=datetime('now'), hidden=1, available=0 WHERE id=?`).run(id);
    audit('menu.archive', { id, name: row.name, reason: 'has_orders' }, branch_id);
    return { ok: true, archived: true };
  }
  db.prepare(`DELETE FROM recipes WHERE menu_item_id=?`).run(id);
  db.prepare(`DELETE FROM menu_items WHERE id=?`).run(id);
  audit('menu.delete', { id, name: row.name }, branch_id);
  return { ok: true, deleted: true };
}
