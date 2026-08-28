// Step 2 multi-device P0 — EDIT LEASE race/behavior tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'ddp-lease-'));
process.env.SQLITE_PATH = join(tmp, 'store.db');
process.env.STORAGE_PATH = join(tmp, 'storage');
process.env.DISABLE_DEMO_SEED = 'true';

const { migrate } = await import('./db.js');
migrate();
const L = await import('./services/retailLease.js');

const T0 = '2026-08-26T10:00:00.000Z';
const T40 = '2026-08-26T10:00:40.000Z'; // > 30s TTL

test('A acquire được lease; B acquire cùng lúc → conflict + holder=A', () => {
  const a = L.acquireLease('sala', 1, { device: 'A', user_name: 'An', at: T0 });
  assert.equal(a.granted, true);
  assert.ok(a.lease_token);
  const b = L.acquireLease('sala', 1, { device: 'B', user_name: 'Bình', at: T0 });
  assert.equal(b.granted, false);
  assert.equal(b.conflict, true);
  assert.equal(b.holder.device, 'A');
});

test('A cùng device re-acquire → gia hạn, giữ nguyên token', () => {
  const a1 = L.acquireLease('sala', 2, { device: 'A', at: T0 });
  const a2 = L.acquireLease('sala', 2, { device: 'A', at: T0 });
  assert.equal(a2.granted, true);
  assert.equal(a2.lease_token, a1.lease_token);
});

test('heartbeat token đúng OK; token sai → 409 EDIT_LEASE_LOST', () => {
  const a = L.acquireLease('sala', 3, { device: 'A', at: T0 });
  assert.equal(L.heartbeatLease('sala', 3, { device: 'A', lease_token: a.lease_token, at: T0 }).ok, true);
  assert.throws(
    () => L.heartbeatLease('sala', 3, { device: 'A', lease_token: 'wrong', at: T0 }),
    (e) => e.status === 409 && e.code === 'EDIT_LEASE_LOST');
});

test('lease hết hạn (TTL) → device khác acquire được', () => {
  L.acquireLease('sala', 4, { device: 'A', at: T0 });
  const b = L.acquireLease('sala', 4, { device: 'B', at: T40 }); // sau 40s, A đã hết hạn
  assert.equal(b.granted, true);
});

test('TAKEOVER atomic: thu hồi token A → A heartbeat nhận EDIT_LEASE_LOST', () => {
  const a = L.acquireLease('sala', 5, { device: 'A', user_name: 'An', at: T0 });
  const b = L.takeoverLease('sala', 5, { device: 'B', user_name: 'Bình', at: T0 });
  assert.equal(b.granted, true);
  assert.equal(b.revoked.device, 'A');
  // A cố heartbeat bằng token cũ → mất quyền
  assert.throws(
    () => L.heartbeatLease('sala', 5, { device: 'A', lease_token: a.lease_token, at: T0 }),
    (e) => e.code === 'EDIT_LEASE_LOST');
  // B là chủ mới
  assert.equal(L.heartbeatLease('sala', 5, { device: 'B', lease_token: b.lease_token, at: T0 }).ok, true);
});

test('release rồi device khác acquire ngay được', () => {
  const a = L.acquireLease('sala', 6, { device: 'A', at: T0 });
  L.releaseLease('sala', 6, { device: 'A', lease_token: a.lease_token });
  const b = L.acquireLease('sala', 6, { device: 'B', at: T0 });
  assert.equal(b.granted, true);
});
