// Rehearse the current migration against a byte-for-byte copy of a decrypted
// production backup. The source backup is never opened by SQLite and its hash
// is checked again before exit.
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const option = (name) => {
  const prefix = `--${name}=`;
  return process.argv.find((item) => item.startsWith(prefix))?.slice(prefix.length) || '';
};
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('Usage: node server/scripts/production-copy-rehearsal.mjs --backup=<decrypted.db> [--keep-copy=<directory>]');
  process.exit(0);
}

const source = resolve(option('backup'));
if (!option('backup') || !existsSync(source) || !statSync(source).isFile()) {
  throw new Error('Cần --backup=<file DB đã giải mã và chỉ đọc từ production>');
}
const keepDirectory = option('keep-copy') ? resolve(option('keep-copy')) : '';
const temporary = keepDirectory || mkdtempSync(join(tmpdir(), 'ddp-production-copy-'));
const working = join(temporary, `rehearsal-${basename(source)}`);

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const quote = (value) => `"${String(value).replaceAll('"', '""')}"`;
const snapshot = (database) => {
  const tables = database.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
  ).all().map((row) => row.name);
  const rows = Object.fromEntries(tables.map((name) => [
    name,
    Number(database.prepare(`SELECT COUNT(*) count FROM ${quote(name)}`).get().count),
  ]));
  const hasQueue = tables.includes('sync_queue');
  return {
    schemaVersion: Number(database.prepare('PRAGMA user_version').get().user_version || 0),
    quickCheck: Object.values(database.prepare('PRAGMA quick_check').get())[0],
    tables,
    rows,
    pendingOutbox: hasQueue
      ? Number(database.prepare(`SELECT COUNT(*) count FROM sync_queue WHERE status='pending'`).get().count)
      : 0,
  };
};

const sourceSha256 = sha256(source);
copyFileSync(source, working);
let beforeDb;
let migratedDb;
try {
  beforeDb = new DatabaseSync(working, { readOnly: true });
  const before = snapshot(beforeDb);
  beforeDb.close();
  beforeDb = null;

  process.env.SQLITE_PATH = working;
  process.env.STORAGE_PATH = join(temporary, 'storage');
  process.env.NODE_ENV = 'development';
  delete process.env.DATABASE_READ_ONLY;
  const dbModule = await import('../db.js');
  migratedDb = dbModule.db;
  dbModule.migrate();
  const { scanCriticalOrphans, CRITICAL_RELATIONS } = await import('../db/integrity.js');
  const after = snapshot(migratedDb);
  const logical = scanCriticalOrphans(migratedDb);

  const missingTables = before.tables.filter((name) => !after.tables.includes(name));
  const rowLosses = before.tables.flatMap((name) => {
    const afterCount = after.rows[name];
    return Number.isInteger(afterCount) && afterCount < before.rows[name]
      ? [{ table: name, before: before.rows[name], after: afterCount }]
      : [];
  });
  const sourceUnchanged = sha256(source) === sourceSha256;
  const report = {
    ok: sourceUnchanged && before.quickCheck === 'ok' && after.quickCheck === 'ok' &&
      missingTables.length === 0 && rowLosses.length === 0 && logical.ok &&
      before.pendingOutbox === after.pendingOutbox,
    sourceBackup: source,
    sourceBackupSha256: sourceSha256,
    sourceBackupUnchanged: sourceUnchanged,
    workingCopy: working,
    databaseTablesCompared: before.tables.length,
    before,
    after,
    missingTables,
    rowLosses,
    logicalRelationsExpected: CRITICAL_RELATIONS.length,
    logical,
  };
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 2;
} finally {
  try { beforeDb?.close(); } catch {}
  try { migratedDb?.close(); } catch {}
  if (!keepDirectory) rmSync(temporary, { recursive: true, force: true });
}
