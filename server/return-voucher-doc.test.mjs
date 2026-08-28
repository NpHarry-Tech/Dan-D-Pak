// Phiếu trả hàng — cả 2 render path (GDI doc + ESC/POS text) đúng tiêu đề + món + tổng.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-rv-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = 'development';

const { buildReturnVoucherDoc } = await import('./services/receipt_doc.js');
const { renderJobText } = await import('./services/printing.js');

const payload = {
  shopName: 'Dan D Pak', code: 'BILL-001', datetime: '2026-08-23T10:00:00.000Z',
  actor: 'thu ngan', approvedBy: 'quan ly',
  items: [
    { name: 'Áo thun', qty: 1, unitPrice: 100000, amount: 100000 },
    { name: 'Bút bi', qty: 2, unitPrice: 15000, amount: 30000 },
  ],
  total: 130000, refundMethod: 'Tiền mặt',
};

test('GDI doc: tiêu đề PHIẾU TRẢ HÀNG + 1 row/món + TỔNG HOÀN', () => {
  const doc = buildReturnVoucherDoc(payload, {}, {});
  const texts = doc.blocks.filter(b => b.type === 'text').map(b => b.text);
  assert.ok(texts.includes('PHIẾU TRẢ HÀNG'));
  const rows = doc.blocks.filter(b => b.type === 'row');
  // header + 2 item rows + total + chữ ký(2) → có đủ 2 dòng món
  const itemRows = rows.filter(r => ['Áo thun', 'Bút bi'].includes(r.cols?.[0]?.text));
  assert.equal(itemRows.length, 2);
  const totalRow = rows.find(r => r.cols?.[0]?.text === 'TỔNG HOÀN');
  assert.ok(totalRow, 'phải có dòng TỔNG HOÀN');
});

test('ESC/POS text: chứa tiêu đề + tên món + tổng hoàn (ASCII hoá cho máy nhiệt)', () => {
  const text = renderJobText({ type: 'return_voucher', payload }, 'sala', null);
  // ascii() bỏ dấu (máy in nhiệt ASCII) → khớp dạng không dấu.
  assert.match(text, /PHIEU TRA HANG/i);
  assert.match(text, /Ao thun/i);
  assert.match(text, /But bi/i);
  assert.match(text, /TONG HOAN/i);
  assert.match(text, /130[.,]?000/); // tổng hoàn
});
