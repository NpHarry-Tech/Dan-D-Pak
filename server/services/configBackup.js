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
  'stock_lots',
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

  // Hai bảng quyền do auth.js tạo khi module được nạp — lúc bootstrap DB trắng
  // (index.js chạy import TRƯỚC khi auth.js load) chúng chưa tồn tại, câu
  // DELETE ném "no such table" làm rollback TOÀN BỘ transaction: kho + menu
  // biến mất và server rơi về demo seed (bug làm Render/VPS khởi động rỗng).
  db.exec(`CREATE TABLE IF NOT EXISTS role_perms (role TEXT NOT NULL, perm TEXT NOT NULL, PRIMARY KEY(role,perm));`);
  db.exec(`CREATE TABLE IF NOT EXISTS user_perms (
    user_id TEXT NOT NULL,
    perm TEXT NOT NULL,
    mode TEXT NOT NULL CHECK(mode IN ('allow','deny')),
    PRIMARY KEY(user_id,perm)
  );`);

  const existingTables = new Set(
    db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map(r => r.name),
  );
  const skippedTables = [];

  // node:sqlite (DatabaseSync) không có .transaction() — dùng BEGIN/COMMIT/ROLLBACK.
  // (Gọi db.transaction() ném TypeError ngay câu đầu → đây chính là lý do mọi
  // lần bootstrap trước đây đều rơi về demo seed với kho + menu rỗng.)
  db.exec('BEGIN');
  try {
    for (const table of CONFIG_TABLES) {
      const rows = snapshot[table];
      if (!Array.isArray(rows) || rows.length === 0) continue;
      if (!existingTables.has(table)) { skippedTables.push(table); continue; }
      // Chỉ insert các cột thực sự có trong schema hiện tại: snapshot có thể
      // được export từ DB cũ mang cột legacy — một cột lạ không được phép làm
      // hỏng cả lần bootstrap.
      const dbCols = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name));
      db.exec(`DELETE FROM ${table}`);
      for (const row of rows) {
        const cols = Object.keys(row).filter(c => dbCols.has(c));
        if (cols.length === 0) continue;
        const placeholders = cols.map(() => '?').join(',');
        db.prepare(`INSERT OR REPLACE INTO ${table} (${cols.join(',')}) VALUES (${placeholders})`)
          .run(...cols.map(c => row[c]));
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch {}
    throw err;
  }
  const counts = {};
  for (const t of CONFIG_TABLES) counts[t] = (snapshot[t] || []).length;
  if (skippedTables.length) counts._skipped_missing_tables = skippedTables.join(',');
  return { ok: true, counts };
}

export async function fetchAndRestoreConfig(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Không tải được config từ URL (HTTP ${res.status})`);
  const snapshot = await res.json();
  return importConfig(snapshot);
}
