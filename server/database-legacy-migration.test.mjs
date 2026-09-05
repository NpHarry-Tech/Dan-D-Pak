import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dandpak-legacy-migrate-'));
process.env.SQLITE_PATH = path.join(root, 'main.db');
process.env.STORAGE_PATH = path.join(root, 'storage');
const { db, migrate } = await import('./db.js');
const { CRITICAL_RELATIONS, scanCriticalOrphans } = await import('./db/integrity.js');

test.after(() => {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
});

test('logical integrity gate detects money-path orphans that PRAGMA cannot see', () => {
  migrate();
  const clean = scanCriticalOrphans(db);
  assert.equal(clean.ok, true);
  assert.equal(clean.checkedRelations, CRITICAL_RELATIONS.length);
  assert.equal(clean.checkedRelations, 31);
  assert.throws(() => db.prepare(`INSERT INTO order_items
    (id,order_id,sku_id,name,unit_price,qty,status,created_at)
    VALUES(?,?,?,?,?,?,?,?)`)
    .run('oi_blocked_gate', 'missing_order', 'sku_x', 'Blocked', 1000, 1, 'pending', new Date().toISOString()),
  /integrity:order_items\.order_id/);

  const now = new Date().toISOString();
  db.prepare(`INSERT INTO orders(id,branch_id,channel,status,total,created_at)
    VALUES(?,?,?,?,?,?)`).run('order_parent_guard', 'sala', 'retail', 'pending', 1000, now);
  db.prepare(`INSERT INTO order_items
    (id,order_id,sku_id,name,unit_price,qty,status,created_at)
    VALUES(?,?,?,?,?,?,?,?)`)
    .run('oi_parent_guard', 'order_parent_guard', 'sku_x', 'Protected', 1000, 1, 'pending', now);
  assert.throws(
    () => db.prepare(`DELETE FROM orders WHERE id=?`).run('order_parent_guard'),
    /integrity:order_items\.order_id->orders\.id:parent-delete/,
  );
  assert.throws(
    () => db.prepare(`UPDATE orders SET id=? WHERE id=?`).run('order_parent_guard_2', 'order_parent_guard'),
    /integrity:order_items\.order_id->orders\.id:parent-update/,
  );
  db.prepare(`DELETE FROM order_items WHERE id=?`).run('oi_parent_guard');
  db.prepare(`DELETE FROM orders WHERE id=?`).run('order_parent_guard');

  assert.throws(
    () => db.prepare(`INSERT INTO inventory_document_lines
      (id,document_id,item_type,item_id,qty) VALUES(?,?,?,?,?)`)
      .run('idl_blocked_gate', 'missing_document', 'sku', 'sku_x', 1),
    /integrity:inventory_document_lines\.document_id/,
  );
  assert.throws(
    () => db.prepare(`INSERT INTO purchase_order_lines
      (id,po_id,item_type,item_id,qty) VALUES(?,?,?,?,?)`)
      .run('pol_blocked_gate', 'missing_po', 'sku', 'sku_x', 1),
    /integrity:purchase_order_lines\.po_id/,
  );
  db.prepare(`INSERT INTO cash_drawer_entries
    (id,branch_id,kind,occurred_at,amount,created_at) VALUES(?,?,?,?,?,?)`)
    .run('expense_parent_guard', 'sala', 'expense', now, 1000, now);
  assert.throws(
    () => db.prepare(`INSERT INTO cash_drawer_reimbursement_allocations
      (id,branch_id,reimbursement_id,expense_id,amount,created_at)
      VALUES(?,?,?,?,?,?)`)
      .run('alloc_blocked_gate', 'sala', 'missing_reimbursement', 'expense_parent_guard', 1000, now),
    /integrity:cash_drawer_reimbursement_allocations\.reimbursement_id/,
  );
  db.prepare(`DELETE FROM cash_drawer_entries WHERE id=?`).run('expense_parent_guard');

  db.prepare(`INSERT INTO warehouses(id,branch_id,code,name,type)
    VALUES(?,?,?,?,?)`).run('wh_parent_guard', 'sala', 'GUARD', 'Guard warehouse', 'retail');
  db.prepare(`INSERT INTO skus(id,branch_id,name,price,warehouse_id)
    VALUES(?,?,?,?,?)`).run('sku_parent_guard', 'sala', 'Guard SKU', 1000, 'wh_parent_guard');
  assert.throws(
    () => db.prepare(`DELETE FROM warehouses WHERE id=?`).run('wh_parent_guard'),
    /integrity:skus\.warehouse_id->warehouses\.id:parent-delete/,
  );
  assert.throws(
    () => db.prepare(`UPDATE warehouses SET id=? WHERE id=?`)
      .run('wh_parent_guard_2', 'wh_parent_guard'),
    /integrity:skus\.warehouse_id->warehouses\.id:parent-update/,
  );
  db.prepare(`DELETE FROM skus WHERE id=?`).run('sku_parent_guard');
  db.prepare(`DELETE FROM warehouses WHERE id=?`).run('wh_parent_guard');

  // Giả lập orphan lịch sử từ schema trước guard để chứng minh scanner vẫn thấy.
  db.exec(`DROP TRIGGER trg_integrity_ins_order_items_order_id`);
  db.prepare(`INSERT INTO order_items
    (id,order_id,sku_id,name,unit_price,qty,status,created_at)
    VALUES(?,?,?,?,?,?,?,?)`)
    .run('oi_orphan_gate', 'missing_order', 'sku_x', 'Orphan', 1000, 1, 'pending', new Date().toISOString());
  const broken = scanCriticalOrphans(db);
  assert.equal(broken.ok, false);
  assert.ok(broken.findings.some((item) => item.child === 'order_items' && item.count === 1));
  db.prepare(`DELETE FROM order_items WHERE id='oi_orphan_gate'`).run();
  migrate();
});

test('legacy print_jobs without idempotency_key upgrades before creating its index', () => {
  const legacy = new DatabaseSync(path.join(root, 'legacy.db'));
  try {
    legacy.exec(`CREATE TABLE print_jobs (
      id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, printer TEXT NOT NULL,
      type TEXT NOT NULL, title TEXT, payload_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued', created_at TEXT NOT NULL, printed_at TEXT
    );`);
    assert.doesNotThrow(() => migrate(legacy));
    assert.ok(legacy.prepare(`PRAGMA table_info(print_jobs)`).all()
      .some((column) => column.name === 'idempotency_key'));
    assert.equal(legacy.prepare(`PRAGMA user_version`).get().user_version, 8);
    assert.equal(legacy.prepare(`SELECT value FROM schema_meta WHERE key='canonical_version'`).get().value, '8');
    assert.ok(legacy.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_print_jobs_idempotency'`).get());
  } finally {
    legacy.close();
  }
});

test('migration is atomic when a late schema step fails', () => {
  const broken = new DatabaseSync(path.join(root, 'migration-fault.db'));
  try {
    broken.exec(`CREATE TABLE schema_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL CHECK(value='reject-canonical-version'),
      updated_at TEXT NOT NULL
    );`);
    assert.throws(() => migrate(broken), /CHECK constraint failed/);
    assert.equal(
      broken.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='branches'").get().n,
      0,
      'early DDL must roll back when the final schema marker fails',
    );
    assert.equal(broken.prepare('PRAGMA user_version').get().user_version, 0);
    assert.equal(broken.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  } finally {
    broken.close();
  }
});
