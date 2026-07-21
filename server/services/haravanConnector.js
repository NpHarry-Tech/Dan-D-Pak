import crypto from 'node:crypto';
import { db, uid, now, audit } from '../db.js';
import { safeEqual } from '../core/util.js';
import { env } from '../config/env.js';
import { emit } from '../realtime.js';
import { getIntegrationChannel } from './settings.js';

const PROVIDER = 'haravan';
const AUTH_BASE = 'https://accounts.haravan.com';
const WEBHOOK_BASE = 'https://webhook.haravan.com';
const DEFAULT_SCOPES = 'openid org profile userinfo grant_service wh_api com.read_orders com.write_orders com.read_products com.write_products com.read_customers com.write_customers com.read_inventories com.write_inventories';
const SUPPORTED_TOPICS = new Set([
  'orders/create', 'orders/updated', 'orders/update', 'orders/cancelled', 'orders/cancel', 'orders/paid',
  'customers/create', 'customers/update',
  'products/create', 'products/update', 'products/delete',
  'inventory/update', 'inventorylocationbalances/update',
]);

let workerRunning = false;
let timer = null;
let inventoryTimer = null;

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
    syncOrders: c.syncOrders !== false,
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
  if (installed) return {
    enabled: true,
    shopDomain: installed.shop_domain,
    accessToken: installed.access_token,
    refreshToken: installed.refresh_token || '',
    webhookSecret: env.HARAVAN_CLIENT_SECRET || fallback.webhookSecret,
    clientId: env.HARAVAN_CLIENT_ID || fallback.clientId,
    clientSecret: env.HARAVAN_CLIENT_SECRET || fallback.clientSecret,
    verifyToken: env.HARAVAN_WEBHOOK_VERIFY_TOKEN || fallback.verifyToken,
    apiBase: installed.api_base || 'https://apis.haravan.com',
    defaultBranchId: installed.branch_id || 'ONLINE',
    locationId: installed.location_id || fallback.locationId,
    syncOrders: fallback.syncOrders,
    syncProducts: fallback.syncProducts,
    syncInventory: fallback.syncInventory,
  };
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
  if (topic.startsWith('orders/') || topic.startsWith('customers/')) return cfg.syncOrders;
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

export function writeSyncLog({ shop_domain = '', topic, external_id, status, error_message = '', raw_payload = null, retry_count = 0, next_retry_at = null }) {
  const id = uid('sl_');
  db.prepare(`INSERT INTO sync_logs
    (id,provider,shop_domain,topic,external_id,status,error_message,raw_payload,retry_count,next_retry_at,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, PROVIDER, normShop(shop_domain), topic || null, external_id || null, status, error_message || null,
      raw_payload == null ? null : json(raw_payload), retry_count, next_retry_at, now());
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
      tokens.access_token, tokens.refresh_token || null, tokens.scope || '', tokens.token_type || 'Bearer',
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

async function webhookSubscribeRequest(shopDomain, method = 'POST') {
  const cfg = config(shopDomain);
  const res = await fetch(`${WEBHOOK_BASE}/api/subscribe`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.accessToken}` },
    body: method === 'POST' ? '{}' : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error === true) throw new Error(data.message || data.error || `Haravan webhook ${res.status}`);
  return data;
}

export async function subscribeWebhook(shopDomain = '') {
  const data = await webhookSubscribeRequest(shopDomain, 'POST');
  audit('haravan.webhook.subscribe', { shop_domain: normShop(shopDomain || config().shopDomain) }, defaultBranch(shopDomain), 'haravan');
  return data;
}

export async function unsubscribeWebhook(shopDomain = '') {
  const data = await webhookSubscribeRequest(shopDomain, 'DELETE');
  audit('haravan.webhook.unsubscribe', { shop_domain: normShop(shopDomain || config().shopDomain) }, defaultBranch(shopDomain), 'haravan');
  return data;
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

function skuForLine(line, shopDomain = '') {
  const variantId = cleanId(line.variant_id);
  const productId = cleanId(line.product_id);
  const mapped = db.prepare(`SELECT internal_variant_id FROM external_products
    WHERE provider=? AND shop_domain=? AND external_product_id=? AND external_variant_id=?`)
    .get(PROVIDER, normShop(shopDomain), productId, variantId);
  if (mapped?.internal_variant_id) return mapped.internal_variant_id;
  const sku = cleanId(line.sku);
  if (!sku) return null;
  return db.prepare(`SELECT id FROM skus WHERE barcode=? OR id=? ORDER BY active DESC LIMIT 1`).get(sku, sku)?.id || null;
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

  db.prepare('BEGIN IMMEDIATE').run();
  try {
    let internalId = db.prepare(`SELECT internal_order_id FROM external_orders WHERE provider=? AND shop_domain=? AND external_order_id=?`)
      .get(PROVIDER, shop, externalId)?.internal_order_id;
    const subtotal = lines.reduce((sum, line) => sum + money(line.price) * Math.max(1, Number(line.quantity || 1)), 0);
    const discount = money(payload.total_discounts || payload.discount);
    const total = money(payload.total_price || payload.total || Math.max(0, subtotal - discount));
    const status = payload.cancelled_at || topic === 'orders/cancelled' || topic === 'orders/cancel' ? 'void' : 'waiting_assignment';
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
      db.prepare(`UPDATE orders SET status=?, subtotal=?, discount=?, total=?, online_status=?, customer_json=? WHERE id=?`)
        .run(status, subtotal, discount, total, topic, customerJson, internalId);
      db.prepare(`DELETE FROM order_items WHERE order_id=?`).run(internalId);
    }

    const ins = db.prepare(`INSERT INTO order_items
      (id,order_id,menu_item_id,sku_id,name,emoji,qty,unit_price,station,sla_minutes,note,mods_json,status,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,'[]','served',?)`);
    for (const line of lines) {
      ins.run(uid('oi_'), internalId, null, skuForLine(line, shop), line.name || line.title || 'Haravan item', null,
        Math.max(1, Number(line.quantity || 1)), money(line.price), 'retail', 0, line.sku || null, now());
    }

    db.prepare(`INSERT INTO external_orders
      (id,provider,shop_domain,external_order_id,internal_order_id,external_order_code,sync_status,raw_payload,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(provider, shop_domain, external_order_id) DO UPDATE SET
        internal_order_id=excluded.internal_order_id,external_order_code=excluded.external_order_code,
        sync_status=excluded.sync_status,raw_payload=excluded.raw_payload,updated_at=excluded.updated_at`)
      .run(uid('eo_'), PROVIDER, shop, externalId, internalId, externalCode, 'success', json(payload), now(), now());

    db.prepare('COMMIT').run();
    audit('haravan.order.sync', { shop_domain: shop, external_order_id: externalId, order_id: internalId, topic }, branch_id, 'haravan');
    emit('online:new', { id: internalId, provider: PROVIDER, ref: externalId, branch_id }, branch_id);
    emit('stats:dirty', {}, branch_id);
    return { internal_order_id: internalId, external_order_id: externalId };
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
    const skuId = `hvn_${variantId}`.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 80);
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
  if (!/^\d+$/.test(cleanId(cfg.locationId))) return { ignored: true, reason: 'location_not_configured' };
  const item = payload.inventory_location_balance || payload.inventoryLocationBalance || payload;
  const locationId = cleanId(item.loc_id || item.location_id);
  if (locationId && locationId !== cleanId(cfg.locationId)) return { ignored: true, reason: 'different_location' };
  const variantId = cleanId(item.variant_id || item.product_variant_id || item.inventory_item_id);
  const sku = cleanId(item.sku || item.barcode);
  const qty = Number(item.qty_available ?? item.quantity ?? item.available ?? item.inventory_quantity);
  if (!Number.isFinite(qty)) return { ignored: true };
  const mapped = variantId
    ? db.prepare(`SELECT internal_variant_id FROM external_products WHERE provider=? AND shop_domain=? AND external_variant_id=?`).get(PROVIDER, shop, variantId)
    : null;
  const skuId = mapped?.internal_variant_id || (sku ? db.prepare(`SELECT id FROM skus WHERE barcode=? OR id=? LIMIT 1`).get(sku, sku)?.id : null);
  if (!skuId) return { ignored: true };
  db.prepare(`UPDATE skus SET stock=? WHERE id=?`).run(qty, skuId);
  audit('haravan.inventory.sync', { shop_domain: shop, sku_id: skuId, qty }, defaultBranch(shop), 'haravan');
  emit('inventory:updated', { ids: [skuId] }, defaultBranch(shop));
  return { sku_id: skuId, qty };
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
      WHERE provider=? AND status IN ('received','retrying')
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

function resourcePath(resource, page, updatedAtMin = '') {
  const params = new URLSearchParams({ limit: '50', page: String(page) });
  if (updatedAtMin) params.set('updated_at_min', updatedAtMin);
  if (resource === 'orders') return { path: `/com/orders.json?${params}`, listKey: 'orders', topic: 'orders/updated' };
  if (resource === 'products') return { path: `/com/products.json?${params}`, listKey: 'products', topic: 'products/update' };
  if (resource === 'customers') return { path: `/com/customers.json?${params}`, listKey: 'customers', topic: 'customers/update' };
  throw new Error('unsupported_haravan_resource');
}

async function pullHaravanResource(resource, { shopDomain = '', delta = true, maxPages = 200 } = {}) {
  const shop = normShop(shopDomain || config().shopDomain);
  const since = delta ? getState(shop, `${resource}.updated_at_min`) : '';
  let queued = 0;
  let newest = since;
  for (let page = 1; page <= maxPages; page++) {
    const spec = resourcePath(resource, page, since);
    const data = await haravanRequest(spec.path, { shopDomain: shop });
    const rows = Array.isArray(data[spec.listKey]) ? data[spec.listKey] : [];
    for (const row of rows) {
      writeSyncLog({ shop_domain: shop, topic: spec.topic, external_id: cleanId(row.id), status: 'received', raw_payload: { shop, payload: row } });
      if (row.updated_at && (!newest || String(row.updated_at) > newest)) newest = row.updated_at;
    }
    queued += rows.length;
    if (rows.length < 50) break;
  }
  if (newest) upsertState(shop, `${resource}.updated_at_min`, newest);
  processHaravanQueue();
  audit(`haravan.${resource}.pull`, { shop_domain: shop, queued, delta }, defaultBranch(shop), 'admin');
  return { shopDomain: shop, resource, queued };
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
  for (const shop of shopsToSync(opts.shopDomain)) out.push(await pullHaravanResource(resource, { ...opts, shopDomain: shop }));
  return { results: out, queued: out.reduce((sum, x) => sum + x.queued, 0) };
}

export async function pullHaravanOrders(opts = {}) { return pullForShops('orders', opts); }
export async function pullHaravanProducts(opts = {}) { return pullForShops('products', opts); }
export async function pullHaravanCustomers(opts = {}) { return pullForShops('customers', opts); }

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
          note: 'Dan D Pak POS stock sync',
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
  };
}

export function listSyncLogs(limit = 100) {
  return db.prepare(`SELECT id,shop_domain,topic,external_id,status,error_message,retry_count,created_at,processed_at
    FROM sync_logs WHERE provider=? ORDER BY created_at DESC LIMIT ?`)
    .all(PROVIDER, Math.max(1, Math.min(500, Number(limit) || 100)));
}

export function startHaravanWorker() {
  db.prepare(`DELETE FROM sync_logs
    WHERE provider=? AND topic='inventory/push' AND status='failed'
      AND error_message='HARAVAN_LOCATION_ID is not set'`).run(PROVIDER);
  if (!timer) {
    timer = setInterval(() => processHaravanQueue(), 30000);
    timer.unref?.();
  }
  if (!inventoryTimer) {
    inventoryTimer = setInterval(() => pushPendingInventoryChanges().catch(err =>
      writeWorkerFailureOnce('inventory/push', err)), 60000);
    inventoryTimer.unref?.();
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
