// Nháº­t kÃ½ Há»† THá»NG há»£p nháº¥t â€” nÆ¡i Má»ŒI lá»—i/sá»± kiá»‡n ká»¹ thuáº­t Ä‘á»• vá» má»™t báº£ng
// (system_logs) Ä‘á»ƒ mÃ n "Nháº­t kÃ½ hoáº¡t Ä‘á»™ng" Ä‘á»c Ä‘Æ°á»£c: crash app, api_error,
// socket rá»›t, mÃ¡y in lá»—i, thanh toÃ¡n lá»—i, MISA lá»—i, sync, cáº­p nháº­t appâ€¦
//
// NguyÃªn táº¯c sáº¯t:
//  â€¢ logSystem KHÃ”NG BAO GIá»œ nÃ©m lá»—i â€” ghi log khÃ´ng Ä‘Æ°á»£c phÃ¡ nghiá»‡p vá»¥.
//  â€¢ Má»i text Ä‘i qua sanitize: PIN/password/token/sá»‘ tháº» bá»‹ che trÆ°á»›c khi
//    xuá»‘ng Ä‘Ä©a (token chá»‰ giá»¯ 6 Ä‘áº§u + 4 cuá»‘i, tháº» chá»‰ giá»¯ last4).
//  â€¢ Giá»¯ ngáº¯n háº¡n: maintainSystemLogs() xÃ©n theo ngÃ y + tráº§n sá»‘ dÃ²ng Ä‘á»ƒ báº£ng
//    khÃ´ng phÃ¬nh vÃ´ háº¡n trÃªn mÃ¡y cá»­a hÃ ng.
import { db, uid, now } from '../db.js';
import { logger } from '../core/logger.js';

export const LEVELS = ['debug', 'info', 'warn', 'error', 'fatal'];
const LEVEL_SET = new Set(LEVELS);

// â”€â”€ Che dá»¯ liá»‡u nháº¡y cáº£m â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Ãp lÃªn Má»ŒI chuá»—i tá»± do (message/stack/extra) â€” phÃ²ng khi caller lá»¡ nhÃ©t
// nguyÃªn payload cÃ³ PIN/token vÃ o log.
const SENSITIVE_FIELD =
  /("?(?:pin|password|passwd|security_pin|old_pin|new_pin|otp|cvv|secret)"?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;}&]+)/gi;
const TOKEN_FIELD =
  /("?(?:token|authorization|api[_-]?key|access[_-]?token|refresh[_-]?token)"?\s*[:=]\s*"?)([A-Za-z0-9._\-]{12,})("?)/gi;
const CARD_NUMBER = /\b(\d{2})\d{9,13}(\d{4})\b/g; // 13â€“19 sá»‘ liá»n â†’ giá»¯ 2 Ä‘áº§u 4 cuá»‘i

export function sanitizeText(value, max = 8000) {
  let text = value == null ? '' : String(value);
  if (!text) return '';
  try {
    text = text
      .replace(SENSITIVE_FIELD, '$1"***"')
      .replace(TOKEN_FIELD, (m, pre, tok, post) =>
        `${pre}${tok.slice(0, 6)}â€¦${tok.slice(-4)}${post}`)
      .replace(CARD_NUMBER, '$1***********$2');
  } catch { /* regex khÃ´ng Ä‘Æ°á»£c phÃ¡ log */ }
  return text.length > max ? `${text.slice(0, max)}â€¦[cáº¯t bá»›t]` : text;
}

function intOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

// â”€â”€ Ghi log â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const INSERT_SQL = `INSERT INTO system_logs (
  id, timestamp, level, source, event_type, title, message,
  user_id, username, branch_id, branch_name, device_id, device_name,
  app_version, build_number, platform, os_version,
  screen, action, endpoint, method, status_code, duration_ms,
  request_id, correlation_id, order_id, table_id, payment_id,
  exception_type, stack_trace, extra_json, created_at
) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;

/** Ghi má»™t dÃ²ng nháº­t kÃ½ há»‡ thá»‘ng. Nháº­n entry dáº¡ng camelCase (eventType,
 *  statusCodeâ€¦) hoáº·c snake_case (event_typeâ€¦) â€” client Flutter gá»­i camelCase.
 *  Tráº£ vá» id (hoáº·c null náº¿u ghi tháº¥t báº¡i). KHÃ”NG BAO GIá»œ nÃ©m lá»—i. */
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
      s(pick('title'), 300) || 'Sá»± kiá»‡n há»‡ thá»‘ng',
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
    // Ghi log tháº¥t báº¡i (Ä‘Ä©a Ä‘áº§y/DB khÃ³a) â†’ chá»‰ than ra console, khÃ´ng nÃ©m.
    logger.warn('system-log write failed', { message: e?.message });
    return null;
  }
}

// â”€â”€ Äá»c log (mÃ n Nháº­t kÃ½ hoáº¡t Ä‘á»™ng) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
/** Lá»c theo level/source/event_type (CSV), tÃ¬m chá»¯, khoáº£ng thá»i gian, cursor
 *  phÃ¢n trang `before` (timestamp). Log khÃ´ng gáº¯n chi nhÃ¡nh (branch rá»—ng) lÃ 
 *  log toÃ n há»‡ thá»‘ng â†’ luÃ´n hiá»‡n. */
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
  const row = db.prepare('SELECT * FROM system_logs WHERE id = ?').get(String(id));
  if (!row) throw new Error('Khong tim thay dong nhat ky nay.');
  const at = now();
  const by = String(username || 'system');
  const r = db.prepare(
    'UPDATE system_logs SET is_resolved = 1, resolved_at = ?, resolved_by = ? WHERE id = ?'
  ).run(at, by, String(id));

  let similar = 0;
  if (row.event_type === 'crash') {
    similar = db.prepare(
      `UPDATE system_logs
          SET is_resolved = 1, resolved_at = ?, resolved_by = ?
        WHERE is_resolved = 0
          AND event_type = 'crash'
          AND source = ?
          AND COALESCE(branch_id,'') = COALESCE(?,'')
          AND COALESCE(title,'') = COALESCE(?,'')
          AND COALESCE(message,'') = COALESCE(?,'')
          AND COALESCE(stack_trace,'') = COALESCE(?,'')`
    ).run(at, by, row.source, row.branch_id, row.title, row.message, row.stack_trace).changes;
  }
  return { ok: true, id, resolved: r.changes + similar };
}

// â”€â”€ Dá»n dáº¹p Ä‘á»‹nh ká»³ â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
/** Giá»¯ log tá»‘i Ä‘a [days] ngÃ y VÃ€ tá»‘i Ä‘a [maxRows] dÃ²ng (xÃ³a dÃ²ng cÅ© nháº¥t
 *  trÆ°á»›c). Gá»i má»—i ngÃ y tá»« index.js â€” cÃ¹ng nhá»‹p vá»›i maintainAudit. */
export function maintainSystemLogs({ days = 60, maxRows = 200_000 } = {}) {
  try {
    const redundant = db.prepare(`DELETE FROM system_logs WHERE
      event_type = 'socket_error'
      OR (event_type = 'api_error' AND status_code BETWEEN 400 AND 499)
      OR (event_type = 'slow_request' AND source = 'flutter_app')
      OR (event_type IN ('print_failed','payment_failed') AND source = 'flutter_app')
      OR (event_type IN ('api_timeout','api_offline','slow_request')
          AND endpoint LIKE '/api/system-logs%')`).run().changes;
    const exactDuplicates = db.prepare(`DELETE FROM system_logs WHERE rowid IN (
      SELECT rowid FROM (
        SELECT rowid, ROW_NUMBER() OVER (
          PARTITION BY timestamp, level, source, event_type, title, message,
            user_id, username, branch_id, device_id, device_name,
            app_version, build_number, platform, screen, action, endpoint,
            method, status_code, duration_ms, request_id, correlation_id,
            order_id, table_id, payment_id, exception_type, stack_trace, extra_json
          ORDER BY rowid
        ) AS duplicate_number
        FROM system_logs
      ) WHERE duplicate_number > 1
    )`).run().changes;
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
    return {
      removedRedundant: redundant,
      removedExactDuplicates: exactDuplicates,
      removedByAge: byAge,
      removedByCount: byCount,
    };
  } catch (e) {
    logger.warn('system-log maintenance failed', { message: e?.message });
    return {
      removedRedundant: 0,
      removedExactDuplicates: 0,
      removedByAge: 0,
      removedByCount: 0,
    };
  }
}
