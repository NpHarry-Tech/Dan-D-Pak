// §4 INTERNAL-ONLY REFERENCE — mã đối soát chuyển khoản (transfer_reference) +
// PaymentIntent id/metadata TUYỆT ĐỐI KHÔNG lọt ra customer receipt / print /
// sale snapshot dùng để in. Chỉ hiện ở History/Accounting internal (tách riêng).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(HERE, rel), 'utf8');

test('receipt_doc.js KHÔNG nhắc transfer_reference / payment_intent (non-leak)', () => {
  const src = read('services/receipt_doc.js');
  assert.doesNotMatch(src, /transfer_reference|payment_intent|reconciliation/i);
});

test('printing.js KHÔNG in transfer_reference / payment_intent lên bill khách', () => {
  const src = read('services/printing.js');
  assert.doesNotMatch(src, /transfer_reference|payment_intent/i);
});

test('history.js TÁCH reference sang payment_reconciliation (không trộn receipt lines)', () => {
  const src = read('services/history.js');
  assert.match(src, /payment_reconciliation/, 'reference phải trả ở nhánh reconciliation riêng');
  assert.match(src, /transfer_reference/, 'history internal có expose reference để đối soát/search');
});
