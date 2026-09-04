import crypto from 'node:crypto';
import { db, uid, now, audit } from '../db.js';
import { safeEqual } from '../core/util.js';
import { env } from '../config/env.js';
import { emit } from '../realtime.js';
import { getIntegrationChannel } from './settings.js';
import { decryptSecret, encryptSecret, isEncrypted } from '../core/crypto.js';
import { recordPurchase, reversePurchase } from './customers.js';
import { payOrder } from './payments.js';

const PROVIDER = 'haravan';
const AUTH_BASE = 'https://accounts.haravan.com';
const WEBHOOK_BASE = 'https://webhook.haravan.com';
// Scope PHẢI khớp scope app đã đăng ký ở Haravan Partners, nếu không Haravan
// trả invalid_scope. Quyền tài nguyên (com.read_orders…) KHÔNG nằm trong scope
// OAuth mà được cấp qua `grant_service` + scope đã cấu hình của app.
const DEFAULT_SCOPES = 'openid profile address email phone org userinfo grant_service wh_api';
const SUPPORTED_TOPICS = new Set([
  'orders/create', 'orders/updated', 'orders/update', 'orders/cancelled', 'orders/cancel', 'orders/paid',
  'customers/create', 'customers/update',
  'products/create', 'products/update', 'products/delete',
  'inventory/update', 'inventorylocationbalances/update',
]);

let workerRunning = false;
let outboundWorkerRunning = false;
let timer = null;
let inventoryTimer = null;
let recoveryTimer = null;
let syncAllRunning = false;

function json(v) { return JSON.stringify(v ?? null); }
function parseJsonText(text) { return text ? JSON.parse(text) : {}; }
function money(value) { return Math.round(Number(value || 0)); }
function cleanId(value) { return String(value ?? '').trim(); }
function normShop(value) { return cleanId(value).replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase(); }
function hmac(rawBody, secret) { return crypto.createHmac('sha256', secret).update(rawBody).digest('base64'); }
function base64urlJson(token) {
  try { return JSON.parse(Buffer.from(String(token).split('.')[1] || '', 'base64url').toString('utf8')); } catch { return {}; }
}
function header(headers = {}, name) {
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers || {})) if (key.toLowerCase() === lower) return String(headers[key] || '');
  return '';
}
function signatureFrom(headers) {
  return header(headers, 'x-haravan-hmacsha256') || header(headers, 'x-haravan-hmac-sha256');
}

function legacyConfig() {
  const c = getIntegrationChannel('haravan');
  return {
    enabled: c.enabled || env.HARAVAN_ENABLED,
    shopDomain: normShop(c.shopDomain || env.HARAVAN_SHOP_DOMAIN || ''),
    accessToken: c.accessToken || env.HARAVAN_ACCESS_TOKEN || '',
    refreshToken: '',
    webhookSecret: c.webhookSecret || env.HARAVAN_WEBHOOK_SECRET || env.HARAVAN_CLIENT_SECRET || '',
    clientId: c.clientId || env.HARAVAN_CLIENT_ID || '',
    clientSecret: c.clientSecret || env.HARAVAN_CLIENT_SECRET || '',
    verifyToken: c.verifyToken || env.HARAVAN_WEBHOOK_VERIFY_TOKEN || '',
    apiBase: c.apiBase || env.HARAVAN_API_BASE_URL || 'https://apis.haravan.com',
    defaultBranchId: c.defaultBranchId || env.HARAVAN_DEFAULT_BRANCH_ID || 'ONLINE',
    locationId: c.locationId || env.HARAVAN_LOCATION_ID || '',
    syncOrders: c.syncOrders === true,
    syncCustomers: c.syncCustomers !== false,
    syncProducts: c.syncProducts !== false,
    syncInventory: c.syncInventory !== false,
  };
}

function installedShop(shopDomain) {
  const shop = normShop(shopDomain);
  if (!shop) return null;
  return db.prepare(`SELECT * FROM haravan_shops WHERE shop_domain=? AND active=1`).get(shop) || null;
}

function config(shopDomain = '') {
  const installed = installedShop(shopDomain);
  const fallback = legacyConfig();
  if (installed) {
    if (!isEncrypted(installed.access_token) ||
        (installed.refresh_token && !isEncrypted(installed.refresh_token))) {
      const access = encryptSecret(installed.access_token, `haravan:${installed.shop_domain}:access`);
      const refresh = installed.refresh_token
        ? encryptSecret(installed.refresh_token, `haravan:${installed.shop_domain}:refresh`)
        : null;
      db.prepare(`UPDATE haravan_shops SET access_token=?,refresh_token=?,updated_at=? WHERE id=?`)
        .run(access, refresh, now(), installed.id);
      installed.access_token = access;
      installed.refresh_token = refresh;
    }
    return {
    enabled: true,
    shopDomain: installed.shop_domain,
    accessToken: decryptSecret(installed.access_token, `haravan:${installed.shop_domain}:access`),
    refreshToken: decryptSecret(installed.refresh_token || '', `haravan:${installed.shop_domain}:refresh`),
    webhookSecret: env.HARAVAN_CLIENT_SECRET || fallback.webhookSecret,
    clientId: env.HARAVAN_CLIENT_ID || fallback.clientId,
    clientSecret: env.HARAVAN_CLIENT_SECRET || fallback.clientSecret,
    verifyToken: env.HARAVAN_WEBHOOK_VERIFY_TOKEN || fallback.verifyToken,
    apiBase: installed.api_base || 'https://apis.haravan.com',
    defaultBranchId: installed.branch_id || 'ONLINE',
    locationId: installed.location_id || fallback.locationId,
    syncOrders: fallback.syncOrders,
    syncCustomers: fallback.syncCustomers,
    syncProducts: fallback.syncProducts,
    syncInventory: fallback.syncInventory,
  };
  }
  if (!shopDomain || fallback.shopDomain === normShop(shopDomain)) return fallback;
  return { ...fallback, shopDomain: normShop(shopDomain) };
}

function defaultBranch(shopDomain = '') {
  const wanted = cleanId(config(shopDomain).defaultBranchId);
  const exact = wanted && db.prepare(`SELECT id FROM branches
    WHERE active=1 AND (lower(id)=lower(?) OR lower(name)=lower(?) OR lower(code)=lower(?)) LIMIT 1`)
    .get(wanted, wanted, wanted);
  if (exact?.id) return exact.id;
  const active = db.prepare(`SELECT id FROM branches WHERE active=1 ORDER BY sort,name`).all();
  if (active.length === 1) return active[0].id;
  throw new Error(`HARAVAN_DEFAULT_BRANCH_ID does not match an active branch: ${wanted || '(empty)'}`);
}

function topicEnabled(topic, cfg = config()) {
  if (!cfg.enabled) return false;
  if (topic.startsWith('orders/')) return cfg.syncOrders;
  if (topic.startsWith('customers/')) return cfg.syncCustomers;
  if (topic.startsWith('products/')) return cfg.syncProducts;
  if (topic === 'inventory/update' || topic === 'inventorylocationbalances/update') return cfg.syncInventory;
  return false;
}

export function verifyHaravanWebhook(rawBody, signature, secret = config().webhookSecret) {
  if (!secret || !signature) return false;
  return safeEqual(hmac(rawBody, secret), signature);
}

function verifyWebhookForShop(rawBody, signature, shopDomain) {
  const cfg = config(shopDomain);
  const secrets = [cfg.clientSecret, cfg.webhookSecret, env.HARAVAN_CLIENT_SECRET, env.HARAVAN_WEBHOOK_SECRET]
    .map(cleanId).filter(Boolean);
  return secrets.some(secret => verifyHaravanWebhook(rawBody, signature, secret));
}

function externalIdFor(topic, payload) {
  if (topic.startsWith('orders/')) return cleanId(payload.id || payload.order_id || payload.order_number);
  if (topic.startsWith('customers/')) return cleanId(payload.id || payload.customer?.id || payload.email || payload.phone);
  if (topic.startsWith('products/')) return cleanId(payload.id || payload.product_id || payload.handle);
  if (topic === 'inventory/update' || topic === 'inventorylocationbalances/update') {
    const item = payload.inventory_location_balance || payload.inventoryLocationBalance || payload;
    return cleanId(item.id || item.inventory_item_id || item.variant_id || item.product_variant_id || item.sku);
  }
  return cleanId(payload.id);
}

export function writeSyncLog({ shop_domain = '', topic, external_id, status, error_message = '', raw_payload = null, retry_count = 0, next_retry_at = null, direction = 'inbound', session_id = null }) {
  const id = uid('sl_');
  db.prepare(`INSERT INTO sync_logs
    (id,provider,shop_domain,topic,external_id,status,error_message,raw_payload,retry_count,next_retry_at,created_at,direction,session_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, PROVIDER, normShop(shop_domain), topic || null, external_id || null, status, error_message || null,
      raw_payload == null ? null : json(raw_payload), retry_count, next_retry_at, now(), direction, session_id);
  return id;
}

export function verifyHaravanSubscribe(reqQuery = {}) {
  const cfg = config();
  const mode = reqQuery['hub.mode'];
  const token = reqQuery['hub.verify_token'];
  const challenge = reqQuery['hub.challenge'];
  if (mode === 'subscribe' && cfg.verifyToken && token === cfg.verifyToken) return String(challenge || '');
  const e = new Error('invalid_haravan_verify_token'); e.status = 401; throw e;
}

export function handleHaravanWebhook(rawBody, headers = {}) {
  const signature = signatureFrom(headers);
  const topic = header(headers, 'x-haravan-topic') || header(headers, 'x-haravan-event') || '';
  const shop = normShop(header(headers, 'x-haravan-shop-domain') || legacyConfig().shopDomain || '');

  if (!verifyWebhookForShop(rawBody, signature, shop)) {
    writeSyncLog({ shop_domain: shop, topic, status: 'failed', error_message: 'invalid_webhook_signature', raw_payload: rawBody.toString('utf8') });
    const err = new Error('invalid_webhook_signature'); err.status = 401; throw err;
  }

  const payload = parseJsonText(rawBody.toString('utf8'));
  const external_id = externalIdFor(topic, payload);
  const raw_payload = { shop, payload };
  const supported = SUPPORTED_TOPICS.has(topic) && topicEnabled(topic, config(shop));
  const duplicate = db.prepare(`SELECT id FROM sync_logs
    WHERE provider=? AND shop_domain=? AND topic=? AND external_id=? AND raw_payload=?
      AND status IN ('received','retrying','success','ignored')
    ORDER BY created_at DESC LIMIT 1`)
    .get(PROVIDER, shop, topic, external_id, json(raw_payload));
  if (duplicate) return { ok: true, log_id: duplicate.id, duplicate: true };
  const logId = writeSyncLog({
    shop_domain: shop,
    topic,
    external_id,
    status: supported ? 'received' : 'ignored',
    raw_payload,
  });
  if (supported) setImmediate(() => processHaravanQueue());
  return { ok: true, log_id: logId };
}

export function installUrl({ branch_id = 'ONLINE', redirect_uri = '' } = {}) {
  const cfg = legacyConfig();
  if (!cfg.clientId) throw new Error('HARAVAN_CLIENT_ID is not set');
  const redirect = redirect_uri || `${env.APP_URL || env.API_BASE_URL || ''}/auth/haravan/callback`;
  const state = Buffer.from(JSON.stringify({ branch_id, ts: Date.now(), n: crypto.randomBytes(8).toString('hex') })).toString('base64url');
  const u = new URL('/connect/authorize', AUTH_BASE);
  u.searchParams.set('response_mode', 'query');
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', env.HARAVAN_SCOPES || DEFAULT_SCOPES);
  u.searchParams.set('client_id', cfg.clientId);
  u.searchParams.set('redirect_uri', redirect);
  u.searchParams.set('state', state);
  return { url: u.toString(), state, redirect_uri: redirect };
}

async function tokenExchange(code, redirect_uri) {
  const cfg = legacyConfig();
  if (!cfg.clientId || !cfg.clientSecret) throw new Error('HARAVAN_CLIENT_ID/HARAVAN_CLIENT_SECRET are not set');
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    code,
    redirect_uri,
  });
  const res = await fetch(`${AUTH_BASE}/connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error_description || data.error || `Haravan OAuth ${res.status}`);
  return data;
}

export async function oauthCallback({ code, state, shop, redirect_uri }) {
  if (!code) throw new Error('missing_haravan_oauth_code');
  const stateData = (() => { try { return JSON.parse(Buffer.from(String(state || ''), 'base64url').toString('utf8')); } catch { return {}; } })();
  const tokens = await tokenExchange(code, redirect_uri || `${env.APP_URL || env.API_BASE_URL || ''}/auth/haravan/callback`);
  const claims = base64urlJson(tokens.id_token);
  const shopDomain = normShop(shop || claims.org_name || claims.org_domain || claims.shop_domain || claims.domain || '');
  if (!shopDomain) throw new Error('Haravan OAuth did not return shop domain; pass ?shop=your-shop.myharavan.com to callback.');
  const expiresAt = tokens.expires_in ? new Date(Date.now() + Number(tokens.expires_in) * 1000).toISOString() : null;
  db.prepare(`INSERT INTO haravan_shops
    (id,shop_domain,org_id,branch_id,access_token,refresh_token,scope,token_type,expires_at,location_id,api_base,installed_at,updated_at,active,raw_payload)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(shop_domain) DO UPDATE SET
      org_id=excluded.org_id,branch_id=excluded.branch_id,access_token=excluded.access_token,
      refresh_token=excluded.refresh_token,scope=excluded.scope,token_type=excluded.token_type,
      expires_at=excluded.expires_at,api_base=excluded.api_base,updated_at=excluded.updated_at,active=1,raw_payload=excluded.raw_payload`)
    .run(uid('hshop_'), shopDomain, cleanId(claims.org_id || claims.orgid || ''), stateData.branch_id || legacyConfig().defaultBranchId,
      encryptSecret(tokens.access_token, `haravan:${shopDomain}:access`),
      tokens.refresh_token ? encryptSecret(tokens.refresh_token, `haravan:${shopDomain}:refresh`) : null,
      tokens.scope || '', tokens.token_type || 'Bearer',
      expiresAt, legacyConfig().locationId || null, legacyConfig().apiBase, now(), now(), 1, json({ tokens: { ...tokens, access_token: '***', refresh_token: tokens.refresh_token ? '***' : undefined }, claims }));
  audit('haravan.oauth.install', { shop_domain: shopDomain, scope: tokens.scope || '' }, stateData.branch_id || legacyConfig().defaultBranchId, 'haravan');
  await subscribeWebhook(shopDomain).catch(err => writeSyncLog({ shop_domain: shopDomain, topic: 'webhook/subscribe', status: 'failed', error_message: err.message }));
  return { ok: true, shopDomain, branch_id: stateData.branch_id || legacyConfig().defaultBranchId };
}

async function haravanRequest(path, { shopDomain = '', method = 'GET', body = null } = {}) {
  const cfg = config(shopDomain);
  if (!cfg.accessToken) throw new Error('HARAVAN_ACCESS_TOKEN is not set');
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${cfg.apiBase || 'https://apis.haravan.com'}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${cfg.accessToken}`,
          'X-Haravan-Access-Token': cfg.accessToken,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? json(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error_description || data.error || data.message || `Haravan API ${res.status}`);
      return data;
    } catch (err) {
      lastError = err;
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 500 * (2 ** attempt)));
    }
  }
  throw lastError;
}

// host + path, KHÔNG kèm query/token — an toàn để ghi vào log chẩn đoán.
function safeEndpoint(url) {
  try { const u = new URL(url); return `${u.host}${u.pathname}`; }
  catch { return String(url).split('?')[0]; }
}

async function webhookSubscribeRequest(shopDomain, method = 'POST') {
  const cfg = config(shopDomain);
  const url = `${WEBHOOK_BASE}/api/subscribe`;
  const shop = normShop(shopDomain || cfg.shopDomain);
  const startedAt = Date.now();
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.accessToken}` },
      body: method === 'POST' ? '{}' : undefined,
    });
  } catch (netErr) {
    // Lỗi mạng/DNS/TLS TRƯỚC khi có response — vẫn phải điều tra được.
    const e = new Error(`Haravan webhook ${method} loi mang: ${netErr.message}`);
    e.diagnostic = {
      stage: 'network', method, endpoint: safeEndpoint(url), shop_domain: shop,
      latency_ms: Date.now() - startedAt, cause: netErr.code || netErr.name || 'network_error',
    };
    throw e;
  }
  const latency_ms = Date.now() - startedAt;
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error === true) {
    const message = String(data.message || data.error || `Haravan webhook ${res.status}`).slice(0, 200);
    const e = new Error(message);
    e.status = res.status;
    // Chẩn đoán CÓ CẤU TRÚC, đã REDACT (không bao giờ chứa access token — token chỉ
    // nằm trong header request, không đưa vào đây). Đủ để so với tài liệu Haravan.
    e.diagnostic = {
      stage: 'http', method, endpoint: safeEndpoint(url), http_status: res.status,
      haravan_code: data.code || data.error_code || null,
      haravan_message: message, shop_domain: shop, latency_ms,
    };
    throw e;
  }
  return data;
}

export async function subscribeWebhook(shopDomain = '') {
  const shop = normShop(shopDomain || config(shopDomain).shopDomain);
  try {
    const data = await webhookSubscribeRequest(shopDomain, 'POST');
    audit('haravan.webhook.subscribe', { shop_domain: shop }, defaultBranch(shopDomain), 'haravan');
    return data;
  } catch (err) {
    // "Nhận từ Haravan • 1" đỏ mà không rõ vì sao: ghi lại chẩn đoán có cấu trúc
    // (status/endpoint/haravan_message/latency, KHÔNG token) để còn điều tra được.
    try {
      writeSyncLog({ shop_domain: shop, topic: 'webhook/subscribe', status: 'failed',
        error_message: err.message, raw_payload: err.diagnostic || null });
    } catch { /* logging must not mask the real error */ }
    throw err;
  }
}

export async function unsubscribeWebhook(shopDomain = '') {
  const shop = normShop(shopDomain || config(shopDomain).shopDomain);
  try {
    const data = await webhookSubscribeRequest(shopDomain, 'DELETE');
    audit('haravan.webhook.unsubscribe', { shop_domain: shop }, defaultBranch(shopDomain), 'haravan');
    return data;
  } catch (err) {
    try {
      writeSyncLog({ shop_domain: shop, topic: 'webhook/unsubscribe', status: 'failed',
        error_message: err.message, raw_payload: err.diagnostic || null });
    } catch { /* logging must not mask the real error */ }
    throw err;
  }
}

function upsertState(shopDomain, resource, cursor) {
  db.prepare(`INSERT INTO haravan_sync_state (id,shop_domain,resource,cursor,updated_at)
    VALUES (?,?,?,?,?)
    ON CONFLICT(shop_domain, resource) DO UPDATE SET cursor=excluded.cursor,updated_at=excluded.updated_at`)
    .run(uid('hss_'), normShop(shopDomain), resource, String(cursor ?? ''), now());
}
function getState(shopDomain, resource) {
  return db.prepare(`SELECT cursor FROM haravan_sync_state WHERE shop_domain=? AND resource=?`).get(normShop(shopDomain), resource)?.cursor || '';
}

function upsertCustomer(payload, shopDomain = '', branch_id = defaultBranch(shopDomain)) {
  const customer = payload.customer || payload;
  const externalId = cleanId(customer.id || customer.customer_id || customer.email || customer.phone);
  if (!externalId) return null;
  const name = [customer.first_name, customer.last_name].filter(Boolean).join(' ').trim()
    || customer.name || customer.full_name || customer.email || customer.phone || 'Khách Haravan';
  const phone = cleanId(customer.phone || customer.default_address?.phone);
  const email = cleanId(customer.email);
  const address = customer.default_address
    ? [customer.default_address.address1, customer.default_address.ward, customer.default_address.district, customer.default_address.province].filter(Boolean).join(', ')
    : cleanId(customer.address || customer.address1);

  const existingMap = db.prepare(`SELECT internal_customer_id FROM external_customers WHERE provider=? AND shop_domain=? AND external_customer_id=?`)
    .get(PROVIDER, normShop(shopDomain), externalId);
  let internalId = existingMap?.internal_customer_id;
  if (!internalId && phone) internalId = db.prepare(`SELECT id FROM customers WHERE branch_id=? AND phone=? ORDER BY created_at LIMIT 1`).get(branch_id, phone)?.id;
  if (!internalId && email) internalId = db.prepare(`SELECT id FROM customers WHERE branch_id=? AND email=? ORDER BY created_at LIMIT 1`).get(branch_id, email)?.id;
  if (internalId) {
    db.prepare(`UPDATE customers SET name=?, phone=?, email=?, address=?, updated_at=? WHERE id=?`)
      .run(name, phone || null, email || null, address || null, now(), internalId);
  } else {
    internalId = uid('c_');
    db.prepare(`INSERT INTO customers (id,branch_id,name,phone,email,address,note,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(internalId, branch_id, name, phone || null, email || null, address || null, 'Haravan', now(), now());
  }
  db.prepare(`INSERT INTO external_customers
    (id,provider,shop_domain,external_customer_id,internal_customer_id,raw_payload,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(provider, shop_domain, external_customer_id) DO UPDATE SET
      internal_customer_id=excluded.internal_customer_id,raw_payload=excluded.raw_payload,updated_at=excluded.updated_at`)
    .run(uid('ec_'), PROVIDER, normShop(shopDomain), externalId, internalId, json(customer), now(), now());
  return internalId;
}

function skuForLine(line, shopDomain = '', branch_id) {
  const variantId = cleanId(line.variant_id);
  const productId = cleanId(line.product_id);
  const mapped = db.prepare(`SELECT internal_variant_id FROM external_products
    WHERE provider=? AND shop_domain=? AND external_product_id=? AND external_variant_id=?`)
    .get(PROVIDER, normShop(shopDomain), productId, variantId);
  if (mapped?.internal_variant_id) return mapped.internal_variant_id;
  const sku = cleanId(line.sku);
  if (!sku) return null;
  return db.prepare(`SELECT id FROM skus WHERE branch_id=? AND (barcode=? OR id=?) ORDER BY active DESC LIMIT 1`)
    .get(branch_id, sku, sku)?.id || null;
}

export function syncHaravanOrder(payload, topic = 'orders/create', shopDomain = '') {
  const externalId = cleanId(payload.id || payload.order_id || payload.order_number);
  if (!externalId) throw new Error('missing_haravan_order_id');
  const existingAny = db.prepare(`SELECT shop_domain FROM external_orders WHERE provider=? AND external_order_id=? ORDER BY updated_at DESC LIMIT 1`)
    .get(PROVIDER, externalId);
  const shop = normShop(shopDomain || existingAny?.shop_domain || '');
  const branch_id = defaultBranch(shop);
  const externalCode = cleanId(payload.order_number || payload.name || payload.order_code || externalId);
  const customerId = payload.customer ? upsertCustomer(payload.customer, shop, branch_id) : null;
  const lines = Array.isArray(payload.line_items) ? payload.line_items : [];

  // Webhook phản hồi của chính đơn POS vừa đẩy lên Haravan chỉ xác nhận mapping.
  // Không được biến đơn POS đã thanh toán thành đơn online hoặc xoá/ghi lại các dòng hàng.
  const ownMapping = db.prepare(`SELECT eo.internal_order_id,o.channel FROM external_orders eo
    JOIN orders o ON o.id=eo.internal_order_id
    WHERE eo.provider=? AND eo.shop_domain=? AND eo.external_order_id=?`).get(PROVIDER, shop, externalId);
  if (ownMapping && ownMapping.channel !== 'online') {
    db.prepare(`UPDATE external_orders SET external_order_code=?,sync_status='success',raw_payload=?,updated_at=?
      WHERE provider=? AND shop_domain=? AND external_order_id=?`)
      .run(externalCode, json(payload), now(), PROVIDER, shop, externalId);
    return { internal_order_id: ownMapping.internal_order_id, external_order_id: externalId, own_outbound: true };
  }

  db.prepare('BEGIN IMMEDIATE').run();
  try {
    let internalId = db.prepare(`SELECT internal_order_id FROM external_orders WHERE provider=? AND shop_domain=? AND external_order_id=?`)
      .get(PROVIDER, shop, externalId)?.internal_order_id;
    const priorState = internalId
      ? db.prepare(`SELECT locked_at FROM online_order_state WHERE order_id=?`).get(internalId)
      : null;
    const subtotal = lines.reduce((sum, line) => sum + money(line.price) * Math.max(1, Number(line.quantity || 1)), 0);
    const discount = money(payload.total_discounts || payload.discount);
    const total = money(payload.total_price || payload.total || Math.max(0, subtotal - discount));
    const paid = topic === 'orders/paid' || cleanId(payload.financial_status).toLowerCase() === 'paid';
    // Never mark an inbound order paid here. A paid web order must cross the
    // canonical payment boundary after this import transaction commits; that is
    // where stock, bill number, sale snapshot, reports and e-invoice are created.
    const status = payload.cancelled_at || topic === 'orders/cancelled' || topic === 'orders/cancel'
      ? 'void' : 'open';
    const customerJson = json({
      id: customerId,
      name: payload.customer?.name || [payload.customer?.first_name, payload.customer?.last_name].filter(Boolean).join(' '),
      phone: payload.customer?.phone || payload.phone || '',
      email: payload.customer?.email || payload.email || '',
      address: payload.shipping_address?.address1 || '',
      provider: PROVIDER,
      shop_domain: shop,
    });

    if (!internalId) {
      internalId = uid('o_');
      db.prepare(`INSERT INTO orders
        (id,branch_id,table_id,channel,status,subtotal,discount,total,created_at,online_channel,online_ref,online_status,customer_json)
        VALUES (?,?,NULL,'online',?,?,?,?,?,?,?,?,?)`)
        .run(internalId, branch_id, status, subtotal, discount, total, payload.created_at || now(),
          PROVIDER, externalId, topic, customerJson);
    } else {
      if (!priorState?.locked_at) db.prepare(`DELETE FROM order_items WHERE order_id=?`).run(internalId);
      if (priorState?.locked_at) {
        db.prepare(`UPDATE orders SET status=?,online_status=?,customer_json=?,
          paid_at=CASE WHEN ?='paid' THEN COALESCE(paid_at,?) ELSE paid_at END WHERE id=?`)
          .run(status, topic, customerJson, status, now(), internalId);
      } else {
        db.prepare(`UPDATE orders SET status=?,subtotal=?,discount=?,total=?,online_status=?,customer_json=?,
          paid_at=CASE WHEN ?='paid' THEN COALESCE(paid_at,?) ELSE paid_at END WHERE id=?`)
          .run(status, subtotal, discount, total, topic, customerJson, status, now(), internalId);
      }
      // Once the order has crossed the confirmation/payment boundary, its sale
      // lines are immutable snapshots. Later product edits or webhook retries may
      // update fulfillment metadata, but must never rewrite historical line data.
    }

    const ins = db.prepare(`INSERT INTO order_items
      (id,order_id,menu_item_id,sku_id,item_code,item_barcode,unit_snapshot,name,emoji,qty,unit_price,vat_rate,station,sla_minutes,note,mods_json,status,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'[]','served',?)`);
    for (const line of priorState?.locked_at ? [] : lines) {
      const skuId = skuForLine(line, shop, branch_id);
      const sku = skuId ? db.prepare(`SELECT code,barcode,unit,vat FROM skus WHERE id=?`).get(skuId) : null;
      ins.run(uid('oi_'), internalId, null, skuId, line.sku || sku?.code || null,
        line.barcode || sku?.barcode || null, line.unit || sku?.unit || 'cái',
        line.name || line.title || 'Haravan item', null,
        Math.max(1, Number(line.quantity || 1)), money(line.price), Number(sku?.vat) || 0,
        'retail', 0, line.note || null, now());
    }

    db.prepare(`INSERT INTO external_orders
      (id,provider,shop_domain,external_order_id,internal_order_id,external_order_code,sync_status,raw_payload,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(provider, shop_domain, external_order_id) DO UPDATE SET
        internal_order_id=excluded.internal_order_id,external_order_code=excluded.external_order_code,
        sync_status=excluded.sync_status,raw_payload=excluded.raw_payload,updated_at=excluded.updated_at`)
      .run(uid('eo_'), PROVIDER, shop, externalId, internalId, externalCode, 'success', json(payload), now(), now());

    const financialStatus = cleanId(payload.financial_status).toLowerCase();
    const fulfillmentStatus = cleanId(payload.fulfillment_status).toLowerCase();
    const sourceWorkflowStatus = payload.cancelled_at || topic === 'orders/cancelled' || topic === 'orders/cancel'
      ? 'cancelled'
      : ['refunded', 'partially_refunded'].includes(financialStatus) || (Array.isArray(payload.refunds) && payload.refunds.length)
        ? 'return_refund'
        : fulfillmentStatus === 'fulfilled' || payload.closed_at
          ? 'delivered'
          : Array.isArray(payload.fulfillments) && payload.fulfillments.some(x => !['cancelled', 'failure'].includes(cleanId(x.status).toLowerCase()))
            ? 'shipping'
            : paid || payload.confirmed_at || payload.confirmed === true
              ? 'processed'
              : 'pending';
    const sourceLocked = sourceWorkflowStatus !== 'pending';
    db.prepare(`INSERT INTO online_order_state
      (order_id,workflow_status,locked_at,created_at,updated_at)
      VALUES (?,?,?,?,?) ON CONFLICT(order_id) DO UPDATE SET
        workflow_status=CASE
          WHEN excluded.workflow_status IN ('shipping','delivered','cancelled','return_refund') THEN excluded.workflow_status
          WHEN online_order_state.workflow_status IN ('preparing','ready_to_ship') THEN online_order_state.workflow_status
          ELSE excluded.workflow_status END,
        locked_at=COALESCE(online_order_state.locked_at,excluded.locked_at),updated_at=excluded.updated_at`)
      .run(internalId, sourceWorkflowStatus, sourceLocked ? now() : null, now(), now());
    db.prepare('COMMIT').run();
    let settlement = null;
    if (paid) {
      const canonical = db.prepare(`SELECT status FROM orders WHERE id=?`).get(internalId);
      const hasPayment = db.prepare(`SELECT 1 FROM payments WHERE order_id=? LIMIT 1`).get(internalId);
      // Repair an order imported by the older shortcut only when it has no
      // payment evidence. This is safe because the canonical payment key below
      // is unique and stock deduction is guarded by the sale document.
      if (canonical?.status === 'paid' && !hasPayment) {
        db.prepare(`UPDATE orders SET status='open',paid_at=NULL WHERE id=?`).run(internalId);
      }
      if (canonical?.status !== 'paid' || !hasPayment) {
        settlement = payOrder(internalId, total > 0 ? [{
          method: 'online', amount: total, reference: `${shop}:${externalCode}`.slice(0, 250),
        }] : [], {
          cashier: `haravan:${shop}`.slice(0, 120),
          customer: customerId ? { id: customerId } : null,
          idempotency_key: `connector:haravan:${shop}:${externalId}:paid`.slice(0, 128),
          external_settlement: true,
          skip_channel_outbound: true,
          note: payload.note || '',
        }, branch_id);
      }
    }
    if (status === 'void') reversePurchase(internalId, branch_id);
    audit('haravan.order.sync', { shop_domain: shop, external_order_id: externalId, order_id: internalId, topic }, branch_id, 'haravan');
    emit('online:new', { id: internalId, provider: PROVIDER, ref: externalId, branch_id }, branch_id);
    emit('stats:dirty', {}, branch_id);
    return { internal_order_id: internalId, external_order_id: externalId, settlement };
  } catch (err) {
    db.prepare('ROLLBACK').run();
    throw err;
  }
}

export function syncHaravanCustomer(payload, shopDomain = '') {
  const id = upsertCustomer(payload, shopDomain, defaultBranch(shopDomain));
  audit('haravan.customer.sync', { shop_domain: normShop(shopDomain), external_customer_id: payload.id || payload.customer?.id, customer_id: id }, defaultBranch(shopDomain), 'haravan');
  return { internal_customer_id: id };
}

export function syncHaravanProduct(payload, shopDomain = '') {
  const shop = normShop(shopDomain);
  const branch_id = defaultBranch(shop);
  const product = payload.product || payload;
  const productId = cleanId(product.id || product.product_id);
  if (!productId) throw new Error('missing_haravan_product_id');
  const variants = Array.isArray(product.variants) && product.variants.length ? product.variants : [product];
  const out = [];
  for (const variant of variants) {
    const variantId = cleanId(variant.id || variant.variant_id || productId);
    const skuCode = cleanId(variant.sku || product.sku || variant.barcode || variantId);
    const generatedSkuId = `hvn_${shop}_${variantId}`.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 80);
    const catalogMatch = skuCode ? db.prepare(`SELECT id FROM skus
      WHERE branch_id=? AND active=1 AND barcode=? AND id NOT LIKE 'hvn_%' ORDER BY id LIMIT 1`).get(branch_id, skuCode) : null;
    const mapped = db.prepare(`SELECT internal_variant_id FROM external_products
      WHERE provider=? AND shop_domain=? AND external_product_id=? AND external_variant_id=?`)
      .get(PROVIDER, shop, productId, variantId);
    const skuId = catalogMatch?.id || mapped?.internal_variant_id || generatedSkuId;
    if (catalogMatch && mapped?.internal_variant_id && mapped.internal_variant_id !== skuId && mapped.internal_variant_id.startsWith('hvn_')) {
      db.prepare('UPDATE skus SET active=0 WHERE id=?').run(mapped.internal_variant_id);
    }
    const name = [product.title || product.name || 'Haravan product', variant.title && variant.title !== 'Default Title' ? variant.title : ''].filter(Boolean).join(' - ');
    db.prepare(`INSERT INTO skus (id,branch_id,barcode,name,price,cost,stock,unit,category,source_url,active)
      VALUES (?,?,?,?,?,?,?,?,?,?,1)
      ON CONFLICT(id) DO UPDATE SET barcode=excluded.barcode,name=excluded.name,price=excluded.price,source_url=excluded.source_url,active=1`)
      .run(skuId, branch_id, skuCode || null, name, money(variant.price || product.price), 0,
        Number(variant.inventory_quantity || product.inventory_quantity || 0), 'cái',
        product.product_type || product.vendor || null, product.handle && shop ? `https://${shop}/products/${product.handle}` : null);

    db.prepare(`INSERT INTO external_products
      (id,provider,shop_domain,external_product_id,external_variant_id,internal_product_id,internal_variant_id,sku,raw_payload,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(provider, shop_domain, external_product_id, external_variant_id) DO UPDATE SET
        internal_variant_id=excluded.internal_variant_id,sku=excluded.sku,raw_payload=excluded.raw_payload,updated_at=excluded.updated_at`)
      .run(uid('ep_'), PROVIDER, shop, productId, variantId, skuId, skuId, skuCode, json({ product, variant }), now(), now());
    out.push(skuId);
  }
  audit('haravan.product.sync', { shop_domain: shop, external_product_id: productId, skus: out.length }, branch_id, 'haravan');
  emit('inventory:updated', { ids: out }, branch_id);
  return { skus: out };
}

export function deleteHaravanProduct(payload, shopDomain = '') {
  const shop = normShop(shopDomain);
  const product = payload.product || payload;
  const productId = cleanId(product.id || product.product_id);
  if (!productId) throw new Error('missing_haravan_product_id');
  const rows = db.prepare(`SELECT internal_variant_id FROM external_products WHERE provider=? AND shop_domain=? AND external_product_id=?`)
    .all(PROVIDER, shop, productId);
  const upd = db.prepare(`UPDATE skus SET active=0 WHERE id=?`);
  for (const row of rows) if (row.internal_variant_id) upd.run(row.internal_variant_id);
  audit('haravan.product.delete', { shop_domain: shop, external_product_id: productId, skus: rows.length }, defaultBranch(shop), 'haravan');
  emit('inventory:updated', { ids: rows.map(r => r.internal_variant_id).filter(Boolean) }, defaultBranch(shop));
  return { deactivated: rows.length };
}

export function syncHaravanInventory(payload, shopDomain = '') {
  const shop = normShop(shopDomain);
  const cfg = config(shop);
  if (!cfg.enabled || !cfg.syncInventory) return { ignored: true, reason: 'inventory_sync_disabled' };
  const item = payload.inventory_location_balance || payload.inventoryLocationBalance || payload;
  if (!item._all_locations && !/^\d+$/.test(cleanId(cfg.locationId))) return { ignored: true, reason: 'location_not_configured' };
  const locationId = cleanId(item.loc_id || item.location_id);
  if (!item._all_locations && locationId && locationId !== cleanId(cfg.locationId)) return { ignored: true, reason: 'different_location' };
  const variantId = cleanId(item.variant_id || item.product_variant_id || item.inventory_item_id);
  const sku = cleanId(item.sku || item.barcode);
  const qty = Number(item.qty_available ?? item.quantity ?? item.available ?? item.inventory_quantity);
  if (!Number.isFinite(qty)) return { ignored: true };
  const mapped = variantId
    ? db.prepare(`SELECT internal_variant_id FROM external_products WHERE provider=? AND shop_domain=? AND external_variant_id=?`).get(PROVIDER, shop, variantId)
    : null;
  const branch_id = defaultBranch(shop);
  const skuId = mapped?.internal_variant_id || (sku ? db.prepare(`SELECT id FROM skus WHERE branch_id=? AND (barcode=? OR id=?) LIMIT 1`).get(branch_id, sku, sku)?.id : null);
  if (!skuId) return { ignored: true };
  // BR-STOCK-001: POS la Inventory Source of Truth. Ton gui tu Haravan la
  // OBSERVATION/RECONCILIATION INPUT, khong duoc am tham ghi de ton chinh thuc
  // cua POS. Chi ghi nhan lech de doi chieu/kiem tra thu cong; KHONG UPDATE skus.stock.
  const posQty = Number(db.prepare(`SELECT stock FROM skus WHERE id=? AND branch_id=?`).get(skuId, branch_id)?.stock) || 0;
  const discrepancy = qty - posQty;
  if (discrepancy !== 0) {
    audit('haravan.inventory.discrepancy', {
      shop_domain: shop, sku_id: skuId, pos_qty: posQty, haravan_qty: qty, discrepancy,
    }, defaultBranch(shop), 'haravan');
    emit('inventory:reconciliation_needed', { sku_id: skuId, pos_qty: posQty, haravan_qty: qty, discrepancy }, defaultBranch(shop));
  } else {
    audit('haravan.inventory.reconciled', { shop_domain: shop, sku_id: skuId, qty }, defaultBranch(shop), 'haravan');
  }
  return { sku_id: skuId, pos_qty: posQty, haravan_qty: qty, discrepancy, applied: false };
}

function handleTopic(topic, payload, shopDomain = '') {
  if (!topicEnabled(topic, config(shopDomain))) return { ignored: true, reason: 'sync_disabled' };
  if (topic.startsWith('orders/')) return syncHaravanOrder(payload, topic, shopDomain);
  if (topic.startsWith('customers/')) return syncHaravanCustomer(payload, shopDomain);
  if (topic === 'products/delete') return deleteHaravanProduct(payload, shopDomain);
  if (topic.startsWith('products/')) return syncHaravanProduct(payload, shopDomain);
  if (topic === 'inventory/update' || topic === 'inventorylocationbalances/update') return syncHaravanInventory(payload, shopDomain);
  return { ignored: true };
}

export function processHaravanQueue(limit = 20) {
  if (workerRunning) return { skipped: true };
  workerRunning = true;
  let processed = 0;
  try {
    const rows = db.prepare(`SELECT * FROM sync_logs
      WHERE provider=? AND COALESCE(direction,'inbound')='inbound' AND status IN ('received','retrying')
        AND (next_retry_at IS NULL OR next_retry_at <= ?)
      ORDER BY created_at ASC LIMIT ?`).all(PROVIDER, now(), limit);
    for (const row of rows) {
      try {
        const body = parseJsonText(row.raw_payload || '{}');
        const result = handleTopic(row.topic, body.payload || body, row.shop_domain || body.shop || '');
        db.prepare(`UPDATE sync_logs SET status=?, processed_at=?, error_message=NULL WHERE id=?`)
          .run(result?.ignored ? 'ignored' : 'success', now(), row.id);
        processed++;
      } catch (err) {
        const retries = (row.retry_count || 0) + 1;
        const failed = retries >= 5;
        const nextRetry = failed ? null : new Date(Date.now() + Math.min(300000, 1000 * (2 ** retries))).toISOString();
        db.prepare(`UPDATE sync_logs SET status=?, retry_count=?, next_retry_at=?, error_message=? WHERE id=?`)
          .run(failed ? 'failed' : 'retrying', retries, nextRetry, err.message, row.id);
      }
    }
    return { processed };
  } finally {
    workerRunning = false;
  }
}

function customerFromOrder(order) {
  try { return order?.customer_json ? JSON.parse(order.customer_json) : null; } catch { return null; }
}

export function enqueuePaidPosOrder(orderId) {
  const order = db.prepare(`SELECT id,branch_id,bill_no,status,total,customer_json FROM orders WHERE id=?`).get(orderId);
  if (!order || order.status !== 'paid') return { queued: false, reason: 'not_paid' };
  const cfg = legacyConfig();
  if (!cfg.enabled || !cfg.syncOrders) return { queued: false, reason: 'haravan_disabled' };
  const customer = customerFromOrder(order);
  if (!cleanId(customer?.phone) || !cleanId(customer?.name)) return { queued: false, reason: 'customer_incomplete' };
  // Bảo đảm điểm đã được chốt trước khi worker dựng nội dung Zalo. recordPurchase
  // có ledger UNIQUE theo order nên các đường thanh toán khác gọi lại cũng không cộng đôi.
  recordPurchase(customer, order.total, order.branch_id || 'sala', orderId);
  const eventKey = `purchase_success:${orderId}`;
  const existing = db.prepare(`SELECT id,status FROM sync_logs WHERE provider=? AND direction='outbound'
    AND topic='pos/order/paid' AND external_id=? AND status IN ('received','retrying','success') ORDER BY created_at DESC LIMIT 1`)
    .get(PROVIDER, eventKey);
  if (existing) return { queued: false, duplicate: true, log_id: existing.id, status: existing.status };
  const sessionId = uid('hvs_');
  const id = writeSyncLog({ shop_domain: cfg.shopDomain, topic: 'pos/order/paid', external_id: eventKey,
    status: 'received', raw_payload: { order_id: orderId }, direction: 'outbound', session_id: sessionId });
  setImmediate(() => processHaravanOutboundQueue());
  return { queued: true, log_id: id, session_id: sessionId };
}

export function enqueueIssuedInvoice(invoiceId) {
  const invoice = db.prepare(`SELECT id,order_id,branch_id,invoice_status FROM e_invoices WHERE id=?`).get(invoiceId);
  if (!invoice || invoice.invoice_status !== 'ISSUED') return { queued: false, reason: 'invoice_not_issued' };
  const cfg = legacyConfig();
  if (!cfg.enabled || !cfg.syncOrders) return { queued: false, reason: 'haravan_disabled' };
  const eventKey = `invoice_issued:${invoiceId}`;
  const existing = db.prepare(`SELECT id,status FROM sync_logs WHERE provider=? AND direction='outbound'
    AND topic='pos/invoice/issued' AND external_id=? AND status IN ('received','retrying','success') ORDER BY created_at DESC LIMIT 1`)
    .get(PROVIDER, eventKey);
  if (existing) return { queued: false, duplicate: true, log_id: existing.id, status: existing.status };
  const sessionId = uid('hvs_');
  const id = writeSyncLog({ shop_domain: cfg.shopDomain, topic: 'pos/invoice/issued', external_id: eventKey,
    status: 'received', raw_payload: { invoice_id: invoiceId, order_id: invoice.order_id },
    direction: 'outbound', session_id: sessionId });
  setImmediate(() => processHaravanOutboundQueue());
  return { queued: true, log_id: id, session_id: sessionId };
}

async function findOrCreateHaravanCustomer(order, shop) {
  const customer = customerFromOrder(order) || {};
  const phone = cleanId(customer.phone).replace(/\s+/g, '');
  const mapped = customer.id ? db.prepare(`SELECT external_customer_id FROM external_customers
    WHERE provider=? AND shop_domain=? AND internal_customer_id=? ORDER BY updated_at DESC LIMIT 1`)
    .get(PROVIDER, shop, customer.id) : null;
  if (mapped?.external_customer_id) return mapped.external_customer_id;
  const search = await haravanRequest(`/com/customers/search.json?query=${encodeURIComponent(phone)}`, { shopDomain: shop });
  let remote = (search.customers || search.customer || [])[0];
  if (!remote) {
    const names = cleanId(customer.name).split(/\s+/);
    remote = (await haravanRequest('/com/customers.json', { shopDomain: shop, method: 'POST', body: { customer: {
      first_name: names.slice(0, -1).join(' ') || names[0], last_name: names.length > 1 ? names.at(-1) : '',
      phone, email: cleanId(customer.email) || undefined, note: 'Đồng bộ từ Dan-D Pak POS',
    } } })).customer;
  }
  if (!remote?.id) throw new Error('Haravan customer response missing id');
  if (customer.id) db.prepare(`INSERT INTO external_customers
    (id,provider,shop_domain,external_customer_id,internal_customer_id,raw_payload,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(provider,shop_domain,external_customer_id) DO UPDATE SET
    internal_customer_id=excluded.internal_customer_id,raw_payload=excluded.raw_payload,updated_at=excluded.updated_at`)
    .run(uid('ec_'), PROVIDER, shop, cleanId(remote.id), customer.id, json(remote), now(), now());
  return cleanId(remote.id);
}

async function pushPaidPosOrder(orderId, shopDomain = '') {
  const shop = normShop(shopDomain || config().shopDomain);
  const order = db.prepare(`SELECT * FROM orders WHERE id=?`).get(orderId);
  if (!order || order.status !== 'paid') return { ignored: true, reason: 'not_paid' };
  const already = db.prepare(`SELECT external_order_id FROM external_orders WHERE provider=? AND shop_domain=? AND internal_order_id=?`)
    .get(PROVIDER, shop, orderId);
  if (already) return { duplicate: true, external_order_id: already.external_order_id };
  const customerId = await findOrCreateHaravanCustomer(order, shop);
  const customer = customerFromOrder(order) || {};
  const ledger = db.prepare(`SELECT points FROM customer_purchase_ledger WHERE branch_id=? AND source_order_id=? AND reversed_at IS NULL`)
    .get(order.branch_id, order.id);
  const currentCustomer = customer.id
    ? db.prepare(`SELECT loyalty_points FROM customers WHERE id=? AND branch_id=?`).get(customer.id, order.branch_id)
    : (customer.phone ? db.prepare(`SELECT loyalty_points FROM customers WHERE phone=? AND branch_id=? ORDER BY updated_at DESC LIMIT 1`).get(customer.phone, order.branch_id) : null);
  const items = db.prepare(`SELECT oi.*,ep.external_variant_id FROM order_items oi LEFT JOIN external_products ep
    ON ep.provider=? AND ep.shop_domain=? AND ep.internal_variant_id=COALESCE(oi.sku_id,oi.menu_item_id)
    WHERE oi.order_id=? ORDER BY oi.created_at,oi.id`).all(PROVIDER, shop, orderId);
  const lineItems = items.map(i => ({
    ...(i.external_variant_id ? { variant_id: Number(i.external_variant_id) || i.external_variant_id } : {}),
    title: i.name, sku: i.sku_id || i.menu_item_id || undefined, quantity: Math.max(1, Number(i.qty || 1)), price: money(i.unit_price),
  }));
  const bill = cleanId(order.bill_no || order.id);
  const orderNote = cleanId(order.note);
  const earnedPoints = Number(ledger?.points || 0);
  const totalPoints = Number(currentCustomer?.loyalty_points || 0);
  const messageLines = [
    'Mua hàng thành công',
    `Cảm ơn ${cleanId(customer.name)} đã mua hàng tại Dan-D Pak.`,
    `Mã đơn: ${bill}`,
    `Giá trị đơn: ${money(order.total).toLocaleString('vi-VN')}đ`,
    `Điểm vừa nhận: ${earnedPoints.toLocaleString('vi-VN')}`,
    `Tổng điểm hiện tại: ${totalPoints.toLocaleString('vi-VN')}`,
    ...(orderNote ? [`Ghi chú: ${orderNote}`] : []),
  ];
  const response = await haravanRequest('/com/orders.json', { shopDomain: shop, method: 'POST', body: { order: {
    customer: { id: Number(customerId) || customerId }, line_items: lineItems,
    financial_status: 'paid', fulfillment_status: 'fulfilled', source_name: 'Dan-D Pak POS',
    note: messageLines.join('\n'), tags: `DanDPakPOS,DDP_PURCHASE_SUCCESS,${bill}`,
    note_attributes: [
      { name: 'ddp_event', value: 'purchase_success' },
      { name: 'ddp_event_key', value: `purchase_success:${order.id}` },
      { name: 'bill_no', value: bill },
      { name: 'customer_name', value: cleanId(customer.name) },
      { name: 'order_value', value: String(money(order.total)) },
      { name: 'points_earned', value: String(earnedPoints) },
      { name: 'points_total', value: String(totalPoints) },
      ...(orderNote ? [{ name: 'customer_note', value: orderNote }] : []),
    ],
    transactions: [{ kind: 'capture', status: 'success', amount: money(order.total) }],
  } } });
  const remote = response.order || response;
  if (!remote?.id) throw new Error('Haravan order response missing id');
  db.prepare(`INSERT INTO external_orders
    (id,provider,shop_domain,external_order_id,internal_order_id,external_order_code,sync_status,raw_payload,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(provider,shop_domain,external_order_id) DO UPDATE SET
    internal_order_id=excluded.internal_order_id,external_order_code=excluded.external_order_code,sync_status='success',raw_payload=excluded.raw_payload,updated_at=excluded.updated_at`)
    .run(uid('eo_'), PROVIDER, shop, cleanId(remote.id), orderId, cleanId(remote.order_number || remote.name || bill), 'success', json(remote), now(), now());
  return { external_order_id: cleanId(remote.id), bill_no: bill };
}

async function pushIssuedInvoice(invoiceId, shopDomain = '') {
  const shop = normShop(shopDomain || config().shopDomain);
  const invoice = db.prepare(`SELECT e.*,o.bill_no,o.total,o.note order_note FROM e_invoices e
    JOIN orders o ON o.id=e.order_id WHERE e.id=? AND e.invoice_status='ISSUED'`).get(invoiceId);
  if (!invoice) return { ignored: true, reason: 'invoice_not_issued' };
  const mapping = db.prepare(`SELECT external_order_id,raw_payload FROM external_orders
    WHERE provider=? AND shop_domain=? AND internal_order_id=? ORDER BY updated_at DESC LIMIT 1`)
    .get(PROVIDER, shop, invoice.order_id);
  if (!mapping?.external_order_id) throw new Error('haravan_order_not_synced_yet');
  const raw = parseJsonText(mapping.raw_payload || '{}');
  const bill = cleanId(invoice.bill_no || invoice.order_id);
  const invoiceNo = cleanId(invoice.invoice_no);
  const template = cleanId(invoice.invoice_template);
  const series = cleanId(invoice.invoice_series);
  const lookupUrl = cleanId(invoice.lookup_url);
  const lines = [
    'Hóa đơn VAT đã phát hành',
    `Mã đơn: ${bill}`,
    `Số hóa đơn VAT: ${invoiceNo}`,
    ...(template || series ? [`Mẫu số/ký hiệu: ${[template, series].filter(Boolean).join(' / ')}`] : []),
    `Giá trị: ${money(invoice.total).toLocaleString('vi-VN')}đ`,
  ];
  const currentTags = cleanId(raw.tags);
  const tags = [...new Set([...currentTags.split(',').map(x => x.trim()).filter(Boolean),
    'DanDPakPOS', 'DDP_INVOICE_ISSUED', bill])].join(',');
  const response = await haravanRequest(`/com/orders/${encodeURIComponent(mapping.external_order_id)}.json`, {
    shopDomain: shop, method: 'PUT', body: { order: {
      id: Number(mapping.external_order_id) || mapping.external_order_id,
      note: lines.join('\n'), tags,
      note_attributes: [
        { name: 'ddp_event', value: 'invoice_issued' },
        { name: 'ddp_event_key', value: `invoice_issued:${invoice.id}` },
        { name: 'bill_no', value: bill },
        { name: 'invoice_no', value: invoiceNo },
        ...(template ? [{ name: 'invoice_template', value: template }] : []),
        ...(series ? [{ name: 'invoice_series', value: series }] : []),
        { name: 'invoice_value', value: String(money(invoice.total)) },
        ...(lookupUrl ? [{ name: 'invoice_url', value: lookupUrl }] : []),
      ],
    } },
  });
  db.prepare(`UPDATE external_orders SET raw_payload=?,updated_at=? WHERE provider=? AND shop_domain=? AND external_order_id=?`)
    .run(json(response.order || response), now(), PROVIDER, shop, mapping.external_order_id);
  return { external_order_id: mapping.external_order_id, invoice_no: invoiceNo, lookup_url: lookupUrl || null };
}

export async function processHaravanOutboundQueue(limit = 10) {
  if (outboundWorkerRunning) return { skipped: true };
  outboundWorkerRunning = true;
  let processed = 0;
  try {
    const rows = db.prepare(`SELECT * FROM sync_logs WHERE provider=? AND direction='outbound'
      AND status IN ('received','retrying') AND (next_retry_at IS NULL OR next_retry_at<=?) ORDER BY created_at LIMIT ?`)
      .all(PROVIDER, now(), limit);
    for (const row of rows) {
      try {
        const payload = parseJsonText(row.raw_payload || '{}');
        if (row.topic === 'pos/order/paid') await pushPaidPosOrder(payload.order_id, row.shop_domain);
        else if (row.topic === 'pos/invoice/issued') await pushIssuedInvoice(payload.invoice_id, row.shop_domain);
        else throw new Error(`unsupported outbound topic: ${row.topic}`);
        db.prepare(`UPDATE sync_logs SET status='success',processed_at=?,error_message=NULL WHERE id=?`).run(now(), row.id);
        processed++;
      } catch (err) {
        const retries = Number(row.retry_count || 0) + 1;
        const failed = retries >= 8;
        const nextRetry = failed ? null : new Date(Date.now() + Math.min(900000, 5000 * (2 ** retries))).toISOString();
        db.prepare(`UPDATE sync_logs SET status=?,retry_count=?,next_retry_at=?,error_message=? WHERE id=?`)
          .run(failed ? 'failed' : 'retrying', retries, nextRetry, cleanId(err?.message || err), row.id);
      }
    }
    return { processed };
  } finally { outboundWorkerRunning = false; }
}

function resourcePath(resource, page, updatedAtMin = '') {
  const params = new URLSearchParams({ limit: '50', page: String(page) });
  if (updatedAtMin) params.set('updated_at_min', updatedAtMin);
  if (resource === 'orders') {
    params.set('status', 'any');
    params.set('order', 'updated_at asc');
    return { path: `/com/orders.json?${params}`, listKey: 'orders', topic: 'orders/updated' };
  }
  if (resource === 'products') return { path: `/com/products.json?${params}`, listKey: 'products', topic: 'products/update' };
  if (resource === 'customers') return { path: `/com/customers.json?${params}`, listKey: 'customers', topic: 'customers/update' };
  throw new Error('unsupported_haravan_resource');
}

async function pullHaravanResource(resource, { shopDomain = '', delta = true, maxPages = 200, sessionId = uid('hvs_') } = {}) {
  const shop = normShop(shopDomain || config().shopDomain);
  const since = delta ? getState(shop, `${resource}.updated_at_min`) : '';
  let queued = 0;
  let newest = since;
  for (let page = 1; page <= maxPages; page++) {
    const spec = resourcePath(resource, page, since);
    const data = await haravanRequest(spec.path, { shopDomain: shop });
    const rows = Array.isArray(data[spec.listKey]) ? data[spec.listKey] : [];
    for (const row of rows) {
      if (delta && since && row.updated_at && String(row.updated_at) <= since) continue;
      writeSyncLog({ shop_domain: shop, topic: spec.topic, external_id: cleanId(row.id), status: 'received', raw_payload: { shop, payload: row }, session_id: sessionId });
      if (row.updated_at && (!newest || String(row.updated_at) > newest)) newest = row.updated_at;
    }
    queued += rows.length;
    if (rows.length < 50) break;
  }
  if (newest) upsertState(shop, `${resource}.updated_at_min`, newest);
  processHaravanQueue();
  return { shopDomain: shop, resource, queued, session_id: sessionId };
}

async function pullHaravanInventory({ shopDomain = '', delta = true, sessionId = uid('hvs_') } = {}) {
  const shop = normShop(shopDomain || config().shopDomain);
  const cfg = config(shop);
  if (!cfg.syncInventory) return { shopDomain: shop, resource: 'inventory', queued: 0 };
  const stateKey = 'inventory.updated_at_min';
  const since = delta ? getState(shop, stateKey) : '';
  let newest = since;
  let queued = 0;
  const locationId = cleanId(cfg.locationId);
  if (!/^\d+$/.test(locationId)) throw new Error('haravan_location_id_required');
  const variantIds = db.prepare(`SELECT DISTINCT external_variant_id FROM external_products
    WHERE provider=? AND shop_domain=? AND external_variant_id<>'' ORDER BY external_variant_id`)
    .all(PROVIDER, shop).map(row => cleanId(row.external_variant_id)).filter(id => /^\d+$/.test(id));
  for (const batch of chunks(variantIds, 50)) {
    const params = new URLSearchParams({
      limit: '250',
      location_ids: locationId,
      variant_ids: batch.join(','),
    });
    if (since) params.set('updated_at_min', since);
    const data = await haravanRequest(`/com/inventory_locations.json?${params}`, { shopDomain: shop });
    const rows = Array.isArray(data.inventory_locations) ? data.inventory_locations : [];
    for (const row of rows) {
      if (delta && since && row.updated_at && String(row.updated_at) <= since) continue;
      writeSyncLog({ shop_domain: shop, topic: 'inventorylocationbalances/update',
        external_id: cleanId(row.id || row.variant_id), status: 'received', raw_payload: { shop, payload: row }, session_id: sessionId });
      if (row.updated_at && (!newest || String(row.updated_at) > newest)) newest = row.updated_at;
      queued++;
    }
  }
  if (newest) upsertState(shop, stateKey, newest);
  processHaravanQueue(500);
  return { shopDomain: shop, resource: 'inventory', queued, session_id: sessionId };
}

function shopsToSync(shopDomain = '') {
  const shop = normShop(shopDomain);
  if (shop) return [shop];
  const rows = db.prepare(`SELECT shop_domain FROM haravan_shops WHERE active=1 ORDER BY installed_at`).all().map(r => r.shop_domain);
  const legacy = legacyConfig();
  if (legacy.accessToken && legacy.shopDomain && !rows.includes(legacy.shopDomain)) rows.push(legacy.shopDomain);
  if (!rows.length && legacy.accessToken) rows.push('');
  return rows;
}

async function pullForShops(resource, opts = {}) {
  const out = [];
  for (const shop of shopsToSync(opts.shopDomain)) {
    const cfg = config(shop);
    if (resource === 'orders' && !cfg.syncOrders) continue;
    if (resource === 'customers' && !cfg.syncCustomers) continue;
    out.push(await pullHaravanResource(resource, { ...opts, shopDomain: shop }));
  }
  return { results: out, queued: out.reduce((sum, x) => sum + x.queued, 0) };
}

export async function pullHaravanOrders(opts = {}) { return pullForShops('orders', opts); }
export async function pullHaravanProducts(opts = {}) { return pullForShops('products', opts); }
export async function pullHaravanCustomers(opts = {}) { return pullForShops('customers', opts); }

function drainHaravanQueue() {
  let processed = 0;
  for (let i = 0; i < 1000; i++) {
    const pending = db.prepare(`SELECT COUNT(*) n FROM sync_logs
      WHERE provider=? AND status IN ('received','retrying')
        AND (next_retry_at IS NULL OR next_retry_at <= ?)`).get(PROVIDER, now()).n;
    if (!pending) break;
    const result = processHaravanQueue(500);
    if (result.skipped || !result.processed) break;
    processed += result.processed;
  }
  return processed;
}

export async function syncAllHaravan({ shopDomain = '', delta = true, subscribe = true } = {}) {
  if (syncAllRunning) return { skipped: true, reason: 'sync_already_running' };
  syncAllRunning = true;
  try {
    const results = [];
    for (const shop of shopsToSync(shopDomain)) {
      const sessionId = uid('hvs_');
      const cfg = config(shop);
      if (!cfg.enabled || !cfg.accessToken) continue;
      if (subscribe) await subscribeWebhook(shop).catch(err =>
        writeWorkerFailureOnce('webhook/subscribe', err));
      if (cfg.syncProducts) results.push(await pullHaravanResource('products', { shopDomain: shop, delta, sessionId }));
      drainHaravanQueue();
      if (cfg.syncInventory) results.push(await pullHaravanInventory({ shopDomain: shop, delta, sessionId }));
      if (cfg.syncCustomers) {
        results.push(await pullHaravanResource('customers', { shopDomain: shop, delta, sessionId }));
        drainHaravanQueue();
      }
      if (cfg.syncOrders) {
        results.push(await pullHaravanResource('orders', { shopDomain: shop, delta, sessionId }));
      }
      drainHaravanQueue();
    }
    const queued = results.reduce((sum, row) => sum + Number(row.queued || 0), 0);
    return { results, queued };
  } finally {
    syncAllRunning = false;
  }
}

function chunks(rows, size) {
  const out = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

export async function pushInventoryToHaravan({ shopDomain = '', skuIds = [], reason = 'newproduct' } = {}) {
  const shop = normShop(shopDomain || config().shopDomain);
  const cfg = config(shop);
  if (!cfg.enabled || !cfg.syncInventory) return { shopDomain: shop, pushed: 0, skipped: 'inventory_sync_disabled' };
  if (!/^\d+$/.test(cleanId(cfg.locationId))) throw new Error('HARAVAN_LOCATION_ID is not set');
  const branch_id = defaultBranch(shop);
  const ids = Array.isArray(skuIds) && skuIds.length ? skuIds.map(cleanId) : null;
  const rows = db.prepare(`SELECT ep.external_product_id, ep.external_variant_id, ep.sku, s.id sku_id, s.stock
    FROM external_products ep JOIN skus s ON s.id=ep.internal_variant_id
    WHERE ep.provider=? AND ep.shop_domain=? AND s.branch_id=? AND s.active=1
      ${ids ? `AND s.id IN (${ids.map(() => '?').join(',')})` : ''}
    ORDER BY s.id`).all(PROVIDER, shop, branch_id, ...(ids || []));
  let pushed = 0;
  for (const batch of chunks(rows, 100)) {
    await haravanRequest('/com/inventories/adjustorset.json', {
      shopDomain: shop,
      method: 'POST',
      body: {
        inventory: {
          location_id: Number(cfg.locationId),
          type: 'set',
          reason,
          note: 'Dan-D Pak POS stock sync',
          line_items: batch.map(r => ({
            product_id: Number(r.external_product_id),
            product_variant_id: Number(r.external_variant_id),
            quantity: Number(r.stock || 0),
          })),
        },
      },
    });
    pushed += batch.length;
  }
  audit('haravan.inventory.push', { shop_domain: shop, pushed }, defaultBranch(shop), 'haravan');
  return { shopDomain: shop, pushed };
}

export async function pushPendingInventoryChanges() {
  const out = [];
  for (const shop of shopsToSync()) {
    const cfg = config(shop);
    if (!cfg.enabled || !cfg.syncInventory || !cfg.accessToken || !/^\d+$/.test(cleanId(cfg.locationId))) continue;
    const branch_id = defaultBranch(shop);
    const savedCursor = getState(shop, 'inventory_push_rowid');
    if (!savedCursor) {
      const latest = db.prepare(`SELECT COALESCE(MAX(rowid),0) rowid FROM stock_movements
        WHERE branch_id=? AND item_type='sku'`).get(branch_id)?.rowid || 0;
      upsertState(shop, 'inventory_push_rowid', latest);
      out.push({ shopDomain: shop, pushed: 0, initialized: true });
      continue;
    }
    const lastRowid = Number(savedCursor);
    const rows = db.prepare(`SELECT rowid, inventory_item_id FROM stock_movements
      WHERE branch_id=? AND rowid>? AND item_type='sku'
        AND COALESCE(reason,'') NOT LIKE 'haravan:%'
      ORDER BY rowid ASC LIMIT 500`).all(branch_id, lastRowid);
    if (!rows.length) continue;
    const skuIds = [...new Set(rows.map(r => r.inventory_item_id).filter(Boolean))];
    if (skuIds.length) out.push(await pushInventoryToHaravan({ shopDomain: shop, skuIds, reason: 'newproduct' }));
    upsertState(shop, 'inventory_push_rowid', rows[rows.length - 1].rowid);
  }
  return { results: out, pushed: out.reduce((sum, x) => sum + x.pushed, 0) };
}

export function status() {
  const counts = db.prepare(`SELECT shop_domain,status,COUNT(*) c FROM sync_logs WHERE provider=? GROUP BY shop_domain,status`).all(PROVIDER);
  const shops = db.prepare(`SELECT shop_domain,branch_id,scope,expires_at,location_id,active,installed_at,updated_at FROM haravan_shops ORDER BY installed_at DESC`).all();
  const cfg = legacyConfig();
  return {
    enabled: cfg.enabled || shops.some(s => s.active),
    shopDomain: cfg.shopDomain,
    tokenConfigured: !!cfg.accessToken,
    webhookSecretConfigured: !!(cfg.webhookSecret || cfg.clientSecret),
    oauthConfigured: !!(cfg.clientId && cfg.clientSecret),
    defaultBranchId: defaultBranch(),
    shops,
    counts,
    capabilities: haravanCapabilities(),
  };
}

export function haravanCapabilities(branch_id = '') {
  // Trạng thái THẬT: có shop Haravan đã cài (active + còn access_token) cho chi
  // nhánh này không. Trước đây trả rỗng nên overview luôn hiện "Chờ cấp quyền"
  // dù đã kết nối.
  const shop = branch_id
    ? db.prepare(`SELECT 1 FROM haravan_shops WHERE active=1 AND access_token IS NOT NULL AND access_token!=''
        AND (branch_id=? OR branch_id='' OR branch_id IS NULL) LIMIT 1`).get(branch_id)
    : db.prepare(`SELECT 1 FROM haravan_shops WHERE active=1 AND access_token IS NOT NULL AND access_token!='' LIMIT 1`).get();
  const connected = !!shop;
  return {
    active: connected,
    connected,
    inbound: connected,
    orders: { read: true, write: true, webhooks: true },
    products: { read: true, write: true, inventory_reconciliation: true },
    customers: { read: true, write: true },
    refunds: { read: true, write: true },
    conversations: {
      read: false,
      write: false,
      reason: 'Haravan Web Order API không cung cấp hội thoại. Dan-D Pak Omni cần connector Harasocial Partner API riêng.',
    },
  };
}

export function listHaravanProductMappings({ branchId = 'sala', shopDomain = '', status = 'all', q = '', limit = 50, offset = 0 } = {}) {
  const shop = normShop(shopDomain);
  const take = Math.max(1, Math.min(200, Number(limit) || 50));
  const skip = Math.max(0, Number(offset) || 0);
  const query = cleanId(q).toLowerCase();
  const where = [`ep.provider=?`, `s.branch_id=?`];
  const params = [PROVIDER, branchId];
  if (shop) { where.push(`ep.shop_domain=?`); params.push(shop); }
  if (status === 'catalog_linked') where.push(`ep.internal_variant_id IS NOT NULL AND ep.internal_variant_id NOT LIKE 'hvn_%'`);
  if (status === 'shadow_import') where.push(`ep.internal_variant_id LIKE 'hvn_%'`);
  if (query) {
    where.push(`LOWER(COALESCE(ep.sku,'')||' '||COALESCE(s.name,'')||' '||ep.external_product_id||' '||ep.external_variant_id) LIKE ?`);
    params.push(`%${query}%`);
  }
  const from = `FROM external_products ep JOIN skus s ON s.id=ep.internal_variant_id WHERE ${where.join(' AND ')}`;
  const rows = db.prepare(`SELECT ep.shop_domain,ep.external_product_id,ep.external_variant_id,ep.sku,
      ep.internal_variant_id sku_id,s.name,s.barcode,s.stock,s.price,s.active,
      CASE WHEN ep.internal_variant_id LIKE 'hvn_%' THEN 'shadow_import' ELSE 'catalog_linked' END mapping_status
    ${from} ORDER BY ep.updated_at DESC LIMIT ? OFFSET ?`).all(...params, take, skip);
  const total = Number(db.prepare(`SELECT COUNT(*) n ${from}`).get(...params)?.n || 0);
  return { rows, total, limit: take, offset: skip };
}

export function linkHaravanProduct({ branchId = 'sala', shopDomain = '', externalProductId, externalVariantId, skuId, actor = 'system' } = {}) {
  const shop = normShop(shopDomain);
  const productId = cleanId(externalProductId);
  const variantId = cleanId(externalVariantId);
  const targetSku = cleanId(skuId);
  const mapping = db.prepare(`SELECT internal_variant_id FROM external_products
    WHERE provider=? AND shop_domain=? AND external_product_id=? AND external_variant_id=?`)
    .get(PROVIDER, shop, productId, variantId);
  if (!mapping) throw new Error('Không tìm thấy biến thể Haravan cần liên kết.');
  const sku = db.prepare(`SELECT id FROM skus WHERE id=? AND branch_id=? AND active=1`).get(targetSku, branchId);
  if (!sku) throw new Error('Sản phẩm POS không tồn tại trong chi nhánh này.');
  db.prepare(`UPDATE external_products SET internal_product_id=?,internal_variant_id=?,updated_at=?
    WHERE provider=? AND shop_domain=? AND external_product_id=? AND external_variant_id=?`)
    .run(targetSku, targetSku, now(), PROVIDER, shop, productId, variantId);
  const previous = cleanId(mapping.internal_variant_id);
  if (previous && previous !== targetSku && previous.startsWith('hvn_')) {
    const used = db.prepare(`SELECT 1 FROM order_items WHERE sku_id=? LIMIT 1`).get(previous);
    if (!used) db.prepare(`UPDATE skus SET active=0 WHERE id=? AND branch_id=?`).run(previous, branchId);
  }
  audit('haravan.product.link', { shop_domain: shop, external_product_id: productId,
    external_variant_id: variantId, previous_sku_id: previous || null, sku_id: targetSku }, branchId, actor);
  return { shop_domain: shop, external_product_id: productId, external_variant_id: variantId, sku_id: targetSku };
}

export function listHaravanInventoryReconciliation({ branchId = 'sala', onlyDifferent = true, limit = 100 } = {}) {
  const take = Math.max(1, Math.min(500, Number(limit) || 100));
  const actions = onlyDifferent === false || String(onlyDifferent) === 'false'
    ? `('haravan.inventory.discrepancy','haravan.inventory.reconciled')`
    : `('haravan.inventory.discrepancy')`;
  const rows = db.prepare(`WITH ranked AS (
      SELECT detail,created_at,ROW_NUMBER() OVER (
        PARTITION BY json_extract(detail,'$.shop_domain'),json_extract(detail,'$.sku_id') ORDER BY created_at DESC
      ) rn FROM audit_log WHERE branch_id=? AND action IN ${actions}
    ) SELECT json_extract(detail,'$.shop_domain') shop_domain,
      json_extract(detail,'$.sku_id') sku_id,
      CAST(json_extract(detail,'$.pos_qty') AS REAL) pos_qty,
      CAST(json_extract(detail,'$.haravan_qty') AS REAL) haravan_qty,
      CAST(COALESCE(json_extract(detail,'$.discrepancy'),0) AS REAL) discrepancy,
      created_at observed_at FROM ranked WHERE rn=1 ORDER BY ABS(COALESCE(json_extract(detail,'$.discrepancy'),0)) DESC,created_at DESC LIMIT ?`)
    .all(branchId, take);
  return { rows, total: rows.length, source_of_truth: 'pos', automatic_overwrite: false };
}

export async function performHaravanOrderAction({ internalOrderId, action, input = {}, branchId = '' } = {}) {
  const orderId = cleanId(internalOrderId);
  const mapping = db.prepare(`SELECT eo.*,o.branch_id,o.total FROM external_orders eo
    JOIN orders o ON o.id=eo.internal_order_id
    WHERE eo.provider=? AND eo.internal_order_id=? ORDER BY eo.updated_at DESC LIMIT 1`)
    .get(PROVIDER, orderId);
  if (!mapping) throw new Error('Đơn chưa được liên kết với connector đơn web Haravan.');
  if (branchId && mapping.branch_id !== branchId) {
    const error = new Error('Đơn không thuộc chi nhánh đang thao tác.');
    error.status = 403;
    throw error;
  }
  const externalId = cleanId(mapping.external_order_id);
  const shop = normShop(mapping.shop_domain);
  const allowed = new Set(['confirm', 'cancel', 'close', 'reopen', 'refund']);
  if (!allowed.has(action)) throw new Error(`Haravan không hỗ trợ thao tác đơn: ${action}`);

  let path = `/com/orders/${encodeURIComponent(externalId)}/${action === 'reopen' ? 'open' : action}.json`;
  let body = {};
  if (action === 'cancel') {
    // Haravan chỉ nhận reason trong enum. Lý do người dùng gõ tự do → map về
    // 'other' và GIỮ nguyên chữ gốc vào ghi chú, KHÔNG chặn thao tác hủy.
    const HARAVAN_REASONS = ['customer', 'inventory', 'fraud', 'declined', 'other'];
    const rawReason = cleanId(input.reason);
    const reason = HARAVAN_REASONS.includes(rawReason.toLowerCase()) ? rawReason.toLowerCase() : 'other';
    const freeTextNote = reason === 'other' && rawReason && !HARAVAN_REASONS.includes(rawReason.toLowerCase()) ? rawReason : '';
    const amount = input.amount == null ? null : money(input.amount);
    if (amount != null && (amount < 0 || amount > money(mapping.total))) {
      throw new Error('Số tiền hoàn khi hủy vượt quá giá trị đơn.');
    }
    body = {
      reason,
      restock: input.restock === true,
      email: input.email === true,
      note: [freeTextNote, cleanId(input.note)].filter(Boolean).join(' — '),
      ...(amount == null ? {} : { amount: String(amount) }),
      ...(input.ignore_cancel_fulfillment === true ? { ignore_cancel_fulfillment: true } : {}),
    };
  } else if (action === 'refund') {
    const lines = Array.isArray(input.refund_line_items) ? input.refund_line_items : [];
    if (!lines.length) throw new Error('Hoàn tiền cần ít nhất một dòng hàng.');
    const normalizedLines = lines.map(line => {
      const lineItemId = cleanId(line.line_item_id);
      const quantity = Number(line.quantity);
      if (!/^\d+$/.test(lineItemId) || !Number.isInteger(quantity) || quantity <= 0) {
        throw new Error('Dòng hoàn tiền Haravan không hợp lệ.');
      }
      return { line_item_id: Number(lineItemId), quantity };
    });
    const amount = money(input.amount);
    if (amount <= 0 || amount > money(mapping.total)) throw new Error('Số tiền hoàn không hợp lệ.');
    path = `/com/orders/${encodeURIComponent(externalId)}/refunds.json`;
    body = { refund: {
      restock: input.restock === true,
      notify: input.notify === true,
      note: cleanId(input.note),
      refund_line_items: normalizedLines,
      transactions: [{ amount, kind: 'refund' }],
    } };
  }

  const response = await haravanRequest(path, { shopDomain: shop, method: 'POST', body });
  const remote = response.order || response.refund || response;
  db.prepare(`UPDATE external_orders SET raw_payload=?,updated_at=?
    WHERE provider=? AND shop_domain=? AND external_order_id=?`)
    .run(json(response.order || parseJsonText(mapping.raw_payload || '{}')), now(), PROVIDER, shop, externalId);
  audit('haravan.order.action', { order_id: orderId, external_order_id: externalId, action }, mapping.branch_id, 'haravan');
  return { action, internal_order_id: orderId, external_order_id: externalId, remote };
}

export function listSyncLogs(limit = 100) {
  return db.prepare(`SELECT id,shop_domain,topic,external_id,status,error_message,retry_count,created_at,processed_at,direction,session_id
    FROM sync_logs WHERE provider=? ORDER BY created_at DESC LIMIT ?`)
    .all(PROVIDER, Math.max(1, Math.min(500, Number(limit) || 100)));
}

export function listSyncSessions(limit = 50) {
  return db.prepare(`SELECT COALESCE(session_id,id) id,shop_domain,direction,
    MIN(created_at) started_at,MAX(COALESCE(processed_at,created_at)) updated_at,COUNT(*) total,
    SUM(status='success') success,SUM(status='failed') failed,SUM(status IN ('received','retrying')) pending,
    GROUP_CONCAT(DISTINCT topic) topics
    FROM sync_logs WHERE provider=? GROUP BY COALESCE(session_id,id),shop_domain,direction
    ORDER BY started_at DESC LIMIT ?`).all(PROVIDER, Math.max(1, Math.min(200, Number(limit) || 50)));
}

export function syncSessionDetails(sessionId, limit = 200) {
  return db.prepare(`SELECT id,shop_domain,topic,external_id,status,error_message,retry_count,created_at,processed_at,direction
    FROM sync_logs WHERE provider=? AND COALESCE(session_id,id)=? ORDER BY created_at,id LIMIT ?`)
    .all(PROVIDER, cleanId(sessionId), Math.max(1, Math.min(1000, Number(limit) || 200)));
}

// Payload webhook thành công chỉ hữu ích ngắn hạn để chẩn đoán/dedupe. Giữ row
// metadata lâu hơn payload; failures giữ nguyên payload để điều tra. Hai bước có
// giới hạn tuổi rõ ràng, chạy idempotent trong maintenance hằng ngày.
export function maintainHaravanLogs({ payloadDays = 7, rowDays = 90 } = {}) {
  const payloadCutoff = new Date(Date.now() - Math.max(1, payloadDays) * 86400000).toISOString();
  const rowCutoff = new Date(Date.now() - Math.max(payloadDays + 1, rowDays) * 86400000).toISOString();
  const compacted = db.prepare(`UPDATE sync_logs SET raw_payload=NULL
    WHERE provider=? AND status IN ('success','ignored') AND raw_payload IS NOT NULL AND created_at<?`)
    .run(PROVIDER, payloadCutoff).changes;
  const removed = db.prepare(`DELETE FROM sync_logs
    WHERE provider=? AND status IN ('success','ignored') AND created_at<?`)
    .run(PROVIDER, rowCutoff).changes;
  return { compacted, removed };
}

export function startHaravanWorker() {
  db.prepare(`DELETE FROM sync_logs
    WHERE provider=? AND topic='inventory/push' AND status='failed'
      AND error_message='HARAVAN_LOCATION_ID is not set'`).run(PROVIDER);
  if (!timer) {
    timer = setInterval(() => { processHaravanQueue(); processHaravanOutboundQueue().catch(err => writeWorkerFailureOnce('outbound/worker', err)); }, 30000);
    timer.unref?.();
  }
  if (!inventoryTimer) {
    inventoryTimer = setInterval(() => pushPendingInventoryChanges().catch(err =>
      writeWorkerFailureOnce('inventory/push', err)), 60000);
    inventoryTimer.unref?.();
  }
  if (!recoveryTimer) {
    setTimeout(() => syncAllHaravan({ delta: true }).catch(err =>
      writeWorkerFailureOnce('sync/all', err)), 5000).unref?.();
    recoveryTimer = setInterval(() => syncAllHaravan({ delta: true, subscribe: false }).catch(err =>
      writeWorkerFailureOnce('sync/all', err)), 5 * 60 * 1000);
    recoveryTimer.unref?.();
  }
}

function writeWorkerFailureOnce(topic, err) {
  const message = cleanId(err?.message || err);
  const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const existing = db.prepare(`SELECT id FROM sync_logs
    WHERE provider=? AND topic=? AND status='failed' AND error_message=? AND created_at>=?
    ORDER BY created_at DESC LIMIT 1`).get(PROVIDER, topic, message, cutoff);
  return existing?.id || writeSyncLog({ topic, status: 'failed', error_message: message });
}
