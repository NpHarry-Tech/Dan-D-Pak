import { db, audit } from '../db.js';

// ---------- Simple in-memory cache ----------
// Menu và print config là dữ liệu đọc nhiều nhưng thay đổi ít.
// Với 50 thiết bị cùng gọi mỗi vài giây, cache 10s giảm 90% DB queries.
const _cache = new Map(); // key -> { value, expiresAt }
const MENU_TTL     = 10_000; // 10 giây
const SETTINGS_TTL = 15_000; // 15 giây
export const MENU_TRANSLATION_LANGS = ['vi', 'en', 'zh', 'ja', 'ko'];

function cacheGet(key) {
  const e = _cache.get(key);
  if (e && e.expiresAt > Date.now()) return e.value;
  _cache.delete(key);
  return undefined;
}
function cacheSet(key, value, ttl) {
  _cache.set(key, { value, expiresAt: Date.now() + ttl });
  return value;
}
export function cacheBust(prefix) {
  for (const k of _cache.keys()) if (k.startsWith(prefix)) _cache.delete(k);
}

export function safeJson(raw, fallback) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  if (typeof raw !== 'string') return raw;
  try { return JSON.parse(raw); } catch { return fallback; }
}

export function listMenu(options = {}) {
  const {
    forCustomer = false,
    includeDeleted = false,
    page = null,
    limit = 40,
    q = '',
    category_id = '',
    lang = 'vi',
  } = options;
  const menuLang = normalizeMenuLang(lang);

  const parsedPage = page !== null ? parseInt(page) : null;
  const parsedLimit = parseInt(limit) || 40;

  if (parsedPage !== null && parsedPage > 0) {
    const categories = db.prepare(`SELECT * FROM categories ORDER BY sort`).all();

    let sql = `SELECT * FROM menu_items WHERE 1=1`;
    const params = [];

    if (!includeDeleted) {
      sql += ` AND deleted_at IS NULL`;
    }

    if (forCustomer) {
      sql += ` AND hidden = 0`;
    }

    if (category_id && String(category_id).trim() !== '') {
      sql += ` AND category_id = ?`;
      params.push(String(category_id).trim());
    }

    sql += ` ORDER BY sort`;

    const offset = (parsedPage - 1) * parsedLimit;
    const search = foldSearch(q);
    const allRows = db.prepare(sql).all(...params);
    const filteredRows = search
      ? allRows.filter(row => menuSearchText(row).includes(search))
      : allRows;
    const total = filteredRows.length;
    const rows = filteredRows.slice(offset, offset + parsedLimit);
    const items = rows.map(r => normalizeMenuItem(r, { forCustomer, includeRecipe: !forCustomer, lang: menuLang }));

    return {
      categories,
      items,
      total,
      page: parsedPage,
      limit: parsedLimit,
    };
  }

  const cacheKey = `menu:${forCustomer ? 'pub' : 'adm'}:${includeDeleted ? 'all' : 'live'}:${menuLang}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  const categories = db.prepare(`SELECT * FROM categories ORDER BY sort`).all();
  const rows = db.prepare(`SELECT * FROM menu_items ORDER BY sort`).all()
    .filter(r => includeDeleted || !r.deleted_at)
    .filter(r => !forCustomer || !r.hidden);
  return cacheSet(cacheKey, { categories, items: rows.map(r => normalizeMenuItem(r, { forCustomer, includeRecipe: !forCustomer, lang: menuLang })) }, MENU_TTL);
}

function foldSearch(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase()
    .trim();
}

function menuSearchText(row) {
  const translations = normalizeMenuTranslations(row.translations_json, row);
  return foldSearch([
    row.name,
    row.description,
    ...Object.values(translations).flatMap(t => [t.name, t.description]),
  ].filter(Boolean).join(' '));
}

export function getMenuItem(id, opts = {}) {
  const row = db.prepare(`SELECT * FROM menu_items WHERE id=?`).get(id);
  return row ? normalizeMenuItem(row, opts) : null;
}

export function getMenuItemForOrder(id) {
  const item = getMenuItem(id, { forCustomer: true });
  if (!item || item.deleted_at || item.hidden) throw new Error('Món không tồn tại hoặc đã ẩn: ' + id);
  if (!item.available_flag) throw new Error('Món tạm hết: ' + item.name);
  if (!item.schedule_available) throw new Error('Món chưa tới khung giờ bán: ' + item.name);
  return item;
}

export function normalizeMenuItem(row, { forCustomer = false, includeRecipe = false, lang = 'vi' } = {}) {
  const schedule = safeJson(row.schedule_json, { mode: 'always' }) || { mode: 'always' };
  const scheduleAvailable = isScheduleAvailable(schedule);
  const visible = !row.deleted_at && !row.hidden;
  const canOrder = !!row.available && visible && scheduleAvailable;
  const recipe = includeRecipe || forCustomer ? getRecipe(row.id) : null;
  const ingredients = safeJson(row.ingredients_json, []);
  const translations = normalizeMenuTranslations(row.translations_json, row);
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
    translations,
  };
  const menuLang = normalizeMenuLang(lang);
  if (forCustomer && menuLang !== 'vi') {
    const t = translations[menuLang] || {};
    if (t.name) out.name = t.name;
    if (t.description) out.description = t.description;
  }
  if (includeRecipe) out.recipe = recipe || getRecipe(row.id);
  return out;
}

export function normalizeMenuLang(lang) {
  const code = String(lang || 'vi').toLowerCase().trim();
  return MENU_TRANSLATION_LANGS.includes(code) ? code : 'vi';
}

export function normalizeMenuTranslations(raw, source = {}) {
  const obj = safeJson(raw, {}) || {};
  const out = {};
  for (const lang of MENU_TRANSLATION_LANGS) {
    const row = obj[lang] && typeof obj[lang] === 'object' ? obj[lang] : {};
    out[lang] = {
      name: String(row.name || '').trim(),
      description: String(row.description || '').trim(),
    };
  }
  if (!out.vi.name) out.vi.name = String(source.name || '').trim();
  if (!out.vi.description) out.vi.description = String(source.description || '').trim();
  return out;
}

export async function completeMenuTranslations({ name = '', description = '', translations = {} } = {}) {
  const base = {
    name: String(name || '').trim(),
    description: String(description || '').trim(),
  };
  const out = normalizeMenuTranslations(translations, base);
  out.vi = {
    name: out.vi.name || base.name,
    description: out.vi.description || base.description,
  };

  const jobs = [];
  for (const lang of MENU_TRANSLATION_LANGS) {
    if (lang === 'vi') continue;
    if (!out[lang].name && base.name) {
      jobs.push(translateText(base.name, lang).then(v => { out[lang].name = v; }));
    }
    if (!out[lang].description && base.description) {
      jobs.push(translateText(base.description, lang).then(v => { out[lang].description = v; }));
    }
  }
  await Promise.all(jobs);
  return out;
}

async function translateText(text, targetLang) {
  const value = String(text || '').trim();
  if (!value) return '';
  const url = new URL('https://translate.googleapis.com/translate_a/single');
  url.searchParams.set('client', 'gtx');
  url.searchParams.set('sl', 'vi');
  url.searchParams.set('tl', targetLang);
  url.searchParams.set('dt', 't');
  url.searchParams.set('q', value);
  let timer;
  try {
    const ctl = new AbortController();
    timer = setTimeout(() => ctl.abort(), 3500);
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) return value;
    const data = await res.json();
    const translated = Array.isArray(data?.[0])
      ? data[0].map(part => Array.isArray(part) ? part[0] : '').join('')
      : '';
    return String(translated || value).trim();
  } catch {
    return value;
  } finally {
    if (timer) clearTimeout(timer);
  }
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
    kind: a.kind === 'combo' ? 'combo' : 'extra',     // combo = món ăn kèm; extra = topping/extra
    type: a.type === 'free' ? 'free' : 'paid',         // free = tặng kèm; paid = mua thêm/bù tiền
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
  // and deletion gate it. Turn off the toggle to make the add-on show "Tạm hết".
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
  if (!name) throw new Error('Thiếu tên danh mục');
  const id = 'c_' + Math.random().toString(36).slice(2, 8);
  const sort = (db.prepare(`SELECT COALESCE(MAX(sort),0)+1 n FROM categories`).get().n) || 1;
  db.prepare(`INSERT INTO categories (id,name,icon,sort) VALUES (?,?,?,?)`).run(id, name, body.icon || '🍽️', sort);
  cacheBust('menu:');
  audit('category.create', { id, name }, branch_id);
  return db.prepare(`SELECT * FROM categories WHERE id=?`).get(id);
}
export function updateCategory(id, body, branch_id = 'br1') {
  const cur = db.prepare(`SELECT * FROM categories WHERE id=?`).get(id);
  if (!cur) throw new Error('Danh mục không tồn tại');
  db.prepare(`UPDATE categories SET name=?, icon=? WHERE id=?`).run(
    String(body.name || '').trim() || cur.name, body.icon || cur.icon, id);
  cacheBust('menu:');
  audit('category.update', { id }, branch_id);
  return db.prepare(`SELECT * FROM categories WHERE id=?`).get(id);
}
export function deleteCategory(id, branch_id = 'br1') {
  const cur = db.prepare(`SELECT * FROM categories WHERE id=?`).get(id);
  if (!cur) throw new Error('Danh mục không tồn tại');
  const used = db.prepare(`SELECT COUNT(*) n FROM menu_items WHERE category_id=? AND deleted_at IS NULL`).get(id).n;
  if (used) throw new Error(`Không thể xóa: còn ${used} món trong danh mục này. Hãy chuyển/xóa món trước.`);
  db.prepare(`DELETE FROM categories WHERE id=?`).run(id);
  cacheBust('menu:');
  audit('category.delete', { id, name: cur.name }, branch_id);
  return { ok: true };
}

export function hideMenuItem(id, hidden = true, branch_id = 'br1') {
  const row = db.prepare(`SELECT * FROM menu_items WHERE id=?`).get(id);
  if (!row) throw new Error('Món không tồn tại');
  db.prepare(`UPDATE menu_items SET hidden=? WHERE id=?`).run(hidden ? 1 : 0, id);
  cacheBust('menu:');
  audit(hidden ? 'menu.hide' : 'menu.unhide', { id, name: row.name }, branch_id);
  return getMenuItem(id);
}

export function deleteMenuItem(id, branch_id = 'br1') {
  const row = db.prepare(`SELECT * FROM menu_items WHERE id=?`).get(id);
  if (!row) throw new Error('Món không tồn tại');
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
