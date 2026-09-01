import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';

test('database compaction CLI is read-only by default and requires a real backup for writes', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dandpak-compact-cli-'));
  const databasePath = path.join(temp, 'copy.db');
  const database = new DatabaseSync(databasePath);
  try {
    database.exec(`
      CREATE TABLE app_settings(branch_id TEXT,key TEXT,value TEXT,updated_at TEXT,PRIMARY KEY(branch_id,key));
      CREATE TABLE sync_logs(id TEXT PRIMARY KEY,provider TEXT,status TEXT,created_at TEXT,raw_payload TEXT);
      CREATE TABLE print_jobs(id TEXT PRIMARY KEY,created_at TEXT,payload_json TEXT);
      INSERT INTO app_settings VALUES('sala','customer_display','{"images":["data:image/png;base64,QUJD"]}','2026-01-01');
    `);
  } finally { database.close(); }
  const beforeHash = createHash('sha256').update(fs.readFileSync(databasePath)).digest('hex');
  const env = { ...process.env, SQLITE_PATH: databasePath, STORAGE_PATH: path.join(temp, 'storage') };
  const script = path.resolve('server/scripts/database-compaction.mjs');
  const dry = spawnSync(process.execPath, [script], { env, encoding: 'utf8' });
  assert.equal(dry.status, 0, dry.stderr);
  const report = JSON.parse(dry.stdout);
  assert.equal(report.mode, 'dry-run');
  assert.equal(report.customerDisplay.rowsChanged, 1);
  const afterHash = createHash('sha256').update(fs.readFileSync(databasePath)).digest('hex');
  assert.equal(afterHash, beforeHash, 'dry-run must not modify even the SQLite file bytes');

  const check = new DatabaseSync(databasePath, { readOnly: true });
  try {
    assert.match(check.prepare(`SELECT value FROM app_settings`).get().value, /data:image/);
  } finally { check.close(); }

  const unsafe = spawnSync(process.execPath, [script, '--apply-assets'], { env, encoding: 'utf8' });
  assert.notEqual(unsafe.status, 0);
  assert.match(unsafe.stderr, /confirmed-backup/);

  const confirmedBackup = path.join(temp, 'copy-before-apply.db');
  fs.copyFileSync(databasePath, confirmedBackup);
  const applied = spawnSync(process.execPath, [
    script,
    '--apply-assets',
    '--vacuum',
    `--confirmed-backup=${confirmedBackup}`,
  ], { env, encoding: 'utf8' });
  assert.equal(applied.status, 0, applied.stderr);
  const appliedReport = JSON.parse(applied.stdout);
  assert.equal(appliedReport.mode, 'apply');
  assert.equal(appliedReport.after.quickCheck, 'ok');
  assert.equal(appliedReport.after.walBytes, 0);
  assert.deepEqual(appliedReport.checkpoint, { busy: 0, log: 0, checkpointed: 0 });
  const compacted = new DatabaseSync(databasePath, { readOnly: true });
  try {
    assert.doesNotMatch(compacted.prepare(`SELECT value FROM app_settings`).get().value, /data:image/);
  } finally { compacted.close(); }
  fs.rmSync(temp, { recursive: true, force: true });
});

test('database compaction help is side-effect free and documents every write gate', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dandpak-compact-help-'));
  try {
    const databasePath = path.join(temp, 'must-not-be-created.db');
    const result = spawnSync(process.execPath, [
      path.resolve('server/scripts/database-compaction.mjs'), '--help',
    ], {
      encoding: 'utf8',
      env: { ...process.env, SQLITE_PATH: databasePath },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /read-only dry-run/);
    assert.match(result.stdout, /--confirmed-backup/);
    assert.match(result.stdout, /--apply-orphan-outbox/);
    assert.match(result.stdout, /--apply-backfill-noise/);
    assert.equal(fs.existsSync(databasePath), false);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
