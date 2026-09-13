// HIEU NANG: findSkuByBarcode truoc day quet TOAN BO SKU dang hoat dong cua
// chi nhanh + JSON.parse moi dong, cho MOI lan quet ma vach o quay ban le —
// thao tac goi nhieu nhat trong toan bo he thong. Fix them duong nhanh index
// (WHERE barcode=?) cho ma vach CHINH, chi roi xuong quet cham khi khong khop
// (ma vach cua don vi phu nhu thung/lo trong units_json). Test nay khoa lai
// CA HAI duong déu phai tim dung SKU.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-sku-barcode-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const { db, migrate, now } = await import('./db.js');
migrate();
const Inventory = await import('./services/inventory.js');

function insertSku(id, { barcode = '', unitsJson = '[]' } = {}) {
  db.prepare(`INSERT INTO skus
    (id, branch_id, barcode, name, price, unit, active, units_json)
    VALUES (?, 'sala', ?, ?, 10000, 'cái', 1, ?)`).run(id, barcode, `SKU ${id}`, unitsJson);
}

insertSku('sku_a', { barcode: '8931234500011' });
insertSku('sku_b', {
  barcode: '8931234500022',
  unitsJson: JSON.stringify([{ name: 'thùng', factor: 24, barcode: '8931234500099' }]),
});

test('quet trung ma vach CHINH (duong nhanh index)', () => {
  const found = Inventory.findSkuByBarcode('8931234500011', 'sala');
  assert.ok(found);
  assert.equal(found.id, 'sku_a');
});

test('quet trung ma vach cua DON VI PHU (thung) qua duong quet cham', () => {
  const found = Inventory.findSkuByBarcode('8931234500099', 'sala');
  assert.ok(found, 'phai tim thay qua units_json khi khong khop cot barcode chinh');
  assert.equal(found.id, 'sku_b');
});

test('ma vach khong ton tai thi tra ve null, khong nem loi', () => {
  assert.equal(Inventory.findSkuByBarcode('0000000000000', 'sala'), null);
});

test('khong lay nham SKU chi nhanh khac', () => {
  insertSku('sku_other_branch', { barcode: 'CROSS-BRANCH' });
  db.prepare(`UPDATE skus SET branch_id='another' WHERE id='sku_other_branch'`).run();
  assert.equal(Inventory.findSkuByBarcode('CROSS-BRANCH', 'sala'), null);
});
