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
import {
  ensureConnectionStore,
  upsertAuthorizedConnection,
  listPublicConnections,
  findConnectionById,
  updateConnectionSettingsStore,
  markConnectionDisconnected,
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
    buildAuthUrl: (b, redirect) => lazadaAuthLink(b, redirect),
    exchange: async (b, params) => {
      if (!params.code) throw new Error('Callback Lazada thiếu code.');
      return exchangeLazadaCodeRaw(b, params.code);
    },
    region: (b) => lazadaConfig(b).region || 'VN',
  },
  // TikTok/Tiki chỉ thêm khi adapter đã đáp ứng đúng lifecycle riêng của provider.
};

export function isSupportedProvider(p) { return !!ADAPTERS[String(p || '').toLowerCase()]; }
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
  const redirect = `${base}/auth/${prov}/callback?state=${encodeURIComponent(id)}`;
  const url = a.buildAuthUrl(branch_id, redirect);
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

  const branch_id = attempt.branch_id;
  try {
    const t = await a.exchange(branch_id, params);
    const shopId = String(t.shop_id || '').trim();
    if (!shopId) throw new Error('Không xác định được shop_id sau uỷ quyền.');

    const connection = upsertAuthorizedConnection({
      provider: prov,
      branchId: branch_id,
      shopId,
      shopName: t.shop_name || '',
      region: a.region(branch_id),
      accessToken: t.access_token || '',
      refreshToken: t.refresh_token || '',
      accessExpiresAt: expiryFromSeconds(t.expire_in),
      // Không đoán TTL refresh. Chỉ lưu khi provider thực sự trả về.
      refreshExpiresAt: expiryFromSeconds(t.refresh_expire_in || t.refresh_token_expire_in),
      createdBy: attempt.user_id || '',
    });

    db.prepare(`UPDATE marketplace_auth_attempts
      SET status='done',shop_id=?,completed_at=? WHERE id=?`).run(shopId, now(), attempt.id);
    audit('mp.connect.done', { provider: prov, shop_id: shopId, connection_id: connection.id }, branch_id, attempt.user_id || 'system');
    emit(`${prov}:connected`, { attempt_id: attempt.id, shop_id: shopId, connection_id: connection.id }, branch_id);
    emit('marketplace:connected', { provider: prov, connection_id: connection.id }, branch_id);
    return { ok: true, provider: prov, connection_id: connection.id, shop_id: shopId };
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

// Chỉ dùng nội bộ backend. Không expose object này trực tiếp qua HTTP.
export function connectionCredentials(id, branch_id = '') {
  ensure();
  return findConnectionById(id, branch_id);
}

export function updateConnectionSettings(id, settings = {}, branch_id = 'sala', actor = 'system') {
  ensure();
  const out = updateConnectionSettingsStore(id, settings, branch_id);
  audit('mp.settings.changed', { provider: out.provider, connection_id: id }, branch_id, actor);
  return out;
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
