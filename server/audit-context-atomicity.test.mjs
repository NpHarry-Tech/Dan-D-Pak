import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-audit-context-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const { db, migrate, audit } = await import('./db.js');
const { requestContext } = await import('./core/requestContext.js');
const { setRealtimeEmitter } = await import('./core/realtimeBus.js');
const Inventory = await import('./services/inventory.js');
const Expenses = await import('./services/expenses.js');
const Purchase = await import('./services/purchase.js');
migrate();

test('audit snapshots actor/device/branch/request and recursively redacts secrets', () => {
  requestContext.run({
    user: { id: 'u1', username: 'cashier', name: 'Thu ngân A', role: 'cashier' },
    deviceId: 'pos-01', deviceName: 'Quầy 1', correlationId: 'req-123', platform: 'windows',
  }, () => audit('test.context', {
    order_id: 'missing-order', reason: 'kiểm tra', manager_pin: '1234',
    connector: { access_token: 'secret-value', safe: 'kept' },
  }, 'sala', 'cashier'));
  const row = db.prepare(`SELECT * FROM audit_log WHERE action='test.context'`).get();
  const detail = JSON.parse(row.detail);
  assert.equal(detail.event_id, row.id);
  assert.equal(detail.request_id, 'req-123');
  assert.equal(detail.actor_id, 'u1');
  assert.equal(detail.actor_name, 'Thu ngân A');
  assert.equal(detail.actor_role, 'cashier');
  assert.equal(detail.device_id, 'pos-01');
  assert.equal(detail.branch_id, 'sala');
  assert.equal(detail.branch_name, 'Dan D Pak Sala');
  assert.equal(detail.manager_pin, '[REDACTED]');
  assert.equal(detail.connector.access_token, '[REDACTED]');
  assert.equal(detail.connector.safe, 'kept');
});

test('audit failure inside transaction rolls back mutation and emits no success row', () => {
  db.exec(`CREATE TABLE audit_atomic_probe (id TEXT PRIMARY KEY);`);
  db.exec(`CREATE TRIGGER fail_probe_audit BEFORE INSERT ON audit_log
    WHEN NEW.action='test.must_rollback' BEGIN SELECT RAISE(ABORT, 'forced audit failure'); END;`);
  let error;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`INSERT INTO audit_atomic_probe(id) VALUES ('mutation')`).run();
    audit('test.must_rollback', { previous_state: null, new_state: 'created', reason: 'probe' }, 'sala', 'owner');
    db.exec('COMMIT');
  } catch (caught) {
    error = caught;
    db.exec('ROLLBACK');
  }
  assert.match(error?.message || '', /forced audit failure/);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM audit_atomic_probe`).get().n, 0);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM audit_log WHERE action='test.must_rollback'`).get().n, 0);
});

test('transactional audit realtime is post-commit and rollback stays silent', async () => {
  const events = [];
  setRealtimeEmitter((event, payload, branch) => events.push({ event, payload, branch }));
  db.exec('BEGIN IMMEDIATE');
  audit('test.post_commit', { previous_state: 'draft', new_state: 'done' }, 'sala', 'owner');
  assert.equal(events.length, 0);
  db.exec('COMMIT');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(events.length, 1);
  assert.equal(events[0].event, 'activity:new');

  db.exec('BEGIN IMMEDIATE');
  audit('test.rolled_back', { previous_state: 'draft', new_state: 'done' }, 'sala', 'owner');
  db.exec('ROLLBACK');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(events.length, 1);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM audit_log WHERE action='test.rolled_back'`).get().n, 0);
  setRealtimeEmitter(null);
});

test('real stock and expense mutations roll back when their mandatory audit fails', () => {
  Inventory.createInventoryItem({ id: 'audit_stock', name: 'Hàng kiểm audit', unit: 'cái' }, 'sala');
  db.exec(`CREATE TRIGGER fail_business_audit BEFORE INSERT ON audit_log
    WHEN NEW.action IN ('inventory.receive','expense.create')
    BEGIN SELECT RAISE(ABORT, 'forced business audit failure'); END;`);

  assert.throws(
    () => Inventory.receiveStock('audit_stock', 5, 'sala'),
    /forced business audit failure/,
  );
  assert.equal(db.prepare(`SELECT stock FROM inventory_items WHERE id='audit_stock'`).get().stock, 0);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM stock_movements WHERE inventory_item_id='audit_stock'`).get().n, 0);

  assert.throws(
    () => Expenses.createExpense({ amount: 125000, source: 'direct', category_name: 'Kiểm thử audit' }, 'sala', { id: 'u1', name: 'Owner' }),
    /forced business audit failure/,
  );
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM expenses WHERE category_name='Kiểm thử audit'`).get().n, 0);
  db.exec('DROP TRIGGER fail_business_audit');
});

test('purchase header and lines roll back when mandatory audit fails', () => {
  db.exec(`CREATE TRIGGER fail_purchase_audit BEFORE INSERT ON audit_log
    WHEN NEW.action='purchase.create'
    BEGIN SELECT RAISE(ABORT, 'forced purchase audit failure'); END;`);
  assert.throws(() => Purchase.savePurchaseOrder({
    supplier_name_manual: 'NCC kiểm thử',
    lines: [{ item_type: 'adhoc', name: 'Dịch vụ kiểm thử', unit: 'lần', qty: 1, unit_cost: 50000 }],
  }, 'sala', { id: 'u1', name: 'Owner' }), /forced purchase audit failure/);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM purchase_orders WHERE supplier_name='NCC kiểm thử'`).get().n, 0);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM purchase_order_lines`).get().n, 0);
  db.exec('DROP TRIGGER fail_purchase_audit');
});
