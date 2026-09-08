import { sanitizeObject, sanitizeText } from './redaction.js';

export class AppError extends Error {
  constructor(message, { code = 'APP_ERROR', status = 400, details = undefined } = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

// Toàn bộ codebase (600+ chỗ) ném `throw new Error('lý do nghiệp vụ')` KHÔNG
// gán .status — đây là quy ước chuẩn để báo lỗi nghiệp vụ rõ ràng cho người
// dùng ("Hết hàng", "Order trống"…), không phải sự cố hệ thống. Chỉ những lỗi
// THẬT SỰ ngoài ý muốn (TypeError/RangeError/ReferenceError, mã lỗi nội bộ
// Node ERR_*, hoặc rò rỉ chuỗi driver thô như "SQLITE_..."/đường dẫn ổ đĩa)
// mới cần giấu message thật khỏi client.
const RAW_SYSTEM_LEAK_PATTERN = /\bSQLITE_[A-Z_]+\b|[A-Za-z]:\\\\?[^\s"']+|\/(?:etc|usr|var|home|root)\/[^\s"']*/;

export function isUnexpectedSystemError(error) {
  if (error instanceof TypeError || error instanceof RangeError || error instanceof ReferenceError) return true;
  const code = String(error?.code || '');
  if (code.startsWith('ERR_')) return true;
  return RAW_SYSTEM_LEAK_PATTERN.test(String(error?.message || ''));
}

export function errorPayload(error, fallbackCode = 'BAD_REQUEST') {
  const status = Number(error?.status || 0);
  const internal = status >= 500 || fallbackCode === 'INTERNAL_ERROR' ||
    (status === 0 && isUnexpectedSystemError(error));
  const message = internal
    ? 'Request failed'
    : sanitizeText(error?.message || 'Request failed');
  return {
    ok: false,
    code: internal ? fallbackCode : sanitizeText(error.code || fallbackCode),
    message,
    error: message,
    ...(!internal && error.details
      ? { details: sanitizeObject(error.details) }
      : {}),
  };
}
