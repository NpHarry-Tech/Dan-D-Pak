import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_SEARCH_LENGTH, matchesSearch, normalizeSearch, searchTokens } from './search.js';

test('search groups infinite input into functional, boundary and security classes', () => {
  assert.equal(normalizeSearch('  Điện   THOẠI  '), 'dien thoai');
  assert.deepEqual(searchTokens('sữa sữa hạnh nhân'), ['sua', 'hanh', 'nhan']);
  assert.equal(matchesSearch(['Sữa hạt', 'Hạnh nhân'], 'sua nhan'), true);
  assert.equal(matchesSearch(['Sữa hạt', 'Óc chó'], 'sua nhan'), false);
  assert.equal(matchesSearch(['safe product'], "' OR 1=1 --"), false);
  assert.equal(matchesSearch(['<script>alert(1)</script>'], '<script>'), true);
  assert.equal(normalizeSearch('x'.repeat(MAX_SEARCH_LENGTH + 50)).length, MAX_SEARCH_LENGTH);
  assert.equal(matchesSearch(['x'.repeat(250), 'needle'], 'needle'), true);
  assert.equal(matchesSearch(['anything'], ''), true);
});

test('10k-row search stays bounded', () => {
  const rows = Array.from({ length: 10_000 }, (_, i) => [`SKU-${i}`, `Sản phẩm ${i}`]);
  const started = performance.now();
  const found = rows.filter(row => matchesSearch(row, 'san pham 9999'));
  assert.deepEqual(found, [['SKU-9999', 'Sản phẩm 9999']]);
  assert.ok(performance.now() - started < 500);
});
