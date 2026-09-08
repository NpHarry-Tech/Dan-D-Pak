// Route ownership: Catalog / Menu + Categories (thực đơn, món, nhóm, ảnh, dịch).
// Nghiệp vụ ở services/catalog.js (+ ghi menu_items trực tiếp qua db). Giữ NGUYÊN hành vi.
import * as Catalog from '../../services/catalog.js';
import * as Auth from '../../services/auth.js';
import { db, uid, audit } from '../../db.js';
import { emit } from '../../realtime.js';

export function registerCatalogRoutes(api, { wrap, guard, branch, visibleBranch, actor, saveBase64Image, MENU_UPLOADS_DIR }) {
// --- Catalog / Menu ---
const stationCode = (value) => String(value || '').trim().toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
const resolveStation = (body, branch_id) => {
  const requested = String(body.station_id || '').trim();
  let station = requested
    ? db.prepare(`SELECT * FROM production_stations WHERE id=? AND branch_id=? AND active=1`).get(requested, branch_id)
    : null;
  if (!station && body.station) {
    station = db.prepare(`SELECT * FROM production_stations WHERE branch_id=? AND code=? AND active=1`)
      .get(branch_id, stationCode(body.station));
  }
  if (!station && body.category_id) {
    station = db.prepare(`SELECT s.* FROM categories c JOIN production_stations s
      ON s.id=c.default_station_id WHERE c.id=? AND c.branch_id=? AND s.active=1`).get(body.category_id, branch_id);
  }
  if (!station) station = db.prepare(`SELECT * FROM production_stations WHERE branch_id=? AND active=1 ORDER BY sort,id LIMIT 1`).get(branch_id);
  if (!station) throw new Error('Chi nhánh chưa có trạm chế biến đang hoạt động');
  return station;
};

api.get('/menu/stations', guard('menu.manage'), wrap((req) =>
  db.prepare(`SELECT * FROM production_stations WHERE branch_id=? ORDER BY active DESC,sort,name`).all(branch(req))));
api.post('/menu/stations', guard('menu.manage'), wrap((req) => {
  const branch_id = branch(req);
  const name = String(req.body?.name || '').trim();
  const code = stationCode(req.body?.code || name);
  if (!name || !code) throw new Error('Tên và mã trạm là bắt buộc');
  const id = uid('station_');
  db.prepare(`INSERT INTO production_stations(id,branch_id,code,name,active,sort,created_at)
    VALUES(?,?,?,?,1,?,datetime('now'))`).run(id, branch_id, code, name, Number(req.body?.sort) || 0);
  audit('menu.station.create', { id, code, name }, branch_id, actor(req));
  emit('menu:updated', { station_id: id }, branch_id);
  return db.prepare(`SELECT * FROM production_stations WHERE id=?`).get(id);
}));
api.post('/menu/stations/:id/update', guard('menu.manage'), wrap((req) => {
  const branch_id = branch(req);
  const current = db.prepare(`SELECT * FROM production_stations WHERE id=? AND branch_id=?`).get(req.params.id, branch_id);
  if (!current) throw new Error('Trạm không tồn tại');
  const name = String(req.body?.name ?? current.name).trim();
  const code = stationCode(req.body?.code ?? current.code);
  const active = req.body?.active === undefined ? current.active : (req.body.active ? 1 : 0);
  if (!name || !code) throw new Error('Tên và mã trạm là bắt buộc');
  db.prepare(`UPDATE production_stations SET code=?,name=?,active=?,sort=?,updated_at=datetime('now')
    WHERE id=? AND branch_id=?`).run(code, name, active, Number(req.body?.sort ?? current.sort) || 0, current.id, branch_id);
  audit('menu.station.update', { id: current.id, code, name, active }, branch_id, actor(req));
  emit('menu:updated', { station_id: current.id }, branch_id);
  return db.prepare(`SELECT * FROM production_stations WHERE id=?`).get(current.id);
}));
api.get('/menu', wrap((req) => Catalog.listMenu({
  ...req.query,
  forCustomer: true,
  // Tablet Self-Order gọi kèm ?self_order=1 → menu KHÁCH (ẩn thêm self_order_hidden).
  selfOrder: req.query.self_order === '1' || req.query.self_order === 'true',
  branch_id: visibleBranch(req),
})));
api.get('/menu/manage', guard('menu.manage'), wrap((req) => Catalog.listMenu({ forCustomer: false, ...req.query, branch_id: branch(req) })));

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
  if (!db.prepare(`SELECT 1 FROM categories WHERE id=? AND branch_id=?`).get(b.category_id, branch_id)) throw new Error('Nhóm món không thuộc chi nhánh');
  const station = resolveStation(b, branch_id);
  const id = uid('m_');
  const sort = (db.prepare(`SELECT COALESCE(MAX(sort),0)+1 n FROM menu_items WHERE branch_id=?`).get(branch_id).n) || 1;
  const translations = await Catalog.completeMenuTranslations({
    name: b.name,
    description: b.description,
    translations: b.translations,
  });
  db.prepare(`INSERT INTO menu_items
    (id,branch_id,category_id,name,emoji,image,description,price,price_includes_vat,vat_rate,station,station_id,sla_minutes,available,hidden,self_order_hidden,ingredients_json,allergens_json,schedule_json,modifiers_json,addons_json,option_groups_json,translations_json,sort)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id,
    branch_id,
    b.category_id,
    b.name,
    b.emoji || '🍽️',
    b.image || null,
    b.description || null,
    parseInt(b.price) || 0,
    [false, 0, '0'].includes(b.price_includes_vat) ? 0 : 1,
    b.vat_rate === undefined ? 8 : Math.min(100, Math.max(0, Number(b.vat_rate) || 0)),
    station.code,
    station.id,
    parseInt(b.sla_minutes) || 10,
    b.available === false ? 0 : 1,
    b.hidden ? 1 : 0,
    b.self_order_hidden ? 1 : 0,
    JSON.stringify(Catalog.parseList(b.ingredients)),
    JSON.stringify(Catalog.parseList(b.allergens)),
    JSON.stringify(Catalog.normalizeSchedule(b.schedule)),
    JSON.stringify(Array.isArray(b.modifiers) ? b.modifiers : []),
    JSON.stringify(Catalog.normalizeAddons(b.addons)),
    JSON.stringify(Catalog.normalizeOptionGroups(b.option_groups)),
    JSON.stringify(translations),
    sort);
  Catalog.replaceRecipe(id, b.recipe || [], branch_id);
  audit('menu.create', { id, name: b.name }, branch_id, actor(req));
  Catalog.cacheBust('menu:');
  emit('menu:updated', { id, created: true }, branch_id);
  return Catalog.getMenuItem(id, { includeRecipe: true }, branch_id);
}));

api.post('/menu/:id/update', guard('menu.manage'), wrap(async (req) => {
  const branch_id = branch(req);
  const pin = req.body?.security_pin;
  if (req.body) delete req.body.security_pin;
  const approvedBy = Auth.verifyManagerOwnerPin(pin, branch_id);
  if (!approvedBy) throw new Error('Cần nhập PIN của Manager hoặc Admin để xác nhận cập nhật món ăn.');

  const b = req.body;
  const cur = db.prepare(`SELECT * FROM menu_items WHERE id=? AND branch_id=?`).get(req.params.id, branch_id);
  if (!cur) throw new Error('Món không tồn tại');
  if (b.category_id && !db.prepare(`SELECT 1 FROM categories WHERE id=? AND branch_id=?`).get(b.category_id, branch_id)) throw new Error('Nhóm món không thuộc chi nhánh');
  const v = (k, fallback) => (b[k] !== undefined && b[k] !== null && b[k] !== '') ? b[k] : fallback;
  const station = (b.station !== undefined || b.station_id !== undefined || b.category_id !== undefined)
    ? resolveStation({ ...b, category_id: v('category_id', cur.category_id) }, branch_id)
    : null;
  const nextName = v('name', cur.name);
  const nextDescription = b.description !== undefined ? (b.description || '') : (cur.description || '');
  const translations = await Catalog.completeMenuTranslations({
    name: nextName,
    description: nextDescription,
    translations: b.translations !== undefined ? b.translations : cur.translations_json,
  });
  db.prepare(`UPDATE menu_items SET
      name=?, emoji=?, image=?, description=?, price=?, price_includes_vat=?, vat_rate=?, category_id=?, station=?, station_id=?, sla_minutes=?,
      ingredients_json=?, allergens_json=?, schedule_json=?, hidden=?, self_order_hidden=?, addons_json=?, option_groups_json=?, translations_json=?
    WHERE id=? AND branch_id=?`).run(
    nextName,
    v('emoji', cur.emoji),
    b.image !== undefined ? (b.image || null) : cur.image,
    nextDescription || null,
    b.price !== undefined ? parseInt(b.price) : cur.price,
    b.price_includes_vat !== undefined ? (b.price_includes_vat ? 1 : 0) : cur.price_includes_vat,
    b.vat_rate !== undefined ? Math.min(100, Math.max(0, Number(b.vat_rate) || 0)) : cur.vat_rate,
    v('category_id', cur.category_id),
    station?.code || cur.station,
    station?.id || cur.station_id,
    b.sla_minutes !== undefined ? parseInt(b.sla_minutes) : cur.sla_minutes,
    b.ingredients !== undefined ? JSON.stringify(Catalog.parseList(b.ingredients)) : cur.ingredients_json,
    b.allergens !== undefined ? JSON.stringify(Catalog.parseList(b.allergens)) : cur.allergens_json,
    b.schedule !== undefined ? JSON.stringify(Catalog.normalizeSchedule(b.schedule)) : cur.schedule_json,
    b.hidden !== undefined ? (b.hidden ? 1 : 0) : cur.hidden,
    b.self_order_hidden !== undefined ? (b.self_order_hidden ? 1 : 0) : (cur.self_order_hidden || 0),
    b.addons !== undefined ? JSON.stringify(Catalog.normalizeAddons(b.addons)) : (cur.addons_json || '[]'),
    b.option_groups !== undefined ? JSON.stringify(Catalog.normalizeOptionGroups(b.option_groups)) : (cur.option_groups_json || '[]'),
    JSON.stringify(translations),
    req.params.id, branch_id);
  if (Array.isArray(b.recipe)) Catalog.replaceRecipe(req.params.id, b.recipe || [], branch_id);
  audit('menu.update', { id: req.params.id }, branch_id, actor(req));
  Catalog.cacheBust('menu:');
  emit('menu:updated', { id: req.params.id, updated: true }, branch_id);
  return Catalog.getMenuItem(req.params.id, { includeRecipe: true }, branch_id);
}));

api.post('/menu/:id/availability', guard('menu.manage'), wrap((req) => {
  const branch_id = branch(req);
  const { available } = req.body;
  db.prepare(`UPDATE menu_items SET available=? WHERE id=? AND branch_id=?`).run(available ? 1 : 0, req.params.id, branch_id);
  const item = Catalog.getMenuItem(req.params.id, {}, branch_id);
  if (!item) throw new Error('Món không tồn tại');
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
  const cur = db.prepare(`SELECT price FROM menu_items WHERE id=? AND branch_id=?`).get(req.params.id, branch_id);
  if (!cur) throw new Error('Món không tồn tại');
  db.prepare(`UPDATE menu_items SET price=? WHERE id=? AND branch_id=?`).run(price, req.params.id, branch_id);
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
api.get('/categories', wrap((req) => Catalog.listCategories(visibleBranch(req))));
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
