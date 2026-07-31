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
const Purchase = await import('./services/purchase.js');

migrate();

function warehouse(id, name) {
  db.prepare(`INSERT OR IGNORE INTO warehouses (id,branch_id,name,code,type,active,sort)
    VALUES (?,?,?,?,?,1,0)`).run(id, 'sala', name, id.toUpperCase(), 'retail');
}
warehouse('wh_a', 'Kho A');
warehouse('wh_b', 'Kho B');

function tonKho(itemId, wh) {
  return db.prepare(
    `SELECT COALESCE(SUM(qty_on_hand),0) s FROM stock_lots
      WHERE warehouse_id=? AND item_type='sku' AND item_id=?`).get(wh, itemId).s;
}

test('helper giao dịch: lỗi thì hoàn tác sạch', () => {
  Inv.createSku({ id: 'sku_tx', name: 'Hang TX', price: 1000, stock: 0 }, 'sala');
  const truoc = db.prepare(`SELECT COUNT(*) n FROM skus`).get().n;

  assert.throws(() => inTransaction(() => {
    db.prepare(`INSERT INTO skus (id,branch_id,name,price,stock,active)
      VALUES ('sku_hong','sala','Hong',1,0,1)`).run();
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
        VALUES ('sku_long','sala','Long',1,0,1)`).run();
    });
    throw new Error('lop ngoai hong');
  }), /lop ngoai hong/);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM skus`).get().n, truoc,
    'lớp trong đã ghi nhưng lớp ngoài hỏng → phải hoàn tác hết');
});

test('chuyển kho hỏng giữa chừng KHÔNG để hàng bốc hơi', () => {
  Inv.createSku({ id: 'sku_ck', name: 'Hang CK', price: 1000, stock: 0, warehouse_id: 'wh_a' }, 'sala');
  Inv.receiveSku('sku_ck', 10, 'sala', { warehouse_id: 'wh_a', lot_no: 'L1' });
  assert.equal(tonKho('sku_ck', 'wh_a'), 10);

  // Dòng thứ hai trỏ mặt hàng không tồn tại → cả phiếu phải bị từ chối.
  assert.throws(() => Inv.transferStock({
    from_warehouse_id: 'wh_a',
    to_warehouse_id: 'wh_b',
    lines: [
      { item_type: 'sku', item_id: 'sku_ck', qty: 4 },
      { item_type: 'sku', item_id: 'sku_khong_co', qty: 1 },
    ],
  }, 'sala'));

  assert.equal(tonKho('sku_ck', 'wh_a'), 10, 'kho nguồn phải nguyên vẹn');
  assert.equal(tonKho('sku_ck', 'wh_b'), 0, 'kho đích không được nhận gì');
});

test('chuyển kho hợp lệ vẫn chạy đúng: nguồn giảm, đích tăng, tổng không đổi', () => {
  Inv.transferStock({
    from_warehouse_id: 'wh_a',
    to_warehouse_id: 'wh_b',
    lines: [{ item_type: 'sku', item_id: 'sku_ck', qty: 4 }],
  }, 'sala');

  assert.equal(tonKho('sku_ck', 'wh_a'), 6);
  assert.equal(tonKho('sku_ck', 'wh_b'), 4);
  assert.equal(tonKho('sku_ck', 'wh_a') + tonKho('sku_ck', 'wh_b'), 10,
    'chuyển kho không được sinh ra hay làm mất hàng');
});

test('nhập theo thùng quy đổi tồn và giá vốn về đơn vị gốc', () => {
  Inv.createSku({
    id: 'sku_unit',
    name: 'Nước chai',
    code: 'NUOC-01',
    brand: 'Dan D Pak',
    price: 10000,
    warehouse_id: 'wh_a',
    units: [{ name: 'thùng', factor: 24, barcode: '893-unit-box', cost: 192000 }],
  }, 'sala');

  Inv.receiveSku('sku_unit', 2, 'sala', {
    warehouse_id: 'wh_a',
    uom: 'thùng',
    unit_cost: 192000,
  });

  const lot = db.prepare(`SELECT qty_on_hand,unit_cost FROM stock_lots
    WHERE item_type='sku' AND item_id='sku_unit'`).get();
  assert.equal(lot.qty_on_hand, 48);
  assert.equal(lot.unit_cost, 8000);
  assert.equal(Inv.findSkuByBarcode('893-unit-box', 'sala').id, 'sku_unit');

  const po = Purchase.savePurchaseOrder({
    supplier_name_manual: 'NCC test',
    warehouse_id: 'wh_a',
    lines: [{
      item_type: 'sku',
      item_id: 'sku_unit',
      name: 'Nước chai',
      unit: 'thùng',
      qty: 1,
      unit_cost: 192000,
    }],
  }, 'sala', { name: 'Tester' });
  Purchase.completePurchaseOrder(po.id, { warehouse_id: 'wh_a' }, 'sala',
    { name: 'Tester' });
  assert.equal(tonKho('sku_unit', 'wh_a'), 72,
    'phiếu nhập 1 thùng phải cộng thêm 24 đơn vị gốc');

  const updated = Inv.updateSku('sku_unit', {
    code: 'NUOC-02',
    brand: 'DDP',
    units: [{ name: 'lốc', factor: 6, barcode: '893-unit-pack' }],
  }, 'sala');
  assert.equal(updated.code, 'NUOC-02');
  assert.equal(updated.brand, 'DDP');
  assert.equal(JSON.parse(updated.units_json)[0].barcode, '893-unit-pack');

  Inv.deleteSku('sku_unit', 'sala');
  assert.equal(db.prepare(`SELECT active FROM skus WHERE id='sku_unit'`).get().active, 0);
  assert.equal(tonKho('sku_unit', 'wh_a'), 72, 'xóa mềm không được làm mất lịch sử tồn');
});

test('không cho chuyển nhiều hơn tồn thực tế ở kho nguồn', () => {
  assert.throws(() => Inv.transferStock({
    from_warehouse_id: 'wh_a',
    to_warehouse_id: 'wh_b',
    lines: [{ item_type: 'sku', item_id: 'sku_ck', qty: 999 }],
  }, 'sala'), /Không đủ tồn/);
  assert.equal(tonKho('sku_ck', 'wh_a'), 6, 'tồn giữ nguyên sau khi bị từ chối');
});

test('tồn kho được định tuyến theo từng kho, kho đã hết không fallback về tồn tổng', () => {
  Inv.createSku({ id: 'sku_route', name: 'Hàng định tuyến', price: 1000, warehouse_id: 'wh_a' }, 'sala');
  Inv.receiveSku('sku_route', 5, 'sala', { warehouse_id: 'wh_a', lot_no: 'ROUTE' });
  Inv.transferStock({
    from_warehouse_id: 'wh_a',
    to_warehouse_id: 'wh_b',
    lines: [{ item_type: 'sku', item_id: 'sku_route', qty: 5 }],
  }, 'sala');

  const atA = Inv.listSkus('sala', { warehouse_id: 'wh_a' }).find(x => x.id === 'sku_route');
  const atB = Inv.listSkus('sala', { warehouse_id: 'wh_b' }).find(x => x.id === 'sku_route');
  assert.equal(atA?.stock, 0);
  assert.equal(atB?.stock, 5);
});

test('DB từ chối gắn SKU sang kho của chi nhánh khác', () => {
  db.prepare(`INSERT INTO branches (id,name,code,active) VALUES ('br_other','Khác','OTHER',1)`).run();
  db.prepare(`INSERT INTO warehouses (id,branch_id,name,code,type,active,sort)
    VALUES ('wh_other','br_other','Kho khác','OTHER','retail',1,0)`).run();
  assert.throws(() => db.prepare(`UPDATE skus SET warehouse_id='wh_other' WHERE id='sku_route'`).run(),
    /không thuộc cùng chi nhánh/);
});
