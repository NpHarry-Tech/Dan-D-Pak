// MISA_MEINVOICE_APP_ID là credential ỨNG DỤNG (server), không phải của cửa
// hàng — cố tình KHÔNG set biến này trong file test riêng này (process riêng,
// snapshot env.js riêng) để xác nhận: server chưa cấp AppID thì kích hoạt bị
// chặn bằng thông báo RIÊNG (lỗi hạ tầng), không lẫn với "sai tài khoản MISA",
// và testConnection() không hề gọi mạng ra ngoài khi chưa cấu hình.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-misa-noappid-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.DATA_ENCRYPTION_KEY ||= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
// KHÔNG set MISA_MEINVOICE_APP_ID — đây là điểm của file test này.

const Misa = await import('./services/misa/index.js');

const CFG_DAY_DU = {
  enabled: true, environment: 'production', taxCode: '0312345678',
  username: 'user', password: 'secret', templateId: 'tpl-1', series: 'C26MBM',
  configurationTestPassed: true,
};

test('serverConfigured() = false khi thieu MISA_MEINVOICE_APP_ID', () => {
  assert.equal(Misa.serverConfigured(), false);
});

test('activationBlockers bao loi ha tang RIENG, khong lien quan tai khoan cua hang', () => {
  assert.equal(Misa.isLive(CFG_DAY_DU), false);
  assert.ok(Misa.activationBlockers(CFG_DAY_DU).some((b) => /server chưa đầy đủ/i.test(b)));
});

test('testConnection tra SERVER_NOT_CONFIGURED ngay, khong goi mang', async () => {
  globalThis.fetch = async () => { throw new Error('KHÔNG được gọi mạng khi server chưa cấu hình'); };
  const kq = await Misa.testConnection(Misa.resolveServerCredentials(CFG_DAY_DU));
  assert.equal(kq.ok, false);
  assert.equal(kq.status, Misa.CONFIG_STATUS.SERVER_NOT_CONFIGURED);
});
