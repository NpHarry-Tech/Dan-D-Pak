// ─────────────────────────────────────────────────────────────────────────
// CONNECTION PLATFORM — lifecycle kết nối sàn dùng chung.
// Sở hữu auth-attempt/anti-replay, callback orchestration và connection state.
// Token persistence/decryption nằm ở connectionStore.js để provider runtime có
// thể dùng chung mà không tạo dependency vòng giữa connector ↔ platform.
// ─────────────────────────────────────────────────────────────────────────
import { db, uid, now, audit } from '../db.js';
import { emit } from '../realtime.js';
import { shopeeConfig, shopeeAuthLink, exchangeShopeeCodeRaw } from './shopeeConnector.js';
import { lazadaConfig, lazadaAuthLink, exchangeLazadaCodeRaw } from './lazadaConnector.js';
import { tiktokConfig, tiktokAuthLink, exchangeTiktokCodeRaw } from './tiktokConnector.js';
import {
  ensureConnectionStore,
  upsertAuthorizedConnection,
  listPublicConnections,
  findConnectionById,
  mapConnectionShop,
  setConnectionCapability,
  updateConnectionSettingsStore,
  markConnectionDisconnected,
  publicConnection,
} from './connectionStore.js';

const ATTEMPT_TTL_MS = 10 * 60 * 1000;

// Placeholder trong .env.example (REPLACE_WITH_...) hoặc rỗng KHÔNG phải credential
// thật → coi như CHƯA cấu hình. Chống mở OAuth URL với Partner ID/Key giả trước khi
// Shopee cấp Sandbox thật (Shopee review flow §1/§2): fail-closed thay vì đoán.
const isRealCredential = (v) => {
  const s = String(v || '').trim();
  return s.length > 0 && !/^REPLACE_WITH/i.test(s);
};

const ADAPTERS = {
  shopee: {
    label: 'Shopee',
    configured: (b) => { const c = shopeeConfig(b); return isRealCredential(c.partnerId) && isRealCredential(c.secretKey); },
    buildAuthUrl: (b, redirect) => shopeeAuthLink(b, redirect),
    stateInRedirect: true,
    exchange: async (b, params) => {
      const shopId = String(params.shop_id || '').trim();
      if (!params.code || !shopId) throw new Error('Callback Shopee thiếu code/shop_id.');
      const t = await exchangeShopeeCodeRaw(b, params.code, shopId);
      return { shop_id: shopId, shop_name: '', ...t };
    },
    region: (b) => shopeeConfig(b).region || 'VN',
  },
  lazada: {
    label: 'Lazada',
    configured: (b) => { const c = lazadaConfig(b); return isRealCredential(c.appId) && isRealCredential(c.secretKey); },
    buildAuthUrl: (b, redirect, state) => lazadaAuthLink(b, redirect, state),
    exchange: async (b, params) => {
      if (!params.code) throw new Error('Callback Lazada thiếu code.');
      return exchangeLazadaCodeRaw(b, params.code);
    },
    region: (b) => lazadaConfig(b).region || 'VN',
  },
  tiktokshop: {
    label: 'TikTok Shop',
    configured: (b) => { const c = tiktokConfig(b); return isRealCredential(c.appId) && isRealCredential(c.secretKey) && isRealCredential(c.serviceId); },
    buildAuthUrl: (b, redirect, state) => tiktokAuthLink(b, redirect, state),
    callbackSlug: 'tiktok',
    exchange: async (b, params) => {
      const code = params.code || params.auth_code;
      if (!code) throw new Error('Callback TikTok Shop thiếu auth_code.');
      return exchangeTiktokCodeRaw(b, code);
    },
    region: (b) => tiktokConfig(b).region || 'VN',
  },
};

function adapter(provider) {
  const a = ADAPTERS[String(provider || '').toLowerCase()];
  if (!a) {
    const e = new Error(`Sàn không hỗ trợ kết nối 1 chạm: ${provider}`);
    e.status = 400;
    throw e;
  }
  return a;
}

let ready = false;
function ensure() {
  if (ready) return;
  ensureConnectionStore();
  db.exec(`
    CREATE TABLE IF NOT EXISTS marketplace_auth_attempts (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      branch_id TEXT NOT NULL,
      user_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      shop_id TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_mp_auth_attempt_branch
      ON marketplace_auth_attempts(branch_id, provider, created_at);
  `);
  ready = true;
}

function expiryFromSeconds(seconds) {
  const n = Number(seconds || 0);
  return n > 0 ? new Date(Date.now() + n * 1000).toISOString() : null;
}

export function startConnect(provider, { branch_id = 'sala', user_id = '', redirectBase = '' } = {}) {
  ensure();
  const prov = String(provider).toLowerCase();
  const a = adapter(prov);
  if (!a.configured(branch_id)) {
    // FAIL-CLOSED: chưa có credential thật (hoặc còn placeholder REPLACE_WITH_…).
    // KHÔNG dựng OAuth URL với Partner ID giả. Trả code ổn định để client hiện
    // trạng thái KHÔNG-bí-mật ("Shopee Sandbox chưa được cấp/cấu hình.").
    const e = new Error(`Chưa cấu hình credential nền tảng cho ${a.label} ở server.`);
    e.status = 400;
    e.code = prov === 'shopee' ? 'SHOPEE_SANDBOX_NOT_CONFIGURED' : `${prov.toUpperCase()}_NOT_CONFIGURED`;
    throw e;
  }
  const base = String(redirectBase || '').replace(/\/+$/, '');
  if (!base) {
    const e = new Error('Server chưa cấu hình API_BASE_URL/APP_URL cho callback marketplace.');
    e.status = 500;
    throw e;
  }
  const id = uid('mpatt_');
  const expires = new Date(Date.now() + ATTEMPT_TTL_MS).toISOString();
  db.prepare(`INSERT INTO marketplace_auth_attempts
      (id,provider,branch_id,user_id,status,created_at,expires_at)
      VALUES (?,?,?,?,'pending',?,?)`)
    .run(id, prov, branch_id, String(user_id || ''), now(), expires);
  const callback = `${base}/auth/${a.callbackSlug || prov}/callback`;
  const redirect = a.stateInRedirect ? `${callback}?state=${encodeURIComponent(id)}` : callback;
  const url = a.buildAuthUrl(branch_id, redirect, id);
  audit('mp.connect.start', { provider: prov, attempt_id: id }, branch_id, user_id || 'system');
  return { url, attempt_id: id, expires_at: expires, provider: prov };
}

export async function handleCallback(provider, params = {}) {
  ensure();
  const prov = String(provider).toLowerCase();
  const a = adapter(prov);
  const state = String(params.state || '');
  const attempt = db.prepare(`SELECT * FROM marketplace_auth_attempts WHERE id=? AND provider=?`).get(state, prov);
  if (!attempt) { const e = new Error('Phiên kết nối không hợp lệ.'); e.status = 400; throw e; }
  if (attempt.status !== 'pending') { const e = new Error('Phiên kết nối đã dùng hoặc hết hạn.'); e.status = 409; throw e; }
  if (Date.parse(attempt.expires_at) < Date.now()) {
    db.prepare(`UPDATE marketplace_auth_attempts SET status='expired' WHERE id=?`).run(attempt.id);
    const e = new Error('Phiên kết nối đã hết hạn.'); e.status = 410; throw e;
  }

  if (params.error || params.error_description) {
    db.prepare(`UPDATE marketplace_auth_attempts SET status='denied',error=?,completed_at=? WHERE id=? AND status='pending'`)
      .run(String(params.error_description || params.error).slice(0, 500), now(), attempt.id);
    const e = new Error('Người bán đã từ chối hoặc hủy cấp quyền.'); e.status = 400; throw e;
  }

  // Claim before exchanging the one-use provider code. This closes the race in
  // which two concurrent callbacks could both observe status=pending.
  const claimed = db.prepare(`UPDATE marketplace_auth_attempts SET status='processing'
    WHERE id=? AND status='pending'`).run(attempt.id).changes;
  if (!claimed) { const e = new Error('Phiên kết nối đã được xử lý.'); e.status = 409; throw e; }

  const branch_id = attempt.branch_id;
  try {
    const t = await a.exchange(branch_id, params);
    const shops = Array.isArray(t.shops) && t.shops.length
      ? t.shops
      : [{ shop_id: t.shop_id, shop_name: t.shop_name || '', region: a.region(branch_id) }];
    const normalizedShops = shops.map(shop => ({
      ...shop,
      external_shop_id: String(shop.external_shop_id || shop.shop_id || shop.id || '').trim(),
    })).filter(shop => shop.external_shop_id);
    if (!normalizedShops.length) throw new Error('Không xác định được gian hàng sau uỷ quyền.');
    const accountId = String(t.external_account_id || t.account_id || normalizedShops[0].external_shop_id).trim();
    const vaultKey = normalizedShops.length === 1
      ? normalizedShops[0].external_shop_id
      : `account:${accountId || attempt.id}`;

    const connection = upsertAuthorizedConnection({
      provider: prov,
      branchId: branch_id,
      shopId: vaultKey,
      shopName: normalizedShops.length === 1 ? (normalizedShops[0].shop_name || '') : '',
      region: a.region(branch_id),
      accessToken: t.access_token || '',
      refreshToken: t.refresh_token || '',
      accessExpiresAt: t.access_expires_at || expiryFromSeconds(t.expire_in || t.expires_in),
      // Không đoán TTL refresh. Chỉ lưu khi provider thực sự trả về.
      refreshExpiresAt: t.refresh_expires_at || expiryFromSeconds(t.refresh_expire_in || t.refresh_token_expire_in),
      createdBy: attempt.user_id || '',
      externalAccountId: accountId,
      environment: String(t.environment || 'sandbox'),
      grantedScopes: t.granted_scopes || [],
      status: normalizedShops.length > 1 ? 'pending_shop_selection' : 'pending_mapping',
      shops: normalizedShops,
    });
    setConnectionCapability(connection.id, 'authorization', 'verified');
    for (const capability of ['orders_read','products_read','inventory_write','fulfillment_write','returns_read','finance_read','payment_settlement_write']) {
      setConnectionCapability(connection.id, capability, 'blocked',
        capability.endsWith('_write') ? 'Requires approved scope, sandbox evidence and owner approval.' : 'Pending capability probe.');
    }

    db.prepare(`UPDATE marketplace_auth_attempts
      SET status='done',shop_id=?,completed_at=? WHERE id=?`).run(vaultKey, now(), attempt.id);
    audit('mp.connect.authorized', { provider: prov, shop_count: normalizedShops.length, connection_id: connection.id }, branch_id, attempt.user_id || 'system');
    emit(`${prov}:authorized`, { attempt_id: attempt.id, shop_count: normalizedShops.length, connection_id: connection.id }, branch_id);
    emit('marketplace:connected', { provider: prov, connection_id: connection.id }, branch_id);
    return { ok: true, provider: prov, connection_id: connection.id, shop_count: normalizedShops.length };
  } catch (err) {
    db.prepare(`UPDATE marketplace_auth_attempts SET status='error',error=?,completed_at=? WHERE id=?`)
      .run(String(err.message || err).slice(0, 500), now(), attempt.id);
    audit('mp.connect.failed', { provider: prov, attempt_id: attempt.id, error: err.message }, branch_id, attempt.user_id || 'system');
    throw err;
  }
}

export function attemptStatus(id, branch_id = '') {
  ensure();
  const attempt = branch_id
    ? db.prepare(`SELECT id,provider,status,shop_id,error,expires_at FROM marketplace_auth_attempts WHERE id=? AND branch_id=?`).get(String(id), String(branch_id))
    : db.prepare(`SELECT id,provider,status,shop_id,error,expires_at FROM marketplace_auth_attempts WHERE id=?`).get(String(id));
  if (!attempt) return { status: 'not_found' };
  if (attempt.status === 'pending' && Date.parse(attempt.expires_at) < Date.now()) {
    db.prepare(`UPDATE marketplace_auth_attempts SET status='expired' WHERE id=?`).run(attempt.id);
    return { status: 'expired', provider: attempt.provider };
  }
  return {
    status: attempt.status,
    provider: attempt.provider,
    shop_id: attempt.shop_id || null,
    error: attempt.error || null,
  };
}

export function listConnections(provider, branch_id = 'sala') {
  ensure();
  return { connections: listPublicConnections(provider, branch_id) };
}

export function updateConnectionSettings(id, settings = {}, branch_id = 'sala', actor = 'system') {
  ensure();
  const out = updateConnectionSettingsStore(id, settings, branch_id);
  audit('mp.settings.changed', { provider: out.provider, connection_id: id }, branch_id, actor);
  return out;
}

export function selectAndMapShop(id, input = {}, branch_id = 'sala', actor = 'system') {
  ensure();
  const targetBranch = String(input.branch_id || branch_id);
  const out = mapConnectionShop(id, {
    externalShopId: input.shop_id,
    branchId: targetBranch,
    warehouseId: input.warehouse_id,
    inventoryPolicy: input.inventory_policy || {},
  });
  audit('mp.shop.mapped', { provider: out.provider, connection_id: id,
    shop_id: input.shop_id, warehouse_id: input.warehouse_id }, targetBranch, actor);
  emit('marketplace:mapped', { provider: out.provider, connection_id: id }, targetBranch);
  return out;
}

export function mappingOptions(branch_id = 'sala') {
  ensure();
  const branch = db.prepare(`SELECT id,name FROM branches WHERE id=? AND active=1`).get(String(branch_id));
  const warehouses = db.prepare(`SELECT id,code,name,type FROM warehouses
    WHERE branch_id=? AND active=1 ORDER BY sort,name`).all(String(branch_id));
  return { branches: branch ? [branch] : [], warehouses };
}

export function completeInitialSync(id, branch_id, { orders, products } = {}, actor = 'system') {
  ensure();
  const connection = findConnectionById(id, branch_id);
  if (!connection) throw new Error('Không tìm thấy kết nối marketplace.');
  if (!['initial_sync','degraded'].includes(connection.status)) throw new Error('Kết nối chưa sẵn sàng đồng bộ lần đầu.');
  setConnectionCapability(id, 'orders_read', 'verified');
  setConnectionCapability(id, 'products_read', 'verified');
  db.prepare(`UPDATE marketplace_connections SET status='active',last_sync_at=?,last_reconciliation_at=?,last_verified_at=?,error=NULL,updated_at=? WHERE id=?`)
    .run(now(), now(), now(), now(), id);
  for (const mapping of db.prepare(`SELECT s.external_shop_id FROM marketplace_shop_mappings m
    JOIN marketplace_shops s ON s.id=m.shop_id WHERE m.connection_id=? AND m.enabled=1`).all(id)) {
    for (const capability of ['orders_read','products_read']) {
      db.prepare(`INSERT INTO marketplace_sync_cursors(connection_id,external_shop_id,capability,cursor,watermark_at,updated_at)
        VALUES (?,?,?,NULL,?,?) ON CONFLICT(connection_id,external_shop_id,capability)
        DO UPDATE SET watermark_at=excluded.watermark_at,updated_at=excluded.updated_at`)
        .run(id, mapping.external_shop_id, capability, now(), now());
    }
  }
  audit('mp.initial_sync.done', { provider: connection.provider, connection_id: id,
    orders: Number(orders?.pulled || 0), products: Number(products?.synced || 0) }, branch_id, actor);
  return publicConnection(db.prepare(`SELECT * FROM marketplace_connections WHERE id=?`).get(id));
}

export function completeReconciliation(id, branch_id, result = {}, actor = 'system') {
  ensure();
  const connection = findConnectionById(id, branch_id);
  if (!connection) throw new Error('Không tìm thấy kết nối marketplace.');
  db.prepare(`UPDATE marketplace_connections SET last_sync_at=?,last_reconciliation_at=?,last_verified_at=?,
    status=CASE WHEN status='degraded' THEN 'active' ELSE status END,error=NULL,updated_at=? WHERE id=?`)
    .run(now(), now(), now(), now(), id);
  audit('mp.reconciliation.done', { provider: connection.provider, connection_id: id,
    orders: Number(result.orders?.pulled || 0), products: Number(result.products?.synced || 0) }, branch_id, actor);
  return publicConnection(db.prepare(`SELECT * FROM marketplace_connections WHERE id=?`).get(id));
}

export async function refreshExpiringMarketplaceTokens() {
  ensure();
  const threshold = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const rows = db.prepare(`SELECT id,provider,branch_id FROM marketplace_connections
    WHERE status IN ('initial_sync','active','degraded') AND access_expires_at IS NOT NULL
      AND access_expires_at<=? ORDER BY access_expires_at LIMIT 20`).all(threshold);
  let refreshed = 0;
  for (const row of rows) {
    try {
      if (row.provider === 'tiktokshop') {
        const mod = await import('./tiktokConnector.js');
        await mod.tiktokRefreshToken(row.branch_id);
      } else if (row.provider === 'lazada') {
        const mod = await import('./lazadaConnector.js');
        await mod.lazadaRefreshToken(row.branch_id);
      } else if (row.provider === 'shopee') {
        const mod = await import('./shopeeConnector.js');
        await mod.shopeeRefreshToken(row.branch_id);
      } else continue;
      refreshed++;
    } catch (error) {
      db.prepare(`UPDATE marketplace_connections SET status='reauthorization_required',error=?,updated_at=? WHERE id=?`)
        .run(String(error?.message || error).slice(0, 500), now(), row.id);
      audit('mp.token.refresh_failed', { provider: row.provider, connection_id: row.id,
        error: error?.message }, row.branch_id, 'system');
    }
  }
  return { checked: rows.length, refreshed };
}

export function migrateLegacyMarketplaceConnections() {
  ensure();
  const branchIds = new Set([
    ...db.prepare(`SELECT id FROM branches`).all().map(row => row.id),
    ...db.prepare(`SELECT branch_id FROM app_settings WHERE key='integrations_config'`).all().map(row => row.branch_id),
  ]);
  let migrated = 0;
  for (const branchId of branchIds) {
    for (const provider of ['tiktokshop', 'lazada']) {
      const cfg = provider === 'tiktokshop' ? tiktokConfig(branchId) : lazadaConfig(branchId);
      const shopId = provider === 'tiktokshop' ? cfg.shopId : cfg.sellerId;
      if (!shopId || !cfg.accessToken || cfg.tokenSource === 'connection_platform') continue;
      const exists = db.prepare(`SELECT id FROM marketplace_connections WHERE provider=? AND shop_id=?`).get(provider, shopId);
      if (exists) continue;
      upsertAuthorizedConnection({ provider, branchId, shopId, region: cfg.region,
        accessToken: cfg.accessToken, refreshToken: cfg.refreshToken,
        externalAccountId: shopId, environment: cfg.environment,
        status: 'pending_mapping', createdBy: 'legacy_migration',
        shops: [{ shop_id: shopId, shop_cipher: provider === 'tiktokshop' ? cfg.shopCipher : '', region: cfg.region }],
      });
      audit('mp.legacy.vault_migrated', { provider, shop_id: shopId }, branchId, 'system');
      migrated++;
    }
  }
  return { migrated };
}

export function disconnect(id, branch_id = 'sala', actor = 'system') {
  ensure();
  const current = findConnectionById(id, branch_id);
  if (!current) throw new Error('Không tìm thấy kết nối.');
  // Remote revoke là capability provider-specific; chưa giả lập khi chưa có endpoint
  // được xác minh. Local disconnect luôn xoá token mã hoá khỏi vault.
  markConnectionDisconnected(id, branch_id);
  audit('mp.disconnected', { provider: current.provider, connection_id: id, shop_id: current.shop_id }, branch_id, actor);
  emit('marketplace:disconnected', { provider: current.provider, connection_id: id }, branch_id);
  return { ok: true };
}
