import { db, uid, now } from '../db.js';
import { findConnectionByProviderShop } from './connectionStore.js';

export function ensureMarketplaceSafetySchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS marketplace_order_financials (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      external_shop_id TEXT NOT NULL,
      external_order_id TEXT NOT NULL,
      currency TEXT,
      buyer_payment_status TEXT,
      fulfillment_status TEXT,
      receivable_status TEXT NOT NULL DEFAULT 'provisional',
      settlement_status TEXT NOT NULL DEFAULT 'unreconciled',
      components_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(provider,external_shop_id,external_order_id)
    );
    CREATE TABLE IF NOT EXISTS marketplace_mapping_required (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      external_shop_id TEXT NOT NULL,
      external_product_id TEXT,
      external_variant_id TEXT,
      seller_sku TEXT,
      barcode TEXT,
      display_name TEXT,
      status TEXT NOT NULL DEFAULT 'mapping_required',
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      UNIQUE(provider,external_shop_id,external_product_id,external_variant_id)
    );
  `);
}

export function recordMappingRequired({ provider, shopId, productId, variantId, sellerSku, barcode, name }) {
  ensureMarketplaceSafetySchema();
  db.prepare(`INSERT INTO marketplace_mapping_required
    (id,provider,external_shop_id,external_product_id,external_variant_id,seller_sku,barcode,display_name,status,first_seen_at,last_seen_at)
    VALUES (?,?,?,?,?,?,?,?,'mapping_required',?,?)
    ON CONFLICT(provider,external_shop_id,external_product_id,external_variant_id)
    DO UPDATE SET seller_sku=excluded.seller_sku,barcode=excluded.barcode,
      display_name=excluded.display_name,status='mapping_required',last_seen_at=excluded.last_seen_at`)
    .run(uid('mpmap_'), provider, String(shopId), String(productId || ''), String(variantId || ''),
      String(sellerSku || ''), String(barcode || ''), String(name || ''), now(), now());
}

export function recordOrderFinancials({ provider, shopId, orderId, currency = '', buyerPaymentStatus = '', fulfillmentStatus = '', components = {} }) {
  ensureMarketplaceSafetySchema();
  db.prepare(`INSERT INTO marketplace_order_financials
    (id,provider,external_shop_id,external_order_id,currency,buyer_payment_status,fulfillment_status,components_json,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT(provider,external_shop_id,external_order_id) DO UPDATE SET
      currency=excluded.currency,buyer_payment_status=excluded.buyer_payment_status,
      fulfillment_status=excluded.fulfillment_status,components_json=excluded.components_json,
      updated_at=excluded.updated_at`)
    .run(uid('mpfin_'), provider, String(shopId), String(orderId), String(currency || ''),
      String(buyerPaymentStatus || ''), String(fulfillmentStatus || ''), JSON.stringify(components || {}), now());
}

// Marketplace writes stay disabled unless an owner explicitly promotes the
// mapped connection out of shadow mode after provider/sandbox evidence exists.
export function marketplaceWritesEnabled(provider, shopId, capability) {
  const connection = findConnectionByProviderShop(provider, shopId);
  if (!connection || connection.status !== 'active') return false;
  let settings = {};
  try { settings = connection.settings_json ? JSON.parse(connection.settings_json) : {}; } catch { settings = {}; }
  if (settings.sync_mode !== 'live' || settings.owner_write_approved !== true) return false;
  const caps = db.prepare(`SELECT status FROM marketplace_capabilities
    WHERE connection_id=? AND capability=?`).get(connection.id, String(capability));
  return caps?.status === 'verified';
}
