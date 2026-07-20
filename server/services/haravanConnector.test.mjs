import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'haravan-'));
process.env.SQLITE_PATH = join(tmp, 'test.db');
process.env.HARAVAN_WEBHOOK_SECRET = 'test_secret';
process.env.HARAVAN_DEFAULT_BRANCH_ID = 'ONLINE';

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
  assert.equal(db.prepare(`SELECT branch_id FROM orders WHERE online_ref='123'`).get().branch_id, 'ONLINE');
  assert.equal(db.prepare(`SELECT status FROM orders WHERE online_ref='123'`).get().status, 'waiting_assignment');

  Haravan.handleHaravanWebhook(body, {
    'x-haravan-hmacsha256': signature,
    'x-haravan-topic': 'orders/create',
  });
  Haravan.processHaravanQueue();
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM orders WHERE online_ref='123'`).get().n, 1);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM external_orders WHERE provider='haravan' AND external_order_id='123'`).get().n, 1);

  Haravan.syncHaravanProduct({
    id: 11,
    title: 'Ao',
    variants: [{ id: 22, sku: 'SKU-1', title: 'Default Title', price: 15000, inventory_quantity: 4 }],
  });
  Haravan.syncHaravanInventory({ variant_id: 22, quantity: 9 });
  assert.equal(db.prepare(`SELECT stock FROM skus WHERE id='hvn_22'`).get().stock, 9);

  Haravan.deleteHaravanProduct({ id: 11 });
  assert.equal(db.prepare(`SELECT active FROM skus WHERE id='hvn_22'`).get().active, 0);

  assert.ok(db.prepare(`SELECT COUNT(*) n FROM sync_logs WHERE provider='haravan'`).get().n >= 2);

  Settings.updateIntegrations({
    channels: {
      haravan: {
        enabled: true,
      shopDomain: 'shop.myharavan.com',
      accessToken: 'tok_1234',
      webhookSecret: 'sec_5678',
      locationId: '963414',
    },
  },
}, 'sala');
  const publicHaravan = Settings.getPublicIntegrations('sala').channels.haravan;
  assert.equal(publicHaravan.accessToken, '********1234');
  assert.equal(publicHaravan.webhookSecret, '********5678');
  Settings.updateIntegrations({ channels: { haravan: publicHaravan } }, 'sala');
  assert.equal(Settings.getIntegrations('sala').channels.haravan.accessToken, 'tok_1234');
  assert.equal(Settings.getIntegrations('sala').channels.haravan.webhookSecret, 'sec_5678');

  const savedSignature = crypto.createHmac('sha256', 'sec_5678').update(body).digest('base64');
  assert.equal(Haravan.verifyHaravanWebhook(body, savedSignature), true);
  Haravan.syncHaravanProduct({
    id: 11,
    title: 'Ao',
    variants: [{ id: 22, sku: 'SKU-1', title: 'Default Title', price: 15000, inventory_quantity: 9 }],
  }, 'shop.myharavan.com');
  let pushedBody = null;
  globalThis.fetch = async (url, init) => {
    assert.ok(String(url).endsWith('/com/inventories/adjustorset.json'));
    pushedBody = JSON.parse(init.body);
    return { ok: true, json: async () => ({ inventory: { id: 1 } }) };
  };
  const pushed = await Haravan.pushInventoryToHaravan({ shopDomain: 'shop.myharavan.com', skuIds: ['hvn_22'] });
  assert.equal(pushed.pushed, 1);
  assert.equal(pushedBody.inventory.location_id, 963414);
  assert.equal(pushedBody.inventory.line_items[0].product_variant_id, 22);
  assert.equal(pushedBody.inventory.line_items[0].quantity, 9);
  await new Promise(resolve => setImmediate(resolve));
} finally {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
}
