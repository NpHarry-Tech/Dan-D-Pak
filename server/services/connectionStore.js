// Kho lưu trữ kết nối marketplace dùng chung.
// Chỉ module backend nội bộ được lấy token thô; API bên ngoài chỉ dùng publicConnection().
import { db, uid, now } from '../db.js';
import { encryptSecret, decryptSecret } from '../core/crypto.js';

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
  `);
  ready = true;
}

function tokenContext(provider, shopId, kind) {
  return `${provider}:${shopId}:${kind}`;
}

function decrypted(row) {
  if (!row) return null;
  return {
    ...row,
    access_token: row.access_token_enc
      ? decryptSecret(row.access_token_enc, tokenContext(row.provider, row.shop_id, 'access')) : '',
    refresh_token: row.refresh_token_enc
      ? decryptSecret(row.refresh_token_enc, tokenContext(row.provider, row.shop_id, 'refresh')) : '',
  };
}

export function publicConnection(row) {
  if (!row) return null;
  let settings = {};
  try { settings = row.settings_json ? JSON.parse(row.settings_json) : {}; } catch { settings = {}; }
  return {
    id: row.id,
    provider: row.provider,
    branch_id: row.branch_id,
    shop_id: row.shop_id,
    shop_name: row.shop_name || '',
    region: row.region || 'VN',
    status: row.status,
    authorized_at: row.authorized_at,
    last_sync_at: row.last_sync_at,
    last_refresh_at: row.last_refresh_at,
    access_expires_at: row.access_expires_at,
    refresh_expires_at: row.refresh_expires_at,
    settings,
    error: row.error || null,
  };
}

export function listPublicConnections(provider, branchId) {
  ensureConnectionStore();
  const prov = String(provider || '').trim().toLowerCase();
  const rows = prov
    ? db.prepare(`SELECT * FROM marketplace_connections
        WHERE provider=? AND branch_id=? AND status!='disconnected'
        ORDER BY COALESCE(updated_at,created_at) DESC`).all(prov, branchId)
    : db.prepare(`SELECT * FROM marketplace_connections
        WHERE branch_id=? AND status!='disconnected'
        ORDER BY COALESCE(updated_at,created_at) DESC`).all(branchId);
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

export function findActiveConnectionByProviderBranch(provider, branchId) {
  ensureConnectionStore();
  const row = db.prepare(`SELECT * FROM marketplace_connections
    WHERE provider=? AND branch_id=? AND status='active'
    ORDER BY COALESCE(updated_at,created_at) DESC LIMIT 1`)
    .get(String(provider || '').toLowerCase(), String(branchId || ''));
  return decrypted(row);
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
}) {
  ensureConnectionStore();
  const prov = String(provider || '').toLowerCase();
  const shop = String(shopId || '').trim();
  const existing = db.prepare(`SELECT id FROM marketplace_connections WHERE provider=? AND shop_id=?`).get(prov, shop);
  const id = existing?.id || uid('mpconn_');
  const accessEnc = accessToken ? encryptSecret(accessToken, tokenContext(prov, shop, 'access')) : null;
  const refreshEnc = refreshToken ? encryptSecret(refreshToken, tokenContext(prov, shop, 'refresh')) : null;

  if (existing) {
    db.prepare(`UPDATE marketplace_connections SET
      branch_id=?, shop_name=COALESCE(NULLIF(?,''),shop_name), region=?, status='active',
      access_token_enc=?, refresh_token_enc=?, access_expires_at=?, refresh_expires_at=?,
      authorized_at=?, last_refresh_at=?, error=NULL, updated_at=?, disconnected_at=NULL
      WHERE id=?`)
      .run(branchId, shopName, region, accessEnc, refreshEnc, accessExpiresAt, refreshExpiresAt,
        now(), now(), now(), id);
  } else {
    db.prepare(`INSERT INTO marketplace_connections
      (id,provider,branch_id,shop_id,shop_name,region,status,
       access_token_enc,refresh_token_enc,access_expires_at,refresh_expires_at,
       authorized_at,last_refresh_at,created_by,created_at,updated_at)
      VALUES (?,?,?,?,?,?,'active',?,?,?,?,?,?,?,?,?)`)
      .run(id, prov, branchId, shop, shopName, region, accessEnc, refreshEnc,
        accessExpiresAt, refreshExpiresAt, now(), now(), String(createdBy || ''), now(), now());
  }
  return findConnectionById(id, branchId);
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
    ? encryptSecret(accessToken, tokenContext(row.provider, row.shop_id, 'access'))
    : row.access_token_enc;
  const refreshEnc = refreshToken
    ? encryptSecret(refreshToken, tokenContext(row.provider, row.shop_id, 'refresh'))
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
  db.prepare(`UPDATE marketplace_connections SET settings_json=?,updated_at=? WHERE id=?`)
    .run(JSON.stringify({ ...current, ...settings }), now(), row.id);
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
