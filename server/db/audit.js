import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { db } from './connection.js';
import { logger } from '../core/logger.js';
import { currentDevice } from '../core/requestContext.js';
import {
  appendAuditArchive, readRecentAuditArchive, listAuditBranches, listArchivedMonths,
  listAuditDayMonths, hasMonthlyArchive, writeMonthlyArchive, readMonthlyArchive,
  deleteMonthlyArchive, readDayEntriesForMonth, deleteDayFilesForMonth,
} from '../services/archive.js';
import { now, uid } from './ids.js';

const TECHNICAL_ONLY_ACTIONS = new Set([
  'system.error',
  'client.crash',
  'print.failed',
  'print.agent.failed',
  'einvoice.backfill_failed',
  'einvoice.auto_create_failed',
]);

export function audit(action, detail, branch_id = 'br1', actor = 'system') {
  if (TECHNICAL_ONLY_ACTIONS.has(action)) return null;
  const id = uid('a_');
  const created_at = now();
  // Gắn TÊN THIẾT BỊ (header x-device-name, đọc từ AsyncLocalStorage của
  // request) vào detail — Nhật ký hoạt động hiện rõ "ai · làm gì · máy nào".
  let enriched = detail;
  try {
    const device = currentDevice();
    if (device && detail && typeof detail === 'object' && !Array.isArray(detail) && !detail.device) {
      enriched = { ...detail, device };
    }
  } catch { /* ngoài request (worker/cron) — không có thiết bị */ }
  const cleanDetail = typeof enriched === 'string' ? enriched : JSON.stringify(enriched);
  const entry = { id, branch_id, actor, action, detail: cleanDetail, created_at };
  // Durable archive FIRST (fsync'd NDJSON): if the SQLite write below fails — or a
  // crash hits right after — the footprint line is already safely on disk.
  appendAuditArchive(entry);
  // Logging must never break the business operation that triggered it: swallow
  // SQLite errors (the NDJSON archive above still has the entry for recovery).
  try {
    db.prepare(`INSERT INTO audit_log (id,branch_id,actor,action,detail,created_at) VALUES (?,?,?,?,?,?)`)
      .run(id, branch_id, actor, action, cleanDetail, created_at);
  } catch (e) {
    logger.warn('audit sqlite write failed (kept in NDJSON archive)', { message: e.message });
  }
}


export function reconcileAuditFromArchive(days = 2) {
  let restored = 0;
  try {
    const entries = readRecentAuditArchive(days);
    if (!entries.length) return 0;
    const stmt = db.prepare(`INSERT OR IGNORE INTO audit_log (id,branch_id,actor,action,detail,created_at) VALUES (?,?,?,?,?,?)`);
    for (const e of entries) {
      if (TECHNICAL_ONLY_ACTIONS.has(e.action)) continue;
      const detail = typeof e.detail === 'string' ? e.detail : JSON.stringify(e.detail ?? null);
      const r = stmt.run(e.id, e.branch_id ?? 'br1', e.actor ?? 'system', e.action, detail, e.created_at);
      if (r.changes > 0) restored++;
    }
  } catch (e) {
    logger.warn('audit reconcile from archive failed', { message: e.message });
  }
  return restored;
}

const ALGORITHM = 'aes-256-ctr';
// Khóa mã hóa chi tiết audit khi nén/lưu trữ. Ưu tiên biến môi trường AUDIT_LOG_KEY
// để không hardcode bí mật trong source. Lưu ý: nếu đặt key MỚI sau khi đã có bản ghi
// mã hóa bằng key cũ thì các bản cũ đó sẽ không giải mã được — nên đặt key ngay từ đầu
// (compaction chỉ mã hóa bản ghi > 90 ngày, hệ thống mới thường chưa có).
const SECRET_KEY = crypto.scryptSync(
  process.env.AUDIT_LOG_KEY || process.env.SESSION_SECRET || 'dandpak-audit-log-key-secret-12345',
  'salt', 32);

export function encryptCompress(text) {
  try {
    const compressed = zlib.gzipSync(Buffer.from(text, 'utf8'));
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, SECRET_KEY, iv);
    const encrypted = Buffer.concat([cipher.update(compressed), cipher.final()]);
    return '__ENC__:' + iv.toString('hex') + ':' + encrypted.toString('hex');
  } catch (e) {
    logger.error('audit compression/encryption failed', { message: e.message });
    return text;
  }
}

export function decryptDecompress(encText) {
  if (!encText || !encText.startsWith('__ENC__:')) return encText;
  try {
    const parts = encText.split(':');
    if (parts.length !== 3) return encText;
    const iv = Buffer.from(parts[1], 'hex');
    const encrypted = Buffer.from(parts[2], 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, SECRET_KEY, iv);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return zlib.gunzipSync(decrypted).toString('utf8');
  } catch (e) {
    logger.error('audit decryption/decompression failed', { message: e.message });
    return encText;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Activity-log lifecycle (tiered retention)
//   • Hot  : rows of the last AUDIT_HOT_MONTHS months live in SQLite → instant query.
//   • Cold : older months are consolidated into ONE gzip'd NDJSON per month
//            (services/archive.js) and their SQLite rows dropped → tiny store.db.
//   • Open : a lookup that reaches a cold month rehydrates it back into SQLite and
//            marks it hot for AUDIT_REHYDRATE_DAYS; the daily job re-compacts it
//            once that window passes → back to the space-saving format.
//   • Purge: archives (and rows) older than AUDIT_RETENTION_MONTHS are deleted
//            (as month 37 begins, month 1 is dropped).
// ═══════════════════════════════════════════════════════════════════════════
const AUDIT_HOT_MONTHS = 3;
const AUDIT_RETENTION_MONTHS = 36;
const AUDIT_REHYDRATE_DAYS = 7;
const AUDIT_MS_DAY = 24 * 60 * 60 * 1000;

function monthIndexNow() { const d = new Date(); return d.getUTCFullYear() * 12 + d.getUTCMonth(); }
function monthToIndex(ym) { const [y, m] = String(ym).split('-').map(Number); return y * 12 + (m - 1); }
function indexToYm(idx) { const y = Math.floor(idx / 12); const m = idx % 12; return `${y}-${String(m + 1).padStart(2, '0')}`; }
function ymStartIso(ym) { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m - 1, 1)).toISOString(); }
function ymEndIso(ym) { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 1)).toISOString(); }
function ymOfDate(d) { return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; }
function monthsBetween(start, end) {
  const out = [];
  const last = monthToIndex(ymOfDate(end));
  for (let idx = monthToIndex(ymOfDate(start)); idx <= last && out.length < 60; idx++) out.push(indexToYm(idx));
  return out;
}

// Consolidate one branch-month into its gzip archive, then drop the SQLite rows
// that are no longer within a hot window and the now-redundant per-day files.
function rollUpAuditMonth(branch, ym) {
  const startIso = ymStartIso(ym), endIso = ymEndIso(ym);
  const byId = new Map();
  const add = (e) => {
    if (!e || !e.id || !e.action || TECHNICAL_ONLY_ACTIONS.has(e.action)) return;
    const detail = typeof e.detail === 'string'
      ? decryptDecompress(e.detail)
      : (e.detail == null ? '' : JSON.stringify(e.detail));
    byId.set(e.id, {
      id: e.id,
      branch_id: e.branch_id || branch,
      actor: e.actor || 'system',
      action: e.action,
      detail,
      created_at: e.created_at,
    });
  };
  for (const e of readMonthlyArchive(branch, ym)) add(e);       // preserve on re-roll
  for (const e of readDayEntriesForMonth(branch, ym)) add(e);   // durable footprint
  for (const r of db.prepare(
    `SELECT id,branch_id,actor,action,detail,created_at FROM audit_log WHERE branch_id=? AND created_at>=? AND created_at<?`
  ).all(branch, startIso, endIso)) add(r);

  const entries = [...byId.values()].sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  if (!entries.length) return { archived: 0, removed: 0 };

  writeMonthlyArchive(branch, ym, entries);                     // durable archive FIRST
  const nowIso = now();
  const removed = db.prepare(
    `DELETE FROM audit_log WHERE branch_id=? AND created_at>=? AND created_at<? AND (hot_until IS NULL OR hot_until<=?)`
  ).run(branch, startIso, endIso, nowIso).changes;
  deleteDayFilesForMonth(branch, ym);
  return { archived: entries.length, removed };
}

// Daily job: archive every month older than the hot window, and re-compact any
// rehydrated month whose 7-day hot window has passed.
export function compactAuditToMonthly(hotMonths = AUDIT_HOT_MONTHS) {
  let archivedMonths = 0, removedRows = 0;
  try {
    const nowIso = now();
    const cutoffIdx = monthIndexNow() - hotMonths;              // months <= cutoff are cold
    const hotWindowStartIso = ymStartIso(indexToYm(monthIndexNow() - (hotMonths - 1)));
    for (const branch of listAuditBranches()) {
      const months = new Set();
      for (const ym of listAuditDayMonths(branch)) if (monthToIndex(ym) <= cutoffIdx) months.add(ym);
      for (const r of db.prepare(
        `SELECT DISTINCT substr(created_at,1,7) ym FROM audit_log WHERE branch_id=? AND created_at<?`
      ).all(branch, hotWindowStartIso)) if (r.ym) months.add(r.ym);
      for (const r of db.prepare(
        `SELECT DISTINCT substr(created_at,1,7) ym FROM audit_log WHERE branch_id=? AND hot_until IS NOT NULL AND hot_until<=?`
      ).all(branch, nowIso)) if (r.ym) months.add(r.ym);
      for (const ym of months) {
        if (monthToIndex(ym) > cutoffIdx) continue;             // never touch the hot window
        const res = rollUpAuditMonth(branch, ym);
        if (res.archived) archivedMonths++;
        removedRows += res.removed;
      }
    }
  } catch (e) {
    logger.warn('audit compactAuditToMonthly failed', { message: e.message });
  }
  return { archivedMonths, removedRows };
}

// Pull cold months back into SQLite and (re)mark them hot for AUDIT_REHYDRATE_DAYS.
export function rehydrateAuditMonths(branch, months = []) {
  let touched = 0;
  const hotUntil = new Date(Date.now() + AUDIT_REHYDRATE_DAYS * AUDIT_MS_DAY).toISOString();
  const ins = db.prepare(
    `INSERT OR IGNORE INTO audit_log (id,branch_id,actor,action,detail,created_at,hot_until) VALUES (?,?,?,?,?,?,?)`
  );
  for (const ym of months) {
    const entries = readMonthlyArchive(branch, ym);
    if (!entries.length) continue;
    db.exec('BEGIN TRANSACTION;');
    try {
      for (const e of entries) {
        if (TECHNICAL_ONLY_ACTIONS.has(e.action)) continue;
        const detail = typeof e.detail === 'string' ? e.detail : JSON.stringify(e.detail ?? null);
        ins.run(e.id, e.branch_id || branch, e.actor || 'system', e.action, detail, e.created_at, hotUntil);
      }
      db.exec('COMMIT;');
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }
    // Extend the hot window on every re-open (naturally-hot rows keep hot_until NULL).
    db.prepare(
      `UPDATE audit_log SET hot_until=? WHERE branch_id=? AND created_at>=? AND created_at<? AND hot_until IS NOT NULL`
    ).run(hotUntil, branch, ymStartIso(ym), ymEndIso(ym));
    touched += entries.length;
  }
  return touched;
}

// Called by GET /audit: rehydrate any cold month the query window reaches into so
// even super-old lookups are served from fast SQLite.
export function rehydrateAuditForQuery(branch, { from = null, to = null, period = null, before = null } = {}) {
  try {
    const end = to ? new Date(to) : (before ? new Date(before) : new Date());
    let start;
    if (from) start = new Date(from);
    else if (period) start = auditPeriodStart(period);
    else start = new Date(end.getTime() - 62 * AUDIT_MS_DAY);  // unbounded paging: ~2 months up to the cursor
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
    const wanted = monthsBetween(start, end).filter((ym) => hasMonthlyArchive(branch, ym));
    if (!wanted.length) return 0;
    return rehydrateAuditMonths(branch, wanted);
  } catch (e) {
    logger.warn('audit rehydrateAuditForQuery failed', { message: e.message });
    return 0;
  }
}

function auditPeriodStart(period) {
  const ref = new Date();
  if (period === 'day') { const d = new Date(ref); d.setHours(0, 0, 0, 0); return d; }
  if (period === 'week') { const d = new Date(ref); const day = d.getDay(); const diff = d.getDate() - day + (day === 0 ? -6 : 1); const mon = new Date(d.setDate(diff)); mon.setHours(0, 0, 0, 0); return mon; }
  if (period === 'month') return new Date(ref.getFullYear(), ref.getMonth(), 1);
  if (period === 'quarter') return new Date(ref.getFullYear(), Math.floor(ref.getMonth() / 3) * 3, 1);
  if (period === 'year') return new Date(ref.getFullYear(), 0, 1);
  return new Date(ref.getTime() - 62 * AUDIT_MS_DAY);
}

// Delete archives + rows older than the retention window (month 37 drops month 1).
export function purgeAuditBeyondRetention(retentionMonths = AUDIT_RETENTION_MONTHS) {
  let removedFiles = 0, removedRows = 0;
  try {
    const keepFromIdx = monthIndexNow() - (retentionMonths - 1);  // keep last N months incl. current
    const cutoffIso = ymStartIso(indexToYm(keepFromIdx));
    for (const branch of listAuditBranches()) {
      for (const ym of listArchivedMonths(branch)) {
        if (monthToIndex(ym) < keepFromIdx) {
          if (deleteMonthlyArchive(branch, ym)) removedFiles++;
          removedFiles += deleteDayFilesForMonth(branch, ym);
        }
      }
      for (const ym of listAuditDayMonths(branch)) {
        if (monthToIndex(ym) < keepFromIdx) removedFiles += deleteDayFilesForMonth(branch, ym);
      }
    }
    removedRows = db.prepare(`DELETE FROM audit_log WHERE created_at<?`).run(cutoffIso).changes;
  } catch (e) {
    logger.warn('audit purgeAuditBeyondRetention failed', { message: e.message });
  }
  return { removedFiles, removedRows };
}
