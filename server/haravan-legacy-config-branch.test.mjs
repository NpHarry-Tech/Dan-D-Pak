// Sự cố 2026-09-18: tenant review (chỉ có chi nhánh 'review', không có 'sala')
// lưu cấu hình Haravan thành công nhưng Đồng bộ ngay không làm gì cả (200 giả,
// <15ms, không network call). Nguyên nhân: legacyConfig() hard-code đọc chi
// nhánh 'sala' để lấy accessToken/shopDomain, nên ở tenant không có 'sala' nó
// luôn ra cấu hình rỗng dù đã lưu đúng chi nhánh thật. Test này dựng 1 tenant
// kiểu review (chỉ 1 chi nhánh, không phải 'sala') và xác nhận Haravan đọc
// được cấu hình đã lưu.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

process.env.APP_ENV = 'review';
const temp = mkdtempSync(join(tmpdir(), 'dandpak-haravan-branch-'));
process.env.SQLITE_PATH = join(temp, 'review.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = process.env.DATA_ENCRYPTION_KEY
  || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const { migrate, db } = await import('./db.js');
migrate();
// bootstrapBranchDefaults() bị bỏ qua khi isReview — dựng thủ công 1 chi
// nhánh DUY NHẤT, KHÔNG phải 'sala', giống hệt tenant review thật.
db.prepare(`INSERT INTO branches (id,name,address,code,active,sort) VALUES ('review','Test Review Branch','','REVIEW',1,1)`).run();

const { updateIntegrations } = await import('./services/settings/integrations.js');
updateIntegrations({
  channels: { haravan: { enabled: true, shopDomain: 'test-shop.myharavan.com', accessToken: 'tok123', clientId: 'cid', clientSecret: 'csec' } },
}, 'review');

const Haravan = await import('./services/haravanConnector.js');

test('tenant chỉ có 1 chi nhánh không phải sala vẫn đọc được cấu hình Haravan đã lưu', () => {
  const status = Haravan.status('review');
  assert.equal(status.tokenConfigured, true);
  assert.equal(status.shopDomain, 'test-shop.myharavan.com');
});
