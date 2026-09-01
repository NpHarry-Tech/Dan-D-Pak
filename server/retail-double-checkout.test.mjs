// Chống THANH TOÁN TRÙNG khi hai máy cùng mở một hóa đơn bán lẻ (giỏ chia sẻ).
// Máy thứ nhất chốt xong sẽ TIÊU THỤ giỏ (slot) trong cùng transaction; máy thứ
// hai gửi lại (slot, version) cũ → server chặn 409, KHÔNG tạo đơn thứ hai.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-dblchk-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');

const { db, migrate, now } = await import('./db.js');
const Inventory = await import('./services/inventory.js');
const Retail = await import('./services/retail.js');
const RetailCart = await import('./services/retailCart.js');

migrate();
db.prepare(`INSERT OR IGNORE INTO categories (id,branch_id,name) VALUES ('cat_dbl','sala','Test')`).run();
// Bán lẻ cần một ca đang mở.
db.prepare(`INSERT INTO shifts (id,branch_id,user_name,shift_key,shift_label,opening_cash,status,opened_at) VALUES (?,?,?,?,?,?,?,?)`)
  .run('shift_dbl', 'sala', 'Tester', 'dbl', 'Double', 0, 'open', now());

test('hai may cung thanh toan mot gio chia se: may thu hai bi chan 409, khong tao don trung', () => {
  Inventory.createSku({
    id: 'sku_dbl', name: 'Nuoc suoi', barcode: '111-dbl',
    category: 'Do uong', price: 10000, stock: 100,
  }, 'sala');

  // Cả hai máy cùng thấy giỏ ở slot 5 (đồng bộ qua server) — cùng version.
  const saved = RetailCart.saveCart('sala', 5, {
    lines: [{ sku: { id: 'sku_dbl' }, qty: 1 }],
  }, { actor: 'mayA', device: 'devA' });
  const version = saved.version;

  const items = [{ sku_id: 'sku_dbl', qty: 1 }];

  // MÁY A chốt trước — thành công, tiêu thụ giỏ slot 5.
  const r1 = Retail.checkout({
    items, payments: [{ method: 'cash', amount: 10000 }],
    branch_id: 'sala', cashier: 'mayA', client_request_id: 'reqA',
    cart_slot: 5, cart_version: version,
  });
  assert.ok(r1.total >= 0, 'may A thanh toan duoc');
  // Giỏ slot 5 đã bị tiêu thụ.
  const cartAfter = RetailCart.getCart('sala', 5);
  assert.deepEqual(cartAfter.lines ?? [], [], 'gio slot 5 da bi tieu thu sau khi chot');

  // MÁY B chốt SAU với đúng (slot, version) cũ → phải bị chặn 409.
  assert.throws(
    () => Retail.checkout({
      items, payments: [{ method: 'cash', amount: 10000 }],
      branch_id: 'sala', cashier: 'mayB', client_request_id: 'reqB',
      cart_slot: 5, cart_version: version,
    }),
    (err) => err.status === 409 && err.code === 'CART_ALREADY_CHECKED_OUT',
    'may B phai bi chan CART_ALREADY_CHECKED_OUT',
  );

  // Chỉ CÓ MỘT đơn được tạo cho sku nay (khong double).
  const cnt = db.prepare(`SELECT COUNT(*) n FROM orders WHERE branch_id='sala' AND status='paid'`).get().n;
  assert.equal(cnt, 1, 'chi mot don duoc tao, khong bi trung');
});

test('checkout KHONG kem cart_slot van chay binh thuong (tuong thich nguoc)', () => {
  Inventory.createSku({
    id: 'sku_dbl2', name: 'Tra', barcode: '222-dbl',
    category: 'Do uong', price: 15000, stock: 50,
  }, 'sala');
  const r = Retail.checkout({
    items: [{ sku_id: 'sku_dbl2', qty: 2 }],
    payments: [{ method: 'cash', amount: 30000 }],
    branch_id: 'sala', cashier: 'mayA', client_request_id: 'reqNoSlot',
  });
  assert.ok(r.total >= 0, 'checkout khong slot van thanh cong');
});
