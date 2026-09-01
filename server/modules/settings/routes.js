// Route ownership: Settings — user/permission, branches, app config, integrations,
// connections/devices, book-menu, self-order checkin. NHẠY CẢM (PIN/user/config).
// Nghiệp vụ ở services/settings.js + auth.js (+ nhiều service). Giữ NGUYÊN hành vi.
import * as Auth from '../../services/auth.js';
import * as QrProvider from '../../services/qrProvider.js';
import * as Branches from '../../services/branches.js';
import * as AppSettings from '../../services/settings.js';
import * as Einvoices from '../../services/einvoice.js';
import * as Misa from '../../services/misa/index.js';
import * as Haravan from '../../services/haravanConnector.js';
import * as Pay from '../../services/payments.js';
import * as System from '../../services/system.js';
import * as Print from '../../services/printing.js';
import * as BookMenu from '../../services/bookMenu.js';
import * as Customers from '../../services/customers.js';
import { registerDeviceToken } from '../../services/push.js';
import { audit, now } from '../../db.js';
import { emit, getActiveConnections } from '../../realtime.js';
import { rateLimit } from '../../core/rateLimit.js';
import { logSystem } from '../../services/systemLogs.js';
import { buildLiveDeviceRegistry } from '../../core/deviceRegistry.js';

// Chống brute-force PIN 4 số của màn khóa iPad + chống dò SĐT khách ở self-order —
// khóa theo IP nguồn (2 endpoint này CÔNG KHAI, không có token để khóa theo user).
const ipadUnlockLimiter = rateLimit({ key: 'ipad-unlock', windowMs: 60_000, max: 20, message: 'Nhập sai quá nhiều lần. Vui lòng đợi một phút rồi thử lại.' });
const selfCheckinLimiter = rateLimit({ key: 'self-checkin', windowMs: 60_000, max: 30 });

export function registerSettingsRoutes(api, { wrap, guard, guardAny, branch, visibleBranch, actor, scopedUserBody, saveBase64Image, AVATAR_UPLOADS_DIR, CUSTOMER_DISPLAY_UPLOADS_DIR }) {
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
// Tạo vai trò tùy chỉnh (gate bằng PIN Manager/Admin như sửa quyền).
api.post('/settings/roles', guardAny('settings.perms'), wrap((req) => {
  const branch_id = branch(req);
  const pin = req.body?.security_pin;
  if (req.body) delete req.body.security_pin;
  if (!Auth.verifyManagerOwnerPin(pin, branch_id)) throw new Error('Cần nhập PIN của Manager hoặc Admin để tạo vai trò.');
  return Auth.createCustomRole({ key: req.body.key, label: req.body.label, note: req.body.note }, req.user);
}));
api.delete('/settings/roles/:role', guardAny('settings.perms'), wrap((req) => {
  const branch_id = branch(req);
  const pin = req.query.security_pin || req.body?.security_pin;
  if (!Auth.verifyManagerOwnerPin(pin, branch_id)) throw new Error('Cần nhập PIN của Manager hoặc Admin để xóa vai trò.');
  return Auth.deleteCustomRole(req.params.role, req.user);
}));
api.get('/settings/users', guardAny('settings.users'), wrap((req) => Auth.listAllUsers(branch(req))));
api.post('/settings/users/avatar-upload', guardAny('settings.users'), wrap((req) =>
  saveBase64Image(req, { dir: AVATAR_UPLOADS_DIR, urlBase: '/uploads/avatars', prefix: 'av_', auditAction: 'user.avatar_upload' })));
api.post('/settings/customer-display/image-upload', guardAny('settings.manage', 'settings.branch'), wrap((req) =>
  saveBase64Image(req, {
    dir: CUSTOMER_DISPLAY_UPLOADS_DIR, urlBase: '/uploads/customer-display',
    prefix: 'display_', auditAction: 'customer_display.image_upload',
  })));
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
  const out = AppSettings.updateSettings(req.body, branch_id);
  // BÁO CHO MỌI MÁY KHÁC BIẾT NGAY.
  //
  // Trước đây lưu cấu hình KHÔNG phát event nào: máy A thêm một máy in, máy B
  // đang mở đúng màn Kết nối vẫn thấy danh sách cũ cho tới khi bấm tải lại hoặc
  // chuyển tab. Người dùng tưởng thao tác không ăn nên khai lại lần nữa — sinh
  // ra tuyến in trùng.
  //
  // Gửi kèm danh sách KHOÁ vừa đổi để mỗi màn tự quyết có cần tải lại không:
  // màn Kết nối chỉ quan tâm 'print_config', không việc gì phải giật mình vì
  // ai đó sửa cấu hình thuế.
  emit('settings:updated', {
    keys: Object.keys(req.body || {}),
    by: actor(req),
  }, branch_id);
  return out;
}));
api.post('/templates/auto-save', guardAny('settings.print'), wrap((req) => AppSettings.autoSaveTemplate(req.body, branch(req))));
api.get('/settings/integrations', guardAny('settings.integrations'), wrap((req) => AppSettings.getPublicIntegrations(branch(req))));
api.post('/settings/integrations', guardAny('settings.integrations'), wrap((req) => {
  const branch_id = branch(req);
  const pin = req.body?.security_pin;
  if (req.body) delete req.body.security_pin;
  const approvedBy = Auth.verifyManagerOwnerPin(pin, branch_id);
  if (!approvedBy) throw new Error('Cần nhập PIN của Manager hoặc Admin để xác nhận thay đổi cấu hình liên kết đối tác.');
  const incomingMisa = req.body?.channels?.misa;
  if (incomingMisa?.enabled === true) {
    const cfg = AppSettings.mergeIntegrationChannelSecrets('misa', incomingMisa, branch_id);
    const blockers = Misa.activationBlockers(cfg);
    if (blockers.length) throw new Error(`Chưa thể kích hoạt MISA: ${blockers.join('; ')}.`);
  }
  // ÉP LOẠI TRỪ ĐƯỜNG NHẬN CHUYỂN KHOẢN.
  //
  // Bật hai cổng QR cùng lúc thì khách quét mã của cổng này, hệ thống lại chờ
  // tiền về theo cổng kia — tiền vào rồi mà bill không tự đóng. Chốt ở SERVER
  // chứ không chỉ ở giao diện: cửa hàng có nhiều máy, người này bật SePay ở máy
  // A trong khi người kia bật payOS ở máy B thì giao diện không cản được.
  const vuaBat = ['payos', 'vietqr', 'sepay', 'casso']
    .find(k => req.body?.channels?.[k]?.enabled === true);
  if (vuaBat && req.body?.channels) {
    req.body.channels = QrProvider.epLoaiTruQr(req.body.channels, vuaBat);
  }

  const haravanWasEnabled = AppSettings.getIntegrationChannel('haravan', branch_id)?.enabled === true;
  const saved = AppSettings.updateIntegrations(req.body, branch_id);
  const haravanIsEnabled = saved?.channels?.haravan?.enabled === true;
  if (haravanWasEnabled !== haravanIsEnabled) {
    audit(
      haravanIsEnabled ? 'integration.haravan.enabled' : 'integration.haravan.disabled',
      {
        status: haravanIsEnabled ? 'active' : 'inactive',
        detail_source: 'haravan_sync_logs',
        message: haravanIsEnabled
          ? 'Haravan đang hoạt động. Bấm xem chi tiết tại màn Liên kết.'
          : 'Haravan đã tắt.',
      },
      branch_id,
      approvedBy.username,
    );
  }
  // Đổi cổng thanh toán là MỌI màn khách phải đổi theo NGAY: màn phụ đang hiện
  // QR cũ, iPad self-order đang ở bước chuyển khoản, catalogue ngoài quầy...
  // Không phát thì khách vẫn quét mã của cổng vừa bị tắt.
  emit('payment:config', { by: approvedBy.username }, branch_id);
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
  // Saving a valid Haravan connection is the trigger: return Settings quickly,
  // then subscribe webhooks and pull the initial snapshot on the server.  The
  // worker continues delta recovery afterwards, so a weak POS never performs
  // the heavy synchronization itself and no manual "push" is required.
  if (saved?.channels?.haravan?.enabled) {
    setTimeout(() => Haravan.syncAllHaravan({ delta: true, subscribe: true }).catch(e => {
      logSystem({
        level: 'error', source: 'haravan', eventType: 'sync_error',
        title: 'Không thể tự đồng bộ Haravan sau khi lưu kết nối', message: e.message,
        branchId: branch_id, username: approvedBy.username, action: 'haravan_sync_all',
        exceptionType: e.name, stackTrace: e.stack,
      });
    }), 0).unref?.();
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
  const routedWebhook = (name) => `${base}/api/${name}/webhook?branch_id=${encodeURIComponent(branch(req))}`;
  if (channel === 'misa') {
    const kq = await Misa.testConnection(cfg);
    // GHI KẾT QUẢ XUỐNG DB — đây là mắt xích từng đứt hẳn.
    //
    // `configurationTestPassed` là một trong các điều kiện bắt buộc để MISA
    // được phép phát hành, nhưng TRƯỚC ĐÂY KHÔNG DÒNG CODE NÀO GHI nó thành
    // true. Nó mặc định false, chỉ được đọc, nên điều kiện kích hoạt không bao
    // giờ đủ → mọi hóa đơn nằm im ở PENDING_PROVIDER và không có gì báo lỗi,
    // vì đó không phải lỗi mà là "chưa cấu hình xong".
    //
    // Cùng lúc lưu luôn tên doanh nghiệp, loại hóa đơn có mã/không mã và danh
    // sách mẫu MISA vừa trả về, để màn Cài đặt có cái mà hiển thị và người
    // dùng chọn mẫu ngay được — không phải gọi lại MISA lần nữa.
    const patch = {
      configurationTestPassed: kq.ok === true,
      lastTestedAt: new Date().toISOString(),
      lastTestError: kq.ok ? '' : String(kq.message || '').slice(0, 500),
      lastTestStatus: kq.status || '',
    };
    if (kq.company) {
      patch.companyName = kq.company.name || cfg.companyName || '';
      if (kq.company.invoiceWithCode !== null && kq.company.invoiceWithCode !== undefined) {
        patch.invoiceCodeType = kq.company.invoiceWithCode ? 'WITH_CODE' : 'WITHOUT_CODE';
      }
    }
    if (Array.isArray(kq.templates)) {
      patch.availableTemplates = JSON.stringify(
        kq.templates.map((t) => ({ id: t.id, name: t.name, series: t.series })),
      ).slice(0, 20000);
    }
    // Ký hiệu hóa đơn LUÔN đi theo mẫu đã chọn, không cho lệch nhau.
    if (kq.selectedTemplate?.series) patch.series = kq.selectedTemplate.series;

    AppSettings.updateIntegrations(
      { channels: { misa: { ...cfg, ...patch } } },
      branch(req),
    );
    return { channel, ...kq };
  }
  if (channel === 'payos') {
    const payosWebhook = routedWebhook('payos');
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
    return { channel, ...Pay.testBankWebhook(channel, cfg, routedWebhook(channel)) };
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
    Print.listPrinters(branch(req), { live: true, force }).catch(() => []),
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
// One live registry derived from the same Socket.IO and print-agent authorities
// used by the Connections screen. Staff device trust remains in auth_sessions;
// do not create a second, stale pairing/approval state machine here.
api.get('/devices', guardAny('settings.devices', 'settings.connections'), wrap((req) => {
  const branchId = branch(req);
  return {
    devices: buildLiveDeviceRegistry(
      getActiveConnections(branchId), System.getAgentDevices(branchId)),
    checked_at: new Date().toISOString(),
  };
}));
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
  const out = await BookMenu.importPubhtml5(req.body.url, req.body.title, b, req.body.kind);
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
// Đăng ký token FCM của thiết bị — cho phép server đẩy thông báo (bản cập
// nhật app, sau này có thể mở rộng gọi phục vụ/đơn mới…) KỂ CẢ KHI APP ĐÃ TẮT.
// Gọi mỗi khi app khởi động/đăng nhập và mỗi khi Firebase phát token mới.
api.post('/device/push-token', guard(), wrap((req) => registerDeviceToken({
  device_id: req.body?.device_id,
  fcm_token: req.body?.fcm_token,
  platform: req.body?.platform,
  user_id: req.user?.id,
}, visibleBranch(req))));
}
