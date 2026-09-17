import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

process.env.SQLITE_PATH = join(mkdtempSync(join(tmpdir(), 'ddp-byod-')), 'store.db');
process.env.STORAGE_PATH = join(tmpdir(), 'byod-store');
process.env.BYOD_TOKEN_SECRET = 'test-only-byod-secret-with-at-least-32-chars';

const { db, migrate } = await import('./db.js');
const Orders = await import('./services/orders.js');
const Byod = await import('./services/byod.js');
const Catalog = await import('./services/catalog.js');
migrate();

db.prepare(`INSERT INTO categories(id,branch_id,name) VALUES('byod_cat','sala','Món chính')`).run();
db.prepare(`INSERT INTO shifts(id,branch_id,user_name,status,opened_at) VALUES('byod_shift','sala','Test','open',?)`).run(new Date().toISOString());
db.prepare(`INSERT INTO menu_items(id,branch_id,category_id,name,price,vat_rate,price_includes_vat,option_groups_json,addons_json)
  VALUES('byod_food','sala','byod_cat','Cơm gà',100000,8,1,?,?)`).run(JSON.stringify([
    { name: 'Size', min: 1, max: 1, options: [{ name: 'Thường', price: 0 }, { name: 'Lớn', price: 20000 }] },
  ]), JSON.stringify([{ name: 'Salad', price: 15000, available: true }]));
db.prepare(`INSERT INTO menu_items(id,branch_id,category_id,name,price,self_order_hidden)
  VALUES('byod_hidden','sala','byod_cat','Món nhân viên',1,1)`).run();
// Thành phần combo "(CB) ..." — self_order_hidden=1 vì KHÔNG được đặt riêng lẻ,
// nhưng PHẢI vẫn chọn được như một lựa chọn combo của món khác (byod_combo).
db.prepare(`INSERT INTO menu_items(id,branch_id,category_id,name,price,self_order_hidden,translations_json)
  VALUES('byod_combo_part','sala','byod_cat','(CB) Salad kèm',0,1,?)`).run(JSON.stringify({ en: { name: 'Side Salad' } }));
db.prepare(`INSERT INTO menu_items(id,branch_id,category_id,name,price,option_groups_json)
  VALUES('byod_combo','sala','byod_cat','Combo trưa',150000,?)`).run(JSON.stringify([
    { name: 'Khai vị', mode: 'combo', min: 0, max: 1, options: [{ ref_item_id: 'byod_combo_part', price: 0 }] },
  ]));

const table = Orders.createTable({ branch_id: 'sala', zone: 'Tầng trệt', code: 'BY01', seats: 4 });
const deviceA = 'device_A_12345678901234567890';
const deviceB = 'device_B_12345678901234567890';
let qr = Byod.getTableQr(table.id, 'sala');

test('tạo bàn tự sinh QR opaque; đổi tên không làm QR cũ mất hiệu lực', () => {
  assert.match(qr.url, /^https:\/\/dandpakpos\.io\.vn\/BYOD\/[A-Za-z0-9_-]+$/);
  assert.equal(Byod.resolveQr(qr.token).table_code, 'BY01');
  Orders.updateTable(table.id, { code: 'BY01-MOI' }, 'sala');
  assert.equal(Byod.resolveQr(qr.token).table_code, 'BY01-MOI');
});

test('API bootstrap lọc món nội bộ và không trả giá vốn/cấu hình bếp', () => {
  const view = Byod.bootstrap(qr.token, deviceA, 'iPhone', 'vi');
  assert.ok(view.menu.some(i => i.id === 'byod_food'));
  assert.ok(!view.menu.some(i => i.id === 'byod_hidden'));
  assert.ok(view.menu.every(i => !('cost' in i) && !('station' in i)));
});

test('món hết hàng/chưa tới giờ bán ẩn HẲN khỏi menu BYOD (như Tablet Self Order), không hiện mờ "hết món"', () => {
  db.prepare(`UPDATE menu_items SET available=0 WHERE id='byod_food'`).run();
  Catalog.cacheBust('menu:');
  const view = Byod.bootstrap(qr.token, deviceA, 'iPhone', 'vi');
  assert.ok(!view.menu.some(i => i.id === 'byod_food'));
  db.prepare(`UPDATE menu_items SET available=1 WHERE id='byod_food'`).run();
  Catalog.cacheBust('menu:');
  assert.ok(Byod.bootstrap(qr.token, deviceA, 'iPhone', 'vi').menu.some(i => i.id === 'byod_food'));
});

test('bootstrap trả tên category thật (không chỉ category_id) và không lộ field nội bộ', () => {
  const view = Byod.bootstrap(qr.token, deviceA, 'iPhone', 'vi');
  assert.ok(Array.isArray(view.categories));
  const cat = view.categories.find(c => c.id === 'byod_cat');
  assert.equal(cat?.name, 'Món chính');
  assert.ok(view.categories.every(c => Object.keys(c).sort().join(',') === 'id,name'));
});

test('option combo trỏ tới món self_order_hidden VẪN chọn được (chỉ ẩn đặt riêng lẻ, không ẩn khỏi combo)', () => {
  const view = Byod.bootstrap(qr.token, deviceA, 'iPhone', 'vi');
  assert.ok(!view.menu.some(i => i.id === 'byod_combo_part'), 'thành phần combo không được hiện như món riêng');
  const combo = view.menu.find(i => i.id === 'byod_combo');
  const group = combo.option_groups.find(g => g.mode === 'combo');
  assert.equal(group.options.length, 1, 'option combo trỏ tới món self_order_hidden phải còn trong danh sách chọn');
  assert.equal(group.options[0].ref_item_id, 'byod_combo_part');
});

test('tên option combo trỏ tới món có translations_json phải đổi theo lang khách chọn (không kẹt tiếng Việt)', () => {
  const viView = Byod.bootstrap(qr.token, deviceA, 'iPhone', 'vi');
  const viOption = viView.menu.find(i => i.id === 'byod_combo').option_groups[0].options[0];
  assert.equal(viOption.name, '(CB) Salad kèm', 'vi vẫn giữ tên gốc admin gõ');

  const enView = Byod.bootstrap(qr.token, deviceA, 'iPhone', 'en');
  const enOption = enView.menu.find(i => i.id === 'byod_combo').option_groups[0].options[0];
  assert.equal(enOption.name, 'Side Salad', 'en phải lấy bản dịch của món được trỏ tới, không phải tên tiếng Việt admin gõ');
});

test('hai thiết bị có giỏ riêng/chung; không sửa được giỏ thiết bị khác; note chống HTML', () => {
  let cart = Byod.addCartItem(qr.token, deviceA, {
    menu_item_id: 'byod_food', qty: 1, note: '<script>alert(1)</script> ít cay',
    mods: [{ group: 'Size', name: 'Lớn' }, { group: '__addon__', name: 'Salad' }],
  }, 'iPhone');
  const itemA = cart.mine[0];
  assert.equal(itemA.note, 'alert(1) ít cay');
  assert.equal(itemA.unit_price, 135000);
  Byod.addCartItem(qr.token, deviceB, { menu_item_id: 'byod_food', qty: 2,
    mods: [{ group: 'Size', name: 'Thường' }] }, 'Android');
  cart = Byod.bootstrap(qr.token, deviceA, 'iPhone').cart;
  assert.equal(cart.mine.length, 1);
  assert.equal(cart.table.length, 2);
  assert.throws(() => Byod.updateCartItem(qr.token, deviceB, itemA.id, { qty: 9 }), /thiết bị khác/i);
});

test('submit giỏ chung dùng đúng order chuẩn, giá server và idempotent', () => {
  const key = 'submit-key-123456789012345';
  const first = Byod.submitCart(qr.token, deviceA, key, { scope: 'table', confirm_table_cart: true }, 'iPhone');
  assert.equal(first.duplicate, false);
  assert.equal(first.order.items.filter(i => i.menu_item_id === 'byod_food').length, 2);
  assert.ok(first.order.items.every(i => i.status === 'pending_confirm'));
  const count = db.prepare(`SELECT COUNT(*) n FROM order_items WHERE order_id=?`).get(first.order.id).n;
  const retry = Byod.submitCart(qr.token, deviceA, key, { scope: 'table', confirm_table_cart: true }, 'iPhone');
  assert.equal(retry.duplicate, true);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM order_items WHERE order_id=?`).get(first.order.id).n, count);
  assert.equal(Byod.bootstrap(qr.token, deviceA).cart.table.length, 0);
});

test('món hết trong lúc chọn bị giữ lại trong draft, không báo gửi thành công', () => {
  Byod.addCartItem(qr.token, deviceA, { menu_item_id: 'byod_food', qty: 1,
    mods: [{ group: 'Size', name: 'Thường' }] });
  db.prepare(`UPDATE menu_items SET available=0 WHERE id='byod_food'`).run();
  assert.throws(() => Byod.submitCart(qr.token, deviceA, 'unavailable-key-123456789', { scope: 'mine' }), /phục vụ|hàng|tạm hết/i);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM byod_cart_items`).get().n, 1);
  db.prepare(`UPDATE menu_items SET available=1 WHERE id='byod_food'`).run();
});

test('gọi nhân viên từ BYOD dùng ĐÚNG bảng/sự kiện của Tablet Self Order, có cooldown chống spam', () => {
  const before = db.prepare(`SELECT COUNT(*) n FROM staff_calls WHERE table_id=?`).get(table.id).n;
  const first = Byod.callStaff(qr.token, deviceA, 'iPhone');
  assert.equal(first.already, false);
  const afterFirst = db.prepare(`SELECT * FROM staff_calls WHERE table_id=? ORDER BY created_at DESC LIMIT 1`).get(table.id);
  assert.equal(afterFirst.status, 'open');
  assert.match(afterFirst.reason, /điện thoại khách/);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM staff_calls WHERE table_id=?`).get(table.id).n, before + 1);
  // Bấm liên tục trong cooldown không được tạo thêm dòng mới (staff không bị dội chuông trùng).
  const second = Byod.callStaff(qr.token, deviceA, 'iPhone');
  assert.equal(second.already, true);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM staff_calls WHERE table_id=?`).get(table.id).n, before + 1);
  db.prepare(`UPDATE staff_calls SET status='done' WHERE table_id=?`).run(table.id);
});

test('bàn bỏ hoang quá lâu: thiết bị cũ bị buộc quét lại QR, thiết bị MỚI vẫn vào bình thường', () => {
  const idleTable = Orders.createTable({ branch_id: 'sala', zone: 'Tầng trệt', code: 'BY02', seats: 4 });
  const idleQr = Byod.getTableQr(idleTable.id, 'sala');
  const deviceOld = 'device_old_1234567890123456789';
  const deviceNew = 'device_new_1234567890123456789';

  Byod.bootstrap(idleQr.token, deviceOld, 'iPhone'); // tạo phiên + thiết bị "cũ"
  const session = db.prepare(`SELECT * FROM byod_sessions WHERE table_id=? AND status='active'`).get(idleTable.id);
  // Giả lập bàn đã bỏ hoang > SESSION_IDLE_TIMEOUT_MINUTES (không ai thao tác).
  db.prepare(`UPDATE byod_sessions SET last_active_at=datetime('now','-4 hours') WHERE id=?`).run(session.id);

  // Thiết bị CŨ quay lại → phải bị chặn, buộc quét lại QR (không được lặng lẽ tiếp tục).
  assert.throws(() => Byod.bootstrap(idleQr.token, deviceOld, 'iPhone'),
    (e) => e.code === 'BYOD_SESSION_CLOSED', 'thiết bị từng dùng bàn phải bị buộc quét lại QR khi bàn đã bỏ hoang quá lâu');

  // Thiết bị MỚI (khách mới quét QR) không hề liên quan tới phiên cũ → vào bình thường.
  const freshView = Byod.bootstrap(idleQr.token, deviceNew, 'Android');
  assert.deepEqual(freshView.cart.mine, []);

  // Phiên cũ đã đóng, không còn 'active' — quán không bị lộ dữ liệu bàn cũ cho ai.
  assert.equal(db.prepare(`SELECT status FROM byod_sessions WHERE id=?`).get(session.id).status, 'timeout');
});

test('regenerate và vô hiệu hóa thu hồi token/đóng phiên cũ', () => {
  const oldToken = qr.token;
  qr = Byod.regenerateTableQr(table.id, 'sala', 'tester');
  assert.throws(() => Byod.resolveQr(oldToken), /thu hồi/i);
  assert.equal(Byod.resolveQr(qr.token).table_id, table.id);
  Byod.setTableQrEnabled(table.id, false, 'sala', 'tester');
  assert.throws(() => Byod.resolveQr(qr.token), /thu hồi/i);
});

test('xóa bàn thu hồi QR và token giả luôn bị từ chối', () => {
  const disposable = Orders.createTable({ branch_id: 'sala', zone: 'Tầng trệt', code: 'BY-XOA' });
  const disposableQr = Byod.getTableQr(disposable.id, 'sala');
  Orders.deleteTable(disposable.id, 'sala');
  assert.throws(() => Byod.resolveQr(disposableQr.token), /thu hồi|không hợp lệ/i);
  assert.throws(() => Byod.resolveQr(`${disposableQr.token}x`), /thu hồi|không hợp lệ/i);
});
