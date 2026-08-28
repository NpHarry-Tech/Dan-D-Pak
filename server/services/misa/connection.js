// MISA meInvoice — KIỂM TRA KẾT NỐI.
//
// Bản trước chỉ lấy token rồi báo "sẵn sàng phát hành hóa đơn thật". Có token
// mới chỉ chứng minh tài khoản đăng nhập được; nó KHÔNG chứng minh mã số thuế
// đúng doanh nghiệp, cũng không chứng minh có mẫu hóa đơn nào để phát hành.
// Báo "sẵn sàng" ở đó là hứa suông: tới lúc bán thật mới vỡ.
//
// Giờ chạy đủ BA BƯỚC và chỉ bước nào qua mới được tính:
//   1. Đăng nhập lấy token.
//   2. Tra doanh nghiệp theo mã số thuế → xác nhận đúng pháp nhân, lấy loại
//      hóa đơn có mã / không mã.
//   3. Tải danh sách mẫu hóa đơn còn hiệu lực.
//
// Chưa có mẫu hợp lệ thì trạng thái là REQUIRES_TEMPLATE — kết nối đúng nhưng
// CHƯA được bật tự phát hành.

import { CONFIG_STATUS, activationBlockers, environmentMismatch, baseUrl } from './config.js';
import { getToken } from './auth.js';
import { fetchCompany, fetchTemplates, filterTemplates } from './company.js';

function baoLoi(step, message, extra = {}) {
  return {
    ok: false,
    status: CONFIG_STATUS.ERROR,
    step,
    message,
    ...extra,
  };
}

/// Kiểm tra kết nối. KHÔNG ghi DB — người gọi (route) quyết định lưu gì.
export async function testConnection(cfg = {}) {
  // Thiếu thông tin cơ bản thì khỏi làm phiền MISA.
  const thieu = [];
  if (!String(cfg.taxCode || '').trim()) thieu.push('mã số thuế');
  if (!String(cfg.username || '').trim()) thieu.push('tên đăng nhập');
  if (!String(cfg.password || '').trim()) thieu.push('mật khẩu');
  if (thieu.length) {
    return baoLoi('validate', `Thiếu ${thieu.join(', ')}.`);
  }

  // Chọn sandbox mà trỏ địa chỉ production (hoặc ngược lại) là tai nạn thật:
  // "thử" một cái là hóa đơn thật bay lên cơ quan thuế.
  const lech = environmentMismatch(cfg);
  if (lech) return baoLoi('validate', lech);

  // ── Bước 1: token ────────────────────────────────────────────────────────
  try {
    await getToken(cfg, { force: true });
  } catch (e) {
    return baoLoi('auth', e.message || 'Không đăng nhập được MISA');
  }

  // ── Bước 2: doanh nghiệp ─────────────────────────────────────────────────
  let company;
  try {
    company = await fetchCompany(cfg);
  } catch (e) {
    return baoLoi('company', e.message || 'Không tra được thông tin doanh nghiệp', {
      // Token đã lấy được — nói rõ để người dùng biết sai ở khâu nào.
      authenticated: true,
    });
  }
  if (company.active === false) {
    return baoLoi('company', 'Doanh nghiệp đang không hoạt động trên MISA.', {
      authenticated: true, company,
    });
  }

  // ── Bước 3: mẫu hóa đơn ──────────────────────────────────────────────────
  let templates = [];
  try {
    templates = await fetchTemplates(cfg);
  } catch (e) {
    return baoLoi('templates', e.message || 'Không tải được danh sách mẫu hóa đơn', {
      authenticated: true, company,
    });
  }

  const phuHop = filterTemplates(templates, {
    invoiceWithCode: company.invoiceWithCode,
    fromCashRegister: String(cfg.invoiceType || '') === 'CASH_REGISTER' ? true : null,
  });

  const base = baseUrl(cfg);
  if (!phuHop.length) {
    return {
      ok: false,
      status: CONFIG_STATUS.REQUIRES_TEMPLATE,
      step: 'templates',
      authenticated: true,
      company,
      templates,
      baseUrl: base,
      message: templates.length
        ? 'Đăng nhập được nhưng không có mẫu hóa đơn nào phù hợp loại hóa đơn đang chọn. '
          + 'Kiểm tra lại loại nghiệp vụ hoặc khai mẫu trên MISA.'
        : 'Đăng nhập được nhưng doanh nghiệp chưa có mẫu hóa đơn nào còn hiệu lực trên MISA.',
    };
  }

  // Đã chọn mẫu rồi thì mẫu đó phải còn nằm trong danh sách — mẫu bị MISA ngừng
  // sử dụng mà vẫn giữ trong cấu hình là hóa đơn sẽ hỏng lúc phát hành.
  const dangChon = String(cfg.templateId || '').trim();
  const conHieuLuc = dangChon ? phuHop.find((t) => t.id === dangChon) : null;
  if (dangChon && !conHieuLuc) {
    return {
      ok: false,
      status: CONFIG_STATUS.REQUIRES_TEMPLATE,
      step: 'templates',
      authenticated: true,
      company,
      templates: phuHop,
      baseUrl: base,
      message: `Mẫu hóa đơn đang chọn (${dangChon}) không còn hiệu lực trên MISA — chọn lại mẫu khác.`,
    };
  }

  const sauKhiChon = {
    ...cfg,
    templateId: dangChon || '',
    series: conHieuLuc?.series || cfg.series || '',
    configurationTestPassed: true,
  };
  const blockers = activationBlockers(sauKhiChon);

  return {
    ok: true,
    status: blockers.length ? CONFIG_STATUS.AUTHENTICATED : CONFIG_STATUS.READY,
    step: 'done',
    authenticated: true,
    company,
    templates: phuHop,
    selectedTemplate: conHieuLuc || null,
    baseUrl: base,
    environment: cfg.environment || 'sandbox',
    blockers,
    checkedAt: new Date().toISOString(),
    message: blockers.length
      ? `Kết nối MISA thành công (${company.name || company.taxCode}). Còn thiếu: ${blockers.join('; ')}.`
      : `Sẵn sàng phát hành hóa đơn cho ${company.name || company.taxCode}.`,
  };
}
