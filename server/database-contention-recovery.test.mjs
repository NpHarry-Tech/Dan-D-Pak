import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

const node = process.execPath;

function runChild(source, args = [], timeout = 15_000) {
  return spawnSync(node, ['--input-type=module', '-e', source, ...args], {
    encoding: 'utf8', timeout,
  });
}

function startChild(source, args = []) {
  return spawn(node, ['--input-type=module', '-e', source, ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function waitForLine(child, expected, timeout = 5_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${expected}`)), timeout);
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.includes(expected)) {
        clearTimeout(timer);
        resolve(output);
      }
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (!output.includes(expected)) reject(new Error(`Child exited ${code}: ${output}`));
    });
  });
}

function waitForExit(child, timeout = 10_000) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Child did not exit'));
    }, timeout);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
    child.once('error', reject);
  });
}

test('WAL serializes two processes without lost writes or SQLITE_BUSY leakage', async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dandpak-contention-'));
  const file = path.join(temp, 'store.db');
  const setup = new DatabaseSync(file);
  setup.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
    CREATE TABLE ledger(id TEXT PRIMARY KEY, amount INTEGER NOT NULL);`);
  setup.close();

  const holder = startChild(`
    import {DatabaseSync} from 'node:sqlite';
    const db=new DatabaseSync(process.argv[1]);
    db.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');
    db.prepare('INSERT INTO ledger VALUES(?,?)').run('writer-a',100);
    console.log('LOCKED');
    setTimeout(()=>{ db.exec('COMMIT'); db.close(); },700);`, [file]);

  try {
    await waitForLine(holder, 'LOCKED');
    const started = performance.now();
    const contender = runChild(`
      import {DatabaseSync} from 'node:sqlite';
      const db=new DatabaseSync(process.argv[1]);
      db.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');
      db.prepare('INSERT INTO ledger VALUES(?,?)').run('writer-b',200);
      db.exec('COMMIT'); db.close();`, [file]);
    const waitedMs = performance.now() - started;
    t.diagnostic(`second writer lock wait=${waitedMs.toFixed(0)}ms (holder=700ms)`);
    assert.equal(contender.status, 0, contender.stderr);
    assert.ok(waitedMs >= 450 && waitedMs < 5_000, `contention wait ${waitedMs.toFixed(0)}ms`);
    assert.equal((await waitForExit(holder)).code, 0);

    const check = new DatabaseSync(file);
    assert.equal(check.prepare('SELECT COUNT(*) n FROM ledger').get().n, 2);
    assert.equal(check.prepare('SELECT SUM(amount) total FROM ledger').get().total, 300);
    assert.equal(check.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
    assert.equal(check.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    check.close();
  } finally {
    if (!holder.killed && holder.exitCode == null) holder.kill();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('checkpoint can run beside an active WAL reader and preserves every row', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dandpak-checkpoint-'));
  const file = path.join(temp, 'store.db');
  const writer = new DatabaseSync(file);
  writer.exec('PRAGMA journal_mode=WAL; CREATE TABLE events(id INTEGER PRIMARY KEY, value TEXT);');
  const insert = writer.prepare('INSERT INTO events(value) VALUES(?)');
  writer.exec('BEGIN IMMEDIATE');
  for (let i = 0; i < 2_000; i++) insert.run(`event-${i}`);
  writer.exec('COMMIT');
  const reader = new DatabaseSync(file, { readOnly: true });
  reader.exec('BEGIN');
  assert.equal(reader.prepare('SELECT COUNT(*) n FROM events').get().n, 2_000);
  writer.exec('BEGIN IMMEDIATE');
  for (let i = 2_000; i < 2_100; i++) insert.run(`event-${i}`);
  writer.exec('COMMIT');

  const checkpoint = writer.prepare('PRAGMA wal_checkpoint(PASSIVE)').get();
  assert.equal(typeof checkpoint.busy, 'number');
  reader.exec('COMMIT');
  reader.close();
  const finalCheckpoint = writer.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
  assert.equal(finalCheckpoint.busy, 0);
  assert.equal(writer.prepare('SELECT COUNT(*) n FROM events').get().n, 2_100);
  assert.equal(writer.prepare('PRAGMA quick_check').get().quick_check, 'ok');
  writer.close();
  fs.rmSync(temp, { recursive: true, force: true });
});

test('restart recovers committed WAL data and discards a crashed transaction', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dandpak-crash-'));
  const file = path.join(temp, 'store.db');
  const setup = new DatabaseSync(file);
  setup.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
    CREATE TABLE payments(id TEXT PRIMARY KEY, amount INTEGER NOT NULL);`);
  setup.close();

  const crashed = runChild(`
    import {DatabaseSync} from 'node:sqlite';
    const db=new DatabaseSync(process.argv[1]);
    db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL');
    db.prepare('INSERT INTO payments VALUES(?,?)').run('committed',500000);
    db.exec('BEGIN IMMEDIATE');
    db.prepare('INSERT INTO payments VALUES(?,?)').run('uncommitted',900000);
    process.abort();`, [file]);
  assert.notEqual(crashed.status, 0);

  const reopened = new DatabaseSync(file);
  assert.equal(reopened.prepare("SELECT COUNT(*) n FROM payments WHERE id='committed'").get().n, 1);
  assert.equal(reopened.prepare("SELECT COUNT(*) n FROM payments WHERE id='uncommitted'").get().n, 0);
  assert.equal(reopened.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  reopened.close();
  fs.rmSync(temp, { recursive: true, force: true });
});
