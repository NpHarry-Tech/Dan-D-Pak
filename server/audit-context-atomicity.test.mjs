import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
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
const { enqueueAfterCommit } = await import('./db/transactionLifecycle.js');
const Inventory = await import('./services/inventory.js');
const Expenses = await import('./services/expenses.js');
const Purchase = await import('./services/purchase.js');
const CashDrawer = await import('./services/cashDrawer.js');
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

function archivedActions() {
  const root = join(temp, 'storage', 'permanent-storage', 'audit');
  if (!existsSync(root)) return [];
  const files = [];
  const walk = (dir) => {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, item.name);
      if (item.isDirectory()) walk(path);
      else if (item.name.endsWith('.ndjson')) files.push(path);
    }
  };
  walk(root);
  return files.flatMap((file) => readFileSync(file, 'utf8').trim().split('\n'))
    .filter(Boolean).map((line) => JSON.parse(line).action);
}

const ticks = async (count = 3) => {
  for (let i = 0; i < count; i++) await new Promise((resolve) => setImmediate(resolve));
};

function filesContaining(root, fragment) {
  if (!existsSync(root)) return [];
  const found = [];
  const walk = (dir) => {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, item.name);
      if (item.isDirectory()) walk(path);
      else if (item.name.includes(fragment) || readFileSync(path, 'utf8').includes(fragment)) found.push(path);
    }
  };
  walk(root);
  return found;
}

test('transactional audit waits for the actual commit and rollback stays silent across ticks', async () => {
  const events = [];
  setRealtimeEmitter((event, payload, branch) => events.push({ event, payload, branch }));
  db.exec('BEGIN IMMEDIATE');
  audit('test.held_then_rollback', { previous_state: 'draft', new_state: 'done' }, 'sala', 'owner');
  await ticks();
  assert.equal(events.length, 0);
  assert.equal(archivedActions().filter((action) => action === 'test.held_then_rollback').length, 0);
  db.exec('ROLLBACK');
  await ticks();
  assert.equal(events.length, 0);
  assert.equal(archivedActions().filter((action) => action === 'test.held_then_rollback').length, 0);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM audit_log WHERE action='test.held_then_rollback'`).get().n, 0);

  db.exec('BEGIN IMMEDIATE');
  audit('test.actual_commit', { previous_state: 'draft', new_state: 'done' }, 'sala', 'owner');
  await ticks();
  assert.equal(events.length, 0);
  db.exec('COMMIT');
  assert.equal(events.length, 1);
  assert.equal(events[0].event, 'activity:new');
  assert.equal(archivedActions().filter((action) => action === 'test.actual_commit').length, 1);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM audit_log WHERE action='test.actual_commit'`).get().n, 1);
  setRealtimeEmitter(null);
});

test('savepoint rollback discards only nested audit callbacks', () => {
  const actions = [];
  setRealtimeEmitter((_event, payload) => actions.push(payload.action));
  db.exec('BEGIN IMMEDIATE');
  audit('test.outer_kept', {}, 'sala', 'owner');
  db.exec('SAVEPOINT nested_audit');
  audit('test.inner_rolled_back', {}, 'sala', 'owner');
  db.exec('ROLLBACK TO nested_audit');
  db.exec('RELEASE nested_audit');
  db.exec('COMMIT');
  assert.deepEqual(actions, ['test.outer_kept']);
  assert.equal(archivedActions().filter((action) => action === 'test.outer_kept').length, 1);
  assert.equal(archivedActions().filter((action) => action === 'test.inner_rolled_back').length, 0);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM audit_log WHERE action='test.inner_rolled_back'`).get().n, 0);
  setRealtimeEmitter(null);
});

test('outer rollback discards audit released from inner savepoint', async () => {
  const actions = [];
  setRealtimeEmitter((_event, payload) => actions.push(payload.action));
  db.exec('BEGIN IMMEDIATE');
  db.exec('SAVEPOINT inner_release');
  audit('test.inner_released_outer_rollback', {}, 'sala', 'owner');
  db.exec('RELEASE inner_release');
  await ticks();
  assert.deepEqual(actions, []);
  db.exec('ROLLBACK');
  assert.deepEqual(actions, []);
  assert.equal(archivedActions().filter((action) => action === 'test.inner_released_outer_rollback').length, 0);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM audit_log WHERE action='test.inner_released_outer_rollback'`).get().n, 0);
  setRealtimeEmitter(null);
});

test('a post-commit callback failure cannot turn a committed API write into failure', () => {
  db.exec('BEGIN IMMEDIATE');
  audit('test.callback_failure_commit', {}, 'sala', 'owner');
  enqueueAfterCommit(() => { throw new Error('injected post-commit failure'); });
  assert.doesNotThrow(() => db.exec('COMMIT'));
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM audit_log WHERE action='test.callback_failure_commit'`).get().n, 1);
});

test('autocommit audit never archives or emits when its durable row fails', () => {
  const actions = [];
  setRealtimeEmitter((_event, payload) => actions.push(payload.action));
  db.exec(`CREATE TRIGGER fail_autocommit_audit BEFORE INSERT ON audit_log
    WHEN NEW.action='test.autocommit_insert_failure'
    BEGIN SELECT RAISE(ABORT, 'forced autocommit audit failure'); END;`);
  assert.equal(audit('test.autocommit_insert_failure', {}, 'sala', 'owner'), null);
  assert.deepEqual(actions, []);
  assert.equal(archivedActions().filter((action) => action === 'test.autocommit_insert_failure').length, 0);
  db.exec('DROP TRIGGER fail_autocommit_audit');
  setRealtimeEmitter(null);
});

test('cash-drawer archive follows the owning outer commit, never an event-loop tick', async () => {
  db.prepare(`INSERT INTO shifts
    (id,branch_id,shift_key,shift_label,status,opening_cash,opened_at)
    VALUES ('shift_cash_lifecycle','sala','cash-life','Cash lifecycle','open',500000,?)`).run(new Date().toISOString());
  db.exec('BEGIN IMMEDIATE');
  const rolledBack = CashDrawer.createEntry('expense', {
    amount: 10000, reason: 'rollback probe', counterparty: 'test vendor',
  }, { id: 'u1', username: 'owner' }, 'sala');
  await ticks();
  assert.equal(filesContaining(join(temp, 'storage', 'permanent-storage', 'cash-drawer'), rolledBack.id).length, 0);
  db.exec('ROLLBACK');
  assert.equal(filesContaining(join(temp, 'storage', 'permanent-storage', 'cash-drawer'), rolledBack.id).length, 0);

  db.exec('BEGIN IMMEDIATE');
  const committed = CashDrawer.createEntry('expense', {
    amount: 10000, reason: 'commit probe', counterparty: 'test vendor',
  }, { id: 'u1', username: 'owner' }, 'sala');
  db.exec('COMMIT');
  assert.ok(filesContaining(join(temp, 'storage', 'permanent-storage', 'cash-drawer'), committed.id).length >= 2);
  db.prepare(`UPDATE shifts SET status='closed',closed_at=? WHERE id='shift_cash_lifecycle'`).run(new Date().toISOString());
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
