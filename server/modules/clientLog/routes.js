// Route ownership: Client log sink — gom lỗi runtime từ app client về log server +
// system_logs hợp nhất. Throttle state module-level nằm trong hàm.
import { logger } from '../../core/logger.js';
import { db } from '../../db.js';
import { logSystem } from '../../services/systemLogs.js';

export function registerClientLogRoutes(api, { wrap, guard, branch }) {
let _clientLogWindowStart = 0;
let _clientLogCount = 0;
api.post('/client-log', guard(), wrap((req) => {
  const nowMs = Date.now();
  if (nowMs - _clientLogWindowStart > 60_000) { _clientLogWindowStart = nowMs; _clientLogCount = 0; }
  if (++_clientLogCount > 120) return { ok: true, throttled: true };
  const b = req.body || {};
  const entry = {
    user: req.user?.username || '',
    branch: branch(req),
    app: String(b.app || '').slice(0, 40),
    version: String(b.version || '').slice(0, 20),
    screen: String(b.screen || '').slice(0, 120),
    message: String(b.message || '').slice(0, 600),
    stack: String(b.stack || '').slice(0, 4000),
    // Vệt thao tác cuối từ "hộp đen" của app (chạm/API/socket/đổi màn).
    breadcrumbs: String(b.breadcrumbs || '').slice(0, 4000),
  };
  logger.error('client error', entry);
  // Mirror sang nhật ký HỆ THỐNG hợp nhất — kể cả app bản cũ (chưa có
  // SystemLog client) vẫn để lại dấu vết crash/lỗi trong system_logs.
  // App bản mới gửi mirrored=true (đã tự ghi qua POST /system-logs) → bỏ qua
  // để 1 lỗi không thành 2 dòng; riêng crash luôn mirror (BlackBox chỉ đi
  // đường client-log).
  if (b.kind === 'crash') {
    const dup = db.prepare(
      `SELECT id FROM system_logs
        WHERE is_resolved = 0
          AND event_type = 'crash'
          AND source = 'flutter_app'
          AND COALESCE(branch_id,'') = COALESCE(?,'')
          AND COALESCE(message,'') = COALESCE(?,'')
          AND COALESCE(stack_trace,'') = COALESCE(?,'')
        ORDER BY timestamp DESC LIMIT 1`
    ).get(entry.branch, entry.message, entry.stack);
    if (dup) return { ok: true, duplicate: true, id: dup.id };
  }
  if (b.kind === 'crash' || b.mirrored !== true) {
    logSystem({
      level: b.kind === 'crash' ? 'fatal' : 'error',
      source: 'flutter_app',
      eventType: b.kind === 'crash' ? 'crash' : 'uncaught_exception',
      title: b.kind === 'crash'
        ? 'App thoát bất thường lần chạy trước (nghi crash native)'
        : `Lỗi runtime trên ${entry.screen || 'app'}`,
      message: entry.message,
      username: entry.user,
      branchId: entry.branch,
      appVersion: entry.version,
      screen: entry.screen,
      stackTrace: entry.stack,
      extra: entry.breadcrumbs ? { breadcrumbs: entry.breadcrumbs } : null,
    });
  }
  return { ok: true };
}));
}
