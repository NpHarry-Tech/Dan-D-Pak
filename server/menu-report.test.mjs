import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-menu-report-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY ||= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const { db, migrate, now } = await import('./db.js');
const Reports = await import('./services/reportCenter.js');
migrate();
const at = now();
db.prepare(`INSERT INTO branches (id,name,code,active,sort) VALUES ('menu_test','Menu','MENU',1,0)`).run();
db.prepare(`INSERT INTO categories (id,branch_id,name,sort) VALUES ('cat_food','menu_test','Món chính',0)`).run();
db.prepare(`INSERT INTO menu_items (id,branch_id,category_id,name,price) VALUES
  ('dish_sold','menu_test','cat_food','Cơm gà',50000),
  ('dish_idle','menu_test','cat_food','Phở',60000)`).run();
db.prepare(`INSERT INTO orders (id,branch_id,status,total,created_at,paid_at) VALUES
  ('order_menu','menu_test','paid',100000,?,?)`).run(at, at);
db.prepare(`INSERT INTO order_items (id,order_id,menu_item_id,name,qty,unit_price,created_at) VALUES
  ('line_menu','order_menu','dish_sold','Cơm gà',2,50000,?)`).run(at);

test('menu report reuses catalog filters and reports sold plus unsold dishes', () => {
  assert.ok(Reports.catalog('menu_test').reports.some(r => r.key === 'menu'));
  const report = Reports.buildReport('menu', 'menu_test', { period: 'year' });
  const summary = Object.fromEntries(report.summary.map(row => [row.label, row.raw]));
  assert.deepEqual(summary, {
    'Số món trong thực đơn': 2,
    'Món có bán': 1,
    'Số lượng bán thuần': 2,
    'Doanh thu thuần': 100000,
  });
  const performance = report.sections.find(s => s.title === 'Hiệu quả theo món');
  assert.equal(performance.rows.find(r => r.name === 'Cơm gà').bills_count, 1);
  assert.equal(report.sections.find(s => s.title === 'Món chưa phát sinh bán').rows[0].name, 'Phở');
});
