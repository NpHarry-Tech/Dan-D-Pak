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

// Cổng toàn vẹn dữ liệu (initCriticalIntegrityGuards trong db.js) ném lỗi
// SQLite thô dạng "integrity:<child>.<key>-><parent>.<key>[:parent-delete|
// :parent-update]" khi xoá/sửa một bản ghi CHA còn bị bản ghi CON tham chiếu
// (VD: xoá danh mục còn món ăn — kể cả món đã lưu trữ — trỏ tới). Đây là lỗi
// NGHIỆP VỤ có chủ đích, KHÔNG PHẢI sự cố hệ thống — nhưng mã lỗi Node của nó
// là ERR_SQLITE_ERROR, khớp nhầm điều kiện "hệ thống" bên dưới nên bị che
// thành "Request failed" vô nghĩa với người dùng trên MỌI quan hệ cha-con
// trong hệ thống, không riêng danh mục/món ăn.
const INTEGRITY_GUARD_PATTERN =
  /^integrity:([a-z_]+)\.[a-z_]+->[a-z_]+\.[a-z_]+(:parent-delete|:parent-update)?$/;

function integrityGuardMessage(message) {
  const m = INTEGRITY_GUARD_PATTERN.exec(message);
  if (!m) return null;
  const [, childTable, kind] = m;
  if (kind === ':parent-delete') return `Không thể xóa: vẫn còn dữ liệu trong "${childTable}" đang tham chiếu tới bản ghi này.`;
  if (kind === ':parent-update') return `Không thể sửa: vẫn còn dữ liệu trong "${childTable}" đang tham chiếu tới giá trị cũ.`;
  return `Dữ liệu không hợp lệ: bản ghi tham chiếu tới "${childTable}" không tồn tại.`;
}

export function isUnexpectedSystemError(error) {
  if (error instanceof TypeError || error instanceof RangeError || error instanceof ReferenceError) return true;
  if (integrityGuardMessage(String(error?.message || ''))) return false;
  const code = String(error?.code || '');
  if (code.startsWith('ERR_')) return true;
  return RAW_SYSTEM_LEAK_PATTERN.test(String(error?.message || ''));
}

export function errorPayload(error, fallbackCode = 'BAD_REQUEST') {
  const status = Number(error?.status || 0);
  const internal = status >= 500 || fallbackCode === 'INTERNAL_ERROR' ||
    (status === 0 && isUnexpectedSystemError(error));
  const friendlyIntegrity = internal ? null : integrityGuardMessage(String(error?.message || ''));
  const message = internal
    ? 'Request failed'
    : sanitizeText(friendlyIntegrity || error?.message || 'Request failed');
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
