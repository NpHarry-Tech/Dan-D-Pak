import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { buildReceiptDoc } from './services/receipt_doc.js';

test('K80 GDI uses a 72 mm safe print area so totals are not clipped', () => {
  const source = readFileSync(new URL('./agent.cjs', import.meta.url), 'utf8');
  assert.match(source, /\$paperW = 315/,
    'the physical paper must remain 80 mm wide');
  assert.match(source, /\$marginL = 16; \$marginR = 16/,
    'center the 72 mm content area inside the physical 80 mm paper');
  assert.match(source, /\$offsetMm -= 2\.0/,
    'apply the requested additional 2 mm right-to-left calibration');

  const doc = buildReceiptDoc({
    total: 116000,
    goods_amount: 116000,
    paid: 116000,
    items: [{ name: 'San pham', qty: 1, unit_price: 116000 }],
  }, { bill: { paper: 'K80', offsetMm: -2 } });
  const totalRow = doc.blocks.find((block) => block.type === 'row'
    && block.cols?.some((column) => column.text === 'TỔNG CỘNG'));

  assert.ok(totalRow, 'receipt must contain the grand-total row');
  assert.equal(totalRow.cols.at(-1).text, '116.000đ');
  assert.equal(doc.offsetMm, -2, 'retain the existing 2 mm left correction');

  const itemHeader = doc.blocks.find((block) => block.type === 'row'
    && block.cols?.some((column) => column.text === 'Đơn giá'));
  assert.deepEqual(itemHeader.cols.map((column) => column.text),
    ['Đơn giá', 'SL', 'T.Tiền']);
  const itemRow = doc.blocks.find((block) => block.type === 'row'
    && block.cols?.[0]?.text === '116.000');
  assert.deepEqual(itemRow.cols.map((column) => column.text),
    ['116.000', '1', '116.000']);
});

test('promoted item prints CTKM below name and both prices on one numeric row', () => {
  const doc = buildReceiptDoc({
    items: [{
      name: 'Khuyen mai', qty: 2, unit_price: 50000, vat_rate: 0,
      promo: { name: 'Giam 20k', amount: 20000 },
    }],
    total: 80000,
  }, { bill: { paper: 'K80' } });
  const promoRows = doc.blocks.filter((block) => block.type === 'row'
    && block.cols?.length === 4
    && block.cols[0].text === '50.000');
  assert.equal(promoRows.length, 1);
  assert.deepEqual(promoRows[0].cols.map((column) => column.text),
    ['50.000', '40.000', '2', '80.000']);
  assert.equal(promoRows[0].cols[0].strike, true);
  const nameIndex = doc.blocks.findIndex((block) => block.type === 'text'
    && block.text === 'Khuyen mai');
  const ctkmIndex = doc.blocks.findIndex((block) => block.type === 'text'
    && block.text.includes('CTKM: Giam 20k'));
  const firstPriceIndex = doc.blocks.indexOf(promoRows[0]);
  assert.equal(ctkmIndex, nameIndex + 1, 'CTKM must sit directly below item name');
  assert.equal(firstPriceIndex, ctkmIndex + 1,
    'the single price/quantity/amount row must follow CTKM immediately');
  const text = doc.blocks.map((block) => block.text || '').join('\n');
  assert.doesNotMatch(text, /Đơn giá (trước|sau) CTKM:/);
});
