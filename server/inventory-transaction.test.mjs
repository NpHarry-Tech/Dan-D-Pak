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
db.prepare(`INSERT OR IGNORE INTO warehouses (id,branch_id,name,code,type,active,sort)
  VALUES ('wh_k','sala','Kho bếp','WH-K','kitchen',1,0)`).run();

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

test('tạo SKU sinh mã tự động và chặn trùng mã/mã vạch trong chi nhánh', () => {
  const first = Inv.createSku({ id: 'sku_auto_code', name: 'Hàng tự sinh mã', barcode: '893000001' }, 'sala');
  assert.match(first.code, /^SP[A-Z0-9]+$/);
  assert.throws(() => Inv.createSku({ id: 'sku_dup_barcode', name: 'Hàng trùng', barcode: '893000001' }, 'sala'), /đã tồn tại/);
  assert.throws(() => Inv.createSku({ id: 'sku_dup_code', name: 'Hàng trùng mã', code: first.code }, 'sala'), /đã tồn tại/);
});

test('nhập lại cộng đúng lot/date; cùng mã lot khác HSD phải tách riêng', () => {
  Inv.createSku({ id: 'sku_lot_date', name: 'Hàng theo lô', price: 1000,
    stock: 0, warehouse_id: 'wh_a', track_lot: true }, 'sala');
  Inv.receiveSku('sku_lot_date', 5, 'sala', {
    warehouse_id: 'wh_a', lot_no: 'LOT-A', expiry_date: '2027-10-15',
  });
  Inv.receiveSku('sku_lot_date', 7, 'sala', {
    warehouse_id: 'wh_a', lot_no: 'LOT-A', expiry_date: '2027-10-15',
  });
  Inv.receiveSku('sku_lot_date', 3, 'sala', {
    warehouse_id: 'wh_a', lot_no: 'LOT-A', expiry_date: '2028-10-15',
  });
  const lots = db.prepare(`SELECT expiry_date,qty_on_hand FROM stock_lots
    WHERE item_id='sku_lot_date' ORDER BY expiry_date`).all();
  assert.deepEqual(lots.map(x => ({ expiry_date: x.expiry_date, qty_on_hand: x.qty_on_hand })), [
    { expiry_date: '2027-10-15', qty_on_hand: 12 },
    { expiry_date: '2028-10-15', qty_on_hand: 3 },
  ]);
  assert.equal(db.prepare(`SELECT stock FROM skus WHERE id='sku_lot_date'`).get().stock, 15);
});

test('không nhập mã lot thì cùng HSD dùng AUTO lot ổn định để cộng dồn', () => {
  Inv.createSku({ id: 'sku_auto_lot', name: 'Hàng auto lot', price: 1000,
    stock: 0, warehouse_id: 'wh_a', track_lot: true }, 'sala');
  Inv.receiveSku('sku_auto_lot', 2, 'sala', { warehouse_id: 'wh_a', expiry_date: '2029-01-02' });
  Inv.receiveSku('sku_auto_lot', 4, 'sala', { warehouse_id: 'wh_a', expiry_date: '2029-01-02' });
  const lots = db.prepare(`SELECT lot_no,qty_on_hand FROM stock_lots WHERE item_id='sku_auto_lot'`).all();
  assert.equal(lots.length, 1);
  assert.equal(lots[0].lot_no, 'AUTO-20290102');
  assert.equal(lots[0].qty_on_hand, 6);
});

test('xóa danh mục kho chỉ ngừng sử dụng, không xóa chứng từ và lịch sử đã phát sinh', () => {
  Inv.createInventoryItem({ id: 'inv_history', name: 'Nguyên liệu lúc nhập', unit: 'kg',
    barcode: 'INV-HISTORY', warehouse_id: 'wh_k', opening_stock: 0 }, 'sala');
  Inv.receiveStock('inv_history', 3, 'sala', { warehouse_id: 'wh_k', unit_cost: 42000,
    lot_no: 'HIST-1', movementType: 'receipt' });
  const beforeMovements = Inv.listMovements('sala', { item_id: 'inv_history', limit: 20 });
  assert.ok(beforeMovements.length > 0);
  assert.equal(beforeMovements[0].item_name, 'Nguyên liệu lúc nhập');
  assert.equal(beforeMovements[0].unit, 'kg');

  Inv.deleteInventoryItem('inv_history', 'sala');
  assert.equal(db.prepare(`SELECT active FROM inventory_items WHERE id='inv_history'`).get().active, 0);
  const afterMovements = Inv.listMovements('sala', { item_id: 'inv_history', limit: 20 });
  assert.equal(afterMovements.length, beforeMovements.length);
  assert.equal(afterMovements[0].item_name, 'Nguyên liệu lúc nhập');
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM inventory_document_lines WHERE item_id='inv_history'`).get().n > 0, true);
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

test('save import preview rolls back purchase/stocktake header when a line fails', () => {
  const poBefore = db.prepare(`SELECT COUNT(*) n FROM purchase_orders`).get().n;
  db.exec(`CREATE TEMP TRIGGER fail_import_po BEFORE INSERT ON purchase_order_lines
    WHEN NEW.item_id='boom' BEGIN SELECT RAISE(ABORT, 'injected import line failure'); END;`);
  assert.throws(() => Purchase.savePurchaseOrder({
    supplier_name_manual: 'Import rollback test',
    lines: [
      { item_type: 'adhoc', item_id: 'ok', name: 'OK', qty: 1, unit_cost: 10 },
      { item_type: 'adhoc', item_id: 'boom', name: 'Boom', qty: 1, unit_cost: 20 },
    ],
  }, 'sala'), /injected import line failure/);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM purchase_orders`).get().n, poBefore,
    'header and first line must roll back together');
  db.exec(`DROP TRIGGER fail_import_po`);

  const stocktakeBefore = db.prepare(`SELECT COUNT(*) n FROM stocktake_sessions`).get().n;
  db.exec(`CREATE TEMP TRIGGER fail_import_stocktake BEFORE INSERT ON stocktake_lines
    WHEN NEW.item_id='sku_ck' BEGIN SELECT RAISE(ABORT, 'injected stocktake line failure'); END;`);
  assert.throws(() => Inv.saveStocktakeSession({
    warehouse_id: 'wh_a',
    lines: [{ stock_type: 'sku', item_id: 'sku_ck', counted_qty: 6 }],
  }, 'sala'), /injected stocktake line failure/);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM stocktake_sessions`).get().n,
    stocktakeBefore, 'stocktake header must not survive a failed line');
  db.exec(`DROP TRIGGER fail_import_stocktake`);
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

test('bán hàng không được làm tồn SKU xuống âm và phải rollback sạch', () => {
  Inv.createSku({ id: 'sku_no_negative', name: 'Hàng sát tồn', price: 1000, stock: 0, warehouse_id: 'wh_a' }, 'sala');
  Inv.receiveSku('sku_no_negative', 1, 'sala', { warehouse_id: 'wh_a', lot_no: 'BOUNDARY' });
  const movementsBefore = db.prepare(`SELECT COUNT(*) n FROM stock_movements WHERE inventory_item_id='sku_no_negative'`).get().n;

  assert.throws(() => inTransaction(() => Inv.deductForOrder({
    id: 'order_no_negative',
    channel: 'retail',
    items: [{ sku_id: 'sku_no_negative', qty: 2, status: 'served' }],
  }, 'sala')), /Không đủ tồn/);

  assert.equal(tonKho('sku_no_negative', 'wh_a'), 1, 'tồn phải giữ nguyên sau sale bị từ chối');
  assert.equal(
    db.prepare(`SELECT COUNT(*) n FROM stock_movements WHERE inventory_item_id='sku_no_negative'`).get().n,
    movementsBefore,
    'không được để lại movement sale khi transaction thất bại',
  );
});
