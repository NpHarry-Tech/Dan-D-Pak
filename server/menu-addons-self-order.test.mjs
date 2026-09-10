// "Món ăn kèm & Extra" (addons_json) giờ hiện ra Tablet Self-Order và khách chọn
// được — trước đây addons chỉ lưu ở server, KHÔNG được đưa vào menu_items.modifiers
// nên resolveOrderMods (fail-closed, khớp group+name) sẽ từ chối bất kỳ đơn nào
// chọn addon: "Tuỳ chọn không có trong thực đơn". Test này khoá lại: addon đã
// chọn phải qua được cổng validate và tính đúng giá, đồng thời addon KHÔNG tồn
// tại vẫn phải bị từ chối như cũ (không mở khoá cho mod tuỳ tiện nào khác).
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

process.env.SQLITE_PATH = join(mkdtempSync(join(tmpdir(), 'ddp-addons-')), 'store.db');
process.env.STORAGE_PATH = join(tmpdir(), 'addons-store');

const { db, migrate } = await import('./db.js');
const Orders = await import('./services/orders.js');
const Catalog = await import('./services/catalog.js');
migrate();

function tableId() {
  return db.prepare(`SELECT id FROM tables WHERE branch_id='sala' LIMIT 1`).get()?.id;
}

db.prepare(`INSERT INTO categories (id,branch_id,name) VALUES ('cat_ad','sala','Test')`).run();
db.prepare(`INSERT INTO shifts (id,branch_id,user_name,status,opened_at) VALUES ('sh_ad','sala','Cashier','open',?)`)
  .run(new Date().toISOString());

const addons = [
  { key: 'ad1', name: 'Salad', kind: 'extra', type: 'paid', price: 15000 },
  { key: 'ad2', name: 'Nước chấm', kind: 'extra', type: 'free', price: 0 },
];
db.prepare(`INSERT INTO menu_items (id,branch_id,category_id,name,price,addons_json) VALUES (?,?,?,?,?,?)`)
  .run('mi_addon', 'sala', 'cat_ad', 'Hu tieu xao', 150000, JSON.stringify(addons));

test('addons duoc flatten vao modifiers voi group ky thuat co dinh', () => {
  const item = Catalog.getMenuItem('mi_addon', {}, 'sala');
  const flat = item.modifiers.filter(m => m.group === '__addon__');
  assert.equal(flat.length, 2);
  const salad = flat.find(m => m.name === 'Salad');
  assert.equal(salad.price, 15000, 'addon co phi giu dung gia');
  const free = flat.find(m => m.name === 'Nước chấm');
  assert.equal(free.price, 0, 'addon mien phi luon la 0d du addons_json co gia');
});

test('dat mon co chon addon co phi -> qua duoc validate + tinh dung tien', () => {
  const full = Orders.createOrUpdateOrder({
    branch_id: 'sala', table_id: tableId(), source: 'staff_pos',
    items: [{ menu_item_id: 'mi_addon', qty: 1, mods: [{ group: '__addon__', name: 'Salad' }] }],
  });
  const it = db.prepare(`SELECT * FROM order_items WHERE order_id=? AND menu_item_id='mi_addon'`).get(full.id);
  assert.ok(it, 'phai tao duoc order_item');
  assert.equal(it.unit_price, 165000, 'gia mon (150k) + addon Salad (15k) phai cong dung vao unit_price');
  const mods = JSON.parse(it.mods_json || '[]');
  assert.deepEqual(mods, [{ group: '__addon__', name: 'Salad', price: 15000 }]);
});

test('addon KHONG co trong thuc don van bi tu choi (khong mo khoa validate)', () => {
  assert.throws(() => {
    Orders.createOrUpdateOrder({
      branch_id: 'sala', table_id: tableId(), source: 'staff_pos',
      items: [{ menu_item_id: 'mi_addon', qty: 1, mods: [{ group: '__addon__', name: 'Mon khong ton tai' }] }],
    });
  }, /không có trong thực đơn/);
});
