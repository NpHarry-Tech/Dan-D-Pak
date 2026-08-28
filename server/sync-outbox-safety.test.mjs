import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dandpak-sync-outbox-'));
process.env.SQLITE_PATH = path.join(temp, 'store.db');

const { db, migrate } = await import('./db.js');
const Sync = await import('./services/sync.js');
const { receiveEdgeBatch, edgeSignature, payloadHash } = await import('./services/edgeSync.js');
const Pay = await import('./services/payments.js');
const { buildCatalogueSnapshot, applyCatalogueSnapshot } = await import('./services/catalogueSync.js');
migrate();

function signedReceive(body, timestamp = String(Date.now())) {
  return receiveEdgeBatch({
    timestamp,
    signature: edgeSignature(process.env.EDGE_SYNC_SHARED_SECRET, timestamp, body),
  }, body);
}

test.after(() => {
  db.close();
  fs.rmSync(temp, { recursive: true, force: true });
});

test('unconfigured sync never acknowledges or deletes a pending local change', async () => {
  db.prepare(`INSERT INTO sync_queue(id,branch_id,kind,ref,status,created_at)
              VALUES(?,?,?,?,?,?)`)
    .run('event-1', 'sala', 'orders', 'order-1', 'pending', new Date().toISOString());

  assert.equal(await Sync.syncBatch('sala'), 0);
  const row = db.prepare(`SELECT status,synced_at FROM sync_queue WHERE id='event-1'`).get();
  assert.equal(row.status, 'pending');
  assert.equal(row.synced_at, null);

  const status = Sync.status('sala');
  assert.equal(status.syncAvailable, false);
  assert.equal(status.syncMode, 'local-outbox-only');
  assert.equal(status.pending, 0);
  assert.equal(status.localOnlyMarkers, 1);
  assert.equal(status.lastSyncAt, null);
});

test('manual sync fails honestly when no acknowledged transport exists', async () => {
  await assert.rejects(
    Sync.syncNow('sala'),
    (error) => error.code === 'SYNC_TRANSPORT_NOT_CONFIGURED',
  );
  assert.equal(db.prepare(`SELECT status FROM sync_queue WHERE id='event-1'`).get().status, 'pending');
});

test('a cloud-only server does not accumulate edge payloads without a hub identity', () => {
  db.prepare(`INSERT INTO orders(id,branch_id,channel,status,total,created_at)
              VALUES('cloud-order-1','sala','retail','open',1000,?)`)
    .run(new Date().toISOString());
  assert.equal(db.prepare(
    `SELECT COUNT(*) n FROM sync_queue WHERE kind='orders' AND ref='cloud-order-1'`,
  ).get().n, 0);
});

test('critical outbox event has stable hub sequence and refreshes its full payload', () => {
  db.prepare(`UPDATE sync_hub_state SET hub_id='test-local-edge' WHERE id=1`).run();
  db.prepare(`INSERT INTO orders(id,branch_id,channel,status,total,created_at)
              VALUES('order-edge-1','sala','retail','open',1000,?)`)
    .run(new Date().toISOString());
  const first = db.prepare(
    `SELECT id,hub_id,sequence,operation,payload_json FROM sync_queue
     WHERE kind='orders' AND ref='order-edge-1' AND status='pending'`,
  ).get();
  assert.ok(first.id);
  assert.equal(first.hub_id, 'test-local-edge');
  assert.ok(first.sequence > 0);
  assert.equal(first.operation, 'upsert');
  assert.equal(JSON.parse(first.payload_json).total, 1000);

  db.prepare(`UPDATE orders SET total=2500 WHERE id='order-edge-1'`).run();
  const refreshed = db.prepare(
    `SELECT id,hub_id,sequence,payload_json FROM sync_queue
     WHERE kind='orders' AND ref='order-edge-1' AND status='pending'`,
  ).get();
  assert.equal(refreshed.id, first.id);
  assert.equal(refreshed.hub_id, first.hub_id);
  assert.equal(refreshed.sequence, first.sequence);
  assert.equal(JSON.parse(refreshed.payload_json).total, 2500);
  db.prepare(`UPDATE sync_queue SET status='done',synced_at=? WHERE id=?`)
    .run(new Date().toISOString(), first.id);
});

test('local audit and print tables never create payload-less orphan outbox rows', () => {
  const before = db.prepare(`SELECT COUNT(*) n FROM sync_queue`).get().n;
  db.prepare(`INSERT INTO audit_log(id,branch_id,action,detail,actor,created_at)
              VALUES('audit-no-outbox','sala','test.audit','{}','test',?)`)
    .run(new Date().toISOString());
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM sync_queue`).get().n, before);
});

test('receiver applies a financial chain once and ACKs exact retries idempotently', () => {
  process.env.EDGE_SYNC_SHARED_SECRET = 'test-edge-secret-that-is-at-least-32-characters';
  process.env.EDGE_SYNC_ALLOWED_HUBS_JSON = JSON.stringify({ 'store-sala-edge-1': ['sala'] });
  const created = new Date().toISOString();
  const body = {
    hubId: 'store-sala-edge-1',
    events: [
      { eventId: 'event:remote:500', sequence: 500, kind: 'orders', ref: 'remote-order-1', branchId: 'sala', operation: 'upsert', payload: { id: 'remote-order-1', branch_id: 'sala', channel: 'retail', status: 'paid', total: 50000, created_at: created } },
      { eventId: 'event:remote:501', sequence: 501, kind: 'order_items', ref: 'remote-item-1', branchId: 'sala', operation: 'upsert', payload: { id: 'remote-item-1', order_id: 'remote-order-1', name: 'Offline item', qty: 1, unit_price: 50000, created_at: created } },
      { eventId: 'event:remote:502', sequence: 502, kind: 'payments', ref: 'remote-payment-1', branchId: 'sala', operation: 'upsert', payload: { id: 'remote-payment-1', order_id: 'remote-order-1', total: 50000, created_at: created } },
      { eventId: 'event:remote:503', sequence: 503, kind: 'payment_lines', ref: 'remote-line-1', branchId: 'sala', operation: 'upsert', payload: { id: 'remote-line-1', payment_id: 'remote-payment-1', method: 'cash', amount: 50000 } },
      { eventId: 'event:remote:504', sequence: 504, kind: 'sale_snapshots', ref: 'remote-snapshot-1', branchId: 'sala', operation: 'upsert', payload: { id: 'remote-snapshot-1', order_id: 'remote-order-1', payment_id: 'remote-payment-1', branch_id: 'sala', pricing_hash: 'hash-1', snapshot_json: '{}', paid_at: created, business_date: created.slice(0, 10), created_at: created } },
    ],
  };

  const first = signedReceive(body);
  assert.equal(first.acknowledged.length, 5);
  assert.equal(first.acknowledged.every((ack) => ack.duplicate === false), true);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM sync_inbox WHERE hub_id=?`).get(body.hubId).n, 5);
  assert.equal(db.prepare(`SELECT total FROM payments WHERE id='remote-payment-1'`).get().total, 50000);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM sync_queue WHERE ref LIKE 'remote-%'`).get().n, 0);

  const retry = signedReceive(body);
  assert.equal(retry.acknowledged.every((ack) => ack.duplicate === true), true);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM payments WHERE id='remote-payment-1'`).get().n, 1);
});

test('receiver rejects event-ID reuse and rolls the whole transaction back', () => {
  const before = db.prepare(`SELECT total FROM orders WHERE id='remote-order-1'`).get().total;
  assert.throws(() => signedReceive({
    hubId: 'store-sala-edge-1',
    events: [{
      eventId: 'event:remote:500', sequence: 500, kind: 'orders', ref: 'remote-order-1',
      branchId: 'sala', operation: 'upsert',
      payload: { id: 'remote-order-1', branch_id: 'sala', total: 999999 },
    }],
  }), (error) => error.code === 'EDGE_SYNC_EVENT_REUSE');
  assert.equal(db.prepare(`SELECT total FROM orders WHERE id='remote-order-1'`).get().total, before);
  assert.equal(db.prepare(`SELECT remote_apply FROM sync_apply_state WHERE id=1`).get().remote_apply, 0);
});

test('receiver rejects a validly signed hub outside its authorized branches', () => {
  assert.throws(() => signedReceive({
    hubId: 'store-sala-edge-1',
    events: [{
      eventId: 'event:remote:unauthorized', sequence: 600, kind: 'orders', ref: 'foreign-order-1',
      branchId: 'foreign', operation: 'upsert',
      payload: { id: 'foreign-order-1', branch_id: 'foreign', channel: 'retail', status: 'open', total: 1, created_at: new Date().toISOString() },
    }],
  }), (error) => error.code === 'EDGE_SYNC_BRANCH_FORBIDDEN');
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM orders WHERE id='foreign-order-1'`).get().n, 0);
});

test('receiver rejects expired and tampered HMAC requests', () => {
  const body = { hubId: 'store-sala-edge-1', events: [] };
  assert.throws(() => signedReceive(body, String(Date.now() - 10 * 60 * 1000)),
    (error) => error.code === 'EDGE_SYNC_EXPIRED');
  assert.throws(() => receiveEdgeBatch({ timestamp: String(Date.now()), signature: '0'.repeat(64) }, body),
    (error) => error.code === 'EDGE_SYNC_UNAUTHORIZED');
});

test('offline edge blocks unverifiable bank payment but accepts cash', () => {
  const created = new Date().toISOString();
  db.prepare(`INSERT INTO shifts(id,branch_id,user_id,user_name,status,opened_at)
              VALUES('offline-shift','sala','u1','Cashier','open',?)`).run(created);
  db.prepare(`INSERT INTO orders(id,branch_id,channel,status,created_at)
              VALUES('offline-order','sala','retail','open',?)`).run(created);
  db.prepare(`INSERT INTO order_items(id,order_id,name,qty,unit_price,status,created_at)
              VALUES('offline-item','offline-order','Cash item',1,40000,'new',?)`).run(created);
  Sync.setOffline(true, 'sala');
  try {
    assert.throws(() => Pay.payOrder('offline-order', [{ method: 'bank', amount: 40000 }], {
      idempotency_key: 'offline-bank-attempt', cashier: 'Cashier',
    }, 'sala'), (error) => error.code === 'OFFLINE_PAYMENT_UNVERIFIABLE');
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM payments WHERE order_id='offline-order'`).get().n, 0);

    const receipt = Pay.payOrder('offline-order', [{ method: 'cash', amount: 40000 }], {
      idempotency_key: 'offline-cash-success', cashier: 'Cashier',
    }, 'sala');
    assert.equal(receipt.fully_settled, true);
    assert.equal(db.prepare(`SELECT status FROM orders WHERE id='offline-order'`).get().status, 'paid');

    db.prepare(`INSERT INTO orders(id,branch_id,channel,status,created_at)
                VALUES('offline-card-order','sala','retail','open',?)`).run(created);
    db.prepare(`INSERT INTO order_items(id,order_id,name,qty,unit_price,status,created_at)
                VALUES('offline-card-item','offline-card-order','Card item',1,30000,'new',?)`).run(created);
    const cardReceipt = Pay.payOrder('offline-card-order', [{
      method: 'visa', amount: 30000,
      card: { mode: 'auto', txnId: 'TX-1', approval: 'APP-1', terminal: 'POS-1' },
    }], { idempotency_key: 'offline-card-evidenced', cashier: 'Cashier' }, 'sala');
    assert.equal(cardReceipt.fully_settled, true);
  } finally {
    Sync.setOffline(false, 'sala');
  }
});

test('sender marks done only for a durable ACK of the exact payload sent', async () => {
  process.env.EDGE_SYNC_UPSTREAM_URL = 'https://hub.example.test';
  db.prepare(`UPDATE sync_queue SET status='done',synced_at=?
              WHERE status='pending' AND payload_json IS NOT NULL`).run(new Date().toISOString());
  db.prepare(`INSERT INTO orders(id,branch_id,channel,status,total,created_at)
              VALUES('sender-order-1','sala','retail','open',1000,?)`).run(new Date().toISOString());

  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    const request = JSON.parse(options.body);
    if (calls === 1) {
      // A cashier changes the same order while the first payload is in flight.
      db.prepare(`UPDATE orders SET total=2000 WHERE id='sender-order-1'`).run();
    }
    return new Response(JSON.stringify({
      ok: true,
      acknowledged: request.events.map((event) => ({ eventId: event.eventId, sequence: event.sequence })),
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    assert.equal((await Sync.syncBatch('sala')), 0);
    let queued = db.prepare(`SELECT status,payload_json FROM sync_queue WHERE ref='sender-order-1'`).get();
    assert.equal(queued.status, 'pending');
    assert.equal(JSON.parse(queued.payload_json).total, 2000);

    assert.equal((await Sync.syncBatch('sala')), 1);
    queued = db.prepare(`SELECT status,synced_at FROM sync_queue WHERE ref='sender-order-1'`).get();
    assert.equal(queued.status, 'done');
    assert.ok(queued.synced_at);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.EDGE_SYNC_UPSTREAM_URL;
  }
});

test('catalogue snapshot restores sell-side data, excludes secrets, and is idempotent', () => {
  const warehouse = db.prepare(`SELECT id FROM warehouses WHERE branch_id='sala' AND type='retail' LIMIT 1`).get();
  db.prepare(`INSERT INTO categories(id,branch_id,name,sort) VALUES('edge-cat','sala','Edge category',1)`).run();
  db.prepare(`INSERT INTO menu_items(id,branch_id,category_id,name,price)
              VALUES('edge-menu','sala','edge-cat','Edge menu',55000)`).run();
  db.prepare(`INSERT INTO skus(id,branch_id,name,price,stock,warehouse_id)
              VALUES('edge-sku','sala','Edge SKU',25000,7,?)`).run(warehouse.id);
  db.prepare(`INSERT OR REPLACE INTO app_settings(branch_id,key,value,updated_at)
              VALUES('sala','retail_config','{"enabled":true}',?)`).run(new Date().toISOString());
  db.prepare(`INSERT OR REPLACE INTO app_settings(branch_id,key,value,updated_at)
              VALUES('sala','integrations_config','{"apiKey":"must-not-leave-vps"}',?)`).run(new Date().toISOString());
  db.prepare(`UPDATE sync_queue SET status='done',synced_at=?
              WHERE status='pending' AND payload_json IS NOT NULL`).run(new Date().toISOString());

  const snapshot = buildCatalogueSnapshot('sala');
  assert.equal(snapshot.settings.some((row) => row.key === 'integrations_config'), false);
  assert.equal(JSON.stringify(snapshot).includes('must-not-leave-vps'), false);

  db.prepare(`UPDATE sync_apply_state SET remote_apply=1 WHERE id=1`).run();
  db.prepare(`UPDATE menu_items SET price=1 WHERE id='edge-menu'`).run();
  db.prepare(`UPDATE skus SET stock=0 WHERE id='edge-sku'`).run();
  db.prepare(`UPDATE app_settings SET value='{"enabled":false}' WHERE branch_id='sala' AND key='retail_config'`).run();
  db.prepare(`UPDATE sync_apply_state SET remote_apply=0 WHERE id=1`).run();

  const applied = applyCatalogueSnapshot(snapshot, 'sala');
  assert.equal(applied.applied, true);
  assert.equal(db.prepare(`SELECT price FROM menu_items WHERE id='edge-menu'`).get().price, 55000);
  assert.equal(db.prepare(`SELECT stock FROM skus WHERE id='edge-sku'`).get().stock, 7);
  assert.equal(JSON.parse(db.prepare(
    `SELECT value FROM app_settings WHERE branch_id='sala' AND key='retail_config'`,
  ).get().value).enabled, true);
  assert.equal(JSON.parse(db.prepare(
    `SELECT value FROM app_settings WHERE branch_id='sala' AND key='integrations_config'`,
  ).get().value).apiKey, 'must-not-leave-vps');
  assert.equal(applyCatalogueSnapshot(snapshot, 'sala').applied, false);

  const tampered = structuredClone(snapshot);
  tampered.tables.skus[0].stock = 999;
  assert.throws(() => applyCatalogueSnapshot(tampered, 'sala'),
    (error) => error.code === 'CATALOGUE_HASH_MISMATCH');

  db.prepare(`INSERT INTO customers(id,branch_id,name,created_at)
              VALUES('edge-pending-customer','sala','Pending customer',?)`).run(new Date().toISOString());
  assert.throws(() => applyCatalogueSnapshot(snapshot, 'sala'),
    (error) => error.code === 'CATALOGUE_EDGE_PENDING');
  db.prepare(`UPDATE sync_queue SET status='done',synced_at=? WHERE ref='edge-pending-customer'`)
    .run(new Date().toISOString());

  const stale = structuredClone(snapshot);
  stale.tables.skus[0].price += 1;
  stale.generatedAt = new Date(Date.parse(snapshot.generatedAt) - 60_000).toISOString();
  const { hash: _oldHash, generatedAt: _oldGenerated, ...staleCore } = stale;
  stale.hash = payloadHash(staleCore);
  assert.throws(() => applyCatalogueSnapshot(stale, 'sala'),
    (error) => error.code === 'CATALOGUE_STALE');
});
