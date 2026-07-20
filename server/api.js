// REST API: thin HTTP layer over the Local Store Server services.
import { Router } from 'express';
import { uid, audit } from './db.js';
import * as Auth from './services/auth.js';
import { logSystem } from './services/systemLogs.js';
import { registerInventoryRoutes } from './modules/inventory/routes.js';
import { registerInvoiceRoutes } from './modules/invoices/routes.js';
import { registerPaymentRoutes } from './modules/payments/routes.js';
import { registerTaxRoutes } from './modules/tax/routes.js';
import { registerOrderRoutes } from './modules/orders/routes.js';
import { registerReportRoutes } from './modules/reports/routes.js';
import { registerAuditRoutes } from './modules/audit/routes.js';
import { registerPurchaseRoutes } from './modules/purchase/routes.js';
import { registerExpenseRoutes } from './modules/expenses/routes.js';
import { registerOnlineRoutes } from './modules/online/routes.js';
import { registerPrintingRoutes } from './modules/printing/routes.js';
import { registerRetailRoutes } from './modules/retail/routes.js';
import { registerContactRoutes } from './modules/contacts/routes.js';
import { registerCatalogRoutes } from './modules/catalog/routes.js';
import { registerAgentRoutes } from './modules/agent/routes.js';
import { registerAppReleaseRoutes } from './modules/appRelease/routes.js';
import { registerSyncRoutes } from './modules/sync/routes.js';
import { registerAuthRoutes } from './modules/auth/routes.js';
import { registerClientLogRoutes } from './modules/clientLog/routes.js';
import { registerSettingsRoutes } from './modules/settings/routes.js';
import { registerDatabaseRoutes } from './modules/database/routes.js';
import { registerDocumentRoutes, fileCashDrawerReceipt } from './modules/documents/routes.js';
import * as Haravan from './services/haravanConnector.js';
import { errorPayload } from './core/errors.js';
import fs from 'node:fs';
import nodePath from 'node:path';
import { fileURLToPath } from 'node:url';
const __apiDir = nodePath.dirname(fileURLToPath(import.meta.url));
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
// Only unexpected server failures belong in the technical log. Expected 4xx
// validation/auth/business failures are either already audited by their owner
// or are user input feedback, not separate system incidents.
function logRequestError(req, e) {
  try {
    const status = e?.status || 400;
    if (status < 500) return;
    let branch_id = 'br1';
    try { branch_id = branch(req) || 'br1'; } catch { /* unresolved branch */ }
    const actor = req?.user?.name || req?.user?.username || 'system';
    const path = req?.originalUrl || req?.url || '';
    logSystem({
      level: 'error',
      source: 'backend',
      eventType: pickBackendEventType(path, status),
      title: `API ${req?.method || ''} ${path} → ${status}`,
      message: e?.message || 'Request failed',
      username: actor,
      branchId: branch_id,
      deviceName: req?.headers?.['x-device-name'],
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

// Lưu ảnh gửi lên dạng base64 (≤20MB, đúng mime ảnh) vào thư mục uploads và trả
// URL công khai. Helper DÙNG CHUNG cho avatar nhân viên (settings), ảnh món
// (catalog) và avatar đối tác (contacts) — truyền vào các module đó.
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

registerTaxRoutes(api, { wrap, guard });
registerInventoryRoutes(api, { wrap, guard, guardAny, branch, visibleBranch });
registerPaymentRoutes(api, {
  wrap,
  guard,
  guardAny,
  branch,
  visibleBranch,
  applyManualConfirm,
  fileCashDrawerReceipt,
  logRequestError,
});
registerInvoiceRoutes(api, {
  wrap,
  guard,
  guardAny,
  branch,
  visibleBranch,
  actor,
  assertBillEditable,
});
// Tables + Orders + KDS tickets — route ownership tách sang modules/orders (hành
// vi giữ nguyên; nghiệp vụ vẫn ở services/orders.js).
registerOrderRoutes(api, { wrap, guard, guardAny, branch, visibleBranch, actor });
// Dashboard + Report Center (preview/export) — route ownership: modules/reports.
registerReportRoutes(api, { wrap, guard, branch, visibleBranch });
// System logs hợp nhất + audit trail — route ownership: modules/audit.
registerAuditRoutes(api, { wrap, guard, branch });
// Mua hàng / Chi phí / Online / In ấn — route ownership tách sang modules/<domain>.
registerPurchaseRoutes(api, { wrap, guard, branch });
registerExpenseRoutes(api, { wrap, guard, branch });
registerOnlineRoutes(api, { wrap, guard, guardAny, branch, visibleBranch });
api.get('/v1/integrations/haravan/status', guardAny('settings.integrations', 'online'), wrap(() => Haravan.status()));
api.get('/v1/integrations/haravan/install-url', guardAny('settings.integrations'), wrap((req) => Haravan.installUrl({ branch_id: branch(req) })));
api.post('/v1/integrations/haravan/subscribe-webhook', guardAny('settings.integrations'), wrap((req) => Haravan.subscribeWebhook(req.body?.shop_domain || req.body?.shopDomain || '')));
api.post('/v1/integrations/haravan/unsubscribe-webhook', guardAny('settings.integrations'), wrap((req) => Haravan.unsubscribeWebhook(req.body?.shop_domain || req.body?.shopDomain || '')));
api.post('/v1/integrations/haravan/sync-orders', guardAny('settings.integrations'), wrap((req) => Haravan.pullHaravanOrders({ shopDomain: req.body?.shop_domain || req.body?.shopDomain || '', delta: req.body?.delta !== false })));
api.post('/v1/integrations/haravan/sync-products', guardAny('settings.integrations'), wrap((req) => Haravan.pullHaravanProducts({ shopDomain: req.body?.shop_domain || req.body?.shopDomain || '', delta: req.body?.delta !== false })));
api.post('/v1/integrations/haravan/sync-customers', guardAny('settings.integrations'), wrap((req) => Haravan.pullHaravanCustomers({ shopDomain: req.body?.shop_domain || req.body?.shopDomain || '', delta: req.body?.delta !== false })));
api.post('/v1/integrations/haravan/push-inventory', guardAny('settings.integrations', 'inventory.adjust'), wrap((req) => Haravan.pushInventoryToHaravan({ shopDomain: req.body?.shop_domain || req.body?.shopDomain || '', skuIds: req.body?.sku_ids || req.body?.skuIds || [] })));
api.post('/v1/integrations/haravan/push-pending-inventory', guardAny('settings.integrations', 'inventory.adjust'), wrap(() => Haravan.pushPendingInventoryChanges()));
api.get('/v1/integrations/haravan/sync-logs', guardAny('settings.integrations', 'online'), wrap((req) => Haravan.listSyncLogs(req.query.limit)));
registerPrintingRoutes(api, { wrap, guardAny, branch, actor });
// Retail POS + Vouchers / Contacts — pass helper cục bộ (applyManualConfirm,
// assertBillEditable, requireContactMutationPermission, saveBase64Image) vì api.js
// vẫn là nơi định nghĩa duy nhất (domain khác còn dùng chung).
registerRetailRoutes(api, { wrap, guard, guardAny, branch, visibleBranch, applyManualConfirm, assertBillEditable });
registerContactRoutes(api, { wrap, guard, guardAny, branch, requireContactMutationPermission, saveBase64Image, AVATAR_UPLOADS_DIR });
// Catalog / Menu + Categories — pass saveBase64Image + MENU_UPLOADS_DIR.
registerCatalogRoutes(api, { wrap, guard, branch, actor, saveBase64Image, MENU_UPLOADS_DIR });
// Hardware Agent / Auto-update / Cloud Sync.
registerAgentRoutes(api, { wrap, guardAny, branch });
registerAppReleaseRoutes(api, { wrap, guardAny, logRequestError });
registerSyncRoutes(api, { wrap, guard, branch, visibleBranch });
// Auth (login/logout/me/branches/users) + ERP module registry — pass publicBranch.
registerAuthRoutes(api, { wrap, guard, guardAny, branch, visibleBranch, publicBranch });
// Client log sink + Config backup/restore.
registerClientLogRoutes(api, { wrap, guard, branch });
// Settings (user/permission, config, integrations, devices, book-menu, self-order)
// — NHẠY CẢM; pass scopedUserBody + saveBase64Image + AVATAR_UPLOADS_DIR.
registerSettingsRoutes(api, { wrap, guard, guardAny, branch, visibleBranch, actor, scopedUserBody, saveBase64Image, AVATAR_UPLOADS_DIR });
// Database Management (backup/restore/integrity/reset) — NHẠY CẢM (thao tác huỷ).
registerDatabaseRoutes(api, { wrap, guardAny, branch });
// Document Management (DMS) — pass logRequestError + SECURE_MIME_EXT (fileCashDrawerReceipt
// export từ module này đã được import ở trên để truyền cho payments).
registerDocumentRoutes(api, { wrap, logRequestError, SECURE_MIME_EXT });

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
