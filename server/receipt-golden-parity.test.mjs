import test from 'node:test';
import assert from 'node:assert/strict';
import { renderJobText, markReceiptReprint } from './services/printing.js';
import { moneyToWords } from './services/history.js';

test('Golden Receipt Parity & Formatter Validation', () => {
  // 1. Money to Words validation
  assert.equal(moneyToWords(100000), 'Một trăm nghìn đồng');
  assert.equal(moneyToWords(24545), 'Hai mươi bốn nghìn năm trăm bốn mươi lăm đồng');

  // 2. Sample receipt rendering with Unicode, header & amount in words
  const samplePayload = {
    bill_no: '000123',
    branch: 'SALA',
    company: {
      name: 'CÔNG TY TNHH DỊCH VỤ TIẾP THỊ BCM',
      address: 'Sala Tower, Q.2, TP.HCM',
    },
    table_code: '1',
    items: [
      { name: 'Bia 333 330ml', qty: 1, unit_price: 24545 },
      { name: 'Cà phê sữa đá', qty: 2, unit_price: 34024 },
    ],
    subtotal: 92593,
    vat_amount: 7407,
    total: 100000,
    paid: 100000,
    change: 0,
    reprint: true,
  };

  const job = {
    type: 'receipt',
    branch_id: 'sala',
    payload: samplePayload,
  };

  const receiptText = renderJobText(job, 'sala', { widthMm: 58 });

  // Verify K57 32-col layout
  const lines = receiptText.split('\n');
  for (const l of lines) {
    assert.ok(l.length <= 32, `Line exceeds 32 chars on K57: "${l}" (${l.length} chars)`);
  }

  // Verify Unicode company name wrapping & centering
  assert.ok(receiptText.includes('CÔNG TY TNHH DỊCH VỤ TIẾP THỊ'));
  assert.ok(receiptText.includes('BCM'));

  // Verify (IN LẠI) is on bill title line, NOT attached to company name
  assert.ok(receiptText.includes('HÓA ĐƠN THANH TOÁN (IN LẠI)'));
  assert.ok(!receiptText.includes('TIẾP THỊ (IN LẠI)'));
  assert.ok(!receiptText.includes('BCM (IN LẠI)'));

  // Verify item column headers exist
  assert.ok(receiptText.includes('SL'));
  assert.ok(receiptText.includes('ĐƠN GIÁ'));
  assert.ok(receiptText.includes('THÀNH TIỀN'));

  // Verify money formatting dot-separated with 'đ'
  assert.ok(receiptText.includes('24.545đ'));
  assert.ok(receiptText.includes('100.000đ'));

  // Verify Amount in Words line
  assert.ok(receiptText.includes('Bằng chữ:'));
  assert.ok(receiptText.includes('Một trăm nghìn đồng.'));
});

test('markReceiptReprint does not append (IN LẠI) to store or company name', () => {
  const input = [
    'CÔNG TY TNHH DỊCH VỤ TIẾP THỊ',
    'BCM',
    '--------------------------------',
    'HÓA ĐƠN THANH TOÁN',
    'Mã HD: #000123',
  ].join('\n');

  const output = markReceiptReprint(input);

  assert.ok(!output.includes('TIẾP THỊ (IN LẠI)'));
  assert.ok(!output.includes('BCM (IN LẠI)'));
  assert.ok(output.includes('HÓA ĐƠN THANH TOÁN (IN LẠI)'));
});
