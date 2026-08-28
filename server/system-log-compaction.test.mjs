import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('missing-printer storms collapse but keep one trace per order/day', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'ddp-system-log-compact-'));
  const previous = {
    sqlite: process.env.SQLITE_PATH,
    storage: process.env.STORAGE_PATH,
    key: process.env.DATA_ENCRYPTION_KEY,
  };
  try {
    process.env.SQLITE_PATH = join(temp, 'store.db');
    process.env.STORAGE_PATH = join(temp, 'storage');
    process.env.DATA_ENCRYPTION_KEY = '0123456789abcdef'.repeat(4);
    const Db = await import(`./db.js?system-log-compact=${Date.now()}`);
    Db.migrate();
    const Logs = await import(`./services/systemLogs.js?system-log-compact=${Date.now()}`);

    for (let i = 0; i < 5; i++) {
      Logs.logSystem({
        eventType: 'receipt_printer_missing', branchId: 'sala',
        orderId: 'order-1', title: `attempt ${i}`,
      });
    }
    Logs.logSystem({
      eventType: 'receipt_printer_missing', branchId: 'sala',
      orderId: 'order-2', title: 'other order',
    });
    Logs.logSystem({ eventType: 'important_event', branchId: 'sala', title: 'keep me' });

    const result = Logs.maintainSystemLogs();
    assert.equal(result.collapsedPrinterWarnings, 4);
    assert.equal(Db.db.prepare(
      `SELECT COUNT(*) n FROM system_logs WHERE event_type='receipt_printer_missing'`,
    ).get().n, 2);
    assert.equal(Db.db.prepare(
      `SELECT COUNT(*) n FROM system_logs WHERE event_type='important_event'`,
    ).get().n, 1);
    Db.db.close();
  } finally {
    if (previous.sqlite === undefined) delete process.env.SQLITE_PATH;
    else process.env.SQLITE_PATH = previous.sqlite;
    if (previous.storage === undefined) delete process.env.STORAGE_PATH;
    else process.env.STORAGE_PATH = previous.storage;
    if (previous.key === undefined) delete process.env.DATA_ENCRYPTION_KEY;
    else process.env.DATA_ENCRYPTION_KEY = previous.key;
    rmSync(temp, { recursive: true, force: true });
  }
});
