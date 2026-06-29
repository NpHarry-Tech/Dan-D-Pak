// Permanent archive snapshots for business-critical records.
// SQLite remains the primary operational store; this writes durable JSON/NDJSON
// copies into separate folders so records can still be inspected/exported fast.
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { open as openFile, rename as renameAsync, writeFile as writeFileAsync } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { runtimePaths } from '../config/paths.js';

export const PERMANENT_ROOT = runtimePaths.permanentStorage;

const ENTITY_KINDS = new Set(['customers', 'orders', 'invoices', 'payments', 'staff', 'cash-drawer']);
const FOLDERS = ['customers', 'orders', 'invoices', 'payments', 'reports', 'audit', 'staff', 'cash-drawer'];

function safePart(v, fallback = 'unknown') {
  const s = String(v || fallback).trim().replace(/[^a-zA-Z0-9._-]+/g, '_');
  return s || fallback;
}

function isoDate(iso = null) {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function localDateParts(iso = null) {
  const d = iso ? new Date(iso) : new Date();
  const x = Number.isNaN(d.getTime()) ? new Date() : d;
  return {
    yyyy: String(x.getFullYear()),
    mm: pad2(x.getMonth() + 1),
    dd: pad2(x.getDate()),
    hh: pad2(x.getHours()),
    min: pad2(x.getMinutes()),
  };
}

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function writeJsonAtomic(file, value) {
  ensureDir(dirname(file));
  const tmp = file + '.tmp';
  writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  renameSync(tmp, file);
}

async function writeJsonAtomicAsync(file, value) {
  ensureDir(dirname(file));
  const tmp = file + '.tmp';
  await writeFileAsync(tmp, JSON.stringify(value, null, 2), 'utf8');
  await renameAsync(tmp, file);
}

const entityArchiveQueue = new Map();
let entityArchiveFlushTimer = null;
let entityArchiveFlushing = false;
const ENTITY_ARCHIVE_BATCH = Math.max(1, parseInt(process.env.ENTITY_ARCHIVE_BATCH || '80', 10) || 80);
const ENTITY_ARCHIVE_FLUSH_MS = Math.max(25, parseInt(process.env.ENTITY_ARCHIVE_FLUSH_MS || '250', 10) || 250);

async function flushEntityArchiveQueue() {
  if (entityArchiveFlushing) return;
  entityArchiveFlushing = true;
  try {
    while (entityArchiveQueue.size) {
      const batch = [...entityArchiveQueue.entries()].slice(0, ENTITY_ARCHIVE_BATCH);
      for (const [file] of batch) entityArchiveQueue.delete(file);
      await Promise.all(batch.map(([file, value]) => writeJsonAtomicAsync(file, value)));
    }
  } catch (e) {
    console.warn('[archive] async entity archive failed:', e.message);
  } finally {
    entityArchiveFlushing = false;
    if (entityArchiveQueue.size && !entityArchiveFlushTimer) {
      entityArchiveFlushTimer = setTimeout(() => {
        entityArchiveFlushTimer = null;
        void flushEntityArchiveQueue();
      }, ENTITY_ARCHIVE_FLUSH_MS);
      entityArchiveFlushTimer.unref?.();
    }
  }
}

function queueJsonAtomic(file, value) {
  entityArchiveQueue.set(file, value);
  if (entityArchiveQueue.size >= ENTITY_ARCHIVE_BATCH) {
    if (entityArchiveFlushTimer) {
      clearTimeout(entityArchiveFlushTimer);
      entityArchiveFlushTimer = null;
    }
    void flushEntityArchiveQueue();
    return;
  }
  if (!entityArchiveFlushTimer) {
    entityArchiveFlushTimer = setTimeout(() => {
      entityArchiveFlushTimer = null;
      void flushEntityArchiveQueue();
    }, ENTITY_ARCHIVE_FLUSH_MS);
    entityArchiveFlushTimer.unref?.();
  }
}

function flushEntityArchiveQueueSync() {
  for (const [file, value] of entityArchiveQueue.entries()) {
    writeJsonAtomic(file, value);
  }
  entityArchiveQueue.clear();
}

export function ensurePermanentStorage() {
  ensureDir(PERMANENT_ROOT);
  for (const folder of FOLDERS) ensureDir(join(PERMANENT_ROOT, folder));
  return { root: PERMANENT_ROOT, folders: FOLDERS };
}

export function archiveEntity(kind, entity = {}, opts = {}) {
  try {
    if (!ENTITY_KINDS.has(kind) || !entity) return null;
    ensurePermanentStorage();
    const branch = safePart(opts.branch_id || entity.branch_id || 'br1');
    const id = safePart(opts.id || entity.id || entity.order_id || entity.payment_id);
    const ts = opts.timestamp || entity.updated_at || entity.paid_at || entity.issued_at || entity.created_at || new Date().toISOString();
    const payload = {
      archived_at: new Date().toISOString(),
      archive_kind: kind,
      branch_id: branch,
      data: entity,
    };
    const byId = join(PERMANENT_ROOT, kind, branch, 'by-id', `${id}.json`);
    const byDate = join(PERMANENT_ROOT, kind, branch, 'by-date', isoDate(ts), `${id}.json`);
    queueJsonAtomic(byId, payload);
    queueJsonAtomic(byDate, payload);
    return { byId, byDate };
  } catch (e) {
    console.warn('[archive] entity archive failed:', e.message);
    return null;
  }
}

export const archiveCustomer = (customer) => archiveEntity('customers', customer);
export const archiveOrder = (order) => archiveEntity('orders', order);
export const archiveInvoice = (invoice) => archiveEntity('invoices', invoice);
export const archivePayment = (receipt) => archiveEntity('payments', receipt, { id: receipt?.payment_id, branch_id: receipt?.branch_id });
export const archiveStaff = (user) => archiveEntity('staff', user);

function nextCashDrawerSequence(branch) {
  const file = join(PERMANENT_ROOT, 'cash-drawer', branch, 'journal-sequence.json');
  let last = 0;
  try {
    if (existsSync(file)) last = Number(JSON.parse(readFileSync(file, 'utf8'))?.last) || 0;
  } catch {
    last = 0;
  }
  const next = last + 1;
  writeJsonAtomic(file, { last: next, updated_at: new Date().toISOString() });
  return next;
}

export function archiveCashDrawerEntry(entry) {
  const base = archiveEntity('cash-drawer', entry, {
    id: entry?.id,
    branch_id: entry?.branch_id,
    timestamp: entry?.occurred_at || entry?.created_at,
  });
  try {
    if (!entry) return base;
    ensurePermanentStorage();
    const branch = safePart(entry.branch_id || 'br1');
    const id = safePart(entry.id || entry.entry_id);
    const parts = localDateParts(entry.occurred_at || entry.created_at);
    const dayFolder = `${parts.yyyy}-${parts.mm}-${parts.dd}`;
    const sequence = nextCashDrawerSequence(branch);
    const sequenceCode = String(sequence).padStart(6, '0');
    const fileName = `${parts.dd}${parts.mm}${parts.yyyy}-${parts.hh}${parts.min}-${sequenceCode}-${id}.json`;
    const file = join(PERMANENT_ROOT, 'cash-drawer', branch, 'journal', dayFolder, fileName);
    const payload = {
      archived_at: new Date().toISOString(),
      archive_kind: 'cash-drawer.journal',
      branch_id: branch,
      archive_sequence: sequence,
      archive_file_name: fileName,
      base_paths: base,
      data: entry,
    };
    writeJsonAtomic(file, payload);
    return { ...(base || {}), journal: file, archive_sequence: sequence, archive_file_name: fileName };
  } catch (e) {
    console.warn('[archive] cash drawer journal failed:', e.message);
    return base;
  }
}

export function archiveDashboardReport(report = {}, branch_id = 'br1') {
  try {
    ensurePermanentStorage();
    const branch = safePart(branch_id);
    const stamped = {
      archived_at: new Date().toISOString(),
      archive_kind: 'reports.dashboard',
      branch_id: branch,
      data: report,
    };
    writeJsonAtomic(join(PERMANENT_ROOT, 'reports', branch, 'dashboard-latest.json'), stamped);
    writeJsonAtomic(join(PERMANENT_ROOT, 'reports', branch, 'daily', `${isoDate()}.json`), stamped);
    return stamped;
  } catch (e) {
    console.warn('[archive] report archive failed:', e.message);
    return null;
  }
}

export function appendAuditArchive(entry = {}) {
  let fd;
  try {
    ensurePermanentStorage();
    const branch = safePart(entry.branch_id || 'br1');
    const day = isoDate(entry.created_at);
    const file = join(PERMANENT_ROOT, 'audit', branch, `${day}.ndjson`);
    ensureDir(dirname(file));
    const line = JSON.stringify({ archived_at: new Date().toISOString(), ...entry }) + '\n';
    // Append + fsync so a power loss / hard reset can't drop the tail that would
    // otherwise sit unflushed in the OS write buffer (the "log đệm"). This NDJSON
    // is the durable footprint of record; SQLite is the fast queryable copy.
    fd = openSync(file, 'a');
    writeSync(fd, line, null, 'utf8');
    fsyncSync(fd);
    return file;
  } catch (e) {
    console.warn('[archive] audit archive failed:', e.message);
    return null;
  } finally {
    if (fd !== undefined) { try { closeSync(fd); } catch { /* already closed */ } }
  }
}

const auditArchiveQueue = [];
let auditArchiveFlushTimer = null;
let auditArchiveFlushing = false;
const AUDIT_ARCHIVE_BATCH = Math.max(1, parseInt(process.env.AUDIT_ARCHIVE_BATCH || '80', 10) || 80);
const AUDIT_ARCHIVE_FLUSH_MS = Math.max(25, parseInt(process.env.AUDIT_ARCHIVE_FLUSH_MS || '250', 10) || 250);

function auditArchiveTarget(entry = {}) {
  const branch = safePart(entry.branch_id || 'br1');
  const day = isoDate(entry.created_at);
  return join(PERMANENT_ROOT, 'audit', branch, `${day}.ndjson`);
}

async function appendAuditArchiveBatch(entries = []) {
  const byFile = new Map();
  for (const entry of entries) {
    const file = auditArchiveTarget(entry);
    const line = JSON.stringify({ archived_at: new Date().toISOString(), ...entry }) + '\n';
    byFile.set(file, (byFile.get(file) || '') + line);
  }
  for (const [file, text] of byFile) {
    ensureDir(dirname(file));
    const fh = await openFile(file, 'a');
    try {
      await fh.writeFile(text, 'utf8');
      await fh.sync();
    } finally {
      await fh.close().catch(() => {});
    }
  }
}

async function flushAuditArchiveQueue() {
  if (auditArchiveFlushing) return;
  auditArchiveFlushing = true;
  try {
    while (auditArchiveQueue.length) {
      const batch = auditArchiveQueue.splice(0, AUDIT_ARCHIVE_BATCH);
      await appendAuditArchiveBatch(batch);
    }
  } catch (e) {
    console.warn('[archive] async audit archive failed:', e.message);
  } finally {
    auditArchiveFlushing = false;
    if (auditArchiveQueue.length && !auditArchiveFlushTimer) {
      auditArchiveFlushTimer = setTimeout(() => {
        auditArchiveFlushTimer = null;
        void flushAuditArchiveQueue();
      }, AUDIT_ARCHIVE_FLUSH_MS);
      auditArchiveFlushTimer.unref?.();
    }
  }
}

export function queueAuditArchive(entry = {}) {
  auditArchiveQueue.push(entry);
  if (auditArchiveQueue.length >= AUDIT_ARCHIVE_BATCH) {
    if (auditArchiveFlushTimer) {
      clearTimeout(auditArchiveFlushTimer);
      auditArchiveFlushTimer = null;
    }
    void flushAuditArchiveQueue();
    return;
  }
  if (!auditArchiveFlushTimer) {
    auditArchiveFlushTimer = setTimeout(() => {
      auditArchiveFlushTimer = null;
      void flushAuditArchiveQueue();
    }, AUDIT_ARCHIVE_FLUSH_MS);
    auditArchiveFlushTimer.unref?.();
  }
}

function flushAuditArchiveQueueSync() {
  while (auditArchiveQueue.length) {
    appendAuditArchive(auditArchiveQueue.shift());
  }
}

process.once('exit', flushAuditArchiveQueueSync);
process.once('exit', flushEntityArchiveQueueSync);

// Read footprint entries archived in the last `days` days (today inclusive),
// across all branches. Pure fs read (no SQLite) so db.js can call it to self-heal
// audit_log after a crash where WAL+synchronous=NORMAL lost its most-recent rows
// but the fsync'd NDJSON kept them. Returns raw entry objects.
export function readRecentAuditArchive(days = 2) {
  const out = [];
  try {
    const auditRoot = join(PERMANENT_ROOT, 'audit');
    if (!existsSync(auditRoot)) return out;
    const wantDays = new Set();
    for (let i = 0; i < Math.max(1, days); i++) {
      const d = new Date(Date.now() - i * 86400000);
      if (!Number.isNaN(d.getTime())) wantDays.add(d.toISOString().slice(0, 10));
    }
    for (const branch of readdirSync(auditRoot)) {
      const branchDir = join(auditRoot, branch);
      let files = [];
      try { files = readdirSync(branchDir); } catch { continue; }
      for (const name of files) {
        if (!name.endsWith('.ndjson') || !wantDays.has(name.slice(0, 10))) continue;
        let text = '';
        try { text = readFileSync(join(branchDir, name), 'utf8'); } catch { continue; }
        for (const line of text.split('\n')) {
          const s = line.trim();
          if (!s) continue;
          try {
            const e = JSON.parse(s);
            if (e && e.id && e.action && e.created_at) out.push(e);
          } catch { /* skip a torn/partial trailing line */ }
        }
      }
    }
  } catch (e) {
    console.warn('[archive] read recent audit failed:', e.message);
  }
  return out;
}

export function readArchivedEntity(kind, id, branch_id = 'br1') {
  if (!ENTITY_KINDS.has(kind)) throw new Error('Archive kind khong hop le');
  const file = join(PERMANENT_ROOT, kind, safePart(branch_id), 'by-id', `${safePart(id)}.json`);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function latestDashboardReport(branch_id = 'br1') {
  const file = join(PERMANENT_ROOT, 'reports', safePart(branch_id), 'dashboard-latest.json');
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function storageStatus() {
  ensurePermanentStorage();
  // Chỉ đếm thư mục con (branch) và lấy số file by-id — không đệ quy toàn bộ cây
  // (tránh block event loop khi có hàng ngàn file sau vài tháng vận hành)
  const countTopLevel = (dir) => {
    if (!existsSync(dir)) return 0;
    try {
      let n = 0;
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        const st = statSync(p);
        if (st.isDirectory()) {
          // Chỉ đếm 1 cấp con (by-id) — đủ để hiển thị trên UI mà không block
          const byId = join(p, 'by-id');
          if (existsSync(byId)) {
            n += readdirSync(byId).length;
          } else {
            n += readdirSync(p).filter(f => !statSync(join(p, f)).isDirectory()).length;
          }
        } else {
          n += 1;
        }
      }
      return n;
    } catch { return 0; }
  };
  return {
    root: PERMANENT_ROOT,
    folders: FOLDERS.map(folder => ({ folder, files: countTopLevel(join(PERMANENT_ROOT, folder)) })),
  };
}
