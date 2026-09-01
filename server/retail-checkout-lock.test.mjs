// Step 2 multi-device P0 — CHECKOUT LOCK money-safety invariants.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'ddp-colock-'));
process.env.SQLITE_PATH = join(tmp, 'store.db');
process.env.STORAGE_PATH = join(tmp, 'storage');
process.env.DISABLE_DEMO_SEED = 'true';

const { migrate } = await import('./db.js');
migrate();
const C = await import('./services/retailCheckoutLock.js');

const T0 = '2026-08-26T10:00:00.000Z';
const T200 = '2026-08-26T10:03:20.000Z'; // > 120s TTL

test('hai thiết bị checkout đồng thời → CHỈ MỘT thắng', () => {
  const a = C.acquireCheckoutLock('sala', 1, { device: 'A', idempotency_key: 'ka', at: T0 });
  assert.equal(a.granted, true);
  assert.throws(
    () => C.acquireCheckoutLock('sala', 1, { device: 'B', idempotency_key: 'kb', at: T0 }),
    (e) => e.status === 409 && e.code === 'ORDER_ALREADY_CHECKING_OUT' && e.holder.device === 'A');
});

test('double-click Pay (cùng device + cùng key) → idempotent, KHÔNG double', () => {
  const a1 = C.acquireCheckoutLock('sala', 2, { device: 'A', idempotency_key: 'k2', at: T0 });
  const a2 = C.acquireCheckoutLock('sala', 2, { device: 'A', idempotency_key: 'k2', at: T0 });
  assert.equal(a1.granted, true);
  assert.equal(a2.granted, true);
  assert.equal(a2.idempotent, true);
});

test('PAID là terminal: acquire sau khi paid → 409 ORDER_FINALIZED', () => {
  C.acquireCheckoutLock('sala', 3, { device: 'A', idempotency_key: 'k3', at: T0 });
  C.markCheckoutPaid('sala', 3, { device: 'A', order_id: 'o3', bill_no: 'B3', at: T0 });
  assert.throws(
    () => C.acquireCheckoutLock('sala', 3, { device: 'B', idempotency_key: 'kx', at: T0 }),
    (e) => e.status === 409 && e.code === 'ORDER_FINALIZED');
});

test('đang checkout → assertNotCheckingOut chặn sửa; paid → ORDER_FINALIZED', () => {
  C.acquireCheckoutLock('sala', 4, { device: 'A', idempotency_key: 'k4', at: T0 });
  assert.throws(
    () => C.assertNotCheckingOut('sala', 4, { at: T0 }),
    (e) => e.code === 'ORDER_ALREADY_CHECKING_OUT');
  C.markCheckoutPaid('sala', 4, { device: 'A', order_id: 'o4', at: T0 });
  assert.throws(
    () => C.assertNotCheckingOut('sala', 4, { at: T0 }),
    (e) => e.code === 'ORDER_FINALIZED');
});

test('máy chết giữa checkout: lock hết hạn → máy khác giành được', () => {
  C.acquireCheckoutLock('sala', 5, { device: 'A', idempotency_key: 'k5', at: T0 });
  const b = C.acquireCheckoutLock('sala', 5, { device: 'B', idempotency_key: 'k5b', at: T200 });
  assert.equal(b.granted, true);
});

test('release khi checkout huỷ → máy khác giành ngay được', () => {
  C.acquireCheckoutLock('sala', 6, { device: 'A', idempotency_key: 'k6', at: T0 });
  C.releaseCheckoutLock('sala', 6, { device: 'A' });
  const b = C.acquireCheckoutLock('sala', 6, { device: 'B', idempotency_key: 'k6b', at: T0 });
  assert.equal(b.granted, true);
});

test('slot OPEN (chưa checkout) → assertNotCheckingOut cho phép sửa', () => {
  assert.doesNotThrow(() => C.assertNotCheckingOut('sala', 99, { at: T0 }));
});
