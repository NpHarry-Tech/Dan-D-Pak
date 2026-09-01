// Step 2 multi-device P0 — DISPLAY SEQUENCE phải cấp ATOMIC phía server.
// Invariant: 2–10 thiết bị tạo draft đồng thời KHÔNG BAO GIỜ nhận cùng số;
// monotonic; không reuse số đã huỷ; độc lập theo branch; reset theo ngày.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'ddp-seq-'));
process.env.SQLITE_PATH = join(tmp, 'store.db');
process.env.STORAGE_PATH = join(tmp, 'storage');
process.env.DISABLE_DEMO_SEED = 'true';

const { migrate } = await import('./db.js');
migrate();
const { allocateDisplaySequence } = await import('./services/retailCart.js');

test('monotonic + KHÔNG trùng khi nhiều thiết bị cấp số (2–10)', () => {
  const seqs = [];
  for (let i = 0; i < 10; i++) {
    seqs.push(allocateDisplaySequence('sala', '2026-08-26').display_sequence);
  }
  assert.deepEqual(seqs, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(new Set(seqs).size, 10, 'không được có số trùng');
});

test('KHÔNG reuse số đã huỷ (huỷ đơn 2 thì tiếp theo vẫn là 3)', () => {
  const a = allocateDisplaySequence('br-x', '2026-08-26').display_sequence; // 1
  const b = allocateDisplaySequence('br-x', '2026-08-26').display_sequence; // 2
  // đơn số 2 bị huỷ ở tầng nghiệp vụ — số 2 KHÔNG được cấp lại
  const c = allocateDisplaySequence('br-x', '2026-08-26').display_sequence; // 3
  assert.deepEqual([a, b, c], [1, 2, 3]);
});

test('độc lập theo branch (mỗi branch có chuỗi riêng)', () => {
  assert.equal(allocateDisplaySequence('br-a', '2026-08-26').display_sequence, 1);
  assert.equal(allocateDisplaySequence('br-b', '2026-08-26').display_sequence, 1);
  assert.equal(allocateDisplaySequence('br-a', '2026-08-26').display_sequence, 2);
});

test('sang ngày business thì reset về 1', () => {
  assert.equal(allocateDisplaySequence('br-day', '2026-08-26').display_sequence, 1);
  assert.equal(allocateDisplaySequence('br-day', '2026-08-26').display_sequence, 2);
  assert.equal(allocateDisplaySequence('br-day', '2026-08-27').display_sequence, 1);
});
