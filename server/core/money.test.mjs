import test from 'node:test';
import assert from 'node:assert/strict';
import { allocateProportion, divideMoney, grossFromNet, multiplyMoney, netFromGross } from './money.js';

test('VND calculations use exact fixed-point rounding', () => {
  assert.equal(multiplyMoney(19_999, '0.3'), 6_000);
  assert.equal(grossFromNet(74_074, '8'), 80_000);
  assert.equal(netFromGross(80_000, '8'), 74_074);
  assert.equal(divideMoney(100_000, '3', 2), 33_333.33);
});

test('proportional allocation is deterministic and remainder-safe', () => {
  const first = allocateProportion(100_000, 1, 3);
  const second = allocateProportion(100_000, 1, 3);
  const last = 100_000 - first - second;
  assert.deepEqual([first, second, last], [33_333, 33_333, 33_334]);
});
