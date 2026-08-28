// MISA meInvoice — LỚP HTTP và PHÂN LOẠI LỖI.
//
// Vì sao phải phân loại: worker phát hành hóa đơn retry tới 10 lần. Lỗi mạng
// thì retry là đúng. Nhưng SAI MÃ SỐ THUẾ hay THIẾU TRƯỜNG BẮT BUỘC mà cũng
// retry 10 lần thì chỉ tốn thời gian rồi vẫn hỏng, còn người vận hành thì đợi
// hàng chục phút mới thấy báo lỗi thật. Mỗi lỗi ném ra từ đây đều mang cờ
// `retryable` để worker quyết định đúng ngay lần đầu.

/// Lỗi có mang phân loại. `retryable=false` = lỗi DỮ LIỆU, đừng thử lại.
export class MisaError extends Error {
  constructor(message, { retryable = false, status = 0, code = '', body = null } = {}) {
    super(message);
    this.name = 'MisaError';
    this.retryable = retryable;
    this.httpStatus = status;
    this.misaCode = code;
    this.body = body;
  }
}

const MAX_LOG_BODY = 4000;

/// Cắt bỏ mọi thứ nhạy cảm trước khi ghi log / lưu DB.
/// KHÔNG BAO GIỜ để token, mật khẩu, appId lọt vào nhật ký.
export function sanitize(value) {
  if (value == null) return value;
  if (typeof value === 'string') {
    return value
      .replace(/(Bearer\s+)[A-Za-z0-9._\-]+/gi, '$1<token>')
      .slice(0, MAX_LOG_BODY);
  }
  if (Array.isArray(value)) return value.map(sanitize);
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (/password|token|secret|apikey|appid|authorization/i.test(k)) {
        out[k] = v ? '<da-che>' : '';
      } else {
        out[k] = sanitize(v);
      }
    }
    return out;
  }
  return value;
}

function classify(status, body) {
  // 401/403: token hỏng hoặc hết hạn. Cho phép thử lại MỘT lần sau khi lấy
  // token mới — auth.js xử lý, nên đánh dấu retryable.
  if (status === 401 || status === 403) return true;
  if (status === 408 || status === 429) return true;
  if (status >= 500) return true;
  // 4xx còn lại là lỗi dữ liệu của mình gửi lên — thử lại vô ích.
  if (status >= 400) return false;
  return false;
}

function messageOf(body, status) {
  if (!body) return `HTTP ${status}`;
  return String(
    body.message
      || body.Message
      || body.error
      || body.errorMessage
      || body.ErrorMessage
      || (typeof body.raw === 'string' ? body.raw : '')
      || `HTTP ${status}`,
  ).slice(0, 500);
}

function codeOf(body) {
  if (!body) return '';
  return String(body.errorCode || body.ErrorCode || body.code || body.Code || '').slice(0, 80);
}

/// Gọi JSON có timeout. Trả về `{ status, body }`; KHÔNG tự ném khi HTTP lỗi —
/// người gọi quyết định, vì có thao tác coi 404 là "chưa có" chứ không phải lỗi.
export async function rawFetch(url, opts = {}, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    const text = await res.text();
    let body;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { raw: text };
    }
    return { ok: res.ok, status: res.status, body };
  } catch (e) {
    // Hết giờ / đứt mạng / DNS / TLS — đều là lỗi TẠM THỜI, phải cho thử lại.
    const laHetGio = e?.name === 'AbortError';
    throw new MisaError(
      laHetGio
        ? `MISA không phản hồi trong ${Math.round(timeoutMs / 1000)} giây`
        : `Không kết nối được MISA: ${e?.message || e}`,
      { retryable: true, code: laHetGio ? 'TIMEOUT' : 'NETWORK' },
    );
  } finally {
    clearTimeout(timer);
  }
}

/// Gọi JSON và NÉM MisaError khi HTTP không thành công.
export async function callJson(url, opts = {}, timeoutMs = 15000) {
  const r = await rawFetch(url, opts, timeoutMs);
  if (!r.ok) {
    throw new MisaError(messageOf(r.body, r.status), {
      retryable: classify(r.status, r.body),
      status: r.status,
      code: codeOf(r.body),
      body: sanitize(r.body),
    });
  }
  return r.body;
}

/// Header nghiệp vụ chuẩn của MISA (mọi request sau khi đã có token).
export function authHeaders(token, taxCode) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    CompanyTaxCode: String(taxCode || ''),
  };
}
