// REST API: thin HTTP layer over the Local Store Server services.
import { Router, raw } from 'express';
import { db, uid, audit, now, decryptDecompress, listBackups, rehydrateAuditForQuery } from './db.js';
import { logger } from './core/logger.js';
import * as Orders from './services/orders.js';
import * as Inv from './services/inventory.js';
import * as Pay from './services/payments.js';
import * as Reports from './services/reports.js';
import * as Retail from './services/retail.js';
import * as Auth from './services/auth.js';
import * as Print from './services/printing.js';
import * as Online from './services/online.js';
import * as Invoices from './services/invoices.js';
import * as Einvoices from './services/einvoice.js';
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
import * as AppRelease from './services/appRelease.js';
import { logSystem, listSystemLogs, resolveSystemLog } from './services/systemLogs.js';
import { emit, getActiveConnections } from './realtime.js';
import { errorPayload } from './core/errors.js';
import { notImplemented } from './core/http.js';
import fs from 'node:fs';
import nodePath from 'node:path';
import { fileURLToPath } from 'node:url';
const __apiDir = nodePath.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = nodePath.join(__apiDir, 'uploads', 'documents');
const AVATAR_UPLOADS_DIR = nodePath.join(__apiDir, 'uploads', 'avatars');
const MENU_UPLOADS_DIR = nodePath.join(__apiDir, 'uploads', 'menu');
const AVATAR_ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const AVATAR_MAX_BYTES = 20 * 1024 * 1024;

const SECURE_MIME_EXT = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'application/pdf': '.pdf',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'text/csv': '.csv',
  'text/plain': '.txt',
  'application/json': '.json',
};


export const api = Router();

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
const execAsync = promisify(exec);

api.get('/dev/seed', async (req, res) => {
  // Endpoint này exec seed/import GHI ĐÈ dữ liệu thật nên không được phép có
  // secret mặc định trong source: chỉ mở khi admin đặt biến môi trường
  // DEV_SEED_SECRET, và không bao giờ mở trên production.
  const expected = process.env.DEV_SEED_SECRET;
  if (!expected || process.env.NODE_ENV === 'production' || req.query.secret !== expected) {
    return res.status(404).json({ error: 'Not found' });
  }
  try {
    // Chỉ chạy seed demo Node — các script import Python cũ đã bị gỡ khỏi repo.
    const { stdout, stderr } = await execAsync('node server/seed.js');
    return res.json({ ok: true, message: 'Đã nạp dữ liệu demo.', seed: { stdout, stderr } });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

const guard = Auth.requireAuth;

function requireAnyPermission(req, ...perms) {
  const user = req.user;
  if (!user) {
    const e = new Error('Cần đăng nhập');
    e.status = 401;
    throw e;
  }
  if (user.role === 'owner' || Auth.canUser(user, 'settings.manage')) return;
  if (perms.some(p => Auth.canUser(user, p))) return;
  const e = new Error('Không đủ quyền thực hiện thao tác này');
  e.status = 403;
  throw e;
}
function requireContactMutationPermission(req) {
  requireAnyPermission(req, req.body?.id ? 'contacts.edit' : 'contacts.create');
}

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
  const allowed = new Set(Auth.userBranchIds(req.user));
  const branches = Branches.listBranches()
    .filter(b => allowed.has(b.id))
    .map(b => ({ id: b.id, name: b.name, code: b.code || b.id }));
  const enriched = { ...catalog, branches, default_branch_id: branch(req) };
  if (req.user?.role === 'owner' || Auth.canUser(req.user, 'reports')) return enriched;
  const reports = catalog.reports.filter(r => Auth.canUser(req.user, reportPerm(r.key)));
  const groupKeys = new Set(reports.map(r => r.group));
  return {
    ...enriched,
    groups: catalog.groups.filter(g => groupKeys.has(g.key)),
    reports,
  };
}
function reportScopeForUser(req) {
  const allowed = new Set(Auth.userBranchIds(req.user));
  const branches = Branches.listBranches()
    .filter(b => allowed.has(b.id))
    .map(b => ({ id: b.id, name: b.name, code: b.code || b.id }));
  const raw = req.query.branch_ids ?? req.query.branches ?? '';
  let requested = [];
  if (String(raw || '').toLowerCase() === 'all') {
    requested = branches.map(b => b.id);
  } else if (Array.isArray(raw)) {
    requested = raw.flatMap(x => String(x).split(','));
  } else if (String(raw || '').trim()) {
    requested = String(raw).split(',');
  }
  requested = [...new Set(requested.map(x => String(x || '').trim()).filter(Boolean))];
  if (!requested.length) requested = [branch(req)];
  const invalid = requested.filter(id => !allowed.has(id) || !branches.some(b => b.id === id));
  if (invalid.length) throw reportForbidden();
  const selected = branches.filter(b => requested.includes(b.id));
  return { branch_ids: requested, branches: selected, default_branch_id: branch(req) };
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
    // Song song, ghi vào nhật ký HỆ THỐNG hợp nhất (system_logs) với đủ cột
    // endpoint/status/correlation để màn Nhật ký hoạt động lọc & truy vết.
    const path = req?.originalUrl || req?.url || '';
    logSystem({
      level: status >= 500 ? 'error' : 'warn',
      source: 'backend',
      eventType: pickBackendEventType(path, status),
      title: `API ${req?.method || ''} ${path} → ${status}`,
      message: e?.message || 'Request failed',
      username: actor,
      branchId: branch_id,
      endpoint: path,
      method: req?.method,
      statusCode: status,
      requestId: req?.headers?.['x-request-id'],
      correlationId: req?.headers?.['x-correlation-id'],
      exceptionType: e?.code || e?.name || 'Error',
      stackTrace: String(e?.stack || '').split('\n').slice(0, 8).join('\n').trim(),
    });
  } catch { /* logging must never break the request */ }
}

// Phân loại event_type theo route để filter nhanh (thanh toán/in/HĐĐT/sync…).
function pickBackendEventType(path, status) {
  const p = String(path || '');
  if (/\/pay|\/payment|\/payos|\/retail\/checkout|payment-qr/.test(p)) return 'payment_failed';
  if (/\/print/.test(p)) return 'print_failed';
  if (/\/einvoice|\/invoices/.test(p)) return 'einvoice_error';
  if (/\/sync/.test(p)) return 'sync_failed';
  if (/\/app\//.test(p)) return 'update_failed';
  return status >= 500 ? 'backend_exception' : 'api_error';
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
// IP thiết bị cho nhật ký bảo mật (ưu tiên X-Forwarded-For khi sau reverse proxy).
function clientIp(req) {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return (xff || req.socket?.remoteAddress || '').replace('::ffff:', '');
}
api.get('/branches', wrap(() => Branches.listBranches()));
api.post('/login', wrap((req) => Auth.login(req.body.username, req.body.pin, req.body.branch_id || publicBranch(req), { ip: clientIp(req) })));
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
api.get('/settings/permissions', guardAny('settings.perms', 'settings.users'), wrap((req) => {
  // A granter can only see (and thus assign) permissions they personally hold —
  // everything they lack is hidden from the editor. Admin/owner sees the full set.
  const isFull = req.user?.role === 'owner';
  const grantable = Auth.grantablePermSet(req.user);
  const catalog = isFull ? Auth.PERMISSIONS : Auth.PERMISSIONS.filter((p) => grantable.has(p.key));
  return { catalog, roles: Auth.permMatrix(), grantable: [...grantable], is_full: isFull };
}));
api.post('/settings/roles/:role/permissions', guardAny('settings.perms'), wrap((req) => {
  const branch_id = branch(req);
  const pin = req.body?.security_pin;
  if (req.body) delete req.body.security_pin;
  const approvedBy = Auth.verifyManagerOwnerPin(pin, branch_id);
  if (!approvedBy) throw new Error('Cần nhập PIN của Manager hoặc Admin để xác nhận thay đổi phân quyền vai trò.');
  return Auth.setRolePerms(req.params.role, req.body.perms, branch_id, req.user);
}));
api.get('/settings/users', guardAny('settings.users'), wrap((req) => Auth.listAllUsers(branch(req))));
// Lưu ảnh gửi lên dạng base64 (≤20MB, đúng mime ảnh) vào thư mục uploads và trả
// URL công khai. Dùng chung cho avatar nhân viên, ảnh món và avatar đối tác.
function saveBase64Image(req, { dir, urlBase, prefix, auditAction }) {
  const { data, mime_type, original_name } = req.body || {};
  if (!data || !original_name) throw new Error('Thiếu dữ liệu ảnh');
  if (!AVATAR_ALLOWED_MIME.has(mime_type)) throw new Error(`Định dạng ảnh không được hỗ trợ: ${mime_type}`);
  const buf = Buffer.from(String(data), 'base64');
  if (!buf.byteLength) throw new Error('File ảnh rỗng');
  if (buf.byteLength > AVATAR_MAX_BYTES) throw new Error('Ảnh quá lớn, tối đa 20MB');
  const stored = `${uid(prefix)}${SECURE_MIME_EXT[mime_type] || '.jpg'}`;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(nodePath.join(dir, stored), buf);
  const url = `${urlBase}/${stored}`;
  audit(auditAction, { url, original_name, size: buf.byteLength }, branch(req), actor(req));
  return { ok: true, url, size: buf.byteLength };
}
api.post('/settings/users/avatar-upload', guardAny('settings.users'), wrap((req) =>
  saveBase64Image(req, { dir: AVATAR_UPLOADS_DIR, urlBase: '/uploads/avatars', prefix: 'av_', auditAction: 'user.avatar_upload' })));
api.post('/settings/users', guardAny('settings.users'), wrap((req) => {
  const branch_id = branch(req);
  const pin = req.body?.security_pin;
  if (req.body) delete req.body.security_pin;
  const approvedBy = Auth.verifyManagerOwnerPin(pin, branch_id);
  if (!approvedBy) throw new Error('Cần nhập PIN của Manager hoặc Admin để xác nhận tạo tài khoản.');
  return Auth.createUser(scopedUserBody(req), branch_id, req.user);
}));
api.post('/settings/users/:id/update', guardAny('settings.users'), wrap((req) => {
  const branch_id = branch(req);
  const pin = req.body?.security_pin;
  if (req.body) delete req.body.security_pin;
  const approvedBy = Auth.verifyManagerOwnerPin(pin, branch_id);
  if (!approvedBy) throw new Error('Cần nhập PIN của Manager hoặc Admin để xác nhận thay đổi thông tin nhân viên.');
  return Auth.updateUser(req.params.id, scopedUserBody(req), branch_id, req.user);
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
api.post('/settings/users/:id/permissions', guardAny('settings.users', 'settings.perms'), wrap((req) => Auth.setUserPerms(req.params.id, req.body.perms, branch(req), req.user)));
api.get('/settings/branches', guardAny('settings.branches'), wrap(() => Branches.listBranches({ all: true })));
api.post('/settings/branches', guardAny('settings.branches'), wrap((req) => Branches.createBranch(req.body, actor(req))));
api.post('/settings/branches/:id/update', guardAny('settings.branches'), wrap((req) => Branches.updateBranch(req.params.id, req.body, actor(req))));
api.get('/settings/customer-display', wrap((req) => AppSettings.getCustomerDisplayConfig(visibleBranch(req))));
api.get('/settings/app', guardAny('settings.sync', 'settings.operations', 'settings.einvoice', 'settings.print', 'settings.printers', 'settings.devices', 'settings.invoices', 'settings.notification_sound', 'settings.loyalty', 'settings.promotions'), wrap((req) => AppSettings.getSettings(branch(req))));
api.post('/settings/app', guardAny('settings.sync', 'settings.operations', 'settings.einvoice', 'settings.print', 'settings.printers', 'settings.devices', 'settings.invoices', 'settings.notification_sound', 'settings.loyalty', 'settings.promotions'), wrap((req) => {
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
  const saved = AppSettings.updateIntegrations(req.body, branch_id);
  // Vừa bật MISA → phát hành bù toàn bộ HĐ đầu ra đã ghi nhận trong lúc
  // MISA tắt (PENDING_PROVIDER). NĐ 70: không bỏ sót hóa đơn nào.
  if (saved?.channels?.misa?.enabled) {
    try {
      const r = Einvoices.requeuePendingProvider(branch_id, approvedBy.username);
      if (r.requeued > 0) audit('einvoice.backfill_on_enable', { count: r.requeued }, branch_id, approvedBy.username);
    } catch (e) {
      audit('einvoice.backfill_failed', { error: e.message }, branch_id, approvedBy.username);
    }
  }
  return saved;
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
    System.listSystemPrinters({ force, branch: branch(req) }),
    Print.listPrinters(branch(req), { force }).catch(() => []),
  ]);
  return {
    serverIps,
    connections: socketConnections,
    internet: !!internetCheck.ok,
    internetCheck,
    systemPrinters,
    printerStatuses,
    // Local-storage stack summary (mirrors the web "Lưu trữ cục bộ" card).
    storage: {
      database: 'SQLite',
      databaseMode: 'WAL',
      realtime: 'Socket.IO',
      longTerm: 'Permanent JSON',
    },
    // Card-terminal hardware/acquirer options for the "Máy POS thẻ" editor.
    cardTerminalCatalog: {
      models: AppSettings.CARD_TERMINAL_MODELS,
      providers: AppSettings.CARD_TERMINAL_PROVIDERS,
    },
    serverElapsedMs: Date.now() - started,
    checkedAt: new Date().toISOString(),
  };
}));
api.get('/settings/system/printers', guardAny('settings.connections', 'settings.printers', 'settings.print'), wrap(async (req) => ({
  printers: await System.listSystemPrinters({ force: req.query.force === '1', branch: visibleBranch(req) }),
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
// iPad self-order: khách nhập SĐT đầu bữa → tự tạo khách mới nếu chưa có,
// trả về điểm tích lũy + món hay gọi (từ lần ăn thứ 3). Route mở như các
// route iPad khác (thiết bị công cộng đặt tại bàn).
api.post('/self-order/checkin', wrap((req) => Customers.selfOrderCheckin(req.body?.phone, visibleBranch(req))));
api.get('/device/ipad/setup-options', wrap((req) => {
  const b = visibleBranch(req);
  const activePos = getActiveConnections(b).filter(c => c.device === 'pos');
  const printers = Print.listPrinters(b) || [];
  return {
    posDevices: activePos,
    printers: printers
  };
}));

// --- Catalog / Menu ---
api.get('/menu', wrap((req) => Catalog.listMenu({ forCustomer: true, ...req.query })));
api.get('/menu/manage', guard('menu.manage'), wrap((req) => Catalog.listMenu({ forCustomer: false, ...req.query })));

api.post('/menu/image-upload', guard('menu.manage'), wrap((req) =>
  saveBase64Image(req, { dir: MENU_UPLOADS_DIR, urlBase: '/uploads/menu', prefix: 'menu_', auditAction: 'menu.image_upload' })));

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

// --- Tables ---
api.get('/tables', wrap((req) => Orders.listTables(visibleBranch(req))));
api.get('/tables/:id', guardAny('sell', 'pay', 'kds', 'order.view'), wrap((req) => {
  const branch_id = visibleBranch(req);
  return {
    table: Orders.getTableState(req.params.id),
    order: Orders.getOrder(Orders.getOpenOrderForTable(req.params.id, branch_id)?.id),
  };
}));
api.post('/tables/:id/move', guard('table.move'), wrap((req) => Orders.moveTable(req.params.id, req.body.to_table_id, branch(req), actor(req))));
api.post('/tables/:id/merge', guard('table.move'), wrap((req) => Orders.mergeTables(req.params.id, req.body.target_table_id, branch(req), actor(req))));
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
// POST /orders: yêu cầu đăng nhập + quyền 'sell'. Tất cả thiết bị (POS, tablet)
// phải đăng nhập trước khi tạo/thêm món vào đơn hàng.
api.post('/orders', guard('sell'), wrap((req) => Orders.createOrUpdateOrder({ ...req.body, branch_id: visibleBranch(req), actor: actor(req) })));
api.get('/orders', guard('pay'), wrap(() => notImplemented('Order list endpoint is planned. Use /api/orders/history or table-specific order reads in the current app.')));
api.get('/orders/pending-confirmation', guard('sell'), wrap((req) => Orders.listPendingConfirmations(branch(req))));
api.get('/orders/history', guard('pay'), wrap((req) => History.listOrderHistory(branch(req), req.query)));
api.get('/orders/:id/receipt', guard('pay'), wrap((req) => History.orderReceipt(req.params.id, branch(req))));
// Nội dung bill render bằng ĐÚNG engine + mẫu in đã cấu hình — app dùng làm
// preview trong Lịch sử để khớp 100% với tờ in.
api.get('/orders/:id/receipt/text', guard('pay'), wrap((req) => {
  const branch_id = branch(req);
  const receipt = History.orderReceipt(req.params.id, branch_id);
  if (req.query.reprint === '1' || req.query.reprint === 'true') receipt.reprint = true;
  if (!receipt.print_config) receipt.print_config = AppSettings.getPrintConfig(branch_id);
  return { text: Print.renderJobText({ type: 'receipt', payload: receipt }) };
}));
api.post('/orders/:id/receipt/print', guard('pay'), wrap((req) => {
  const branch_id = branch(req);
  // Đơn còn MỞ → đây là lệnh IN TẠM TÍNH: ghi dấu để sơ đồ bàn hiện trạng thái
  // "Đã in tạm tính" (bàn sắp thanh toán). Đơn đã đóng = in lại từ Lịch sử.
  try {
    const o = db.prepare(`SELECT status, table_id FROM orders WHERE id=?`).get(req.params.id);
    if (o?.status === 'open') {
      db.prepare(`UPDATE orders SET prebill_printed_at=? WHERE id=?`).run(now(), req.params.id);
      if (o.table_id) emit('table:updated', Orders.getTableState(o.table_id), branch_id);
    }
  } catch { /* đánh dấu lỗi không được chặn lệnh in */ }
  // In lại từ Lịch sử: đánh dấu reprint để tiêu đề bill là "(IN LẠI)".
  return Print.printReceipt({ ...History.orderReceipt(req.params.id, branch_id), reprint: true }, branch_id);
}));
api.get('/orders/:id', guardAny('sell', 'pay', 'kds', 'order.view'), wrap((req) => Orders.getOrder(req.params.id)));
api.patch('/orders/:id', guard('sell'), wrap(() => notImplemented('Generic order patch is planned. Current app uses action-specific order endpoints.')));
api.post('/orders/:id/confirm', guard('order.confirm'), wrap((req) => Orders.confirmPendingItems(req.params.id, req.body.item_ids, branch(req), actor(req))));
api.post('/orders/:id/reject', guard('order.confirm'), wrap((req) => Orders.rejectPendingItems(req.params.id, req.body.item_ids, req.body.reason, branch(req), actor(req))));
api.post('/orders/:id/split', guard('bill.split'), wrap((req) => Orders.splitOrderItems(req.params.id, req.body.item_ids, branch(req), actor(req))));
api.post('/orders/items/:id/status', guardAny('kds', 'sell'), wrap((req) => {
  // Route được bảo vệ bằng guard kđs|sell. KDS chuyển trạng thái (nhận/làm/xong/giao).
  // HỦY món phải đi qua /orders/items/:id/cancel (có cổng PIN Quản lý) — chặn ở đây để không lách quyền.
  if (String(req.body.status) === 'cancelled') {
    const e = new Error('Hủy món phải dùng chức năng Hủy (cần PIN Quản lý/Admin).');
    e.status = 403; throw e;
  }
  return Orders.setItemStatus(req.params.id, req.body.status, visibleBranch(req), actor(req));
}));
api.post('/orders/items/:id/cancel', wrap((req) => {
  const branch_id = visibleBranch(req);
  const itemId = req.params.id;
  const item = db.prepare(`SELECT * FROM order_items WHERE id=?`).get(itemId);
  if (!item) throw new Error('Món không tồn tại');

  // Phân quyền nhiều cấp (Admin/Owner bỏ qua mọi kiểm tra vì canUser=true):
  //  • pending_confirm (khách chưa gửi)         → tự do, chỉ cần quyền 'sell'.
  //  • đã gửi bếp NHƯNG CHƯA chế biến ('new'/'sent'…) → cần quyền 'void'.
  //  • ĐÃ chế biến (preparing/ready/served)      → cần quyền RIÊNG 'void.made'.
  // Nếu người thao tác không đủ quyền → cho phép người CÓ quyền nhập PIN duyệt.
  const made = ['preparing', 'ready', 'served'].includes(item.status);
  if (item.status !== 'pending_confirm') {
    const needPerm = made ? 'void.made' : 'void';
    const actorOk = Auth.canUser(req.user, needPerm);
    if (!actorOk) {
      const pin = req.body.pin;
      const label = made
        ? 'xóa món ĐÃ chế biến (quyền "void.made")'
        : 'hủy món đã gửi (quyền "void")';
      if (!pin) {
        const e = new Error(`Cần quyền hoặc PIN của người có quyền để ${label}.`);
        e.code = 'PERM_REQUIRED';
        throw e;
      }
      const approver = Auth.verifyPinHasPerm(String(pin), needPerm, branch_id);
      if (!approver) {
        throw new Error(`PIN không đúng hoặc người đó không có quyền ${label}.`);
      }
      audit('order.item.cancel.approved', {
        item: itemId, status: item.status, perm: needPerm,
        approved_by: approver.username || approver.name,
      }, branch_id, actor(req));
    }
  }
  const res = Orders.cancelItem(itemId, req.body.reason || 'Nhân viên hủy', branch_id, actor(req));
  emit('kds:refresh', { station: item.station }, branch_id);
  return res;
}));

api.post('/orders/items/:id/kds-dismiss', guard('kds'), wrap((req) => {
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
// POST /calls và GET /calls: mở cho iPad/khách (không cần đăng nhập) gọi nhân viên.
// POST /calls/:id/resolve: cần quyền 'sell' (nhân viên phục vụ xác nhận đã xử lý).
api.post('/calls', wrap((req) => Orders.createStaffCall(req.body.table_id, req.body.reason, visibleBranch(req))));
api.get('/calls', wrap((req) => Orders.listStaffCalls(visibleBranch(req))));
api.post('/calls/:table_id/resolve', guard('sell'), wrap((req) => { Orders.resolveStaffCall(req.params.table_id, visibleBranch(req)); return { ok: true }; }));

// --- Payments ---
// ── Void Bill (Hủy toàn bộ đơn hàng chưa thanh toán) ────────────────────────
// Luật:
//  • Yêu cầu quyền 'void' (cashier không có void mặc định, chỉ manager/owner).
//  • BẮT BUỘC PIN của Manager hoặc Admin — không thể bypass bằng quyền đơn thuần.
//  • Chỉ áp dụng cho bill chưa thanh toán (status='open'). Bill đã paid → dùng refund.
//  • Ghi audit đầy đủ: ai void, bill nào, lý do gì, ai phê duyệt bằng PIN.
api.post('/orders/:id/void', guard('void'), wrap((req) => {
  const branch_id = branch(req);
  const { pin, reason } = req.body || {};

  // Bắt buộc PIN manager/admin dù actor có quyền 'void'
  if (!pin) {
    const e = new Error('Cần nhập PIN của Quản lý hoặc Admin để hủy bill.');
    e.code = 'PERM_REQUIRED';
    throw e;
  }
  const approvedBy = Auth.verifyManagerOwnerPin(pin, branch_id);
  if (!approvedBy) {
    throw new Error('PIN không đúng hoặc người đó không có quyền Quản lý/Admin.');
  }

  const order = db.prepare(`SELECT * FROM orders WHERE id=? AND branch_id=?`).get(req.params.id, branch_id);
  if (!order) throw new Error('Bill không tồn tại.');
  if (order.status === 'paid') throw new Error('Không thể void bill đã thanh toán. Hãy dùng chức năng Hoàn tiền.');
  if (order.status === 'void') throw new Error('Bill đã được void trước đó.');

  const cleanReason = String(reason || '').trim() || 'Quản lý hủy bill';

  // Cancel toàn bộ món chưa bị hủy
  db.prepare(`UPDATE order_items SET status='cancelled', reject_reason=? WHERE order_id=? AND status!='cancelled'`)
    .run(cleanReason, req.params.id);
  db.prepare(`UPDATE orders SET status='void', subtotal=0, total=0 WHERE id=?`).run(req.params.id);

  // Trả bàn về trống nếu có
  if (order.table_id) {
    db.prepare(`UPDATE tables SET status='free' WHERE id=?`).run(order.table_id);
    Orders.resolveStaffCall(order.table_id, branch_id);
    emit('table:updated', Orders.getTableState(order.table_id), branch_id);
  }

  audit('order.void', {
    order: req.params.id, bill_no: order.bill_no,
    reason: cleanReason, approved_by: approvedBy.username,
  }, branch_id, actor(req));
  emit('order:updated', Orders.getOrder(req.params.id), branch_id);
  emit('stats:dirty', {}, branch_id);
  return { ok: true, order_id: req.params.id, bill_no: order.bill_no, approved_by: approvedBy.name };
}));

// ── Refund FnB (Hoàn tiền đơn FnB đã thanh toán) ────────────────────────────
// Luật:
//  • Yêu cầu quyền 'refund'.
//  • BẮT BUỘC PIN Manager/Admin + lý do hoàn tiền.
//  • Chỉ áp dụng cho bill đã paid (status='paid').
//  • Ghi audit chi tiết và phát sự kiện realtime.
api.post('/orders/:id/refund', guard('refund'), wrap((req) => {
  const branch_id = branch(req);
  const { pin, reason } = req.body || {};

  if (!pin) {
    const e = new Error('Cần nhập PIN của Quản lý hoặc Admin để hoàn tiền.');
    e.code = 'PERM_REQUIRED';
    throw e;
  }
  const approvedBy = Auth.verifyManagerOwnerPin(pin, branch_id);
  if (!approvedBy) throw new Error('PIN không đúng hoặc người đó không có quyền Quản lý/Admin.');

  const order = db.prepare(`SELECT * FROM orders WHERE id=? AND branch_id=?`).get(req.params.id, branch_id);
  if (!order) throw new Error('Bill không tồn tại.');
  if (order.status !== 'paid') throw new Error('Chỉ có thể hoàn tiền cho bill đã thanh toán.');

  const cleanReason = String(reason || '').trim();
  if (!cleanReason) throw new Error('Cần nhập lý do hoàn tiền.');

  // Tạo bản ghi hoàn tiền trong audit (bảng refunds sẽ được thêm qua migration)
  const refundId = uid('ref_');
  try {
    db.prepare(`INSERT INTO refunds (id,order_id,branch_id,reason,approved_by,amount,created_at) VALUES (?,?,?,?,?,?,?)`)
      .run(refundId, req.params.id, branch_id, cleanReason, approvedBy.username, order.total, now());
  } catch {
    // Bảng refunds chưa có → ghi vào audit_log để không mất dữ liệu
  }

  audit('order.refund', {
    refund_id: refundId, order: req.params.id, bill_no: order.bill_no,
    amount: order.total, reason: cleanReason, approved_by: approvedBy.username,
  }, branch_id, actor(req));
  emit('stats:dirty', {}, branch_id);
  return { ok: true, refund_id: refundId, order_id: req.params.id, bill_no: order.bill_no, amount: order.total, approved_by: approvedBy.name };
}));

api.post('/payments', guard('pay'), wrap(() => notImplemented('Generic payment creation is planned. Current app uses /api/orders/:id/pay.')));
api.get('/payments', guard('reports'), wrap(() => notImplemented('Payment list endpoint is planned. Current reports are available through dashboard/report center endpoints.')));
api.post('/orders/:id/request-payment', wrap((req) => { Pay.requestPayment(req.body.table_id, visibleBranch(req)); return { ok: true }; }));
api.post('/tables/:id/request-payment', wrap((req) => { Pay.requestPayment(req.params.id, visibleBranch(req)); return { ok: true }; }));
api.post('/orders/:id/payment-qr', wrap((req) => Pay.generateCustomerPaymentQr(req.params.id, req.body || {}, visibleBranch(req))));
// QR độc lập (Retail: chưa có order khi hiển thị QR) — vẫn theo qrProvider trong Settings.
api.post('/payment-qr', wrap((req) => Pay.buildStandalonePaymentQr(req.body || {}, visibleBranch(req))));
api.post('/orders/:id/customer-qr-pay', wrap((req) => Pay.customerQrPay(req.params.id, req.body || {}, visibleBranch(req))));
// Khách tự phục vụ (iPad) chọn xuất hóa đơn VAT hoặc bán cho người tiêu dùng sau khi thanh toán — route mở, không cần đăng nhập.
api.post('/orders/:id/customer-invoice', wrap((req) => {
  assertBillEditable(req.params.id, req, 'customer_invoice');
  if (req.body) delete req.body.security_pin;
  return Einvoices.customerRequest(req.params.id, req.body || {}, visibleBranch(req));
}));

// E-Invoice compliance endpoints
api.get('/orders/:id/einvoice', guard('pay'), wrap((req) => {
  return Einvoices.getInvoiceByOrder(req.params.id);
}));

api.post('/orders/:id/einvoice/retry', guard('pay'), wrap((req) => {
  const pin = req.body?.security_pin;
  const approvedBy = Auth.verifyManagerOwnerPin(pin, branch(req));
  if (!approvedBy) throw new Error('Cần nhập PIN của Manager hoặc Admin để thực hiện phát hành lại hóa đơn.');
  if (!req.body.e_invoice_id) {
    return Einvoices.createInvoiceRequest(req.params.id, 'NO_BUYER_INFO', {}, branch(req), actor(req));
  }
  return Einvoices.retryInvoice(req.body.e_invoice_id, actor(req));
}));

api.post('/einvoice/:id/sync', guard('pay'), wrap((req) => {
  return Einvoices.syncInvoiceStatus(req.params.id);
}));

api.post('/einvoice/:id/cancel', guard('pay'), wrap((req) => {
  const pin = req.body?.security_pin;
  const approvedBy = Auth.verifyManagerOwnerPin(pin, branch(req));
  if (!approvedBy) throw new Error('Cần nhập PIN của Manager hoặc Admin để hủy hóa đơn.');
  return Einvoices.cancelInvoice(req.params.id, req.body.reason, actor(req));
}));

api.get('/einvoice/reconciliation', guardAny('reports', 'pay'), wrap((req) => {
  return Einvoices.getReconciliation(branch(req), req.query);
}));

api.get('/einvoice/shift-summary', guard('pay'), wrap((req) => {
  return Einvoices.getShiftInvoiceSummary(branch(req), req.query);
}));
// Tra cứu MST công khai cho màn khách (iPad không đăng nhập) — chỉ trả thông tin doanh nghiệp công khai, không lộ khách local.
api.get('/public/tax-lookup/:mst', wrap(async (req) => { const r = await Customers.lookupTaxCode(req.params.mst); const { existed, ...pub } = r; return pub; }));
// Xác nhận thủ công thanh toán chuyển khoản — cho ca "hệ thống không tự khớp
// được": khách quét QR CŨ (client đã reload QR mới), webhook chậm, mất mạng...
// Luật: thu ngân phải nhập PIN của CHÍNH MÌNH (hoặc PIN Admin) + lý do; nếu
// đối chiếu được giao dịch tiền-về 'unmatched' thì gắn bank_tx_id để đóng vòng
// đối soát. Người duyệt + lý do được ghi audit đầy đủ.
function applyManualConfirm(req, lines, branch_id) {
  const flagged = (Array.isArray(lines) ? lines : []).filter(l => l && (l.manual_confirm || l.bank_tx_id));
  if (!flagged.length) return null;
  const pin = req.body?.security_pin;
  if (req.body) delete req.body.security_pin;
  const approver = Auth.verifySelfOrOwnerPin(pin, req.user?.id, branch_id);
  if (!approver) throw new Error('Xác nhận thủ công cần đúng mật khẩu (PIN) của CHÍNH BẠN — hoặc PIN Admin. PIN của người khác không được chấp nhận.');
  const txIds = [];
  for (const l of flagged) {
    const reason = String(l.manual_confirm?.reason || l.manual_reason || '').trim().slice(0, 160);
    const txId = l.bank_tx_id ? String(l.bank_tx_id) : null;
    l.reference = [l.reference, `manual:${approver.username}`, reason].filter(Boolean).join(' | ').slice(0, 120);
    delete l.manual_confirm;
    delete l.manual_reason;
    delete l.bank_tx_id;
    if (txId) txIds.push(txId);
    audit('payment.manual_confirm', {
      method: l.method, amount: l.amount, reason,
      by: approver.username, actor: req.user?.username || '', bank_tx: txId,
    }, branch_id, req.user?.username || '');
  }
  return { approver, txIds };
}

api.post('/orders/:id/pay', guard('pay'), wrap((req) => {
  const branch_id = branch(req);
  // Giảm giá khi thanh toán cần quyền 'discount' (owner luôn được). Chặn thu ngân
  // không có quyền tự ý set discount để hạ tổng bill về 0.
  let discount = req.body.discount;
  if (typeof discount === 'number' && discount > 0) {
    if (!(req.user?.role === 'owner' || Auth.canUser(req.user, 'discount'))) {
      const e = new Error('Bạn không có quyền áp giảm giá khi thanh toán.');
      e.status = 403; throw e;
    }
  } else {
    discount = undefined; // bỏ qua discount âm / không hợp lệ
  }
  const manual = applyManualConfirm(req, req.body.lines, branch_id);
  const receipt = Pay.payOrder(req.params.id, req.body.lines, { discount, customer: req.body.customer || null, invoice_customer: req.body.invoice_customer || null, cashier: req.user?.name || req.user?.username || '' }, branch_id);
  if (manual) for (const tx of manual.txIds) Pay.markBankTxClaimed(tx, req.params.id, manual.approver.username, branch_id);
  if (req.body.customer?.id || req.body.customer?.phone) {
    Customers.recordPurchase(req.body.customer, receipt.total, branch_id, req.params.id);
  } else {
    // Đơn đã gắn khách từ lúc tạo (iPad self-order check-in SĐT) nhưng thu ngân
    // thanh toán không gửi lại customer → vẫn tích điểm từ customer_json của đơn.
    Pay.recordLoyaltyFromOrder(db.prepare(`SELECT id,branch_id,total,customer_json FROM orders WHERE id=?`).get(req.params.id));
  }
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
  // Receipt photo (if any) is filed into the DMS and linked to this entry.
  let document = null;
  try { document = fileCashDrawerReceipt(entry, branch_id, req.user); }
  catch (e) { logRequestError(req, e); }
  emit('shift:updated', { cash_drawer: true, entry }, branch_id);
  emit('cash-drawer:updated', { entry }, branch_id);
  return { entry, document, drawer: CashDrawer.currentDrawer(branch_id) };
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
api.get('/inventory', guard(), wrap((req) => Inv.listInventory(visibleBranch(req), req.query)));
api.post('/inventory', guard('inventory.adjust'), wrap((req) => Inv.createInventoryItem(req.body, branch(req))));
api.post('/inventory/movements', guard('inventory.adjust'), wrap(() => notImplemented('Generic inventory movement endpoint is planned. Current app uses warehouse receive/issue/transfer/stocktake endpoints.')));
api.post('/inventory/:id/update', guard('inventory.adjust'), wrap((req) => Inv.updateInventoryItem(req.params.id, req.body, branch(req))));
api.post('/inventory/:id/delete', guard('inventory.adjust'), wrap((req) => Inv.deleteInventoryItem(req.params.id, branch(req))));
api.post('/inventory/:id/receive', guard('inventory.adjust'), wrap((req) => Inv.receiveStock(req.params.id, parseFloat(req.body.qty), visibleBranch(req), req.body)));
api.post('/inventory/:id/adjust', guard('inventory.adjust'), wrap((req) => Inv.adjustStock(req.params.id, parseFloat(req.body.stock), branch(req), req.body)));

// --- Retail / SKU ---
api.get('/skus', guard(), wrap((req) => Inv.listSkus(visibleBranch(req), req.query)));
api.post('/skus', guard('inventory.adjust'), wrap((req) => Inv.createSku(req.body, branch(req))));
api.post('/skus/:id/update', guard('inventory.adjust'), wrap((req) => Inv.updateSku(req.params.id, req.body, branch(req))));
api.post('/skus/:id/delete', guard('inventory.adjust'), wrap((req) => Inv.deleteSku(req.params.id, branch(req))));
api.get('/skus/barcode/:code', guard(), wrap((req) => {
  const s = Inv.findSkuByBarcode(req.params.code, visibleBranch(req), req.query);
  if (!s) throw new Error('Không tìm thấy mã vạch ' + req.params.code);
  return s;
}));
api.post('/skus/:id/receive', guard('inventory.adjust'), wrap((req) => Inv.receiveSku(req.params.id, parseFloat(req.body.qty), visibleBranch(req), req.body)));
api.post('/skus/:id/adjust', guard('inventory.adjust'), wrap((req) => Inv.adjustSku(req.params.id, parseFloat(req.body.stock), branch(req), req.body)));
api.get('/vouchers', guardAny('discount', 'settings.promotions'), wrap((req) => Vouchers.listVouchers(branch(req))));
api.get('/vouchers/active', wrap((req) => Vouchers.listActiveVouchers(visibleBranch(req))));
// Voucher: chống gian lận giảm giá — người thao tác phải TỰ nhập PIN của CHÍNH
// MÌNH (định danh ai chịu trách nhiệm); PIN mượn của người khác (kể cả Manager)
// bị từ chối. Ngoại lệ duy nhất: PIN Admin/Owner. Người duyệt được ghi audit.
const VOUCHER_PIN_MSG = 'Cần nhập đúng mật khẩu (PIN) của CHÍNH BẠN — hoặc PIN Admin — để thao tác voucher. PIN của người khác không được chấp nhận.';
api.post('/vouchers', guardAny('discount', 'settings.promotions'), wrap((req) => {
  const branch_id = branch(req);
  const pin = req.body?.security_pin;
  if (req.body) delete req.body.security_pin;
  const approvedBy = Auth.verifySelfOrOwnerPin(pin, req.user?.id, branch_id);
  if (!approvedBy) throw new Error(VOUCHER_PIN_MSG);
  audit('voucher.create.approved', { by: approvedBy.username, actor: req.user?.username || '' }, branch_id, req.user?.username || '');
  return Vouchers.createVoucher(req.body, branch_id);
}));
api.post('/vouchers/:id/update', guardAny('discount', 'settings.promotions'), wrap((req) => {
  const branch_id = branch(req);
  const pin = req.body?.security_pin;
  if (req.body) delete req.body.security_pin;
  const approvedBy = Auth.verifySelfOrOwnerPin(pin, req.user?.id, branch_id);
  if (!approvedBy) throw new Error(VOUCHER_PIN_MSG);
  audit('voucher.update.approved', { id: req.params.id, by: approvedBy.username, actor: req.user?.username || '' }, branch_id, req.user?.username || '');
  return Vouchers.updateVoucher(req.params.id, req.body, branch_id);
}));
api.post('/vouchers/:id/toggle', guardAny('discount', 'settings.promotions'), wrap((req) => {
  const branch_id = branch(req);
  const pin = req.body?.security_pin;
  if (req.body) delete req.body.security_pin;
  const approvedBy = Auth.verifySelfOrOwnerPin(pin, req.user?.id, branch_id);
  if (!approvedBy) throw new Error(VOUCHER_PIN_MSG);
  audit('voucher.toggle.approved', { id: req.params.id, active: !!req.body.active, by: approvedBy.username, actor: req.user?.username || '' }, branch_id, req.user?.username || '');
  return Vouchers.toggleVoucher(req.params.id, req.body.active, branch_id);
}));
api.post('/retail/checkout', guard('pay'), wrap((req) => {
  const branch_id = branch(req);
  // Cùng cơ chế xác nhận thủ công như /orders/:id/pay (PIN chính mình + audit).
  const manual = applyManualConfirm(req, req.body?.payments, branch_id);
  const receipt = Retail.checkout({ ...req.body, branch_id, cashier: req.user?.name || req.user?.username || '' });
  if (manual) {
    const orderId = receipt?.order_id || receipt?.id || null;
    for (const tx of manual.txIds) Pay.markBankTxClaimed(tx, orderId, manual.approver.username, branch_id);
  }
  return receipt;
}));

// --- Customers (directory + perks + tax-code lookup) ---
api.get('/customers', guard(), wrap((req) => Customers.listCustomers(branch(req), req.query.q || '')));
api.get('/customers/:id', guard(), wrap((req) => Customers.getCustomer(req.params.id, branch(req))));
api.post('/customers', guard(), wrap((req) => {
  requireContactMutationPermission(req);
  return Customers.upsertCustomer(req.body, branch(req));
}));
api.post('/customers/:id/delete', guardAny('contacts.delete'), wrap((req) => Customers.deleteCustomer(req.params.id, branch(req))));
api.get('/customers/lookup/tax/:mst', guard(), wrap((req) => Customers.lookupTaxCode(req.params.mst)));

// --- Contacts / Partners (Liên hệ: khách hàng + nhà cung cấp dùng chung 1 danh bạ) ---
api.get('/partners', guardAny('module.contacts', 'contacts.create', 'contacts.edit', 'contacts.delete'), wrap((req) => ({
  partners: Customers.listPartners(branch(req), { type: req.query.type || 'all', q: req.query.q || '', includeInactive: req.query.include_inactive === '1' }),
  counts: Customers.partnerCounts(branch(req)),
})));
api.get('/partners/:id', guardAny('module.contacts', 'contacts.create', 'contacts.edit', 'contacts.delete'), wrap((req) => Customers.getCustomer(req.params.id, branch(req))));
api.post('/partners/avatar-upload', guardAny('contacts.create', 'contacts.edit'), wrap((req) =>
  saveBase64Image(req, { dir: AVATAR_UPLOADS_DIR, urlBase: '/uploads/avatars', prefix: 'av_', auditAction: 'partner.avatar_upload' })));
api.post('/partners', guard(), wrap((req) => {
  requireContactMutationPermission(req);
  return Customers.upsertCustomer(req.body, branch(req));
}));
api.post('/partners/:id/delete', guardAny('contacts.delete'), wrap((req) => Customers.deleteCustomer(req.params.id, branch(req))));

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
api.get('/retail/sales', guardAny('pay', 'reports'), wrap((req) => Retail.listRetailSales(visibleBranch(req))));
api.post('/retail/:id/refund', guard('refund'), wrap((req) => {
  assertBillEditable(req.params.id, req, 'refund');
  return Retail.refund(req.params.id, req.body.reason, branch(req));
}));

// --- Warehouse documents / lots / counts ---
api.get('/movements', guardAny('inventory.adjust', 'warehouse.manage', 'reports'), wrap((req) => Inv.listMovements(visibleBranch(req), req.query)));
api.get('/warehouse/lots', guard(), wrap((req) => Inv.listLots(visibleBranch(req), req.query)));
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
api.get('/warehouse/documents', guardAny('inventory.adjust', 'warehouse.manage'), wrap((req) => Inv.listDocuments(visibleBranch(req), req.query)));
api.get('/warehouse/documents/:id', guardAny('inventory.adjust', 'warehouse.manage'), wrap((req) => Inv.getDocument(req.params.id, visibleBranch(req))));

// --- Online channels ---
api.post('/online/webhook', wrap((req) => Online.receive(req.body, visibleBranch(req), req.headers)));
api.get('/online/orders', guard('online'), wrap((req) => Online.listOnline(visibleBranch(req))));
api.get('/online/channels', guardAny('online', 'settings.integrations'), wrap((req) => Online.listChannels(visibleBranch(req))));
api.post('/online/orders/:id/status', guard('online'), wrap((req) => Online.setStatus(req.params.id, req.body.status, branch(req))));
api.post('/online/orders/:id/confirm-payment', guard('online'), wrap((req) => Online.confirmPayment(req.params.id, branch(req))));
api.post('/online/orders/:id/confirm-delivery', guard('online'), wrap((req) => Online.confirmDelivery(req.params.id, branch(req))));
api.post('/online/orders/:id/return', guard('online'), wrap((req) => Online.returnOrder(req.params.id, branch(req))));


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

// --- Hardware Agent (in vật lý + mở két tại cửa hàng khi server ở VPS) ---
// Agent đăng nhập bằng tài khoản có quyền in rồi poll các endpoint dưới đây.
api.get('/agent/print/pending', printGuard, wrap((req) => ({
  jobs: Print.pendingAgentJobs(branch(req), { limit: parseInt(req.query.limit) || 40 }),
  serverTime: Date.now(),
})));
api.get('/agent/print/jobs/:id', printGuard, wrap((req) => {
  const j = Print.agentJob(req.params.id, branch(req));
  if (!j) throw new Error('Job không cần agent in (browser/không tồn tại)');
  return j;
}));
api.post('/agent/print/jobs/:id/result', printGuard, wrap((req) =>
  Print.agentReportResult(req.params.id, branch(req), {
    ok: req.body.ok === true || req.body.ok === 'true',
    error: req.body.error,
  })));
api.post('/agent/printers/report', printGuard, wrap((req) => ({
  ok: true,
  count: System.setAgentPrinters(branch(req), req.body.printers || []).length,
})));

// --- Auto-update: phát hành & phân phối bản cài mới cho thiết bị ---
// Version: PUBLIC (client hỏi trước cả khi đăng nhập). Chỉ lộ số hiệu + ghi chú.
api.get('/app/version', wrap((req) => AppRelease.latestFor(
  String(req.query.platform || 'windows').toLowerCase())));
// Download: PUBLIC — stream file cài đặt (exe/apk) cho client tự cập nhật.
// KHÔNG dùng wrap() vì handler tự pipe vào res (wrap sẽ res.json sau khi đã gửi).
api.get('/app/download/:platform', (req, res) => {
  try {
    const { path: filePath, name } = AppRelease.releaseFilePath(
      String(req.params.platform || '').toLowerCase());
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    fs.createReadStream(filePath).pipe(res);
  } catch (e) {
    logRequestError(req, e);
    res.status(e.status || 400).json(errorPayload(e));
  }
});
// Publish: chỉ Owner/Admin. Nhận binary thô (raw) tới 300MB (đủ cho apk).
api.post('/app/publish',
  guardAny('settings.manage'),
  raw({ type: '*/*', limit: '300mb' }),
  wrap((req) => AppRelease.publishRelease(
    String(req.query.platform || 'windows').toLowerCase(),
    req.body,
    {
      version: req.query.version,
      buildNumber: req.query.build,
      notes: req.query.notes,
      mandatory: req.query.mandatory,
      fileName: req.query.file,
    })));

// --- MISA e-invoice ---
api.post('/invoices/issue', guard('invoice'), wrap((req) => {
  assertBillEditable(req.body.order_id, req, 'invoice_issue');
  const branch_id = branch(req);
  // MỌI bill giờ đều có sẵn bản ghi HĐĐT (tự tạo lúc thanh toán, kể cả khách
  // lẻ). Xuất HĐ công ty từ Lịch sử = NÂNG CẤP người mua trên CÙNG bản ghi
  // (chưa phát hành) — tuyệt đối không sinh hóa đơn thứ 2 cho 1 giao dịch.
  // Đã phát hành → upgradeBuyer tự chặn và hướng dẫn hủy/thay thế.
  const existing = Einvoices.getInvoiceByOrder(req.body.order_id);
  if (existing && existing.invoice_status !== 'CANCELLED') {
    return Einvoices.upgradeBuyer(req.body.order_id, req.body.customer || {}, branch_id, actor(req));
  }
  // Fallback: bill cũ trước khi có hệ HĐĐT tự động.
  return Invoices.issue(req.body.order_id, req.body.customer, branch_id);
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
  return ReportCenter.buildReport(type, reportScopeForUser(req), req.query);
}));
api.get('/reports/export', guard(), async (req, res) => {
  try {
    const type = normalizedReportType(req.query.type);
    requireReportType(req, type);
    const report = ReportCenter.buildReport(type, reportScopeForUser(req), req.query);
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
    if (format === 'xls' || format === 'xlsx' || format === 'sheet' || format === 'gsheet') {
      const file = ReportCenter.reportFilename(report, 'xlsx');
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${file}"`);
      return res.send(await ReportCenter.renderReportXlsx(report));
    }
    if (format === 'pdf') {
      const file = ReportCenter.reportFilename(report, 'pdf');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${file}"`);
      return res.send(await ReportCenter.renderReportPdfKit(report));
    }
    return res.status(400).json({ error: 'Định dạng báo cáo không hợp lệ' });
  } catch (e) {
    return res.status(e.status || 400).json({ error: e.message });
  }
});
// --- Client log sink -------------------------------------------------------
// Gom lỗi runtime từ các app client (Flutter POS/tablet/KDS) về CÙNG dòng log
// của server (stdout → file log do NodeRunner hứng), cạnh request log + audit.
// Throttle thô để một client lỗi lặp vô hạn không spam đầy đĩa.
let _clientLogWindowStart = 0;
let _clientLogCount = 0;
api.post('/client-log', guard(), wrap((req) => {
  const nowMs = Date.now();
  if (nowMs - _clientLogWindowStart > 60_000) { _clientLogWindowStart = nowMs; _clientLogCount = 0; }
  if (++_clientLogCount > 120) return { ok: true, throttled: true };
  const b = req.body || {};
  const entry = {
    user: req.user?.username || '',
    branch: branch(req),
    app: String(b.app || '').slice(0, 40),
    version: String(b.version || '').slice(0, 20),
    screen: String(b.screen || '').slice(0, 120),
    message: String(b.message || '').slice(0, 600),
    stack: String(b.stack || '').slice(0, 4000),
    // Vệt thao tác cuối từ "hộp đen" của app (chạm/API/socket/đổi màn).
    breadcrumbs: String(b.breadcrumbs || '').slice(0, 4000),
  };
  logger.error('client error', entry);
  // kind='crash' = app phát hiện lần chạy trước chết bất thường (crash native).
  // Ghi vào NHẬT KÝ HOẠT ĐỘNG (audit) → nằm trong database gốc + kho lưu bền
  // NDJSON (giữ 36 tháng) — sau này bị lại là có hồ sơ tra cứu ngay trong app.
  if (b.kind === 'crash') {
    audit('client.crash', {
      app: entry.app, version: entry.version, screen: entry.screen,
      message: entry.message,
      last_actions: String(b.stack || '').slice(0, 12000),
    }, entry.branch, entry.user || 'system');
  }
  // Mirror sang nhật ký HỆ THỐNG hợp nhất — kể cả app bản cũ (chưa có
  // SystemLog client) vẫn để lại dấu vết crash/lỗi trong system_logs.
  // App bản mới gửi mirrored=true (đã tự ghi qua POST /system-logs) → bỏ qua
  // để 1 lỗi không thành 2 dòng; riêng crash luôn mirror (BlackBox chỉ đi
  // đường client-log).
  if (b.kind === 'crash' || b.mirrored !== true) {
    logSystem({
      level: b.kind === 'crash' ? 'fatal' : 'error',
      source: 'flutter_app',
      eventType: b.kind === 'crash' ? 'crash' : 'uncaught_exception',
      title: b.kind === 'crash'
        ? 'App thoát bất thường lần chạy trước (nghi crash native)'
        : `Lỗi runtime trên ${entry.screen || 'app'}`,
      message: entry.message,
      username: entry.user,
      branchId: entry.branch,
      appVersion: entry.version,
      screen: entry.screen,
      stackTrace: entry.stack,
      extra: entry.breadcrumbs ? { breadcrumbs: entry.breadcrumbs } : null,
    });
  }
  return { ok: true };
}));

// --- Nhật ký hệ thống hợp nhất (system_logs) --------------------------------
// Nhận log từ app Flutter (POST — 1 entry hoặc batch {entries:[...]}), đọc có
// filter cho màn Nhật ký hoạt động (GET), đánh dấu đã xử lý (resolve).
// Throttle như client-log: 1 client lỗi lặp vô hạn không được spam đầy đĩa.
let _sysLogWindowStart = 0;
let _sysLogCount = 0;
api.post('/system-logs', guard(), wrap((req) => {
  const nowMs = Date.now();
  if (nowMs - _sysLogWindowStart > 60_000) { _sysLogWindowStart = nowMs; _sysLogCount = 0; }
  const raw = Array.isArray(req.body?.entries) ? req.body.entries
    : (req.body && typeof req.body === 'object' ? [req.body] : []);
  const accepted = [];
  for (const entry of raw.slice(0, 50)) {
    if (++_sysLogCount > 300) return { ok: true, throttled: true, accepted: accepted.length };
    if (!entry || typeof entry !== 'object') continue;
    // Server là nguồn sự thật cho user/branch — không tin client tự khai.
    const id = logSystem({
      ...entry,
      username: req.user?.username || entry.username || '',
      userId: req.user?.id || entry.userId || '',
      branchId: branch(req),
    });
    if (id) accepted.push(id);
  }
  return { ok: true, accepted: accepted.length };
}));

api.get('/system-logs', guard('audit.view'), wrap((req) => ({
  logs: listSystemLogs(branch(req), {
    levels: req.query.levels,
    sources: req.query.sources,
    eventTypes: req.query.event_types,
    q: req.query.q,
    from: req.query.from,
    to: req.query.to,
    before: req.query.before,
    limit: req.query.limit,
    unresolvedOnly: req.query.unresolved === '1',
  }),
})));

api.post('/system-logs/:id/resolve', guard('audit.view'), wrap((req) =>
  resolveSystemLog(req.params.id, req.user?.username)));

api.get('/audit', guard('audit.view'), wrap((req) => {
  const branch_id = branch(req);
  // If the requested window reaches into cold (monthly-archived) data, pull those
  // months back into SQLite first so even super-old lookups return fast. They stay
  // hot for 7 days, then the daily job re-compacts them.
  try {
    rehydrateAuditForQuery(branch_id, {
      from: req.query.from || null,
      to: req.query.to || null,
      period: req.query.period || null,
      before: req.query.before || null,
    });
  } catch { /* rehydration is best-effort; hot rows still serve the query */ }
  return Reports.recentAudit(branch_id, parseInt(req.query.limit) || 40, req.query.before || null, req.query.period || null, req.query.search || '', req.query.from || null, req.query.to || null);
}));

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
api.get('/database/status', guardAny('settings.manage'), wrap(async () => {
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
    // Báo cáo TRUNG THỰC: trạng thái sao lưu/đồng bộ phản ánh đúng thực tế hệ thống.
    backups: (() => {
      const list = listBackups();
      return {
        provider: 'local-snapshot',
        retentionDays: parseInt(process.env.BACKUP_RETENTION_DAYS) || 14,
        count: list.length,
        latest: list[0] || null,
        dir: 'backups/',
      };
    })(),
    cloudSync: {
      mode: process.env.DATABASE_PROVIDER === 'postgres' ? 'postgres' : 'local-only',
      offsiteReplication: false,
      pending: pendingSyncCount,
      note: 'Đẩy đồng bộ ngoại vi CHƯA bật. An toàn dữ liệu dựa vào sao lưu local định kỳ (backups/) + nhật ký NDJSON fsync. Hãy copy thư mục backups/ ra ổ ngoài/VPS định kỳ.',
    },
    auditArchive: { durable: true, format: 'ndjson-fsync' },
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

const DATA_URL_EXT = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
  'image/gif': '.gif', 'application/pdf': '.pdf',
};

// When a cash-drawer expense carries a receipt photo (sent as a data URL), also
// file it into the DMS so it appears under Cơ sở dữ liệu → Tài liệu, linked back
// to the drawer entry. Returns the document record, or null when there is no
// (valid) attachment. Never throws to the caller — failures are swallowed so a
// bad photo can't block recording the expense itself.
export function fileCashDrawerReceipt(entry = {}, branch_id = 'br1', user = {}) {
  const raw = String(entry?.invoice_image || '');
  const m = raw.match(/^data:([^;]+);base64,(.+)$/s);
  if (!m) return null;
  const mime_type = m[1].trim().toLowerCase();
  if (!DMS_ALLOWED_MIME.has(mime_type)) return null;
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.byteLength || buf.byteLength > DMS_MAX_BYTES) return null;
  const ext = DATA_URL_EXT[mime_type] || '';
  const stored_name = uid('f_') + ext;
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  fs.writeFileSync(nodePath.join(UPLOADS_DIR, stored_name), buf);
  const label = entry.counterparty || entry.reason || entry.product || 'Chi từ két';
  return saveDocumentRecord({
    branch_id,
    name: `Hóa đơn chi: ${label}`,
    original_name: `chi-tu-ket-${entry.id}${ext}`,
    stored_name,
    mime_type,
    file_size: buf.byteLength,
    category: 'receipt',
    source: 'cash_drawer',
    related_id: entry.id,
    related_type: 'cash_drawer_expense',
    tags: ['chi-từ-két'],
    description: [entry.reason, entry.counterparty, entry.note].filter(Boolean).join(' · '),
    uploaded_by: user?.username || user?.id || 'system',
    uploaded_by_name: user?.name || user?.username || 'Hệ thống',
  });
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

  const ext = SECURE_MIME_EXT[mime_type] || '.bin';
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
  if (!pin || !Auth.verifyManagerOwnerPin(pin, branch_id)) throw new Error('Cần PIN Quản lý hoặc Admin để xóa vĩnh viễn tài liệu.');


  const rec = db.prepare(`SELECT * FROM document_files WHERE id=? AND branch_id=?`).get(req.params.id, branch_id);
  if (!rec) throw new Error('Tài liệu không tồn tại');

  // Delete physical file
  const filePath = nodePath.join(UPLOADS_DIR, rec.stored_name);
  try { fs.unlinkSync(filePath); } catch (_) { /* already gone */ }

  db.prepare(`DELETE FROM document_files WHERE id=?`).run(req.params.id);
  audit('dms.delete', { id: rec.id, name: rec.name, original_name: rec.original_name }, branch_id, actor.username || actor.id);
  return { ok: true };
}));
