import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

test('production-copy rehearsal migrates only a copy and preserves duplicate legacy pending rows', { timeout: 30_000 }, async () => {
  const temp = mkdtempSync(join(tmpdir(), 'ddp-rehearsal-test-'));
  const fixture = join(temp, 'fixture.db');
  const backup = join(temp, 'backup.db');
  process.env.SQLITE_PATH = fixture;
  process.env.STORAGE_PATH = join(temp, 'fixture-storage');
  const fixtureModule = await import(`./db.js?rehearsal-fixture=${Date.now()}`);
  fixtureModule.migrate();
  fixtureModule.db.prepare(`UPDATE sync_hub_state SET hub_id='fixture-hub' WHERE id=1`).run();
  const insert = fixtureModule.db.prepare(`INSERT INTO sync_queue
    (id,branch_id,kind,ref,status,created_at,hub_id,sequence,operation,payload_json)
    VALUES(?,?,?,?,?,?,?,?,?,?)`);
  insert.run('legacy-pending-1', 'sala', 'orders', 'same-order', 'pending',
    '2026-08-09T00:00:00.000Z', 'fixture-hub', 1, 'upsert', '{"total":1000}');
  insert.run('legacy-pending-2', 'sala', 'orders', 'same-order', 'pending',
    '2026-08-09T00:00:01.000Z', 'fixture-hub', 2, 'upsert', '{"total":2000}');
  fixtureModule.db.close();
  copyFileSync(fixture, backup);
  const hash = () => createHash('sha256').update(readFileSync(backup)).digest('hex');
  const beforeHash = hash();
  try {
    const run = spawnSync(process.execPath, [
      'server/scripts/production-copy-rehearsal.mjs', `--backup=${backup}`,
    ], { cwd: process.cwd(), encoding: 'utf8', timeout: 25_000 });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const report = JSON.parse(run.stdout);
    assert.equal(report.ok, true);
    assert.equal(report.sourceBackupUnchanged, true);
    assert.equal(hash(), beforeHash);
    assert.equal(report.before.quickCheck, 'ok');
    assert.equal(report.after.quickCheck, 'ok');
    assert.ok(report.databaseTablesCompared >= 63);
    assert.equal(report.logical.checkedRelations, 31);
    assert.equal(report.logical.orphanCount, 0);
    assert.equal(report.before.pendingOutbox, report.after.pendingOutbox);
    assert.equal(report.before.pendingOutbox, 2);
    assert.deepEqual(report.missingTables, []);
    assert.deepEqual(report.rowLosses, []);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
