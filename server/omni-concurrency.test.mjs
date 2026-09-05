import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

const key = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

function child(source, database, storage) {
  return spawn(process.execPath, ['--input-type=module', '-e', source], {
    cwd: path.resolve('.'),
    env: { ...process.env, SQLITE_PATH: database, STORAGE_PATH: storage, DATA_ENCRYPTION_KEY: key },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function result(process) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    process.stdout.on('data', (data) => { stdout += data; });
    process.stderr.on('data', (data) => { stderr += data; });
    process.once('error', reject);
    process.once('exit', (code) => code === 0
      ? resolve(JSON.parse(stdout.trim().split(/\r?\n/).at(-1)))
      : reject(new Error(`child ${code}: ${stderr}\n${stdout}`)));
  });
}

test('two processes ingesting one provider retry create one message', { timeout: 30_000 }, async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dandpak-omni-race-'));
  const database = path.join(temp, 'store.db');
  const storage = path.join(temp, 'storage');
  const env = { ...process.env, SQLITE_PATH: database, STORAGE_PATH: storage, DATA_ENCRYPTION_KEY: key };
  const setup = spawnSync(process.execPath, ['--input-type=module', '-e',
    `const {db,migrate}=await import('./server/db.js'); migrate(); db.close();`],
  { cwd: path.resolve('.'), env, encoding: 'utf8' });
  assert.equal(setup.status, 0, setup.stderr);

  const source = `
    const {db,migrate}=await import('./server/db.js'); migrate();
    const Omni=await import('./server/services/omni/core.js');
    const event={provider:'facebook_messenger',event_key:'page:1:message:race',
      channel:{external_account_id:'page-1'},identity:{external_user_id:'psid-race'},
      conversation:{external_conversation_id:'psid-race'},
      message:{external_message_id:'race',direction:'inbound',body:'one'}};
    const out=Omni.ingestMessage(event,'sala'); console.log(JSON.stringify(out)); db.close();`;
  try {
    const outputs = await Promise.all([
      result(child(source, database, storage)),
      result(child(source, database, storage)),
    ]);
    assert.deepEqual(outputs.map((item) => item.duplicate).sort(), [false, true]);
    const check = new DatabaseSync(database, { readOnly: true });
    assert.equal(check.prepare('SELECT COUNT(*) n FROM omni_events').get().n, 1);
    assert.equal(check.prepare('SELECT COUNT(*) n FROM omni_messages').get().n, 1);
    assert.equal(check.prepare('PRAGMA quick_check').get().quick_check, 'ok');
    check.close();
    await new Promise((resolve) => setTimeout(resolve, 250));
  } finally {
    try {
      fs.rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch (error) {
      if (!['EBUSY', 'EPERM'].includes(error?.code)) throw error;
      // Windows may retain a short-lived SQLite/antivirus handle after every
      // child has exited. Keep correctness assertions independent from that
      // platform cleanup race and make one final best-effort pass on exit.
      t.diagnostic(`deferred Windows temp cleanup: ${error.code}`);
      process.once('exit', () => {
        try { fs.rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch {}
      });
    }
  }
});
