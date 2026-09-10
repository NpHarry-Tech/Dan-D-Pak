// Thực đơn hiển thị đầy đủ (mã món, thứ tự, thời gian cập nhật, bán tại chỗ/
// mang đi tách riêng) — khoá lại qua ROUTE HANDLER THẬT (không chỉ service),
// theo đúng cách retail-multidevice-http.test.mjs làm cho retail routes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const temp = mkdtempSync(join(tmpdir(), 'ddp-menufields-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.DISABLE_DEMO_SEED = 'true';

const { db, migrate } = await import('./db.js');
const { hashPin } = await import('./services/pin.js');
const { registerCatalogRoutes } = await import('./modules/catalog/routes.js');
migrate();

const BR = 'sala';
db.prepare(`INSERT INTO categories (id,branch_id,name) VALUES ('cat_x','sala','Test')`).run();
db.prepare(`INSERT INTO production_stations (id,branch_id,code,name,active,sort,created_at)
  VALUES ('st_x','sala','kitchen','Bep',1,0,datetime('now'))`).run();
db.prepare(`INSERT INTO users (id,branch_id,username,name,pin,role,active,branch_access_json)
  VALUES ('u_mgr','sala','mgr','Manager',?, 'manager',1,'["sala"]')`).run(hashPin('7777'));

const routes = {};
const cap = (m) => (p, ...h) => { routes[`${m} ${p}`] = h[h.length - 1]; };
const api = { get: cap('GET'), post: cap('POST'), put() {}, delete: cap('DELETE'), use() {}, patch() {}, all() {} };
registerCatalogRoutes(api, {
  wrap: (fn) => fn,
  guard: () => (_q, _s, n) => n && n(),
  branch: (req) => req.__branch || BR,
  visibleBranch: (req) => req.__branch || BR,
  actor: (req) => req.user?.username || 'system',
  saveBase64Image: () => null,
  MENU_UPLOADS_DIR: '/tmp',
});

function call(key, { params = {}, body = {}, user = { id: 'u_mgr', username: 'mgr', name: 'Manager', role: 'manager' }, branch = BR } = {}) {
  const h = routes[key];
  if (!h) throw new Error(`route không tồn tại: ${key}`);
  return h({ params, body, user, __branch: branch, headers: {}, get: () => null });
}

test('tao mon: code/sort/updated_at duoc luu, available_dine_in/takeaway mac dinh BAT', async () => {
  const created = await call('POST /menu', {
    body: { name: 'Pho bo', category_id: 'cat_x', price: 50000, code: '0200999', security_pin: '7777' },
  });
  assert.equal(created.code, '0200999');
  assert.equal(created.available_dine_in, true);
  assert.equal(created.available_takeaway, true);
  assert.ok(created.updated_at, 'phai co updated_at ngay khi tao');
  assert.equal(typeof created.sort, 'number');
});

test('sua mon: doi ma mon + thu tu qua /menu/:id/update', async () => {
  const created = await call('POST /menu', {
    body: { name: 'Bun cha', category_id: 'cat_x', price: 40000, security_pin: '7777' },
  });
  const updated = await call('POST /menu/:id/update', {
    params: { id: created.id },
    body: { code: 'BC01', sort: 42, security_pin: '7777' },
  });
  assert.equal(updated.code, 'BC01');
  assert.equal(updated.sort, 42);
});

test('/menu/:id/channels: doi tung co doc lap, KHONG can PIN, khong dung cai con lai', async () => {
  const created = await call('POST /menu', {
    body: { name: 'Goi cuon', category_id: 'cat_x', price: 30000, security_pin: '7777' },
  });
  const r1 = await call('POST /menu/:id/channels', {
    params: { id: created.id },
    body: { available_dine_in: false },
  });
  assert.equal(r1.available_dine_in, false);
  assert.equal(r1.available_takeaway, true, 'khong dong gui thi giu nguyen');

  const r2 = await call('POST /menu/:id/channels', {
    params: { id: created.id },
    body: { available_takeaway: false },
  });
  assert.equal(r2.available_dine_in, false, 'lan goi truoc da tat, phai giu nguyen');
  assert.equal(r2.available_takeaway, false);
});

test('/menu/:id/sort: doi thu tu doc lap, KHONG can PIN', async () => {
  const created = await call('POST /menu', {
    body: { name: 'Che thai', category_id: 'cat_x', price: 20000, security_pin: '7777' },
  });
  const r = await call('POST /menu/:id/sort', { params: { id: created.id }, body: { sort: 7 } });
  assert.equal(r.sort, 7);
  const row = db.prepare(`SELECT sort FROM menu_items WHERE id=?`).get(created.id);
  assert.equal(row.sort, 7);
});
