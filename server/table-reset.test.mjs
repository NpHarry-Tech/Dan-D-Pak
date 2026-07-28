// Dọn sạch bàn — lối thoát hiểm khi bàn kẹt trạng thái sai.
//
// Điều quan trọng nhất được test ở đây KHÔNG phải "xoá được" mà là "KHÔNG xoá
// nhầm tiền": bill đã ghi nhận thanh toán phải bị từ chối, vì xoá trắng nó là
// làm mất dấu khoản tiền đã thu.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-tablereset-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = process.env.DATA_ENCRYPTION_KEY
  || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const { db, migrate, now } = await import('./db.js');
const Orders = await import('./services/orders.js');
const Payments = await import('./services/payments.js');

migrate();

db.prepare(`INSERT INTO menu_items (id,category_id,name,price,price_includes_vat,vat_rate,station) VALUES (?,?,?,?,?,?,?)`)
  .run('mi_pho', 'cat_t', 'Pho Bo', 60000, 1, 8, 'kitchen');
db.prepare(`INSERT INTO shifts (id,branch_id,user_name,shift_key,shift_label,opening_cash,status,opened_at) VALUES (?,?,?,?,?,?,?,?)`)
  .run('shift_reset', 'br1', 'Tester', 'test', 'Test', 0, 'open', now());

function makeTable(id, code) {
  db.prepare(`INSERT INTO tables (id,branch_id,zone,code,seats,status) VALUES (?,?,?,?,?,?)`)
    .run(id, 'br1', 'Tầng trệt', code, 4, 'free');
}

function orderAt(tableId) {
  return Orders.createOrUpdateOrder({
    branch_id: 'br1', channel: 'dine_in', source: 'staff_pos', table_id: tableId,
    actor: 'Thu ngan', items: [{ menu_item_id: 'mi_pho', qty: 2 }],
  });
}

test('dọn bàn: huỷ hết món, đưa bill về void, trả bàn về trống', () => {
  makeTable('t_R1', 'R1');
  const order = orderAt('t_R1');
  assert.equal(db.prepare(`SELECT status FROM tables WHERE id='t_R1'`).get().status, 'busy');

  const res = Orders.resetTable('t_R1', 'br1', 'quanly', 'ban ket trang thai');
  assert.equal(res.orders_voided, 1);
  assert.ok(res.items_cancelled >= 1);

  assert.equal(db.prepare(`SELECT status FROM tables WHERE id='t_R1'`).get().status, 'free');
  const o = db.prepare(`SELECT status,total FROM orders WHERE id=?`).get(order.id);
  assert.equal(o.status, 'void');
  assert.equal(o.total, 0);
  assert.equal(
    db.prepare(`SELECT COUNT(*) n FROM order_items WHERE order_id=? AND status!='cancelled'`).get(order.id).n,
    0, 'không còn món nào sống');
});

test('TỪ CHỐI dọn bàn khi bill đã ghi nhận tiền — tiền không được mất dấu', () => {
  makeTable('t_R2', 'R2');
  const order = orderAt('t_R2');
  Orders.confirmPendingItems(order.id, [], 'br1', 'Thu ngan');
  // Khách trả trước một phần.
  Payments.payOrder(order.id, [{ method: 'cash', amount: 20000 }], { cashier: 'Thu ngan' }, 'br1');

  assert.throws(
    () => Orders.resetTable('t_R2', 'br1', 'quanly'),
    /đã ghi nhận|Hoàn tiền/,
    'bill có tiền phải đi đường hoàn tiền, không xoá trắng');

  // Và không được đụng gì vào dữ liệu.
  assert.equal(db.prepare(`SELECT status FROM tables WHERE id='t_R2'`).get().status, 'busy');
  assert.notEqual(db.prepare(`SELECT status FROM orders WHERE id=?`).get(order.id).status, 'void');
});

test('dọn bàn trống thì không sao, và bàn không tồn tại thì báo lỗi rõ', () => {
  makeTable('t_R3', 'R3');
  const res = Orders.resetTable('t_R3', 'br1', 'quanly');
  assert.equal(res.orders_voided, 0);
  assert.throws(() => Orders.resetTable('t_khong_co', 'br1', 'quanly'), /Bàn không tồn tại/);
});

test('chuông gọi nhân viên đang treo cũng được đóng khi dọn bàn', () => {
  makeTable('t_R4', 'R4');
  orderAt('t_R4');
  db.prepare(`INSERT INTO staff_calls (id,branch_id,table_id,reason,status,created_at) VALUES (?,?,?,?,?,?)`)
    .run('sc_1', 'br1', 't_R4', 'Goi nhan vien', 'open', now());

  Orders.resetTable('t_R4', 'br1', 'quanly');
  assert.equal(
    db.prepare(`SELECT status FROM staff_calls WHERE id='sc_1'`).get().status, 'done',
    'bàn vừa dọn xong không được nhấp nháy đòi phục vụ');
});
