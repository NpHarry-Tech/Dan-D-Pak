// REST API: thin HTTP layer over the Local Store Server services.
import { Router } from 'express';
import { db, uid, audit, now, decryptDecompress } from './db.js';
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
import fs from 'node:fs';
import nodePath from 'node:path';
import { fileURLToPath } from 'node:url';
const __apiDir = nodePath.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = nodePath.join(__apiDir, 'uploads', 'documents');

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
  if (body.role === 'owner') throw new Error('Chỉ Admin mới được tạo hoặc cấp vai trò Admin.');
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
// Record any error surfaced to the client into the footprint log so it shows up
// in "Nhật ký hoạt động" with enough context to explain *why* it failed.
// Skips 401 (unauthenticated token challenges) to avoid flooding the log when a
// session simply expires; everything else (validation, permission, conflict,
// server errors) is captured. Never throws — logging must not mask the response.
function logRequestError(req, e) {
  try {
    const status = e?.status || 400;
    if (status === 401) return;
    let branch_id = 'br1';
    try { branch_id = branch(req) || 'br1'; } catch { /* unresolved branch */ }
    const actor = req?.user?.name || req?.user?.username || 'system';
    audit('system.error', {
      message: e?.message || 'Request failed',
      code: e?.code || 'ERROR',
      status,
      method: req?.method,
      path: req?.originalUrl || req?.url,
      details: e?.details,
      stack: String(e?.stack || '').split('\n').slice(0, 5).join('\n').trim(),
    }, branch_id, actor);
  } catch { /* logging must never break the request */ }
}

const wrap = (fn) => (req, res) => {
  try {
    const out = fn(req, res);
    if (out && typeof out.then === 'function') {
      out
        .then(v => res.json(v ?? { ok: true }))
        .catch(e => { logRequestError(req, e); res.status(e.status || 400).json(errorPayload(e)); });
    }
    else res.json(out ?? { ok: true });
  }
  catch (e) { logRequestError(req, e); res.status(e.status || 400).json(errorPayload(e)); }
};

// Cổng khóa bill theo ca cho các thao tác THAY ĐỔI SAU BÁN (đổi trả, xuất/hủy HĐĐT…).
// Ca của bill còn mở → cho qua (quyền thường đã đủ). Ca đã KẾT CA → bắt buộc PIN
// Quản lý/Admin (verifyManagerOwnerPin). Trả về người duyệt (nếu có) để ghi nhật ký.
function assertBillEditable(order_id, req, action = '') {
  const branch_id = branch(req);
  if (History.billShiftStatus(order_id, branch_id) !== 'closed') return null;
  const pin = req.body?.security_pin;
  const approver = Auth.verifyManagerOwnerPin(pin, branch_id);
  if (!approver) {
    const e = new Error('Bill đã KẾT CA — cần PIN Quản lý/Admin để thay đổi.');
    e.code = 'SHIFT_LOCKED'; e.status = 423;
    throw e;
  }
  audit('bill.locked_edit', { action, order_id, approved_by: approver.username }, branch_id, approver.username);
  return approver;
}

// --- Auth ---
api.get('/branches', wrap(() => Branches.listBranches()));
api.post('/login', wrap((req) => Auth.login(req.body.username, req.body.pin, req.body.branch_id || publicBranch(req))));
// Cổng PIN Quản lý/Admin để đổi sang chi nhánh khác (chỉ xác minh, KHÔNG tạo session).
// Phát từ trạng thái đang đăng nhập nên dùng guard(); verifyManagerOwnerPin yêu cầu
// owner/manager có quyền vào chi nhánh đích.
api.post('/auth/verify-branch-switch', guard(), wrap((req) => {
  const target = req.body?.branch_id;
  if (!target) throw new Error('Thiếu chi nhánh đích.');
  const approvedBy = Auth.verifyManagerOwnerPin(req.body?.pin, target);
  if (!approvedBy) throw new Error('Cần PIN Quản lý hoặc Admin (có quyền chi nhánh đích) để đổi chi nhánh.');
  audit('auth.branch_switch', { to: target, approved_by: approvedBy.username }, target, approvedBy.username);
  return { ok: true, approved_by: approvedBy.username };
}));
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
api.post('/settings/roles/:role/permissions', guardAny('settings.perms'), wrap((req) => {
  const branch_id = branch(req);
  const pin = req.body?.security_pin;
  if (req.body) delete req.body.security_pin;
  const approvedBy = Auth.verifyManagerOwnerPin(pin, branch_id);
  if (!approvedBy) throw new Error('Cần nhập PIN của Manager hoặc Admin để xác nhận thay đổi phân quyền vai trò.');
  return Auth.setRolePerms(req.params.role, req.body.perms, branch_id);
}));
api.get('/settings/users', guardAny('settings.users'), wrap((req) => Auth.listAllUsers(branch(req))));
api.post('/settings/users', guardAny('settings.users'), wrap((req) => {
  const branch_id = branch(req);
  const pin = req.body?.security_pin;
  if (req.body) delete req.body.security_pin;
  const approvedBy = Auth.verifyManagerOwnerPin(pin, branch_id);
  if (!approvedBy) throw new Error('Cần nhập PIN của Manager hoặc Admin để xác nhận tạo tài khoản.');
  return Auth.createUser(scopedUserBody(req), branch_id);
}));
api.post('/settings/users/:id/update', guardAny('settings.users'), wrap((req) => {
  const branch_id = branch(req);
  const pin = req.body?.security_pin;
  if (req.body) delete req.body.security_pin;
  const approvedBy = Auth.verifyManagerOwnerPin(pin, branch_id);
  if (!approvedBy) throw new Error('Cần nhập PIN của Manager hoặc Admin để xác nhận thay đổi thông tin nhân viên.');
  return Auth.updateUser(req.params.id, scopedUserBody(req), branch_id);
}));
api.post('/settings/users/:id/delete', guardAny('settings.users'), wrap((req) => {
  const branch_id = branch(req);
  const pin = req.body?.security_pin;
  if (req.body) delete req.body.security_pin;
  const approvedBy = Auth.verifyManagerOwnerPin(pin, branch_id);
  if (!approvedBy) throw new Error('Cần nhập PIN của Manager hoặc Admin để xác nhận xóa nhân viên.');
  return Auth.deleteUser(req.params.id, branch_id);
}));
api.get('/settings/users/:id/permissions', guardAny('settings.users', 'settings.perms'), wrap((req) => Auth.userPermDetails(req.params.id)));
api.post('/settings/users/:id/permissions', guardAny('settings.users', 'settings.perms'), wrap((req) => Auth.setUserPerms(req.params.id, req.body.perms, branch(req))));
api.get('/settings/branches', guardAny('settings.branches'), wrap(() => Branches.listBranches({ all: true })));
api.post('/settings/branches', guardAny('settings.branches'), wrap((req) => Branches.createBranch(req.body, actor(req))));
api.post('/settings/branches/:id/update', guardAny('settings.branches'), wrap((req) => Branches.updateBranch(req.params.id, req.body, actor(req))));
api.get('/settings/app', guardAny('settings.sync', 'settings.operations', 'settings.einvoice', 'settings.print', 'settings.printers', 'settings.devices', 'settings.invoices', 'settings.notification_sound'), wrap((req) => AppSettings.getSettings(branch(req))));
api.post('/settings/app', guardAny('settings.sync', 'settings.operations', 'settings.einvoice', 'settings.print', 'settings.printers', 'settings.devices', 'settings.invoices', 'settings.notification_sound'), wrap((req) => {
  const branch_id = branch(req);
  const pin = req.body?.security_pin || req.body?.manager_pin || req.body?.owner_pin || req.body?.password;

  // POS card reader configuration verification
  if (req.body?.operations_config?.payment?.cardTerminal) {
    const current = AppSettings.getOperationsConfig(branch_id)?.payment?.cardTerminal;
    const next = req.body.operations_config.payment.cardTerminal;
    if (JSON.stringify(next) !== JSON.stringify(current)) {
      const approvedBy = Auth.verifyManagerOwnerPin(pin, branch_id);
      if (!approvedBy) throw new Error('Cần nhập PIN của Manager hoặc Admin để xác nhận thay đổi cấu hình máy POS thẻ.');
    }
  }

  // Printer list configuration verification
  if (req.body?.print_config?.printers) {
    const current = AppSettings.getPrintConfig(branch_id)?.printers;
    const next = req.body.print_config.printers;
    if (JSON.stringify(next) !== JSON.stringify(current)) {
      const approvedBy = Auth.verifyManagerOwnerPin(pin, branch_id);
      if (!approvedBy) throw new Error('Cần nhập PIN của Manager hoặc Admin để xác nhận thay đổi danh mục máy in.');
    }
  }

  // Customer device PIN verification
  if (Object.prototype.hasOwnProperty.call(req.body, 'ipad_staff_pin')) {
    const current = AppSettings.getSettings(branch_id)?.ipad_staff_pin || '0000';
    const next = req.body.ipad_staff_pin;
    if (next !== current) {
      const approvedBy = Auth.verifyManagerOwnerPin(pin, branch_id);
      if (!approvedBy) throw new Error('Cần nhập PIN của Manager hoặc Admin để xác nhận thay đổi mật khẩu thiết bị khách.');
    }
  }

  const shifts = req.body?.operations_config?.shifts;
  if (shifts && Object.prototype.hasOwnProperty.call(shifts, 'defaultDrawerCash')) {
    const current = Math.max(0, parseInt(AppSettings.getOperationsConfig(branch_id)?.shifts?.defaultDrawerCash) || 0);
    const next = Math.max(0, parseInt(shifts.defaultDrawerCash) || 0);
    if (next !== current) {
      const approvedBy = Auth.verifyManagerOwnerPin(pin, branch_id);
      if (!approvedBy) throw new Error('Cần nhập lại mật khẩu/PIN của Manager hoặc Admin để đổi tiền két gốc.');
      audit('settings.drawer_cash.reauth', { from: current, to: next, approved_by: approvedBy.username }, branch_id, approvedBy.username);
    }
  }

  if (req.body) {
    delete req.body.security_pin;
    delete req.body.manager_pin;
    delete req.body.owner_pin;
    delete req.body.password;
  }
  return AppSettings.updateSettings(req.body, branch_id);
}));
api.post('/templates/auto-save', guardAny('settings.print'), wrap((req) => AppSettings.autoSaveTemplate(req.body, branch(req))));
api.get('/settings/integrations', guardAny('settings.integrations'), wrap((req) => AppSettings.getIntegrations(branch(req))));
api.post('/settings/integrations', guardAny('settings.integrations'), wrap((req) => {
  const branch_id = branch(req);
  const pin = req.body?.security_pin;
  if (req.body) delete req.body.security_pin;
  const approvedBy = Auth.verifyManagerOwnerPin(pin, branch_id);
  if (!approvedBy) throw new Error('Cần nhập PIN của Manager hoặc Admin để xác nhận thay đổi cấu hình liên kết đối tác.');
  return AppSettings.updateIntegrations(req.body, branch_id);
}));
// Test a single integration channel. MISA does a real auth call when live;
// delivery channels return the webhook URL to paste into the partner portal.
api.post('/settings/integrations/:channel/test', guardAny('settings.integrations'), wrap(async (req) => {
  const channel = req.params.channel;
  const cfg = req.body?.config || AppSettings.getIntegrations(branch(req)).channels?.[channel];
  if (!cfg) throw new Error('Kênh không hợp lệ hoặc thiếu cấu hình: ' + channel);
  const base = `${req.protocol}://${req.get('host')}`;
  if (channel === 'misa') return { channel, ...(await Misa.testConnection(cfg)) };
  if (channel === 'payos') {
    const payosWebhook = `${base}/api/payos/webhook`;
    if (!cfg.enabled) return { channel, ok: false, mode: 'disabled', message: 'payOS đang tắt. Bật kết nối trước khi kiểm tra.', webhookUrl: payosWebhook };
    const ok = !!(cfg.clientId && cfg.apiKey && cfg.checksumKey);
    return {
      channel, ok, mode: ok ? 'ready' : 'partial', webhookUrl: payosWebhook,
      message: ok
        ? 'Đã đủ Client ID / API Key / Checksum Key. Dán Webhook URL ở trên vào payOS Dashboard → Cấu hình Webhook. Hệ thống đã sẵn sàng tạo link/QR payOS cho từng bill và tự đóng bill khi nhận webhook xác nhận (xác thực HMAC bằng Checksum Key).'
        : 'Thiếu Client ID / API Key / Checksum Key (lấy ở payOS Dashboard → Cài đặt → Thông tin xác thực).',
    };
  }
  if (channel === 'sepay' || channel === 'casso') {
    return { channel, ...Pay.testBankWebhook(channel, cfg, `${base}/api/${channel}/webhook`) };
  }
  // Delivery / website channels: orders arrive at our webhook → Kênh online module.
  if (channel === 'vietqr') return { channel, ...(await Pay.testVietQrConnection(cfg)) };
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
  const force = req.query.force === '1';
  const [internetCheck, systemPrinters, printerStatuses] = await Promise.all([
    System.checkInternet({ force }),
    System.listSystemPrinters({ force }),
    Print.listPrinters(branch(req), { force }).catch(() => []),
  ]);
  return {
    serverIps,
    connections: socketConnections,
    internet: !!internetCheck.ok,
    internetCheck,
    systemPrinters,
    printerStatuses,
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
// Cấu hình âm thanh thông báo cho các màn hình không có quyền Cài đặt (KDS bếp, iPad...).
api.get('/notification-sound', wrap((req) => AppSettings.getNotificationSoundConfig(visibleBranch(req)) || {}));
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
  const pin = req.body?.security_pin;
  if (req.body) delete req.body.security_pin;
  const approvedBy = Auth.verifyManagerOwnerPin(pin, branch_id);
  if (!approvedBy) throw new Error('Cần nhập PIN của Manager hoặc Admin để xác nhận tạo món ăn.');

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
  const pin = req.body?.security_pin;
  if (req.body) delete req.body.security_pin;
  const approvedBy = Auth.verifyManagerOwnerPin(pin, branch_id);
  if (!approvedBy) throw new Error('Cần nhập PIN của Manager hoặc Admin để xác nhận cập nhật món ăn.');

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
api.post('/settings/tables', guardAny('settings.tables'), wrap((req) => {
  const branch_id = branch(req);
  const pin = req.body?.security_pin;
  if (req.body) delete req.body.security_pin;
  const approvedBy = Auth.verifyManagerOwnerPin(pin, branch_id);
  if (!approvedBy) throw new Error('Cần nhập PIN của Manager hoặc Admin để xác nhận thay đổi sơ đồ bàn.');
  return Orders.createTable({ ...req.body, branch_id });
}));
api.post('/settings/tables/:id/update', guardAny('settings.tables'), wrap((req) => {
  const branch_id = branch(req);
  const pin = req.body?.security_pin;
  if (req.body) delete req.body.security_pin;
  const approvedBy = Auth.verifyManagerOwnerPin(pin, branch_id);
  if (!approvedBy) throw new Error('Cần nhập PIN của Manager hoặc Admin để xác nhận thay đổi sơ đồ bàn.');
  return Orders.updateTable(req.params.id, req.body, branch_id);
}));
api.post('/settings/tables/:id/delete', guardAny('settings.tables'), wrap((req) => {
  const branch_id = branch(req);
  const pin = req.body?.security_pin;
  if (req.body) delete req.body.security_pin;
  const approvedBy = Auth.verifyManagerOwnerPin(pin, branch_id);
  if (!approvedBy) throw new Error('Cần nhập PIN của Manager hoặc Admin để xác nhận thay đổi sơ đồ bàn.');
  return Orders.deleteTable(req.params.id, branch_id);
}));

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
    if (!pin) throw new Error('Yêu cầu nhập mã PIN Quản lý/Admin để hủy món đã gửi.');
    const users = db.prepare(`SELECT * FROM users WHERE pin=? AND active=1 AND role IN ('owner','manager')`).all(String(pin));
    const user = users.find(u => Auth.canAccessBranch(u, branch_id));
    if (!user) {
      throw new Error('Mã PIN không đúng hoặc không có quyền Quản lý/Admin.');
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
api.post('/orders/:id/payment-qr', wrap((req) => Pay.generateCustomerPaymentQr(req.params.id, req.body || {}, visibleBranch(req))));
// QR độc lập (Retail: chưa có order khi hiển thị QR) — vẫn theo qrProvider trong Settings.
api.post('/payment-qr', wrap((req) => Pay.buildStandalonePaymentQr(req.body || {}, visibleBranch(req))));
api.post('/orders/:id/customer-qr-pay', wrap((req) => Pay.customerQrPay(req.params.id, req.body || {}, visibleBranch(req))));
// Khách tự phục vụ (iPad) chọn xuất / không xuất hóa đơn VAT sau khi thanh toán — route mở, không cần đăng nhập.
api.post('/orders/:id/customer-invoice', wrap((req) => {
  assertBillEditable(req.params.id, req, 'customer_invoice');
  if (req.body) delete req.body.security_pin;
  return Invoices.customerRequest(req.params.id, req.body || {}, visibleBranch(req));
}));
// Tra cứu MST công khai cho màn khách (iPad không đăng nhập) — chỉ trả thông tin doanh nghiệp công khai, không lộ khách local.
api.get('/public/tax-lookup/:mst', wrap(async (req) => { const r = await Customers.lookupTaxCode(req.params.mst); const { existed, ...pub } = r; return pub; }));
api.post('/orders/:id/pay', guard('pay'), wrap((req) => {
  const branch_id = branch(req);
  const receipt = Pay.payOrder(req.params.id, req.body.lines, { discount: req.body.discount, customer: req.body.customer || null, invoice_customer: req.body.invoice_customer || null, cashier: req.user?.name || req.user?.username || '' }, branch_id);
  if (req.body.customer?.id) Customers.recordPurchase(req.body.customer.id, receipt.total, branch_id, req.params.id);
  return receipt;
}));
// --- Auto-confirm thanh toán: webhook công khai (xác thực bằng key/chữ ký của nhà cung cấp) ---
// Cấu hình kênh đọc ở chi nhánh chính (br1); khớp bill quét xuyên chi nhánh theo nội dung CK.
api.post('/vietqr/webhook', wrap((req) => Pay.handleVietqrWebhook(req.body || {}, req.headers, 'br1')));
api.post('/sepay/webhook', wrap((req) => Pay.handleSepayWebhook(req.body || {}, req.headers, 'br1')));
api.post('/casso/webhook', wrap((req) => Pay.handleCassoWebhook(req.body || {}, req.headers, 'br1')));
api.post('/payos/webhook', wrap((req) => Pay.handlePayosWebhook(req.body || {}, req.headers, 'br1')));
api.get('/payments/bank-transactions', guardAny('reports', 'pay', 'settings.integrations'), wrap((req) => Pay.listBankTransactions(branch(req), req.query)));
// Auto-detect payOS: hỏi trạng thái đơn (poll) — chạy được cả ở localhost.
api.get('/payos/payment-status/:orderCode', wrap((req) => Pay.getPayosPaymentStatus(req.params.orderCode, visibleBranch(req))));
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
  if (!approvedBy) throw new Error('Cần nhập mật khẩu/PIN của Thủ kho, Manager hoặc Admin để tạo/cấu hình kho.');
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
// Đặt TRƯỚC '/purchase/:id' để không bị bắt nhầm là id.
api.get('/purchase/last-prices', guard('module.purchase'), wrap((req) => Purchase.lastPurchasePrices(branch(req), { supplier_id: req.query.supplier_id || '', supplier_name: req.query.supplier_name || '' })));
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
api.post('/retail/:id/refund', guard('refund'), wrap((req) => {
  assertBillEditable(req.params.id, req, 'refund');
  return Retail.refund(req.params.id, req.body.reason, branch(req));
}));

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
const printGuard = guardAny('module.printing', 'settings.printers', 'settings.print', 'pay');
api.get('/print/config', printGuard, wrap((req) => AppSettings.getPrintConfig(branch(req))));
api.get('/print/printers', printGuard, wrap((req) => Print.listPrinters(branch(req))));
api.post('/print/printers/:id/test', printGuard, wrap((req) => Print.testPrinter(req.params.id, branch(req))));
api.post('/print/cash-drawer/open', printGuard, wrap((req) => Print.openCashDrawer(branch(req), req.body.printer || req.body.printer_id || '')));
api.get('/print/jobs', printGuard, wrap((req) => Print.listJobs(branch(req), req.query)));
api.get('/print/jobs/:id', printGuard, wrap((req) => Print.getJobForBranch(req.params.id, branch(req))));
api.get('/print/jobs/:id/text', printGuard, wrap((req) => ({ text: Print.renderJobText(Print.getJobForBranch(req.params.id, branch(req)) || {}) })));
api.post('/print/reprint', printGuard, wrap(() => notImplemented('Generic print reprint endpoint is planned. Current app uses /api/print/jobs/:id/reprint.')));
api.post('/print/jobs/:id/print', printGuard, wrap((req) => Print.dispatchJob(req.params.id, branch(req), { force: true })));
api.post('/print/jobs/:id/printed', printGuard, wrap((req) => Print.markPrinted(req.params.id, branch(req), actor(req))));
api.post('/print/jobs/:id/reprint', printGuard, wrap((req) => Print.reprint(req.params.id, branch(req))));

// --- MISA e-invoice ---
api.post('/invoices/issue', guard('invoice'), wrap((req) => {
  assertBillEditable(req.body.order_id, req, 'invoice_issue');
  return Invoices.issue(req.body.order_id, req.body.customer, branch(req));
}));
api.get('/invoices', wrap((req) => Invoices.list(visibleBranch(req))));
api.get('/invoices/order/:id', wrap((req) => Invoices.byOrder(req.params.id)));
api.post('/invoices/:id/cancel', guard('invoice'), wrap((req) => {
  const ord = db.prepare(`SELECT id FROM orders WHERE invoice_id=? AND branch_id=?`).get(req.params.id, branch(req));
  if (ord) assertBillEditable(ord.id, req, 'invoice_cancel');
  return Invoices.cancel(req.params.id, req.body.reason, branch(req));
}));

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
api.get('/audit', guard('audit.view'), wrap((req) => Reports.recentAudit(branch(req), parseInt(req.query.limit) || 40, req.query.before || null, req.query.period || null, req.query.search || '', req.query.from || null, req.query.to || null)));

// --- Permanent archive inspection ---
api.get('/archive/status', guard('reports'), wrap(() => Archive.storageStatus()));
api.get('/archive/reports/latest', guard('reports'), wrap((req) => Archive.latestDashboardReport(branch(req))));
api.get('/archive/:kind/:id', guard('reports'), wrap((req) => Archive.readArchivedEntity(req.params.kind, req.params.id, branch(req))));

// --- Config backup / restore (owner only) ---
api.get('/config/export', guardAny('settings.manage'), wrap(async () => {
  const { exportConfig } = await import('./services/configBackup.js');
  return exportConfig();
}));
api.post('/config/import', guardAny('settings.manage'), wrap(async (req) => {
  const { importConfig } = await import('./services/configBackup.js');
  return importConfig(req.body);
}));

// --- Database Management & Documentation APIs ---

// GET /api/database/status
api.get('/database/status', guardAny('settings.manage'), wrap(async (req) => {
  const fs = await import('node:fs');
  const { DB_PATH } = await import('./db.js');
  
  let dbSize = 0;
  try {
    dbSize = fs.statSync(DB_PATH).size;
  } catch {}

  const configTables = [
    'branches', 'users', 'warehouses', 'categories', 'menu_items',
    'inventory_items', 'skus', 'tables', 'recipes', 'app_settings',
    'role_perms', 'user_perms', 'vouchers'
  ];

  const transactionTables = [
    'orders', 'order_items', 'payments', 'payment_lines', 'shifts',
    'cash_drawer_entries', 'purchase_orders', 'purchase_order_lines',
    'expenses', 'audit_log', 'print_jobs', 'invoices', 'bank_transactions'
  ];

  const configCounts = {};
  for (const table of configTables) {
    try {
      const row = db.prepare(`SELECT COUNT(*) as n FROM ${table}`).get();
      configCounts[table] = row.n;
    } catch {
      configCounts[table] = 0;
    }
  }

  const transactionCounts = {};
  for (const table of transactionTables) {
    try {
      const row = db.prepare(`SELECT COUNT(*) as n FROM ${table}`).get();
      transactionCounts[table] = row.n;
    } catch {
      transactionCounts[table] = 0;
    }
  }

  let sqliteVersion = 'Unknown';
  let journalMode = 'Unknown';
  try {
    sqliteVersion = db.prepare('SELECT sqlite_version() as v').get().v;
    journalMode = db.prepare('PRAGMA journal_mode').get().journal_mode;
  } catch {}

  let pendingSyncCount = 0;
  try {
    const row = db.prepare(`SELECT COUNT(*) as n FROM sync_queue WHERE status = 'pending'`).get();
    pendingSyncCount = row.n;
  } catch {}

  return {
    dbType: 'SQLite (node:sqlite)',
    dbPath: DB_PATH,
    dbSize,
    sqliteVersion,
    journalMode,
    configCounts,
    transactionCounts,
    pendingSyncCount,
    vpsBuffer: {
      status: 'online',
      retentionDays: 7,
      eventCount: pendingSyncCount,
      encrypted: true
    },
    eternalStorage: {
      provider: process.env.DATABASE_PROVIDER || 'sqlite',
      status: process.env.DATABASE_PROVIDER === 'postgres' ? 'connected' : 'local_active',
      replication: 'append-only-ledger'
    }
  };
}));

// POST /api/database/integrity-check
api.post('/database/integrity-check', guardAny('settings.manage'), wrap(async () => {
  let result = 'failed';
  try {
    const row = db.prepare('PRAGMA integrity_check').get();
    result = row.integrity_check || row['integrity_check'] || 'ok';
  } catch (e) {
    result = e.message;
  }
  return { ok: result === 'ok', result };
}));

// POST /api/database/reset-transactions
api.post('/database/reset-transactions', guardAny('settings.manage'), wrap(async (req) => {
  const { pin } = req.body;
  if (!pin) throw new Error('Cần cung cấp mã PIN xác nhận.');
  
  const user = Auth.verifyManagerOwnerPin(pin, branch(req));
  if (!user) {
    throw new Error('Mã PIN không đúng hoặc không có quyền Admin/Manager.');
  }

  const transactionTables = [
    'orders', 'order_items', 'payments', 'payment_lines', 'shifts',
    'cash_drawer_entries', 'cash_drawer_reimbursement_allocations',
    'purchase_orders', 'purchase_order_lines', 'purchase_payments',
    'expenses', 'print_jobs', 'invoices', 'bank_transactions', 'sync_queue',
    'audit_log', 'staff_calls'
  ];

  // node:sqlite (DatabaseSync) không có .transaction() — dùng BEGIN/COMMIT/ROLLBACK.
  db.exec('BEGIN');
  try {
    for (const table of transactionTables) {
      try {
        db.exec(`DELETE FROM ${table}`);
      } catch (e) {
        console.error(`Lỗi khi dọn dẹp bảng ${table}:`, e.message);
      }
    }
    try {
      db.exec(`UPDATE tables SET status = 'free'`);
    } catch {}
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  audit('db.reset_transactions', 'Dọn dẹp toàn bộ dữ liệu giao dịch về trạng thái sạch.', branch(req), user.username);
  
  return { ok: true, message: 'Đã dọn dẹp sạch toàn bộ dữ liệu giao dịch thành công.' };
}));

// POST /api/database/clone-to-staging
api.post('/database/clone-to-staging', guardAny('settings.manage'), wrap(async (req) => {
  const { pin } = req.body;
  if (!pin) throw new Error('Cần cung cấp mã PIN xác nhận.');
  const user = Auth.verifyManagerOwnerPin(pin, branch(req));
  if (!user) {
    throw new Error('Mã PIN không đúng hoặc không có quyền Admin/Manager.');
  }

  const fs = await import('node:fs');
  const path = await import('node:path');
  const { DB_PATH } = await import('./db.js');

  const dir = path.dirname(DB_PATH);
  const stagingPath = path.join(dir, 'store_staging.db');

  try {
    try {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    } catch {}
    fs.copyFileSync(DB_PATH, stagingPath);
  } catch (e) {
    throw new Error(`Không thể nhân bản CSDL: ${e.message}`);
  }

  audit('db.clone_to_staging', 'Nhân bản cơ sở dữ liệu sang môi trường staging.', branch(req), user.username);
  return { ok: true, message: 'Đã nhân bản cơ sở dữ liệu sang môi trường staging thành công.', stagingPath };
}));

// POST /api/database/decrypt-audit
api.post('/database/decrypt-audit', guardAny('settings.manage'), wrap(async (req) => {
  const { id } = req.body;
  if (!id) throw new Error('Cần cung cấp ID audit log.');
  const row = db.prepare(`SELECT detail FROM audit_log WHERE id = ?`).get(id);
  if (!row) throw new Error('Không tìm thấy bản ghi nhật ký hoạt động.');
  const decrypted = decryptDecompress(row.detail);
  return { decrypted };
}));

// GET /api/database/docs
api.get('/database/docs', guardAny('settings.manage'), wrap(async () => {
  return [
    { file: 'README.md', title: 'Tổng quan & Stack dự án' },
    { file: 'docs/ARCHITECTURE.md', title: 'Kiến trúc & Vùng triển khai' },
    { file: 'docs/OFFLINE_FIRST_ARCHITECTURE.md', title: 'Kiến trúc Offline-First' },
    { file: 'docs/COMPANY_DATABASE_MEMORY.md', title: 'Chính sách Bộ nhớ vĩnh viễn' },
    { file: 'docs/VPS_TEMPORARY_BUFFER.md', title: 'Bộ đệm sự kiện tạm thời VPS' },
    { file: 'docs/SYNC_BACK_TO_COMPANY_SERVER.md', title: 'Quy trình Đồng bộ ngược' }
  ];
}));

// GET /api/database/docs/:file
api.get('/database/docs/:file', guardAny('settings.manage'), wrap(async (req) => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  
  const reqFile = req.params.file;
  const whitelist = [
    'README.md',
    'docs/ARCHITECTURE.md',
    'docs/OFFLINE_FIRST_ARCHITECTURE.md',
    'docs/COMPANY_DATABASE_MEMORY.md',
    'docs/VPS_TEMPORARY_BUFFER.md',
    'docs/SYNC_BACK_TO_COMPANY_SERVER.md'
  ];

  if (!whitelist.includes(reqFile)) {
    throw new Error('Tài liệu không nằm trong danh mục cho phép.');
  }

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const ROOT = path.join(__dirname, '..');
  const targetPath = path.resolve(ROOT, reqFile);

  let content = '';
  try {
    content = fs.readFileSync(targetPath, 'utf8');
  } catch (e) {
    throw new Error('Không thể đọc nội dung tài liệu.');
  }

  return { file: reqFile, content };
}));

// ══════════════════════════════════════════════════════════════════════════════
// DMS — Document Management System
// POST /documents/upload     — upload 1 file (base64 trong JSON body)
// GET  /documents/files      — danh sách tài liệu
// GET  /documents/files/:id/download  — tải file
// GET  /documents/files/:id/preview   — preview (ảnh/pdf inline)
// PUT  /documents/files/:id  — cập nhật metadata
// DEL  /documents/files/:id  — xóa (cần PIN)
// ══════════════════════════════════════════════════════════════════════════════

const DMS_ALLOWED_MIME = new Set([
  'image/jpeg','image/png','image/webp','image/gif',
  'application/pdf',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/csv','text/plain','application/json',
]);
const DMS_MAX_BYTES = 25 * 1024 * 1024; // 25 MB

// ── Shared helper — also exported for internal use by other services ────────
export function saveDocumentRecord({ branch_id, name, original_name, stored_name, mime_type, file_size, category = 'other', source = 'manual', related_id = null, related_type = null, tags = [], description = '', uploaded_by = 'system', uploaded_by_name = 'Hệ thống' }) {
  const id = uid('doc_');
  const created_at = now();
  db.prepare(`INSERT INTO document_files (id,branch_id,name,original_name,stored_name,mime_type,file_size,category,source,related_id,related_type,tags_json,description,uploaded_by,uploaded_by_name,is_archived,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?)`)
    .run(id, branch_id, name, original_name, stored_name, mime_type, file_size, category, source, related_id, related_type, JSON.stringify(tags), description, uploaded_by, uploaded_by_name, created_at);
  audit('dms.upload', { id, name, category, source, original_name, file_size }, branch_id, uploaded_by);
  return db.prepare(`SELECT * FROM document_files WHERE id=?`).get(id);
}

// ── Upload ──────────────────────────────────────────────────────────────────
api.post('/documents/upload', wrap(async (req) => {
  const { branch_id, actor } = Auth.requirePermission(req, 'module.documents');
  const { name, category = 'other', source = 'manual', related_id, related_type, tags = [], description = '', data, mime_type, original_name } = req.body;

  if (!data || !original_name) throw new Error('Thiếu dữ liệu file (data, original_name)');
  if (!DMS_ALLOWED_MIME.has(mime_type)) throw new Error(`Định dạng file không được hỗ trợ: ${mime_type}`);

  // data is base64
  const buf = Buffer.from(data, 'base64');
  if (buf.byteLength > DMS_MAX_BYTES) throw new Error(`File quá lớn — tối đa 25MB`);

  const ext = nodePath.extname(original_name) || '';
  const stored_name = uid('f_') + ext;
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  fs.writeFileSync(nodePath.join(UPLOADS_DIR, stored_name), buf);

  const rec = saveDocumentRecord({
    branch_id, name: name || original_name, original_name, stored_name, mime_type, file_size: buf.byteLength,
    category, source, related_id, related_type, tags,
    description, uploaded_by: actor.username || actor.id, uploaded_by_name: actor.name,
  });
  return rec;
}));

// ── List files ───────────────────────────────────────────────────────────────
api.get('/documents/files', wrap(async (req) => {
  const { branch_id } = Auth.requirePermission(req, 'module.documents');
  const { category, source, q, from, to, archived = '0', limit = '100', offset = '0' } = req.query;

  let sql = `SELECT * FROM document_files WHERE branch_id=? AND is_archived=?`;
  const params = [branch_id, archived === '1' ? 1 : 0];

  if (category && category !== 'all') { sql += ` AND category=?`; params.push(category); }
  if (source && source !== 'all')     { sql += ` AND source=?`;   params.push(source); }
  if (from)  { sql += ` AND created_at>=?`; params.push(from); }
  if (to)    { sql += ` AND created_at<=?`; params.push(to + 'T23:59:59'); }
  if (q)     { sql += ` AND (name LIKE ? OR original_name LIKE ? OR description LIKE ?)`; const like = `%${q}%`; params.push(like, like, like); }

  sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  params.push(parseInt(limit), parseInt(offset));

  const rows = db.prepare(sql).all(...params);
  const total = db.prepare(`SELECT COUNT(*) n FROM document_files WHERE branch_id=? AND is_archived=?`).get(branch_id, archived === '1' ? 1 : 0).n;

  return { files: rows.map(r => ({ ...r, tags: JSON.parse(r.tags_json || '[]') })), total };
}));

// ── Download ─────────────────────────────────────────────────────────────────
api.get('/documents/files/:id/download', async (req, res) => {
  try {
    const { branch_id } = Auth.requirePermission(req, 'module.documents');
    const rec = db.prepare(`SELECT * FROM document_files WHERE id=? AND branch_id=?`).get(req.params.id, branch_id);
    if (!rec) return res.status(404).json({ error: 'Tài liệu không tồn tại' });

    const filePath = nodePath.join(UPLOADS_DIR, rec.stored_name);
    if (!fs.existsSync(filePath)) return res.status(410).json({ error: 'File đã bị xóa khỏi ổ đĩa' });

    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(rec.original_name)}"`);
    res.setHeader('Content-Type', rec.mime_type || 'application/octet-stream');
    fs.createReadStream(filePath).pipe(res);
  } catch(e) { logRequestError(req, e); res.status(e.status || 400).json(errorPayload(e)); }
});

// ── Preview (inline) ─────────────────────────────────────────────────────────
api.get('/documents/files/:id/preview', async (req, res) => {
  try {
    const { branch_id } = Auth.requirePermission(req, 'module.documents');
    const rec = db.prepare(`SELECT * FROM document_files WHERE id=? AND branch_id=?`).get(req.params.id, branch_id);
    if (!rec) return res.status(404).json({ error: 'Tài liệu không tồn tại' });

    const filePath = nodePath.join(UPLOADS_DIR, rec.stored_name);
    if (!fs.existsSync(filePath)) return res.status(410).json({ error: 'File đã bị xóa khỏi ổ đĩa' });

    res.setHeader('Content-Type', rec.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(rec.original_name)}"`);
    fs.createReadStream(filePath).pipe(res);
  } catch(e) { logRequestError(req, e); res.status(e.status || 400).json(errorPayload(e)); }
});

// ── Update metadata ───────────────────────────────────────────────────────────
api.put('/documents/files/:id', wrap(async (req) => {
  const { branch_id, actor } = Auth.requirePermission(req, 'module.documents');
  const rec = db.prepare(`SELECT * FROM document_files WHERE id=? AND branch_id=?`).get(req.params.id, branch_id);
  if (!rec) throw new Error('Tài liệu không tồn tại');

  const { name, description, tags, category, is_archived } = req.body;
  db.prepare(`UPDATE document_files SET name=COALESCE(?,name), description=COALESCE(?,description), tags_json=COALESCE(?,tags_json), category=COALESCE(?,category), is_archived=COALESCE(?,is_archived) WHERE id=?`)
    .run(name ?? null, description ?? null, tags ? JSON.stringify(tags) : null, category ?? null, is_archived != null ? (is_archived ? 1 : 0) : null, req.params.id);

  audit('dms.update', { id: req.params.id, name, category }, branch_id, actor.username || actor.id);
  const updated = db.prepare(`SELECT * FROM document_files WHERE id=?`).get(req.params.id);
  return { ...updated, tags: JSON.parse(updated.tags_json || '[]') };
}));

// ── Delete ────────────────────────────────────────────────────────────────────
api.delete('/documents/files/:id', wrap(async (req) => {
  const { branch_id, actor } = Auth.requirePermission(req, 'module.documents');
  // Require Manager/Owner PIN for permanent deletion
  const { pin } = req.body || {};
  if (pin && !Auth.verifyManagerOwnerPin(pin, branch_id)) throw new Error('Cần PIN Quản lý hoặc Admin để xóa vĩnh viễn tài liệu.');

  const rec = db.prepare(`SELECT * FROM document_files WHERE id=? AND branch_id=?`).get(req.params.id, branch_id);
  if (!rec) throw new Error('Tài liệu không tồn tại');

  // Delete physical file
  const filePath = nodePath.join(UPLOADS_DIR, rec.stored_name);
  try { fs.unlinkSync(filePath); } catch (_) { /* already gone */ }

  db.prepare(`DELETE FROM document_files WHERE id=?`).run(req.params.id);
  audit('dms.delete', { id: rec.id, name: rec.name, original_name: rec.original_name }, branch_id, actor.username || actor.id);
  return { ok: true };
}));
