// Kho lưu trữ kết nối marketplace dùng chung.
// Chỉ module backend nội bộ được lấy token thô; API bên ngoài chỉ dùng publicConnection().
import { db, uid, now } from '../db.js';
import { encryptSecret, decryptSecret, secretContext } from '../core/crypto.js';

let ready = false;

export function ensureConnectionStore() {
  if (ready) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS marketplace_connections (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      branch_id TEXT NOT NULL,
      shop_id TEXT NOT NULL,
      shop_name TEXT,
      region TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      access_token_enc TEXT,
      refresh_token_enc TEXT,
      access_expires_at TEXT,
      refresh_expires_at TEXT,
      authorized_at TEXT,
      last_refresh_at TEXT,
      last_sync_at TEXT,
      settings_json TEXT,
      error TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      disconnected_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_mp_conn_provider_shop
      ON marketplace_connections(provider, shop_id);
    CREATE TABLE IF NOT EXISTS marketplace_shops (
      id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL REFERENCES marketplace_connections(id) ON DELETE CASCADE,
      external_shop_id TEXT NOT NULL,
      shop_cipher TEXT,
      shop_name TEXT,
      region TEXT,
      status TEXT NOT NULL DEFAULT 'available',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT,
      UNIQUE(connection_id,external_shop_id)
    );
    CREATE TABLE IF NOT EXISTS marketplace_shop_mappings (
      id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL REFERENCES marketplace_connections(id) ON DELETE CASCADE,
      shop_id TEXT NOT NULL REFERENCES marketplace_shops(id) ON DELETE CASCADE,
      branch_id TEXT NOT NULL,
      warehouse_id TEXT NOT NULL,
      inventory_policy_json TEXT NOT NULL DEFAULT '{"source":"pos","safety_stock":0}',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      UNIQUE(connection_id,shop_id)
    );
    CREATE TABLE IF NOT EXISTS marketplace_capabilities (
      connection_id TEXT NOT NULL REFERENCES marketplace_connections(id) ON DELETE CASCADE,
      capability TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'blocked',
      reason TEXT,
      verified_at TEXT,
      PRIMARY KEY(connection_id,capability)
    );
    CREATE TABLE IF NOT EXISTS marketplace_sync_cursors (
      connection_id TEXT NOT NULL REFERENCES marketplace_connections(id) ON DELETE CASCADE,
      external_shop_id TEXT NOT NULL,
      capability TEXT NOT NULL,
      cursor TEXT,
      watermark_at TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(connection_id,external_shop_id,capability)
    );
    CREATE TABLE IF NOT EXISTS marketplace_token_refresh_locks (
      connection_id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
  `);
  const columns = new Set(db.prepare(`PRAGMA table_info(marketplace_connections)`).all().map(c => c.name));
  const additions = {
    external_account_id: 'TEXT', environment: `TEXT NOT NULL DEFAULT 'sandbox'`,
    granted_scopes_json: `TEXT NOT NULL DEFAULT '[]'`, credential_version: 'INTEGER NOT NULL DEFAULT 1',
    last_verified_at: 'TEXT', last_event_at: 'TEXT', last_reconciliation_at: 'TEXT',
  };
  for (const [name, type] of Object.entries(additions)) {
    if (!columns.has(name)) db.exec(`ALTER TABLE marketplace_connections ADD COLUMN ${name} ${type}`);
  }
  ready = true;
}

function tokenContext(provider, shopId, kind, branchId = '') {
  return [
    secretContext({ tenant: branchId || 'legacy', provider, record: shopId, field: `${kind}_token` }),
    `${provider}:${shopId}:${kind}`,
  ];
}

function decrypted(row) {
  if (!row) return null;
  return {
    ...row,
    access_token: row.access_token_enc
      ? decryptSecret(row.access_token_enc, tokenContext(row.provider, row.shop_id, 'access', row.branch_id)) : '',
    refresh_token: row.refresh_token_enc
      ? decryptSecret(row.refresh_token_enc, tokenContext(row.provider, row.shop_id, 'refresh', row.branch_id)) : '',
  };
}

export function publicConnection(row) {
  if (!row) return null;
  let settings = {};
  try { settings = row.settings_json ? JSON.parse(row.settings_json) : {}; } catch { settings = {}; }
  const shops = db.prepare(`SELECT id,external_shop_id,shop_name,region,status,metadata_json
    FROM marketplace_shops WHERE connection_id=? ORDER BY shop_name,external_shop_id`).all(row.id).map(shop => ({
      ...shop,
      metadata: (() => { try { return JSON.parse(shop.metadata_json || '{}'); } catch { return {}; } })(),
      metadata_json: undefined,
    }));
  const mappings = db.prepare(`SELECT m.id,m.shop_id,s.external_shop_id,s.shop_name,m.branch_id,m.warehouse_id,
      m.inventory_policy_json,m.enabled,m.updated_at
    FROM marketplace_shop_mappings m JOIN marketplace_shops s ON s.id=m.shop_id
    WHERE m.connection_id=? ORDER BY s.shop_name,s.external_shop_id`).all(row.id).map(mapping => ({
      ...mapping, enabled: mapping.enabled === 1,
      inventory_policy: (() => { try { return JSON.parse(mapping.inventory_policy_json || '{}'); } catch { return {}; } })(),
      inventory_policy_json: undefined,
    }));
  const capabilities = db.prepare(`SELECT capability,status,reason,verified_at
    FROM marketplace_capabilities WHERE connection_id=? ORDER BY capability`).all(row.id);
  return {
    id: row.id,
    provider: row.provider,
    branch_id: row.branch_id,
    shop_id: row.shop_id,
    shop_name: row.shop_name || '',
    region: row.region || 'VN',
    environment: row.environment || 'sandbox',
    external_account_id: row.external_account_id || '',
    status: row.status,
    granted_scopes: (() => { try { return JSON.parse(row.granted_scopes_json || '[]'); } catch { return []; } })(),
    authorized_at: row.authorized_at,
    last_sync_at: row.last_sync_at,
    last_refresh_at: row.last_refresh_at,
    last_verified_at: row.last_verified_at,
    last_event_at: row.last_event_at,
    last_reconciliation_at: row.last_reconciliation_at,
    access_expires_at: row.access_expires_at,
    refresh_expires_at: row.refresh_expires_at,
    settings,
    shops,
    mappings,
    capabilities,
    error: row.error || null,
  };
}

export function listPublicConnections(provider, branchId) {
  ensureConnectionStore();
  const prov = String(provider || '').trim().toLowerCase();
  const rows = prov
    ? db.prepare(`SELECT DISTINCT c.* FROM marketplace_connections c
        LEFT JOIN marketplace_shop_mappings m ON m.connection_id=c.id AND m.enabled=1
        WHERE c.provider=? AND (c.branch_id=? OR m.branch_id=?) AND c.status!='disconnected'
        ORDER BY COALESCE(c.updated_at,c.created_at) DESC`).all(prov, branchId, branchId)
    : db.prepare(`SELECT DISTINCT c.* FROM marketplace_connections c
        LEFT JOIN marketplace_shop_mappings m ON m.connection_id=c.id AND m.enabled=1
        WHERE (c.branch_id=? OR m.branch_id=?) AND c.status!='disconnected'
        ORDER BY COALESCE(c.updated_at,c.created_at) DESC`).all(branchId, branchId);
  return rows.map(publicConnection);
}

export function findConnectionById(id, branchId = '') {
  ensureConnectionStore();
  const row = branchId
    ? db.prepare(`SELECT * FROM marketplace_connections WHERE id=? AND branch_id=?`).get(String(id), String(branchId))
    : db.prepare(`SELECT * FROM marketplace_connections WHERE id=?`).get(String(id));
  return decrypted(row);
}

export function findActiveConnectionByProviderShop(provider, shopId) {
  ensureConnectionStore();
  const row = db.prepare(`SELECT * FROM marketplace_connections
    WHERE provider=? AND shop_id=? AND status='active' LIMIT 1`)
    .get(String(provider || '').toLowerCase(), String(shopId || ''));
  return decrypted(row);
}

export function findConnectionByProviderShop(provider, shopId) {
  ensureConnectionStore();
  const row = db.prepare(`SELECT c.* FROM marketplace_connections c
    JOIN marketplace_shops s ON s.connection_id=c.id
    JOIN marketplace_shop_mappings m ON m.connection_id=c.id AND m.shop_id=s.id AND m.enabled=1
    WHERE c.provider=? AND s.external_shop_id=? AND c.status NOT IN ('disconnected','revoked') LIMIT 1`)
    .get(String(provider || '').toLowerCase(), String(shopId || ''));
  return decrypted(row);
}

export function findActiveConnectionByProviderBranch(provider, branchId) {
  ensureConnectionStore();
  const row = db.prepare(`SELECT DISTINCT c.* FROM marketplace_connections c
    LEFT JOIN marketplace_shop_mappings m ON m.connection_id=c.id AND m.enabled=1
    WHERE c.provider=? AND (m.branch_id=? OR (m.id IS NULL AND c.branch_id=?))
      AND c.status IN ('active','initial_sync','pending_permissions','pending_mapping')
    ORDER BY COALESCE(c.updated_at,c.created_at) DESC LIMIT 1`)
    .get(String(provider || '').toLowerCase(), String(branchId || ''), String(branchId || ''));
  return decrypted(row);
}

export function findRuntimeConnectionByProviderBranch(provider, branchId) {
  const connection = findActiveConnectionByProviderBranch(provider, branchId);
  if (!connection) return null;
  const selected = db.prepare(`SELECT s.external_shop_id,s.shop_cipher,s.shop_name,s.region,m.warehouse_id,m.inventory_policy_json
    FROM marketplace_shop_mappings m JOIN marketplace_shops s ON s.id=m.shop_id
    WHERE m.connection_id=? AND m.branch_id=? AND m.enabled=1 ORDER BY m.updated_at DESC LIMIT 1`)
    .get(connection.id, String(branchId || ''));
  return { ...connection, selected_shop: selected || null };
}

export function findRuntimeConnectionByProviderShop(provider, shopId) {
  const connection = findConnectionByProviderShop(provider, shopId);
  if (!connection) return null;
  const selected = db.prepare(`SELECT s.external_shop_id,s.shop_cipher,s.shop_name,s.region,m.branch_id,m.warehouse_id,m.inventory_policy_json
    FROM marketplace_shop_mappings m JOIN marketplace_shops s ON s.id=m.shop_id
    WHERE m.connection_id=? AND s.external_shop_id=? AND m.enabled=1 LIMIT 1`)
    .get(connection.id, String(shopId || ''));
  return { ...connection, selected_shop: selected || null };
}

export function upsertAuthorizedConnection({
  provider,
  branchId,
  shopId,
  shopName = '',
  region = 'VN',
  accessToken = '',
  refreshToken = '',
  accessExpiresAt = null,
  refreshExpiresAt = null,
  createdBy = '',
  externalAccountId = '',
  environment = 'sandbox',
  grantedScopes = [],
  status = 'pending_mapping',
  shops = [],
}) {
  ensureConnectionStore();
  const prov = String(provider || '').toLowerCase();
  const shop = String(shopId || '').trim();
  const existing = db.prepare(`SELECT id FROM marketplace_connections WHERE provider=? AND shop_id=?`).get(prov, shop);
  const id = existing?.id || uid('mpconn_');
  const accessEnc = accessToken ? encryptSecret(accessToken, tokenContext(prov, shop, 'access', branchId)) : null;
  const refreshEnc = refreshToken ? encryptSecret(refreshToken, tokenContext(prov, shop, 'refresh', branchId)) : null;

  if (existing) {
    db.prepare(`UPDATE marketplace_connections SET
      branch_id=?, shop_name=COALESCE(NULLIF(?,''),shop_name), region=?, status=?,
      access_token_enc=?, refresh_token_enc=?, access_expires_at=?, refresh_expires_at=?,
      authorized_at=?, last_refresh_at=?, error=NULL, updated_at=?, disconnected_at=NULL,
      external_account_id=?,environment=?,granted_scopes_json=?,credential_version=credential_version+1
      WHERE id=?`)
      .run(branchId, shopName, region, status, accessEnc, refreshEnc, accessExpiresAt, refreshExpiresAt,
        now(), now(), now(), externalAccountId, environment, JSON.stringify(grantedScopes || []), id);
  } else {
    db.prepare(`INSERT INTO marketplace_connections
      (id,provider,branch_id,shop_id,shop_name,region,status,
       access_token_enc,refresh_token_enc,access_expires_at,refresh_expires_at,
       authorized_at,last_refresh_at,created_by,created_at,updated_at,
       external_account_id,environment,granted_scopes_json)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, prov, branchId, shop, shopName, region, status, accessEnc, refreshEnc,
        accessExpiresAt, refreshExpiresAt, now(), now(), String(createdBy || ''), now(), now(),
        externalAccountId, environment, JSON.stringify(grantedScopes || []));
  }
  for (const entry of shops || []) {
    const externalShopId = String(entry.external_shop_id || entry.shop_id || entry.id || '').trim();
    if (!externalShopId) continue;
    db.prepare(`INSERT INTO marketplace_shops
      (id,connection_id,external_shop_id,shop_cipher,shop_name,region,status,metadata_json,created_at,updated_at)
      VALUES (?,?,?,?,?,?,? ,?,?,?)
      ON CONFLICT(connection_id,external_shop_id) DO UPDATE SET
        shop_cipher=excluded.shop_cipher,shop_name=excluded.shop_name,region=excluded.region,
        status=excluded.status,metadata_json=excluded.metadata_json,updated_at=excluded.updated_at`)
      .run(uid('mpshop_'), id, externalShopId, String(entry.shop_cipher || entry.cipher || ''),
        String(entry.shop_name || entry.name || ''), String(entry.region || region || 'VN'),
        String(entry.status || 'available'), JSON.stringify(entry.metadata || {}), now(), now());
  }
  return findConnectionById(id, branchId);
}

export function mapConnectionShop(id, { externalShopId, branchId, warehouseId, inventoryPolicy = {} } = {}) {
  ensureConnectionStore();
  const connection = db.prepare(`SELECT * FROM marketplace_connections WHERE id=?`).get(String(id));
  if (!connection) throw new Error('Không tìm thấy kết nối marketplace.');
  const shop = db.prepare(`SELECT * FROM marketplace_shops WHERE connection_id=? AND external_shop_id=?`)
    .get(connection.id, String(externalShopId || ''));
  if (!shop) throw new Error('Gian hàng không thuộc phiên ủy quyền này.');
  const branch = db.prepare(`SELECT id FROM branches WHERE id=? AND active=1`).get(String(branchId || ''));
  if (!branch) throw new Error('Chi nhánh ánh xạ không hợp lệ.');
  const warehouse = db.prepare(`SELECT id FROM warehouses WHERE id=? AND branch_id=? AND active=1`)
    .get(String(warehouseId || ''), branch.id);
  if (!warehouse) throw new Error('Kho không hoạt động hoặc không thuộc chi nhánh đã chọn.');
  db.prepare(`INSERT INTO marketplace_shop_mappings
    (id,connection_id,shop_id,branch_id,warehouse_id,inventory_policy_json,enabled,created_at,updated_at)
    VALUES (?,?,?,?,?,?,1,?,?)
    ON CONFLICT(connection_id,shop_id) DO UPDATE SET branch_id=excluded.branch_id,
      warehouse_id=excluded.warehouse_id,inventory_policy_json=excluded.inventory_policy_json,
      enabled=1,updated_at=excluded.updated_at`)
    .run(uid('mpmap_'), connection.id, shop.id, branch.id, warehouse.id,
      JSON.stringify({ source: 'pos', safety_stock: 0, ...inventoryPolicy }), now(), now());
  db.prepare(`UPDATE marketplace_shops SET status='selected',updated_at=? WHERE id=?`).run(now(), shop.id);
  db.prepare(`UPDATE marketplace_connections SET branch_id=?,shop_name=?,
    status=CASE WHEN status='active' THEN 'active' ELSE 'initial_sync' END,updated_at=? WHERE id=?`)
    .run(branch.id, shop.shop_name || connection.shop_name || '', now(), connection.id);
  return publicConnection(db.prepare(`SELECT * FROM marketplace_connections WHERE id=?`).get(connection.id));
}

export function setConnectionCapability(id, capability, status, reason = '') {
  ensureConnectionStore();
  db.prepare(`INSERT INTO marketplace_capabilities(connection_id,capability,status,reason,verified_at)
    VALUES (?,?,?,?,?) ON CONFLICT(connection_id,capability) DO UPDATE SET
      status=excluded.status,reason=excluded.reason,verified_at=excluded.verified_at`)
    .run(String(id), String(capability), String(status), String(reason || ''), status === 'verified' ? now() : null);
}

export async function withConnectionRefreshLease(connectionId, work, leaseMs = 60_000) {
  ensureConnectionStore();
  if (!connectionId) return work();
  const owner = uid('mprl_');
  const expiredAt = now();
  const expiresAt = new Date(Date.now() + Math.max(10_000, leaseMs)).toISOString();
  const acquired = db.prepare(`INSERT INTO marketplace_token_refresh_locks(connection_id,owner_id,expires_at)
    VALUES (?,?,?) ON CONFLICT(connection_id) DO UPDATE SET owner_id=excluded.owner_id,expires_at=excluded.expires_at
    WHERE marketplace_token_refresh_locks.expires_at<=?`)
    .run(String(connectionId), owner, expiresAt, expiredAt).changes;
  if (!acquired) {
    const error = new Error('Token refresh đang được một worker khác xử lý.');
    error.code = 'MARKETPLACE_REFRESH_IN_PROGRESS'; error.status = 409; throw error;
  }
  try { return await work(); }
  finally {
    db.prepare(`DELETE FROM marketplace_token_refresh_locks WHERE connection_id=? AND owner_id=?`)
      .run(String(connectionId), owner);
  }
}

export function updateConnectionTokens(id, {
  accessToken,
  refreshToken,
  accessExpiresAt,
  refreshExpiresAt,
} = {}) {
  ensureConnectionStore();
  const row = db.prepare(`SELECT * FROM marketplace_connections WHERE id=?`).get(String(id));
  if (!row) throw new Error('Không tìm thấy kết nối marketplace.');
  const accessEnc = accessToken
    ? encryptSecret(accessToken, tokenContext(row.provider, row.shop_id, 'access', row.branch_id))
    : row.access_token_enc;
  const refreshEnc = refreshToken
    ? encryptSecret(refreshToken, tokenContext(row.provider, row.shop_id, 'refresh', row.branch_id))
    : row.refresh_token_enc;
  db.prepare(`UPDATE marketplace_connections SET
      access_token_enc=?, refresh_token_enc=?,
      access_expires_at=COALESCE(?,access_expires_at),
      refresh_expires_at=COALESCE(?,refresh_expires_at),
      last_refresh_at=?, updated_at=?, error=NULL
      WHERE id=?`)
    .run(accessEnc, refreshEnc, accessExpiresAt ?? null, refreshExpiresAt ?? null, now(), now(), row.id);
  return findConnectionById(row.id);
}

export function updateConnectionSettingsStore(id, settings = {}, branchId) {
  ensureConnectionStore();
  const row = db.prepare(`SELECT * FROM marketplace_connections WHERE id=? AND branch_id=?`)
    .get(String(id), String(branchId));
  if (!row) throw new Error('Không tìm thấy kết nối.');
  let current = {};
  try { current = row.settings_json ? JSON.parse(row.settings_json) : {}; } catch { current = {}; }
  // This public route cannot promote a connection to live writes. Production
  // write approval is an operator-controlled server action with separate evidence.
  const safe = {};
  if (settings && typeof settings === 'object') {
    if (settings.sync_mode === 'shadow') safe.sync_mode = 'shadow';
    if (typeof settings.note === 'string') safe.note = settings.note.slice(0, 500);
  }
  db.prepare(`UPDATE marketplace_connections SET settings_json=?,updated_at=? WHERE id=?`)
    .run(JSON.stringify({ ...current, ...safe }), now(), row.id);
  return publicConnection(db.prepare(`SELECT * FROM marketplace_connections WHERE id=?`).get(row.id));
}

export function markConnectionDisconnected(id, branchId) {
  ensureConnectionStore();
  const row = db.prepare(`SELECT * FROM marketplace_connections WHERE id=? AND branch_id=?`)
    .get(String(id), String(branchId));
  if (!row) throw new Error('Không tìm thấy kết nối.');
  db.prepare(`UPDATE marketplace_connections SET
      status='disconnected', access_token_enc=NULL, refresh_token_enc=NULL,
      disconnected_at=?, updated_at=? WHERE id=?`)
    .run(now(), now(), row.id);
  return publicConnection({ ...row, status: 'disconnected', access_token_enc: null, refresh_token_enc: null });
}
