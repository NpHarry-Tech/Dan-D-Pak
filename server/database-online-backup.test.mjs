import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

process.env.DATA_ENCRYPTION_KEY = process.env.DATA_ENCRYPTION_KEY
  || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const { runBackupDatabase } = await import('./db/backup.js');

test('online database backup is encrypted, retained, and does not leave plaintext', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dandpak-online-backup-'));
  const database = new DatabaseSync(path.join(temp, 'source.db'));
  try {
    database.exec(`CREATE TABLE money(id TEXT PRIMARY KEY, amount INTEGER NOT NULL);
      INSERT INTO money VALUES('p1',500000);`);
    const result = await runBackupDatabase(database, temp, 14);
    assert.equal(result.ok, true);
    assert.equal(result.skipped, false);
    assert.ok(result.bytes > 0);
    assert.equal(fs.existsSync(result.path), true);
    assert.equal(fs.readdirSync(path.join(temp, 'backups')).some((name) => name.endsWith('.db')), false);

    const second = await runBackupDatabase(database, temp, 14);
    assert.equal(second.ok, true);
    assert.equal(second.skipped, true);
    assert.equal(second.path, result.path);
    assert.equal(second.bytes, result.bytes);
    assert.equal(fs.existsSync(second.path), true);
  } finally {
    database.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
