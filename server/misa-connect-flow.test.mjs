// MISA meInvoice — lớp kết nối/cấu hình (KHÔNG phải luồng phát hành, xem
// misa-end-to-end.test.mjs cho luồng đó). Ba việc luật bắt buộc:
//   1. appId/apiBase/secretKey KHÔNG BAO GIỜ lọt ra khỏi getPublicIntegrations
//      dù dữ liệu cũ/khách gửi thừa vẫn còn nằm trong bản ghi.
//   2. Đổi tài khoản/ngắt kết nối phải THẬT SỰ xoá sạch (gửi rỗng là xoá, chứ
//      không âm thầm giữ giá trị cũ).
//   3. verifyManagerOwnerPin (gate mà route /settings/integrations dùng cho
//      MỌI thay đổi, kể cả ngắt kết nối MISA) từ chối PIN sai/rỗng.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-misa-connect-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = process.env.DATA_ENCRYPTION_KEY
  || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.MISA_MEINVOICE_APP_ID = 'test-app-id';
process.env.MISA_MEINVOICE_BASE_URL = 'http://127.0.0.1:1/api/v3';

const { migrate } = await import('./db.js');
const AppSettings = await import('./services/settings/integrations.js');
const Auth = await import('./services/auth.js');
const Misa = await import('./services/misa/index.js');

migrate();
const BR = 'sala';

test('getPublicIntegrations khong bao gio tra appId/apiBase/secretKey cho kenh misa', () => {
  AppSettings.updateIntegrations({
    channels: {
      misa: {
        enabled: true, taxCode: '0312345678', username: 'ketoan', password: 'matkhauthat',
        // Giả lập dữ liệu cũ/khách gửi thừa — vẫn phải bị lọc khi trả ra.
        appId: 'app-that-su', apiBase: 'https://api.meinvoice.vn', secretKey: 'bi-mat',
        templateId: 'tpl-1', series: 'C26MBM', configurationTestPassed: true,
      },
    },
  }, BR);

  const pub = AppSettings.getPublicIntegrations(BR);
  const misa = pub.channels.misa;
  assert.equal(misa.appId, undefined);
  assert.equal(misa.apiBase, undefined);
  assert.equal(misa.secretKey, undefined);
  assert.equal(misa.integrationType, undefined);
  // Mật khẩu vẫn phải bị che, không trả nguyên văn.
  assert.notEqual(misa.password, 'matkhauthat');
  const blob = JSON.stringify(pub);
  assert.ok(!blob.includes('app-that-su'));
  assert.ok(!blob.includes('bi-mat'));
  assert.ok(!blob.includes('matkhauthat'));
});

test('resolveServerCredentials luon lay appId/apiBase tu ENV, bo qua gia tri cu trong DB', () => {
  const stored = AppSettings.getIntegrations(BR).channels.misa;
  const resolved = Misa.resolveServerCredentials(stored);
  assert.equal(resolved.appId, 'test-app-id');
  assert.equal(resolved.apiBase, 'http://127.0.0.1:1/api/v3');
  assert.equal(resolved.integrationType, 'MISA_API_V3');
  assert.equal(resolved.secretKey, '');
});

test('ngat ket noi (gui rong) xoa that tai khoan/mat khau, khong am tham giu gia tri cu', () => {
  AppSettings.updateIntegrations({
    channels: { misa: { enabled: false, username: '', password: '', taxCode: '', configurationTestPassed: false } },
  }, BR);
  const cfg = AppSettings.getIntegrationChannel('misa', BR);
  assert.equal(cfg.enabled, false);
  assert.equal(cfg.username, '');
  assert.equal(cfg.password, '');
  assert.equal(cfg.taxCode, '');
  assert.equal(Misa.isLive(cfg), false);
});

test('verifyManagerOwnerPin tu choi PIN sai/rong — day la gate ma route dung cho MOI thay doi cau hinh (bao gom ngat ket noi MISA)', () => {
  assert.equal(Auth.verifyManagerOwnerPin('', BR), null);
  assert.equal(Auth.verifyManagerOwnerPin('0000', BR), null);
});
