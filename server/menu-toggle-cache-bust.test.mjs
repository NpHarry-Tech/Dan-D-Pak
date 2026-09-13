// NÚT GẠT "Đang bán/Tạm hết" (và Tại chỗ/Mang đi) tự nhảy về trạng thái CŨ
// sau khi bấm: DB đã ghi đúng ngay lập tức, nhưng listMenu() cache 10 giây
// (MENU_TTL, xem catalog.js) trả lại dữ liệu CŨ cho lần fetch-lại NGAY SAU
// khi bấm — vì /menu/:id/availability, /menu/:id/channels, /menu/:id/sort
// quên gọi Catalog.cacheBust('menu:') như MỌI mutation khác trong cùng file
// (vd /menu/:id ở dòng ~183, hideMenuItem trong catalog.js). Test này gọi
// THẲNG route handler thật (không mock nghiệp vụ) để bắt lại đúng lỗi này
// nếu ai đó lỡ xoá dòng cacheBust trong tương lai.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

process.env.SQLITE_PATH = join(mkdtempSync(join(tmpdir(), 'ddp-menutoggle-')), 'store.db');
process.env.STORAGE_PATH = join(tmpdir(), 'menutoggle-store');

const { db, migrate } = await import('./db.js');
const Catalog = await import('./services/catalog.js');
const { registerCatalogRoutes } = await import('./modules/catalog/routes.js');
migrate();

const B = 'sala';
db.prepare(`INSERT INTO categories (id,branch_id,name) VALUES ('cat_t','sala','Test')`).run();
db.prepare(`INSERT INTO menu_items (id,branch_id,category_id,name,price,available,available_dine_in,available_takeaway)
  VALUES ('mi_t','sala','cat_t','Món test',50000,1,1,1)`).run();

// Bắt route handler THẬT (guard/wrap chỉ pass-through, không đụng logic nghiệp vụ).
const routes = new Map();
const api = {
  get(path, ...handlers) { routes.set(`GET ${path}`, handlers[handlers.length - 1]); },
  post(path, ...handlers) { routes.set(`POST ${path}`, handlers[handlers.length - 1]); },
};
registerCatalogRoutes(api, {
  wrap: (handler) => handler,
  guard: () => (req, res, next) => next(),
  branch: (req) => req.branch_id || B,
  visibleBranch: (req) => req.branch_id || B,
  actor: () => 'tester',
  saveBase64Image: () => { throw new Error('not used in this test'); },
  MENU_UPLOADS_DIR: '/tmp',
});

async function fetchAdminMenu() {
  return routes.get('GET /menu/manage')({ query: {}, branch_id: B });
}

test('bat "Tam het": /menu/manage fetch NGAY SAU đó phải thấy gia tri MOI, khong con cache cu', async () => {
  // Mo man Thuc don (nhu client that lam trong initState/_load) -> nap cache.
  const before = await fetchAdminMenu();
  assert.equal(before.items.find(i => i.id === 'mi_t').available, true);

  await routes.get('POST /menu/:id/availability')({
    params: { id: 'mi_t' }, body: { available: false }, branch_id: B,
  });

  const after = await fetchAdminMenu();
  assert.equal(after.items.find(i => i.id === 'mi_t').available, false,
    'sau khi bam tat mon, fetch lai NGAY phai thay false — khong duoc dinh cache 10s cu');
});

test('doi kenh Tai cho/Mang di: fetch NGAY SAU do phai thay gia tri MOI', async () => {
  await fetchAdminMenu(); // nap lai cache voi trang thai hien tai
  await routes.get('POST /menu/:id/channels')({
    params: { id: 'mi_t' }, body: { available_dine_in: false }, branch_id: B,
  });
  const after = await fetchAdminMenu();
  const item = after.items.find(i => i.id === 'mi_t');
  assert.equal(item.available_dine_in, false);
  assert.equal(item.available_takeaway, true, 'khong dung cham den kenh con lai');
});

test('doi thu tu sap xep: fetch NGAY SAU do phai thay gia tri MOI', async () => {
  await fetchAdminMenu();
  await routes.get('POST /menu/:id/sort')({
    params: { id: 'mi_t' }, body: { sort: 42 }, branch_id: B,
  });
  const after = await fetchAdminMenu();
  assert.equal(after.items.find(i => i.id === 'mi_t').sort, 42);
});
