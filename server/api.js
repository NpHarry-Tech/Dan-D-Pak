// REST API: thin HTTP layer over the Local Store Server services.
import { Router } from 'express';
import { db, uid, audit } from './db.js';
import * as Orders from './services/orders.js';
import * as Inv from './services/inventory.js';
import * as Pay from './services/payments.js';
import * as Reports from './services/reports.js';
import * as Retail from './services/retail.js';
import * as Auth from './services/auth.js';
import * as Print from './services/printing.js';
import * as Online from './services/online.js';
import * as Invoices from './services/invoices.js';
import * as Sync from './services/sync.js';
import * as Catalog from './services/catalog.js';
import * as Vouchers from './services/vouchers.js';
import * as Customers from './services/customers.js';
import * as Modules from './services/modules.js';
import * as AppSettings from './services/settings.js';
import * as BookMenu from './services/bookMenu.js';
import * as Shifts from './services/shifts.js';
import * as History from './services/history.js';
import * as Misa from './services/misa.js';
import * as Archive from './services/archive.js';
import * as System from './services/system.js';
import * as ReportCenter from './services/reportCenter.js';
import * as CashDrawer from './services/cashDrawer.js';
import * as Branches from './services/branches.js';
import * as Purchase from './services/purchase.js';
import * as Expenses from './services/expenses.js';
import * as ES from './services/enterpriseStorage.js';
import { emit, getActiveConnections } from './realtime.js';
import { errorPayload } from './core/errors.js';
import { notImplemented } from './core/http.js';

export const api = Router();
const guard = Auth.requireAuth;

const guardAny = (...perms) => (req, res, next) => {
  const user = req.user;
  if (!user) return res.status(401).json({ error: 'Cần đăng nhập' });
  if (user.role === 'owner') return next();
  const hasAccess = perms.some(p => Auth.canUser(user, p)) || Auth.canUser(user, 'settings.manage');
  if (!hasAccess) return res.status(403).json({ error: 'Không đủ quyền truy cập các mục này' });
  next();
};
api.use(Auth.attachUser()); // gắn req.user (nếu có token) cho mọi route, kể cả route không bắt buộc đăng nhập
const actor = Auth.actorName; // người phụ trách thao tác cho nhật ký hoạt động
const branch = (req) => Auth.resolveBranch(req);
const publicBranch = (req) => Auth.publicBranch(req);
const visibleBranch = (req) => req.user ? branch(req) : publicBranch(req);
function scopedUserBody(req) {
  const body = { ...(req.body || {}) };
  if (req.user?.role === 'owner') return body;
  if (body.role === 'owner') throw new Error('Chỉ Chủ quán mới được tạo hoặc cấp vai trò Owner.');
  const allowed = new Set(Auth.userBranchIds(req.user));
  const requested = Array.isArray(body.branch_access || body.branch_ids || body.branchAccess)
    ? (body.branch_access || body.branch_ids || body.branchAccess)
    : [];
  body.branch_access = requested.filter(id => allowed.has(String(id)));
  if (!allowed.has(String(body.branch_id || ''))) body.branch_id = branch(req);
  return body;
}
function normalizedReportType(type) {
  const raw = String(type || 'sales_overview');
  if (['sales_fnb', 'sales_retail', 'sales_by_product'].includes(raw)) return 'sales_overview';
  return ReportCenter.REPORTS.some(r => r.key === raw) ? raw : 'sales_overview';
}
function reportPerm(type) {
  return `report.${normalizedReportType(type)}`;
}
function reportForbidden() {
  const e = new Error('Không đủ quyền xem báo cáo này.');
  e.status = 403;
  return e;
}
function canViewReport(req, type) {
  return !!req.user && (req.user.role === 'owner' || Auth.canUser(req.user, 'reports') || Auth.canUser(req.user, reportPerm(type)));
}
function canOpenReportCenter(req) {
  return !!req.user && (req.user.role === 'owner' || Auth.canUser(req.user, 'reports') || ReportCenter.REPORTS.some(r => Auth.canUser(req.user, reportPerm(r.key))));
}
function requireReportCenter(req) {
  if (!canOpenReportCenter(req)) throw reportForbidden();
}
function requireReportType(req, type) {
  if (!canViewReport(req, type)) throw reportForbidden();
}
function reportCatalogForUser(req) {
  const catalog = ReportCenter.catalog(branch(req));
  if (req.user?.role === 'owner' || Auth.canUser(req.user, 'reports')) return catalog;
  const reports = catalog.reports.filter(r => Auth.canUser(req.user, reportPerm(r.key)));
  const groupKeys = new Set(reports.map(r => r.group));
  return {
    ...catalog,
    groups: catalog.groups.filter(g => groupKeys.has(g.key)),
    reports,
  };
}
const wrap = (fn) => (req, res) => {
  try {
    const out = fn(req, res);
    if (out && typeof out.then === 'function') {
      out
        .then(v => res.json(v ?? { ok: true }))
        .catch(e => res.status(e.status || 400).json(errorPayload(e)));
    }
    else res.json(out ?? { ok: true });
  }
  catch (e) { res.status(e.status || 400).json(errorPayload(e)); }
};

// --- Auth ---
api.get('/branches', wrap(() => Branches.listBranches()));
api.post('/login', wrap((req) => Auth.login(req.body.username, req.body.pin, req.body.branch_id || publicBranch(req))));
api.post('/logout', wrap((req) => {
  Auth.logout((req.headers.authorization || '').slice(7) || req.headers['x-auth-token']);
  return { ok: true };
}));
api.get('/me', guard(), wrap((req) => ({ ...req.user, perms: Auth.effectivePermsForUser(req.user.id) })));
api.post('/me/lang', guard(), wrap((req) => Auth.updateOwnLang(req.user.id, req.body.lang, branch(req))));
api.get('/users', wrap((req) => Auth.listUsers(visibleBranch(req))));
api.get('/ping', wrap(() => ({ ok: true, serverTime: Date.now() })));

// --- ERP module registry ---
api.get('/modules', guard(), wrap((req) => ({ groups: Modules.MODULE_GROUPS, modules: Modules.visibleModules(Auth.effectivePermsForUser(req.user.id)) })));
api.get('/modules/all', guardAny('settings.perms'), wrap(() => ({ groups: Modules.MODULE_GROUPS, modules: Modules.listModules(Auth.ALL_PERMS) })));

// --- Settings: user & permission management (settings.manage) ---
api.get('/settings/permissions', guardAny('settings.perms', 'settings.users'), wrap(() => ({ catalog: Auth.PERMISSIONS, roles: Auth.permMatrix() })));
api.post('/settings/roles/:role/permissions', guardAny('settings.perms'), wrap((req) => Auth.setRolePerms(req.params.role, req.body.perms, branch(req))));
api.get('/settings/users', guardAny('settings.users'), wrap((req) => Auth.listAllUsers(branch(req))));
api.post('/settings/users', guardAny('settings.users'), wrap((req) => Auth.createUser(scopedUserBody(req), branch(req))));
api.post('/settings/users/:id/update', guardAny('settings.users'), wrap((req) => Auth.updateUser(req.params.id, scopedUserBody(req), branch(req))));
api.post('/settings/users/:id/delete', guardAny('settings.users'), wrap((req) => Auth.deleteUser(req.params.id, branch(req))));
api.get('/settings/users/:id/permissions', guardAny('settings.users', 'settings.perms'), wrap((req) => Auth.userPermDetails(req.params.id)));
api.post('/settings/users/:id/permissions', guardAny('settings.users', 'settings.perms'), wrap((req) => Auth.setUserPerms(req.params.id, req.body.perms, branch(req))));
api.get('/settings/branches', guardAny('settings.branches'), wrap(() => Branches.listBranches({ all: true })));
api.post('/settings/branches', guardAny('settings.branches'), wrap((req) => Branches.createBranch(req.body, actor(req))));
api.post('/settings/branches/:id/update', guardAny('settings.branches'), wrap((req) => Branches.updateBranch(req.params.id, req.body, actor(req))));
api.get('/settings/app', guardAny('settings.sync', 'settings.operations', 'settings.einvoice', 'settings.print', 'settings.printers', 'settings.devices', 'settings.invoices'), wrap((req) => AppSettings.getSettings(branch(req))));
api.post('/settings/app', guardAny('settings.sync', 'settings.operations', 'settings.einvoice', 'settings.print', 'settings.printers', 'settings.devices', 'settings.invoices'), wrap((req) => {
  const branch_id = branch(req);
  const shifts = req.body?.operations_config?.shifts;
  if (shifts && Object.prototype.hasOwnProperty.call(shifts, 'defaultDrawerCash')) {
    const current = Math.max(0, parseInt(AppSettings.getOperationsConfig(branch_id)?.shifts?.defaultDrawerCash) || 0);
    const next = Math.max(0, parseInt(shifts.defaultDrawerCash) || 0);
    if (next !== current) {
      const pin = req.body.security_pin || req.body.manager_pin || req.body.owner_pin || req.body.password;
      const approvedBy = Auth.verifyManagerOwnerPin(pin, branch_id);
      if (!approvedBy) throw new Error('Cần nhập lại mật khẩu/PIN của Manager hoặc Owner để đổi tiền két gốc.');
      audit('settings.drawer_cash.reauth', { from: current, to: next, approved_by: approvedBy.username }, branch_id, approvedBy.username);
      delete req.body.security_pin;
      delete req.body.manager_pin;
      delete req.body.owner_pin;
      delete req.body.password;
    }
  }
  return AppSettings.updateSettings(req.body, branch_id);
}));
api.post('/templates/auto-save', guardAny('settings.print'), wrap((req) => AppSettings.autoSaveTemplate(req.body, branch(req))));
api.get('/settings/integrations', guardAny('settings.integrations'), wrap((req) => AppSettings.getIntegrations(branch(req))));
api.post('/settings/integrations', guardAny('settings.integrations'), wrap((req) => AppSettings.updateIntegrations(req.body, branch(req))));
// Test a single integration channel. MISA does a real auth call when live;
// delivery channels return the webhook URL to paste into the partner portal.
api.post('/settings/integrations/:channel/test', guardAny('settings.integrations'), wrap(async (req) => {
  const channel = req.params.channel;
  const cfg = AppSettings.getIntegrations(branch(req)).channels?.[channel];
  if (!cfg) throw new Error('Kênh không hợp lệ: ' + channel);
  const base = `${req.protocol}://${req.get('host')}`;
  if (channel === 'misa') return { channel, ...(await Misa.testConnection(cfg)) };
  if (channel === 'payos') {
    const payosWebhook = `${base}/api/payos/webhook`;
    if (!cfg.enabled) return { channel, ok: false, mode: 'disabled', message: 'payOS đang tắt. Bật kết nối trước khi kiểm tra.', webhookUrl: payosWebhook };
    const ok = !!(cfg.clientId && cfg.apiKey && cfg.checksumKey);
    return {
      channel, ok, mode: ok ? 'ready' : 'partial', webhookUrl: payosWebhook,
      message: ok
        ? 'Đã đủ Client ID / API Key / Checksum Key. Dán Webhook URL ở trên vào payOS Dashboard. Khi backend payOS bật, hệ thống sẽ tạo link thanh toán và nhận xác nhận tại URL này.'
        : 'Thiếu Client ID / API Key / Checksum Key (lấy ở payOS Dashboard → Cài đặt → Thông tin xác thực).',
    };
  }
  // Delivery / website channels: orders arrive at our webhook → Kênh online module.
  const webhookUrl = `${base}/api/online/webhook`;
  if (!cfg.enabled) return { channel, ok: false, mode: 'disabled', message: 'Kênh đang tắt. Bật để xuất hiện trong module Kênh online.', webhookUrl };
  const haveCreds = !!(cfg.clientId && cfg.clientSecret) || !!cfg.apiKey;
  return {
    channel, ok: true, mode: haveCreds ? 'ready' : 'partial', webhookUrl,
    message: haveCreds
      ? `Đã bật. Dán Webhook URL này vào cổng đối tác để đẩy đơn về "Kênh online". Đẩy đơn realtime cần đối tác bật API cho cửa hàng (B2B onboarding).`
      : `Đã bật nhưng chưa có Client ID/Secret. Đơn vẫn nhận được qua Webhook URL, nhưng đồng bộ menu/tồn kho 2 chiều cần khai báo credential từ cổng đối tác.`,
  };
}));
api.get('/settings/connections/status', guardAny('settings.connections'), wrap(async (req) => {
  const started = Date.now();
  const os = await import('os');
  const interfaces = os.networkInterfaces();
  const serverIps = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        serverIps.push(iface.address);
      }
    }
  }
  const socketConnections = getActiveConnections(branch(req));
  const [internetCheck, systemPrinters] = await Promise.all([
    System.checkInternet({ force: req.query.force === '1' }),
    System.listSystemPrinters({ force: req.query.force === '1' }),
  ]);
  return {
    serverIps,
    connections: socketConnections,
    internet: !!internetCheck.ok,
    internetCheck,
    systemPrinters,
    serverElapsedMs: Date.now() - started,
    checkedAt: new Date().toISOString(),
  };
}));
api.get('/settings/system/printers', guardAny('settings.connections', 'settings.printers', 'settings.print'), wrap(async (req) => ({
  printers: await System.listSystemPrinters({ force: req.query.force === '1' }),
  checkedAt: new Date().toISOString(),
})));
api.get('/devices', guardAny('settings.devices', 'settings.connections'), wrap(() => notImplemented('Device registry endpoint is planned but not implemented yet. Current live device visibility is available through /api/settings/connections/status.')));
api.post('/devices/pair', wrap(() => notImplemented()));
api.patch('/devices/:id/approve', guardAny('settings.devices'), wrap(() => notImplemented()));
api.get('/operations/config', wrap((req) => AppSettings.getOperationsConfig(visibleBranch(req))));
api.get('/book-menu', wrap((req) => BookMenu.getPublicBookConfig(visibleBranch(req))));
api.get('/settings/book-menu', guardAny('settings.bookmenu'), wrap((req) => BookMenu.getBookConfig(branch(req))));
api.post('/settings/book-menu', guardAny('settings.bookmenu'), wrap((req) => {
  const b = branch(req);
  const out = BookMenu.saveBookConfig(req.body, b);
  emit('book-menu:updated', { activeBookId: out.activeBookId }, b);
  return out;
}));
api.post('/settings/book-menu/import-pubhtml5', guardAny('settings.bookmenu'), wrap(async (req) => {
  const b = branch(req);
  const out = await BookMenu.importPubhtml5(req.body.url, req.body.title, b);
  emit('book-menu:updated', { activeBookId: out.activeBookId }, b);
  return out;
}));
api.post('/device/ipad/unlock', wrap((req) => {
  if (!AppSettings.verifyIpadStaffPin(req.body.pin, visibleBranch(req))) throw new Error('Mật khẩu không đúng');
  return { ok: true };
}));

// --- Catalog / Menu ---
api.get('/menu', wrap(() => Catalog.listMenu({ forCustomer: true })));
api.get('/menu/manage', guard('menu.manage'), wrap(() => Catalog.listMenu({ forCustomer: false })));

api.post('/menu', guard('menu.manage'), wrap((req) => {
  const branch_id = branch(req);
  const b = req.body;
  if (!b.name || !b.category_id) throw new Error('Thiếu tên món hoặc nhóm');
  const id = uid('m_');
  const sort = (db.prepare(`SELECT COALESCE(MAX(sort),0)+1 n FROM menu_items`).get().n) || 1;
  db.prepare(`INSERT INTO menu_items
    (id,category_id,name,emoji,image,description,price,station,sla_minutes,available,hidden,ingredients_json,allergens_json,schedule_json,modifiers_json,addons_json,sort)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
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
    sort);
  Catalog.replaceRecipe(id, b.recipe || [], branch_id);
  audit('menu.create', { id, name: b.name }, branch_id, actor(req));
  emit('menu:updated', { id, created: true }, branch_id);
  return Catalog.getMenuItem(id, { includeRecipe: true });
}));

api.post('/menu/:id/update', guard('menu.manage'), wrap((req) => {
  const branch_id = branch(req);
  const b = req.body;
  const cur = db.prepare(`SELECT * FROM menu_items WHERE id=?`).get(req.params.id);
  if (!cur) throw new Error('Món không tồn tại');
  const v = (k, fallback) => (b[k] !== undefined && b[k] !== null && b[k] !== '') ? b[k] : fallback;
  db.prepare(`UPDATE menu_items SET
      name=?, emoji=?, image=?, description=?, price=?, category_id=?, station=?, sla_minutes=?,
      ingredients_json=?, allergens_json=?, schedule_json=?, hidden=?, addons_json=?
    WHERE id=?`).run(
    v('name', cur.name),
    v('emoji', cur.emoji),
    b.image !== undefined ? (b.image || null) : cur.image,
    b.description !== undefined ? (b.description || null) : cur.description,
    b.price !== undefined ? parseInt(b.price) : cur.price,
    v('category_id', cur.category_id),
    v('station', cur.station),
    b.sla_minutes !== undefined ? parseInt(b.sla_minutes) : cur.sla_minutes,
    b.ingredients !== undefined ? JSON.stringify(Catalog.parseList(b.ingredients)) : cur.ingredients_json,
    b.allergens !== undefined ? JSON.stringify(Catalog.parseList(b.allergens)) : cur.allergens_json,
    b.schedule !== undefined ? JSON.stringify(Catalog.normalizeSchedule(b.schedule)) : cur.schedule_json,
    b.hidden !== undefined ? (b.hidden ? 1 : 0) : cur.hidden,
    b.addons !== undefined ? JSON.stringify(Catalog.normalizeAddons(b.addons)) : (cur.addons_json || '[]'),
    req.params.id);
  if (Array.isArray(b.recipe)) Catalog.replaceRecipe(req.params.id, b.recipe || [], branch_id);
  audit('menu.update', { id: req.params.id }, branch_id, actor(req));
  emit('menu:updated', { id: req.params.id, updated: true }, branch_id);
  return Catalog.getMenuItem(req.params.id, { includeRecipe: true });
}));

api.post('/menu/:id/availability', wrap((req) => {
  const branch_id = visibleBranch(req);
  const { available } = req.body;
  db.prepare(`UPDATE menu_items SET available=? WHERE id=?`).run(available ? 1 : 0, req.params.id);
  const item = Catalog.getMenuItem(req.params.id);
  emit('menu:updated', { id: item.id, available: !!item.available, name: item.name }, branch_id);
  return { id: item.id, available: !!item.available };
}));

api.post('/menu/:id/price', wrap((req) => {
  const branch_id = visibleBranch(req);
  const price = parseInt(req.body.price);
  db.prepare(`UPDATE menu_items SET price=? WHERE id=?`).run(price, req.params.id);
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
  const r = Catalog.deleteMenuItem(req.params.id, branch_id);
  emit('menu:updated', { id: req.params.id, deleted: true }, branch_id);
  return r;
}));

// --- Categories ---
api.get('/categories', wrap(() => Catalog.listCategories()));
api.post('/categories', guard('menu.manage'), wrap((req) => { const b = branch(req); const c = Catalog.createCategory(req.body, b); emit('menu:updated', { category: true }, b); return c; }));
api.post('/categories/:id/update', guard('menu.manage'), wrap((req) => { const b = branch(req); const c = Catalog.updateCategory(req.params.id, req.body, b); emit('menu:updated', { category: true }, b); return c; }));
api.post('/categories/:id/delete', guard('menu.manage'), wrap((req) => { const b = branch(req); const r = Catalog.deleteCategory(req.params.id, b); emit('menu:updated', { category: true }, b); return r; }));

// --- Tables ---
api.get('/tables', wrap((req) => Orders.listTables(visibleBranch(req))));
api.get('/tables/:id', wrap((req) => {
  const branch_id = visibleBranch(req);
  return {
    table: Orders.getTableState(req.params.id),
    order: Orders.getOrder(Orders.getOpenOrderForTable(req.params.id, branch_id)?.id),
  };
}));
api.post('/tables/:id/move', guard('sell'), wrap((req) => Orders.moveTable(req.params.id, req.body.to_table_id, branch(req), actor(req))));
api.post('/tables/:id/merge', guard('sell'), wrap((req) => Orders.mergeTables(req.params.id, req.body.target_table_id, branch(req), actor(req))));
api.post('/settings/tables', guardAny('settings.tables'), wrap((req) => Orders.createTable({ ...req.body, branch_id: branch(req) })));
api.post('/settings/tables/:id/update', guardAny('settings.tables'), wrap((req) => Orders.updateTable(req.params.id, req.body, branch(req))));
api.post('/settings/tables/:id/delete', guardAny('settings.tables'), wrap((req) => Orders.deleteTable(req.params.id, branch(req))));

// --- Orders ---
api.post('/orders', wrap((req) => Orders.createOrUpdateOrder({ ...req.body, branch_id: visibleBranch(req), actor: actor(req) })));
api.get('/orders', guard('pay'), wrap(() => notImplemented('Order list endpoint is planned. Use /api/orders/history or table-specific order reads in the current app.')));
api.get('/orders/pending-confirmation', guard('sell'), wrap((req) => Orders.listPendingConfirmations(branch(req))));
api.get('/orders/history', guard('pay'), wrap((req) => History.listOrderHistory(branch(req), req.query)));
api.get('/orders/:id/receipt', guard('pay'), wrap((req) => History.orderReceipt(req.params.id, branch(req))));
api.get('/orders/:id', wrap((req) => Orders.getOrder(req.params.id)));
api.patch('/orders/:id', guard('sell'), wrap(() => notImplemented('Generic order patch is planned. Current app uses action-specific order endpoints.')));
api.post('/orders/:id/confirm', guard('sell'), wrap((req) => Orders.confirmPendingItems(req.params.id, req.body.item_ids, branch(req), actor(req))));
api.post('/orders/:id/reject', guard('sell'), wrap((req) => Orders.rejectPendingItems(req.params.id, req.body.item_ids, req.body.reason, branch(req), actor(req))));
api.post('/orders/:id/split', guard('pay'), wrap((req) => Orders.splitOrderItems(req.params.id, req.body.item_ids, branch(req), actor(req))));
api.post('/orders/items/:id/status', wrap((req) => Orders.setItemStatus(req.params.id, req.body.status, visibleBranch(req), actor(req))));
api.post('/orders/items/:id/cancel', wrap((req) => {
  const branch_id = visibleBranch(req);
  const itemId = req.params.id;
  const item = db.prepare(`SELECT * FROM order_items WHERE id=?`).get(itemId);
  if (!item) throw new Error('Món không tồn tại');

  if (item.status === 'preparing' || item.status === 'ready' || item.status === 'served') {
    throw new Error('Bếp đã chế biến món này, không thể hủy!');
  }

  if (item.status !== 'pending_confirm') {
    const pin = req.body.pin;
    if (!pin) throw new Error('Yêu cầu nhập mã PIN Quản lý/Chủ quán để hủy món đã gửi.');
    const users = db.prepare(`SELECT * FROM users WHERE pin=? AND active=1 AND role IN ('owner','manager')`).all(String(pin));
    const user = users.find(u => Auth.canAccessBranch(u, branch_id));
    if (!user) {
      throw new Error('Mã PIN không đúng hoặc không có quyền Quản lý/Chủ quán.');
    }
  }
  const res = Orders.cancelItem(itemId, req.body.reason || 'Nhân viên hủy', branch_id, actor(req));
  emit('kds:refresh', { station: item.station }, branch_id);
  return res;
}));

api.post('/orders/items/:id/kds-dismiss', wrap((req) => {
  const branch_id = visibleBranch(req);
  const itemId = req.params.id;
  const item = db.prepare(`SELECT * FROM order_items WHERE id=?`).get(itemId);
  if (!item) throw new Error('Món không tồn tại');
  db.prepare(`UPDATE order_items SET kds_dismissed=1 WHERE id=?`).run(itemId);
  emit('kds:refresh', { station: item.station }, branch_id);
  return { ok: true };
}));

// --- KDS ---
api.get('/kds/tickets', wrap(() => notImplemented('Generic KDS tickets endpoint is planned. Current app uses /api/kds/:station.')));
api.patch('/kds/tickets/:id', wrap(() => notImplemented('Generic KDS ticket patch is planned. Current app uses /api/orders/items/:id/status.')));
api.get('/kds/:station', wrap((req) => Orders.getStationTickets(req.params.station, visibleBranch(req))));

// --- Staff calls ---
api.post('/calls', wrap((req) => Orders.createStaffCall(req.body.table_id, req.body.reason, visibleBranch(req))));
api.get('/calls', wrap((req) => Orders.listStaffCalls(visibleBranch(req))));
api.post('/calls/:table_id/resolve', wrap((req) => { Orders.resolveStaffCall(req.params.table_id, visibleBranch(req)); return { ok: true }; }));

// --- Payments ---
api.post('/payments', guard('pay'), wrap(() => notImplemented('Generic payment creation is planned. Current app uses /api/orders/:id/pay.')));
api.get('/payments', guard('reports'), wrap(() => notImplemented('Payment list endpoint is planned. Current reports are available through dashboard/report center endpoints.')));
api.post('/orders/:id/request-payment', wrap((req) => { Pay.requestPayment(req.body.table_id, visibleBranch(req)); return { ok: true }; }));
api.post('/tables/:id/request-payment', wrap((req) => { Pay.requestPayment(req.params.id, visibleBranch(req)); return { ok: true }; }));
api.post('/orders/:id/customer-qr-pay', wrap((req) => Pay.customerQrPay(req.params.id, req.body || {}, visibleBranch(req))));
// Khách tự phục vụ (iPad) chọn xuất / không xuất hóa đơn VAT sau khi thanh toán — route mở, không cần đăng nhập.
api.post('/orders/:id/customer-invoice', wrap((req) => Invoices.customerRequest(req.params.id, req.body || {}, visibleBranch(req))));
// Tra cứu MST công khai cho màn khách (iPad không đăng nhập) — chỉ trả thông tin doanh nghiệp công khai, không lộ khách local.
api.get('/public/tax-lookup/:mst', wrap(async (req) => { const r = await Customers.lookupTaxCode(req.params.mst); const { existed, ...pub } = r; return pub; }));
api.post('/orders/:id/pay', guard('pay'), wrap((req) => {
  const branch_id = branch(req);
  const receipt = Pay.payOrder(req.params.id, req.body.lines, { discount: req.body.discount, customer: req.body.customer || null, cashier: req.user?.name || req.user?.username || '' }, branch_id);
  if (req.body.customer?.id) Customers.recordPurchase(req.body.customer.id, receipt.total, branch_id, req.params.id);
  return receipt;
}));
api.get('/shifts/current', guard('pay'), wrap((req) => Shifts.currentShift(branch(req))));
api.post('/shifts/open', guard('pay'), wrap((req) => Shifts.openShift(req.body, req.user, branch(req))));
api.post('/shifts/close', guard('pay'), wrap((req) => Shifts.closeShift(req.body, req.user, branch(req))));
api.get('/shifts', guard('reports'), wrap((req) => Shifts.listShifts(branch(req), parseInt(req.query.limit) || 40)));
api.get('/cash-drawer/current', guard('pay'), wrap((req) => CashDrawer.currentDrawer(branch(req))));
api.get('/cash-drawer/entries', guardAny('reports', 'pay'), wrap((req) => CashDrawer.listEntries(branch(req), req.query)));
api.post('/cash-drawer/expense', guard('pay'), wrap((req) => {
  const branch_id = branch(req);
  const entry = CashDrawer.createEntry('expense', req.body, req.user, branch_id);
  emit('shift:updated', { cash_drawer: true, entry }, branch_id);
  emit('cash-drawer:updated', { entry }, branch_id);
  return { entry, drawer: CashDrawer.currentDrawer(branch_id) };
}));
api.post('/cash-drawer/reimbursement', guard('pay'), wrap((req) => {
  const branch_id = branch(req);
  const entry = CashDrawer.createEntry('reimbursement', req.body, req.user, branch_id);
  emit('shift:updated', { cash_drawer: true, entry }, branch_id);
  emit('cash-drawer:updated', { entry }, branch_id);
  return { entry, drawer: CashDrawer.currentDrawer(branch_id) };
}));

// --- Inventory / Warehouse ---
api.get('/warehouses', wrap((req) => Inv.listWarehouses(visibleBranch(req), req.query)));
function verifyWarehouseConfigAccess(req) {
  const branch_id = branch(req);
  const pin = req.body.security_pin || req.body.warehouse_pin || req.body.manager_pin || req.body.owner_pin || req.body.password;
  const approvedBy = Auth.verifyWarehouseConfigPin(pin, branch_id);
  if (!approvedBy) throw new Error('Cần nhập mật khẩu/PIN của Thủ kho, Manager hoặc Owner để tạo/cấu hình kho.');
  delete req.body.security_pin;
  delete req.body.warehouse_pin;
  delete req.body.manager_pin;
  delete req.body.owner_pin;
  delete req.body.password;
  return { branch_id, approvedBy };
}
api.post('/warehouses', guard('warehouse.manage'), wrap((req) => {
  const { branch_id, approvedBy } = verifyWarehouseConfigAccess(req);
  audit('warehouse.config.reauth', { action: 'create', approved_by: approvedBy.username }, branch_id, approvedBy.username);
  return Inv.createWarehouse(req.body, branch_id);
}));
api.post('/warehouses/:id/update', guard('warehouse.manage'), wrap((req) => {
  const { branch_id, approvedBy } = verifyWarehouseConfigAccess(req);
  audit('warehouse.config.reauth', { action: 'update', warehouse_id: req.params.id, approved_by: approvedBy.username }, branch_id, approvedBy.username);
  return Inv.updateWarehouse(req.params.id, req.body, branch_id);
}));
api.get('/inventory', wrap((req) => Inv.listInventory(visibleBranch(req), req.query)));
api.post('/inventory', guard('inventory.adjust'), wrap((req) => Inv.createInventoryItem(req.body, branch(req))));
api.post('/inventory/movements', guard('inventory.adjust'), wrap(() => notImplemented('Generic inventory movement endpoint is planned. Current app uses warehouse receive/issue/transfer/stocktake endpoints.')));
api.post('/inventory/:id/update', guard('inventory.adjust'), wrap((req) => Inv.updateInventoryItem(req.params.id, req.body, branch(req))));
api.post('/inventory/:id/delete', guard('inventory.adjust'), wrap((req) => Inv.deleteInventoryItem(req.params.id, branch(req))));
api.post('/inventory/:id/receive', wrap((req) => Inv.receiveStock(req.params.id, parseFloat(req.body.qty), visibleBranch(req), req.body)));
api.post('/inventory/:id/adjust', guard('inventory.adjust'), wrap((req) => Inv.adjustStock(req.params.id, parseFloat(req.body.stock), branch(req), req.body)));

// --- Retail / SKU ---
api.get('/skus', wrap((req) => Inv.listSkus(visibleBranch(req), req.query)));
api.post('/skus', guard('inventory.adjust'), wrap((req) => Inv.createSku(req.body, branch(req))));
api.post('/skus/:id/update', guard('inventory.adjust'), wrap((req) => Inv.updateSku(req.params.id, req.body, branch(req))));
api.post('/skus/:id/delete', guard('inventory.adjust'), wrap((req) => Inv.deleteSku(req.params.id, branch(req))));
api.get('/skus/barcode/:code', wrap((req) => {
  const s = Inv.findSkuByBarcode(req.params.code, visibleBranch(req), req.query);
  if (!s) throw new Error('Không tìm thấy mã vạch ' + req.params.code);
  return s;
}));
api.post('/skus/:id/receive', wrap((req) => Inv.receiveSku(req.params.id, parseFloat(req.body.qty), visibleBranch(req), req.body)));
api.post('/skus/:id/adjust', guard('inventory.adjust'), wrap((req) => Inv.adjustSku(req.params.id, parseFloat(req.body.stock), branch(req), req.body)));
api.get('/vouchers', guard('discount'), wrap((req) => Vouchers.listVouchers(branch(req))));
api.get('/vouchers/active', wrap((req) => Vouchers.listActiveVouchers(visibleBranch(req))));
api.post('/vouchers', guard('discount'), wrap((req) => Vouchers.createVoucher(req.body, branch(req))));
api.post('/vouchers/:id/update', guard('discount'), wrap((req) => Vouchers.updateVoucher(req.params.id, req.body, branch(req))));
api.post('/vouchers/:id/toggle', guard('discount'), wrap((req) => Vouchers.toggleVoucher(req.params.id, req.body.active, branch(req))));
api.post('/retail/checkout', guard('pay'), wrap((req) => Retail.checkout({ ...req.body, branch_id: branch(req), cashier: req.user?.name || req.user?.username || '' })));

// --- Customers (directory + perks + tax-code lookup) ---
api.get('/customers', guard(), wrap((req) => Customers.listCustomers(branch(req), req.query.q || '')));
api.get('/customers/:id', guard(), wrap((req) => Customers.getCustomer(req.params.id, branch(req))));
api.post('/customers', guard(), wrap((req) => Customers.upsertCustomer(req.body, branch(req))));
api.post('/customers/:id/delete', guard('settings.manage'), wrap((req) => Customers.deleteCustomer(req.params.id, branch(req))));
api.get('/customers/lookup/tax/:mst', guard(), wrap((req) => Customers.lookupTaxCode(req.params.mst)));

// --- Contacts / Partners (Liên hệ: khách hàng + nhà cung cấp dùng chung 1 danh bạ) ---
api.get('/partners', guard('module.contacts'), wrap((req) => ({
  partners: Customers.listPartners(branch(req), { type: req.query.type || 'all', q: req.query.q || '' }),
  counts: Customers.partnerCounts(branch(req)),
})));
api.get('/partners/:id', guard('module.contacts'), wrap((req) => Customers.getCustomer(req.params.id, branch(req))));
api.post('/partners', guard('module.contacts'), wrap((req) => Customers.upsertCustomer(req.body, branch(req))));
api.post('/partners/:id/delete', guard('module.contacts'), wrap((req) => Customers.deleteCustomer(req.params.id, branch(req))));

// --- Purchase (Mua hàng): PO lifecycle + nhận hàng vào kho + công nợ NCC ---
api.get('/purchase', guard('module.purchase'), wrap((req) => Purchase.listPurchaseOrders(branch(req), req.query)));
api.get('/purchase/:id', guard('module.purchase'), wrap((req) => Purchase.getPurchaseOrder(req.params.id, branch(req))));
api.post('/purchase', guard('module.purchase'), wrap((req) => Purchase.savePurchaseOrder(req.body, branch(req), req.user)));
api.post('/purchase/:id/confirm', guard('module.purchase'), wrap((req) => Purchase.confirmPurchaseOrder(req.params.id, branch(req), req.user)));
api.post('/purchase/:id/receive', guard('module.purchase'), wrap((req) => Purchase.receivePurchaseOrder(req.params.id, req.body, branch(req), req.user)));
api.post('/purchase/:id/pay', guard('module.purchase'), wrap((req) => Purchase.recordPurchasePayment(req.params.id, req.body, branch(req), req.user)));
api.post('/purchase/:id/cancel', guard('module.purchase'), wrap((req) => Purchase.cancelPurchaseOrder(req.params.id, branch(req), req.user)));
api.post('/purchase/:id/delete', guard('module.purchase'), wrap((req) => Purchase.deletePurchaseOrder(req.params.id, branch(req), req.user)));

// --- Expenses (Chi phí): sổ chi phí, liên kết két (drawer) hoặc kế toán chi trực tiếp ---
api.get('/expenses', guard('module.expenses'), wrap((req) => Expenses.listExpenses(branch(req), req.query)));
api.get('/expenses/categories', guard('module.expenses'), wrap((req) => Expenses.listCategories(branch(req))));
api.post('/expenses/categories', guard('module.expenses'), wrap((req) => Expenses.upsertCategory(req.body, branch(req))));
api.post('/expenses/categories/:id/delete', guard('module.expenses'), wrap((req) => Expenses.deleteCategory(req.params.id, branch(req))));
api.post('/expenses', guard('module.expenses'), wrap((req) => Expenses.createExpense(req.body, branch(req), req.user)));
api.post('/expenses/:id', guard('module.expenses'), wrap((req) => Expenses.updateExpense(req.params.id, req.body, branch(req), req.user)));
api.post('/expenses/:id/delete', guard('module.expenses'), wrap((req) => Expenses.deleteExpense(req.params.id, branch(req), req.user)));
api.get('/retail/sales', wrap((req) => Retail.listRetailSales(visibleBranch(req))));
api.post('/retail/:id/refund', guard('refund'), wrap((req) => Retail.refund(req.params.id, req.body.reason, branch(req))));

// --- Warehouse documents / lots / counts ---
api.get('/movements', wrap((req) => Inv.listMovements(visibleBranch(req), parseInt(req.query.limit) || 80)));
api.get('/warehouse/lots', wrap((req) => Inv.listLots(visibleBranch(req), req.query)));
api.post('/warehouse/receive', guard('inventory.adjust'), wrap((req) => {
  const branch_id = branch(req);
  const stockType = req.body.stock_type || req.body.item_type;
  return stockType === 'sku' || stockType === 'retail'
    ? Inv.receiveSku(req.body.item_id, parseFloat(req.body.qty), branch_id, req.body)
    : Inv.receiveStock(req.body.item_id, parseFloat(req.body.qty), branch_id, req.body);
}));
api.post('/warehouse/issue', guard('inventory.adjust'), wrap((req) => Inv.issueStock(req.body.stock_type || req.body.item_type, req.body.item_id, parseFloat(req.body.qty), branch(req), req.body)));
api.post('/warehouse/transfer', guard('inventory.adjust'), wrap((req) => Inv.transferStock(req.body, branch(req))));
api.post('/warehouse/stocktake', guard('inventory.adjust'), wrap((req) => Inv.applyStocktake(req.body, branch(req))));
api.get('/warehouse/stocktakes', guard('inventory.adjust'), wrap((req) => Inv.listStocktakes(branch(req))));
api.get('/warehouse/documents', wrap((req) => Inv.listDocuments(visibleBranch(req), req.query)));
api.get('/warehouse/documents/:id', wrap((req) => Inv.getDocument(req.params.id, visibleBranch(req))));

// --- Online channels ---
api.post('/online/webhook', wrap((req) => Online.receive(req.body, visibleBranch(req))));
api.get('/online/orders', wrap((req) => Online.listOnline(visibleBranch(req))));
api.get('/online/channels', wrap((req) => Online.listChannels(visibleBranch(req))));
api.post('/online/orders/:id/status', guard('online'), wrap((req) => Online.setStatus(req.params.id, req.body.status, branch(req))));

// --- Printing ---
api.get('/print/config', wrap((req) => AppSettings.getPrintConfig(visibleBranch(req))));
api.get('/print/jobs', wrap((req) => Print.listJobs(visibleBranch(req))));
api.post('/print/reprint', wrap(() => notImplemented('Generic print reprint endpoint is planned. Current app uses /api/print/jobs/:id/reprint.')));
api.post('/print/jobs/:id/printed', wrap((req) => Print.markPrinted(req.params.id, visibleBranch(req))));
api.post('/print/jobs/:id/reprint', wrap((req) => Print.reprint(req.params.id, visibleBranch(req))));

// --- MISA e-invoice ---
api.post('/invoices/issue', guard('invoice'), wrap((req) => Invoices.issue(req.body.order_id, req.body.customer, branch(req))));
api.get('/invoices', wrap((req) => Invoices.list(visibleBranch(req))));
api.get('/invoices/order/:id', wrap((req) => Invoices.byOrder(req.params.id)));
api.post('/invoices/:id/cancel', guard('invoice'), wrap((req) => Invoices.cancel(req.params.id, req.body.reason, branch(req))));

// --- Cloud Sync / Offline ---
api.get('/sync/status', wrap((req) => Sync.status(visibleBranch(req))));
api.post('/sync/offline', guard('reports'), wrap((req) => Sync.setOffline(req.body.offline, branch(req))));
api.post('/sync/now', guard('reports'), wrap((req) => Sync.syncNow(branch(req))));

// --- Reports ---
api.get('/dashboard', wrap((req) => Reports.dashboard(visibleBranch(req))));
api.get('/dashboard/trends', wrap((req) => Reports.revenueTrends(visibleBranch(req))));
api.get('/reports/sales', guard('reports'), wrap(() => notImplemented('Sales report endpoint is planned. Current app uses /api/reports/preview?type=sales_overview.')));
api.get('/reports/inventory', guard('reports'), wrap(() => notImplemented('Inventory report endpoint is planned. Current app uses /api/reports/preview with inventory report types.')));
api.get('/reports/payments', guard('reports'), wrap(() => notImplemented('Payments report endpoint is planned. Current app uses dashboard/report center endpoints.')));
api.get('/reports/kds', guard('reports'), wrap(() => notImplemented('KDS timing report endpoint is planned.')));
api.get('/reports/catalog', guard(), wrap((req) => {
  requireReportCenter(req);
  return reportCatalogForUser(req);
}));
api.get('/reports/preview', guard(), wrap((req) => {
  const type = normalizedReportType(req.query.type);
  requireReportType(req, type);
  return ReportCenter.buildReport(type, branch(req), req.query);
}));
api.get('/reports/export', guard(), async (req, res) => {
  try {
    const type = normalizedReportType(req.query.type);
    requireReportType(req, type);
    const report = ReportCenter.buildReport(type, branch(req), req.query);
    const format = String(req.query.format || 'html').toLowerCase();
    if (format === 'json') return res.json(report);
    if (format === 'html') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', `inline; filename="${ReportCenter.reportFilename(report, 'html')}"`);
      return res.send(ReportCenter.renderReportHtml(report, { mode: 'preview' }));
    }
    if (format === 'doc' || format === 'word') {
      const file = ReportCenter.reportFilename(report, 'doc');
      res.setHeader('Content-Type', 'application/msword; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${file}"`);
      return res.send(ReportCenter.renderReportDoc(report));
    }
    if (format === 'xls' || format === 'xlsx' || format === 'sheet') {
      const file = ReportCenter.reportFilename(report, 'xls');
      res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${file}"`);
      return res.send(ReportCenter.renderReportXls(report));
    }
    if (format === 'pdf') {
      const file = ReportCenter.reportFilename(report, 'pdf');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${file}"`);
      return res.send(await ReportCenter.renderReportPdf(report));
    }
    return res.status(400).json({ error: 'Định dạng báo cáo không hợp lệ' });
  } catch (e) {
    return res.status(e.status || 400).json({ error: e.message });
  }
});
api.get('/audit', guard('audit.view'), wrap((req) => Reports.recentAudit(branch(req), parseInt(req.query.limit) || 40, req.query.before || null)));

// --- Permanent archive inspection ---
api.get('/archive/status', guard('reports'), wrap(() => Archive.storageStatus()));
api.get('/archive/reports/latest', guard('reports'), wrap((req) => Archive.latestDashboardReport(branch(req))));
api.get('/archive/:kind/:id', guard('reports'), wrap((req) => Archive.readArchivedEntity(req.params.kind, req.params.id, branch(req))));

// --- Enterprise Storage ---
// Phân tầng: system (toàn hệ thống) | branch (chi nhánh) | user (cá nhân)

// System scope — chỉ owner mới được ghi
api.get('/storage/system', guard(), wrap((req) => {
  if (req.user.role !== 'owner' && !Auth.canUser(req.user, 'settings.manage')) {
    const e = new Error('Chỉ owner mới xem được cấu hình hệ thống'); e.status = 403; throw e;
  }
  return ES.getScopeSnapshot('system', '');
}));
api.get('/storage/system/:key', guard(), wrap((req) => {
  if (req.user.role !== 'owner' && !Auth.canUser(req.user, 'settings.manage')) {
    const e = new Error('Không đủ quyền'); e.status = 403; throw e;
  }
  const val = ES.getStorageValue('system', '', req.params.key);
  return { key: req.params.key, value: val };
}));
api.put('/storage/system/:key', guard(), wrap((req) => {
  if (req.user.role !== 'owner') { const e = new Error('Chỉ owner mới được cập nhật cấu hình hệ thống'); e.status = 403; throw e; }
  return ES.setStorageValue('system', '', req.params.key, req.body.value, req.user.username);
}));
api.delete('/storage/system/:key', guard(), wrap((req) => {
  if (req.user.role !== 'owner') { const e = new Error('Chỉ owner mới được xóa cấu hình hệ thống'); e.status = 403; throw e; }
  return ES.deleteStorageValue('system', '', req.params.key);
}));

// Branch scope — manager+ có thể ghi theo chi nhánh của mình
api.get('/storage/branch', guard(), wrap((req) => ES.getScopeSnapshot('branch', branch(req))));
api.get('/storage/branch/:key', guard(), wrap((req) => {
  const val = ES.getStorageValue('branch', branch(req), req.params.key);
  return { key: req.params.key, value: val };
}));
api.put('/storage/branch/:key', guardAny('settings.manage'), wrap((req) => {
  return ES.setStorageValue('branch', branch(req), req.params.key, req.body.value, req.user.username);
}));
api.delete('/storage/branch/:key', guardAny('settings.manage'), wrap((req) => {
  return ES.deleteStorageValue('branch', branch(req), req.params.key);
}));

// User preferences — mỗi user chỉ đọc/ghi settings của chính mình
api.get('/storage/user/preferences', guard(), wrap((req) => ES.getAllUserPrefs(req.user.id)));
api.get('/storage/user/preferences/:key', guard(), wrap((req) => {
  const val = ES.getUserPref(req.user.id, req.params.key);
  return { key: req.params.key, value: val };
}));
api.put('/storage/user/preferences/:key', guard(), wrap((req) => ES.setUserPref(req.user.id, req.params.key, req.body.value)));
api.post('/storage/user/preferences', guard(), wrap((req) => ES.setManyUserPrefs(req.user.id, req.body)));
api.delete('/storage/user/preferences/:key', guard(), wrap((req) => ES.deleteUserPref(req.user.id, req.params.key)));

// Admin: đọc preferences của user khác (owner/manager)
api.get('/storage/user/:userId/preferences', guardAny('settings.users', 'settings.manage'), wrap((req) => ES.getAllUserPrefs(req.params.userId)));
api.get('/storage/user/:userId/preferences/:key', guardAny('settings.users', 'settings.manage'), wrap((req) => {
  const val = ES.getUserPref(req.params.userId, req.params.key);
  return { key: req.params.key, value: val };
}));
