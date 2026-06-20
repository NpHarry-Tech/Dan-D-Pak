// Config export/import for persisting store configuration across server restarts.
// Covers setup tables only (branches, staff, catalog, settings) — not transactional data.
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { db } from '../db.js';
import { env } from '../config/env.js';

const CONFIG_TABLES = [
  'branches',
  'users',
  'warehouses',
  'categories',
  'menu_items',
  'inventory_items',
  'skus',
  'tables',
  'recipes',
  'app_settings',
  'role_perms',
  'user_perms',
  'vouchers',
];

export function exportConfig() {
  const snapshot = { _version: 1, _exported_at: new Date().toISOString() };
  for (const table of CONFIG_TABLES) {
    try {
      snapshot[table] = db.prepare(`SELECT * FROM ${table}`).all();
    } catch {
      snapshot[table] = [];
    }
  }
  return snapshot;
}

export function importConfig(snapshot) {
  if (!snapshot || snapshot._version !== 1) throw new Error('Định dạng backup không hợp lệ (thiếu _version: 1)');

  const txn = db.transaction(() => {
    for (const table of CONFIG_TABLES) {
      const rows = snapshot[table];
      if (!Array.isArray(rows) || rows.length === 0) continue;
      db.exec(`DELETE FROM ${table}`);
      for (const row of rows) {
        const cols = Object.keys(row);
        if (cols.length === 0) continue;
        const placeholders = cols.map(() => '?').join(',');
        db.prepare(`INSERT OR REPLACE INTO ${table} (${cols.join(',')}) VALUES (${placeholders})`)
          .run(...Object.values(row));
      }
    }
  });

  txn();
  const counts = {};
  for (const t of CONFIG_TABLES) counts[t] = (snapshot[t] || []).length;
  return { ok: true, counts };
}

// Merge snapshot into DB without deleting existing rows — safe to call on a live DB.
// Used for startup restore: inserts missing records but never overwrites live data.
function mergeConfig(snapshot) {
  if (!snapshot || snapshot._version !== 1) return { ok: false, reason: 'invalid snapshot' };
  const txn = db.transaction(() => {
    for (const table of CONFIG_TABLES) {
      const rows = snapshot[table];
      if (!Array.isArray(rows) || rows.length === 0) continue;
      for (const row of rows) {
        const cols = Object.keys(row);
        if (cols.length === 0) continue;
        const placeholders = cols.map(() => '?').join(',');
        db.prepare(`INSERT OR IGNORE INTO ${table} (${cols.join(',')}) VALUES (${placeholders})`)
          .run(...Object.values(row));
      }
    }
  });
  txn();
  const counts = {};
  for (const t of CONFIG_TABLES) counts[t] = (snapshot[t] || []).length;
  return { ok: true, counts };
}

// Write an atomic snapshot to CONFIG_BACKUP_PATH (tmp-rename pattern).
export function saveConfigBackup() {
  const path = env.CONFIG_BACKUP_PATH;
  if (!path) return false;
  try {
    const snapshot = exportConfig();
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const tmp = path + '.tmp';
    writeFileSync(tmp, JSON.stringify(snapshot), 'utf8');
    renameSync(tmp, path);
    return true;
  } catch (e) {
    console.warn('[configBackup] auto-save failed:', e.message);
    return false;
  }
}

// On startup: if CONFIG_BACKUP_PATH exists, merge its records into the live DB.
// This ensures user accounts and settings survive a redeploy that wiped the SQLite file.
export function restoreConfigBackupIfNeeded() {
  const path = env.CONFIG_BACKUP_PATH;
  if (!path || !existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf8');
    const snapshot = JSON.parse(raw);
    const result = mergeConfig(snapshot);
    return result;
  } catch (e) {
    console.warn('[configBackup] auto-restore failed:', e.message);
    return null;
  }
}

export async function fetchAndRestoreConfig(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Không tải được config từ URL (HTTP ${res.status})`);
  const snapshot = await res.json();
  return importConfig(snapshot);
}
