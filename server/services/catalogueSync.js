import { db, now } from '../db.js';
import { AppError } from '../core/errors.js';
import { payloadHash } from './edgeSync.js';

const SNAPSHOT_VERSION = 1;
const TABLE_ORDER = [
  'tables', 'categories', 'warehouses', 'menu_items', 'skus',
  'inventory_items', 'recipes', 'stock_lots', 'vouchers', 'customers',
];
const SAFE_SETTING_KEYS = Object.freeze([
  'ipad_staff_pin',
  'print_config',
  'operations_config',
  'notification_sound_config',
  'notification_routing_config',
  'customer_display',
  'loyalty_config',
  'retail_config',
  'sell_config',
  'sales_modules',
  'book_menu_config',
]);

function fail(message, code = 'CATALOGUE_SYNC_INVALID', status = 400, details) {
  throw new AppError(message, { code, status, details });
}

function q(name) {
  return `"${String(name).replaceAll('"', '""')}"`;
}

function rowsForBranch(table, branchId) {
  if (table === 'recipes') {
    return db.prepare(
      `SELECT r.* FROM recipes r JOIN menu_items m ON m.id=r.menu_item_id
       WHERE m.branch_id=? ORDER BY r.menu_item_id,r.inventory_item_id`,
    ).all(branchId);
  }
  return db.prepare(`SELECT * FROM ${q(table)} WHERE branch_id=? ORDER BY id`).all(branchId);
}

function coreSnapshot(branchId) {
  const branch = db.prepare(`SELECT * FROM branches WHERE id=?`).get(branchId);
  if (!branch) fail('Snapshot branch does not exist', 'CATALOGUE_BRANCH_NOT_FOUND', 404);
  const tables = Object.fromEntries(TABLE_ORDER.map((table) => [table, rowsForBranch(table, branchId)]));
  const placeholders = SAFE_SETTING_KEYS.map(() => '?').join(',');
  const settings = db.prepare(
    `SELECT branch_id,key,value,updated_at FROM app_settings
     WHERE branch_id=? AND key IN (${placeholders}) ORDER BY key`,
  ).all(branchId, ...SAFE_SETTING_KEYS);
  return { version: SNAPSHOT_VERSION, branchId, branch, tables, settings };
}

export function buildCatalogueSnapshot(branchId = 'sala') {
  const core = coreSnapshot(branchId);
  return { ...core, generatedAt: now(), hash: payloadHash(core) };
}

function validateRows(table, rows) {
  if (!Array.isArray(rows)) fail(`Snapshot table ${table} is missing`);
  const columns = new Set(db.prepare(`PRAGMA table_info(${q(table)})`).all().map((column) => column.name));
  for (const row of rows) {
    if (!row || Array.isArray(row) || typeof row !== 'object') fail(`Invalid row in ${table}`);
    const unknown = Object.keys(row).filter((key) => !columns.has(key));
    if (unknown.length) fail(`Snapshot schema mismatch in ${table}`, 'CATALOGUE_SCHEMA_MISMATCH', 409, { table, unknown });
  }
}

function insertRows(table, rows) {
  for (const row of rows) {
    const columns = Object.keys(row);
    if (!columns.length) continue;
    db.prepare(
      `INSERT INTO ${q(table)}(${columns.map(q).join(',')}) VALUES(${columns.map(() => '?').join(',')})`,
    ).run(...columns.map((column) => row[column]));
  }
}

export function applyCatalogueSnapshot(snapshot, branchId = 'sala') {
  if (!snapshot || snapshot.version !== SNAPSHOT_VERSION || snapshot.branchId !== branchId) {
    fail('Catalogue snapshot version or branch is invalid');
  }
  const { hash, generatedAt, ...core } = snapshot;
  if (!/^[a-f0-9]{64}$/.test(String(hash || '')) || payloadHash(core) !== hash) {
    fail('Catalogue snapshot hash mismatch', 'CATALOGUE_HASH_MISMATCH', 409);
  }
  if (!generatedAt || Number.isNaN(Date.parse(generatedAt))) fail('Catalogue snapshot timestamp is invalid');
  for (const table of TABLE_ORDER) validateRows(table, snapshot.tables?.[table]);
  if (!Array.isArray(snapshot.settings) || !snapshot.branch || snapshot.branch.id !== branchId) {
    fail('Catalogue snapshot structure is invalid');
  }
  const unsafeSettings = snapshot.settings.filter((row) =>
    row?.branch_id !== branchId || !SAFE_SETTING_KEYS.includes(row?.key));
  if (unsafeSettings.length) fail('Catalogue snapshot contains forbidden settings', 'CATALOGUE_SECRET_REJECTED', 409);

  const pending = db.prepare(
    `SELECT COUNT(*) n FROM sync_queue
     WHERE branch_id=? AND status='pending' AND payload_json IS NOT NULL`,
  ).get(branchId).n;
  if (pending > 0) {
    fail('Push pending edge events before applying a catalogue snapshot', 'CATALOGUE_EDGE_PENDING', 409, { pending });
  }
  const previous = db.prepare(`SELECT * FROM catalogue_snapshot_state WHERE branch_id=?`).get(branchId);
  if (previous?.snapshot_hash === hash) return { ok: true, applied: false, hash, generatedAt };
  if (previous && Date.parse(generatedAt) <= Date.parse(previous.source_generated_at)) {
    fail('Catalogue snapshot is older than the applied snapshot', 'CATALOGUE_STALE', 409);
  }

  db.exec('BEGIN IMMEDIATE;');
  try {
    db.prepare(`UPDATE sync_apply_state SET remote_apply=1 WHERE id=1`).run();
    db.prepare(`DELETE FROM recipes WHERE menu_item_id IN (SELECT id FROM menu_items WHERE branch_id=?)`).run(branchId);
    for (const table of ['stock_lots', 'menu_items', 'skus', 'inventory_items', 'vouchers', 'customers', 'tables', 'categories', 'warehouses']) {
      db.prepare(`DELETE FROM ${q(table)} WHERE branch_id=?`).run(branchId);
    }

    const branchColumns = Object.keys(snapshot.branch);
    const branchUpdates = branchColumns.filter((column) => column !== 'id')
      .map((column) => `${q(column)}=excluded.${q(column)}`).join(',');
    db.prepare(
      `INSERT INTO branches(${branchColumns.map(q).join(',')}) VALUES(${branchColumns.map(() => '?').join(',')})
       ON CONFLICT(id) DO UPDATE SET ${branchUpdates}`,
    ).run(...branchColumns.map((column) => snapshot.branch[column]));

    for (const table of TABLE_ORDER) insertRows(table, snapshot.tables[table]);
    const settingPlaceholders = SAFE_SETTING_KEYS.map(() => '?').join(',');
    db.prepare(`DELETE FROM app_settings WHERE branch_id=? AND key IN (${settingPlaceholders})`)
      .run(branchId, ...SAFE_SETTING_KEYS);
    insertRows('app_settings', snapshot.settings);
    const appliedAt = now();
    db.prepare(
      `INSERT INTO catalogue_snapshot_state(branch_id,snapshot_hash,source_generated_at,applied_at)
       VALUES(?,?,?,?) ON CONFLICT(branch_id) DO UPDATE SET
       snapshot_hash=excluded.snapshot_hash,
       source_generated_at=excluded.source_generated_at,
       applied_at=excluded.applied_at`,
    ).run(branchId, hash, generatedAt, appliedAt);
    db.prepare(`UPDATE sync_apply_state SET remote_apply=0 WHERE id=1`).run();
    db.exec('COMMIT;');
    return { ok: true, applied: true, hash, generatedAt, appliedAt };
  } catch (error) {
    try { db.exec('ROLLBACK;'); } catch {}
    throw error;
  }
}

export const catalogueSafeSettingKeys = SAFE_SETTING_KEYS;
