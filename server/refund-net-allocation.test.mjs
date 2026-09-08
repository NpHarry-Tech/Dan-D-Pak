import assert from 'node:assert/strict';
import test from 'node:test';

import { orderLineAllocations, unitMoneySlice } from './services/tax.js';

test('refund allocation is capped by immutable net paid value', () => {
  const lines = orderLineAllocations([
    { id: 'a', qty: 1, unit_price: 200000, vat_rate: 8 },
    { id: 'b', qty: 1, unit_price: 20000, vat_rate: 8 },
    { id: 'c', qty: 1, unit_price: 20000, vat_rate: 8 },
  ], 40000);

  assert.equal(lines.reduce((sum, line) => sum + line.gross, 0), 240000);
  assert.equal(lines.reduce((sum, line) => sum + line.promotion, 0), 40000);
  assert.equal(lines.reduce((sum, line) => sum + line.net, 0), 200000);
});

test('partial refund rounding is deterministic and sums to the exact line net', () => {
  const first = unitMoneySlice(10000, 3, 0, 1);
  const rest = unitMoneySlice(10000, 3, 1, 2);
  assert.deepEqual(first, [3334]);
  assert.deepEqual(rest, [3333, 3333]);
  assert.equal([...first, ...rest].reduce((sum, value) => sum + value, 0), 10000);
});
