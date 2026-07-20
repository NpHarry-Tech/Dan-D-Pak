// Route ownership: Catalog / Menu + Categories (thực đơn, món, nhóm, ảnh, dịch).
// Nghiệp vụ ở services/catalog.js (+ ghi menu_items trực tiếp qua db). Giữ NGUYÊN hành vi.
import * as Catalog from '../../services/catalog.js';
import * as Auth from '../../services/auth.js';
import { db, uid, audit } from '../../db.js';
import { emit } from '../../realtime.js';

export function registerCatalogRoutes(api, { wrap, guard, branch, actor, saveBase64Image, MENU_UPLOADS_DIR }) {
// --- Catalog / Menu ---
api.get('/menu', wrap((req) => Catalog.listMenu({ forCustomer: true, ...req.query })));
api.get('/menu/manage', guard('menu.manage'), wrap((req) => Catalog.listMenu({ forCustomer: false, ...req.query })));

api.post('/menu/image-upload', guard('menu.manage'), wrap((req) =>
  saveBase64Image(req, { dir: MENU_UPLOADS_DIR, urlBase: '/uploads/menu', prefix: 'menu_', auditAction: 'menu.image_upload' })));

api.post('/menu/translate', guard('menu.manage'), wrap((req) =>
  Catalog.completeMenuTranslations(req.body || {})));

api.post('/menu', guard('menu.manage'), wrap(async (req) => {
  const branch_id = branch(req);
  const pin = req.body?.security_pin;
  if (req.body) delete req.body.security_pin;
  const approvedBy = Auth.verifyManagerOwnerPin(pin, branch_id);
  if (!approvedBy) throw new Error('Cần nhập PIN của Manager hoặc Admin để xác nhận tạo món ăn.');

  const b = req.body;
  if (!b.name || !b.category_id) throw new Error('Thiếu tên món hoặc nhóm');
  const id = uid('m_');
  const sort = (db.prepare(`SELECT COALESCE(MAX(sort),0)+1 n FROM menu_items`).get().n) || 1;
  const translations = await Catalog.completeMenuTranslations({
    name: b.name,
    description: b.description,
    translations: b.translations,
  });
  db.prepare(`INSERT INTO menu_items
    (id,category_id,name,emoji,image,description,price,station,sla_minutes,available,hidden,ingredients_json,allergens_json,schedule_json,modifiers_json,addons_json,translations_json,sort)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id,
    b.category_id,
    b.name,
    b.emoji || '🍽️',
    b.image || null,
    b.description || null,
    parseInt(b.price) || 0,
    b.station || 'kitchen',
    parseInt(b.sla_minutes) || 10,
    b.available === false ? 0 : 1,
    b.hidden ? 1 : 0,
    JSON.stringify(Catalog.parseList(b.ingredients)),
    JSON.stringify(Catalog.parseList(b.allergens)),
    JSON.stringify(Catalog.normalizeSchedule(b.schedule)),
    JSON.stringify(Array.isArray(b.modifiers) ? b.modifiers : []),
    JSON.stringify(Catalog.normalizeAddons(b.addons)),
    JSON.stringify(translations),
    sort);
  Catalog.replaceRecipe(id, b.recipe || [], branch_id);
  audit('menu.create', { id, name: b.name }, branch_id, actor(req));
  Catalog.cacheBust('menu:');
  emit('menu:updated', { id, created: true }, branch_id);
  return Catalog.getMenuItem(id, { includeRecipe: true });
}));

api.post('/menu/:id/update', guard('menu.manage'), wrap(async (req) => {
  const branch_id = branch(req);
  const pin = req.body?.security_pin;
  if (req.body) delete req.body.security_pin;
  const approvedBy = Auth.verifyManagerOwnerPin(pin, branch_id);
  if (!approvedBy) throw new Error('Cần nhập PIN của Manager hoặc Admin để xác nhận cập nhật món ăn.');

  const b = req.body;
  const cur = db.prepare(`SELECT * FROM menu_items WHERE id=?`).get(req.params.id);
  if (!cur) throw new Error('Món không tồn tại');
  const v = (k, fallback) => (b[k] !== undefined && b[k] !== null && b[k] !== '') ? b[k] : fallback;
  const nextName = v('name', cur.name);
  const nextDescription = b.description !== undefined ? (b.description || '') : (cur.description || '');
  const translations = await Catalog.completeMenuTranslations({
    name: nextName,
    description: nextDescription,
    translations: b.translations !== undefined ? b.translations : cur.translations_json,
  });
  db.prepare(`UPDATE menu_items SET
      name=?, emoji=?, image=?, description=?, price=?, category_id=?, station=?, sla_minutes=?,
      ingredients_json=?, allergens_json=?, schedule_json=?, hidden=?, addons_json=?, translations_json=?
    WHERE id=?`).run(
    nextName,
    v('emoji', cur.emoji),
    b.image !== undefined ? (b.image || null) : cur.image,
    nextDescription || null,
    b.price !== undefined ? parseInt(b.price) : cur.price,
    v('category_id', cur.category_id),
    v('station', cur.station),
    b.sla_minutes !== undefined ? parseInt(b.sla_minutes) : cur.sla_minutes,
    b.ingredients !== undefined ? JSON.stringify(Catalog.parseList(b.ingredients)) : cur.ingredients_json,
    b.allergens !== undefined ? JSON.stringify(Catalog.parseList(b.allergens)) : cur.allergens_json,
    b.schedule !== undefined ? JSON.stringify(Catalog.normalizeSchedule(b.schedule)) : cur.schedule_json,
    b.hidden !== undefined ? (b.hidden ? 1 : 0) : cur.hidden,
    b.addons !== undefined ? JSON.stringify(Catalog.normalizeAddons(b.addons)) : (cur.addons_json || '[]'),
    JSON.stringify(translations),
    req.params.id);
  if (Array.isArray(b.recipe)) Catalog.replaceRecipe(req.params.id, b.recipe || [], branch_id);
  audit('menu.update', { id: req.params.id }, branch_id, actor(req));
  Catalog.cacheBust('menu:');
  emit('menu:updated', { id: req.params.id, updated: true }, branch_id);
  return Catalog.getMenuItem(req.params.id, { includeRecipe: true });
}));

api.post('/menu/:id/availability', guard('menu.manage'), wrap((req) => {
  const branch_id = branch(req);
  const { available } = req.body;
  db.prepare(`UPDATE menu_items SET available=? WHERE id=?`).run(available ? 1 : 0, req.params.id);
  const item = Catalog.getMenuItem(req.params.id);
  audit('menu.availability', { id: item.id, available: !!item.available }, branch_id, actor(req));
  emit('menu:updated', { id: item.id, available: !!item.available, name: item.name }, branch_id);
  return { id: item.id, available: !!item.available };
}));

api.post('/menu/:id/price', guard('menu.manage'), wrap((req) => {
  const branch_id = branch(req);
  const pin = req.body?.security_pin;
  if (req.body) delete req.body.security_pin;
  if (!Auth.verifyManagerOwnerPin(pin, branch_id)) throw new Error('Cần nhập PIN của Manager hoặc Admin để xác nhận đổi giá món.');
  const price = parseInt(req.body.price);
  if (!Number.isFinite(price) || price < 0) throw new Error('Giá không hợp lệ');
  const cur = db.prepare(`SELECT price FROM menu_items WHERE id=?`).get(req.params.id);
  if (!cur) throw new Error('Món không tồn tại');
  db.prepare(`UPDATE menu_items SET price=? WHERE id=?`).run(price, req.params.id);
  audit('menu.price', { id: req.params.id, from: cur.price, to: price }, branch_id, actor(req));
  emit('menu:updated', { id: req.params.id, price }, branch_id);
  return { id: req.params.id, price };
}));

api.post('/menu/:id/hide', guard('menu.manage'), wrap((req) => {
  const branch_id = branch(req);
  const item = Catalog.hideMenuItem(req.params.id, req.body.hidden !== false, branch_id);
  emit('menu:updated', { id: req.params.id, hidden: item.hidden }, branch_id);
  return item;
}));

api.post('/menu/:id/delete', guard('menu.manage'), wrap((req) => {
  const branch_id = branch(req);
  const pin = req.body?.security_pin;
  if (req.body) delete req.body.security_pin;
  const approvedBy = Auth.verifyManagerOwnerPin(pin, branch_id);
  if (!approvedBy) throw new Error('Cần nhập PIN của Manager hoặc Admin để xác nhận xóa món ăn.');
  const r = Catalog.deleteMenuItem(req.params.id, branch_id);
  emit('menu:updated', { id: req.params.id, deleted: true }, branch_id);
  return r;
}));

// --- Categories ---
api.get('/categories', wrap(() => Catalog.listCategories()));
api.post('/categories', guard('menu.manage'), wrap((req) => {
  const b = branch(req);
  const pin = req.body?.security_pin;
  if (req.body) delete req.body.security_pin;
  const approvedBy = Auth.verifyManagerOwnerPin(pin, b);
  if (!approvedBy) throw new Error('Cần nhập PIN của Manager hoặc Admin để xác nhận tạo danh mục.');
  const c = Catalog.createCategory(req.body, b);
  emit('menu:updated', { category: true }, b);
  return c;
}));
api.post('/categories/:id/update', guard('menu.manage'), wrap((req) => {
  const b = branch(req);
  const pin = req.body?.security_pin;
  if (req.body) delete req.body.security_pin;
  const approvedBy = Auth.verifyManagerOwnerPin(pin, b);
  if (!approvedBy) throw new Error('Cần nhập PIN của Manager hoặc Admin để xác nhận cập nhật danh mục.');
  const c = Catalog.updateCategory(req.params.id, req.body, b);
  emit('menu:updated', { category: true }, b);
  return c;
}));
api.post('/categories/:id/delete', guard('menu.manage'), wrap((req) => {
  const b = branch(req);
  const pin = req.body?.security_pin;
  if (req.body) delete req.body.security_pin;
  const approvedBy = Auth.verifyManagerOwnerPin(pin, b);
  if (!approvedBy) throw new Error('Cần nhập PIN của Manager hoặc Admin để xác nhận xóa danh mục.');
  const r = Catalog.deleteCategory(req.params.id, b);
  emit('menu:updated', { category: true }, b);
  return r;
}));
}
