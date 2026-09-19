// MISA meInvoice — CẤU HÌNH, ĐỊA CHỈ API và ĐIỀU KIỆN KÍCH HOẠT.
//
// Nguyên tắc của cả thư mục này: MISA cấp hợp đồng API riêng cho từng khách
// hàng (đường dẫn, tên trường, mã loại hóa đơn có thể khác nhau giữa các gói
// dịch vụ). Nên MỌI đường dẫn đều CẤU HÌNH ĐƯỢC, có sẵn giá trị mặc định theo
// API v3. Lệch hợp đồng thì sửa trong Cài đặt, KHÔNG phải sửa code rồi build
// lại — đó là điều kiện để "nhập thông tin vào là chạy được liền".

import { env } from '../../config/env.js';

const DEFAULT_BASE = {
  sandbox: 'https://testapi.meinvoice.vn',
  production: 'https://api.meinvoice.vn',
};

/// Cổng gateway MISA Developer Portal (developer.misa.vn) — MỘT địa chỉ duy
/// nhất, không tách sandbox/production theo host như API v3 cũ. Môi trường ở
/// đây do gói subscription MISA cấp quyết định, không phải URL.
const DEVELOPER_PORTAL_BASE = 'https://developer.misa.vn/apis/itg/meinvoice';

export const PROVIDER_KIND = {
  LEGACY_V3: 'MISA_API_V3',
  DEVELOPER_PORTAL: 'MISA_DEVELOPER_PORTAL',
};

/// API nào đang dùng, suy từ credential nào server có + cờ ép buộc
/// MISA_MEINVOICE_PROVIDER (dùng khi cần rollback nhanh về API v3 cũ mà không
/// phải xoá ClientID/ClientSecret đang di trú dở). Có cả hai cặp credential
/// cùng lúc thì Developer Portal (cơ chế mới) được ưu tiên.
export function providerKind() {
  const forced = String(env.MISA_MEINVOICE_PROVIDER || '').trim().toLowerCase();
  if (forced === 'developer_portal') return PROVIDER_KIND.DEVELOPER_PORTAL;
  if (forced === 'legacy_v3') return PROVIDER_KIND.LEGACY_V3;
  const hasPortalCreds = !!String(env.MISA_MEINVOICE_CLIENT_ID || '').trim()
    && !!String(env.MISA_MEINVOICE_CLIENT_SECRET || '').trim();
  return hasPortalCreds ? PROVIDER_KIND.DEVELOPER_PORTAL : PROVIDER_KIND.LEGACY_V3;
}

/// AppID (v3 cũ) hoặc ClientID/ClientSecret (Developer Portal mới) do MISA cấp
/// cho Dan D Pak POS — luôn từ biến môi trường server, KHÔNG BAO GIỜ từ cấu
/// hình theo chi nhánh/Flutter (§L). Cửa hàng chỉ nhập tài khoản MISA meInvoice
/// của họ; credential ứng dụng dùng chung mọi chi nhánh.
export function serverConfigured() {
  if (providerKind() === PROVIDER_KIND.DEVELOPER_PORTAL) {
    return !!String(env.MISA_MEINVOICE_CLIENT_ID || '').trim()
      && !!String(env.MISA_MEINVOICE_CLIENT_SECRET || '').trim();
  }
  return !!String(env.MISA_MEINVOICE_APP_ID || '').trim();
}

/// Ghép cấu hình đã lưu theo chi nhánh với credential ứng dụng ở server. Mọi
/// nơi gọi MISA (worker, testConnection, activationBlockers) PHẢI đi qua đây
/// thay vì đọc thẳng cfg từ DB, để appId/clientId/clientSecret/apiBase/
/// environment không bao giờ lấy từ dữ liệu do Flutter gửi lên.
export function resolveServerCredentials(cfg = {}) {
  const kind = providerKind();
  if (kind === PROVIDER_KIND.DEVELOPER_PORTAL) {
    return {
      ...cfg,
      appId: '',
      clientId: String(env.MISA_MEINVOICE_CLIENT_ID || '').trim(),
      clientSecret: String(env.MISA_MEINVOICE_CLIENT_SECRET || '').trim(),
      apiBase: String(env.MISA_MEINVOICE_BASE_URL || '').trim(),
      environment: String(env.MISA_MEINVOICE_ENV || '').trim() || cfg.environment || 'sandbox',
      integrationType: PROVIDER_KIND.DEVELOPER_PORTAL,
      secretKey: '',
    };
  }
  return {
    ...cfg,
    appId: String(env.MISA_MEINVOICE_APP_ID || '').trim(),
    clientId: '',
    clientSecret: '',
    apiBase: String(env.MISA_MEINVOICE_BASE_URL || '').trim(),
    environment: String(env.MISA_MEINVOICE_ENV || '').trim() || cfg.environment || 'sandbox',
    // Chỉ v3 được hỗ trợ — không còn "Loại API MISA" để người dùng chọn.
    integrationType: PROVIDER_KIND.LEGACY_V3,
    secretKey: '',
  };
}

/// Đường dẫn mặc định theo MISA meInvoice API v3. Ghi đè từng cái một qua
/// `cfg.endpoints` — không cần khai đủ, thiếu cái nào thì dùng mặc định.
export const DEFAULT_ENDPOINTS = {
  auth: '/auth/token',
  company: '/company',
  templates: '/invoice-templates',
  publish: '/code/itg/invoice-calculating/invoiceandpublish',
  status: '/invoice/status',
  cancel: '/invoice/cancel',
};

/// Đường dẫn mặc định theo MISA Developer Portal. `auth`/`templates`/`publish`
/// lấy ĐÚNG NGUYÊN VĂN từ tài liệu chuẩn (developer.misa.vn/products-openapi/
/// MEINVOICE). `status`/`view`/`cancel` KHÔNG có trong tài liệu đưa xuống —
/// đây là PHỎNG ĐOÁN theo quy ước đặt tên của 3 đường dẫn đã xác nhận, cấu
/// hình lại qua endpointStatus/endpointView/endpointCancel khi có tài liệu đầy
/// đủ hoặc kiểm thử sandbox thật xác nhận đường dẫn khác. Xem báo cáo bàn giao.
export const DEFAULT_ENDPOINTS_DEVELOPER_PORTAL = {
  auth: '/invoice/token',
  templates: '/invoice/templates',
  unpublishview: '/invoice/unpublishview',
  publish: '/invoice/publishing',
  // sendEmail/download: ĐÃ XÁC NHẬN từ tài liệu chuẩn (developer.misa.vn/
  // products-openapi/MEINVOICE, 2026-09-19) — bao gồm cả query bắt buộc
  // (xem invoice.js::sendInvoiceEmail/downloadInvoiceFile).
  sendEmail: '/invoice/sendemail',
  download: '/invoice/Download',
  publishView: '/invoice/publishview',
  // GIẢ ĐỊNH CHƯA XÁC MINH — xem chú thích trên.
  status: '/invoice/status',
  view: '/invoice/view',
  cancel: '/invoice/cancel',
};

/// Trạng thái cấu hình — dùng chung cho API trả về và cho màn Cài đặt.
export const CONFIG_STATUS = {
  DISCONNECTED: 'DISCONNECTED',
  // Server chưa có MISA_MEINVOICE_APP_ID — lỗi hạ tầng, không phải lỗi tài
  // khoản, nên tách riêng khỏi ERROR để không bắt cửa hàng tự loay hoay.
  SERVER_NOT_CONFIGURED: 'SERVER_NOT_CONFIGURED',
  AUTHENTICATED: 'AUTHENTICATED',
  REQUIRES_TEMPLATE: 'REQUIRES_TEMPLATE',
  // Đăng nhập được nhưng bước sau (tra doanh nghiệp/mẫu) lỗi — kết nối còn đó,
  // dữ liệu MISA đang có vấn đề.
  DEGRADED: 'DEGRADED',
  // Bước đăng nhập chính là bước lỗi — sai tài khoản/mật khẩu hoặc phiên hết.
  REAUTH_REQUIRED: 'REAUTH_REQUIRED',
  READY: 'READY',
  ERROR: 'ERROR',
};

export function isProduction(cfg = {}) {
  return String(cfg.environment || 'sandbox') === 'production';
}

export function isDeveloperPortal(cfg = {}) {
  return cfg.integrationType === PROVIDER_KIND.DEVELOPER_PORTAL;
}

/// Xac dinh hoa don khoi tao tu may tinh tien tu KY HIEU mau da chon.
/// invoiceType co the bi cu sau khi nguoi dung doi mau; ky hieu MISA moi la
/// nguon su that (1C26MBM/C26MBM = MTT, 1C26TBM/C26TBM = hoa don thuong).
export function isCashRegisterInvoice(cfg = {}) {
  const series = String(cfg.series || '').trim().toUpperCase();
  if (/^\d?[CK]\d{2}[A-Z]/.test(series)) return /^\d?[CK]\d{2}M/.test(series);
  return String(cfg.invoiceType || '') === 'CASH_REGISTER';
}

/// Địa chỉ gốc. `apiBase` do người dùng nhập được ưu tiên, nhưng phải là http(s)
/// hợp lệ; không thì rơi về mặc định theo môi trường/provider.
export function baseUrl(cfg = {}) {
  const custom = String(cfg.apiBase || '').trim();
  if (isDeveloperPortal(cfg)) {
    // Developer Portal: MỘT gateway duy nhất, không tách host theo môi trường.
    return /^https?:\/\//i.test(custom) ? custom.replace(/\/+$/, '') : DEVELOPER_PORTAL_BASE;
  }
  let base = '';
  if (/^https?:\/\//i.test(custom)) {
    base = custom.replace(/\/+$/, '');
  } else {
    base = DEFAULT_BASE[isProduction(cfg) ? 'production' : 'sandbox'];
  }
  // Chỉ tự thêm /api/v3 khi người dùng chưa tự ghi phiên bản nào — họ khai
  // /api/v2 thì phải tôn trọng, không được ghép chồng thành /api/v2/api/v3.
  if (!/\/api\/v\d+(\/|$)/i.test(base)) base += '/api/v3';
  return base;
}

/// Khóa phẳng tương ứng trong cấu hình đã lưu (`endpointAuth`, `endpointCompany`…).
/// Dùng khóa phẳng vì bộ chuẩn hóa cấu hình chỉ giữ đúng những khóa có trong
/// schema — một object lồng nhau sẽ bị loại khi lưu.
function overrideKey(name) {
  return `endpoint${name.charAt(0).toUpperCase()}${name.slice(1)}`;
}

/// Ghép URL đầy đủ cho một thao tác. [name] là khóa trong DEFAULT_ENDPOINTS
/// (hoặc DEFAULT_ENDPOINTS_DEVELOPER_PORTAL tuỳ provider của cfg).
export function endpointUrl(cfg, name) {
  const defaults = isDeveloperPortal(cfg) ? DEFAULT_ENDPOINTS_DEVELOPER_PORTAL : DEFAULT_ENDPOINTS;
  const nested = cfg?.endpoints && typeof cfg.endpoints === 'object' ? cfg.endpoints : {};
  const path = String(
    cfg?.[overrideKey(name)] || nested[name] || defaults[name] || '',
  ).trim();
  if (!path) throw new Error(`Chưa khai đường dẫn API MISA cho thao tác "${name}"`);
  // Khai nguyên URL tuyệt đối cũng chấp nhận — có gói dịch vụ đặt vài thao tác
  // ở tên miền khác.
  if (/^https?:\/\//i.test(path)) return path;
  return baseUrl(cfg) + (path.startsWith('/') ? path : `/${path}`);
}

/// Môi trường và địa chỉ phải khớp nhau. Đây là chốt chặn NGHIÊM TÚC: bấm nhầm
/// "sandbox" trong khi apiBase trỏ production nghĩa là phát hành hóa đơn THẬT
/// lên cơ quan thuế trong lúc tưởng đang test.
/// CHỈ báo lệch khi CHẮC CHẮN sai, tức là địa chỉ trỏ đúng vào máy chủ CÔNG
/// KHAI của môi trường kia. Doanh nghiệp dùng cổng riêng / on-prem / máy chủ
/// nội bộ thì hệ thống KHÔNG có cơ sở để phán đoán — cấm bừa ở đây là chặn
/// người dùng hợp lệ, tệ hơn cả không kiểm.
export function environmentMismatch(cfg = {}) {
  const custom = String(cfg.apiBase || '').trim().toLowerCase();
  if (!/^https?:\/\//.test(custom)) return '';

  let host = '';
  try {
    host = new URL(custom).hostname;
  } catch {
    return '';
  }
  const laMayTest = host === 'testapi.meinvoice.vn';
  const laMayThat = host === 'api.meinvoice.vn';

  if (isProduction(cfg) && laMayTest) {
    return 'Môi trường đang chọn PRODUCTION nhưng địa chỉ API là máy chủ TEST của MISA.';
  }
  if (!isProduction(cfg) && laMayThat) {
    return 'Môi trường đang chọn SANDBOX nhưng địa chỉ API là máy chủ THẬT của MISA — '
      + 'phát hành ở đây là hóa đơn thật gửi cơ quan thuế.';
  }
  return '';
}

/// Những gì còn thiếu để được phép phát hành hóa đơn thật.
///
/// KHÔNG còn đòi `environment === 'production'`: bắt buộc production mới chạy
/// được thì không thể nghiệm thu trên sandbox, mà nghiệm thu thẳng trên
/// production nghĩa là phát hành hóa đơn thật cho cơ quan thuế để thử.
export function activationBlockers(cfg = {}) {
  const blockers = [];
  if (!serverConfigured()) {
    blockers.push(providerKind() === PROVIDER_KIND.DEVELOPER_PORTAL
      ? 'Cấu hình tích hợp phía server chưa đầy đủ (thiếu MISA_MEINVOICE_CLIENT_ID/MISA_MEINVOICE_CLIENT_SECRET)'
      : 'Cấu hình tích hợp phía server chưa đầy đủ (thiếu MISA_MEINVOICE_APP_ID)');
  }
  if (!cfg.taxCode || !cfg.username || !cfg.password) {
    blockers.push('Thiếu mã số thuế / tài khoản / mật khẩu MISA');
  }
  if (!cfg.templateId) blockers.push('Chưa chọn mẫu hóa đơn từ MISA');
  if (!cfg.series) blockers.push('Chưa có ký hiệu hóa đơn (lấy theo mẫu đã chọn)');
  if (cfg.configurationTestPassed !== true) {
    blockers.push('Chưa kiểm tra kết nối thành công');
  }
  const lech = environmentMismatch(cfg);
  if (lech) blockers.push(lech);
  return blockers;
}

/// Đủ điều kiện gọi MISA thật hay chưa.
export function isLive(cfg = {}) {
  return !!cfg.enabled && activationBlockers(cfg).length === 0;
}

/// Trạng thái cấu hình để hiển thị, suy từ chính dữ liệu đang lưu.
export function configStatus(cfg = {}) {
  if (!serverConfigured()) return CONFIG_STATUS.SERVER_NOT_CONFIGURED;
  if (!cfg.enabled) return CONFIG_STATUS.DISCONNECTED;
  if (isLive(cfg)) return CONFIG_STATUS.READY;
  if (cfg.configurationTestPassed === true && !cfg.templateId) {
    return CONFIG_STATUS.REQUIRES_TEMPLATE;
  }
  // Lần kiểm tra gần nhất lỗi ngay ở bước đăng nhập — sai tài khoản/mật khẩu
  // hoặc phiên MISA hết hạn, cần đăng nhập lại chứ không phải lỗi dữ liệu.
  if (cfg.lastTestStep === 'auth') return CONFIG_STATUS.REAUTH_REQUIRED;
  // Đăng nhập qua được nhưng bước tra doanh nghiệp/mẫu hóa đơn lỗi — kết nối
  // còn đó, dữ liệu phía MISA đang có vấn đề.
  if (cfg.lastTestStep === 'company' || cfg.lastTestStep === 'templates') {
    return CONFIG_STATUS.DEGRADED;
  }
  if (cfg.lastTestError) return CONFIG_STATUS.ERROR;
  return CONFIG_STATUS.DISCONNECTED;
}
