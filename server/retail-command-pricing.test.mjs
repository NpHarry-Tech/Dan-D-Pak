// §3 SERVER-AUTHORITATIVE PRICING trong canonical command: client KHÔNG quyết
// giá; server áp giá catalogue + giảm giá qua ENGINE CHUNG (priceCart). Không
// plain-sum theo unit_price client gửi.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'ddp-cmdprice-'));
process.env.SQLITE_PATH = join(tmp, 'store.db');
process.env.STORAGE_PATH = join(tmp, 'storage');
process.env.DISABLE_DEMO_SEED = 'true';

const { migrate } = await import('./db.js');
migrate();
const Inv = await import('./services/inventory.js');
Inv.createSku({ id: 's1', name: 'Hạt điều', barcode: 'B1', category: 'X', price: 1000, stock: 100 }, 'sala');
const O = await import('./services/retailOrderCommands.js');

let cid = 0; const nx = () => `c${++cid}`;

test('ADD_LINE: server BỎ QUA unit_price client, áp GIÁ CATALOGUE', () => {
  const d = O.createDraft('sala', { device: 'A' });
  const r = O.applyCommand('sala', d.order_id, {
    command_id: nx(), expected_revision: 0, lease_token: d.lease_token, device: 'A',
    command: 'ADD_LINE', payload: { sku_id: 's1', qty: 2, unit_price: 999999 }, // client nói dối giá
  });
  assert.equal(r.snapshot.pricing.subtotal, 2000, '2 × giá server 1000');
  assert.equal(r.snapshot.pricing.total, 2000);
  assert.equal(r.snapshot.priced_lines[0].unit_price, 1000, 'giá server, không phải 999999');
  assert.equal(r.snapshot.priced_lines[0].name, 'Hạt điều', 'tên server-resolved');
});

test('priced_lines MANG line_id khớp structural (client render→CHANGE_QTY đúng dòng)', () => {
  const d = O.createDraft('sala', { device: 'A' });
  const r = O.applyCommand('sala', d.order_id, {
    command_id: nx(), expected_revision: 0, lease_token: d.lease_token, device: 'A',
    command: 'ADD_LINE', payload: { sku_id: 's1', qty: 1 },
  });
  const structuralId = r.snapshot.lines[0].line_id;
  assert.ok(structuralId, 'structural line có line_id');
  assert.equal(r.snapshot.priced_lines[0].line_id, structuralId,
    'priced_line phải mang cùng line_id để client tham chiếu khi CHANGE_QTY/REMOVE');
});

test('CHANGE_QTY → pricing canonical cập nhật', () => {
  const d = O.createDraft('sala', { device: 'A' });
  const r1 = O.applyCommand('sala', d.order_id, { command_id: nx(), expected_revision: 0, lease_token: d.lease_token, device: 'A', command: 'ADD_LINE', payload: { sku_id: 's1', qty: 2 } });
  const line = r1.snapshot.lines[0].line_id;
  const r2 = O.applyCommand('sala', d.order_id, { command_id: nx(), expected_revision: r1.revision, lease_token: d.lease_token, device: 'A', command: 'CHANGE_QTY', payload: { line_id: line, qty: 3 } });
  assert.equal(r2.snapshot.pricing.total, 3000);
});

test('SET_MANUAL_DISCOUNT → engine trừ đúng', () => {
  const d = O.createDraft('sala', { device: 'A' });
  const r1 = O.applyCommand('sala', d.order_id, { command_id: nx(), expected_revision: 0, lease_token: d.lease_token, device: 'A', command: 'ADD_LINE', payload: { sku_id: 's1', qty: 3 } });
  const r2 = O.applyCommand('sala', d.order_id, { command_id: nx(), expected_revision: r1.revision, lease_token: d.lease_token, device: 'A', command: 'SET_MANUAL_DISCOUNT', payload: { manual_discount: 500 } });
  assert.equal(r2.snapshot.pricing.total, 2500, '3000 - 500 giảm tay');
  assert.equal(r2.snapshot.pricing.discount >= 500, true);
});

test('ADD_LINE sku KHÔNG tồn tại → lỗi rõ (không plain-sum lặng lẽ)', () => {
  const d = O.createDraft('sala', { device: 'A' });
  assert.throws(
    () => O.applyCommand('sala', d.order_id, { command_id: nx(), expected_revision: 0, lease_token: d.lease_token, device: 'A', command: 'ADD_LINE', payload: { sku_id: 'nope', qty: 1 } }),
    (e) => /SKU không tồn tại/i.test(e.message));
});
