// Config export/import for persisting store configuration across server restarts.
// Covers setup tables only (branches, staff, catalog, settings) — not transactional data.
import { db } from '../db.js';

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

export async function fetchAndRestoreConfig(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Không tải được config từ URL (HTTP ${res.status})`);
  const snapshot = await res.json();
  return importConfig(snapshot);
}
