// MISA meInvoice — THÔNG TIN DOANH NGHIỆP và DANH SÁCH MẪU HÓA ĐƠN.
//
// Hai thao tác này TRƯỚC ĐÂY KHÔNG HỀ TỒN TẠI trong code. Hậu quả dây chuyền:
// điều kiện kích hoạt đòi `templateId` nhưng không có đường nào lấy mẫu về, nên
// cấu hình không bao giờ hoàn tất và không một hóa đơn nào được gửi đi.
//
// Tên trường trong response khác nhau giữa các gói dịch vụ MISA, nên chỗ này
// đọc theo NHIỀU TÊN GỌI thay vì bám cứng một cái. Đọc trượt hết thì báo rõ là
// "không đọc được", chứ không im lặng trả rỗng làm người dùng tưởng chưa khai
// mẫu nào trên MISA.

import {
  callJson, authHeaders, authHeadersDeveloperPortal, MisaError, sanitize,
} from './client.js';
import { endpointUrl, isDeveloperPortal } from './config.js';
import { withToken } from './auth.js';
import { businessParts } from '../../core/businessClock.js';

function businessHeaders(token, cfg) {
  return isDeveloperPortal(cfg)
    ? authHeadersDeveloperPortal(token, cfg.clientId)
    : authHeaders(token, cfg.taxCode);
}

function pick(obj, ...names) {
  for (const n of names) {
    if (obj?.[n] !== undefined && obj[n] !== null && obj[n] !== '') return obj[n];
  }
  return undefined;
}

/// Developer Portal khai báo `Data` là string và response thật trả một chuỗi JSON
/// escape (ví dụ `"[{\"IPTemplateID\":...}]"`), không phải mảng JSON trực tiếp.
/// Một số gateway còn bọc chuỗi nhiều hơn một lần, nên giải mã có giới hạn thay
/// vì chỉ gọi JSON.parse đúng một lượt.
function decodeJsonString(value) {
  let decoded = value;
  for (let i = 0; i < 3 && typeof decoded === 'string'; i += 1) {
    const text = decoded.trim();
    if (!text || (!text.startsWith('[') && !text.startsWith('{') && !text.startsWith('"'))) break;
    try {
      decoded = JSON.parse(text);
    } catch {
      break;
    }
  }
  return decoded;
}

function asBoolean(value) {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0') return false;
  }
  if (value === 1) return true;
  if (value === 0) return false;
  return !!value;
}

function assertSuccessfulResponse(body, operation) {
  const success = pick(body, 'Success', 'success', 'IsSuccess', 'isSuccess');
  if (success !== undefined && !asBoolean(success)) {
    const message = String(
      pick(body, 'DescriptionErrorCode', 'ErrorMessage', 'errorMessage', 'Message', 'message')
        || (Array.isArray(body?.Errors) ? body.Errors.join(', ') : '')
        || `MISA từ chối thao tác ${operation}`,
    ).slice(0, 500);
    const code = String(pick(body, 'ErrorCode', 'errorCode', 'Code', 'code') || '').slice(0, 80);
    throw new MisaError(message, { retryable: false, code, body: sanitize(body) });
  }
}

/// MISA bọc dữ liệu theo nhiều kiểu: {data}, {Data}, {data:{items}}, mảng thô…
function unwrap(body) {
  const d = body?.data ?? body?.Data ?? body;
  return decodeJsonString(d) ?? {};
}

function asList(value) {
  const decoded = decodeJsonString(value);
  if (Array.isArray(decoded)) return decoded;
  if (decoded && typeof decoded === 'object'
    && pick(decoded, 'IPTemplateID', 'TemplateID', 'TemplateId', 'templateId', 'Id', 'id')) {
    return [decoded];
  }
  for (const key of ['items', 'Items', 'list', 'List', 'templates', 'Templates', 'data', 'Data']) {
    const nested = decodeJsonString(decoded?.[key]);
    if (Array.isArray(nested)) return nested;
  }
  return [];
}

/// Thông tin doanh nghiệp theo mã số thuế.
///
/// `IsInvoiceWithCode` là trường MISA dùng để nói doanh nghiệp phát hành hóa
/// đơn CÓ MÃ hay KHÔNG CÓ MÃ của cơ quan thuế. Lấy từ đây rồi KHÓA lại, không
/// để người dùng tự chọn — chọn sai là hóa đơn bị cơ quan thuế từ chối.
export async function fetchCompany(cfg) {
  const taxCode = String(cfg.taxCode || '').trim();
  if (!taxCode) throw new Error('Thiếu mã số thuế để tra cứu doanh nghiệp');

  const url = `${endpointUrl(cfg, 'company')}?taxcode=${encodeURIComponent(taxCode)}`;
  const body = await withToken(cfg, (token) => callJson(url, {
    method: 'GET',
    headers: businessHeaders(token, cfg),
  }, 15000));
  assertSuccessfulResponse(body, 'tra cứu doanh nghiệp');

  const d = unwrap(body);
  const traVeMst = String(
    pick(d, 'TaxCode', 'taxCode', 'taxcode', 'CompanyTaxCode') || '',
  ).trim();

  // MISA trả về doanh nghiệp KHÁC với mã số thuế đã nhập → dừng ngay. Đây
  // chính là tình huống "đúng tài khoản nhưng sai MST": để lọt là hóa đơn xuất
  // dưới tên pháp nhân khác.
  if (traVeMst && traVeMst.replace(/\s/g, '') !== taxCode.replace(/\s/g, '')) {
    throw new Error(
      `Mã số thuế không khớp: đã nhập ${taxCode}, tài khoản MISA thuộc về ${traVeMst}.`,
    );
  }

  const coMa = pick(d, 'IsInvoiceWithCode', 'isInvoiceWithCode', 'invoiceWithCode');
  return {
    taxCode: traVeMst || taxCode,
    name: String(pick(d, 'CompanyName', 'companyName', 'Name', 'name') || '').trim(),
    address: String(pick(d, 'Address', 'address') || '').trim(),
    // undefined = MISA không nói gì; giữ null để màn Cài đặt biết là "chưa rõ"
    // thay vì mặc định bừa thành "có mã".
    invoiceWithCode: coMa === undefined ? null : !!coMa,
    active: pick(d, 'IsActive', 'isActive', 'Status', 'status') !== false,
    raw: d,
  };
}

/// Chuẩn hóa một mẫu hóa đơn về đúng những gì hệ thống cần.
function normalizeTemplate(row) {
  // IPTemplateID: field ID THẬT của Developer Portal (xác nhận tài liệu chuẩn
  // 2026-09-19, class InvoiceTemplateData) — khác hẳn TemplateID của v3 cũ.
  const id = String(
    pick(row, 'IPTemplateID', 'TemplateID', 'TemplateId', 'templateId', 'Id', 'id', 'InvTemplateNo') || '',
  ).trim();
  const series = String(
    pick(row, 'InvSeries', 'invSeries', 'Series', 'series', 'Symbol', 'InvoiceSymbol') || '',
  ).trim();
  return {
    id,
    // Ký hiệu hóa đơn LẤY TỪ MẪU, không cho gõ tay: gõ sai là hóa đơn phát
    // hành dưới ký hiệu chưa đăng ký với cơ quan thuế.
    series,
    name: String(
      pick(row, 'TemplateName', 'templateName', 'Name', 'name', 'InvTemplateName') || '',
    ).trim() || series || id,
    invoiceType: String(
      pick(row, 'InvoiceType', 'invoiceType', 'InvTypeID', 'TypeId') || '',
    ).trim(),
    withCode: (() => {
      const v = pick(row, 'IsInvoiceWithCode', 'isInvoiceWithCode', 'InvoiceWithCode');
      return v === undefined ? null : asBoolean(v);
    })(),
    // Developer Portal (InvoiceTemplateData) KHÔNG có field này (xác nhận tài
    // liệu chuẩn) — giữ null khi thiếu để filterTemplates() không loại oan,
    // giống hệt cách withCode xử lý ở trên.
    fromCashRegister: (() => {
      const v = pick(row, 'IsInvoiceCalculatingMachine', 'isInvoiceCalculatingMachine');
      return v === undefined ? null : asBoolean(v);
    })(),
    // Inactive (Developer Portal) và IsActive (v3 cũ) NGƯỢC CỰC NHAU — không
    // được gộp vào chung một lượt pick(), kẻo mẫu đang active thật
    // (Inactive:false) bị tính nhầm thành inactive (đã xảy ra thật, xác nhận
    // 2026-09-19).
    active: (() => {
      const inactive = pick(row, 'Inactive', 'inactive');
      if (inactive !== undefined) return !asBoolean(inactive);
      const isActive = pick(row, 'IsActive', 'isActive');
      return isActive === undefined ? true : asBoolean(isActive);
    })(),
    raw: row,
  };
}

/// Danh sách mẫu hóa đơn CÒN HIỆU LỰC của doanh nghiệp.
export async function fetchTemplates(cfg) {
  let url = endpointUrl(cfg, 'templates');
  if (isDeveloperPortal(cfg)) {
    // Developer Portal: GET /invoice/templates BẮT BUỘC 3 query param theo
    // đúng ví dụ trong tài liệu chuẩn (developer.misa.vn/products-openapi/
    // MEINVOICE, xác nhận thật 2026-09-19) — thiếu là MISA vẫn trả HTTP 200
    // Success:true nhưng Data rỗng, KHÔNG báo lỗi gì để biết mà sửa.
    const invoiceWithCode = String(cfg.invoiceCodeType || '') !== 'WITHOUT_CODE';
    const query = new URLSearchParams({
      invoiceWithCode: String(invoiceWithCode),
      ticket: 'false',
      year: String(businessParts().year),
      // haveTempOld=true: bao gồm cả mẫu kiểu cũ (IsInheritFromOldTemplate) —
      // không có cách nào Dan D Pak biết trước mẫu doanh nghiệp đã đăng ký là
      // kiểu mới hay cũ, nên luôn xin đủ cả hai, để filterTemplates() (payload.js)
      // quyết định mẫu nào dùng được, không phải MISA lọc hộ.
      haveTempOld: 'true',
    });
    url += `?${query}`;
  }
  const body = await withToken(cfg, (token) => callJson(url, {
    method: 'GET',
    headers: businessHeaders(token, cfg),
  }, 15000));
  assertSuccessfulResponse(body, 'lấy danh sách mẫu hóa đơn');

  const payload = unwrap(body);
  if (typeof payload === 'string' && payload.trim()) {
    throw new MisaError('MISA trả dữ liệu mẫu hóa đơn không đúng định dạng JSON.', {
      retryable: false,
      code: 'INVALID_TEMPLATE_DATA',
      body: sanitize(body),
    });
  }
  const rows = asList(payload);
  return rows
    .map(normalizeTemplate)
    // Mẫu không có ký hiệu thì không phát hành được — bày ra chỉ để người dùng
    // chọn rồi hỏng lúc xuất hóa đơn.
    .filter((tpl) => tpl.id && tpl.series && tpl.active);
}

/// Lọc mẫu phù hợp với doanh nghiệp và loại nghiệp vụ đang cấu hình.
/// Mẫu không khai rõ thuộc tính (null) thì KHÔNG loại — MISA có gói không trả
/// mấy cờ này, loại đi là danh sách rỗng oan.
export function filterTemplates(templates, { invoiceWithCode = null, fromCashRegister = null } = {}) {
  return templates.filter((tpl) => {
    if (invoiceWithCode !== null && tpl.withCode !== null && tpl.withCode !== invoiceWithCode) {
      return false;
    }
    if (fromCashRegister === true && tpl.fromCashRegister === false) return false;
    return true;
  });
}
