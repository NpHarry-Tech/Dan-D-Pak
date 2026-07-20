// Route ownership: System logs (client + server unified) + audit trail read.
// Nghiệp vụ ở services/systemLogs.js + services/reports.js (recentAudit); giữ NGUYÊN hành vi.
import { logSystem, listSystemLogs, resolveSystemLog } from '../../services/systemLogs.js';
import { db } from '../../db.js';
import * as Reports from '../../services/reports.js';
import { rehydrateAuditForQuery } from '../../db.js';
import * as Archive from '../../services/archive.js';

export function registerAuditRoutes(api, { wrap, guard, branch }) {
// Throttle như client-log: 1 client lỗi lặp vô hạn không được spam đầy đĩa.
let _sysLogWindowStart = 0;
let _sysLogCount = 0;
api.post('/system-logs', guard(), wrap((req) => {
  const nowMs = Date.now();
  if (nowMs - _sysLogWindowStart > 60_000) { _sysLogWindowStart = nowMs; _sysLogCount = 0; }
  const raw = Array.isArray(req.body?.entries) ? req.body.entries
    : (req.body && typeof req.body === 'object' ? [req.body] : []);
  const accepted = [];
  for (const entry of raw.slice(0, 50)) {
    if (++_sysLogCount > 300) return { ok: true, throttled: true, accepted: accepted.length };
    if (!entry || typeof entry !== 'object') continue;
    const branchId = branch(req);
    const eventId = String(entry.eventId || '').trim().slice(0, 80);
    if (eventId) {
      const existing = db.prepare(
        `SELECT id FROM system_logs
          WHERE request_id = ? AND COALESCE(branch_id,'') = COALESCE(?,'')
          LIMIT 1`
      ).get(eventId, branchId);
      if (existing) {
        accepted.push(existing.id);
        continue;
      }
    }
    // Server là nguồn sự thật cho user/branch — không tin client tự khai.
    const id = logSystem({
      ...entry,
      requestId: eventId || entry.requestId,
      username: req.user?.username || entry.username || '',
      userId: req.user?.id || entry.userId || '',
      branchId,
    });
    if (id) accepted.push(id);
  }
  return { ok: true, accepted: accepted.length };
}));

api.get('/system-logs', guard('audit.view'), wrap((req) => ({
  logs: listSystemLogs(branch(req), {
    levels: req.query.levels,
    sources: req.query.sources,
    eventTypes: req.query.event_types,
    q: req.query.q,
    from: req.query.from,
    to: req.query.to,
    before: req.query.before,
    limit: req.query.limit,
    unresolvedOnly: req.query.unresolved === '1',
  }),
})));

api.post('/system-logs/:id/resolve', guard('audit.view'), wrap((req) =>
  resolveSystemLog(req.params.id, req.user?.username)));

api.get('/audit', guard('audit.view'), wrap((req) => {
  const branch_id = branch(req);
  // If the requested window reaches into cold (monthly-archived) data, pull those
  // months back into SQLite first so even super-old lookups return fast. They stay
  // hot for 7 days, then the daily job re-compacts them.
  try {
    rehydrateAuditForQuery(branch_id, {
      from: req.query.from || null,
      to: req.query.to || null,
      period: req.query.period || null,
      before: req.query.before || null,
    });
  } catch { /* rehydration is best-effort; hot rows still serve the query */ }
  return Reports.recentAudit(branch_id, parseInt(req.query.limit) || 40, req.query.before || null, req.query.period || null, req.query.search || '', req.query.from || null, req.query.to || null);
}));

// --- Permanent archive inspection (ảnh chụp lưu vĩnh viễn) ---
api.get('/archive/status', guard('reports'), wrap(() => Archive.storageStatus()));
api.get('/archive/reports/latest', guard('reports'), wrap((req) => Archive.latestDashboardReport(branch(req))));
api.get('/archive/:kind/:id', guard('reports'), wrap((req) => Archive.readArchivedEntity(req.params.kind, req.params.id, branch(req))));
}
