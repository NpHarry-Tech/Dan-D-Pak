import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-sales-modules-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');

const { migrate } = await import('./db.js');
const Settings = await import('./services/settings.js');
const Modules = await import('./services/modules.js');
const Branches = await import('./services/branches.js');

migrate();

test('module bán hàng mặc định bật và tách riêng theo chi nhánh', () => {
  assert.deepEqual(Settings.getSalesModules('sala'), {
    fnb: true,
    retail: true,
    kds: true,
  });

  Branches.createBranch({
    name: 'Chỉ F&B',
    code: 'FNB_ONLY',
    sales_modules: { fnb: true, retail: false, kds: false },
  });
  assert.deepEqual(Settings.getSalesModules('fnb_only'), {
    fnb: true,
    retail: false,
    kds: false,
  });
  assert.equal(Settings.getSalesModules('sala').retail, true);
});

test('registry ẩn đúng Retail, F&B và KDS nhưng không ảnh hưởng module khác', () => {
  const modules = Modules.visibleModules(
    ['*'],
    { fnb: false, retail: false, kds: false },
  );
  const keys = new Set(modules.map((m) => m.key));

  for (const key of ['pos', 'ipad', 'online', 'retail', 'kds']) {
    assert.equal(keys.has(key), false, `${key} phải bị ẩn`);
  }
  assert.equal(keys.has('warehouse'), true);
  assert.equal(keys.has('settings'), true);
});

test('backend từ chối module đã tắt bằng lỗi ổn định', () => {
  Settings.updateSettings({
    sales_modules: { fnb: true, retail: false, kds: false },
  }, 'sala');

  assert.throws(
    () => Settings.assertSalesModuleEnabled('retail', 'sala'),
    (error) => error.code === 'MODULE_DISABLED' && error.status === 403,
  );
  assert.doesNotThrow(() => Settings.assertSalesModuleEnabled('fnb', 'sala'));
  assert.equal(
    Settings.sanitizeSalesModules({ fnb: false, kds: true }).kds,
    false,
    'KDS không được bật mồ côi khi F&B đã tắt',
  );
});
