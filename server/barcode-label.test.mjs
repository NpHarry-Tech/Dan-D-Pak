// Tem MÃ VẠCH sản phẩm: phần tử 'barcode'/'qr' phải sinh MARKER mã vạch/QR THẬT
// ([[BC:..]] / [[QR:..]]) để escpos in ra mã QUÉT ĐƯỢC — không còn in chữ
// "[BARCODE ..]" như trước.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

process.env.SQLITE_PATH = join(mkdtempSync(join(tmpdir(), 'ddp-bcl-')), 'store.db');
process.env.STORAGE_PATH = join(tmpdir(), 'bcl-store');

const { migrate } = await import('./db.js');
const AppSettings = await import('./services/settings.js');
const Print = await import('./services/printing.js');
migrate();

test('tem san pham: phan tu barcode -> ma vach 1D THAT (khong phai chu [BARCODE ..])', () => {
  AppSettings.updateSettings({ print_config: {
    labels: { widthMm: 50 },
    templates: { product_label: { kind: 'product_label', rows: [
      { id: 'name', type: 'text', text: '{itemName}', align: 'center', bold: true },
      { id: 'bc', type: 'barcode', barcodeText: '{barcode}' },
    ] } },
  } }, 'bcl');

  const text = Print.renderJobText({ type: 'product_label', branch_id: 'bcl', payload: {
    itemName: 'Hạt điều 500g', barcode: '8938000123456', price: '250.000d',
  } }, 'bcl', { widthMm: 50 });

  // Ten san pham o TREN.
  assert.match(Print.stripMarks(text), /Hạt điều 500g/);
  // MA VACH THAT (marker [[BC:..]]), KHONG con chu "[BARCODE ..]".
  assert.match(text, /\[\[BC:8938000123456\]\]/);
  assert.ok(!text.includes('[BARCODE'), 'khong duoc con placeholder [BARCODE ..]');
  // stripMarks bo marker (de do be ngang) — khong lo "[[BC" ra giay.
  assert.ok(!Print.stripMarks(text).includes('[['), 'marker phai duoc bo sach khi do rong');
});

test('phan tu qr -> ma QR THAT ([[QR:..]]), khong phai chu [QR ..]', () => {
  AppSettings.updateSettings({ print_config: {
    labels: { widthMm: 50 },
    templates: { product_label: { kind: 'product_label', rows: [
      { id: 'q', type: 'qr', qrText: '{barcode}' },
    ] } },
  } }, 'bcl2');
  const text = Print.renderJobText({ type: 'product_label', branch_id: 'bcl2', payload: {
    itemName: 'X', barcode: '8938000123456',
  } }, 'bcl2', { widthMm: 50 });
  assert.match(text, /\[\[QR:8938000123456\]\]/);
  assert.ok(!text.includes('[QR '), 'khong con placeholder [QR ..]');
});
