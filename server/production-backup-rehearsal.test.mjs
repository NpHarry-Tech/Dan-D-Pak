import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encryptBytes } from './core/crypto.js';

test('encrypted backup wrapper proves restore and leaves no plaintext', {
  timeout: 30_000,
  skip: process.platform !== 'win32' ? 'PowerShell deployment gate is Windows-specific' : false,
}, async () => {
  const temp = mkdtempSync(join(tmpdir(), 'ddp-encrypted-rehearsal-'));
  const plain = join(temp, 'source.db');
  // Match the filename emitted by server/db/backup.js in production. The
  // rehearsal wrapper historically accepted only the underscore legacy name,
  // so real daily backups could not pass the restore gate.
  const encrypted = join(temp, 'store-2026-08-09T12-34-56.db.enc');
  const fragment = join(temp, 'fragment.json');
  const previous = {
    sqlite: process.env.SQLITE_PATH,
    storage: process.env.STORAGE_PATH,
    key: process.env.DATA_ENCRYPTION_KEY,
    keyId: process.env.DATA_ENCRYPTION_ACTIVE_KEY_ID,
  };
  try {
    process.env.SQLITE_PATH = plain;
    process.env.STORAGE_PATH = join(temp, 'storage');
    process.env.DATA_ENCRYPTION_KEY = '0123456789abcdef'.repeat(4);
    // rehearse-production-backup.ps1 now requires an active key id to be set
    // (a real production backup is never encrypted under the bare 'primary'
    // default - see server/config/env.js's 'production-' prefix requirement).
    // Set one explicitly so encryptBytes() below and the spawned decrypt both
    // resolve the same non-default id.
    process.env.DATA_ENCRYPTION_ACTIVE_KEY_ID = 'rehearsal-test';
    const fixture = await import(`./db.js?encrypted-rehearsal=${Date.now()}`);
    fixture.migrate();
    fixture.db.close();
    writeFileSync(encrypted, encryptBytes(
      readFileSync(plain), 'database-backup:2026-08-09T12-34-56'));
    unlinkSync(plain);

    const run = spawnSync('powershell.exe', [
      '-NoProfile', '-File', 'deploy/rehearse-production-backup.ps1',
      '-EncryptedBackup', encrypted, '-EvidenceFragment', fragment,
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 25_000,
      env: { ...process.env },
    });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const evidence = JSON.parse(readFileSync(fragment, 'utf8').replace(/^\uFEFF/, ''));
    assert.equal(evidence.backupDecryptionVerified, true);
    assert.equal(evidence.databaseQuickCheckResult, 'ok');
    assert.equal(evidence.logicalRelationsChecked, 31);
    assert.equal(evidence.logicalOrphanCount, 0);
    assert.equal(evidence.pendingOutboxBefore, evidence.pendingOutboxAfter);
    assert.equal(readdirSync(temp).some((name) => name.endsWith('.db')), false);
  } finally {
    if (previous.sqlite === undefined) delete process.env.SQLITE_PATH;
    else process.env.SQLITE_PATH = previous.sqlite;
    if (previous.storage === undefined) delete process.env.STORAGE_PATH;
    else process.env.STORAGE_PATH = previous.storage;
    if (previous.key === undefined) delete process.env.DATA_ENCRYPTION_KEY;
    else process.env.DATA_ENCRYPTION_KEY = previous.key;
    if (previous.keyId === undefined) delete process.env.DATA_ENCRYPTION_ACTIVE_KEY_ID;
    else process.env.DATA_ENCRYPTION_ACTIVE_KEY_ID = previous.keyId;
    rmSync(temp, { recursive: true, force: true });
  }
});
