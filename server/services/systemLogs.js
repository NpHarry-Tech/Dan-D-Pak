// Nhật ký HỆ THỐNG hợp nhất — nơi MỌI lỗi/sự kiện kỹ thuật đổ về một bảng
// (system_logs) để màn "Nhật ký hoạt động" đọc được: crash app, api_error,
// socket rớt, máy in lỗi, thanh toán lỗi, MISA lỗi, sync, cập nhật app…
//
// Nguyên tắc sắt:
//  • logSystem KHÔNG BAO GIỜ ném lỗi — ghi log không được phá nghiệp vụ.
//  • Mọi text đi qua sanitize: PIN/password/token/số thẻ bị che trước khi
//    xuống đĩa (token chỉ giữ 6 đầu + 4 cuối, thẻ chỉ giữ last4).
//  • Giữ ngắn hạn: maintainSystemLogs() xén theo ngày + trần số dòng để bảng
//    không phình vô hạn trên máy cửa hàng.
import { db, uid, now } from '../db.js';
import { logger } from '../core/logger.js';

export const LEVELS = ['debug', 'info', 'warn', 'error', 'fatal'];
const LEVEL_SET = new Set(LEVELS);

// ── Che dữ liệu nhạy cảm ────────────────────────────────────────────────────
// Áp lên MỌI chuỗi tự do (message/stack/extra) — phòng khi caller lỡ nhét
// nguyên payload có PIN/token vào log.
const SENSITIVE_FIELD =
  /("?(?:pin|password|passwd|security_pin|old_pin|new_pin|otp|cvv|secret)"?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;}&]+)/gi;
const TOKEN_FIELD =
  /("?(?:token|authorization|api[_-]?key|access[_-]?token|refresh[_-]?token)"?\s*[:=]\s*"?)([A-Za-z0-9._\-]{12,})("?)/gi;
const CARD_NUMBER = /\b(\d{2})\d{9,13}(\d{4})\b/g; // 13–19 số liền → giữ 2 đầu 4 cuối

export function sanitizeText(value, max = 8000) {
  let text = value == null ? '' : String(value);
  if (!text) return '';
  try {
    text = text
      .replace(SENSITIVE_FIELD, '$1"***"')
      .replace(TOKEN_FIELD, (m, pre, tok, post) =>
        `${pre}${tok.slice(0, 6)}…${tok.slice(-4)}${post}`)
      .replace(CARD_NUMBER, '$1***********$2');
  } catch { /* regex không được phá log */ }
  return text.length > max ? `${text.slice(0, max)}…[cắt bớt]` : text;
}

function intOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

// ── Ghi log ─────────────────────────────────────────────────────────────────
const INSERT_SQL = `INSERT INTO system_logs (
  id, timestamp, level, source, event_type, title, message,
  user_id, username, branch_id, branch_name, device_id, device_name,
  app_version, build_number, platform, os_version,
  screen, action, endpoint, method, status_code, duration_ms,
  request_id, correlation_id, order_id, table_id, payment_id,
  exception_type, stack_trace, extra_json, created_at
) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;

/** Ghi một dòng nhật ký hệ thống. Nhận entry dạng camelCase (eventType,
 *  statusCode…) hoặc snake_case (event_type…) — client Flutter gửi camelCase.
 *  Trả về id (hoặc null nếu ghi thất bại). KHÔNG BAO GIỜ ném lỗi. */
export function logSystem(entry = {}) {
  try {
    const pick = (...keys) => {
      for (const k of keys) {
        const v = entry[k];
        if (v !== undefined && v !== null && `${v}`.length) return v;
      }
      return null;
    };
    const s = (v, max = 200) => (v == null ? null : sanitizeText(v, max) || null);

    const level = LEVEL_SET.has(`${pick('level')}`) ? `${pick('level')}` : 'info';
    const id = uid('sl_');
    const ts = `${pick('timestamp') || now()}`;
    let extra = pick('extra_json', 'extra');
    if (extra != null && typeof extra !== 'string') {
      try { extra = JSON.stringify(extra); } catch { extra = String(extra); }
    }

    db.prepare(INSERT_SQL).run(
      id, ts, level,
      s(pick('source')) || 'backend',
      s(pick('event_type', 'eventType')) || 'event',
      s(pick('title'), 300) || 'Sự kiện hệ thống',
      s(pick('message'), 4000),
      s(pick('user_id', 'userId')),
      s(pick('username')),
      s(pick('branch_id', 'branchId')),
      s(pick('branch_name', 'branchName')),
      s(pick('device_id', 'deviceId')),
      s(pick('device_name', 'deviceName')),
      s(pick('app_version', 'appVersion'), 40),
      s(pick('build_number', 'buildNumber'), 20),
      s(pick('platform'), 30),
      s(pick('os_version', 'osVersion'), 120),
      s(pick('screen')),
      s(pick('action')),
      s(pick('endpoint'), 300),
      s(pick('method'), 10),
      intOrNull(pick('status_code', 'statusCode')),
      intOrNull(pick('duration_ms', 'durationMs')),
      s(pick('request_id', 'requestId'), 80),
      s(pick('correlation_id', 'correlationId'), 80),
      s(pick('order_id', 'orderId'), 80),
      s(pick('table_id', 'tableId'), 80),
      s(pick('payment_id', 'paymentId'), 80),
      s(pick('exception_type', 'exceptionType'), 120),
      s(pick('stack_trace', 'stackTrace', 'stack'), 8000),
      s(extra, 4000),
      now(),
    );
    return id;
  } catch (e) {
    // Ghi log thất bại (đĩa đầy/DB khóa) → chỉ than ra console, không ném.
    logger.warn('system-log write failed', { message: e?.message });
    return null;
  }
}

// ── Đọc log (màn Nhật ký hoạt động) ─────────────────────────────────────────
/** Lọc theo level/source/event_type (CSV), tìm chữ, khoảng thời gian, cursor
 *  phân trang `before` (timestamp). Log không gắn chi nhánh (branch rỗng) là
 *  log toàn hệ thống → luôn hiện. */
export function listSystemLogs(branch_id, opts = {}) {
  const where = [`(branch_id = ? OR branch_id IS NULL OR branch_id = '')`];
  const params = [branch_id];

  const csv = (v) => `${v || ''}`.split(',').map(x => x.trim()).filter(Boolean);
  const levels = csv(opts.levels).filter(x => LEVEL_SET.has(x));
  if (levels.length) {
    where.push(`level IN (${levels.map(() => '?').join(',')})`);
    params.push(...levels);
  }
  const sources = csv(opts.sources);
  if (sources.length) {
    where.push(`source IN (${sources.map(() => '?').join(',')})`);
    params.push(...sources);
  }
  const eventTypes = csv(opts.eventTypes);
  if (eventTypes.length) {
    where.push(`event_type IN (${eventTypes.map(() => '?').join(',')})`);
    params.push(...eventTypes);
  }
  const q = `${opts.q || ''}`.trim();
  if (q) {
    where.push(`(title LIKE ? OR message LIKE ? OR endpoint LIKE ? OR screen LIKE ?
      OR exception_type LIKE ? OR username LIKE ? OR device_name LIKE ? OR correlation_id LIKE ?)`);
    const like = `%${q}%`;
    params.push(like, like, like, like, like, like, like, like);
  }
  if (opts.from) { where.push('timestamp >= ?'); params.push(`${opts.from}`); }
  if (opts.to) { where.push('timestamp < ?'); params.push(`${opts.to}`); }
  if (opts.before) { where.push('timestamp < ?'); params.push(`${opts.before}`); }
  if (opts.unresolvedOnly) where.push('is_resolved = 0');

  const limit = Math.min(Math.max(parseInt(opts.limit) || 50, 1), 200);
  return db.prepare(
    `SELECT * FROM system_logs WHERE ${where.join(' AND ')}
     ORDER BY timestamp DESC LIMIT ?`
  ).all(...params, limit);
}

export function resolveSystemLog(id, username) {
  const r = db.prepare(
    `UPDATE system_logs SET is_resolved = 1, resolved_at = ?, resolved_by = ? WHERE id = ?`
  ).run(now(), `${username || 'system'}`, `${id}`);
  if (!r.changes) throw new Error('Không tìm thấy dòng nhật ký này.');
  return { ok: true, id };
}

// ── Dọn dẹp định kỳ ─────────────────────────────────────────────────────────
/** Giữ log tối đa [days] ngày VÀ tối đa [maxRows] dòng (xóa dòng cũ nhất
 *  trước). Gọi mỗi ngày từ index.js — cùng nhịp với maintainAudit. */
export function maintainSystemLogs({ days = 60, maxRows = 200_000 } = {}) {
  try {
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    const byAge = db.prepare(`DELETE FROM system_logs WHERE timestamp < ?`).run(cutoff).changes;
    let byCount = 0;
    const total = db.prepare(`SELECT COUNT(*) n FROM system_logs`).get().n;
    if (total > maxRows) {
      byCount = db.prepare(
        `DELETE FROM system_logs WHERE id IN (
           SELECT id FROM system_logs ORDER BY timestamp ASC LIMIT ?)`
      ).run(total - maxRows).changes;
    }
    return { removedByAge: byAge, removedByCount: byCount };
  } catch (e) {
    logger.warn('system-log maintenance failed', { message: e?.message });
    return { removedByAge: 0, removedByCount: 0 };
  }
}
