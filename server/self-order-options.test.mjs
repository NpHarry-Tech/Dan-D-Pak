// NHÓM TÙY CHỌN (option_groups) + ẨN RIÊNG SELF-ORDER (self_order_hidden).
// - option_groups phục vụ Self-Order render + được FLATTEN thành modifiers để đặt
//   món validate + tính giá tự động (không sửa logic đặt món).
// - self_order_hidden ẩn món khỏi Self-Order nhưng GIỮ ở F&B POS.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

process.env.SQLITE_PATH = join(mkdtempSync(join(tmpdir(), 'ddp-soopt-')), 'store.db');
process.env.STORAGE_PATH = join(tmpdir(), 'soopt-store');

const { db, migrate } = await import('./db.js');
const Catalog = await import('./services/catalog.js');
const Orders = await import('./services/orders.js');
migrate();

db.prepare(`INSERT INTO categories (id,branch_id,name) VALUES ('c1','sala','Nuoc')`).run();
db.prepare(`INSERT INTO shifts (id,branch_id,user_name,status,opened_at) VALUES ('sh','sala','Cashier','open',?)`)
  .run(new Date().toISOString());
const tableId = db.prepare(`SELECT id FROM tables WHERE branch_id='sala' LIMIT 1`).get().id;

// Món có 2 nhóm: Size (chọn 1) + Topping (chọn nhiều, 1 option free 1 option phi).
const groups = [
  { key: 'size', name: 'Size', position: 'top', min: 1, max: 1,
    options: [{ key: 'n', name: 'Nho', type: 'free', price: 0 },
              { key: 'l', name: 'Lon', type: 'paid', price: 5000 }] },
  { key: 'top', name: 'Topping', position: 'bottom', min: 0, max: 3,
    options: [{ key: 'tc', name: 'Tran chau', type: 'paid', price: 7000 },
              { key: 'kd', name: 'Khong da', type: 'free', price: 0 }] },
];
db.prepare(`INSERT INTO menu_items (id,branch_id,category_id,name,price,vat_rate,price_includes_vat,option_groups_json)
  VALUES ('mi','sala','c1','Tra sua',30000,0,1,?)`).run(JSON.stringify(groups));

test('normalizeMenuItem: option_groups phuc vu UI + FLATTEN thanh modifiers', () => {
  const mi = Catalog.getMenuItem('mi', {}, 'sala');
  assert.equal(mi.option_groups.length, 2);
  assert.equal(mi.option_groups[0].name, 'Size');
  assert.equal(mi.option_groups[0].position, 'top');
  // Flatten: modifiers co du option (group=ten nhom) de resolveOrderMods validate.
  const lon = mi.modifiers.find(m => m.group === 'Size' && m.name === 'Lon');
  assert.ok(lon, 'phai flatten option "Lon"');
  assert.equal(lon.sale_price, 5000);
  const free = mi.modifiers.find(m => m.name === 'Nho');
  assert.equal(free.sale_price, 0);
});

test('dat mon voi option da chon: gia option cong vao don gia', () => {
  const full = Orders.createOrUpdateOrder({
    branch_id: 'sala', table_id: tableId, source: 'staff_pos',
    items: [{ menu_item_id: 'mi', qty: 1,
      mods: [{ group: 'Size', name: 'Lon' }, { group: 'Topping', name: 'Tran chau' }] }],
  });
  const it = db.prepare(`SELECT * FROM order_items WHERE order_id=? AND menu_item_id='mi'`).get(full.id);
  // 30000 + 5000 (Lon) + 7000 (Tran chau) = 42000.
  assert.equal(it.unit_price, 42000);
});

test('dat mon voi option KHONG co trong thuc don -> bi tu choi', () => {
  assert.throws(() => Orders.createOrUpdateOrder({
    branch_id: 'sala', table_id: tableId, source: 'staff_pos',
    items: [{ menu_item_id: 'mi', qty: 1, mods: [{ group: 'Size', name: 'Sieu To' }] }],
  }), /không có trong thực đơn/);
});

test('self_order_hidden: an khoi Self-Order, GIU o F&B POS', () => {
  db.prepare(`INSERT INTO menu_items (id,branch_id,category_id,name,price,self_order_hidden)
    VALUES ('mihid','sala','c1','Mon noi bo',10000,1)`).run();
  const so = Catalog.listMenu({ branch_id: 'sala', forCustomer: true, selfOrder: true });
  const pos = Catalog.listMenu({ branch_id: 'sala', forCustomer: true });
  assert.ok(!so.items.some(i => i.id === 'mihid'), 'Self-Order phai AN mon noi bo');
  assert.ok(pos.items.some(i => i.id === 'mihid'), 'F&B POS phai GIU mon noi bo');
});
