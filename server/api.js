// REST API: thin HTTP layer over the Local Store Server services.
import { Router } from 'express';
import { db, uid, audit, now, decryptDecompress, listBackups } from './db.js';
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
import { runtimePaths } from './config/paths.js';
import fs from 'node:fs';
import nodePath from 'node:path';
const UPLOADS_DIR = runtimePaths.uploads;

export const api = Router();
const guard = Auth.requireAuth;

const guardAny = (...perms) => (req, res, next) => {
  const user = req.user;
  if (!user) return res.status(401).json({ error: 'Cáº§n Ä‘Äƒng nháº­p' });
  if (user.role === 'owner') return next();
  const hasAccess = perms.some(p => Auth.canUser(user, p)) || Auth.canUser(user, 'settings.manage');
  if (!hasAccess) return res.status(403).json({ error: 'KhÃ´ng Ä‘á»§ quyá»n truy cáº­p cÃ¡c má»¥c nÃ y' });
  next();
};
api.use(Auth.attachUser()); // gáº¯n req.user (náº¿u cÃ³ token) cho má»i route, ká»ƒ cáº£ route khÃ´ng báº¯t buá»™c Ä‘Äƒng nháº­p
const actor = Auth.actorName; // ngÆ°á»i phá»¥ trÃ¡ch thao tÃ¡c cho nháº­t kÃ½ hoáº¡t Ä‘á»™ng
const branch = (req) => Auth.resolveBranch(req);
const publicBranch = (req) => Auth.publicBranch(req);
const visibleBranch = (req) => req.user ? branch(req) : publicBranch(req);
function requestedBranchIds(req) {
  const allowed = new Set(Auth.userBranchIds(req.user));
  const raw = String(req.query.branch_ids || req.query.branches || req.query.branch_id || '').trim();
  if (!raw || raw === 'all' || raw === '*') return [...allowed];
  const ids = [...new Set(raw.split(',').map(x => x.trim()).filter(Boolean))];
  const out = ids.filter(id => allowed.has(id));
  if (!out.length) {
    const e = new Error('Khong co quyen xem cac chi nhanh da chon.');
    e.status = 403;
    throw e;
  }
  return out;
}
function scopedUserBody(req) {
  const body = { ...(req.body || {}) };
  if (req.user?.role === 'owner') return body;
  if (body.role === 'owner') throw new Error('Chá»‰ Admin má»›i Ä‘Æ°á»£c táº¡o hoáº·c cáº¥p vai trÃ² Admin.');
  const allowed = new Set(Auth.userBranchIds(req.user));
  const requested = Array.isArray(body.branch_access || body.branch_ids || body.branchAccess)
    ? (body.branch_access || body.branch_ids || body.branchAccess)
    : [];
  body.branch_access = requested.filter(id => allowed.has(String(id)));
  if (!allowed.has(String(body.branch_id || ''))) body.branch_id = branch(req);
  return body;
}
function customerWriteBranch(req) {
  const allowed = Auth.userBranchIds(req.user);
  if (req.body?.id) {
    const existing = Customers.getCustomerInBranches(req.body.id, allowed);
    if (existing) return existing.branch_id;
  }
  const requested = String(req.body?.branch_id || '').trim();
  if (requested && allowed.includes(requested)) return requested;
  return branch(req);
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
  const e = new Error('KhÃ´ng Ä‘á»§ quyá»n xem bÃ¡o cÃ¡o nÃ y.');
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
function htmlEsc(value) {
  return String(value ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function branchAggregateHtml(data = {}) {
  const rows = data.branches || [];
  return `<!doctype html><html><head><meta charset="utf-8"><title>Branch Summary</title>
  <style>body{font-family:Arial,sans-serif;padding:18px;color:#172033}table{border-collapse:collapse;width:100%}th,td{border:1px solid #d9dee7;padding:7px 8px;text-align:left}th{background:#eef2f7}.r{text-align:right}</style></head><body>
  <h2>Branch Summary</h2>
  <p>Total branches: ${data.branch_count || rows.length} | Revenue: ${Number(data.totals?.revenue || 0).toLocaleString('vi-VN')}</p>
  <table><thead><tr><th>Branch</th><th>Code</th><th class="r">Revenue</th><th class="r">Bills</th><th class="r">Open</th><th class="r">Pending</th><th class="r">KDS</th><th class="r">Low stock</th></tr></thead>
  <tbody>${rows.map(b => `<tr><td>${htmlEsc(b.branch?.name || b.branch_id)}</td><td>${htmlEsc(b.branch?.code || b.branch_id)}</td><td class="r">${Number(b.revenue || 0).toLocaleString('vi-VN')}</td><td class="r">${b.bills || 0}</td><td class="r">${b.openOrders || 0}</td><td class="r">${b.pendingConfirm || 0}</td><td class="r">${b.kdsActive || 0}</td><td class="r">${b.lowStock || 0}</td></tr>`).join('')}</tbody></table>
  </body></html>`;
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
// in "Nháº­t kÃ½ hoáº¡t Ä‘á»™ng" with enough context to explain *why* it failed.
// Skips 401 (unauthenticated token challenges) to avoid flooding the log when a
// session simply expires; everything else (validation, permission, conflict,
// server errors) is captured. Never throws â€” logging must not mask the response.
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

// Cá»•ng khÃ³a bill theo ca cho cÃ¡c thao tÃ¡c THAY Äá»”I SAU BÃN (Ä‘á»•i tráº£, xuáº¥t/há»§y HÄÄTâ€¦).
// Ca cá»§a bill cÃ²n má»Ÿ â†’ cho qua (quyá»n thÆ°á»ng Ä‘Ã£ Ä‘á»§). Ca Ä‘Ã£ Káº¾T CA â†’ báº¯t buá»™c PIN
// Quáº£n lÃ½/Admin (verifyManagerOwnerPin). Tráº£ vá» ngÆ°á»i duyá»‡t (náº¿u cÃ³) Ä‘á»ƒ ghi nháº­t kÃ½.
function assertBillEditable(order_id, req, action = '') {
  const branch_id = branch(req);
  if (History.billShiftStatus(order_id, branch_id) !== 'closed') return null;
  const pin = req.body?.security_pin;
  const approver = Auth.verifyManagerOwnerPin(pin, branch_id);
  if (!approver) {
    const e = new Error('Bill Ä‘Ã£ Káº¾T CA â€” cáº§n PIN Quáº£n lÃ½/Admin Ä‘á»ƒ thay Ä‘á»•i.');
    e.code = 'SHIFT_LOCKED'; e.status = 423;
    throw e;
  }
  audit('bill.locked_edit', { action, order_id, approved_by: approver.username }, branch_id, approver.username);
  return approver;
}

// --- Auth ---
// IP thiáº¿t bá»‹ cho nháº­t kÃ½ báº£o máº­t (Æ°u tiÃªn X-Forwarded-For khi sau reverse proxy).
function clientIp(req) {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return (xff || req.socket?.remoteAddress || '').replace('::ffff:', '');
}

const rateBuckets = new Map();
function rateLimit({ windowMs = 60000, max = 600, scope = 'api' } = {}) {
  return (req, res, next) => {
    const key = `${scope}:${clientIp(req)}`;
    const nowMs = Date.now();
    const cur = rateBuckets.get(key);
    if (!cur || cur.resetAt <= nowMs) {
      rateBuckets.set(key, { count: 1, resetAt: nowMs + windowMs });
      return next();
    }
    cur.count += 1;
    if (cur.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((cur.resetAt - nowMs) / 1000)));
      return res.status(429).json({ ok: false, code: 'RATE_LIMITED', message: 'Qua nhieu yeu cau. Thu lai sau.' });
    }
    return next();
  };
}
setInterval(() => {
  const nowMs = Date.now();
  for (const [key, bucket] of rateBuckets) if (bucket.resetAt <= nowMs) rateBuckets.delete(key);
}, 60000).unref();

const apiWideLimit = rateLimit({ scope: 'api', max: 1800, windowMs: 60000 });
const loginLimit = rateLimit({ scope: 'login', max: 30, windowMs: 60000 });
const publicWriteLimit = rateLimit({ scope: 'public-write', max: 180, windowMs: 60000 });
const inventoryReadGuard = guardAny(
  'sell',
  'pay',
  'menu.manage',
  'inventory.adjust',
  'warehouse.manage',
  'module.inventory',
  'module.warehouse',
  'module.retail',
  'module.purchase',
  'reports',
);
const onlineReadGuard = guardAny('online', 'module.online', 'reports');
const retailReadGuard = guardAny('module.retail', 'pay', 'refund', 'reports');
const menuReadGuard = guardAny('sell', 'pay', 'kds', 'menu.manage', 'module.pos', 'module.kds', 'module.retail');
const floorReadGuard = guardAny('sell', 'pay', 'kds', 'module.pos', 'module.kds');
const operationsConfigGuard = guardAny('sell', 'pay', 'settings.operations', 'settings.print', 'settings.printers');

function orderPayloadForRequest(req) {
  const body = { ...(req.body || {}) };
  if (!req.user) {
    body.source = 'customer_ipad';
    body.require_confirm = true;
  }
  return { ...body, branch_id: branch(req), actor: actor(req) };
}

api.use(apiWideLimit);
api.get('/branches', wrap(() => Branches.listBranches()));
api.post('/login', loginLimit, wrap((req) => Auth.login(req.body.username, req.body.pin, req.body.branch_id || publicBranch(req), { ip: clientIp(req) })));
// Cá»•ng PIN Quáº£n lÃ½/Admin Ä‘á»ƒ Ä‘á»•i sang chi nhÃ¡nh khÃ¡c (chá»‰ xÃ¡c minh, KHÃ”NG táº¡o session).
// PhÃ¡t tá»« tráº¡ng thÃ¡i Ä‘ang Ä‘Äƒng nháº­p nÃªn dÃ¹ng guard(); verifyManagerOwnerPin yÃªu cáº§u
// owner/manager cÃ³ quyá»n vÃ o chi nhÃ¡nh Ä‘Ã­ch.
api.post('/auth/verify-branch-switch', guard(), wrap((req) => {
  const target = req.body?.branch_id;
  if (!target) throw new Error('Thiáº¿u chi nhÃ¡nh Ä‘Ã­ch.');
  const approvedBy = Auth.verifyManagerOwnerPin(req.body?.pin, target);
  if (!approvedBy) throw new Error('Cáº§n PIN Quáº£n lÃ½ hoáº·c Admin (cÃ³ quyá»n chi nhÃ¡nh Ä‘Ã­ch) Ä‘á»ƒ Ä‘á»•i chi nhÃ¡nh.');
  audit('auth.branch_switch', { to: target, approved_by: approvedBy.username }, target, approvedBy.username);
  return { ok: true, approved_by: approvedBy.username };
}));
api.post('/logout', guard(), wrap((req) => {
  Auth.logout((req.headers.authorization || '').slice(7) || req.headers['x-auth-token']);
  return { ok: true };
}));
api.get('/me', guard(), wrap((req) => ({ ...req.user, perms: Auth.effectivePermsForUser(req.user.id) })));
api.post('/me/lang', guard(), wrap((req) => Auth.updateOwnLang(req.user.id, req.body.lang, branch(req))));
api.get('/users', guard(), wrap((req) => Auth.listUsers(branch(req), { loginPublic: false })));
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
  if (!approvedBy) throw new Error('Cáº§n nháº­p PIN cá»§a Manager hoáº·c Admin Ä‘á»ƒ xÃ¡c nháº­n thay Ä‘á»•i phÃ¢n quyá»n vai trÃ².');
  return Auth.setRolePerms(req.params.role, req.body.perms, branch_id);
}));
api.get('/settings/users', guardAny('settings.users'), wrap((req) => Auth.listAllUsers(branch(req))));
api.post('/settings/users', guardAny('settings.users'), wrap((req) => {
  const branch_id = branch(req);
  const pin = req.body?.security_pin;
  if (req.body) delete req.body.security_pin;
  const approvedBy = Auth.verifyManagerOwnerPin(pin, branch_id);
  if (!approvedBy) throw new Error('Cáº§n nháº­p PIN cá»§a Manager hoáº·c Admin Ä‘á»ƒ xÃ¡c nháº­n táº¡o tÃ i khoáº£n.');
  return Auth.createUser(scopedUserBody(req), branch_id);
}));
api.post('/settings/users/:id/update', guardAny('settings.users'), wrap((req) => {
  const branch_id = branch(req);
  const pin = req.body?.security_pin;
  if (req.body) delete req.body.security_pin;
  const approvedBy = Auth.verifyManagerOwnerPin(pin, branch_id);
  if (!approvedBy) throw new Error('Cáº§n nháº­p PIN cá»§a Manager hoáº·c Admin Ä‘á»ƒ xÃ¡c nháº­n thay Ä‘á»•i thÃ´ng tin nhÃ¢n viÃªn.');
  return Auth.updateUser(req.params.id, scopedUserBody(req), branch_id);
}));
api.post('/settings/users/:id/delete', guardAny('settings.users'), wrap((req) => {
  const branch_id = branch(req);
  const pin = req.body?.security_pin;
  if (req.body) delete req.body.security_pin;
  const approvedBy = Auth.verifyManagerOwnerPin(pin, branch_id);
  if (!approvedBy) throw new Error('Cáº§n nháº­p PIN cá»§a Manager hoáº·c Admin Ä‘á»ƒ xÃ¡c nháº­n xÃ³a nhÃ¢n viÃªn.');
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
      if (!approvedBy) throw new Error('Cáº§n nháº­p PIN cá»§a Manager hoáº·c Admin Ä‘á»ƒ xÃ¡c nháº­n thay Ä‘á»•i cáº¥u hÃ¬nh mÃ¡y POS tháº».');
    }
  }

  // Printer list configuration verification
  if (req.body?.print_config?.printers) {
    const current = AppSettings.getPrintConfig(branch_id)?.printers;
    const next = req.body.print_config.printers;
    if (JSON.stringify(next) !== JSON.stringify(current)) {
      const approvedBy = Auth.verifyManagerOwnerPin(pin, branch_id);
      if (!approvedBy) throw new Error('Cáº§n nháº­p PIN cá»§a Manager hoáº·c Admin Ä‘á»ƒ xÃ¡c nháº­n thay Ä‘á»•i danh má»¥c mÃ¡y in.');
    }
  }

  // Customer device PIN verification
  if (Object.prototype.hasOwnProperty.call(req.body, 'ipad_staff_pin')) {
    const current = AppSettings.getSettings(branch_id)?.ipad_staff_pin || '0000';
    const next = req.body.ipad_staff_pin;
    if (next !== current) {
      const approvedBy = Auth.verifyManagerOwnerPin(pin, branch_id);
      if (!approvedBy) throw new Error('Cáº§n nháº­p PIN cá»§a Manager hoáº·c Admin Ä‘á»ƒ xÃ¡c nháº­n thay Ä‘á»•i máº­t kháº©u thiáº¿t bá»‹ khÃ¡ch.');
    }
  }

  const shifts = req.body?.operations_config?.shifts;
  if (shifts && Object.prototype.hasOwnProperty.call(shifts, 'defaultDrawerCash')) {
    const current = Math.max(0, parseInt(AppSettings.getOperationsConfig(branch_id)?.shifts?.defaultDrawerCash) || 0);
    const next = Math.max(0, parseInt(shifts.defaultDrawerCash) || 0);
    if (next !== current) {
      const approvedBy = Auth.verifyManagerOwnerPin(pin, branch_id);
      if (!approvedBy) throw new Error('Cáº§n nháº­p láº¡i máº­t kháº©u/PIN cá»§a Manager hoáº·c Admin Ä‘á»ƒ Ä‘á»•i tiá»n kÃ©t gá»‘c.');
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
  if (!approvedBy) throw new Error('Cáº§n nháº­p PIN cá»§a Manager hoáº·c Admin Ä‘á»ƒ xÃ¡c nháº­n thay Ä‘á»•i cáº¥u hÃ¬nh liÃªn káº¿t Ä‘á»‘i tÃ¡c.');
  return AppSettings.updateIntegrations(req.body, branch_id);
}));
// Test a single integration channel. MISA does a real auth call when live;
// delivery channels return the webhook URL to paste into the partner portal.
api.post('/settings/integrations/:channel/test', guardAny('settings.integrations'), wrap(async (req) => {
  const channel = req.params.channel;
  const cfg = req.body?.config || AppSettings.getIntegrations(branch(req)).channels?.[channel];
  if (!cfg) throw new Error('KÃªnh khÃ´ng há»£p lá»‡ hoáº·c thiáº¿u cáº¥u hÃ¬nh: ' + channel);
  const base = `${req.protocol}://${req.get('host')}`;
  if (channel === 'misa') return { channel, ...(await Misa.testConnection(cfg)) };
  if (channel === 'payos') {
    const payosWebhook = `${base}/api/payos/webhook`;
    if (!cfg.enabled) return { channel, ok: false, mode: 'disabled', message: 'payOS Ä‘ang táº¯t. Báº­t káº¿t ná»‘i trÆ°á»›c khi kiá»ƒm tra.', webhookUrl: payosWebhook };
    const ok = !!(cfg.clientId && cfg.apiKey && cfg.checksumKey);
    return {
      channel, ok, mode: ok ? 'ready' : 'partial', webhookUrl: payosWebhook,
      message: ok
        ? 'ÄÃ£ Ä‘á»§ Client ID / API Key / Checksum Key. DÃ¡n Webhook URL á»Ÿ trÃªn vÃ o payOS Dashboard â†’ Cáº¥u hÃ¬nh Webhook. Há»‡ thá»‘ng Ä‘Ã£ sáºµn sÃ ng táº¡o link/QR payOS cho tá»«ng bill vÃ  tá»± Ä‘Ã³ng bill khi nháº­n webhook xÃ¡c nháº­n (xÃ¡c thá»±c HMAC báº±ng Checksum Key).'
        : 'Thiáº¿u Client ID / API Key / Checksum Key (láº¥y á»Ÿ payOS Dashboard â†’ CÃ i Ä‘áº·t â†’ ThÃ´ng tin xÃ¡c thá»±c).',
    };
  }
  if (channel === 'sepay' || channel === 'casso') {
    return { channel, ...Pay.testBankWebhook(channel, cfg, `${base}/api/${channel}/webhook`) };
  }
  // Delivery / website channels: orders arrive at our webhook â†’ KÃªnh online module.
  if (channel === 'vietqr') return { channel, ...(await Pay.testVietQrConnection(cfg)) };
  const webhookUrl = `${base}/api/online/webhook`;
  if (!cfg.enabled) return { channel, ok: false, mode: 'disabled', message: 'KÃªnh Ä‘ang táº¯t. Báº­t Ä‘á»ƒ xuáº¥t hiá»‡n trong module KÃªnh online.', webhookUrl };
  const haveCreds = !!(cfg.clientId && cfg.clientSecret) || !!cfg.apiKey;
  return {
    channel, ok: true, mode: haveCreds ? 'ready' : 'partial', webhookUrl,
    message: haveCreds
      ? `ÄÃ£ báº­t. DÃ¡n Webhook URL nÃ y vÃ o cá»•ng Ä‘á»‘i tÃ¡c Ä‘á»ƒ Ä‘áº©y Ä‘Æ¡n vá» "KÃªnh online". Äáº©y Ä‘Æ¡n realtime cáº§n Ä‘á»‘i tÃ¡c báº­t API cho cá»­a hÃ ng (B2B onboarding).`
      : `ÄÃ£ báº­t nhÆ°ng chÆ°a cÃ³ Client ID/Secret. ÄÆ¡n váº«n nháº­n Ä‘Æ°á»£c qua Webhook URL, nhÆ°ng Ä‘á»“ng bá»™ menu/tá»“n kho 2 chiá»u cáº§n khai bÃ¡o credential tá»« cá»•ng Ä‘á»‘i tÃ¡c.`,
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
api.post('/devices/pair', guardAny('settings.devices', 'settings.connections'), wrap(() => notImplemented()));
api.patch('/devices/:id/approve', guardAny('settings.devices'), wrap(() => notImplemented()));
api.get('/operations/config', operationsConfigGuard, wrap((req) => AppSettings.getOperationsConfig(branch(req))));
// Cáº¥u hÃ¬nh Ã¢m thanh thÃ´ng bÃ¡o cho cÃ¡c mÃ n hÃ¬nh khÃ´ng cÃ³ quyá»n CÃ i Ä‘áº·t (KDS báº¿p, iPad...).
api.get('/notification-sound', guardAny('sell', 'kds', 'settings.notification_sound'), wrap((req) => AppSettings.getNotificationSoundConfig(branch(req)) || {}));

// --- Catalog / Menu ---
api.get('/menu', menuReadGuard, wrap(() => Catalog.listMenu({ forCustomer: true })));
api.get('/menu/manage', guard('menu.manage'), wrap(() => Catalog.listMenu({ forCustomer: false })));

api.post('/menu', guard('menu.manage'), wrap((req) => {
  const branch_id = branch(req);
  const pin = req.body?.security_pin;
  if (req.body) delete req.body.security_pin;
  const approvedBy = Auth.verifyManagerOwnerPin(pin, branch_id);
  if (!approvedBy) throw new Error('Cáº§n nháº­p PIN cá»§a Manager hoáº·c Admin Ä‘á»ƒ xÃ¡c nháº­n táº¡o mÃ³n Äƒn.');

  const b = req.body;
  if (!b.name || !b.category_id) throw new Error('Thiáº¿u tÃªn mÃ³n hoáº·c nhÃ³m');
  const id = uid('m_');
  const sort = (db.prepare(`SELECT COALESCE(MAX(sort),0)+1 n FROM menu_items`).get().n) || 1;
  db.prepare(`INSERT INTO menu_items
    (id,category_id,name,emoji,image,description,price,station,sla_minutes,available,hidden,ingredients_json,allergens_json,schedule_json,modifiers_json,addons_json,sort)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id,
    b.category_id,
    b.name,
    b.emoji || 'ðŸ½ï¸',
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
  if (!approvedBy) throw new Error('Cáº§n nháº­p PIN cá»§a Manager hoáº·c Admin Ä‘á»ƒ xÃ¡c nháº­n cáº­p nháº­t mÃ³n Äƒn.');

  const b = req.body;
  const cur = db.prepare(`SELECT * FROM menu_items WHERE id=?`).get(req.params.id);
  if (!cur) throw new Error('MÃ³n khÃ´ng tá»“n táº¡i');
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
  if (!Auth.verifyManagerOwnerPin(pin, branch_id)) throw new Error('Cáº§n nháº­p PIN cá»§a Manager hoáº·c Admin Ä‘á»ƒ xÃ¡c nháº­n Ä‘á»•i giÃ¡ mÃ³n.');
  const price = parseInt(req.body.price);
  if (!Number.isFinite(price) || price < 0) throw new Error('GiÃ¡ khÃ´ng há»£p lá»‡');
  const cur = db.prepare(`SELECT price FROM menu_items WHERE id=?`).get(req.params.id);
  if (!cur) throw new Error('MÃ³n khÃ´ng tá»“n táº¡i');
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
  if (!approvedBy) throw new Error('Cáº§n nháº­p PIN cá»§a Manager hoáº·c Admin Ä‘á»ƒ xÃ¡c nháº­n xÃ³a mÃ³n Äƒn.');
  const r = Catalog.deleteMenuItem(req.params.id, branch_id);
  emit('menu:updated', { id: req.params.id, deleted: true }, branch_id);
  return r;
}));

// --- Categories ---
api.get('/categories', menuReadGuard, wrap(() => Catalog.listCategories()));
api.post('/categories', guard('menu.manage'), wrap((req) => {
  const b = branch(req);
  const pin = req.body?.security_pin;
  if (req.body) delete req.body.security_pin;
  const approvedBy = Auth.verifyManagerOwnerPin(pin, b);
  if (!approvedBy) throw new Error('Cáº§n nháº­p PIN cá»§a Manager hoáº·c Admin Ä‘á»ƒ xÃ¡c nháº­n táº¡o danh má»¥c.');
  const c = Catalog.createCategory(req.body, b);
  emit('menu:updated', { category: true }, b);
  return c;
}));
api.post('/categories/:id/update', guard('menu.manage'), wrap((req) => {
  const b = branch(req);
  const pin = req.body?.security_pin;
  if (req.body) delete req.body.security_pin;
  const approvedBy = Auth.verifyManagerOwnerPin(pin, b);
  if (!approvedBy) throw new Error('Cáº§n nháº­p PIN cá»§a Manager hoáº·c Admin Ä‘á»ƒ xÃ¡c nháº­n cáº­p nháº­t danh má»¥c.');
  const c = Catalog.updateCategory(req.params.id, req.body, b);
  emit('menu:updated', { category: true }, b);
  return c;
}));
api.post('/categories/:id/delete', guard('menu.manage'), wrap((req) => {
  const b = branch(req);
  const pin = req.body?.security_pin;
  if (req.body) delete req.body.security_pin;
  const approvedBy = Auth.verifyManagerOwnerPin(pin, b);
  if (!approvedBy) throw new Error('Cáº§n nháº­p PIN cá»§a Manager hoáº·c Admin Ä‘á»ƒ xÃ¡c nháº­n xÃ³a danh má»¥c.');
  const r = Catalog.deleteCategory(req.params.id, b);
  emit('menu:updated', { category: true }, b);
  return r;
}));

// --- Tables ---
api.get('/tables', floorReadGuard, wrap((req) => Orders.listTables(branch(req))));
api.get('/zones', floorReadGuard, wrap((req) => Orders.listZones(branch(req))));
api.get('/tables/:id', floorReadGuard, wrap((req) => {
  const branch_id = branch(req);
  return {
    table: Orders.getTableState(req.params.id, branch_id),
    order: Orders.getOrder(Orders.getOpenOrderForTable(req.params.id, branch_id)?.id, branch_id),
  };
}));
api.post('/tables/:id/move', guard('sell'), wrap((req) => Orders.moveTable(req.params.id, req.body.to_table_id, branch(req), actor(req))));
api.post('/tables/:id/merge', guard('sell'), wrap((req) => Orders.mergeTables(req.params.id, req.body.target_table_id, branch(req), actor(req))));
api.post('/settings/tables', guardAny('settings.tables'), wrap((req) => {
  const branch_id = branch(req);
  const pin = req.body?.security_pin;
  if (req.body) delete req.body.security_pin;
  const approvedBy = Auth.verifyManagerOwnerPin(pin, branch_id);
  if (!approvedBy) throw new Error('Cáº§n nháº­p PIN cá»§a Manager hoáº·c Admin Ä‘á»ƒ xÃ¡c nháº­n thay Ä‘á»•i sÆ¡ Ä‘á»“ bÃ n.');
  return Orders.createTable({ ...req.body, branch_id });
}));
api.post('/settings/tables/:id/update', guardAny('settings.tables'), wrap((req) => {
  const branch_id = branch(req);
  const pin = req.body?.security_pin;
  if (req.body) delete req.body.security_pin;
  const approvedBy = Auth.verifyManagerOwnerPin(pin, branch_id);
  if (!approvedBy) throw new Error('Cáº§n nháº­p PIN cá»§a Manager hoáº·c Admin Ä‘á»ƒ xÃ¡c nháº­n thay Ä‘á»•i sÆ¡ Ä‘á»“ bÃ n.');
  return Orders.updateTable(req.params.id, req.body, branch_id);
}));
api.post('/settings/tables/:id/delete', guardAny('settings.tables'), wrap((req) => {
  const branch_id = branch(req);
  const pin = req.body?.security_pin;
  if (req.body) delete req.body.security_pin;
  const approvedBy = Auth.verifyManagerOwnerPin(pin, branch_id);
  if (!approvedBy) throw new Error('Cáº§n nháº­p PIN cá»§a Manager hoáº·c Admin Ä‘á»ƒ xÃ¡c nháº­n thay Ä‘á»•i sÆ¡ Ä‘á»“ bÃ n.');
  return Orders.deleteTable(req.params.id, branch_id);
}));

// --- Orders ---
api.post('/orders', guard('sell'), wrap((req) => Orders.createOrUpdateOrder(orderPayloadForRequest(req))));
api.get('/orders', guard('pay'), wrap(() => notImplemented('Order list endpoint is planned. Use /api/orders/history or table-specific order reads in the current app.')));
api.get('/orders/pending-confirmation', guard('sell'), wrap((req) => Orders.listPendingConfirmations(branch(req))));
api.get('/orders/history', guard('pay'), wrap((req) => History.listOrderHistory(branch(req), req.query)));
api.get('/orders/:id/receipt', guard('pay'), wrap((req) => History.orderReceipt(req.params.id, branch(req))));
api.get('/orders/:id', guardAny('sell', 'pay', 'kds', 'reports'), wrap((req) => Orders.getOrder(req.params.id, branch(req))));
api.patch('/orders/:id', guard('sell'), wrap(() => notImplemented('Generic order patch is planned. Current app uses action-specific order endpoints.')));
api.post('/orders/:id/confirm', guard('sell'), wrap((req) => Orders.confirmPendingItems(req.params.id, req.body.item_ids, branch(req), actor(req))));
api.post('/orders/:id/reject', guard('sell'), wrap((req) => Orders.rejectPendingItems(req.params.id, req.body.item_ids, req.body.reason, branch(req), actor(req))));
api.post('/orders/:id/split', guard('pay'), wrap((req) => Orders.splitOrderItems(req.params.id, req.body.item_ids, branch(req), actor(req))));
api.post('/orders/items/:id/status', guard('kds'), wrap((req) => {
  // Route má»Ÿ cho KDS chuyá»ƒn tráº¡ng thÃ¡i (nháº­n/lÃ m/xong/giao). Há»¦Y mÃ³n pháº£i Ä‘i qua
  // /orders/items/:id/cancel (cÃ³ cá»•ng PIN Quáº£n lÃ½) â€” cháº·n á»Ÿ Ä‘Ã¢y Ä‘á»ƒ khÃ´ng lÃ¡ch quyá»n.
  if (String(req.body.status) === 'cancelled') {
    const e = new Error('Há»§y mÃ³n pháº£i dÃ¹ng chá»©c nÄƒng Há»§y (cáº§n PIN Quáº£n lÃ½/Admin).');
    e.status = 403; throw e;
  }
  return Orders.setItemStatus(req.params.id, req.body.status, branch(req), actor(req));
}));
api.post('/orders/items/:id/cancel', guard('sell'), wrap((req) => {
  const branch_id = branch(req);
  const itemId = req.params.id;
  const item = db.prepare(`SELECT * FROM order_items WHERE id=?`).get(itemId);
  if (!item) throw new Error('MÃ³n khÃ´ng tá»“n táº¡i');

  if (item.status === 'preparing' || item.status === 'ready' || item.status === 'served') {
    throw new Error('Báº¿p Ä‘Ã£ cháº¿ biáº¿n mÃ³n nÃ y, khÃ´ng thá»ƒ há»§y!');
  }

  if (item.status !== 'pending_confirm') {
    const pin = req.body.pin;
    if (!pin) throw new Error('YÃªu cáº§u nháº­p mÃ£ PIN Quáº£n lÃ½/Admin Ä‘á»ƒ há»§y mÃ³n Ä‘Ã£ gá»­i.');
    if (!Auth.verifyManagerOwnerPin(String(pin), branch_id)) {
      throw new Error('MÃ£ PIN khÃ´ng Ä‘Ãºng hoáº·c khÃ´ng cÃ³ quyá»n Quáº£n lÃ½/Admin.');
    }
  }
  const res = Orders.cancelItem(itemId, req.body.reason || 'NhÃ¢n viÃªn há»§y', branch_id, actor(req));
  emit('kds:refresh', { station: item.station }, branch_id);
  return res;
}));

api.post('/orders/items/:id/kds-dismiss', guard('kds'), wrap((req) => {
  const branch_id = branch(req);
  const itemId = req.params.id;
  const item = db.prepare(`SELECT * FROM order_items WHERE id=?`).get(itemId);
  if (!item) throw new Error('MÃ³n khÃ´ng tá»“n táº¡i');
  db.prepare(`UPDATE order_items SET kds_dismissed=1 WHERE id=?`).run(itemId);
  emit('kds:refresh', { station: item.station }, branch_id);
  return { ok: true };
}));

// --- KDS ---
api.get('/kds/tickets', guard('kds'), wrap(() => notImplemented('Generic KDS tickets endpoint is planned. Current app uses /api/kds/:station.')));
api.patch('/kds/tickets/:id', guard('kds'), wrap(() => notImplemented('Generic KDS ticket patch is planned. Current app uses /api/orders/items/:id/status.')));
api.get('/kds/:station', guard('kds'), wrap((req) => Orders.getStationTickets(req.params.station, branch(req))));

// --- Staff calls ---
api.post('/calls', guard('sell'), wrap((req) => Orders.createStaffCall(req.body.table_id, req.body.reason, branch(req))));
api.get('/calls', guard('sell'), wrap((req) => Orders.listStaffCalls(branch(req))));
api.post('/calls/:table_id/resolve', guard('sell'), wrap((req) => { Orders.resolveStaffCall(req.params.table_id, branch(req)); return { ok: true }; }));

// --- Payments ---
api.post('/payments', guard('pay'), wrap(() => notImplemented('Generic payment creation is planned. Current app uses /api/orders/:id/pay.')));
api.get('/payments', guard('reports'), wrap(() => notImplemented('Payment list endpoint is planned. Current reports are available through dashboard/report center endpoints.')));
api.post('/orders/:id/request-payment', guard('pay'), wrap((req) => { Pay.requestPayment(req.body.table_id, branch(req)); return { ok: true }; }));
api.post('/tables/:id/request-payment', guard('pay'), wrap((req) => { Pay.requestPayment(req.params.id, branch(req)); return { ok: true }; }));
api.post('/orders/:id/payment-qr', guard('pay'), wrap((req) => Pay.generateCustomerPaymentQr(req.params.id, req.body || {}, branch(req))));
// QR Ä‘á»™c láº­p (Retail: chÆ°a cÃ³ order khi hiá»ƒn thá»‹ QR) â€” váº«n theo qrProvider trong Settings.
api.post('/payment-qr', guard('pay'), wrap((req) => Pay.buildStandalonePaymentQr(req.body || {}, branch(req))));
api.post('/orders/:id/customer-qr-pay', guard('pay'), wrap((req) => Pay.customerQrPay(req.params.id, req.body || {}, branch(req))));
// Staff cashier invoice request update after payment.
api.post('/orders/:id/customer-invoice', guard('pay'), wrap((req) => {
  assertBillEditable(req.params.id, req, 'customer_invoice');
  if (req.body) delete req.body.security_pin;
  return Invoices.customerRequest(req.params.id, req.body || {}, branch(req));
}));
// Tra cá»©u MST cÃ´ng khai cho mÃ n khÃ¡ch (iPad khÃ´ng Ä‘Äƒng nháº­p) â€” chá»‰ tráº£ thÃ´ng tin doanh nghiá»‡p cÃ´ng khai, khÃ´ng lá»™ khÃ¡ch local.
api.get('/public/tax-lookup/:mst', wrap(async (req) => { const r = await Customers.lookupTaxCode(req.params.mst); const { existed, ...pub } = r; return pub; }));
api.post('/orders/:id/pay', guard('pay'), wrap((req) => {
  const branch_id = branch(req);
  // Giáº£m giÃ¡ khi thanh toÃ¡n cáº§n quyá»n 'discount' (owner luÃ´n Ä‘Æ°á»£c). Cháº·n thu ngÃ¢n
  // khÃ´ng cÃ³ quyá»n tá»± Ã½ set discount Ä‘á»ƒ háº¡ tá»•ng bill vá» 0.
  let discount = req.body.discount;
  if (typeof discount === 'number' && discount > 0) {
    if (!(req.user?.role === 'owner' || Auth.canUser(req.user, 'discount'))) {
      const e = new Error('Báº¡n khÃ´ng cÃ³ quyá»n Ã¡p giáº£m giÃ¡ khi thanh toÃ¡n.');
      e.status = 403; throw e;
    }
  } else {
    discount = undefined; // bá» qua discount Ã¢m / khÃ´ng há»£p lá»‡
  }
  const receipt = Pay.payOrder(req.params.id, req.body.lines, { discount, customer: req.body.customer || null, invoice_customer: req.body.invoice_customer || null, cashier: req.user?.name || req.user?.username || '' }, branch_id);
  if (req.body.customer?.id) Customers.recordPurchase(req.body.customer.id, receipt.total, branch_id, req.params.id);
  return receipt;
}));
// --- Auto-confirm thanh toÃ¡n: webhook cÃ´ng khai (xÃ¡c thá»±c báº±ng key/chá»¯ kÃ½ cá»§a nhÃ  cung cáº¥p) ---
// Cáº¥u hÃ¬nh kÃªnh Ä‘á»c á»Ÿ chi nhÃ¡nh chÃ­nh (br1); khá»›p bill quÃ©t xuyÃªn chi nhÃ¡nh theo ná»™i dung CK.
api.post('/vietqr/webhook', publicWriteLimit, wrap((req) => Pay.handleVietqrWebhook(req.body || {}, req.headers, 'br1')));
api.post('/sepay/webhook', publicWriteLimit, wrap((req) => Pay.handleSepayWebhook(req.body || {}, req.headers, 'br1')));
api.post('/casso/webhook', publicWriteLimit, wrap((req) => Pay.handleCassoWebhook(req.body || {}, req.headers, 'br1')));
api.post('/payos/webhook', publicWriteLimit, wrap((req) => Pay.handlePayosWebhook(req.body || {}, req.headers, 'br1')));
api.get('/payments/bank-transactions', guardAny('reports', 'settings.integrations'), wrap((req) => Pay.listBankTransactions(branch(req), req.query)));
// Auto-detect payOS: há»i tráº¡ng thÃ¡i Ä‘Æ¡n (poll) â€” cháº¡y Ä‘Æ°á»£c cáº£ á»Ÿ localhost.
api.get('/payos/payment-status/:orderCode', guard('pay'), wrap((req) => Pay.getPayosPaymentStatus(req.params.orderCode, branch(req))));
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
api.get('/warehouses', inventoryReadGuard, wrap((req) => Inv.listWarehouses(branch(req), req.query)));
function verifyWarehouseConfigAccess(req) {
  const branch_id = branch(req);
  const pin = req.body.security_pin || req.body.warehouse_pin || req.body.manager_pin || req.body.owner_pin || req.body.password;
  const approvedBy = Auth.verifyWarehouseConfigPin(pin, branch_id);
  if (!approvedBy) throw new Error('Cáº§n nháº­p máº­t kháº©u/PIN cá»§a Thá»§ kho, Manager hoáº·c Admin Ä‘á»ƒ táº¡o/cáº¥u hÃ¬nh kho.');
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
api.get('/inventory', inventoryReadGuard, wrap((req) => Inv.listInventory(branch(req), req.query)));
api.post('/inventory', guard('inventory.adjust'), wrap((req) => Inv.createInventoryItem(req.body, branch(req))));
api.post('/inventory/movements', guard('inventory.adjust'), wrap(() => notImplemented('Generic inventory movement endpoint is planned. Current app uses warehouse receive/issue/transfer/stocktake endpoints.')));
api.post('/inventory/:id/update', guard('inventory.adjust'), wrap((req) => Inv.updateInventoryItem(req.params.id, req.body, branch(req))));
api.post('/inventory/:id/delete', guard('inventory.adjust'), wrap((req) => Inv.deleteInventoryItem(req.params.id, branch(req))));
api.post('/inventory/:id/receive', guard('inventory.adjust'), wrap((req) => Inv.receiveStock(req.params.id, parseFloat(req.body.qty), branch(req), req.body)));
api.post('/inventory/:id/adjust', guard('inventory.adjust'), wrap((req) => Inv.adjustStock(req.params.id, parseFloat(req.body.stock), branch(req), req.body)));

// --- Retail / SKU ---
api.get('/skus', inventoryReadGuard, wrap((req) => Inv.listSkus(branch(req), req.query)));
api.post('/skus', guard('inventory.adjust'), wrap((req) => Inv.createSku(req.body, branch(req))));
api.post('/skus/:id/update', guard('inventory.adjust'), wrap((req) => Inv.updateSku(req.params.id, req.body, branch(req))));
api.post('/skus/:id/delete', guard('inventory.adjust'), wrap((req) => Inv.deleteSku(req.params.id, branch(req))));
api.get('/skus/barcode/:code', inventoryReadGuard, wrap((req) => {
  const s = Inv.findSkuByBarcode(req.params.code, branch(req), req.query);
  if (!s) throw new Error('KhÃ´ng tÃ¬m tháº¥y mÃ£ váº¡ch ' + req.params.code);
  return s;
}));
api.post('/skus/:id/receive', guard('inventory.adjust'), wrap((req) => Inv.receiveSku(req.params.id, parseFloat(req.body.qty), branch(req), req.body)));
api.post('/skus/:id/adjust', guard('inventory.adjust'), wrap((req) => Inv.adjustSku(req.params.id, parseFloat(req.body.stock), branch(req), req.body)));
api.get('/vouchers', guard('discount'), wrap((req) => Vouchers.listVouchers(branch(req))));
api.get('/vouchers/active', guardAny('discount', 'sell', 'pay'), wrap((req) => Vouchers.listActiveVouchers(branch(req))));
api.post('/vouchers', guard('discount'), wrap((req) => Vouchers.createVoucher(req.body, branch(req))));
api.post('/vouchers/:id/update', guard('discount'), wrap((req) => Vouchers.updateVoucher(req.params.id, req.body, branch(req))));
api.post('/vouchers/:id/toggle', guard('discount'), wrap((req) => Vouchers.toggleVoucher(req.params.id, req.body.active, branch(req))));
api.post('/retail/checkout', guard('pay'), wrap((req) => Retail.checkout({ ...req.body, branch_id: branch(req), cashier: req.user?.name || req.user?.username || '' })));

// --- Customers (directory + perks + tax-code lookup) ---
api.get('/customers', guard(), wrap((req) => Customers.listCustomers(branch(req), req.query.q || '', { branch_ids: requestedBranchIds(req) })));
api.get('/customers/:id', guard(), wrap((req) => Customers.getCustomerInBranches(req.params.id, Auth.userBranchIds(req.user))));
api.post('/customers', guard(), wrap((req) => Customers.upsertCustomer(req.body, customerWriteBranch(req))));
api.post('/customers/:id/delete', guard('settings.manage'), wrap((req) => {
  const existing = Customers.getCustomerInBranches(req.params.id, Auth.userBranchIds(req.user));
  if (!existing) throw new Error('Khach hang khong ton tai trong pham vi duoc cap.');
  return Customers.deleteCustomer(req.params.id, existing.branch_id);
}));
api.get('/customers/lookup/tax/:mst', guard(), wrap((req) => Customers.lookupTaxCode(req.params.mst, Auth.userBranchIds(req.user))));

// --- Contacts / Partners (LiÃªn há»‡: khÃ¡ch hÃ ng + nhÃ  cung cáº¥p dÃ¹ng chung 1 danh báº¡) ---
api.get('/partners', guard('module.contacts'), wrap((req) => ({
  partners: Customers.listPartners(branch(req), { type: req.query.type || 'all', q: req.query.q || '', branch_ids: requestedBranchIds(req) }),
  counts: Customers.partnerCounts(branch(req), requestedBranchIds(req)),
})));
api.get('/partners/:id', guard('module.contacts'), wrap((req) => Customers.getCustomerInBranches(req.params.id, Auth.userBranchIds(req.user))));
api.post('/partners', guard('module.contacts'), wrap((req) => Customers.upsertCustomer(req.body, customerWriteBranch(req))));
api.post('/partners/:id/delete', guard('module.contacts'), wrap((req) => {
  const existing = Customers.getCustomerInBranches(req.params.id, Auth.userBranchIds(req.user));
  if (!existing) throw new Error('Lien he khong ton tai trong pham vi duoc cap.');
  return Customers.deleteCustomer(req.params.id, existing.branch_id);
}));

// --- Purchase (Mua hÃ ng): PO lifecycle + nháº­n hÃ ng vÃ o kho + cÃ´ng ná»£ NCC ---
api.get('/purchase', guard('module.purchase'), wrap((req) => Purchase.listPurchaseOrders(branch(req), req.query)));
// Äáº·t TRÆ¯á»šC '/purchase/:id' Ä‘á»ƒ khÃ´ng bá»‹ báº¯t nháº§m lÃ  id.
api.get('/purchase/last-prices', guard('module.purchase'), wrap((req) => Purchase.lastPurchasePrices(branch(req), { supplier_id: req.query.supplier_id || '', supplier_name: req.query.supplier_name || '' })));
api.get('/purchase/:id', guard('module.purchase'), wrap((req) => Purchase.getPurchaseOrder(req.params.id, branch(req))));
api.post('/purchase', guard('module.purchase'), wrap((req) => Purchase.savePurchaseOrder(req.body, branch(req), req.user)));
api.post('/purchase/:id/confirm', guard('module.purchase'), wrap((req) => Purchase.confirmPurchaseOrder(req.params.id, branch(req), req.user)));
api.post('/purchase/:id/receive', guard('module.purchase'), wrap((req) => Purchase.receivePurchaseOrder(req.params.id, req.body, branch(req), req.user)));
api.post('/purchase/:id/pay', guard('module.purchase'), wrap((req) => Purchase.recordPurchasePayment(req.params.id, req.body, branch(req), req.user)));
api.post('/purchase/:id/cancel', guard('module.purchase'), wrap((req) => Purchase.cancelPurchaseOrder(req.params.id, branch(req), req.user)));
api.post('/purchase/:id/delete', guard('module.purchase'), wrap((req) => Purchase.deletePurchaseOrder(req.params.id, branch(req), req.user)));

// --- Expenses (Chi phÃ­): sá»• chi phÃ­, liÃªn káº¿t kÃ©t (drawer) hoáº·c káº¿ toÃ¡n chi trá»±c tiáº¿p ---
api.get('/expenses', guard('module.expenses'), wrap((req) => Expenses.listExpenses(branch(req), req.query)));
api.get('/expenses/categories', guard('module.expenses'), wrap((req) => Expenses.listCategories(branch(req))));
api.post('/expenses/categories', guard('module.expenses'), wrap((req) => Expenses.upsertCategory(req.body, branch(req))));
api.post('/expenses/categories/:id/delete', guard('module.expenses'), wrap((req) => Expenses.deleteCategory(req.params.id, branch(req))));
api.post('/expenses', guard('module.expenses'), wrap((req) => Expenses.createExpense(req.body, branch(req), req.user)));
api.post('/expenses/:id', guard('module.expenses'), wrap((req) => Expenses.updateExpense(req.params.id, req.body, branch(req), req.user)));
api.post('/expenses/:id/delete', guard('module.expenses'), wrap((req) => Expenses.deleteExpense(req.params.id, branch(req), req.user)));
api.get('/retail/sales', retailReadGuard, wrap((req) => Retail.listRetailSales(branch(req))));
api.post('/retail/:id/refund', guard('refund'), wrap((req) => {
  assertBillEditable(req.params.id, req, 'refund');
  return Retail.refund(req.params.id, req.body.reason, branch(req));
}));

// --- Warehouse documents / lots / counts ---
api.get('/movements', inventoryReadGuard, wrap((req) => Inv.listMovements(branch(req), parseInt(req.query.limit) || 80)));
api.get('/warehouse/lots', inventoryReadGuard, wrap((req) => Inv.listLots(branch(req), req.query)));
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
api.get('/warehouse/documents', inventoryReadGuard, wrap((req) => Inv.listDocuments(branch(req), req.query)));
api.get('/warehouse/documents/:id', inventoryReadGuard, wrap((req) => Inv.getDocument(req.params.id, branch(req))));

// --- Online channels ---
api.post('/online/webhook', publicWriteLimit, wrap((req) => Online.receive(req.body, visibleBranch(req), req.headers)));
api.get('/online/orders', onlineReadGuard, wrap((req) => Online.listOnline(branch(req))));
api.get('/online/channels', onlineReadGuard, wrap((req) => Online.listChannels(branch(req))));
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
api.get('/print/jobs/:id/text', printGuard, wrap((req) => ({ text: Print.renderJobText(Print.getJobForBranchFull(req.params.id, branch(req)) || {}) })));
api.post('/print/reprint', printGuard, wrap(() => notImplemented('Generic print reprint endpoint is planned. Current app uses /api/print/jobs/:id/reprint.')));
api.post('/print/jobs/:id/print', printGuard, wrap((req) => Print.dispatchJob(req.params.id, branch(req), { force: true })));
api.post('/print/jobs/:id/printed', printGuard, wrap((req) => Print.markPrinted(req.params.id, branch(req), actor(req))));
api.post('/print/jobs/:id/reprint', printGuard, wrap((req) => Print.reprint(req.params.id, branch(req))));

// --- MISA e-invoice ---
const invoiceGuard = guardAny('invoice', 'module.invoice', 'settings.invoices');
api.post('/invoices/issue', invoiceGuard, wrap((req) => {
  assertBillEditable(req.body.order_id, req, 'invoice_issue');
  return Invoices.issue(req.body.order_id, req.body.customer, branch(req));
}));
api.get('/invoices', invoiceGuard, wrap((req) => Invoices.list(branch(req))));
api.get('/invoices/order/:id', invoiceGuard, wrap((req) => Invoices.byOrder(req.params.id)));
api.post('/invoices/:id/cancel', invoiceGuard, wrap((req) => {
  const ord = db.prepare(`SELECT id FROM orders WHERE invoice_id=? AND branch_id=?`).get(req.params.id, branch(req));
  if (ord) assertBillEditable(ord.id, req, 'invoice_cancel');
  return Invoices.cancel(req.params.id, req.body.reason, branch(req));
}));

// --- Cloud Sync / Offline ---
api.get('/sync/status', guardAny('settings.sync', 'reports'), wrap((req) => Sync.status(branch(req))));
api.post('/sync/offline', guard('reports'), wrap((req) => Sync.setOffline(req.body.offline, branch(req))));
api.post('/sync/now', guard('reports'), wrap((req) => Sync.syncNow(branch(req))));

// --- Reports ---
api.get('/dashboard', guard('reports'), wrap((req) => Reports.dashboard(branch(req))));
api.get('/dashboard/trends', guard('reports'), wrap((req) => Reports.revenueTrends(branch(req))));
api.get('/dashboard/branches', guard('reports'), wrap((req) => Reports.branchSummaries(requestedBranchIds(req))));
api.get('/dashboard/aggregate', guard('reports'), wrap((req) => Reports.dashboardAggregate(requestedBranchIds(req))));
api.get('/reports/branches', guard('reports'), wrap((req) => Reports.dashboardAggregate(requestedBranchIds(req))));
api.get('/reports/branches/export', guard('reports'), async (req, res) => {
  try {
    const data = Reports.dashboardAggregate(requestedBranchIds(req));
    const format = String(req.query.format || 'html').toLowerCase();
    if (format === 'json') return res.json(data);
    const html = branchAggregateHtml(data);
    if (format === 'xls' || format === 'xlsx' || format === 'sheet') {
      res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="branch-summary.xls"');
      return res.send(html);
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="branch-summary.html"');
    return res.send(html);
  } catch (e) {
    return res.status(e.status || 400).json({ error: e.message });
  }
});
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
    return res.status(400).json({ error: 'Äá»‹nh dáº¡ng bÃ¡o cÃ¡o khÃ´ng há»£p lá»‡' });
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
    // BÃ¡o cÃ¡o TRUNG THá»°C: tráº¡ng thÃ¡i sao lÆ°u/Ä‘á»“ng bá»™ pháº£n Ã¡nh Ä‘Ãºng thá»±c táº¿ há»‡ thá»‘ng.
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
      note: 'Äáº©y Ä‘á»“ng bá»™ ngoáº¡i vi CHÆ¯A báº­t. An toÃ n dá»¯ liá»‡u dá»±a vÃ o sao lÆ°u local Ä‘á»‹nh ká»³ (backups/) + nháº­t kÃ½ NDJSON fsync. HÃ£y copy thÆ° má»¥c backups/ ra á»• ngoÃ i/VPS Ä‘á»‹nh ká»³.',
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
  if (!pin) throw new Error('Cáº§n cung cáº¥p mÃ£ PIN xÃ¡c nháº­n.');
  
  const user = Auth.verifyManagerOwnerPin(pin, branch(req));
  if (!user) {
    throw new Error('MÃ£ PIN khÃ´ng Ä‘Ãºng hoáº·c khÃ´ng cÃ³ quyá»n Admin/Manager.');
  }

  const transactionTables = [
    'orders', 'order_items', 'payments', 'payment_lines', 'shifts',
    'cash_drawer_entries', 'cash_drawer_reimbursement_allocations',
    'purchase_orders', 'purchase_order_lines', 'purchase_payments',
    'expenses', 'print_jobs', 'invoices', 'bank_transactions', 'sync_queue',
    'audit_log', 'staff_calls'
  ];

  // node:sqlite (DatabaseSync) khÃ´ng cÃ³ .transaction() â€” dÃ¹ng BEGIN/COMMIT/ROLLBACK.
  db.exec('BEGIN');
  try {
    for (const table of transactionTables) {
      try {
        db.exec(`DELETE FROM ${table}`);
      } catch (e) {
        console.error(`Lá»—i khi dá»n dáº¹p báº£ng ${table}:`, e.message);
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
  audit('db.reset_transactions', 'Dá»n dáº¹p toÃ n bá»™ dá»¯ liá»‡u giao dá»‹ch vá» tráº¡ng thÃ¡i sáº¡ch.', branch(req), user.username);
  
  return { ok: true, message: 'ÄÃ£ dá»n dáº¹p sáº¡ch toÃ n bá»™ dá»¯ liá»‡u giao dá»‹ch thÃ nh cÃ´ng.' };
}));

// POST /api/database/clone-to-staging
api.post('/database/clone-to-staging', guardAny('settings.manage'), wrap(async (req) => {
  const { pin } = req.body;
  if (!pin) throw new Error('Cáº§n cung cáº¥p mÃ£ PIN xÃ¡c nháº­n.');
  const user = Auth.verifyManagerOwnerPin(pin, branch(req));
  if (!user) {
    throw new Error('MÃ£ PIN khÃ´ng Ä‘Ãºng hoáº·c khÃ´ng cÃ³ quyá»n Admin/Manager.');
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
    throw new Error(`KhÃ´ng thá»ƒ nhÃ¢n báº£n CSDL: ${e.message}`);
  }

  audit('db.clone_to_staging', 'NhÃ¢n báº£n cÆ¡ sá»Ÿ dá»¯ liá»‡u sang mÃ´i trÆ°á»ng staging.', branch(req), user.username);
  return { ok: true, message: 'ÄÃ£ nhÃ¢n báº£n cÆ¡ sá»Ÿ dá»¯ liá»‡u sang mÃ´i trÆ°á»ng staging thÃ nh cÃ´ng.', stagingPath };
}));

// POST /api/database/decrypt-audit
api.post('/database/decrypt-audit', guardAny('settings.manage'), wrap(async (req) => {
  const { id } = req.body;
  if (!id) throw new Error('Cáº§n cung cáº¥p ID audit log.');
  const row = db.prepare(`SELECT detail FROM audit_log WHERE id = ?`).get(id);
  if (!row) throw new Error('KhÃ´ng tÃ¬m tháº¥y báº£n ghi nháº­t kÃ½ hoáº¡t Ä‘á»™ng.');
  const decrypted = decryptDecompress(row.detail);
  return { decrypted };
}));

// GET /api/database/docs
api.get('/database/docs', guardAny('settings.manage'), wrap(async () => {
  return [
    { file: 'README.md', title: 'Tá»•ng quan & Stack dá»± Ã¡n' },
    { file: 'docs/ARCHITECTURE.md', title: 'Kiáº¿n trÃºc & VÃ¹ng triá»ƒn khai' },
    { file: 'docs/OFFLINE_FIRST_ARCHITECTURE.md', title: 'Kiáº¿n trÃºc Offline-First' },
    { file: 'docs/COMPANY_DATABASE_MEMORY.md', title: 'ChÃ­nh sÃ¡ch Bá»™ nhá»› vÄ©nh viá»…n' },
    { file: 'docs/VPS_TEMPORARY_BUFFER.md', title: 'Bá»™ Ä‘á»‡m sá»± kiá»‡n táº¡m thá»i VPS' },
    { file: 'docs/SYNC_BACK_TO_COMPANY_SERVER.md', title: 'Quy trÃ¬nh Äá»“ng bá»™ ngÆ°á»£c' }
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
    throw new Error('TÃ i liá»‡u khÃ´ng náº±m trong danh má»¥c cho phÃ©p.');
  }

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const ROOT = path.join(__dirname, '..');
  const targetPath = path.resolve(ROOT, reqFile);

  let content = '';
  try {
    content = fs.readFileSync(targetPath, 'utf8');
  } catch (e) {
    throw new Error('KhÃ´ng thá»ƒ Ä‘á»c ná»™i dung tÃ i liá»‡u.');
  }

  return { file: reqFile, content };
}));

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// DMS â€” Document Management System
// POST /documents/upload     â€” upload 1 file (base64 trong JSON body)
// GET  /documents/files      â€” danh sÃ¡ch tÃ i liá»‡u
// GET  /documents/files/:id/download  â€” táº£i file
// GET  /documents/files/:id/preview   â€” preview (áº£nh/pdf inline)
// PUT  /documents/files/:id  â€” cáº­p nháº­t metadata
// DEL  /documents/files/:id  â€” xÃ³a (cáº§n PIN)
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

const DMS_ALLOWED_MIME = new Set([
  'image/jpeg','image/png','image/webp','image/gif',
  'application/pdf',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/csv','text/plain','application/json',
]);
const DMS_MAX_BYTES = 25 * 1024 * 1024; // 25 MB
const DMS_SAFE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.pdf', '.xls', '.xlsx', '.docx', '.csv', '.txt', '.json']);

function dmsFilePath(storedName) {
  const clean = nodePath.basename(String(storedName || ''));
  if (!clean || clean !== storedName || clean.includes('..')) {
    const e = new Error('TÃƒÂªn file lÃ†Â°u trÃ¡Â»Â¯ khÃƒÂ´ng hÃ¡Â»Â£p lÃ¡Â»â€¡.');
    e.status = 400;
    throw e;
  }
  const root = nodePath.resolve(UPLOADS_DIR);
  const target = nodePath.resolve(root, clean);
  if (target !== root && !target.startsWith(root + nodePath.sep)) {
    const e = new Error('Ã„ÂÃ†Â°Ã¡Â»Âng dÃ¡ÂºÂ«n file khÃƒÂ´ng hÃ¡Â»Â£p lÃ¡Â»â€¡.');
    e.status = 400;
    throw e;
  }
  return target;
}

function safeOriginalName(value) {
  return nodePath.basename(String(value || 'document').replace(/[\r\n]/g, ' ')).slice(0, 180) || 'document';
}

function safeDmsExt(originalName) {
  const ext = nodePath.extname(safeOriginalName(originalName)).toLowerCase();
  return DMS_SAFE_EXT.has(ext) ? ext : '';
}

// â”€â”€ Shared helper â€” also exported for internal use by other services â”€â”€â”€â”€â”€â”€â”€â”€
export function saveDocumentRecord({ branch_id, name, original_name, stored_name, mime_type, file_size, category = 'other', source = 'manual', related_id = null, related_type = null, tags = [], description = '', uploaded_by = 'system', uploaded_by_name = 'Há»‡ thá»‘ng' }) {
  const id = uid('doc_');
  const created_at = now();
  db.prepare(`INSERT INTO document_files (id,branch_id,name,original_name,stored_name,mime_type,file_size,category,source,related_id,related_type,tags_json,description,uploaded_by,uploaded_by_name,is_archived,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?)`)
    .run(id, branch_id, name, original_name, stored_name, mime_type, file_size, category, source, related_id, related_type, JSON.stringify(tags), description, uploaded_by, uploaded_by_name, created_at);
  audit('dms.upload', { id, name, category, source, original_name, file_size }, branch_id, uploaded_by);
  return db.prepare(`SELECT * FROM document_files WHERE id=?`).get(id);
}

// â”€â”€ Upload â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
api.post('/documents/upload', wrap(async (req) => {
  const { branch_id, actor } = Auth.requirePermission(req, 'module.database');
  const { name, category = 'other', source = 'manual', related_id, related_type, tags = [], description = '', data, mime_type, original_name } = req.body;

  if (!data || !original_name) throw new Error('Thiáº¿u dá»¯ liá»‡u file (data, original_name)');
  if (!DMS_ALLOWED_MIME.has(mime_type)) throw new Error(`Äá»‹nh dáº¡ng file khÃ´ng Ä‘Æ°á»£c há»— trá»£: ${mime_type}`);

  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(String(data))) throw new Error('Du lieu file base64 khong hop le');

  // data is base64
  const buf = Buffer.from(data, 'base64');
  if (!buf.byteLength) throw new Error('File rong hoac du lieu base64 khong hop le');
  if (buf.byteLength > DMS_MAX_BYTES) throw new Error(`File quÃ¡ lá»›n â€” tá»‘i Ä‘a 25MB`);

  const originalName = safeOriginalName(original_name);
  const stored_name = uid('f_') + safeDmsExt(originalName);
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  fs.writeFileSync(dmsFilePath(stored_name), buf, { flag: 'wx' });

  const rec = saveDocumentRecord({
    branch_id,
    name: String(name || originalName).slice(0, 180),
    original_name: originalName,
    stored_name,
    mime_type,
    file_size: buf.byteLength,
    category: String(category || 'other').slice(0, 60),
    source: String(source || 'manual').slice(0, 60),
    related_id,
    related_type,
    tags: Array.isArray(tags) ? tags.slice(0, 30) : [],
    description: String(description || '').slice(0, 2000),
    uploaded_by: actor.username || actor.id,
    uploaded_by_name: actor.name,
  });
  return rec;
}));

// â”€â”€ List files â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
api.get('/documents/files', wrap(async (req) => {
  const { branch_id } = Auth.requirePermission(req, 'module.database');
  const { category, source, q, from, to, archived = '0', limit = '100', offset = '0' } = req.query;
  const safeLimit = Math.min(250, Math.max(1, parseInt(limit, 10) || 100));
  const safeOffset = Math.max(0, parseInt(offset, 10) || 0);

  let sql = `SELECT * FROM document_files WHERE branch_id=? AND is_archived=?`;
  const params = [branch_id, archived === '1' ? 1 : 0];

  if (category && category !== 'all') { sql += ` AND category=?`; params.push(category); }
  if (source && source !== 'all')     { sql += ` AND source=?`;   params.push(source); }
  if (from)  { sql += ` AND created_at>=?`; params.push(from); }
  if (to)    { sql += ` AND created_at<=?`; params.push(to + 'T23:59:59'); }
  if (q)     { sql += ` AND (name LIKE ? OR original_name LIKE ? OR description LIKE ?)`; const like = `%${q}%`; params.push(like, like, like); }

  sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  params.push(safeLimit, safeOffset);

  const rows = db.prepare(sql).all(...params);
  const total = db.prepare(`SELECT COUNT(*) n FROM document_files WHERE branch_id=? AND is_archived=?`).get(branch_id, archived === '1' ? 1 : 0).n;

  return { files: rows.map(r => ({ ...r, tags: JSON.parse(r.tags_json || '[]') })), total };
}));

// â”€â”€ Download â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
api.get('/documents/files/:id/download', async (req, res) => {
  try {
    const { branch_id } = Auth.requirePermission(req, 'module.database');
    const rec = db.prepare(`SELECT * FROM document_files WHERE id=? AND branch_id=?`).get(req.params.id, branch_id);
    if (!rec) return res.status(404).json({ error: 'TÃ i liá»‡u khÃ´ng tá»“n táº¡i' });

    const filePath = dmsFilePath(rec.stored_name);
    if (!fs.existsSync(filePath)) return res.status(410).json({ error: 'File Ä‘Ã£ bá»‹ xÃ³a khá»i á»• Ä‘Ä©a' });

    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(safeOriginalName(rec.original_name))}`);
    res.setHeader('Content-Type', rec.mime_type || 'application/octet-stream');
    fs.createReadStream(filePath).pipe(res);
  } catch(e) { logRequestError(req, e); res.status(e.status || 400).json(errorPayload(e)); }
});

// â”€â”€ Preview (inline) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
api.get('/documents/files/:id/preview', async (req, res) => {
  try {
    const { branch_id } = Auth.requirePermission(req, 'module.database');
    const rec = db.prepare(`SELECT * FROM document_files WHERE id=? AND branch_id=?`).get(req.params.id, branch_id);
    if (!rec) return res.status(404).json({ error: 'TÃ i liá»‡u khÃ´ng tá»“n táº¡i' });

    const filePath = dmsFilePath(rec.stored_name);
    if (!fs.existsSync(filePath)) return res.status(410).json({ error: 'File Ä‘Ã£ bá»‹ xÃ³a khá»i á»• Ä‘Ä©a' });

    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', rec.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(safeOriginalName(rec.original_name))}`);
    fs.createReadStream(filePath).pipe(res);
  } catch(e) { logRequestError(req, e); res.status(e.status || 400).json(errorPayload(e)); }
});

// â”€â”€ Update metadata â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
api.put('/documents/files/:id', wrap(async (req) => {
  const { branch_id, actor } = Auth.requirePermission(req, 'module.database');
  const rec = db.prepare(`SELECT * FROM document_files WHERE id=? AND branch_id=?`).get(req.params.id, branch_id);
  if (!rec) throw new Error('TÃ i liá»‡u khÃ´ng tá»“n táº¡i');

  const { name, description, tags, category, is_archived } = req.body;
  db.prepare(`UPDATE document_files SET name=COALESCE(?,name), description=COALESCE(?,description), tags_json=COALESCE(?,tags_json), category=COALESCE(?,category), is_archived=COALESCE(?,is_archived) WHERE id=?`)
    .run(name ?? null, description ?? null, tags ? JSON.stringify(tags) : null, category ?? null, is_archived != null ? (is_archived ? 1 : 0) : null, req.params.id);

  audit('dms.update', { id: req.params.id, name, category }, branch_id, actor.username || actor.id);
  const updated = db.prepare(`SELECT * FROM document_files WHERE id=?`).get(req.params.id);
  return { ...updated, tags: JSON.parse(updated.tags_json || '[]') };
}));

// â”€â”€ Delete â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
api.delete('/documents/files/:id', wrap(async (req) => {
  const { branch_id, actor } = Auth.requirePermission(req, 'module.database');
  // Require Manager/Owner PIN for permanent deletion
  const { pin } = req.body || {};
  if (!pin) throw new Error('Can PIN Quan ly hoac Admin de xoa vinh vien tai lieu.');
  if (pin && !Auth.verifyManagerOwnerPin(pin, branch_id)) throw new Error('Cáº§n PIN Quáº£n lÃ½ hoáº·c Admin Ä‘á»ƒ xÃ³a vÄ©nh viá»…n tÃ i liá»‡u.');

  const rec = db.prepare(`SELECT * FROM document_files WHERE id=? AND branch_id=?`).get(req.params.id, branch_id);
  if (!rec) throw new Error('TÃ i liá»‡u khÃ´ng tá»“n táº¡i');

  // Delete physical file
  const filePath = dmsFilePath(rec.stored_name);
  try { fs.unlinkSync(filePath); } catch (_) { /* already gone */ }

  db.prepare(`DELETE FROM document_files WHERE id=?`).run(req.params.id);
  audit('dms.delete', { id: rec.id, name: rec.name, original_name: rec.original_name }, branch_id, actor.username || actor.id);
  return { ok: true };
}));
