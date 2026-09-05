import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

process.env.DATA_ENCRYPTION_KEY = process.env.DATA_ENCRYPTION_KEY
  || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const { runBackupDatabase } = await import('./db/backup.js');

test('online database backup yields the event loop, permits a write, and leaves no plaintext', async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dandpak-online-backup-'));
  const database = new DatabaseSync(path.join(temp, 'source.db'));
  let heartbeat;
  try {
    database.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE money(id TEXT PRIMARY KEY, amount INTEGER NOT NULL);
      INSERT INTO money VALUES('p1',500000);
      CREATE TABLE backup_payload(id INTEGER PRIMARY KEY, payload BLOB);
      INSERT INTO backup_payload(payload) VALUES(zeroblob(8388608));`);
    let heartbeats = 0;
    let maxLagMs = 0;
    let previous = performance.now();
    heartbeat = setInterval(() => {
      const now = performance.now();
      maxLagMs = Math.max(maxLagMs, now - previous);
      previous = now;
      heartbeats++;
    }, 5);
    const concurrentWrite = new Promise((resolve) => setTimeout(() => {
      database.prepare('INSERT INTO money VALUES(?,?)').run('during-backup', 1);
      resolve();
    }, 0));
    const result = await runBackupDatabase(database, temp, 14);
    await concurrentWrite;
    clearInterval(heartbeat);
    t.diagnostic(`backup heartbeat ticks=${heartbeats}, max event-loop gap=${maxLagMs.toFixed(1)}ms`);
    assert.equal(result.ok, true);
    assert.equal(result.skipped, false);
    assert.ok(result.bytes > 0);
    assert.equal(fs.existsSync(result.path), true);
    assert.equal(fs.readdirSync(path.join(temp, 'backups')).some((name) => name.endsWith('.db')), false);
    assert.equal(database.prepare("SELECT COUNT(*) n FROM money WHERE id='during-backup'").get().n, 1);
    assert.ok(heartbeats > 0, 'online backup must yield to another event-loop turn');
    assert.ok(maxLagMs < 1_000, `unexpected event-loop stall ${maxLagMs.toFixed(1)}ms`);

    const second = await runBackupDatabase(database, temp, 14);
    assert.equal(second.ok, true);
    assert.equal(second.skipped, true);
    assert.equal(second.path, result.path);
    assert.equal(second.bytes, result.bytes);
    assert.equal(fs.existsSync(second.path), true);
  } finally {
    clearInterval(heartbeat);
    database.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
