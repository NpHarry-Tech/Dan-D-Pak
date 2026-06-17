// Permanent archive snapshots for business-critical records.
// SQLite remains the primary operational store; this writes durable JSON/NDJSON
// copies into separate folders so records can still be inspected/exported fast.
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const PERMANENT_ROOT = join(__dirname, '..', 'permanent-storage');

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

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function writeJsonAtomic(file, value) {
  ensureDir(dirname(file));
  const tmp = file + '.tmp';
  writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  renameSync(tmp, file);
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
    writeJsonAtomic(byId, payload);
    writeJsonAtomic(byDate, payload);
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
export const archiveCashDrawerEntry = (entry) => archiveEntity('cash-drawer', entry, { id: entry?.id, branch_id: entry?.branch_id, timestamp: entry?.occurred_at || entry?.created_at });

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
  try {
    ensurePermanentStorage();
    const branch = safePart(entry.branch_id || 'br1');
    const day = isoDate(entry.created_at);
    const file = join(PERMANENT_ROOT, 'audit', branch, `${day}.ndjson`);
    ensureDir(dirname(file));
    appendFileSync(file, JSON.stringify({ archived_at: new Date().toISOString(), ...entry }) + '\n', 'utf8');
    return file;
  } catch (e) {
    console.warn('[archive] audit archive failed:', e.message);
    return null;
  }
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
  const countFiles = (dir) => {
    if (!existsSync(dir)) return 0;
    let n = 0;
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = statSync(p);
      n += st.isDirectory() ? countFiles(p) : 1;
    }
    return n;
  };
  return {
    root: PERMANENT_ROOT,
    folders: FOLDERS.map(folder => ({ folder, files: countFiles(join(PERMANENT_ROOT, folder)) })),
  };
}
