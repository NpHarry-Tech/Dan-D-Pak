// Lazada Open Platform connector — REAL client (Alibaba TOP signature scheme).
//
// Ký (open.lazada.com): sort tham số theo key, ghép apiPath + key+value (KHÔNG
// dấu phân cách), HMAC-SHA256(app_secret) → hex IN HOA. sign_method='sha256',
// timestamp = mili-giây, access_token cho API cần quyền. Khác Shopee: prepend
// apiPath, ghép key+value liền, uppercase, timestamp ms.
// OAuth: authorize → code → /auth/token/create (auth.lazada.com/rest); refresh
// /auth/token/refresh. API nghiệp vụ gọi qua base theo vùng (VN: api.lazada.vn/rest).
// Waybill: /order/document/get (doc_type=shippingLabel) → file base64 (PDF).
//
// Đơn Lazada đi qua ĐÚNG ranh giới nghiệp vụ như Shopee/Haravan: external_orders
// → ánh xạ SKU → orders(channel='online') → payOrder(external_settlement) → kho
// + hoá đơn + báo cáo. KHÔNG tạo domain khách/hàng/kho/thanh toán thứ hai.
import crypto from 'node:crypto';
import { db, uid, now, audit } from '../db.js';
import { emit } from '../realtime.js';
import { payOrder } from './payments.js';
import { getIntegrationChannel, updateIntegrations } from './settings.js';
import { listBranches } from './branches.js';
import { upsertExternalProduct } from './online.js';
import {
  findConnectionByProviderShop, findRuntimeConnectionByProviderBranch, findRuntimeConnectionByProviderShop, updateConnectionTokens, withConnectionRefreshLease,
} from './connectionStore.js';
import {
  enqueueMarketplaceWebhook, quarantineMarketplaceWebhook, registerMarketplaceWebhookProcessor,
} from './marketplaceWebhookInbox.js';
import {
  marketplaceWritesEnabled, recordMappingRequired, recordOrderFinancials,
} from './marketplaceSafety.js';

const PROVIDER = 'lazada';
const AUTH_BASE = 'https://auth.lazada.com/rest';
const AUTHORIZE_URL = 'https://auth.lazada.com/oauth/authorize';
const API_BASES = Object.freeze({
  VN: 'https://api.lazada.vn/rest', SG: 'https://api.lazada.sg/rest',
  MY: 'https://api.lazada.com.my/rest', TH: 'https://api.lazada.co.th/rest',
  ID: 'https://api.lazada.co.id/rest', PH: 'https://api.lazada.com.ph/rest',
});

const money = (n) => Math.round(Number(n) || 0);
const cleanId = (v) => String(v ?? '').trim();
const json = (v) => JSON.stringify(v ?? null);

export function lazadaConfig(branchId = 'sala', { shopId = '' } = {}) {
  const c = getIntegrationChannel('lazada', branchId) || {};
  const connection = shopId
    ? findRuntimeConnectionByProviderShop(PROVIDER, shopId)
    : findRuntimeConnectionByProviderBranch(PROVIDER, branchId);
  const selected = connection?.selected_shop || {};
  const region = (cleanId(selected.region) || cleanId(c.region) || 'VN').toUpperCase();
  // App Key/Secret là credential CẤP NỀN TẢNG: ưu tiên ENV (Dan-D Pak đăng ký
  // app Lazada 1 lần), fallback per-branch để migrate. Xem shopeeConfig.
  const envAppId = String(process.env.LAZADA_APP_KEY || '').trim();
  const envSecret = String(process.env.LAZADA_APP_SECRET || '').trim();
  return {
    enabled: c.enabled === true,
    environment: String(process.env.LAZADA_ENV || '').trim() || cleanId(c.environment) || 'sandbox',
    appId: envAppId || cleanId(c.appId),         // Lazada app_key
    secretKey: envSecret || cleanId(c.secretKey), // app_secret
    sellerId: cleanId(selected.external_shop_id) || cleanId(c.sellerId),
    accessToken: cleanId(connection?.access_token) || cleanId(c.accessToken),
    refreshToken: cleanId(connection?.refresh_token) || cleanId(c.refreshToken),
    webhookSecret: cleanId(process.env.LAZADA_WEBHOOK_SECRET) || envSecret || cleanId(c.webhookSecret) || cleanId(c.secretKey),
    // Never accept an API host from Flutter/branch settings. Region comes from
    // the authorized account and resolves through this server-side allowlist.
    apiBase: API_BASES[region] || API_BASES.VN,
    region,
    connectionId: connection?.id || '',
    tokenSource: connection ? 'connection_platform' : 'legacy_settings',
  };
}

function assertConfigured(cfg) {
  if (!cfg.appId || !cfg.secretKey) {
    const e = new Error('Lazada chưa cấu hình App Key / App Secret.'); e.status = 400; throw e;
  }
}
function assertAuthorized(cfg) {
  assertConfigured(cfg);
  if (!cfg.accessToken) {
    const e = new Error('Shop Lazada chưa được ủy quyền (thiếu access_token). Hãy chạy kết nối OAuth.');
    e.status = 400; throw e;
  }
}

// ── Ký TOP: base = apiPath + Σ(key+value) theo key sort; HMAC-SHA256 hex UPPER ─
export function lazadaSign(apiPath, params, appSecret) {
  const keys = Object.keys(params)
    .filter(k => k !== 'sign' && params[k] !== undefined && params[k] !== null && params[k] !== '')
    .sort();
  let base = apiPath;
  for (const k of keys) base += k + params[k];
  return crypto.createHmac('sha256', appSecret).update(base, 'utf8').digest('hex').toUpperCase();
}

async function call(cfg, apiPath, { method = 'GET', extra = {}, protectedApi = true, useAuthBase = false, branchId, _retried = false } = {}) {
  const base = useAuthBase ? AUTH_BASE : cfg.apiBase;
  const params = {
    app_key: cfg.appId,
    sign_method: 'sha256',
    timestamp: String(Date.now()),
    ...(protectedApi ? { access_token: cfg.accessToken } : {}),
  };
  for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== null) params[k] = String(v);
  params.sign = lazadaSign(apiPath, params, cfg.secretKey);
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${base}${apiPath}?${qs}`, { method });
  const data = await res.json().catch(() => ({}));
  const code = cleanId(data.code);
  if (code && code !== '0') {
    // access_token hết hạn → refresh rồi thử lại đúng một lần.
    if (!_retried && protectedApi && branchId && /IllegalAccessToken|AccessToken|expired|AuthExpire/i.test(`${code} ${data.message || ''}`)) {
      await lazadaRefreshToken(branchId);
      return call(lazadaConfig(branchId), apiPath, { method, extra, protectedApi, useAuthBase, branchId, _retried: true });
    }
    const e = new Error(`Lazada ${apiPath}: ${code} ${data.message || ''}`.trim()); e.lazada = data; throw e;
  }
  return data;
}

// ── OAuth ───────────────────────────────────────────────────────────────────
export function lazadaAuthLink(branchId, redirect, state = '') {
  const cfg = lazadaConfig(branchId);
  assertConfigured(cfg);
  const params = new URLSearchParams({
    response_type: 'code', force_auth: 'true', redirect_uri: redirect, client_id: cfg.appId,
    ...(state ? { state: String(state) } : {}),
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

function persistTokens(branchId, { sellerId, accessToken, refreshToken }) {
  const patch = { accessToken: cleanId(accessToken), refreshToken: cleanId(refreshToken) };
  if (sellerId) patch.sellerId = String(sellerId);
  updateIntegrations({ channels: { lazada: patch } }, branchId);
}

export async function lazadaExchangeToken(branchId, code) {
  const cfg = lazadaConfig(branchId);
  assertConfigured(cfg);
  const data = await call(cfg, '/auth/token/create', { method: 'POST', extra: { code: cleanId(code) }, protectedApi: false, useAuthBase: true, branchId });
  if (!data.access_token) throw new Error(`Lazada token exchange thất bại: ${data.message || data.code || 'unknown'}`);
  const info = Array.isArray(data.country_user_info) ? data.country_user_info[0] : null;
  const sellerId = info?.seller_id || data.account_id || '';
  persistTokens(branchId, { sellerId, accessToken: data.access_token, refreshToken: data.refresh_token });
  audit('lazada.oauth.token', { seller_id: String(sellerId) }, branchId, 'lazada');
  return { seller_id: String(sellerId), expires_in: data.expires_in };
}

// Đổi code→token, TRẢ VỀ token thô + seller_id (Lazada callback chỉ có code;
// seller_id lấy từ token response). Dùng cho Connection Platform.
export async function exchangeLazadaCodeRaw(branchId, code) {
  const cfg = lazadaConfig(branchId);
  assertConfigured(cfg);
  const data = await call(cfg, '/auth/token/create', { method: 'POST', extra: { code: cleanId(code) }, protectedApi: false, useAuthBase: true, branchId });
  if (!data.access_token) throw new Error(`Lazada token exchange thất bại: ${data.message || data.code || 'unknown'}`);
  const infos = Array.isArray(data.country_user_info) ? data.country_user_info : [];
  const shops = (infos.length ? infos : [{ seller_id: data.account_id }]).map(info => ({
    shop_id: String(info?.seller_id || data.account_id || ''),
    shop_name: String(info?.name || info?.short_code || ''),
    region: String(info?.country || info?.country_code || 'VN').toUpperCase(),
    metadata: { account_platform: info?.account_platform, short_code: info?.short_code },
  })).filter(shop => shop.shop_id);
  return {
    external_account_id: String(data.account_id || shops[0]?.shop_id || ''),
    shops,
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expire_in: Number(data.expires_in) || 0,
    refresh_expire_in: Number(data.refresh_expires_in) || 0,
    granted_scopes: Array.isArray(data.scope) ? data.scope : cleanId(data.scope).split(/[ ,]+/).filter(Boolean),
    environment: cfg.environment,
  };
}

const refreshFlights = new Map();
export async function lazadaRefreshToken(branchId) {
  const cfg = lazadaConfig(branchId);
  assertConfigured(cfg);
  if (!cfg.refreshToken) throw new Error('Lazada thiếu refresh_token.');
  const key = cfg.connectionId || `legacy:${branchId}`;
  if (refreshFlights.has(key)) return refreshFlights.get(key);
  const flight = withConnectionRefreshLease(cfg.connectionId, async () => {
    const data = await call(cfg, '/auth/token/refresh', { method: 'POST', extra: { refresh_token: cfg.refreshToken }, protectedApi: false, useAuthBase: true, branchId });
    if (!data.access_token) throw new Error(`Lazada refresh token thất bại: ${data.message || data.code || 'unknown'}`);
    if (cfg.connectionId) {
      updateConnectionTokens(cfg.connectionId, { accessToken: data.access_token,
        refreshToken: data.refresh_token || cfg.refreshToken,
        accessExpiresAt: Number(data.expires_in) > 0 ? new Date(Date.now() + Number(data.expires_in) * 1000).toISOString() : null,
        refreshExpiresAt: Number(data.refresh_expires_in) > 0 ? new Date(Date.now() + Number(data.refresh_expires_in) * 1000).toISOString() : null });
    } else {
      persistTokens(branchId, { sellerId: cfg.sellerId, accessToken: data.access_token, refreshToken: data.refresh_token || cfg.refreshToken });
    }
    audit('lazada.oauth.refresh', { seller_id: cfg.sellerId, connection_id: cfg.connectionId || null }, branchId, 'lazada');
    return { expires_in: data.expires_in };
  }).finally(() => refreshFlights.delete(key));
  refreshFlights.set(key, flight);
  return flight;
}

// ── Ánh xạ SKU ──────────────────────────────────────────────────────────────
function lazadaSkuForLine(line, sellerId, branchId) {
  const extProduct = cleanId(line.product_id);
  const extVariant = cleanId(line.sku_id || line.variation);
  const mapped = db.prepare(`SELECT internal_variant_id FROM external_products
    WHERE provider=? AND shop_domain=? AND external_product_id=? AND external_variant_id=?`)
    .get(PROVIDER, String(sellerId), extProduct, extVariant);
  if (mapped?.internal_variant_id && !String(mapped.internal_variant_id).startsWith('lzd_')) return mapped.internal_variant_id;
  const sellerSku = cleanId(line.shop_sku || line.sku);
  if (sellerSku) {
    const matches = db.prepare(`SELECT id FROM skus WHERE code=? AND branch_id=? AND active=1 LIMIT 2`).all(sellerSku, branchId);
    if (matches.length === 1) return matches[0].id;
  }
  const barcode = cleanId(line.sku_id);
  if (barcode) {
    const matches = db.prepare(`SELECT id FROM skus WHERE barcode=? AND branch_id=? AND active=1 LIMIT 2`).all(barcode, branchId);
    if (matches.length === 1) return matches[0].id;
  }
  recordMappingRequired({ provider: PROVIDER, shopId: sellerId, productId: extProduct,
    variantId: extVariant, sellerSku, barcode, name: line.name });
  return null;
}

const WORKFLOW = {
  unpaid: 'pending', pending: 'processed', packed: 'ready_to_ship', ready_to_ship: 'ready_to_ship',
  ready_to_ship_pending: 'ready_to_ship', shipped: 'shipping', shipped_back: 'return_refund',
  delivered: 'delivered', canceled: 'cancelled', failed: 'cancelled', returned: 'return_refund',
  lost_by_3pl: 'shipping', damaged_by_3pl: 'shipping',
};

function representativeStatus(order) {
  const list = Array.isArray(order.statuses) ? order.statuses.map(s => cleanId(s).toLowerCase()) : [cleanId(order.status).toLowerCase()];
  // Ưu tiên trạng thái "tiến xa" nhất để phản ánh đúng workflow.
  const order2 = ['canceled', 'failed', 'returned', 'delivered', 'shipped', 'ready_to_ship', 'packed', 'pending', 'unpaid'];
  for (const s of order2) if (list.includes(s)) return s;
  return list[0] || 'pending';
}

export function syncLazadaOrder(order, items, sellerId, branchId = 'sala') {
  const orderId = cleanId(order.order_id || order.order_number);
  if (!orderId) throw new Error('missing_lazada_order_id');
  const seller = String(sellerId);
  const status = representativeStatus(order);
  const addr = order.address_shipping || {};
  // Lazada trả 1 dòng / 1 đơn vị → gộp theo SKU.
  const grouped = new Map();
  for (const it of (Array.isArray(items) ? items : [])) {
    const key = cleanId(it.shop_sku || it.sku || it.sku_id || it.order_item_id || `${it.product_id}:${grouped.size}`);
    const cur = grouped.get(key) || { line: it, qty: 0, item_ids: [] };
    cur.qty += 1;
    cur.item_ids.push(it.order_item_id);
    grouped.set(key, cur);
  }
  const lines = [...grouped.values()];
  const subtotal = lines.reduce((s, g) => s + money(g.line.paid_price || g.line.item_price || 0) * g.qty, 0);
  const total = money(order.price || subtotal);
  const discount = Math.max(0, subtotal - total);
  const buyerPaymentStatus = cleanId(order.payment_status).toLowerCase();
  const paid = buyerPaymentStatus === 'paid' || buyerPaymentStatus === 'completed';
  const voided = status === 'canceled' || status === 'failed';
  const customerJson = json({
    id: null,
    name: cleanId(`${order.customer_first_name || ''} ${order.customer_last_name || ''}`) || cleanId(addr.first_name),
    phone: cleanId(addr.phone || addr.phone2),
    email: '', address: [addr.address1, addr.address2, addr.ward, addr.district, addr.city].filter(Boolean).map(cleanId).join(', '),
    provider: PROVIDER, shop_domain: seller, note: cleanId(order.remarks),
  });

  db.prepare('BEGIN IMMEDIATE').run();
  try {
    let internalId = db.prepare(`SELECT internal_order_id FROM external_orders WHERE provider=? AND shop_domain=? AND external_order_id=?`)
      .get(PROVIDER, seller, orderId)?.internal_order_id;
    const priorState = internalId ? db.prepare(`SELECT locked_at FROM online_order_state WHERE order_id=?`).get(internalId) : null;

    if (!internalId) {
      internalId = uid('o_');
      db.prepare(`INSERT INTO orders
        (id,branch_id,table_id,channel,status,subtotal,discount,total,created_at,online_channel,online_ref,online_status,customer_json)
        VALUES (?,?,NULL,'online',?,?,?,?,?,?,?,?,?)`)
        .run(internalId, branchId, voided ? 'void' : 'open', subtotal, discount, total,
          order.created_at || now(), PROVIDER, orderId, status, customerJson);
    } else {
      if (!priorState?.locked_at) db.prepare(`DELETE FROM order_items WHERE order_id=?`).run(internalId);
      db.prepare(`UPDATE orders SET status=?,online_status=?,customer_json=? WHERE id=?`)
        .run(voided ? 'void' : 'open', status, customerJson, internalId);
    }

    if (!priorState?.locked_at) {
      const ins = db.prepare(`INSERT INTO order_items
        (id,order_id,menu_item_id,sku_id,item_code,item_barcode,unit_snapshot,name,emoji,qty,unit_price,vat_rate,station,sla_minutes,note,mods_json,status,created_at)
        VALUES (?,?,NULL,?,?,?,?,?,NULL,?,?,?, 'retail',0,?, '[]','served',?)`);
      for (const g of lines) {
        const l = g.line;
        const skuId = lazadaSkuForLine(l, seller, branchId);
        const sku = skuId ? db.prepare(`SELECT code,barcode,unit,vat FROM skus WHERE id=?`).get(skuId) : null;
        ins.run(uid('oi_'), internalId, skuId, l.shop_sku || l.sku || sku?.code || null,
          l.sku || sku?.barcode || null, sku?.unit || 'cái', cleanId(l.name) || 'Lazada item',
          g.qty, money(l.paid_price || l.item_price || 0), Number(sku?.vat) || 0,
          l.order_item_id ? `laz_item:${g.item_ids.join(',')}` : null, now());
      }
    }

    db.prepare(`INSERT INTO external_orders
      (id,provider,shop_domain,external_order_id,internal_order_id,external_order_code,sync_status,raw_payload,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(provider, shop_domain, external_order_id) DO UPDATE SET
        internal_order_id=excluded.internal_order_id,external_order_code=excluded.external_order_code,
        sync_status=excluded.sync_status,raw_payload=excluded.raw_payload,updated_at=excluded.updated_at`)
      .run(uid('eo_'), PROVIDER, seller, orderId, internalId, cleanId(order.order_number || orderId),
        'success', json({ order, items }), now(), now());

    const workflow = WORKFLOW[status] || 'pending';
    const locked = marketplaceWritesEnabled(PROVIDER, seller, 'fulfillment_write') && workflow !== 'pending';
    db.prepare(`INSERT INTO online_order_state (order_id,workflow_status,locked_at,created_at,updated_at)
      VALUES (?,?,?,?,?) ON CONFLICT(order_id) DO UPDATE SET
        workflow_status=CASE
          WHEN excluded.workflow_status IN ('shipping','delivered','cancelled','return_refund') THEN excluded.workflow_status
          WHEN online_order_state.workflow_status IN ('preparing','ready_to_ship') THEN online_order_state.workflow_status
          ELSE excluded.workflow_status END,
        locked_at=COALESCE(online_order_state.locked_at,excluded.locked_at),updated_at=excluded.updated_at`)
      .run(internalId, workflow, locked ? now() : null, now(), now());
    recordOrderFinancials({ provider: PROVIDER, shopId: seller, orderId,
      currency: order.currency || lines[0]?.line?.currency,
      buyerPaymentStatus, fulfillmentStatus: status,
      components: {
        item_original: lines.reduce((sum, g) => sum + money(g.line.item_price) * g.qty, 0),
        seller_item_discount: lines.reduce((sum, g) => sum + money(g.line.seller_discount) * g.qty, 0),
        platform_item_discount: lines.reduce((sum, g) => sum + money(g.line.platform_discount) * g.qty, 0),
        seller_order_voucher: money(order.voucher_seller), platform_order_voucher: money(order.voucher_platform),
        shipping_buyer: money(order.shipping_fee), shipping_seller: money(order.shipping_fee_original),
        tax: money(order.tax), fees: money(order.fees), refunded: money(order.refund_amount),
        expected_receivable: money(order.payout), order_total: total,
      } });
    db.prepare('COMMIT').run();

    let settlement = null;
    if (paid && marketplaceWritesEnabled(PROVIDER, seller, 'payment_settlement_write')) {
      const canonical = db.prepare(`SELECT status FROM orders WHERE id=?`).get(internalId);
      const hasPayment = db.prepare(`SELECT 1 FROM payments WHERE order_id=? LIMIT 1`).get(internalId);
      if (canonical?.status !== 'paid' || !hasPayment) {
        settlement = payOrder(internalId, total > 0 ? [{
          method: 'online', amount: total, reference: `${seller}:${orderId}`.slice(0, 250),
        }] : [], {
          cashier: `lazada:${seller}`.slice(0, 120),
          idempotency_key: `connector:lazada:${seller}:${orderId}:paid`.slice(0, 128),
          external_settlement: true, skip_channel_outbound: true,
        }, branchId);
      }
    }
    audit('lazada.order.sync', { seller_id: seller, order_id: orderId, internal: internalId, status }, branchId, 'lazada');
    emit('online:new', { id: internalId, provider: PROVIDER, ref: orderId, branch_id: branchId }, branchId);
    emit('stats:dirty', {}, branchId);
    return { internal_order_id: internalId, order_id: orderId, status, settlement };
  } catch (err) {
    try { db.prepare('ROLLBACK').run(); } catch { /* already committed */ }
    throw err;
  }
}

export async function pullLazadaOrders(branchId = 'sala', { since = '', shopId = '' } = {}) {
  const cfg = lazadaConfig(branchId, { shopId });
  assertAuthorized(cfg);
  const createdAfter = since || new Date(Date.now() - 15 * 86400 * 1000).toISOString();
  const limit = 50;
  let offset = 0;
  const orders = [];
  for (;;) {
    const data = await call(cfg, '/orders/get', {
      extra: { created_after: createdAfter, sort_by: 'created_at', sort_direction: 'DESC', offset, limit }, branchId,
    });
    const list = data.data?.orders || [];
    orders.push(...list);
    const count = Number(data.data?.countTotal || data.data?.count || 0);
    offset += limit;
    if (list.length < limit || (count && offset >= count) || offset >= 1000) break;
  }
  const results = [];
  for (const o of orders) {
    try {
      const itemsData = await call(cfg, '/order/items/get', { extra: { order_id: o.order_id }, branchId });
      results.push(syncLazadaOrder(o, itemsData.data || [], cfg.sellerId, branchId));
    } catch (e) {
      audit('lazada.order.sync_error', { order_id: o.order_id, error: e.message }, branchId, 'lazada');
    }
  }
  return { pulled: results.length, orders: results };
}

// ── Kéo SẢN PHẨM (listing) về external_products ──────────────────────────────
// /products/get (filter=all, offset, limit≤50). Mỗi sku là một biến thể
// (variant = SkuId), SellerSku/ShopSku là mã để đối chiếu kho.
export async function pullLazadaProducts(branchId = 'sala', { limit = 50, maxPages = 30, shopId = '' } = {}) {
  const cfg = lazadaConfig(branchId, { shopId });
  assertAuthorized(cfg);
  const seller = String(cfg.sellerId || '');
  const take = Math.min(50, limit);
  let offset = 0, page = 0, synced = 0;
  for (;;) {
    const data = await call(cfg, '/products/get', { extra: { filter: 'all', offset, limit: take }, branchId });
    const products = data.data?.products || [];
    for (const p of products) {
      const itemId = cleanId(p.item_id);
      const name = cleanId(p.attributes?.name);
      const image = (p.images || [])[0] || '';
      const skus = Array.isArray(p.skus) ? p.skus : [];
      if (!skus.length) {
        upsertExternalProduct({ provider: PROVIDER, shop_domain: seller,
          external_product_id: itemId, external_variant_id: '', sku: '', name, image, raw: { product: p } });
        synced++;
        continue;
      }
      for (const s of skus) {
        const variantName = s.saleProp && typeof s.saleProp === 'object'
          ? Object.values(s.saleProp).map(cleanId).filter(Boolean).join(', ') : '';
        upsertExternalProduct({ provider: PROVIDER, shop_domain: seller,
          external_product_id: itemId, external_variant_id: cleanId(s.SkuId || s.sku_id),
          sku: cleanId(s.SellerSku || s.ShopSku || s.shop_sku),
          name: [name, variantName].filter(Boolean).join(' - '),
          image: (s.Images || [])[0] || image, raw: { product: p, sku: s } });
        synced++;
      }
    }
    offset += products.length;
    page++;
    if (products.length < take || page >= maxPages) break;
  }
  audit('lazada.product.sync', { seller_id: seller, synced }, branchId, 'lazada');
  emit('online:updated', { kind: 'product_sync', provider: PROVIDER, synced }, branchId);
  return { synced };
}

// ── Webhook push ─────────────────────────────────────────────────────────────
function branchForSeller(sellerId) {
  const wanted = String(sellerId || '').trim();
  if (!wanted) { const e = new Error('Lazada push thiếu seller_id.'); e.status = 400; throw e; }
  const connection = findConnectionByProviderShop(PROVIDER, wanted);
  if (connection) {
    const mapping = db.prepare(`SELECT branch_id FROM marketplace_shop_mappings m
      JOIN marketplace_shops s ON s.id=m.shop_id WHERE m.connection_id=? AND s.external_shop_id=? AND m.enabled=1`)
      .get(connection.id, wanted);
    if (mapping?.branch_id) return mapping.branch_id;
  }
  const legacyBranches = new Set([
    ...listBranches({ all: true }).map(branch => branch.id),
    ...db.prepare(`SELECT branch_id FROM app_settings WHERE key='integrations_config'`).all().map(row => row.branch_id),
  ]);
  for (const id of legacyBranches) {
    if (cleanId((getIntegrationChannel('lazada', id) || {}).sellerId) === wanted) return id;
  }
  const e = new Error(`Không có ánh xạ Lazada cho seller_id=${wanted}.`); e.status = 404; throw e;
}
function safeEqualHex(a, b) {
  const x = Buffer.from(cleanId(a), 'utf8'); const y = Buffer.from(cleanId(b), 'utf8');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Lazada push ký body bằng HMAC-SHA256(app_secret) trong header (sha256).
// BẢO MẬT (fail-closed): thiếu header chữ ký hoặc chưa có webhookSecret →
// TỪ CHỐI thẳng, không được coi là "bỏ qua verify rồi vẫn xử lý" — nếu không,
// bất kỳ ai cũng POST được trade_order_id tuỳ ý để ép server gọi API Lazada
// bằng token thật của cửa hàng (webhookSecret luôn có sẵn khi đã kết nối, vì
// nó fallback về secretKey — thứ bắt buộc phải có để OAuth hoạt động).
export async function handleLazadaPush(rawBody, headers = {}) {
  let payload = {};
  try { payload = JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '{}')); }
  catch { const e = new Error('Lazada push body không hợp lệ.'); e.status = 400; throw e; }
  const sellerId = cleanId(payload.seller_id || payload.sellerId);
  let branchId;
  try { branchId = branchForSeller(sellerId); }
  catch (error) {
    quarantineMarketplaceWebhook(PROVIDER, rawBody, { shopId: sellerId, reason: error.message });
    throw error;
  }
  const cfg = lazadaConfig(branchId);
  const provided = cleanId(headers['authorization'] || headers['x-lazada-signature'] || headers['sha256']);
  if (!provided || !cfg.webhookSecret) {
    audit('lazada.push.rejected', { seller_id: sellerId, reason: 'missing_signature' }, branchId, 'lazada');
    const e = new Error('Thiếu chữ ký push Lazada.'); e.status = 401; throw e;
  }
  const body = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '');
  const expect = crypto.createHmac('sha256', cfg.webhookSecret).update(body).digest('hex');
  if (!safeEqualHex(expect, provided) && !safeEqualHex(expect.toUpperCase(), provided)) {
    audit('lazada.push.rejected', { seller_id: sellerId, reason: 'bad_signature' }, branchId, 'lazada');
    const e = new Error('Sai chữ ký push Lazada.'); e.status = 401; throw e;
  }
  const connection = findConnectionByProviderShop(PROVIDER, sellerId);
  const eventType = cleanId(payload.message_type || payload.type || 'UNKNOWN');
  const providerEventId = cleanId(payload.message_id || payload.event_id || payload.id);
  const accepted = enqueueMarketplaceWebhook({ provider: PROVIDER,
    connectionId: connection?.id || '', shopId: sellerId, eventType, providerEventId, rawBody });
  audit('lazada.push.accepted', { seller_id: sellerId, type: eventType, duplicate: accepted.duplicate }, branchId, 'lazada');
  return { ...accepted, handled: true };
}

async function processLazadaWebhookRow(row) {
  const payload = JSON.parse(row.raw_payload || '{}');
  const branchId = branchForSeller(row.external_shop_id);
  const cfg = lazadaConfig(branchId, { shopId: row.external_shop_id });
  const orderId = cleanId(payload.data?.trade_order_id || payload.data?.order_id || payload.trade_order_id);
  if (orderId && cfg.accessToken) {
    const response = await call(cfg, '/order/get', { extra: { order_id: orderId }, branchId });
    if (response.data) {
      const items = await call(cfg, '/order/items/get', { extra: { order_id: orderId }, branchId });
      syncLazadaOrder(response.data, items.data || [], cfg.sellerId, branchId);
    }
  }
  db.prepare(`UPDATE marketplace_connections SET last_event_at=?,updated_at=? WHERE id=?`)
    .run(now(), now(), row.connection_id || '');
}

registerMarketplaceWebhookProcessor(PROVIDER, processLazadaWebhookRow);

// ── AWB / tem vận đơn (PDF base64) ──────────────────────────────────────────
export async function lazadaWaybill(branchId = 'sala', orderItemIds = [], { docType = 'shippingLabel' } = {}) {
  const cfg = lazadaConfig(branchId);
  assertAuthorized(cfg);
  const ids = (Array.isArray(orderItemIds) ? orderItemIds : [orderItemIds]).map(String);
  const data = await call(cfg, '/order/document/get', { extra: { doc_type: docType, order_item_ids: JSON.stringify(ids) }, branchId });
  const doc = data.data?.document;
  if (!doc?.file) throw new Error('Lazada không trả file waybill.');
  return Buffer.from(doc.file, 'base64');
}

// Lazada waybill cần order_item_ids; từ order_id lấy lại từ đơn đã đồng bộ.
export async function lazadaWaybillByOrder(branchId = 'sala', orderId, opts = {}) {
  const row = db.prepare(`SELECT raw_payload FROM external_orders WHERE provider=? AND external_order_id=? ORDER BY updated_at DESC, created_at DESC LIMIT 1`)
    .get(PROVIDER, String(orderId));
  let ids = [];
  if (row?.raw_payload) {
    try {
      const raw = JSON.parse(row.raw_payload);
      const items = raw.items || raw.order?.items || [];
      ids = (Array.isArray(items) ? items : []).map(it => it.order_item_id).filter(Boolean).map(String);
    } catch { /* ignore */ }
  }
  if (!ids.length) throw new Error('Không tìm thấy order_item_ids cho đơn Lazada này (chưa đồng bộ chi tiết đơn?).');
  return lazadaWaybill(branchId, ids, opts);
}

export function lazadaCapabilities(branchId = 'sala') {
  const cfg = lazadaConfig(branchId);
  const configured = !!(cfg.appId && cfg.secretKey);
  const authorized = configured && !!cfg.accessToken;
  return {
    provider: PROVIDER, enabled: cfg.enabled, environment: cfg.environment,
    configured, authorized,
    status: authorized ? 'active' : configured ? 'pending_authorization' : 'pending_credentials',
    capabilities: { inbound_orders: authorized, waybill: authorized, push: configured },
  };
}
