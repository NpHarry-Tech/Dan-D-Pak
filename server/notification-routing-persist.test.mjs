// Định tuyến thông báo PHẢI được lưu thật.
//
// Lỗi đã sửa: màn "Cài đặt → Cấu hình thông báo" gửi `notification_routing_config`
// lên /api/settings/app, nhưng updateSettings chỉ ghi các khoá nằm trong danh
// sách của nó và khoá này không có trong đó. Request trả 200, giao diện báo "Đã
// lưu cấu hình thông báo", mở lại thì mọi thứ về mặc định — im lặng mất dữ liệu.
//
// Đọc cũng hỏng theo: giá trị thô trong app_settings là CHUỖI JSON nên client
// kiểm `is Map` luôn trượt và rơi về định tuyến mặc định.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// SQLITE_PATH — ĐÚNG tên biến mà db/connection.js đọc (xem chú thích cùng loại
// trong sell-config-persist.test.mjs).
const temp = mkdtempSync(join(tmpdir(), 'dandpak-notify-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = process.env.DATA_ENCRYPTION_KEY
  || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const { migrate } = await import('./db.js');
const AppSettings = await import('./services/settings.js');

migrate();

test('luu roi doc lai thi ra DUNG object, khong phai chuoi JSON', () => {
  AppSettings.updateSettings({
    notification_routing_config: {
      roles: { invoice: ['cashier', 'manager'] },
      overrides: { u1: { invoice: false } },
    },
  }, 'sala');

  const doc = AppSettings.getSettings('sala').notification_routing_config;
  assert.equal(typeof doc, 'object', 'phai la object da parse, khong phai chuoi');
  assert.deepEqual(doc.roles.invoice, ['cashier', 'manager']);
  assert.equal(doc.overrides.u1.invoice, false);
});

test('gui rieng roles KHONG xoa overrides da luu', () => {
  // Bản điện thoại chỉ sửa 'roles' (ngoại lệ theo từng người chỉnh ở máy để
  // bàn). Nếu ghi đè cả khối thì lưu từ điện thoại là xoá sạch ngoại lệ.
  AppSettings.updateSettings({
    notification_routing_config: { roles: { inventory: ['warehouse'] } },
  }, 'sala');

  const doc = AppSettings.getSettings('sala').notification_routing_config;
  assert.deepEqual(doc.roles.inventory, ['warehouse']);
  assert.equal(doc.overrides.u1.invoice, false, 'overrides phai con nguyen');
});

test('chi nhanh khac khong thay cau hinh cua chi nhanh nay', () => {
  const khac = AppSettings.getSettings('br-khac').notification_routing_config;
  assert.equal(khac, null);
});
