import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-hot-plan-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = process.env.DATA_ENCRYPTION_KEY
  || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const { db, migrate } = await import('./db.js');
migrate();

const planText = (sql, ...params) => db.prepare(`EXPLAIN QUERY PLAN ${sql}`)
  .all(...params).map(row => row.detail).join('\n');

test('history, invoice and shift hot queries use their composite indexes', () => {
  const history = planText(`SELECT id FROM orders
    WHERE branch_id=? AND status IN ('paid','void')
      AND COALESCE(paid_at,created_at)>=?
    ORDER BY COALESCE(paid_at,created_at) DESC LIMIT 200`,
  'sala', '2025-01-01T00:00:00.000Z');
  assert.match(history, /idx_orders_branch_history/);
  assert.doesNotMatch(history, /SCAN orders/);

  const invoice = planText(`SELECT o.id,e.id FROM orders o
    LEFT JOIN e_invoices e ON e.id=(
      SELECT x.id FROM e_invoices x
      WHERE x.branch_id=o.branch_id AND x.order_id=o.id
      ORDER BY CASE WHEN x.idempotency_key='einv:'||x.branch_id||':'||x.order_id
        THEN 0 ELSE 1 END,x.created_at DESC LIMIT 1)
    WHERE o.branch_id=? AND o.status='paid'`, 'sala');
  assert.match(invoice, /idx_einv_branch_order_created/);
  assert.doesNotMatch(invoice, /MATERIALIZE/);

  const shift = planText(`SELECT order_id FROM payments
    WHERE shift_id=? ORDER BY created_at DESC`, 'shift_plan');
  assert.match(shift, /idx_payments_shift_created/);
});

test('one history page batches enrichments instead of querying per bill', () => {
  const source = readFileSync(new URL('./services/history.js', import.meta.url), 'utf8');
  const start = source.indexOf('export function listOrderHistory');
  const end = source.indexOf('export function billShiftStatus');
  const body = source.slice(start, end);

  // 1 base page query + 5 page-wide enrichment queries:
  // payment methods, item count, shift status, return amount, return qty.
  assert.equal(
    (body.match(/db\.prepare\(/g) || []).length,
    6,
    'one base query plus five page-wide enrichment queries',
  );

  assert.match(body, /p\.order_id IN \(\$\{slots\}\)/);
  assert.match(body, /order_id IN \(\$\{slots\}\)/);
  assert.match(body, /original_order_id IN \(\$\{slots\}\)/);

  // Sau khi đã batch xong, projection từng bill tuyệt đối không query DB.
  const projectionStart = body.indexOf('.map(o =>');
  assert.ok(projectionStart >= 0, 'history projection must exist');

  assert.doesNotMatch(
    body.slice(projectionStart),
    /db\.prepare\(/,
    'history projection must not execute per-bill SQL',
  );

  assert.doesNotMatch(body, /methodStmt|itemCountStmt|shiftStmt/);
});
