import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dandpak-print-copies-'));
process.env.SQLITE_PATH = path.join(tempDir, 'test.db');
process.env.STORAGE_PATH = path.join(tempDir, 'storage');
process.env.PRINT_DISPATCH = 'agent';

const { db, migrate } = await import('./db.js');
const Print = await import('./services/printing.js');
const AppSettings = await import('./services/settings.js');
migrate();

test.after(() => {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('receipt copies come only from Bill settings, never from receipt payload', () => {
  AppSettings.updateSettings({ print_config: {
    bill: { copies: '2' },
    printers: [{
      id: 'receipt-lan', name: 'Receipt LAN', output: 'receipt',
      connection: 'lan', ip: '192.168.1.20', port: 9100, active: true, auto: true,
    }],
  } }, 'sala');

  const jobs = Print.printReceipt({
    bill_no: 'Dan-COPY-SOURCE',
    print_copies: 7,
    items: [{ name: 'Test item', qty: 1, unit_price: 10000, amount: 10000 }],
    subtotal: 10000,
    total: 10000,
  }, 'sala');

  assert.equal(jobs.length, 2);
  const payloads = jobs.map((job) => JSON.parse(
    db.prepare('SELECT payload_json FROM print_jobs WHERE id=?').get(job.id).payload_json,
  ));
  assert.deepEqual(payloads.map((payload) => payload.copy_index), [1, 2]);
  assert.deepEqual(payloads.map((payload) => payload.copy_total), [2, 2]);
});
