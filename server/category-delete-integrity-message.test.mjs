// BUG THAT: bam xoa danh muc bao "Request failed" vo nghia du server co ly do
// ro rang (mon an - ke ca da luu tru, con lich su don hang - van tham chieu
// danh muc do). Nguyen nhan kep:
//  1) core/errors.js coi MOI loi co code bat dau "ERR_" la "he thong" roi che
//     thanh "Request failed" — nhung cong toan ven du lieu (trigger SQLite
//     trong initCriticalIntegrityGuards) cung nem loi voi code ERR_SQLITE_ERROR
//     du day la loi NGHIEP VU co chu dich, anh huong MOI quan he cha-con
//     trong he thong, khong rieng danh muc/mon an.
//  2) deleteCategory() chi dem mon DANG HOAT DONG, khong biet mon DA LUU TRU
//     (deleted_at khac NULL, con lich su don hang) van giu category_id nen
//     khong bao truoc duoc ly do that.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { errorPayload, isUnexpectedSystemError } from './core/errors.js';

test('loi cong toan ven "integrity:...:parent-delete" KHONG bi coi la loi he thong', () => {
  const err = new Error('integrity:menu_items.category_id->categories.id:parent-delete');
  err.code = 'ERR_SQLITE_ERROR';
  assert.equal(isUnexpectedSystemError(err), false);
  const payload = errorPayload(err);
  assert.notEqual(payload.message, 'Request failed');
  assert.match(payload.message, /menu_items/);
  assert.match(payload.message, /Không thể xóa/);
});

test('loi cong toan ven parent-update cung duoc dich, khong bi che', () => {
  const err = new Error('integrity:skus.warehouse_id->warehouses.id:parent-update');
  err.code = 'ERR_SQLITE_ERROR';
  const payload = errorPayload(err);
  assert.match(payload.message, /skus/);
  assert.match(payload.message, /Không thể sửa/);
});

test('loi ERR_ THAT SU khong lien quan toan ven van bi che nhu cu (khong regress)', () => {
  const err = new Error('no such table: orders_x');
  err.code = 'ERR_SQLITE_ERROR';
  const payload = errorPayload(err);
  assert.equal(payload.message, 'Request failed');
});

const temp = mkdtempSync(join(tmpdir(), 'dandpak-cat-delete-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const { db, migrate } = await import('./db.js');
migrate();
const Catalog = await import('./services/catalog.js');

const B = 'sala';

test('xoa danh muc TRONG (chua bao gio co mon) thi thanh cong', () => {
  const cat = Catalog.createCategory({ name: 'Trống' }, B);
  const r = Catalog.deleteCategory(cat.id, B);
  assert.equal(r.ok, true);
});

test('xoa danh muc con mon DANG HOAT DONG bao dung so luong', () => {
  const cat = Catalog.createCategory({ name: 'Có món' }, B);
  db.prepare(`INSERT INTO menu_items (id, branch_id, category_id, name, price) VALUES ('mi_1', ?, ?, 'Món A', 10000)`)
    .run(B, cat.id);
  assert.throws(
    () => Catalog.deleteCategory(cat.id, B),
    /còn 1 món trong danh mục này/,
  );
});

test('xoa danh muc chi con mon DA LUU TRU (lich su don hang) bao ro ly do, khong phai "Request failed"', () => {
  const cat = Catalog.createCategory({ name: 'Đã lưu trữ' }, B);
  db.prepare(`INSERT INTO menu_items (id, branch_id, category_id, name, price, deleted_at)
    VALUES ('mi_2', ?, ?, 'Món B', 10000, datetime('now'))`).run(B, cat.id);
  assert.throws(
    () => Catalog.deleteCategory(cat.id, B),
    /1 món đã lưu trữ.*lịch sử đơn hàng/,
  );
  // Đảm bảo lời hứa của thông báo là thật: KHÔNG bao giờ chạm được xuống tới
  // trigger toàn vẹn dữ liệu (nếu chạm thì đây là bug khác — thông báo sai).
  const stillExists = db.prepare(`SELECT 1 FROM categories WHERE id=?`).get(cat.id);
  assert.ok(stillExists, 'danh mục phải còn nguyên vì bị chặn từ tầng JS, chưa tới DELETE');
});
