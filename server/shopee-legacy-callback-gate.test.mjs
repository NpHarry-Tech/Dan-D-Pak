// §8 HARDENING — legacy /auth/{shopee,lazada}/callback fail-closed by default.
// Đường canonical là Connection Platform (state mpatt_ + TTL + branch bind
// server-side + anti-replay). Legacy fallback (branch từ client query, không
// state machine) BỊ NGƯNG trừ khi bật cờ tường minh.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadEnv } from './config/env.js';

const HERE = dirname(fileURLToPath(import.meta.url));

test('mặc định: legacy callback flag TẮT (fail-closed)', () => {
  assert.equal(loadEnv({}).SHOPEE_LEGACY_CALLBACK, false);
});

test('bật tường minh mới cho phép legacy', () => {
  assert.equal(loadEnv({ SHOPEE_LEGACY_CALLBACK: '1' }).SHOPEE_LEGACY_CALLBACK, true);
  assert.equal(loadEnv({ SHOPEE_LEGACY_CALLBACK: 'true' }).SHOPEE_LEGACY_CALLBACK, true);
  assert.equal(loadEnv({ SHOPEE_LEGACY_CALLBACK: 'no' }).SHOPEE_LEGACY_CALLBACK, false);
});

test('cả hai callback shopee+lazada đều gate legacy sau cờ (fail-closed 400)', () => {
  const src = readFileSync(join(HERE, 'index.js'), 'utf8');
  // Mỗi callback: nhánh mpatt_ canonical + guard !env.SHOPEE_LEGACY_CALLBACK → 400
  // TRƯỚC khi lấy branch_id từ query hay gọi exchange token legacy.
  const gates = src.match(/if \(!env\.SHOPEE_LEGACY_CALLBACK\)/g) || [];
  assert.ok(gates.length >= 2, 'shopee + lazada legacy đều phải fail-closed');
  // Legacy branch-from-query chỉ xuất hiện SAU guard (không có đường vòng).
  assert.match(src, /if \(!env\.SHOPEE_LEGACY_CALLBACK\)[\s\S]*?shopeeExchangeToken/);
});
