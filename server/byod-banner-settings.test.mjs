// Banner quảng cáo đầu menu BYOD (services/settings/byodBanner.js) — ảnh chỉ
// được nhận nếu là URL đã upload thật (không cho data:/path lạ lọt qua), và
// bootstrap() phải mang cấu hình này ra cho trang menu vẽ carousel.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

process.env.SQLITE_PATH = join(mkdtempSync(join(tmpdir(), 'ddp-byodbanner-')), 'store.db');
process.env.STORAGE_PATH = join(tmpdir(), 'byodbanner-store');
process.env.BYOD_TOKEN_SECRET = 'test-only-byod-secret-with-at-least-32-chars';

const { migrate } = await import('./db.js');
const { sanitizeByodBanner, getByodBannerConfig } = await import('./services/settings/byodBanner.js');
const Settings = await import('./services/settings.js');
const Orders = await import('./services/orders.js');
const Byod = await import('./services/byod.js');
migrate();

test('sanitizeByodBanner: chi giu URL da upload/http, loai anh la, gioi han so luong va thoi gian', () => {
  const out = sanitizeByodBanner({
    enabled: true,
    secondsPerImage: 999,
    images: ['/uploads/byod-banner/a.png', 'https://cdn.example.com/b.png', 'data:image/png;base64,xx', '/etc/passwd'],
  });
  assert.equal(out.enabled, true);
  assert.equal(out.secondsPerImage, 30);
  assert.deepEqual(out.images, ['/uploads/byod-banner/a.png', 'https://cdn.example.com/b.png']);
});

test('getByodBannerConfig: mac dinh tat, khong co anh', () => {
  const cfg = getByodBannerConfig('sala');
  assert.equal(cfg.enabled, false);
  assert.deepEqual(cfg.images, []);
});

test('updateSettings(byod_banner) roundtrip qua Settings.getSettings', () => {
  Settings.updateSettings({ byod_banner: { enabled: true, secondsPerImage: 6, images: ['/uploads/byod-banner/x.png'] } }, 'sala');
  const s = Settings.getSettings('sala');
  assert.deepEqual(s.byod_banner, { enabled: true, secondsPerImage: 6, images: ['/uploads/byod-banner/x.png'] });
});

test('bootstrap(): mang theo banner cho trang menu BYOD', () => {
  const table = Orders.createTable({ branch_id: 'sala', zone: 'Tầng trệt', code: 'BN01', seats: 4 });
  const qr = Byod.getTableQr(table.id, 'sala');
  const view = Byod.bootstrap(qr.token, 'device_banner_test_1234567890', 'iPhone', 'vi');
  assert.deepEqual(view.banner, { enabled: true, secondsPerImage: 6, images: ['/uploads/byod-banner/x.png'] });
});
