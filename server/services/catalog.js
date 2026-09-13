import { db, audit } from '../db.js';
import { salePrice } from './tax.js';
import { matchesSearch, searchTokens } from '../core/search.js';
import { businessParts } from '../core/businessClock.js';

// ---------- Simple in-memory cache ----------
// Menu và print config là dữ liệu đọc nhiều nhưng thay đổi ít.
// Với 50 thiết bị cùng gọi mỗi vài giây, cache 10s giảm 90% DB queries.
const _cache = new Map(); // key -> { value, expiresAt }
const MENU_TTL     = 10_000; // 10 giây
const SETTINGS_TTL = 15_000; // 15 giây
export const MENU_TRANSLATION_LANGS = ['vi', 'en', 'zh', 'ja', 'ko'];
// Group kỹ thuật cố định cho mod validate của "Món ăn kèm & Extra" (addons) —
// KHÔNG hiện cho khách, chỉ để resolveOrderMods khớp đúng dòng addon đã chọn.
export const ADDON_MOD_GROUP = '__addon__';

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
    // selfOrder = gọi từ Tablet Self-Order → ẩn thêm món đặt self_order_hidden
    // (menu khách có thể KHÁC F&B POS). Ngầm hiểu forCustomer.
    selfOrder = false,
    includeDeleted = false,
    page = null,
    limit = 40,
    q = '',
    category_id = '',
    lang = 'vi',
    branch_id = 'sala',
  } = options;
  const menuLang = normalizeMenuLang(lang);

  const parsedPage = page !== null ? parseInt(page) : null;
  const parsedLimit = parseInt(limit) || 40;

  if (parsedPage !== null && parsedPage > 0) {
    const allCategories = db.prepare(`SELECT * FROM categories WHERE branch_id=? ORDER BY sort`).all(branch_id);
    // NHÓM MÓN ẩn khỏi Self-Order (self_order_hidden) loại luôn cả nhóm lẫn
    // món bên trong khỏi menu khách — F&B POS không bị ảnh hưởng.
    const categories = selfOrder ? allCategories.filter(c => !c.self_order_hidden) : allCategories;
    const hiddenCategoryIds = selfOrder ? new Set(allCategories.filter(c => c.self_order_hidden).map(c => c.id)) : null;

    let sql = `SELECT * FROM menu_items WHERE branch_id=?`;
    const params = [branch_id];

    if (!includeDeleted) {
      sql += ` AND deleted_at IS NULL`;
    }

    // `hidden` chỉ thật sự LOẠI món khỏi kết quả cho Self-Order (khách hàng).
    // F&B POS vẫn nhận đủ món hidden — có cờ `hidden`/`available`/
    // `availability_reason` để tự làm mờ + khoá chọn — vì nhân viên cần thấy
    // món đang tắt để biết lý do, không phải mất tích khỏi màn order.
    if (selfOrder) {
      sql += ` AND hidden = 0`;
      sql += ` AND self_order_hidden = 0`;
    }

    if (category_id && String(category_id).trim() !== '') {
      sql += ` AND category_id = ?`;
      params.push(String(category_id).trim());
    }

    sql += ` ORDER BY sort`;

    const offset = (parsedPage - 1) * parsedLimit;
    const search = searchTokens(q);
    const allRows = db.prepare(sql).all(...params)
      .filter(r => !hiddenCategoryIds || !hiddenCategoryIds.has(r.category_id));
    const filteredRows = search
      ? allRows.filter(row => matchesSearch(menuSearchValues(row), search))
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

  const cacheKey = `menu:${branch_id}:${forCustomer ? 'pub' : 'adm'}:${selfOrder ? 'so' : 'all'}:${includeDeleted ? 'all' : 'live'}:${menuLang}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  const allCategories = db.prepare(`SELECT * FROM categories WHERE branch_id=? ORDER BY sort`).all(branch_id);
  const categories = selfOrder ? allCategories.filter(c => !c.self_order_hidden) : allCategories;
  const hiddenCategoryIds = selfOrder ? new Set(allCategories.filter(c => c.self_order_hidden).map(c => c.id)) : null;
  const rows = db.prepare(`SELECT * FROM menu_items WHERE branch_id=? ORDER BY sort`).all(branch_id)
    .filter(r => includeDeleted || !r.deleted_at)
    .filter(r => !selfOrder || !r.hidden)
    .filter(r => !selfOrder || !r.self_order_hidden)
    .filter(r => !hiddenCategoryIds || !hiddenCategoryIds.has(r.category_id));
  return cacheSet(cacheKey, { categories, items: rows.map(r => normalizeMenuItem(r, { forCustomer, includeRecipe: !forCustomer, lang: menuLang })) }, MENU_TTL);
}

function menuSearchValues(row) {
  const translations = normalizeMenuTranslations(row.translations_json, row);
  return [
    row.name,
    row.description,
    ...Object.values(translations).flatMap(t => [t.name, t.description]),
  ].filter(Boolean);
}

export function getMenuItem(id, opts = {}, branch_id = 'sala') {
  const row = db.prepare(`SELECT * FROM menu_items WHERE id=? AND branch_id=?`).get(id, branch_id);
  return row ? normalizeMenuItem(row, opts) : null;
}

export function getMenuItemForOrder(id, branch_id = 'sala') {
  const item = getMenuItem(id, { forCustomer: true }, branch_id);
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
  const priceIncludesVat = row.price_includes_vat !== 0;
  const vatRate = Number(row.vat_rate) || 0;
  // NHÓM TÙY CHỌN hợp nhất (size/đá + topping + combo) — nguồn chính cho Self-Order.
  const optionGroups = enrichOptionGroups(row.option_groups_json, row.branch_id, vatRate, priceIncludesVat);
  // Món ăn kèm & Extra — flat list riêng (không nhóm/không min-max), khách chọn
  // độc lập từng món trên Self-Order (xem ADDON_MOD_GROUP dưới đây).
  const addons = enrichAddons(row.addons_json, row.branch_id, vatRate, priceIncludesVat);
  // FLATTEN nhóm -> modifiers phẳng (group=tên nhóm, name=tên option) để
  // resolveOrderMods VALIDATE + tính giá tự động, KHÔNG phải sửa logic đặt món.
  // Gộp cả modifiers_json cũ để tương thích ngược.
  const flatFromGroups = optionGroups.flatMap(g =>
    g.options.map(o => ({ group: g.name, name: o.name, price: o.price, sale_price: o.sale_price })));
  // Addon đã chọn cũng validate qua CHUNG đường resolveOrderMods — group kỹ thuật cố
  // định (không dịch, không hiện cho khách) để client + server khớp đúng 1 dòng.
  const flatFromAddons = addons
    .filter(a => a.available && a.name)
    .map(a => ({ group: ADDON_MOD_GROUP, name: a.name, price: a.price, sale_price: a.sale_price }));
  const legacyMods = safeJson(row.modifiers_json, []).map(mod => ({
    ...mod, sale_price: salePrice(mod.price, vatRate, priceIncludesVat),
  }));
  const out = {
    ...row,
    price_includes_vat: priceIncludesVat,
    sale_price: salePrice(row.price, vatRate, priceIncludesVat),
    available_flag: !!row.available,
    available_dine_in: row.available_dine_in !== 0,
    available_takeaway: row.available_takeaway !== 0,
    hidden: !!row.hidden,
    self_order_hidden: !!row.self_order_hidden,
    available: forCustomer ? canOrder : !!row.available,
    can_order: canOrder,
    schedule_available: scheduleAvailable,
    availability_reason: !visible ? 'hidden' : !row.available ? 'manual' : !scheduleAvailable ? 'schedule' : null,
    modifiers: [...legacyMods, ...flatFromGroups, ...flatFromAddons],
    option_groups: optionGroups,
    addons,
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
  const storeAt = businessParts(at);
  if ((s.mode === 'weekly' || s.mode === 'time') && days.length && !days.includes(storeAt.weekday)) {
    return false;
  }

  if (s.all_day) return true;
  return isNowInTimeRange(at, s.start, s.end);
}

function isNowInTimeRange(at, start = '00:00', end = '23:59') {
  const p = businessParts(at);
  const nowM = p.hour * 60 + p.minute;
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
  const p = businessParts(d);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
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

function refAvailability(ref_item_id, branch_id = 'sala') {
  const r = db.prepare(`SELECT name,emoji,image,price,available,hidden,deleted_at,schedule_json FROM menu_items WHERE id=? AND branch_id=?`).get(ref_item_id, branch_id);
  if (!r) return { exists: false, available: false };
  const sched = safeJson(r.schedule_json, { mode: 'always' });
  // Add-on availability ignores `hidden`: an item can be hidden from the main menu
  // yet still sellable as an add-on. Only the green toggle (available), schedule,
  // and deletion gate it. Turn off the toggle to make the add-on show "Tạm hết".
  const available = !!r.available && !r.deleted_at && isScheduleAvailable(sched);
  return { exists: true, available, name: r.name, emoji: r.emoji, image: r.image, price: r.price };
}

// Returns add-ons with live availability + effective price resolved.
// Đọc: nhóm tùy chọn + resolve option combo (ref_item_id) lấy tên/giá/còn-hàng,
// kèm sale_price (đã gồm VAT của món) để đặt món tính đúng tiền.
function enrichOptionGroups(raw, branch_id, vatRate, priceIncludesVat) {
  const groups = safeJson(raw, []) || [];
  return (Array.isArray(groups) ? groups : []).map(g => ({
    key: String(g.key || ''),
    name: String(g.name || ''),
    position: g.position === 'bottom' ? 'bottom' : 'top',
    // 'price' (mặc định) = cộng giá vào dòng món hiện tại, như trước giờ.
    // 'combo' = mỗi lựa chọn tách thành 1 order_items RIÊNG (giá/trạm/hủy độc
    // lập) — xem resolveOrderMods() trong orders.js.
    mode: g.mode === 'combo' ? 'combo' : 'price',
    min: Math.max(0, Number(g.min) || 0),
    max: Math.max(0, Number(g.max) || 0), // 0 = không giới hạn
    options: (Array.isArray(g.options) ? g.options : []).map(o => {
      const out = {
        key: String(o.key || ''),
        name: String(o.name || ''),
        type: o.type === 'free' ? 'free' : 'paid',
        price: o.type === 'free' ? 0 : (Number(o.price) || 0),
        ref_item_id: o.ref_item_id || null,
        emoji: o.emoji || null,
        available: o.available !== false,
      };
      if (o.ref_item_id) {
        const ref = refAvailability(o.ref_item_id, branch_id);
        out.available = ref.exists ? ref.available : false;
        out.ref_exists = ref.exists;
        if (ref.exists) {
          if (!out.name) out.name = ref.name;
          if (!out.emoji) out.emoji = ref.emoji;
          if (out.type !== 'free' && !out.price) out.price = ref.price;
        }
      }
      out.sale_price = salePrice(out.price, vatRate, priceIncludesVat);
      return out;
    }),
  }));
}

// Nhóm mode:'combo' không được link tới 1 món mà bản thân món đó lại CÓ nhóm
// combo riêng — chỉ cho lồng 1 cấp, tránh combo-trong-combo đệ quy khi in/hủy.
function refHasComboGroup(ref_item_id) {
  if (!ref_item_id) return false;
  const r = db.prepare(`SELECT option_groups_json FROM menu_items WHERE id=?`).get(ref_item_id);
  if (!r) return false;
  const groups = safeJson(r.option_groups_json, []) || [];
  return (Array.isArray(groups) ? groups : []).some(g => g && g.mode === 'combo');
}

// Lưu: chuẩn hoá mảng nhóm tùy chọn từ client (bỏ nhóm/option rỗng, ép kiểu).
export function normalizeOptionGroups(raw) {
  const list = Array.isArray(raw) ? raw : (safeJson(raw, []) || []);
  return (Array.isArray(list) ? list : []).map((g, gi) => {
    const mode = g.mode === 'combo' ? 'combo' : 'price';
    const options = (Array.isArray(g.options) ? g.options : []).map((o, oi) => ({
      key: String(o.key || `o${oi}`).slice(0, 40),
      name: String(o.name || '').trim().slice(0, 80),
      type: o.type === 'free' ? 'free' : 'paid',
      price: o.type === 'free' ? 0 : Math.max(0, Math.round(Number(o.price) || 0)),
      ref_item_id: o.ref_item_id ? String(o.ref_item_id) : null,
      emoji: o.emoji ? String(o.emoji).slice(0, 8) : null,
      // Nhóm 'combo': mỗi lựa chọn BẮT BUỘC link món thật (giá/trạm lấy từ đó).
    })).filter(o => mode === 'combo' ? !!o.ref_item_id : (o.name || o.ref_item_id));
    if (mode === 'combo') {
      const nested = options.find(o => refHasComboGroup(o.ref_item_id));
      if (nested) throw new Error(`Món "${nested.name || nested.ref_item_id}" đã có nhóm "Món đi kèm" riêng — không thể lồng combo trong combo.`);
    }
    return {
      key: String(g.key || `g${gi}`).slice(0, 40),
      name: String(g.name || '').trim().slice(0, 60),
      position: g.position === 'bottom' ? 'bottom' : 'top',
      mode,
      min: Math.max(0, parseInt(g.min) || 0),
      max: Math.max(0, parseInt(g.max) || 0),
      options,
    };
  }).filter(g => g.name && g.options.length);
}

export function enrichAddons(addonsRaw, branch_id = 'sala', vatRate = 0, priceIncludesVat = true) {
  const list = safeJson(addonsRaw, []) || [];
  return (Array.isArray(list) ? list : []).map(a => {
    const out = {
      key: a.key, name: a.name, kind: a.kind || 'extra',
      type: a.type === 'free' ? 'free' : 'paid',
      price: Number(a.price) || 0, ref_item_id: a.ref_item_id || null,
      emoji: a.emoji || null, available: a.available !== false,
    };
    if (a.ref_item_id) {
      const ref = refAvailability(a.ref_item_id, branch_id);
      out.available = ref.exists ? ref.available : false;
      out.ref_exists = ref.exists;
      if (ref.exists) {
        if (!out.name) out.name = ref.name;
        if (!out.emoji) out.emoji = ref.emoji;
        if (out.type !== 'free' && !out.price) out.price = ref.price;
      }
    }
    if (out.type === 'free') out.price = 0;
    // Cùng công thức VAT với option groups — Self-Order thu đúng giá đã gồm VAT.
    out.sale_price = salePrice(out.price, vatRate, priceIncludesVat);
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

export function replaceRecipe(menu_item_id, recipe = [], branch_id = 'sala') {
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
export function listCategories(branch_id = 'sala') {
  return db.prepare(`SELECT * FROM categories WHERE branch_id=? ORDER BY sort,name`).all(branch_id);
}
export function createCategory(body, branch_id = 'sala') {
  const name = String(body.name || '').trim();
  if (!name) throw new Error('Thiếu tên danh mục');
  const id = 'c_' + Math.random().toString(36).slice(2, 8);
  const sort = (db.prepare(`SELECT COALESCE(MAX(sort),0)+1 n FROM categories WHERE branch_id=?`).get(branch_id).n) || 1;
  const stationId = String(body.default_station_id || '').trim() || null;
  if (stationId && !db.prepare(`SELECT 1 FROM production_stations WHERE id=? AND branch_id=? AND active=1`).get(stationId, branch_id)) {
    throw new Error('Trạm mặc định không thuộc chi nhánh hoặc đã ẩn');
  }
  const selfOrderHidden = body.self_order_hidden ? 1 : 0;
  db.prepare(`INSERT INTO categories (id,branch_id,name,icon,sort,default_station_id,self_order_hidden) VALUES (?,?,?,?,?,?,?)`).run(id, branch_id, name, body.icon || '🍽️', sort, stationId, selfOrderHidden);
  cacheBust('menu:');
  audit('category.create', { id, name }, branch_id);
  return db.prepare(`SELECT * FROM categories WHERE id=? AND branch_id=?`).get(id, branch_id);
}
export function updateCategory(id, body, branch_id = 'sala') {
  const cur = db.prepare(`SELECT * FROM categories WHERE id=? AND branch_id=?`).get(id, branch_id);
  if (!cur) throw new Error('Danh mục không tồn tại');
  const stationId = body.default_station_id === undefined
    ? cur.default_station_id
    : (String(body.default_station_id || '').trim() || null);
  if (stationId && !db.prepare(`SELECT 1 FROM production_stations WHERE id=? AND branch_id=? AND active=1`).get(stationId, branch_id)) {
    throw new Error('Trạm mặc định không thuộc chi nhánh hoặc đã ẩn');
  }
  const selfOrderHidden = body.self_order_hidden === undefined
    ? cur.self_order_hidden
    : (body.self_order_hidden ? 1 : 0);
  db.prepare(`UPDATE categories SET name=?, icon=?, default_station_id=?, self_order_hidden=? WHERE id=? AND branch_id=?`).run(
    String(body.name || '').trim() || cur.name, body.icon || cur.icon, stationId, selfOrderHidden, id, branch_id);
  cacheBust('menu:');
  audit('category.update', { id }, branch_id);
  return db.prepare(`SELECT * FROM categories WHERE id=? AND branch_id=?`).get(id, branch_id);
}
export function deleteCategory(id, branch_id = 'sala') {
  const cur = db.prepare(`SELECT * FROM categories WHERE id=? AND branch_id=?`).get(id, branch_id);
  if (!cur) throw new Error('Danh mục không tồn tại');
  const used = db.prepare(`SELECT COUNT(*) n FROM menu_items WHERE category_id=? AND branch_id=? AND deleted_at IS NULL`).get(id, branch_id).n;
  if (used) throw new Error(`Không thể xóa: còn ${used} món trong danh mục này. Hãy chuyển/xóa món trước.`);
  db.prepare(`DELETE FROM categories WHERE id=? AND branch_id=?`).run(id, branch_id);
  cacheBust('menu:');
  audit('category.delete', { id, name: cur.name }, branch_id);
  return { ok: true };
}

export function hideMenuItem(id, hidden = true, branch_id = 'sala') {
  const row = db.prepare(`SELECT * FROM menu_items WHERE id=? AND branch_id=?`).get(id, branch_id);
  if (!row) throw new Error('Món không tồn tại');
  db.prepare(`UPDATE menu_items SET hidden=? WHERE id=? AND branch_id=?`).run(hidden ? 1 : 0, id, branch_id);
  cacheBust('menu:');
  audit(hidden ? 'menu.hide' : 'menu.unhide', { id, name: row.name }, branch_id);
  return getMenuItem(id, {}, branch_id);
}

export function deleteMenuItem(id, branch_id = 'sala') {
  const row = db.prepare(`SELECT * FROM menu_items WHERE id=? AND branch_id=?`).get(id, branch_id);
  if (!row) throw new Error('Món không tồn tại');
  const used = db.prepare(`SELECT COUNT(*) n FROM order_items WHERE menu_item_id=?`).get(id).n;
  if (used) {
    db.prepare(`UPDATE menu_items SET deleted_at=datetime('now'), hidden=1, available=0 WHERE id=? AND branch_id=?`).run(id, branch_id);
    audit('menu.archive', { id, name: row.name, reason: 'has_orders' }, branch_id);
    return { ok: true, archived: true };
  }
  db.prepare(`DELETE FROM recipes WHERE menu_item_id=?`).run(id);
  db.prepare(`DELETE FROM menu_items WHERE id=? AND branch_id=?`).run(id, branch_id);
  audit('menu.delete', { id, name: row.name }, branch_id);
  return { ok: true, deleted: true };
}
