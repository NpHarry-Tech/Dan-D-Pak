import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-misa-blockers-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.DATA_ENCRYPTION_KEY ||= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const Misa = await import('./services/misa/index.js');

test('MISA production bi khoa khi con muc UNCONFIRMED', () => {
  const cfg = {
    enabled: true,
    environment: 'production',
    taxCode: '0312345678',
    appId: 'app',
    username: 'user',
    password: 'secret',
    integrationType: 'UNCONFIRMED',
    taxMethod: 'UNCONFIRMED',
    roundingPolicy: 'UNCONFIRMED',
  };
  assert.equal(Misa.isLive(cfg), false);
  assert.ok(Misa.activationBlockers(cfg).length >= 4);
});

test('MISA chi live khi da xac nhan du thong tin bat buoc', () => {
  assert.equal(Misa.isLive({
    enabled: true,
    environment: 'production',
    taxCode: '0312345678',
    appId: 'app',
    username: 'user',
    password: 'secret',
    integrationType: 'MISA_API_V3',
    taxMethod: 'CREDIT_METHOD',
    roundingPolicy: 'PER_INVOICE',
    templateId: 'tpl-1',
    series: 'C26MBM',
    configurationTestPassed: true,
  }), true);
});

test('SANDBOX cung phai phat hanh duoc — khong the nghiem thu tren production', () => {
  // Ep environment='production' moi cho chay nghia la muon thu thi phai phat
  // hanh hoa don THAT gui co quan thue. Sandbox phai chay duoc.
  assert.equal(Misa.isLive({
    enabled: true,
    environment: 'sandbox',
    taxCode: '0312345678',
    appId: 'app',
    username: 'user',
    password: 'secret',
    integrationType: 'MISA_API_V3',
    taxMethod: 'CREDIT_METHOD',
    roundingPolicy: 'PER_INVOICE',
    templateId: 'tpl-1',
    series: 'C26MBM',
    configurationTestPassed: true,
  }), true);
});

test('chua kiem tra ket noi thi KHONG duoc phat hanh', () => {
  const cfg = {
    enabled: true, environment: 'sandbox', taxCode: '0312345678',
    username: 'user', password: 'secret', integrationType: 'MISA_API_V3',
    taxMethod: 'CREDIT_METHOD', roundingPolicy: 'PER_INVOICE',
    templateId: 'tpl-1', series: 'C26MBM', configurationTestPassed: false,
  };
  assert.equal(Misa.isLive(cfg), false);
  assert.ok(Misa.activationBlockers(cfg).some((b) => /kiểm tra kết nối/i.test(b)));
});
