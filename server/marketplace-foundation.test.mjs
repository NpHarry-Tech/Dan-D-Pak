import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-marketplace-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.TIKTOK_SHOP_APP_KEY = 'TT-APP';
process.env.TIKTOK_SHOP_APP_SECRET = 'TT-SECRET';
process.env.TIKTOK_SHOP_SERVICE_ID = 'TT-SERVICE';
process.env.TIKTOK_SHOP_ENV = 'sandbox';

const { db, migrate } = await import('./db.js');
migrate();
db.prepare(`INSERT OR IGNORE INTO branches(id,name,active,sort) VALUES ('mp-branch','Marketplace',1,1)`).run();
db.prepare(`INSERT OR IGNORE INTO warehouses(id,branch_id,code,name,type,active,sort)
  VALUES ('mp-wh','mp-branch','ONLINE','Kho online','retail',1,1)`).run();

const Platform = await import('./services/connectionPlatform.js');
const Store = await import('./services/connectionStore.js');
const TikTok = await import('./services/tiktokConnector.js');
const Inbox = await import('./services/marketplaceWebhookInbox.js');

function jsonResponse(body) {
  return { json: async () => body };
}

test('TikTok shared callback is one-use, stores encrypted account tokens and requires explicit multi-shop selection', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    const value = String(url);
    if (value.includes('/api/v2/token/get')) return jsonResponse({ code: 0, data: {
      access_token: 'ACCESS-SECRET-VALUE', refresh_token: 'REFRESH-SECRET-VALUE', open_id: 'OPEN-1',
      access_token_expire_in: Math.floor(Date.now() / 1000) + 3600,
      refresh_token_expire_in: Math.floor(Date.now() / 1000) + 7200,
      granted_scopes: ['seller.authorization.info'],
    } });
    if (value.includes('/authorization/202309/shops')) return jsonResponse({ code: 0, data: { shops: [
      { id: 'SHOP-A', cipher: 'CIPHER-A', name: 'A', region: 'VN' },
      { id: 'SHOP-B', cipher: 'CIPHER-B', name: 'B', region: 'VN' },
    ] } });
    throw new Error(`unexpected_fetch:${value}`);
  };
  try {
    const started = Platform.startConnect('tiktokshop', {
      branch_id: 'mp-branch', user_id: 'owner-1', redirectBase: 'https://pos.example',
    });
    assert.match(started.url, /service_id=TT-SERVICE/);
    assert.equal(new URL(started.url).searchParams.get('state'), started.attempt_id);
    const result = await Platform.handleCallback('tiktokshop', { state: started.attempt_id, auth_code: 'CODE-1' });
    const connection = Platform.listConnections('tiktokshop', 'mp-branch').connections
      .find(row => row.id === result.connection_id);
    assert.equal(connection.status, 'pending_shop_selection');
    assert.equal(connection.shops.length, 2);
    assert.equal(JSON.stringify(connection).includes('ACCESS-SECRET-VALUE'), false);
    const raw = db.prepare(`SELECT access_token_enc,refresh_token_enc FROM marketplace_connections WHERE id=?`).get(connection.id);
    assert.ok(raw.access_token_enc && !raw.access_token_enc.includes('ACCESS-SECRET-VALUE'));
    assert.ok(raw.refresh_token_enc && !raw.refresh_token_enc.includes('REFRESH-SECRET-VALUE'));
    await assert.rejects(() => Platform.handleCallback('tiktokshop', { state: started.attempt_id, auth_code: 'CODE-1' }),
      error => error.status === 409);

    const mapped = Platform.selectAndMapShop(connection.id, {
      shop_id: 'SHOP-B', branch_id: 'mp-branch', warehouse_id: 'mp-wh',
    }, 'mp-branch', 'owner-1');
    assert.equal(mapped.status, 'initial_sync');
    assert.equal(mapped.mappings[0].external_shop_id, 'SHOP-B');
    const runtime = Store.findRuntimeConnectionByProviderBranch('tiktokshop', 'mp-branch');
    assert.equal(runtime.selected_shop.external_shop_id, 'SHOP-B');
    assert.equal(runtime.selected_shop.shop_cipher, 'CIPHER-B');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('unknown TikTok shop is quarantined and never routed to sala', async () => {
  const body = Buffer.from(JSON.stringify({ shop_id: 'UNKNOWN-SHOP', type: 'ORDER_STATUS_CHANGE', data: {} }));
  await assert.rejects(() => TikTok.handleTiktokWebhook(body, {}), error => error.status === 404);
  const row = db.prepare(`SELECT external_shop_id,reason FROM marketplace_webhook_quarantine ORDER BY received_at DESC LIMIT 1`).get();
  assert.equal(row.external_shop_id, 'UNKNOWN-SHOP');
  assert.match(row.reason, /Không có ánh xạ/);
});

test('concurrent TikTok refresh is single-flight and rotates vault tokens atomically', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async url => {
    assert.match(String(url), /\/api\/v2\/token\/refresh/);
    calls++;
    return jsonResponse({ code: 0, data: { access_token: 'ACCESS-ROTATED', refresh_token: 'REFRESH-ROTATED',
      access_token_expire_in: Math.floor(Date.now() / 1000) + 3600,
      refresh_token_expire_in: Math.floor(Date.now() / 1000) + 7200 } });
  };
  try {
    await Promise.all([TikTok.tiktokRefreshToken('mp-branch'), TikTok.tiktokRefreshToken('mp-branch')]);
    assert.equal(calls, 1);
    const runtime = Store.findRuntimeConnectionByProviderBranch('tiktokshop', 'mp-branch');
    assert.equal(runtime.access_token, 'ACCESS-ROTATED');
    assert.equal(runtime.refresh_token, 'REFRESH-ROTATED');
    assert.equal(db.prepare(`SELECT COUNT(*) count FROM marketplace_token_refresh_locks`).get().count, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('durable marketplace inbox deduplicates and retries outside the HTTP receiver', async () => {
  let calls = 0;
  Inbox.registerMarketplaceWebhookProcessor('fixture', async () => { calls++; });
  const input = { provider: 'fixture', connectionId: 'c1', shopId: 's1', eventType: 'ORDER',
    providerEventId: 'event-1', rawBody: '{"id":1}' };
  assert.equal(Inbox.enqueueMarketplaceWebhook(input).duplicate, false);
  assert.equal(Inbox.enqueueMarketplaceWebhook(input).duplicate, true);
  const result = await Inbox.processMarketplaceWebhookQueue();
  assert.equal(result.processed, 1);
  assert.equal(calls, 1);
});

test('shadow order sync records evidence and mapping_required without creating payment', () => {
  const result = TikTok.syncTiktokOrder({
    id: 'TT-ORDER-SHADOW', status: 'AWAITING_SHIPMENT', payment_status: 'PAID', currency: 'VND',
    recipient_address: { name: 'Buyer' },
    line_items: [{ id: 'L1', product_id: 'P1', sku_id: 'BC-NOT-MAPPED', seller_sku: 'SKU-NOT-MAPPED',
      product_name: 'Do not match by name', quantity: 1, sale_price: 100000 }],
    payment: { status: 'PAID', total_amount: 100000, platform_discount: 5000 },
  }, 'SHOP-B', 'mp-branch');
  assert.ok(result.internal_order_id);
  assert.equal(db.prepare(`SELECT COUNT(*) count FROM payments WHERE order_id=?`).get(result.internal_order_id).count, 0);
  assert.equal(db.prepare(`SELECT COUNT(*) count FROM marketplace_mapping_required
    WHERE provider='tiktokshop' AND external_shop_id='SHOP-B'`).get().count, 1);
  const financial = db.prepare(`SELECT components_json,buyer_payment_status,settlement_status
    FROM marketplace_order_financials WHERE external_order_id='TT-ORDER-SHADOW'`).get();
  assert.equal(financial.buyer_payment_status, 'PAID');
  assert.equal(financial.settlement_status, 'unreconciled');
  assert.equal(JSON.parse(financial.components_json).platform_item_discount, 5000);
});
