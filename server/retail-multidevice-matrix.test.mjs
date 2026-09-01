// Step 2 multi-device P0 — A/B/C RACE MATRIX (end-to-end server).
// Chứng minh: một canonical order = một state nhất quán trên mọi thiết bị.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'ddp-mdx-'));
process.env.SQLITE_PATH = join(tmp, 'store.db');
process.env.STORAGE_PATH = join(tmp, 'storage');
process.env.DISABLE_DEMO_SEED = 'true';

const { migrate } = await import('./db.js');
migrate();
const Inv = await import('./services/inventory.js');
// §3: ADD_LINE định giá server-authoritative → cần SKU thật trong catalogue.
for (const [id, price] of [['s1', 1000], ['s9', 500], ['s', 500]]) {
  Inv.createSku({ id, name: id.toUpperCase(), barcode: 'B_' + id, category: 'X', price, stock: 1000 }, 'sala');
}
const O = await import('./services/retailOrderCommands.js');
const L = await import('./services/retailLease.js');
const C = await import('./services/retailCheckoutLock.js');

const T0 = '2026-08-26T10:00:00.000Z';
const T40 = '2026-08-26T10:00:40.000Z'; // > 30s lease TTL

let cid = 0;
const nextCid = () => `c${++cid}`;

test('A+B tạo order mới → order_id + display_sequence KHÁC NHAU', () => {
  const a = O.createDraft('sala', { device: 'A', at: T0 });
  const b = O.createDraft('sala', { device: 'B', at: T0 });
  assert.notEqual(a.order_id, b.order_id);
  assert.notEqual(a.display_sequence, b.display_sequence);
  assert.equal(a.revision, 0);
});

test('A đang giữ lease; B mở cùng order → cảnh báo holder = A', () => {
  const a = O.createDraft('sala', { device: 'A', user_name: 'An', at: T0 });
  const b = L.acquireLease('sala', a.order_id, { device: 'B', user_name: 'Bình', at: T0 });
  assert.equal(b.granted, false);
  assert.equal(b.conflict, true);
  assert.equal(b.holder.device, 'A');
});

test('B takeover → A mất quyền ngay (command của A → EDIT_LEASE_LOST)', () => {
  const a = O.createDraft('sala', { device: 'A', at: T0 });
  L.takeoverLease('sala', a.order_id, { device: 'B', at: T0 });
  assert.throws(
    () => O.applyCommand('sala', a.order_id, { command_id: nextCid(), expected_revision: 0, lease_token: a.lease_token, device: 'A', command: 'SET_NOTE', payload: { note: 'x' }, at: T0 }),
    (e) => e.code === 'EDIT_LEASE_LOST');
});

test('CHANGE_QTY với revision lạc hậu → 409 ORDER_VERSION_CONFLICT + canonical', () => {
  const a = O.createDraft('sala', { device: 'A', at: T0 });
  const r1 = O.applyCommand('sala', a.order_id, { command_id: nextCid(), expected_revision: 0, lease_token: a.lease_token, device: 'A', command: 'ADD_LINE', payload: { sku_id: 's1', unit_price: 1000, qty: 1 }, at: T0 });
  assert.equal(r1.revision, 1);
  const line = r1.snapshot.lines[0].line_id;
  // A tiến lên rev 2
  O.applyCommand('sala', a.order_id, { command_id: nextCid(), expected_revision: 1, lease_token: a.lease_token, device: 'A', command: 'CHANGE_QTY', payload: { line_id: line, qty: 3 }, at: T0 });
  // Lệnh mang expected_revision cũ (1) → xung đột, trả canonical rev 2
  let err;
  try {
    O.applyCommand('sala', a.order_id, { command_id: nextCid(), expected_revision: 1, lease_token: a.lease_token, device: 'A', command: 'CHANGE_QTY', payload: { line_id: line, qty: 9 }, at: T0 });
  } catch (e) { err = e; }
  assert.equal(err.code, 'ORDER_VERSION_CONFLICT');
  assert.equal(err.canonical.revision, 2);
});

test('A checkout trong lúc B định sửa → B bị chặn ORDER_ALREADY_CHECKING_OUT', () => {
  const a = O.createDraft('sala', { device: 'A', at: T0 });
  C.acquireCheckoutLock('sala', a.order_id, { device: 'A', idempotency_key: 'pay-a', at: T0 });
  assert.throws(
    () => O.applyCommand('sala', a.order_id, { command_id: nextCid(), expected_revision: 0, lease_token: a.lease_token, device: 'A', command: 'SET_NOTE', payload: { note: 'y' }, at: T0 }),
    (e) => e.code === 'ORDER_ALREADY_CHECKING_OUT');
});

test('A+B+C cùng Pay → CHỈ MỘT finalization', () => {
  const a = O.createDraft('sala', { device: 'A', at: T0 });
  const wins = [];
  for (const [dev, key] of [['A', 'ka'], ['B', 'kb'], ['C', 'kc']]) {
    try {
      const r = C.acquireCheckoutLock('sala', a.order_id, { device: dev, idempotency_key: key, at: T0 });
      if (r.granted && !r.idempotent) wins.push(dev);
    } catch (e) {
      assert.equal(e.code, 'ORDER_ALREADY_CHECKING_OUT');
    }
  }
  assert.equal(wins.length, 1, 'chỉ một thiết bị được finalize');
});

test('A Pay xong → B/C không còn sửa được (ORDER_FINALIZED)', () => {
  const a = O.createDraft('sala', { device: 'A', at: T0 });
  C.acquireCheckoutLock('sala', a.order_id, { device: 'A', idempotency_key: 'payx', at: T0 });
  C.markCheckoutPaid('sala', a.order_id, { device: 'A', order_id: a.order_id, bill_no: 'B001', at: T0 });
  O.markDraftPaid('sala', a.order_id, { at: T0 });
  assert.throws(
    () => O.applyCommand('sala', a.order_id, { command_id: nextCid(), expected_revision: 0, lease_token: a.lease_token, device: 'B', command: 'SET_NOTE', payload: { note: 'z' }, at: T0 }),
    (e) => e.code === 'ORDER_FINALIZED');
});

test('command retry cùng command_id → idempotent, KHÔNG áp 2 lần', () => {
  const a = O.createDraft('sala', { device: 'A', at: T0 });
  const cmd = { command_id: 'dup-1', expected_revision: 0, lease_token: a.lease_token, device: 'A', command: 'ADD_LINE', payload: { sku_id: 's9', unit_price: 500, qty: 2 }, at: T0 };
  const r1 = O.applyCommand('sala', a.order_id, cmd);
  const r2 = O.applyCommand('sala', a.order_id, cmd);
  assert.equal(r1.revision, 1);
  assert.equal(r2.revision, 1);
  assert.equal(r2.idempotent, true);
  // Chỉ 1 dòng, qty 2 (không nhân đôi thành 4)
  assert.equal(O.getCanonical('sala', a.order_id).snapshot.lines[0].qty, 2);
});

test('cross-branch: sửa order của branch khác → ORDER_NOT_FOUND', () => {
  const a = O.createDraft('sala', { device: 'A', at: T0 });
  assert.throws(
    () => O.applyCommand('br-other', a.order_id, { command_id: nextCid(), expected_revision: 0, lease_token: a.lease_token, device: 'A', command: 'SET_NOTE', payload: { note: 'q' }, at: T0 }),
    (e) => e.code === 'ORDER_NOT_FOUND');
  assert.throws(() => O.getCanonical('br-other', a.order_id), (e) => e.code === 'ORDER_NOT_FOUND');
});

test('crash holder: lease hết hạn (TTL) → thiết bị khác acquire được', () => {
  const a = O.createDraft('sala', { device: 'A', at: T0 });
  const b = L.acquireLease('sala', a.order_id, { device: 'B', at: T40 });
  assert.equal(b.granted, true, 'sau TTL, B giành được quyền sửa');
});

test('reconnect: getCanonical trả state server, không phụ thuộc local', () => {
  const a = O.createDraft('sala', { device: 'A', at: T0 });
  O.applyCommand('sala', a.order_id, { command_id: nextCid(), expected_revision: 0, lease_token: a.lease_token, device: 'A', command: 'SET_NOTE', payload: { note: 'canonical' }, at: T0 });
  const canon = O.getCanonical('sala', a.order_id);
  assert.equal(canon.revision, 1);
  assert.equal(canon.snapshot.note, 'canonical');
});
