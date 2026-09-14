// Mon da an (hidden=1) mac dinh day xuong CUOI danh sach thay vi chen giua
// mon dang ban theo thu tu sort thong thuong — de nhan vien quet mat chon
// mon khong bi mon tam tat lam roi mat. F&B POS van thay du mon an (khong
// loc mat), chi doi CHO hien thi.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-menu-sort-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const { db, migrate } = await import('./db.js');
migrate();
const Catalog = await import('./services/catalog.js');

const B = 'sala';
const cat = Catalog.createCategory({ name: 'Món chính' }, B);

// sort cố ý XEN KẼ để chứng minh hidden thắng sort, không phải trùng hợp thứ tự chèn.
db.prepare(`INSERT INTO menu_items (id, branch_id, category_id, name, price, sort, hidden)
  VALUES ('mi_visible_2', ?, ?, 'Món hiện thứ 2', 10000, 2, 0)`).run(B, cat.id);
db.prepare(`INSERT INTO menu_items (id, branch_id, category_id, name, price, sort, hidden)
  VALUES ('mi_hidden_1', ?, ?, 'Món ẩn sort=1', 10000, 1, 1)`).run(B, cat.id);
db.prepare(`INSERT INTO menu_items (id, branch_id, category_id, name, price, sort, hidden)
  VALUES ('mi_visible_3', ?, ?, 'Món hiện thứ 3', 10000, 3, 0)`).run(B, cat.id);
db.prepare(`INSERT INTO menu_items (id, branch_id, category_id, name, price, sort, hidden)
  VALUES ('mi_hidden_0', ?, ?, 'Món ẩn sort=0', 10000, 0, 1)`).run(B, cat.id);

test('danh sach phan trang (man Thuc don admin): mon an luon o duoi, du sort nho hon', () => {
  const { items } = Catalog.listMenu({ branch_id: B, page: 1, limit: 40, category_id: cat.id });
  const ids = items.map((i) => i.id);
  assert.deepEqual(ids, ['mi_visible_2', 'mi_visible_3', 'mi_hidden_0', 'mi_hidden_1'],
    'hien truoc (theo sort), an sau (theo sort trong nhom an)');
});

test('danh sach khong phan trang (POS/self-order truoc loc): cung day mon an xuong cuoi', () => {
  const { items } = Catalog.listMenu({ branch_id: B });
  const ids = items.filter((i) => i.category_id === cat.id).map((i) => i.id);
  assert.deepEqual(ids, ['mi_visible_2', 'mi_visible_3', 'mi_hidden_0', 'mi_hidden_1']);
});
