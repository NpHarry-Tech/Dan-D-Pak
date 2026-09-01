// TikTok Shop Open API (202309) connector — REAL client.
//
// Ký request: base = app_secret + path + Σ(sorted key+value, BỎ sign &
// access_token) + rawBody(JSON) + app_secret → HMAC-SHA256(app_secret) hex.
// Header x-tts-access-token; query app_key, timestamp(giây), shop_cipher, sign.
// Webhook verify KHÁC: Authorization = HMAC-SHA256(app_secret, app_key+body).
// OAuth: token/get & token/refresh (auth.tiktok-shops.com) — KHÔNG ký, dùng
// app_key+app_secret trong query.
// Đơn TikTok đi qua ĐÚNG ranh giới nghiệp vụ: external_orders → ánh xạ SKU →
// orders(channel='online') → payOrder(external_settlement) → kho+hoá đơn+báo cáo.
import crypto from 'node:crypto';
import { db, uid, now, audit } from '../db.js';
import { emit } from '../realtime.js';
import { payOrder } from './payments.js';
import { getIntegrationChannel, updateIntegrations } from './settings.js';
import { listBranches } from './branches.js';
import { upsertExternalProduct } from './online.js';

const PROVIDER = 'tiktokshop';
const AUTH_BASE = 'https://auth.tiktok-shops.com';
const AUTHORIZE_URL = 'https://services.tiktokshop.com/open/authorize';
const VERSION = '202309';

const money = (n) => Math.round(Number(n) || 0);
const cleanId = (v) => String(v ?? '').trim();
const json = (v) => JSON.stringify(v ?? null);
const nowUnix = () => Math.floor(Date.now() / 1000);

export function tiktokConfig(branchId = 'sala') {
  const c = getIntegrationChannel('tiktokshop', branchId) || {};
  return {
    enabled: c.enabled === true,
    environment: cleanId(c.environment) || 'sandbox',
    appId: cleanId(c.appId),
    serviceId: cleanId(c.serviceId),
    secretKey: cleanId(c.secretKey),
    shopId: cleanId(c.shopId),
    shopCipher: cleanId(c.shopCipher),
    accessToken: cleanId(c.accessToken),
    refreshToken: cleanId(c.refreshToken),
    webhookSecret: cleanId(c.webhookSecret) || cleanId(c.secretKey),
    apiBase: (cleanId(c.apiBase) || 'https://open-api.tiktokglobalshop.com').replace(/\/+$/, ''),
    region: cleanId(c.region) || 'VN',
  };
}
function assertConfigured(cfg) {
  if (!cfg.appId || !cfg.secretKey) { const e = new Error('TikTok Shop chưa cấu hình App Key / App Secret.'); e.status = 400; throw e; }
}
function assertAuthorized(cfg) {
  assertConfigured(cfg);
  if (!cfg.accessToken || !cfg.shopCipher) { const e = new Error('Shop TikTok chưa ủy quyền (thiếu access_token/shop_cipher).'); e.status = 400; throw e; }
}

// ── Ký ──────────────────────────────────────────────────────────────────────
export function tiktokSign(secret, path, query, rawBody = '') {
  const keys = Object.keys(query).filter(k => k !== 'sign' && k !== 'access_token').sort();
  let base = path;
  for (const k of keys) base += k + query[k];
  base += rawBody || '';
  base = secret + base + secret;
  return crypto.createHmac('sha256', secret).update(base, 'utf8').digest('hex');
}

async function call(cfg, path, { method = 'GET', query = {}, body = null, branchId, _retried = false } = {}) {
  const q = {
    app_key: cfg.appId, timestamp: String(nowUnix()),
    ...(cfg.shopCipher ? { shop_cipher: cfg.shopCipher } : {}),
    ...Object.fromEntries(Object.entries(query).map(([k, v]) => [k, String(v)])),
  };
  const rawBody = body ? JSON.stringify(body) : '';
  q.sign = tiktokSign(cfg.secretKey, path, q, rawBody);
  const url = `${cfg.apiBase}${path}?${new URLSearchParams(q).toString()}`;
  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json', 'x-tts-access-token': cfg.accessToken },
    body: rawBody || undefined,
  });
  const data = await res.json().catch(() => ({}));
  const code = Number(data.code);
  if (code && code !== 0) {
    if (!_retried && branchId && /access_token|token.*expire|105002|105001/i.test(`${data.code} ${data.message || ''}`)) {
      await tiktokRefreshToken(branchId);
      return call(tiktokConfig(branchId), path, { method, query, body, branchId, _retried: true });
    }
    const e = new Error(`TikTok ${path}: ${data.code} ${data.message || ''}`.trim()); e.tiktok = data; throw e;
  }
  return data;
}

// ── OAuth (token endpoints KHÔNG ký) ────────────────────────────────────────
export function tiktokAuthLink(branchId, _redirect) {
  const cfg = tiktokConfig(branchId);
  assertConfigured(cfg);
  // TikTok Shop dùng service_id (khai ở Partner Center) cho link ủy quyền.
  const sid = cfg.serviceId || cfg.appId;
  return `${AUTHORIZE_URL}?service_id=${encodeURIComponent(sid)}`;
}
function persistTokens(branchId, patch) {
  updateIntegrations({ channels: { tiktokshop: patch } }, branchId);
}
export async function tiktokExchangeToken(branchId, authCode) {
  const cfg = tiktokConfig(branchId);
  assertConfigured(cfg);
  const q = new URLSearchParams({ app_key: cfg.appId, app_secret: cfg.secretKey, auth_code: cleanId(authCode), grant_type: 'authorized_code' });
  const res = await fetch(`${AUTH_BASE}/api/v2/token/get?${q.toString()}`);
  const data = await res.json().catch(() => ({}));
  const d = data.data || {};
  if (!d.access_token) throw new Error(`TikTok token exchange thất bại: ${data.message || data.code || 'unknown'}`);
  persistTokens(branchId, { accessToken: d.access_token, refreshToken: d.refresh_token });
  // Lấy shop_cipher đầu tiên của seller để gọi API shop.
  try {
    const shops = await call(tiktokConfig(branchId), `/authorization/${VERSION}/shops`, { branchId });
    const shop = shops.data?.shops?.[0];
    if (shop) persistTokens(branchId, { shopId: String(shop.id || ''), shopCipher: String(shop.cipher || '') });
  } catch { /* seller có thể cần chọn shop sau */ }
  audit('tiktok.oauth.token', {}, branchId, 'tiktok');
  return { ok: true, expire_in: d.access_token_expire_in };
}
export async function tiktokRefreshToken(branchId) {
  const cfg = tiktokConfig(branchId);
  assertConfigured(cfg);
  if (!cfg.refreshToken) throw new Error('TikTok thiếu refresh_token.');
  const q = new URLSearchParams({ app_key: cfg.appId, app_secret: cfg.secretKey, refresh_token: cfg.refreshToken, grant_type: 'refresh_token' });
  const res = await fetch(`${AUTH_BASE}/api/v2/token/refresh?${q.toString()}`);
  const data = await res.json().catch(() => ({}));
  const d = data.data || {};
  if (!d.access_token) throw new Error(`TikTok refresh thất bại: ${data.message || data.code || 'unknown'}`);
  persistTokens(branchId, { accessToken: d.access_token, refreshToken: d.refresh_token || cfg.refreshToken });
  audit('tiktok.oauth.refresh', {}, branchId, 'tiktok');
  return { ok: true };
}

// ── Ánh xạ SKU ──────────────────────────────────────────────────────────────
function tiktokSkuForLine(line, shopId, branchId) {
  const mapped = db.prepare(`SELECT internal_variant_id FROM external_products
    WHERE provider=? AND shop_domain=? AND external_product_id=? AND external_variant_id=?`)
    .get(PROVIDER, String(shopId), cleanId(line.product_id), cleanId(line.sku_id));
  if (mapped?.internal_variant_id && !String(mapped.internal_variant_id).startsWith('ttk_')) return mapped.internal_variant_id;
  const code = cleanId(line.seller_sku || line.sku_id);
  if (code) { const s = db.prepare(`SELECT id FROM skus WHERE (barcode=? OR id=?) AND branch_id=? AND active=1`).get(code, code, branchId); if (s) return s.id; }
  const name = cleanId(line.product_name || line.sku_name);
  if (name) { const s = db.prepare(`SELECT id FROM skus WHERE LOWER(name)=LOWER(?) AND branch_id=? AND active=1`).get(name, branchId); if (s) return s.id; }
  return null;
}
const WORKFLOW = {
  UNPAID: 'pending', ON_HOLD: 'pending', AWAITING_SHIPMENT: 'processed', AWAITING_COLLECTION: 'ready_to_ship',
  PARTIALLY_SHIPPING: 'shipping', IN_TRANSIT: 'shipping', DELIVERED: 'delivered', COMPLETED: 'delivered', CANCELLED: 'cancelled',
};
const PAID = new Set(['AWAITING_SHIPMENT', 'AWAITING_COLLECTION', 'PARTIALLY_SHIPPING', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED']);

export function syncTiktokOrder(order, shopId, branchId = 'sala') {
  const orderId = cleanId(order.id);
  if (!orderId) throw new Error('missing_tiktok_order_id');
  const shop = String(shopId);
  const status = cleanId(order.status).toUpperCase();
  const addr = order.recipient_address || {};
  const raw = Array.isArray(order.line_items) ? order.line_items : [];
  const grouped = new Map();
  for (const it of raw) {
    const key = cleanId(it.seller_sku || it.sku_id || it.product_name);
    const cur = grouped.get(key) || { line: it, qty: 0, ids: [] };
    cur.qty += Number(it.quantity || 1); cur.ids.push(it.id); grouped.set(key, cur);
  }
  const lines = [...grouped.values()];
  const subtotal = lines.reduce((s, g) => s + money(g.line.sale_price || g.line.original_price || 0) * g.qty, 0);
  const total = money(order.payment?.total_amount || order.total_amount || subtotal);
  const discount = Math.max(0, subtotal - total);
  const paid = PAID.has(status);
  const voided = status === 'CANCELLED';
  const customerJson = json({
    id: null, name: cleanId(addr.name), phone: cleanId(addr.phone_number), email: '',
    address: cleanId(addr.full_address), provider: PROVIDER, shop_domain: shop,
  });
  db.prepare('BEGIN IMMEDIATE').run();
  try {
    let internalId = db.prepare(`SELECT internal_order_id FROM external_orders WHERE provider=? AND shop_domain=? AND external_order_id=?`).get(PROVIDER, shop, orderId)?.internal_order_id;
    const priorState = internalId ? db.prepare(`SELECT locked_at FROM online_order_state WHERE order_id=?`).get(internalId) : null;
    if (!internalId) {
      internalId = uid('o_');
      db.prepare(`INSERT INTO orders (id,branch_id,table_id,channel,status,subtotal,discount,total,created_at,online_channel,online_ref,online_status,customer_json)
        VALUES (?,?,NULL,'online',?,?,?,?,?,?,?,?,?)`)
        .run(internalId, branchId, voided ? 'void' : 'open', subtotal, discount, total,
          order.create_time ? new Date(order.create_time * 1000).toISOString() : now(), PROVIDER, orderId, status, customerJson);
    } else {
      if (!priorState?.locked_at) db.prepare(`DELETE FROM order_items WHERE order_id=?`).run(internalId);
      db.prepare(`UPDATE orders SET status=?,online_status=?,customer_json=? WHERE id=?`).run(voided ? 'void' : 'open', status, customerJson, internalId);
    }
    if (!priorState?.locked_at) {
      const ins = db.prepare(`INSERT INTO order_items (id,order_id,menu_item_id,sku_id,item_code,item_barcode,unit_snapshot,name,emoji,qty,unit_price,vat_rate,station,sla_minutes,note,mods_json,status,created_at)
        VALUES (?,?,NULL,?,?,?,?,?,NULL,?,?,?, 'retail',0,?, '[]','served',?)`);
      for (const g of lines) {
        const l = g.line; const skuId = tiktokSkuForLine(l, shop, branchId);
        const sku = skuId ? db.prepare(`SELECT code,barcode,unit,vat FROM skus WHERE id=?`).get(skuId) : null;
        ins.run(uid('oi_'), internalId, skuId, l.seller_sku || sku?.code || null, l.sku_id || sku?.barcode || null,
          sku?.unit || 'cái', cleanId(l.product_name || l.sku_name) || 'TikTok item', g.qty,
          money(l.sale_price || l.original_price || 0), Number(sku?.vat) || 0, `ttk_item:${g.ids.join(',')}`, now());
      }
    }
    db.prepare(`INSERT INTO external_orders (id,provider,shop_domain,external_order_id,internal_order_id,external_order_code,sync_status,raw_payload,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(provider, shop_domain, external_order_id) DO UPDATE SET internal_order_id=excluded.internal_order_id,external_order_code=excluded.external_order_code,sync_status=excluded.sync_status,raw_payload=excluded.raw_payload,updated_at=excluded.updated_at`)
      .run(uid('eo_'), PROVIDER, shop, orderId, internalId, orderId, 'success', json(order), now(), now());
    const workflow = WORKFLOW[status] || 'pending'; const locked = workflow !== 'pending';
    db.prepare(`INSERT INTO online_order_state (order_id,workflow_status,locked_at,created_at,updated_at) VALUES (?,?,?,?,?)
      ON CONFLICT(order_id) DO UPDATE SET workflow_status=CASE WHEN excluded.workflow_status IN ('shipping','delivered','cancelled','return_refund') THEN excluded.workflow_status
        WHEN online_order_state.workflow_status IN ('preparing','ready_to_ship') THEN online_order_state.workflow_status ELSE excluded.workflow_status END,
        locked_at=COALESCE(online_order_state.locked_at,excluded.locked_at),updated_at=excluded.updated_at`)
      .run(internalId, workflow, locked ? now() : null, now(), now());
    db.prepare('COMMIT').run();
    let settlement = null;
    if (paid) {
      const canonical = db.prepare(`SELECT status FROM orders WHERE id=?`).get(internalId);
      const hasPayment = db.prepare(`SELECT 1 FROM payments WHERE order_id=? LIMIT 1`).get(internalId);
      if (canonical?.status !== 'paid' || !hasPayment) {
        settlement = payOrder(internalId, total > 0 ? [{ method: 'online', amount: total, reference: `${shop}:${orderId}`.slice(0, 250) }] : [], {
          cashier: `tiktok:${shop}`.slice(0, 120), idempotency_key: `connector:tiktokshop:${shop}:${orderId}:paid`.slice(0, 128),
          external_settlement: true, skip_channel_outbound: true,
        }, branchId);
      }
    }
    audit('tiktok.order.sync', { shop_id: shop, order_id: orderId, internal: internalId, status }, branchId, 'tiktok');
    emit('online:new', { id: internalId, provider: PROVIDER, ref: orderId, branch_id: branchId }, branchId);
    emit('stats:dirty', {}, branchId);
    return { internal_order_id: internalId, order_id: orderId, status, settlement };
  } catch (err) { db.prepare('ROLLBACK').run(); throw err; }
}

export async function pullTiktokOrders(branchId = 'sala', { since = '' } = {}) {
  const cfg = tiktokConfig(branchId);
  assertAuthorized(cfg);
  const createTimeGe = since ? Math.floor(new Date(since).getTime() / 1000) : nowUnix() - 15 * 86400;
  const orderIds = [];
  let pageToken = '';
  do {
    const search = await call(cfg, `/order/${VERSION}/orders/search`, {
      method: 'POST', query: { page_size: 50, ...(pageToken ? { page_token: pageToken } : {}) },
      body: { create_time_ge: createTimeGe }, branchId,
    });
    for (const o of search.data?.orders || []) orderIds.push(o.id);
    pageToken = cleanId(search.data?.next_page_token);
  } while (pageToken && orderIds.length < 500);
  const results = [];
  for (let i = 0; i < orderIds.length; i += 50) {
    const ids = orderIds.slice(i, i + 50);
    const detail = await call(cfg, `/order/${VERSION}/orders`, { query: { ids: ids.join(',') }, branchId });
    for (const o of detail.data?.orders || []) {
      try { results.push(syncTiktokOrder(o, cfg.shopId, branchId)); }
      catch (e) { audit('tiktok.order.sync_error', { order_id: o.id, error: e.message }, branchId, 'tiktok'); }
    }
  }
  return { pulled: results.length, orders: results };
}

// ── Kéo SẢN PHẨM (listing) về external_products ──────────────────────────────
// products/search (v202309). Mỗi sku là biến thể (variant = sku.id), seller_sku
// là mã đối chiếu kho. Ảnh best-effort từ main_images (search có thể không trả).
export async function pullTiktokProducts(branchId = 'sala', { pageSize = 50, maxPages = 30 } = {}) {
  const cfg = tiktokConfig(branchId);
  assertAuthorized(cfg);
  const shop = String(cfg.shopId || '');
  let pageToken = '', page = 0, synced = 0;
  do {
    const search = await call(cfg, `/product/${VERSION}/products/search`, {
      method: 'POST', query: { page_size: Math.min(100, pageSize), ...(pageToken ? { page_token: pageToken } : {}) },
      body: { status: 'ACTIVATE' }, branchId });
    for (const p of search.data?.products || []) {
      const itemId = cleanId(p.id);
      const name = cleanId(p.title);
      const image = (p.main_images?.[0]?.urls || [])[0] || '';
      const skus = Array.isArray(p.skus) ? p.skus : [];
      if (!skus.length) {
        upsertExternalProduct({ provider: PROVIDER, shop_domain: shop,
          external_product_id: itemId, external_variant_id: '', sku: '', name, image, raw: { product: p } });
        synced++;
        continue;
      }
      for (const s of skus) {
        const variantName = (s.sales_attributes || []).map(a => cleanId(a.value_name)).filter(Boolean).join(', ');
        upsertExternalProduct({ provider: PROVIDER, shop_domain: shop,
          external_product_id: itemId, external_variant_id: cleanId(s.id),
          sku: cleanId(s.seller_sku),
          name: [name, variantName].filter(Boolean).join(' - '), image, raw: { product: p, sku: s } });
        synced++;
      }
    }
    pageToken = cleanId(search.data?.next_page_token);
    page++;
  } while (pageToken && page < maxPages);
  audit('tiktok.product.sync', { shop_id: shop, synced }, branchId, 'tiktok');
  emit('online:updated', { kind: 'product_sync', provider: PROVIDER, synced }, branchId);
  return { synced };
}

// ── Webhook ──────────────────────────────────────────────────────────────────
function branchForShop(shopId) {
  const wanted = String(shopId);
  for (const b of listBranches({ all: true })) if (tiktokConfig(b.id).shopId === wanted) return b.id;
  return 'sala';
}
export async function handleTiktokWebhook(rawBody, headers = {}) {
  let payload = {};
  try { payload = JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '{}')); }
  catch { const e = new Error('TikTok webhook body không hợp lệ.'); e.status = 400; throw e; }
  const shopId = cleanId(payload.shop_id);
  const branchId = branchForShop(shopId);
  const cfg = tiktokConfig(branchId);
  const provided = cleanId(headers['authorization'] || headers['Authorization']);
  const body = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '');
  const expect = crypto.createHmac('sha256', cfg.secretKey).update(cfg.appId + body).digest('hex');
  if (!provided || provided.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expect))) {
    audit('tiktok.webhook.rejected', { shop_id: shopId, reason: 'bad_signature' }, branchId, 'tiktok');
    const e = new Error('Sai chữ ký webhook TikTok.'); e.status = 401; throw e;
  }
  // type 1 = ORDER_STATUS_CHANGE. Kéo lại chi tiết đơn (idempotent).
  const orderId = cleanId(payload.data?.order_id);
  if (orderId && cfg.accessToken && cfg.shopCipher) {
    try {
      const detail = await call(cfg, `/order/${VERSION}/orders`, { query: { ids: orderId }, branchId });
      const o = detail.data?.orders?.[0];
      if (o) { const r = syncTiktokOrder(o, cfg.shopId, branchId); return { handled: true, order: r.order_id }; }
    } catch (e) { audit('tiktok.webhook.sync_error', { order_id: orderId, error: e.message }, branchId, 'tiktok'); }
  }
  audit('tiktok.webhook', { shop_id: shopId, type: payload.type }, branchId, 'tiktok');
  return { handled: true };
}

// ── Shipping label ───────────────────────────────────────────────────────────
export async function tiktokWaybill(branchId = 'sala', orderId, { size = 'A6' } = {}) {
  const cfg = tiktokConfig(branchId);
  assertAuthorized(cfg);
  const data = await call(cfg, `/fulfillment/${VERSION}/orders/${encodeURIComponent(cleanId(orderId))}/shipping_document`,
    { query: { document_type: 'SHIPPING_LABEL', document_size: size }, branchId });
  const url = cfg && data.data?.doc_url;
  if (url) { const r = await fetch(url); return Buffer.from(await r.arrayBuffer()); }
  if (data.data?.doc_base64) return Buffer.from(data.data.doc_base64, 'base64');
  throw new Error('TikTok không trả shipping label.');
}

export function tiktokCapabilities(branchId = 'sala') {
  const cfg = tiktokConfig(branchId);
  const configured = !!(cfg.appId && cfg.secretKey);
  const authorized = configured && !!(cfg.accessToken && cfg.shopCipher);
  return {
    provider: PROVIDER, enabled: cfg.enabled, environment: cfg.environment, configured, authorized,
    status: authorized ? 'active' : configured ? 'pending_authorization' : 'pending_credentials',
    capabilities: { inbound_orders: authorized, waybill: authorized, webhook: configured },
  };
}
