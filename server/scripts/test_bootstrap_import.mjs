// Reproduce the VPS first-boot: fresh empty DB -> migrate() -> import config-seed.json.
// Prints the exact table/row that breaks the import (if any).
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from '../db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const tmpPath = join(__dirname, '..', '..', 'tmp_bootstrap_test.db');
try { rmSync(tmpPath); } catch {}
const fresh = new DatabaseSync(tmpPath);
migrate(fresh);

const snapshot = JSON.parse(readFileSync(join(__dirname, '..', 'config-seed.json'), 'utf8'));
const TABLES = ['branches','users','warehouses','categories','menu_items','inventory_items',
  'skus','tables','recipes','app_settings','role_perms','user_perms','vouchers','stock_lots'];

for (const table of TABLES) {
  const rows = snapshot[table];
  if (!Array.isArray(rows) || rows.length === 0) { console.log(table, ': (empty)'); continue; }
  const dbCols = new Set(fresh.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name));
  const seedCols = Object.keys(rows[0]);
  const missing = seedCols.filter(c => !dbCols.has(c));
  let inserted = 0, firstErr = null;
  for (const row of rows) {
    const cols = Object.keys(row);
    try {
      fresh.prepare(`INSERT OR REPLACE INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
        .run(...Object.values(row));
      inserted++;
    } catch (e) {
      if (!firstErr) firstErr = e.message;
    }
  }
  console.log(table, ':', inserted + '/' + rows.length, 'inserted',
    missing.length ? ' | seed cols MISSING in fresh schema: ' + missing.join(',') : '',
    firstErr ? ' | FIRST ERROR: ' + firstErr : '');
}
