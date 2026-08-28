import { errorPayload } from './errors.js';
import { logger } from './logger.js';
import { sanitizeText, sanitizeUrl } from './redaction.js';

export function apiNotFound(req, res) {
  return res.status(404).json({
    ok: false,
    code: 'API_NOT_FOUND',
    message: `API route not found: ${req.method} ${req.originalUrl}`,
    error: 'API route not found',
  });
}

export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  const status = err.status || 500;
  logger.error('request failed', {
    method: req.method,
    url: sanitizeUrl(req.originalUrl),
    status,
    message: sanitizeText(err.message),
  });
  // §4.4/§6.4: KHÔNG để lỗi SQLite THÔ lọt ra client (UI/thu ngân không được
  // thấy "UNIQUE constraint failed: orders.branch_id, orders.pay_ref"). Ánh xạ
  // thành lỗi NGHIỆP VỤ; chi tiết kỹ thuật đã nằm ở system log phía trên. Lỗi đã
  // có mã nghiệp vụ (e.code không phải SQLITE_*) thì giữ nguyên.
  const msg = String(err.message || '');
  const hasBusinessCode = err.code && !/^SQLITE_/i.test(String(err.code));
  if (!hasBusinessCode) {
    if (/constraint failed|UNIQUE constraint|SQLITE_CONSTRAINT/i.test(msg)) {
      return res.status(409).json({
        ok: false, code: 'DATA_CONFLICT',
        message: 'Thao tác không hoàn tất do xung đột dữ liệu (có thể đã được xử lý ở thiết bị khác). Vui lòng tải lại và kiểm tra.',
        error: 'Xung đột dữ liệu.',
      });
    }
    if (/SQLITE_|no such (table|column)/i.test(msg)) {
      return res.status(500).json({
        ok: false, code: 'INTERNAL_ERROR',
        message: 'Lỗi hệ thống khi xử lý yêu cầu. Vui lòng thử lại; nếu lặp lại hãy báo kỹ thuật.',
        error: 'Lỗi hệ thống.',
      });
    }
  }
  return res.status(status).json(errorPayload(err, status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST'));
}
