// Thao tác kho phải TRỌN GÓI.
//
// Chuyển kho / kiểm kho / xuất nhiều dòng đụng tới nhiều bảng: tồn theo lô,
// phiếu kho, dòng phiếu, nhật ký chuyển động. Trước đây inventory.js KHÔNG có
// một giao dịch nào — lỗi giữa chừng để lại phiếu áp nửa vời: hàng đã rời kho
// nguồn mà chưa vào kho đích. Kiểm tra trước khi ghi (code cũ vẫn làm) không
// cứu được vì lỗi có thể xảy ra TRONG lúc ghi.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-invtx-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = process.env.DATA_ENCRYPTION_KEY
  || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const { db, migrate, inTransaction } = await import('./db.js');
const Inv = await import('./services/inventory.js');

migrate();

function warehouse(id, name) {
  db.prepare(`INSERT OR IGNORE INTO warehouses (id,branch_id,name,code,type,active,sort)
    VALUES (?,?,?,?,?,1,0)`).run(id, 'br1', name, id.toUpperCase(), 'retail');
}
warehouse('wh_a', 'Kho A');
warehouse('wh_b', 'Kho B');

function tonKho(itemId, wh) {
  return db.prepare(
    `SELECT COALESCE(SUM(qty_on_hand),0) s FROM stock_lots
      WHERE warehouse_id=? AND item_type='sku' AND item_id=?`).get(wh, itemId).s;
}

test('helper giao dịch: lỗi thì hoàn tác sạch', () => {
  Inv.createSku({ id: 'sku_tx', name: 'Hang TX', price: 1000, stock: 0 }, 'br1');
  const truoc = db.prepare(`SELECT COUNT(*) n FROM skus`).get().n;

  assert.throws(() => inTransaction(() => {
    db.prepare(`INSERT INTO skus (id,branch_id,name,price,stock,active)
      VALUES ('sku_hong','br1','Hong',1,0,1)`).run();
    throw new Error('hong giua chung');
  }), /hong giua chung/);

  assert.equal(db.prepare(`SELECT COUNT(*) n FROM skus`).get().n, truoc,
    'dòng vừa chèn phải bị hoàn tác');
});

test('helper giao dịch gọi LỒNG nhau không làm vỡ giao dịch cha', () => {
  // Bán hàng mở giao dịch ở lớp ngoài rồi mới gọi xuống tầng kho. SQLite không
  // cho mở giao dịch trong giao dịch, nên helper phải nhận ra và chạy tiếp.
  const r = inTransaction(() => inTransaction(() => inTransaction(() => 42)));
  assert.equal(r, 42);

  // Và lớp NGOÀI vẫn là nơi quyết định hoàn tác.
  const truoc = db.prepare(`SELECT COUNT(*) n FROM skus`).get().n;
  assert.throws(() => inTransaction(() => {
    inTransaction(() => {
      db.prepare(`INSERT INTO skus (id,branch_id,name,price,stock,active)
        VALUES ('sku_long','br1','Long',1,0,1)`).run();
    });
    throw new Error('lop ngoai hong');
  }), /lop ngoai hong/);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM skus`).get().n, truoc,
    'lớp trong đã ghi nhưng lớp ngoài hỏng → phải hoàn tác hết');
});

test('chuyển kho hỏng giữa chừng KHÔNG để hàng bốc hơi', () => {
  Inv.createSku({ id: 'sku_ck', name: 'Hang CK', price: 1000, stock: 0, warehouse_id: 'wh_a' }, 'br1');
  Inv.receiveSku('sku_ck', 10, 'br1', { warehouse_id: 'wh_a', lot_no: 'L1' });
  assert.equal(tonKho('sku_ck', 'wh_a'), 10);

  // Dòng thứ hai trỏ mặt hàng không tồn tại → cả phiếu phải bị từ chối.
  assert.throws(() => Inv.transferStock({
    from_warehouse_id: 'wh_a',
    to_warehouse_id: 'wh_b',
    lines: [
      { item_type: 'sku', item_id: 'sku_ck', qty: 4 },
      { item_type: 'sku', item_id: 'sku_khong_co', qty: 1 },
    ],
  }, 'br1'));

  assert.equal(tonKho('sku_ck', 'wh_a'), 10, 'kho nguồn phải nguyên vẹn');
  assert.equal(tonKho('sku_ck', 'wh_b'), 0, 'kho đích không được nhận gì');
});

test('chuyển kho hợp lệ vẫn chạy đúng: nguồn giảm, đích tăng, tổng không đổi', () => {
  Inv.transferStock({
    from_warehouse_id: 'wh_a',
    to_warehouse_id: 'wh_b',
    lines: [{ item_type: 'sku', item_id: 'sku_ck', qty: 4 }],
  }, 'br1');

  assert.equal(tonKho('sku_ck', 'wh_a'), 6);
  assert.equal(tonKho('sku_ck', 'wh_b'), 4);
  assert.equal(tonKho('sku_ck', 'wh_a') + tonKho('sku_ck', 'wh_b'), 10,
    'chuyển kho không được sinh ra hay làm mất hàng');
});

test('không cho chuyển nhiều hơn tồn thực tế ở kho nguồn', () => {
  assert.throws(() => Inv.transferStock({
    from_warehouse_id: 'wh_a',
    to_warehouse_id: 'wh_b',
    lines: [{ item_type: 'sku', item_id: 'sku_ck', qty: 999 }],
  }, 'br1'), /Không đủ tồn/);
  assert.equal(tonKho('sku_ck', 'wh_a'), 6, 'tồn giữ nguyên sau khi bị từ chối');
});
