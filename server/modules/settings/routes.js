// Route ownership: Settings — user/permission, branches, app config, integrations,
// connections/devices, book-menu, self-order checkin. NHẠY CẢM (PIN/user/config).
// Nghiệp vụ ở services/settings.js + auth.js (+ nhiều service). Giữ NGUYÊN hành vi.
import * as Auth from '../../services/auth.js';
import * as Branches from '../../services/branches.js';
import * as AppSettings from '../../services/settings.js';
import * as Einvoices from '../../services/einvoice.js';
import * as Misa from '../../services/misa.js';
import * as Pay from '../../services/payments.js';
import * as System from '../../services/system.js';
import * as Print from '../../services/printing.js';
import * as BookMenu from '../../services/bookMenu.js';
import * as Customers from '../../services/customers.js';
import { audit, now } from '../../db.js';
import { emit, getActiveConnections } from '../../realtime.js';
import { notImplemented } from '../../core/http.js';
import { rateLimit } from '../../core/rateLimit.js';
import { logSystem } from '../../services/systemLogs.js';

// Chống brute-force PIN 4 số của màn khóa iPad + chống dò SĐT khách ở self-order —
// khóa theo IP nguồn (2 endpoint này CÔNG KHAI, không có token để khóa theo user).
const ipadUnlockLimiter = rateLimit({ key: 'ipad-unlock', windowMs: 60_000, max: 20, message: 'Nhập sai quá nhiều lần. Vui lòng đợi một phút rồi thử lại.' });
const selfCheckinLimiter = rateLimit({ key: 'self-checkin', windowMs: 60_000, max: 30 });

export function registerSettingsRoutes(api, { wrap, guard, guardAny, branch, visibleBranch, actor, scopedUserBody, saveBase64Image, AVATAR_UPLOADS_DIR }) {
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
api.get('/settings/integrations', guardAny('settings.integrations'), wrap((req) => AppSettings.getPublicIntegrations(branch(req))));
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
      logSystem({
        level: 'error',
        source: 'misa',
        eventType: 'einvoice_error',
        title: 'Không thể xếp lại hóa đơn chờ khi bật MISA',
        message: e.message,
        branchId: branch_id,
        username: approvedBy.username,
        action: 'einvoice_backfill',
        exceptionType: e.name,
        stackTrace: e.stack,
      });
    }
  }
  return saved;
}));
// Test a single integration channel. MISA does a real auth call when live;
// delivery channels return the webhook URL to paste into the partner portal.
api.post('/settings/integrations/:channel/test', guardAny('settings.integrations'), wrap(async (req) => {
  const channel = req.params.channel;
  const storedCfg = AppSettings.getIntegrations(branch(req)).channels?.[channel] || {};
  const incomingCfg = req.body?.config && typeof req.body.config === 'object' ? req.body.config : {};
  const cfg = { ...storedCfg, ...incomingCfg };
  for (const key of ['password', 'secretKey', 'apiKey', 'checksumKey', 'clientSecret', 'accessToken', 'webhookSecret']) {
    const value = String(incomingCfg[key] ?? '').trim();
    if (!value || value.startsWith('********') || /^•{4,}/u.test(value)) cfg[key] = storedCfg[key] || '';
  }
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
  if (channel === 'haravan') {
    const webhookUrl = `${base}/webhooks/haravan`;
    const secretConfigured = !!(cfg.webhookSecret || process.env.HARAVAN_WEBHOOK_SECRET);
    const tokenConfigured = !!(cfg.accessToken || process.env.HARAVAN_ACCESS_TOKEN);
    return {
      channel,
      ok: secretConfigured && tokenConfigured,
      mode: cfg.enabled || process.env.HARAVAN_ENABLED === 'true' || process.env.HARAVAN_ENABLED === '1' ? 'ready' : 'disabled',
      webhookUrl,
      message: secretConfigured && tokenConfigured
        ? 'Dán Webhook URL này vào Haravan. Token/secret đã lưu trên server.'
        : 'Thiếu Access Token hoặc Webhook Secret Haravan.',
    };
  }
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
  const isVps = process.env.DEPLOYMENT_TARGET === 'vps';
  const serverIps = [];
  if (!isVps) {
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name] || []) {
        if (iface.family === 'IPv4' && !iface.internal) serverIps.push(iface.address);
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
    deploymentTarget: process.env.DEPLOYMENT_TARGET || 'local',
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
api.post('/device/ipad/unlock', ipadUnlockLimiter, wrap((req) => {
  if (!AppSettings.verifyIpadStaffPin(req.body.pin, visibleBranch(req))) throw new Error('Mật khẩu không đúng');
  return { ok: true };
}));
// iPad self-order: khách nhập SĐT đầu bữa → tự tạo khách mới nếu chưa có,
// trả về điểm tích lũy + món hay gọi (từ lần ăn thứ 3). Route mở như các
// route iPad khác (thiết bị công cộng đặt tại bàn).
api.post('/self-order/checkin', selfCheckinLimiter, wrap((req) => Customers.selfOrderCheckin(req.body?.phone, visibleBranch(req))));
api.get('/device/ipad/setup-options', wrap((req) => {
  const b = visibleBranch(req);
  const activePos = getActiveConnections(b).filter(c => c.device === 'pos');
  const printers = Print.listPrinters(b) || [];
  return {
    posDevices: activePos,
    printers: printers
  };
}));
}
