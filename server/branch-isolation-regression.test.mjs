import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-branch-isolation-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const { db, migrate, bootstrapWarehouseDefaults, bootstrapTableDefaults } = await import('./db.js');
const Branches = await import('./services/branches.js');
const Auth = await import('./services/auth.js');
const Catalog = await import('./services/catalog.js');
const Settings = await import('./services/settings.js');
const History = await import('./services/history.js');
const Print = await import('./services/printing.js');

migrate();

test('chi nhánh mới bắt đầu trống, không sinh kho/bàn/máy in ảo', () => {
  const branch = Branches.createBranch({ name: 'Chi nhánh mới', code: 'MOI' }, 'test');

  assert.equal(branch.id, 'moi');
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM warehouses WHERE branch_id=?`).get(branch.id).n, 0);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM tables WHERE branch_id=?`).get(branch.id).n, 0);
  assert.deepEqual(Settings.getPrintConfig(branch.id).printers, []);
  assert.deepEqual(Catalog.listMenu({ branch_id: branch.id }).items, []);
});

test('menu và danh mục chỉ xuất hiện trong đúng chi nhánh', () => {
  const branch = Branches.getBranch('moi');
  const rootCategory = Catalog.createCategory({ name: 'Món Sala' }, 'sala');
  const newCategory = Catalog.createCategory({ name: 'Món chi nhánh mới' }, branch.id);

  db.prepare(`INSERT INTO menu_items (id,branch_id,category_id,name,price) VALUES (?,?,?,?,?)`)
    .run('menu_sala', 'sala', rootCategory.id, 'Món Sala', 10000);
  db.prepare(`INSERT INTO menu_items (id,branch_id,category_id,name,price) VALUES (?,?,?,?,?)`)
    .run('menu_moi', branch.id, newCategory.id, 'Món mới', 20000);
  Catalog.cacheBust('menu:');

  assert.deepEqual(Catalog.listMenu({ branch_id: 'sala' }).items.map(x => x.id), ['menu_sala']);
  assert.deepEqual(Catalog.listMenu({ branch_id: branch.id }).items.map(x => x.id), ['menu_moi']);
  assert.deepEqual(Catalog.listCategories('sala').map(x => x.id), [rootCategory.id]);
  assert.deepEqual(Catalog.listCategories(branch.id).map(x => x.id), [newCategory.id]);
  assert.equal(Catalog.getMenuItem('menu_sala', {}, branch.id), null);
});

test('ghi chú đơn đi xuyên suốt tới nội dung bill, ngay trước lời cảm ơn', () => {
  db.prepare(`INSERT INTO orders
    (id,branch_id,channel,status,subtotal,discount,goods_amount,vat_amount,total,created_at,paid_at,note)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run('order_note', 'moi', 'retail', 'paid', 20000, 0, 20000, 0, 20000,
      new Date().toISOString(), new Date().toISOString(), 'Giao trước 18 giờ');

  const receipt = History.orderReceipt('order_note', 'moi');
  assert.equal(receipt.note, 'Giao trước 18 giờ');
  const text = Print.renderJobText({ type: 'receipt', branch_id: 'moi', payload: receipt }, 'moi');
  assert.match(text, /Ghi chú: Giao trước 18 giờ/);
  assert.ok(text.toLowerCase().indexOf('ghi chú:') < text.toLowerCase().indexOf('cảm ơn'));
});

test('query routing từ chối chi nhánh sai thay vì âm thầm rơi về sala', () => {
  assert.throws(() => Auth.publicBranch({ headers: { 'x-branch-id': 'khong-ton-tai' } }), /không tồn tại/);
  assert.throws(() => Auth.resolveBranch({
    headers: { 'x-branch-id': 'moi' },
    user: { id: 'cashier', role: 'cashier', branch_id: 'sala', branch_access_json: '[]' },
  }), /không có quyền/);
});

test('liên kết và secret không fallback sang chi nhánh khác', () => {
  Settings.updateIntegrations({
    channels: {
      sepay: { enabled: true, apiKey: 'sala-secret', accountNumber: '6084' },
      haravan: { enabled: true, accessToken: 'sala-haravan' },
    },
  }, 'sala');

  assert.equal(Settings.getIntegrations('sala').channels.sepay.enabled, true);
  assert.equal(Settings.getIntegrations('moi').channels.sepay.enabled, false);
  assert.equal(Settings.getIntegrationChannel('haravan', 'moi').enabled, false);
  assert.equal(Settings.getIntegrationChannel('haravan', 'moi').accessToken, '');
});

test('migration dọn dữ liệu mẫu cũ của chi nhánh phụ nếu chưa từng được sử dụng', () => {
  db.prepare(`INSERT INTO branches (id,name,code,active) VALUES ('br_legacy','Legacy','LEG',1)`).run();
  bootstrapWarehouseDefaults('br_legacy');
  bootstrapTableDefaults('br_legacy');
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM warehouses WHERE branch_id='br_legacy'`).get().n, 3);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM tables WHERE branch_id='br_legacy'`).get().n, 23);

  migrate();
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM warehouses WHERE branch_id='br_legacy'`).get().n, 0);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM tables WHERE branch_id='br_legacy'`).get().n, 0);
});
