import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'haravan-'));
process.env.SQLITE_PATH = join(tmp, 'test.db');
process.env.HARAVAN_WEBHOOK_SECRET = 'test_secret';
process.env.HARAVAN_DEFAULT_BRANCH_ID = 'ONLINE';
process.env.HARAVAN_ENABLED = 'true';

const { db, migrate } = await import('../db.js');
const Haravan = await import('./haravanConnector.js');
const Settings = await import('./settings.js');
migrate(db);

try {
  const order = {
    id: 123,
    order_number: 'HVN123',
    total_price: 30000,
    customer: { id: 7, first_name: 'An', last_name: 'Nguyen', phone: '0909' },
    line_items: [
      { product_id: 11, variant_id: 22, sku: 'SKU-1', name: 'Ao', quantity: 2, price: 10000 },
      { product_id: 11, variant_id: 23, sku: 'SKU-2', name: 'Quan', quantity: 1, price: 10000 },
    ],
  };
  const body = Buffer.from(JSON.stringify(order));
  const signature = crypto.createHmac('sha256', process.env.HARAVAN_WEBHOOK_SECRET).update(body).digest('base64');

  assert.equal(Haravan.verifyHaravanWebhook(body, signature, process.env.HARAVAN_WEBHOOK_SECRET), true);
  assert.equal(Haravan.verifyHaravanWebhook(body, 'bad', process.env.HARAVAN_WEBHOOK_SECRET), false);

  Haravan.handleHaravanWebhook(body, {
    'x-haravan-hmacsha256': signature,
    'x-haravan-topic': 'orders/create',
    'x-haravan-shop-domain': 'shop.myharavan.com',
  });
  Haravan.processHaravanQueue();

  assert.equal(db.prepare(`SELECT COUNT(*) n FROM orders WHERE online_channel='haravan' AND online_ref='123'`).get().n, 1);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM order_items`).get().n, 2);
  assert.equal(db.prepare(`SELECT branch_id FROM orders WHERE online_ref='123'`).get().branch_id, 'br1');
  assert.equal(db.prepare(`SELECT status FROM orders WHERE online_ref='123'`).get().status, 'waiting_assignment');

  const duplicate = Haravan.handleHaravanWebhook(body, {
    'x-haravan-hmacsha256': signature,
    'x-haravan-topic': 'orders/create',
    'x-haravan-shop-domain': 'shop.myharavan.com',
  });
  Haravan.processHaravanQueue();
  assert.equal(duplicate.duplicate, true);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM orders WHERE online_ref='123'`).get().n, 1);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM external_orders WHERE provider='haravan' AND external_order_id='123'`).get().n, 1);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM sync_logs WHERE provider='haravan' AND topic='orders/create'`).get().n, 1);

  Haravan.syncHaravanProduct({
    id: 11,
    title: 'Ao',
    variants: [{ id: 22, sku: 'SKU-1', title: 'Default Title', price: 15000, inventory_quantity: 4 }],
  });

  Settings.updateIntegrations({
    channels: {
      haravan: {
        enabled: true,
        shopDomain: 'shop.myharavan.com',
        accessToken: 'tok_1234',
        webhookSecret: 'sec_5678',
        locationId: '963414',
        defaultBranchId: 'Sala',
        syncOrders: true,
        syncProducts: true,
        syncInventory: true,
      },
    },
  }, 'sala');
  const publicHaravan = Settings.getPublicIntegrations('sala').channels.haravan;
  assert.equal(publicHaravan.accessToken, '********1234');
  assert.equal(publicHaravan.webhookSecret, '********5678');
  Settings.updateIntegrations({ channels: { haravan: publicHaravan } }, 'sala');
  assert.equal(Settings.getIntegrations('sala').channels.haravan.accessToken, 'tok_1234');
  assert.equal(Settings.getIntegrations('sala').channels.haravan.webhookSecret, 'sec_5678');
  Haravan.syncHaravanProduct({
    id: 11,
    title: 'Ao',
    variants: [{ id: 22, sku: 'SKU-1', title: 'Default Title', price: 15000, inventory_quantity: 4 }],
  }, 'shop.myharavan.com');

  const movementsBeforeInbound = db.prepare(`SELECT COUNT(*) n FROM stock_movements`).get().n;
  const inventoryBody = Buffer.from(JSON.stringify({ loc_id: 963414, variant_id: 22, qty_available: 9 }));
  const inventorySignature = crypto.createHmac('sha256', 'sec_5678').update(inventoryBody).digest('base64');
  const receivedInventory = Haravan.handleHaravanWebhook(inventoryBody, {
    'x-haravan-hmacsha256': inventorySignature,
    'x-haravan-topic': 'inventorylocationbalances/update',
    'x-haravan-shop-domain': 'shop.myharavan.com',
  });
  Haravan.processHaravanQueue();
  assert.equal(receivedInventory.ok, true);
  assert.equal(db.prepare(`SELECT status FROM sync_logs WHERE id=?`).get(receivedInventory.log_id).status, 'success');
  assert.equal(db.prepare(`SELECT stock FROM skus WHERE id='hvn_22'`).get().stock, 9);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM stock_movements`).get().n, movementsBeforeInbound);
  assert.equal(db.prepare(`SELECT branch_id FROM skus WHERE id='hvn_22'`).get().branch_id, 'br1');
  assert.equal(
    Haravan.syncHaravanInventory({ loc_id: 111, variant_id: 22, qty_available: 3 }, 'shop.myharavan.com').reason,
    'different_location',
  );
  assert.equal(db.prepare(`SELECT stock FROM skus WHERE id='hvn_22'`).get().stock, 9);

  Settings.updateIntegrations({ channels: { haravan: { syncInventory: false } } }, 'sala');
  const disabledBody = Buffer.from(JSON.stringify({ loc_id: 963414, variant_id: 22, qty_available: 3 }));
  const disabledSignature = crypto.createHmac('sha256', 'sec_5678').update(disabledBody).digest('base64');
  const disabledLog = Haravan.handleHaravanWebhook(disabledBody, {
    'x-haravan-hmacsha256': disabledSignature,
    'x-haravan-topic': 'inventorylocationbalances/update',
    'x-haravan-shop-domain': 'shop.myharavan.com',
  });
  assert.equal(db.prepare(`SELECT status FROM sync_logs WHERE id=?`).get(disabledLog.log_id).status, 'ignored');
  assert.equal(db.prepare(`SELECT stock FROM skus WHERE id='hvn_22'`).get().stock, 9);
  Settings.updateIntegrations({ channels: { haravan: { syncInventory: true } } }, 'sala');

  const savedSignature = crypto.createHmac('sha256', 'sec_5678').update(body).digest('base64');
  assert.equal(Haravan.verifyHaravanWebhook(body, savedSignature), true);
  let pushedBody = null;
  let fetchCalls = 0;
  globalThis.fetch = async (url, init) => {
    assert.ok(String(url).endsWith('/com/inventories/adjustorset.json'));
    fetchCalls++;
    pushedBody = JSON.parse(init.body);
    return { ok: true, json: async () => ({ inventory: { id: 1 } }) };
  };

  const insertMovement = db.prepare(`INSERT INTO stock_movements
    (id,branch_id,inventory_item_id,type,qty,created_at,item_type,reason)
    VALUES (?,?,?,?,?,?,?,?)`);
  insertMovement.run('sm_old', 'br1', 'hvn_22', 'adjust', 1, new Date().toISOString(), 'sku', 'test');
  const initialized = await Haravan.pushPendingInventoryChanges();
  assert.equal(initialized.pushed, 0);
  assert.equal(initialized.results[0].initialized, true);
  assert.equal(fetchCalls, 0);

  insertMovement.run('sm_new', 'br1', 'hvn_22', 'sale', -1, new Date().toISOString(), 'sku', 'pos');
  const pending = await Haravan.pushPendingInventoryChanges();
  assert.equal(pending.pushed, 1);
  assert.equal(fetchCalls, 1);

  const pushed = await Haravan.pushInventoryToHaravan({ shopDomain: 'shop.myharavan.com', skuIds: ['hvn_22'] });
  assert.equal(pushed.pushed, 1);
  assert.equal(fetchCalls, 2);
  assert.equal(pushedBody.inventory.location_id, 963414);
  assert.equal(pushedBody.inventory.line_items[0].product_variant_id, 22);
  assert.equal(pushedBody.inventory.line_items[0].quantity, 9);

  const logsBeforeMissingLocation = db.prepare(`SELECT COUNT(*) n FROM sync_logs`).get().n;
  Settings.updateIntegrations({ channels: { haravan: { locationId: '' } } }, 'sala');
  insertMovement.run('sm_no_location', 'br1', 'hvn_22', 'sale', -1, new Date().toISOString(), 'sku', 'pos');
  const missingLocation = await Haravan.pushPendingInventoryChanges();
  assert.equal(missingLocation.pushed, 0);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM sync_logs`).get().n, logsBeforeMissingLocation);

  Haravan.deleteHaravanProduct({ id: 11 }, 'shop.myharavan.com');
  assert.equal(db.prepare(`SELECT active FROM skus WHERE id='hvn_22'`).get().active, 0);
  await new Promise(resolve => setImmediate(resolve));
} finally {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
}
