import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-vault-callers-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_ACTIVE_KEY_ID = 'caller-test';
process.env.DATA_ENCRYPTION_KEY = '31'.repeat(32);

const { db, migrate } = await import('./db.js');
const Settings = await import('./services/settings.js');
const ErpSettings = await import('./services/settings/erp.js');
const Connections = await import('./services/connectionStore.js');
migrate();

test('settings integration/ERP callers persist v2 only and return masked payloads', () => {
  const integrationSecret = 'shopee-secret-clear-value';
  const current = Settings.getIntegrations('vault-a');
  Settings.updateIntegrations({
    ...current,
    channels: {
      ...current.channels,
      shopee: { ...current.channels.shopee, enabled: true, secretKey: integrationSecret },
    },
  }, 'vault-a');
  const row = db.prepare(`SELECT value FROM app_settings WHERE branch_id=? AND key='integrations_config'`).get('vault-a');
  assert.match(row.value, /enc:v2:/);
  assert.ok(!row.value.includes(integrationSecret));
  const publicSettings = Settings.getPublicIntegrations('vault-a');
  assert.match(publicSettings.channels.shopee.secretKey, /^\*+/);
  assert.ok(!JSON.stringify(publicSettings).includes(integrationSecret));

  const erpSecret = 'erp-client-secret-clear-value';
  ErpSettings.updateErpConfig({ enabled: true, clientSecret: erpSecret }, 'vault-a');
  const erpRow = db.prepare(`SELECT value FROM app_settings WHERE branch_id=? AND key='erp_config'`).get('vault-a');
  assert.match(erpRow.value, /enc:v2:/);
  assert.ok(!erpRow.value.includes(erpSecret));
  assert.equal(ErpSettings.getErpRuntimeConfig('vault-a').clientSecret, erpSecret);
  assert.equal(ErpSettings.publicErpConfig('vault-a').clientSecret, '********');

  const auditDump = JSON.stringify(db.prepare(`SELECT * FROM audit_log`).all());
  assert.ok(!auditDump.includes(integrationSecret));
  assert.ok(!auditDump.includes(erpSecret));
});

test('marketplace token caller binds branch/provider/shop/field and public API omits token', () => {
  const access = 'market-access-clear-value';
  const refresh = 'market-refresh-clear-value';
  const saved = Connections.upsertAuthorizedConnection({
    provider: 'shopee', branchId: 'vault-a', shopId: 'shop-100',
    accessToken: access, refreshToken: refresh,
  });
  assert.equal(saved.access_token, access);
  const row = db.prepare(`SELECT * FROM marketplace_connections WHERE id=?`).get(saved.id);
  assert.match(row.access_token_enc, /^enc:v2:/);
  assert.match(row.refresh_token_enc, /^enc:v2:/);
  assert.ok(!JSON.stringify(row).includes(access));
  assert.ok(!JSON.stringify(Connections.publicConnection(row)).includes(access));
  assert.equal(Connections.publicConnection(row).access_token, undefined);

  db.prepare(`UPDATE marketplace_connections SET branch_id='vault-b' WHERE id=?`).run(saved.id);
  assert.throws(() => Connections.findConnectionById(saved.id, 'vault-b'),
    /authenticate|decrypt|Unsupported|unable/i);
});
