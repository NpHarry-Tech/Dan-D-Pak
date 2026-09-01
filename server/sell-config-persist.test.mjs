// Thiết lập bán hàng PHẢI được lưu thật.
//
// Lỗi đã sửa: màn "Cài đặt → Thiết lập bán hàng" gửi `sell_config` lên
// /api/settings/app, nhưng phía server KHÔNG có một dòng nào nhắc tới khoá này
// — updateSettings chỉ ghi các khoá trong danh sách của nó. Request trả 200,
// công tắc gạt sang nhìn như đã lưu, thoát ra vào lại là về mặc định.
//
// Đọc cũng hỏng cùng kiểu: giá trị thô trong app_settings là CHUỖI JSON nên
// client kiểm `is Map` luôn trượt và rơi về mặc định.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// SQLITE_PATH — ĐÚNG tên biến mà db/connection.js đọc. Đặt nhầm 'DB_PATH' thì
// biến bị bỏ qua và test chạy thẳng vào DB dev thật: lần đầu xanh, lần sau đỏ
// vì dữ liệu lần trước còn đó (và tệ hơn: test ghi bậy vào DB đang dùng).
const temp = mkdtempSync(join(tmpdir(), 'dandpak-sell-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = process.env.DATA_ENCRYPTION_KEY
  || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const { migrate } = await import('./db.js');
const AppSettings = await import('./services/settings.js');

migrate();

test('chua cau hinh gi thi ra mac dinh, va la OBJECT', () => {
  const cfg = AppSettings.getSettings('sala').sell_config;
  assert.equal(typeof cfg, 'object', 'phai la object da parse, khong phai chuoi');
  assert.equal(cfg.merge_same_items, true);
  assert.equal(cfg.auto_complete_on_bank, false);
  assert.equal(cfg.default_method, 'cash');
});

test('luu roi doc lai thi ra DUNG gia tri vua luu', () => {
  AppSettings.updateSettings({
    sell_config: {
      auto_complete_on_bank: true,
      merge_same_items: false,
      share_after_done: true,
      default_method: 'bank',
    },
  }, 'sala');

  const cfg = AppSettings.getSettings('sala').sell_config;
  assert.equal(cfg.auto_complete_on_bank, true);
  assert.equal(cfg.merge_same_items, false);
  assert.equal(cfg.share_after_done, true);
  assert.equal(cfg.default_method, 'bank');
});

test('gui MOT cong tac khong lam mat cac cong tac khac', () => {
  AppSettings.updateSettings({ sell_config: { share_after_done: false } }, 'sala');
  const cfg = AppSettings.getSettings('sala').sell_config;
  assert.equal(cfg.share_after_done, false);
  assert.equal(cfg.auto_complete_on_bank, true, 'cong tac khac phai con nguyen');
  assert.equal(cfg.default_method, 'bank');
});

test('phuong thuc cua ban app CU duoc quy ve 4 khoa chuan', () => {
  // Bản app trước gửi 'transfer'/'card'/'qr'; hai bên cùng ghi mà không quy về
  // một chuẩn thì tab thanh toán mặc định không bao giờ khớp.
  for (const [gui, mong] of [['transfer', 'bank'], ['qr', 'bank'], ['card', 'visa']]) {
    AppSettings.updateSettings({ sell_config: { default_method: gui } }, 'sala');
    assert.equal(AppSettings.getSettings('sala').sell_config.default_method, mong);
  }
});

test('phuong thuc rac roi vao mac dinh, khong luu bua', () => {
  AppSettings.updateSettings({ sell_config: { default_method: 'bitcoin' } }, 'sala');
  assert.equal(AppSettings.getSettings('sala').sell_config.default_method, 'cash');
});

test('chi nhanh khac khong an theo cau hinh cua chi nhanh nay', () => {
  const khac = AppSettings.getSettings('br-khac').sell_config;
  assert.equal(khac.default_method, 'cash');
  assert.equal(khac.merge_same_items, true);
});
