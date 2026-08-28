import assert from 'node:assert/strict';
import test from 'node:test';

import { assertBalanced, buildPublishPayload } from './services/misa/payload.js';

const sample = {
  order_id: 'HD024970',
  schema_version: 1,
  bill: { branch_id: 'sala', total: 180000, paid_at: '2026-08-18T04:00:00.000Z' },
  total: 180000,
  items: [
    {
      product_code: '91980024',
      product_name: 'Socola Đen Bọc Hạnh Nhân 170g',
      quantity: 1,
      original_price: 120000,
      final_price_after_vat: 60000,
      vat_rate: 8,
      promotion: { is_applied: true, promo_name: 'Giảm giá hàng cận date 50%' },
    },
    {
      product_code: '89345678',
      product_name: 'Bánh quy bơ Danisa 454g',
      quantity: 1,
      original_price: 120000,
      final_price_after_vat: 120000,
      vat_rate: 10,
      promotion: { is_applied: false },
    },
  ],
  buyer: {},
  payments: [{ method: 'cash', amount: 180000 }],
};

test('nested promotions become adjacent ItemType=4 rows in one MISA invoice', () => {
  const payload = buildPublishPayload({
    snapshot: sample,
    cfg: {
      taxCode: '0316756674', defaultTaxRate: 8,
      templateId: 'tpl', series: 'C26M', invoiceType: 'CASH_REGISTER',
    },
  });

  assert.equal(payload.RefID, 'einv:0316756674:sala:HD024970:v1');
  assert.ok(payload.OrgInvoiceData, 'exactly one parent invoice must be produced');
  const lines = payload.OrgInvoiceData.OriginalInvoiceDetail;
  assert.equal(lines.length, 3);

  assert.deepEqual(lines.map((line) => [line.LineNumber, line.ItemType, line.ItemName]), [
    [1, 1, 'Socola Đen Bọc Hạnh Nhân 170g'],
    [2, 4, 'Giảm giá hàng cận date 50%'],
    [3, 1, 'Bánh quy bơ Danisa 454g'],
  ]);

  const note = lines[1];
  for (const field of [
    'Quantity', 'UnitPrice', 'Amount', 'VATRateName', 'VATRate', 'VATAmount',
  ]) assert.equal(note[field], null, `${field} must be null on a note row`);
  assert.equal(note.SortOrder, null);
  assert.equal(lines[0].Quantity, 1);
  assert.equal(lines[0].Amount + lines[0].VATAmount, 60000);
  assert.equal(lines[2].Amount + lines[2].VATAmount, 120000);

  assertBalanced({
    lines,
    totalAmountWithoutVAT: payload.OrgInvoiceData.TotalAmountWithoutVAT,
    totalVATAmount: payload.OrgInvoiceData.TotalVATAmount,
    grandTotal: payload.OrgInvoiceData.TotalAmount,
  });
});

test('inactive or unnamed promotion does not inject a description row', () => {
  const snapshot = structuredClone(sample);
  snapshot.items[0].promotion = { is_applied: true, promo_name: '   ' };
  const payload = buildPublishPayload({
    snapshot,
    cfg: { taxCode: '0316756674', defaultTaxRate: 8 },
  });
  assert.equal(payload.OrgInvoiceData.OriginalInvoiceDetail.length, 2);
  assert.equal(payload.OrgInvoiceData.OriginalInvoiceDetail.some((line) => line.ItemType === 4), false);
});
