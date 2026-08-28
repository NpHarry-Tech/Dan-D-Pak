import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dandpak-display-'));
process.env.SQLITE_PATH = path.join(temp, 'store.db');
process.env.STORAGE_PATH = path.join(temp, 'storage');

const { db, migrate } = await import('./db.js');
const { sanitizeCustomerDisplay, materializeLegacyCustomerDisplayAssets } =
  await import('./services/settings/customerDisplay.js');
migrate();

test.after(() => {
  db.close();
  fs.rmSync(temp, { recursive: true, force: true });
});

test('customer display accepts its uploaded asset URL and rejects unrelated local paths', () => {
  const config = sanitizeCustomerDisplay({
    enabled: true,
    images: [
      '/uploads/customer-display/display_safe.png',
      '/etc/passwd',
      '/uploads/products/not-a-display-image.png',
    ],
  });
  assert.deepEqual(config.images, ['/uploads/customer-display/display_safe.png']);
});

test('legacy data image remains readable until the backed-up migration materializes it', () => {
  const legacy = 'data:image/png;base64,QUJD';
  assert.deepEqual(sanitizeCustomerDisplay({ images: [legacy] }).images, [legacy]);
});

test('legacy data images materialize idempotently and dry-run never mutates', () => {
  const legacy = 'data:image/png;base64,QUJD';
  db.prepare(`INSERT INTO app_settings(branch_id,key,value,updated_at) VALUES(?,?,?,?)`)
    .run('sala', 'customer_display', JSON.stringify({ enabled: true, images: [legacy] }), new Date().toISOString());

  const dry = materializeLegacyCustomerDisplayAssets({ dryRun: true });
  assert.equal(dry.rowsChanged, 1);
  assert.match(db.prepare(`SELECT value FROM app_settings WHERE branch_id='sala' AND key='customer_display'`).get().value, /data:image/);

  const applied = materializeLegacyCustomerDisplayAssets({ dryRun: false });
  assert.equal(applied.rowsChanged, 1);
  const stored = JSON.parse(db.prepare(
    `SELECT value FROM app_settings WHERE branch_id='sala' AND key='customer_display'`,
  ).get().value);
  assert.match(stored.images[0], /^\/uploads\/customer-display\/display_[a-f0-9]{64}\.png$/);
  const relative = stored.images[0].replace('/uploads/customer-display/', '');
  assert.equal(fs.readFileSync(path.join(temp, 'storage', 'uploads', 'customer-display', relative), 'utf8'), 'ABC');
  assert.equal(materializeLegacyCustomerDisplayAssets({ dryRun: false }).rowsChanged, 0);
});
