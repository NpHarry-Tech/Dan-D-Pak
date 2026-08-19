// Shopee Open Platform v2 connector — REAL client.
//
// Signing (open.shopee.com/developer-guide):
//   • Public API  (auth/token): base = partner_id + path + timestamp
//   • Shop API    (order/logistics): base = partner_id + path + timestamp + access_token + shop_id
//   sign = HMAC-SHA256(base, partner_key) → hex, passed as `sign` query param.
// OAuth: authorize → callback(code, shop_id) → /api/v2/auth/token/get; refresh via
//   /api/v2/auth/access_token/get (access_token 4h, refresh_token 30d).
// Push webhook: Authorization header = HMAC-SHA256(push_url + "|" + raw_body, partner_key).
// Waybill: create_shipping_document → get_shipping_document_result → download_shipping_document (PDF).
//
// Đơn Shopee đi qua ĐÚNG ranh giới nghiệp vụ như Haravan: external_orders →
// ánh xạ SKU → orders(channel='online') → payOrder(external_settlement) → kho +
// hoá đơn + báo cáo. KHÔNG tạo domain khách/hàng/kho/thanh toán thứ hai.
import crypto from 'node:crypto';
import { db, uid, now, audit } from '../db.js';
import { emit } from '../realtime.js';
import { payOrder } from './payments.js';
import { getIntegrationChannel, updateIntegrations } from './settings.js';
import { listBranches } from './branches.js';

const PROVIDER = 'shopee';
const LIVE_BASE = 'https://partner.shopeemobile.com';
const TEST_BASE = 'https://partner.test-stable.shopeemobile.com';

const money = (n) => Math.round(Number(n) || 0);
const cleanId = (v) => String(v ?? '').trim();
const json = (v) => JSON.stringify(v ?? null);
const nowUnix = () => Math.floor(Date.now() / 1000);

export function shopeeConfig(branchId = 'sala') {
  const c = getIntegrationChannel('shopee', branchId) || {};
  const env = cleanId(c.environment) || 'sandbox';
  const base = cleanId(c.apiBase) || (env === 'production' ? LIVE_BASE : TEST_BASE);
  return {
    enabled: c.enabled === true,
    environment: env,
    partnerId: cleanId(c.partnerId),
    secretKey: cleanId(c.secretKey),
    shopId: cleanId(c.shopId),
    accessToken: cleanId(c.accessToken),
    refreshToken: cleanId(c.refreshToken),
    // Push ký bằng chính partner_key nếu không cấu hình webhookSecret riêng.
    webhookSecret: cleanId(c.webhookSecret) || cleanId(c.secretKey),
    apiBase: base.replace(/\/+$/, ''),
    region: cleanId(c.region) || 'VN',
  };
}

function assertConfigured(cfg) {
  if (!cfg.partnerId || !cfg.secretKey) {
    const e = new Error('Shopee chưa cấu hình Partner ID / Partner Key.');
    e.status = 400; throw e;
  }
}
function assertAuthorized(cfg) {
  assertConfigured(cfg);
  if (!cfg.shopId || !cfg.accessToken) {
    const e = new Error('Shop Shopee chưa được ủy quyền (thiếu shop_id/access_token). Hãy chạy kết nối OAuth.');
    e.status = 400; throw e;
  }
}

// ── Ký ────────────────────────────────────────────────────────────────────
function hmac(secret, base) { return crypto.createHmac('sha256', secret).update(base).digest('hex'); }
function signPublic(cfg, path, ts) { return hmac(cfg.secretKey, `${cfg.partnerId}${path}${ts}`); }
function signShop(cfg, path, ts) { return hmac(cfg.secretKey, `${cfg.partnerId}${path}${ts}${cfg.accessToken}${cfg.shopId}`); }

// ── Gọi API shop-level (tự làm mới token 1 lần khi hết hạn) ──────────────────
async function callShop(cfg, path, { method = 'GET', query = {}, body = null, branchId, _retried = false } = {}) {
  const ts = nowUnix();
  const params = new URLSearchParams({
    partner_id: cfg.partnerId, timestamp: String(ts),
    access_token: cfg.accessToken, shop_id: cfg.shopId, sign: signShop(cfg, path, ts),
    ...Object.fromEntries(Object.entries(query).map(([k, v]) => [k, String(v)])),
  });
  const res = await fetch(`${cfg.apiBase}${path}?${params.toString()}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  const err = cleanId(data.error);
  // access_token hết hạn → refresh rồi thử lại đúng một lần.
  if (!_retried && branchId && /token|auth/i.test(err) && /expire|invalid|error_auth/i.test(`${err} ${data.message || ''}`)) {
    await shopeeRefreshToken(branchId);
    return callShop(shopeeConfig(branchId), path, { method, query, body, branchId, _retried: true });
  }
  if (err) { const e = new Error(`Shopee ${path}: ${err} ${data.message || ''}`.trim()); e.shopee = data; throw e; }
  return data;
}

// ── OAuth ───────────────────────────────────────────────────────────────────
export function shopeeAuthLink(branchId, redirect) {
  const cfg = shopeeConfig(branchId);
  assertConfigured(cfg);
  const path = '/api/v2/shop/auth_partner';
  const ts = nowUnix();
  const params = new URLSearchParams({
    partner_id: cfg.partnerId, timestamp: String(ts), sign: signPublic(cfg, path, ts), redirect,
  });
  return `${cfg.apiBase}${path}?${params.toString()}`;
}

function persistTokens(branchId, { shopId, accessToken, refreshToken }) {
  const patch = { accessToken: cleanId(accessToken), refreshToken: cleanId(refreshToken) };
  if (shopId) patch.shopId = String(shopId);
  updateIntegrations({ channels: { shopee: patch } }, branchId);
}

export async function shopeeExchangeToken(branchId, code, shopId) {
  const cfg = shopeeConfig(branchId);
  assertConfigured(cfg);
  const path = '/api/v2/auth/token/get';
  const ts = nowUnix();
  const url = `${cfg.apiBase}${path}?partner_id=${cfg.partnerId}&timestamp=${ts}&sign=${signPublic(cfg, path, ts)}`;
  const res = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: cleanId(code), shop_id: Number(shopId), partner_id: Number(cfg.partnerId) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.access_token) throw new Error(`Shopee token exchange thất bại: ${data.message || data.error || 'unknown'}`);
  persistTokens(branchId, { shopId, accessToken: data.access_token, refreshToken: data.refresh_token });
  audit('shopee.oauth.token', { shop_id: String(shopId) }, branchId, 'shopee');
  return { shop_id: String(shopId), expire_in: data.expire_in };
}

export async function shopeeRefreshToken(branchId) {
  const cfg = shopeeConfig(branchId);
  assertAuthorized(cfg);
  const path = '/api/v2/auth/access_token/get';
  const ts = nowUnix();
  const url = `${cfg.apiBase}${path}?partner_id=${cfg.partnerId}&timestamp=${ts}&sign=${signPublic(cfg, path, ts)}`;
  const res = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: cfg.refreshToken, shop_id: Number(cfg.shopId), partner_id: Number(cfg.partnerId) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.access_token) throw new Error(`Shopee refresh token thất bại: ${data.message || data.error || 'unknown'}`);
  persistTokens(branchId, { shopId: cfg.shopId, accessToken: data.access_token, refreshToken: data.refresh_token });
  audit('shopee.oauth.refresh', { shop_id: cfg.shopId }, branchId, 'shopee');
  return { expire_in: data.expire_in };
}

// ── Ánh xạ SKU ──────────────────────────────────────────────────────────────
function shopeeSkuForLine(line, shopId, branchId) {
  const extProduct = cleanId(line.item_id);
  const extVariant = cleanId(line.model_id);
  // 1) mapping external_products đã liên kết
  const mapped = db.prepare(`SELECT internal_variant_id FROM external_products
    WHERE provider=? AND shop_domain=? AND external_product_id=? AND external_variant_id=?`)
    .get(PROVIDER, String(shopId), extProduct, extVariant);
  if (mapped?.internal_variant_id && !String(mapped.internal_variant_id).startsWith('shp_')) return mapped.internal_variant_id;
  // 2) theo SKU code / barcode người bán khai trên Shopee
  const code = cleanId(line.model_sku || line.item_sku);
  if (code) {
    const s = db.prepare(`SELECT id FROM skus WHERE (barcode=? OR id=?) AND branch_id=? AND active=1`).get(code, code, branchId);
    if (s) return s.id;
  }
  // 3) theo tên (khớp chính xác)
  const name = cleanId(line.item_name);
  if (name) {
    const s = db.prepare(`SELECT id FROM skus WHERE LOWER(name)=LOWER(?) AND branch_id=? AND active=1`).get(name, branchId);
    if (s) return s.id;
  }
  return null; // chưa map → order_item.sku_id NULL → vào product_attention
}

const WORKFLOW = {
  UNPAID: 'pending', READY_TO_SHIP: 'processed', PROCESSED: 'processed', RETRY_SHIP: 'processed',
  SHIPPED: 'shipping', TO_CONFIRM_RECEIVE: 'shipping', IN_CANCEL: 'processed',
  COMPLETED: 'delivered', CANCELLED: 'cancelled', TO_RETURN: 'return_refund', INVOICE_PENDING: 'processed',
};

// Đơn Shopee đã qua UNPAID nghĩa là buyer đã thanh toán (hoặc COD đã xác nhận) →
// ghi nhận doanh thu như kênh trả trước, giống online.receive/Haravan.
const PAID_STATUSES = new Set(['READY_TO_SHIP', 'PROCESSED', 'RETRY_SHIP', 'SHIPPED', 'TO_CONFIRM_RECEIVE', 'COMPLETED', 'INVOICE_PENDING']);

export function syncShopeeOrder(detail, shopId, branchId = 'sala') {
  const orderSn = cleanId(detail.order_sn);
  if (!orderSn) throw new Error('missing_shopee_order_sn');
  const shop = String(shopId);
  const status = cleanId(detail.order_status).toUpperCase();
  const lines = Array.isArray(detail.item_list) ? detail.item_list : [];
  const addr = detail.recipient_address || {};
  const subtotal = lines.reduce((s, l) => s + money(l.model_discounted_price || l.model_original_price || 0) * Math.max(1, Number(l.model_quantity_purchased || 1)), 0);
  const total = money(detail.total_amount || subtotal);
  const discount = Math.max(0, subtotal - total);
  const paid = PAID_STATUSES.has(status);
  const voided = status === 'CANCELLED';
  const customerJson = json({
    id: null, name: cleanId(addr.name || detail.buyer_username), phone: cleanId(addr.phone),
    email: '', address: cleanId(addr.full_address), provider: PROVIDER, shop_domain: shop,
    note: cleanId(detail.message_to_seller),
  });

  db.prepare('BEGIN IMMEDIATE').run();
  try {
    let internalId = db.prepare(`SELECT internal_order_id FROM external_orders WHERE provider=? AND shop_domain=? AND external_order_id=?`)
      .get(PROVIDER, shop, orderSn)?.internal_order_id;
    const priorState = internalId
      ? db.prepare(`SELECT locked_at FROM online_order_state WHERE order_id=?`).get(internalId) : null;

    if (!internalId) {
      internalId = uid('o_');
      db.prepare(`INSERT INTO orders
        (id,branch_id,table_id,channel,status,subtotal,discount,total,created_at,online_channel,online_ref,online_status,customer_json)
        VALUES (?,?,NULL,'online',?,?,?,?,?,?,?,?,?)`)
        .run(internalId, branchId, voided ? 'void' : 'open', subtotal, discount, total,
          detail.create_time ? new Date(detail.create_time * 1000).toISOString() : now(),
          PROVIDER, orderSn, status, customerJson);
    } else {
      if (!priorState?.locked_at) db.prepare(`DELETE FROM order_items WHERE order_id=?`).run(internalId);
      db.prepare(`UPDATE orders SET status=?,online_status=?,customer_json=? WHERE id=?`)
        .run(voided ? 'void' : 'open', status, customerJson, internalId);
    }

    if (!priorState?.locked_at) {
      const ins = db.prepare(`INSERT INTO order_items
        (id,order_id,menu_item_id,sku_id,item_code,item_barcode,unit_snapshot,name,emoji,qty,unit_price,vat_rate,station,sla_minutes,note,mods_json,status,created_at)
        VALUES (?,?,NULL,?,?,?,?,?,NULL,?,?,?, 'retail',0,?, '[]','served',?)`);
      for (const l of lines) {
        const skuId = shopeeSkuForLine(l, shop, branchId);
        const sku = skuId ? db.prepare(`SELECT code,barcode,unit,vat FROM skus WHERE id=?`).get(skuId) : null;
        ins.run(uid('oi_'), internalId, skuId, l.item_sku || sku?.code || null,
          l.model_sku || sku?.barcode || null, sku?.unit || 'cái',
          cleanId(l.item_name) || 'Shopee item',
          Math.max(1, Number(l.model_quantity_purchased || 1)),
          money(l.model_discounted_price || l.model_original_price || 0), Number(sku?.vat) || 0,
          null, now());
      }
    }

    db.prepare(`INSERT INTO external_orders
      (id,provider,shop_domain,external_order_id,internal_order_id,external_order_code,sync_status,raw_payload,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(provider, shop_domain, external_order_id) DO UPDATE SET
        internal_order_id=excluded.internal_order_id,external_order_code=excluded.external_order_code,
        sync_status=excluded.sync_status,raw_payload=excluded.raw_payload,updated_at=excluded.updated_at`)
      .run(uid('eo_'), PROVIDER, shop, orderSn, internalId, orderSn, 'success', json(detail), now(), now());

    const workflow = WORKFLOW[status] || 'pending';
    const locked = workflow !== 'pending';
    db.prepare(`INSERT INTO online_order_state (order_id,workflow_status,locked_at,created_at,updated_at)
      VALUES (?,?,?,?,?) ON CONFLICT(order_id) DO UPDATE SET
        workflow_status=CASE
          WHEN excluded.workflow_status IN ('shipping','delivered','cancelled','return_refund') THEN excluded.workflow_status
          WHEN online_order_state.workflow_status IN ('preparing','ready_to_ship') THEN online_order_state.workflow_status
          ELSE excluded.workflow_status END,
        locked_at=COALESCE(online_order_state.locked_at,excluded.locked_at),updated_at=excluded.updated_at`)
      .run(internalId, workflow, locked ? now() : null, now(), now());
    db.prepare('COMMIT').run();

    let settlement = null;
    if (paid) {
      const canonical = db.prepare(`SELECT status FROM orders WHERE id=?`).get(internalId);
      const hasPayment = db.prepare(`SELECT 1 FROM payments WHERE order_id=? LIMIT 1`).get(internalId);
      if (canonical?.status !== 'paid' || !hasPayment) {
        settlement = payOrder(internalId, total > 0 ? [{
          method: 'online', amount: total, reference: `${shop}:${orderSn}`.slice(0, 250),
        }] : [], {
          cashier: `shopee:${shop}`.slice(0, 120),
          idempotency_key: `connector:shopee:${shop}:${orderSn}:paid`.slice(0, 128),
          external_settlement: true,
          skip_channel_outbound: true,
        }, branchId);
      }
    }
    audit('shopee.order.sync', { shop_id: shop, order_sn: orderSn, order_id: internalId, status }, branchId, 'shopee');
    emit('online:new', { id: internalId, provider: PROVIDER, ref: orderSn, branch_id: branchId }, branchId);
    emit('stats:dirty', {}, branchId);
    return { internal_order_id: internalId, order_sn: orderSn, status, settlement };
  } catch (err) {
    db.prepare('ROLLBACK').run();
    throw err;
  }
}

// ── Kéo đơn ──────────────────────────────────────────────────────────────────
export async function pullShopeeOrders(branchId = 'sala', { since = '', orderStatus = '' } = {}) {
  const cfg = shopeeConfig(branchId);
  assertAuthorized(cfg);
  const timeTo = nowUnix();
  // Cửa sổ get_order_list tối đa 15 ngày.
  const timeFrom = since ? Math.floor(new Date(since).getTime() / 1000) : timeTo - 15 * 86400;
  const query = {
    time_range_field: 'create_time', time_from: timeFrom, time_to: timeTo,
    page_size: 50, response_optional_fields: 'order_status',
  };
  if (orderStatus) query.order_status = orderStatus;
  let cursor = '';
  const orderSns = [];
  do {
    const list = await callShop(cfg, '/api/v2/order/get_order_list', { query: cursor ? { ...query, cursor } : query, branchId });
    for (const o of list.response?.order_list || []) orderSns.push(o.order_sn);
    cursor = list.response?.more ? cleanId(list.response?.next_cursor) : '';
  } while (cursor);

  const results = [];
  for (let i = 0; i < orderSns.length; i += 50) {
    const batch = orderSns.slice(i, i + 50);
    const detail = await callShop(cfg, '/api/v2/order/get_order_detail', {
      query: {
        order_sn_list: batch.join(','),
        response_optional_fields: 'item_list,recipient_address,total_amount,order_status,buyer_username,message_to_seller,create_time',
      }, branchId,
    });
    for (const od of detail.response?.order_list || []) {
      try { results.push(syncShopeeOrder(od, cfg.shopId, branchId)); }
      catch (e) { audit('shopee.order.sync_error', { order_sn: od.order_sn, error: e.message }, branchId, 'shopee'); }
    }
  }
  return { pulled: results.length, orders: results };
}

// ── Webhook push ─────────────────────────────────────────────────────────────
function branchForShop(shopId) {
  const wanted = String(shopId);
  for (const b of listBranches({ all: true })) {
    if (shopeeConfig(b.id).shopId === wanted) return b.id;
  }
  return 'sala';
}

// Push ký = HMAC-SHA256(push_url + "|" + raw_body). push_url phải KHỚP tuyệt đối
// URL đã khai trong Shopee Console. Behind proxy nên thử vài biến thể host/scheme.
function verifyShopeePush(cfg, rawBody, headers, candidateUrls) {
  const provided = cleanId(headers['authorization'] || headers['Authorization'] || headers['x-shopee-signature']);
  if (!provided || !cfg.webhookSecret) return false;
  const body = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '');
  for (const url of candidateUrls) {
    const expect = hmac(cfg.webhookSecret, `${url}|${body}`);
    if (safeEqualHex(expect, provided)) return true;
  }
  // Một số cấu hình ký chỉ trên body.
  return safeEqualHex(hmac(cfg.webhookSecret, body), provided);
}
function safeEqualHex(a, b) {
  const x = Buffer.from(cleanId(a), 'utf8'); const y = Buffer.from(cleanId(b), 'utf8');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export async function handleShopeePush(rawBody, headers = {}, candidateUrls = []) {
  let payload = {};
  try { payload = JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '{}')); }
  catch { const e = new Error('Shopee push body không hợp lệ.'); e.status = 400; throw e; }
  const shopId = cleanId(payload.shop_id);
  const branchId = branchForShop(shopId);
  const cfg = shopeeConfig(branchId);
  if (!verifyShopeePush(cfg, rawBody, headers, candidateUrls)) {
    audit('shopee.push.rejected', { shop_id: shopId, reason: 'bad_signature' }, branchId, 'shopee');
    const e = new Error('Sai chữ ký push Shopee.'); e.status = 401; throw e;
  }
  const code = Number(payload.code);
  // code 3 = order status push. Kéo lại chi tiết đơn để đồng bộ (idempotent).
  if (code === 3 && cfg.shopId && cfg.accessToken) {
    const orderSn = cleanId(payload.data?.ordersn || payload.data?.order_sn);
    if (orderSn) {
      const detail = await callShop(cfg, '/api/v2/order/get_order_detail', {
        query: { order_sn_list: orderSn, response_optional_fields: 'item_list,recipient_address,total_amount,order_status,buyer_username,message_to_seller,create_time' },
        branchId,
      });
      const od = detail.response?.order_list?.[0];
      if (od) { const r = syncShopeeOrder(od, cfg.shopId, branchId); return { handled: true, code, order: r.order_sn }; }
    }
  }
  audit('shopee.push', { shop_id: shopId, code }, branchId, 'shopee');
  return { handled: true, code };
}

// ── Tem vận đơn (waybill PDF) ────────────────────────────────────────────────
export async function shopeeWaybill(branchId = 'sala', orderSn, { type = 'THERMAL_AIR_WAYBILL' } = {}) {
  const cfg = shopeeConfig(branchId);
  assertAuthorized(cfg);
  const orderList = [{ order_sn: cleanId(orderSn), shipping_document_type: type }];
  await callShop(cfg, '/api/v2/logistics/create_shipping_document', { method: 'POST', body: { order_list: orderList }, branchId });
  await callShop(cfg, '/api/v2/logistics/get_shipping_document_result', { method: 'POST', body: { order_list: orderList }, branchId });
  const ts = nowUnix();
  const path = '/api/v2/logistics/download_shipping_document';
  const params = new URLSearchParams({
    partner_id: cfg.partnerId, timestamp: String(ts), access_token: cfg.accessToken,
    shop_id: cfg.shopId, sign: signShop(cfg, path, ts),
  });
  const res = await fetch(`${cfg.apiBase}${path}?${params.toString()}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shipping_document_type: type, order_list: orderList }),
  });
  if (!res.ok || !/pdf/i.test(res.headers.get('content-type') || '')) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Shopee tải waybill thất bại: ${errText.slice(0, 200) || res.status}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

export function shopeeCapabilities(branchId = 'sala') {
  const cfg = shopeeConfig(branchId);
  const configured = !!(cfg.partnerId && cfg.secretKey);
  const authorized = configured && !!(cfg.shopId && cfg.accessToken);
  return {
    provider: PROVIDER, enabled: cfg.enabled, environment: cfg.environment,
    configured, authorized,
    status: authorized ? 'active' : configured ? 'pending_authorization' : 'pending_credentials',
    capabilities: { inbound_orders: authorized, waybill: authorized, push: configured },
  };
}
