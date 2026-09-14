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

test('xoa danh muc chi con mon DA LUU TRU: tu dong chuyen sang nhom "Đã lưu trữ" roi xoa duoc, khong con chan', () => {
  const cat = Catalog.createCategory({ name: 'Mì cũ' }, B);
  db.prepare(`INSERT INTO menu_items (id, branch_id, category_id, name, price, deleted_at)
    VALUES ('mi_2', ?, ?, 'Món B', 10000, datetime('now'))`).run(B, cat.id);

  const r = Catalog.deleteCategory(cat.id, B);
  assert.equal(r.ok, true);
  // Nhóm gốc phải mất hẳn.
  assert.equal(db.prepare(`SELECT 1 FROM categories WHERE id=?`).get(cat.id), undefined);
  // Món ẩn phải được CHUYỂN sang nhóm "Đã lưu trữ", không mất dữ liệu.
  const moved = db.prepare(`SELECT category_id FROM menu_items WHERE id='mi_2'`).get();
  const archivedCat = db.prepare(`SELECT * FROM categories WHERE branch_id=? AND name='Đã lưu trữ'`).get(B);
  assert.ok(archivedCat, 'phải tự tạo nhóm "Đã lưu trữ"');
  assert.equal(moved.category_id, archivedCat.id);
});

test('xoa nhieu nhom co mon an lien tiep deu don ve CHUNG mot nhom "Đã lưu trữ", khong tao nhom moi moi lan', () => {
  const catA = Catalog.createCategory({ name: 'Nhóm A' }, B);
  const catB = Catalog.createCategory({ name: 'Nhóm B' }, B);
  db.prepare(`INSERT INTO menu_items (id, branch_id, category_id, name, price, deleted_at)
    VALUES ('mi_a', ?, ?, 'Món A', 10000, datetime('now'))`).run(B, catA.id);
  db.prepare(`INSERT INTO menu_items (id, branch_id, category_id, name, price, deleted_at)
    VALUES ('mi_b', ?, ?, 'Món B2', 10000, datetime('now'))`).run(B, catB.id);
  Catalog.deleteCategory(catA.id, B);
  Catalog.deleteCategory(catB.id, B);
  const archivedCats = db.prepare(`SELECT COUNT(*) n FROM categories WHERE branch_id=? AND name='Đã lưu trữ'`).get(B).n;
  assert.equal(archivedCats, 1, 'chỉ một nhóm "Đã lưu trữ" duy nhất, không nhân bản');
  const catIds = db.prepare(`SELECT DISTINCT category_id FROM menu_items WHERE id IN ('mi_a','mi_b')`).all();
  assert.equal(catIds.length, 1, 'cả hai món phải nằm CHUNG một nhóm đã lưu trữ');
});

test('xoa CHINH nhom "Đã lưu trữ" khi con mon: van chan ro rang (khong tu chuyen sang chinh no)', () => {
  const cat = Catalog.createCategory({ name: 'Nhóm C' }, B);
  db.prepare(`INSERT INTO menu_items (id, branch_id, category_id, name, price, deleted_at)
    VALUES ('mi_c', ?, ?, 'Món C', 10000, datetime('now'))`).run(B, cat.id);
  Catalog.deleteCategory(cat.id, B); // dồn món vào "Đã lưu trữ"
  const archivedCat = db.prepare(`SELECT * FROM categories WHERE branch_id=? AND name='Đã lưu trữ'`).get(B);
  assert.throws(
    () => Catalog.deleteCategory(archivedCat.id, B),
    /không thể tự chuyển sang chính nó/,
  );
});
