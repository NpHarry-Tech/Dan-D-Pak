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

/// AppID do MISA cấp cho Dan D Pak POS — luôn từ biến môi trường server,
/// KHÔNG BAO GIỜ từ cấu hình theo chi nhánh/Flutter (§L). Cửa hàng chỉ nhập
/// tài khoản MISA meInvoice của họ; AppID là của ỨNG DỤNG, dùng chung.
export function serverConfigured() {
  return !!String(env.MISA_MEINVOICE_APP_ID || '').trim();
}

/// Ghép cấu hình đã lưu theo chi nhánh với credential ứng dụng ở server. Mọi
/// nơi gọi MISA (worker, testConnection, activationBlockers) PHẢI đi qua đây
/// thay vì đọc thẳng cfg từ DB, để appId/apiBase/environment không bao giờ lấy
/// từ dữ liệu do Flutter gửi lên.
export function resolveServerCredentials(cfg = {}) {
  return {
    ...cfg,
    appId: String(env.MISA_MEINVOICE_APP_ID || '').trim(),
    apiBase: String(env.MISA_MEINVOICE_BASE_URL || '').trim(),
    environment: String(env.MISA_MEINVOICE_ENV || '').trim() || cfg.environment || 'sandbox',
    // Chỉ v3 được hỗ trợ — không còn "Loại API MISA" để người dùng chọn.
    integrationType: 'MISA_API_V3',
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

/// Địa chỉ gốc. `apiBase` do người dùng nhập được ưu tiên, nhưng phải là http(s)
/// hợp lệ; không thì rơi về mặc định theo môi trường.
export function baseUrl(cfg = {}) {
  let base = '';
  const custom = String(cfg.apiBase || '').trim();
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

/// Ghép URL đầy đủ cho một thao tác. [name] là khóa trong DEFAULT_ENDPOINTS.
export function endpointUrl(cfg, name) {
  const nested = cfg?.endpoints && typeof cfg.endpoints === 'object' ? cfg.endpoints : {};
  const path = String(
    cfg?.[overrideKey(name)] || nested[name] || DEFAULT_ENDPOINTS[name] || '',
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
    blockers.push('Cấu hình tích hợp phía server chưa đầy đủ (thiếu MISA_MEINVOICE_APP_ID)');
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
