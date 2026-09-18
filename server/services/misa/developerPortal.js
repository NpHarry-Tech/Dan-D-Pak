// MISA meInvoice — ADAPTER cho MISA DEVELOPER PORTAL (developer.misa.vn), cơ
// chế thay thế API v3 cũ (api.meinvoice.vn / testapi.meinvoice.vn).
//
// Khác biệt cấu trúc so với v3 (xử lý trong auth.js/company.js/invoice.js bằng
// cách gọi các hàm ở đây, KHÔNG lặp lại code phần đã dùng chung được — build
// payload/toán VAT vẫn nguyên vẹn từ payload.js):
//   - Đăng nhập: ClientID/ClientSecret ở HEADER (không phải `appid` trong
//     body); response vẫn đọc bằng tokenFrom/expiryFrom dùng chung (client.js).
//   - Request nghiệp vụ: header ClientID thay vì CompanyTaxCode.
//   - Phát hành: BATCH — request là MẢNG hóa đơn, response trả mảng
//     `publishInvoiceResult` (một phần tử/hóa đơn), có thể trả lỗi RIÊNG cho
//     từng hóa đơn dù HTTP 200. Dan D Pak luôn gửi mảng ĐÚNG MỘT phần tử (một
//     bill – một hóa đơn, worker xử lý tuần tự từng job) — không cần dựng cơ
//     chế xếp lô 30 hóa đơn/request vì nghiệp vụ không bao giờ phát sinh nhu
//     cầu đó; xem "skipped" trong báo cáo bàn giao.
//
// GIẢ ĐỊNH CHƯA XÁC MINH (không có trong tài liệu MISA đưa xuống lúc viết
// adapter này — chỉ có đặc tả cho auth/templates/publish):
//   - Tên khóa bọc mảng trong request publish (`Data`) và field trong từng
//     phần tử `publishInvoiceResult` (IsSuccess/RefID/TransactionID/InvNo/…) —
//     suy theo đúng TÊN TRƯỜNG đã được liệt kê rõ trong yêu cầu bàn giao
//     (RefID, TransactionID, InvNo, InvCode, InvSeries, InvTemplateNo), đọc
//     rộng theo nhiều cách viết hoa/thường như company.js đã làm với v3.
//   - Đường dẫn status/view/download/cancel (xem DEFAULT_ENDPOINTS_DEVELOPER_
//     PORTAL trong config.js).
// PHẢI xác nhận lại bằng tài liệu API đầy đủ hoặc kiểm thử sandbox thật khi
// MISA cấp ClientID/ClientSecret — xem "Blocker" trong báo cáo bàn giao.

import { callJson, MisaError, sanitize, tokenFrom, expiryFrom, authHeadersDeveloperPortal } from './client.js';
import { endpointUrl } from './config.js';

export async function loginDeveloperPortal(cfg) {
  const url = endpointUrl(cfg, 'auth');
  const body = await callJson(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ClientID: cfg.clientId || '',
      ClientSecret: cfg.clientSecret || '',
    },
    body: JSON.stringify({
      taxcode: cfg.taxCode || '',
      username: cfg.username || '',
      password: cfg.password || '',
    }),
  }, 15000);

  const token = tokenFrom(body);
  if (!token) {
    throw new MisaError(
      'MISA Developer Portal không trả về token — kiểm tra ClientID/ClientSecret, mã số thuế, tài khoản, mật khẩu.',
      { retryable: false, code: 'NO_TOKEN' },
    );
  }
  return { token, expiresAt: expiryFrom(body) };
}

function pick(obj, ...names) {
  for (const n of names) {
    if (obj?.[n] !== undefined && obj[n] !== null && obj[n] !== '') return obj[n];
  }
  return undefined;
}

/// Bọc MỘT hóa đơn (payload từ payload.js::buildPublishPayload) thành request
/// batch của Developer Portal. Luôn đúng 1 phần tử — xem ghi chú đầu file.
export function buildPublishEnvelope(payload) {
  return { Data: [payload] };
}

/// Mã lỗi nghiệp vụ MISA trả TRONG `publishInvoiceResult[i]` dù HTTP 200 —
/// phải phân loại retryable RIÊNG, không dựa vào status code như client.js.
const RETRYABLE_PORTAL_CODES = new Set(['InvoiceNumberNotCotinuous', 'SystemError']);
const DUPLICATE_PORTAL_CODES = new Set(['InvoiceDuplicated']);

export function classifyPortalErrorCode(code) {
  const c = String(code || '');
  if (DUPLICATE_PORTAL_CODES.has(c)) return 'duplicate';
  if (RETRYABLE_PORTAL_CODES.has(c)) return 'retryable';
  return 'data_error';
}

/// Trích ĐÚNG phần tử của [ref] trong `publishInvoiceResult`. MISA có thể trả
/// mảng không đúng thứ tự gửi lên — luôn khớp lại bằng RefID, không dùng index.
function findResultFor(body, ref) {
  const results = body?.publishInvoiceResult || body?.PublishInvoiceResult
    || body?.data?.publishInvoiceResult || body?.Data?.PublishInvoiceResult || [];
  const list = Array.isArray(results) ? results : [results];
  if (list.length === 1) return list[0];
  return list.find((r) => pick(r, 'RefID', 'refId', 'ref_id') === ref) || list[0];
}

/// Kết quả tổng của request (khác kết quả từng hóa đơn — MISA có thể từ chối
/// CẢ REQUEST trước khi xử lý phần tử nào, vd sai ClientID hoặc payload rỗng).
function requestLevelError(body) {
  const ok = pick(body, 'IsSuccess', 'isSuccess', 'success', 'Success');
  if (ok === false) {
    return messageAndCode(body);
  }
  return null;
}

function messageAndCode(d) {
  const message = String(
    pick(d, 'ErrorMessage', 'errorMessage', 'Message', 'message') || 'MISA từ chối request',
  ).slice(0, 500);
  const code = String(pick(d, 'ErrorCode', 'errorCode', 'Code', 'code') || '').slice(0, 80);
  return { message, code };
}

/// Chuẩn hóa kết quả phát hành thành công về CÙNG hình dạng với invoice.js
/// (normalizeResult của v3) — để phần gọi (issueInvoice) không cần biết đang
/// dùng provider nào.
function normalizePortalResult(d) {
  return {
    provider: 'misa',
    invoice_no: String(pick(d, 'InvNo', 'invNo', 'invoiceNo', 'InvoiceNo') || ''),
    series: String(pick(d, 'InvSeries', 'invSeries', 'Series') || ''),
    lookup_code: String(pick(d, 'InvCode', 'invCode', 'LookupCode', 'lookupCode') || ''),
    transaction_id: String(pick(d, 'TransactionID', 'transactionId', 'TransactionId') || ''),
    tax_authority_code: String(
      pick(d, 'TaxAuthorityCode', 'taxAuthorityCode', 'CQTCode') || '',
    ),
    lookup_url: String(pick(d, 'lookupUrl', 'LookupUrl', 'ViewUrl') || 'https://www.meinvoice.vn/tra-cuu'),
    template_no: String(pick(d, 'InvTemplateNo', 'invTemplateNo', 'TemplateID') || ''),
    raw: sanitize(d),
  };
}

/// Gửi phát hành tới Developer Portal và trả kết quả CHUẨN HÓA, hoặc ném
/// MisaError đã phân loại đúng theo mã lỗi nghiệp vụ (không chỉ HTTP status).
export async function publishDeveloperPortal({ url, token, clientId, payload }) {
  const body = await callJson(url, {
    method: 'POST',
    headers: authHeadersDeveloperPortal(token, clientId),
    body: JSON.stringify(buildPublishEnvelope(payload)),
  }, 25000);

  const reqErr = requestLevelError(body);
  if (reqErr) {
    throw new MisaError(reqErr.message, {
      retryable: classifyPortalErrorCode(reqErr.code) === 'retryable',
      code: reqErr.code,
      body: sanitize(body),
    });
  }

  const result = findResultFor(body, payload.RefID);
  if (!result) {
    throw new MisaError('MISA Developer Portal không trả kết quả cho hóa đơn đã gửi.', {
      retryable: true, code: 'EMPTY_RESULT', body: sanitize(body),
    });
  }

  const elemOk = pick(result, 'IsSuccess', 'isSuccess', 'success', 'Success');
  if (elemOk === false) {
    const { message, code } = messageAndCode(result);
    // `code` giữ NGUYÊN VĂN mã lỗi MISA (vd 'InvoiceDuplicated') — invoice.js
    // nhận diện đúng mã này để tra trạng thái cũ thay vì coi là hóa đơn mới,
    // theo quy tắc "InvoiceDuplicated: không tạo RefID mới, phải tra kết quả cũ".
    throw new MisaError(message, {
      retryable: classifyPortalErrorCode(code) === 'retryable',
      code,
      body: sanitize(result),
    });
  }

  return normalizePortalResult(result);
}
