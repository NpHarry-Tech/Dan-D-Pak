import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-source-snapshot-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const { db, migrate } = await import('./db.js');
const Online = await import('./services/online.js');
migrate();

function insertOrder(id, branch = 'sala') {
  const timestamp = new Date().toISOString();
  db.prepare(`INSERT INTO orders (id,branch_id,channel,status,subtotal,discount,total,created_at,online_channel,online_ref,customer_json)
    VALUES (?,?,'online','open',100,0,100,?,'tiktokshop',?,'{}')`).run(id, branch, timestamp, `EXT-${id}`);
  return timestamp;
}

test('external order snapshots platform, shop, connection and exposes source filters', () => {
  const timestamp = insertOrder('source-order');
  db.prepare(`INSERT INTO external_orders
    (id,provider,shop_domain,external_shop_id,shop_name,connection_id,external_order_id,internal_order_id,external_order_code,sync_status,raw_payload,created_at,updated_at)
    VALUES ('eo-source','tiktokshop','SHOP-123','SHOP-123','Dan D Pak Official','mpconn-1','EXT-1','source-order','TT-001','success','{}',?,?)`)
    .run(timestamp, timestamp);
  const operation = Online.getOnlineOperation('source-order', 'sala');
  assert.equal(operation.provider, 'tiktokshop');
  assert.equal(operation.shop_id, 'SHOP-123');
  assert.equal(operation.shop_name, 'Dan D Pak Official');
  assert.equal(operation.connection_id, 'mpconn-1');
  assert.equal(Online.listOnlineOperations('sala', { shop_domain: 'shop-123' }).total, 1);
  assert.deepEqual(Online.onlineOrderSources('sala').sources, [{
    provider: 'tiktokshop', shop_id: 'SHOP-123', shop_name: 'Dan D Pak Official',
  }]);
});

test('legacy Haravan order uses controlled domain fallback and stays branch isolated', () => {
  const timestamp = insertOrder('legacy-order');
  db.prepare(`INSERT INTO external_orders
    (id,provider,shop_domain,external_order_id,internal_order_id,external_order_code,sync_status,raw_payload,created_at,updated_at)
    VALUES ('eo-legacy','haravan','bcmarketing.vn','HV-1','legacy-order','BCM-1','success','{}',?,?)`).run(timestamp, timestamp);
  const operation = Online.getOnlineOperation('legacy-order', 'sala');
  assert.equal(operation.shop_id, 'bcmarketing.vn');
  assert.equal(operation.shop_name, 'bcmarketing.vn');
  assert.equal(Online.getOnlineOperation('legacy-order', 'other-branch'), null);
});

test.after(() => {
  db.close();
  rmSync(temp, { recursive: true, force: true });
});
