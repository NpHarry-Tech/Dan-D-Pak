import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = fileURLToPath(new URL('../../', import.meta.url));

const DEFAULTS = {
  PORT: 3000,
  NODE_ENV: 'development',
  // Môi trường nghiệp vụ, KHÁC NODE_ENV. 'review' = stack Shopee Review/Staging
  // (dữ liệu synthetic, DB riêng, sandbox) — dùng để cách ly production. '' hoặc
  // 'production' = vận hành thật. Cho phép nới guard DB + chạy demo seed an toàn.
  APP_ENV: '',
  DEPLOYMENT_TARGET: 'local',
  DATABASE_PROVIDER: 'sqlite',
  REALTIME_PROVIDER: 'socketio',
  STORAGE_PROVIDER: 'local',
  SQLITE_PATH: 'runtime/server-data/store.db',
  STORAGE_PATH: 'server',
  CORS_ORIGIN: '',
  LOG_LEVEL: 'info',
  BACKUP_RETENTION_DAYS: 14,
  DISABLE_DEMO_SEED: false,
  DISABLE_WEB_UI: true,
};

function clean(value) {
  return typeof value === 'string' ? value.trim() : value;
}

function asInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asList(value) {
  return String(value || '')
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);
}

export function loadEnv(source = process.env) {
  const env = {
    NODE_ENV: clean(source.NODE_ENV) || DEFAULTS.NODE_ENV,
    APP_ENV: clean(source.APP_ENV) || DEFAULTS.APP_ENV,
    // Chốt an toàn dữ liệu review: chỉ TRUE khi cố ý cho phép dữ liệu thật vào
    // stack review. Mặc định FALSE — review chỉ được chạy dữ liệu synthetic.
    ALLOW_PRODUCTION_DATA: source.ALLOW_PRODUCTION_DATA === 'true' || source.ALLOW_PRODUCTION_DATA === '1',
    // Sàn Shopee: 'test'/'sandbox' cho stack review, 'live' cho production.
    SHOPEE_ENV: clean(source.SHOPEE_ENV) || '',
    // PIN đăng nhập tài khoản reviewer (stack review). Đặt tại VPS, KHÔNG commit.
    SHOPEE_REVIEWER_PIN: clean(source.SHOPEE_REVIEWER_PIN) || '',
    PORT: asInt(source.PORT, DEFAULTS.PORT),
    APP_URL: clean(source.APP_URL) || '',
    API_BASE_URL: clean(source.API_BASE_URL) || '',
    DEPLOYMENT_TARGET: clean(source.DEPLOYMENT_TARGET) || DEFAULTS.DEPLOYMENT_TARGET,
    DATABASE_PROVIDER: clean(source.DATABASE_PROVIDER) || DEFAULTS.DATABASE_PROVIDER,
    DATABASE_URL: clean(source.DATABASE_URL) || '',
    SQLITE_PATH: clean(source.SQLITE_PATH) || DEFAULTS.SQLITE_PATH,
    REALTIME_PROVIDER: clean(source.REALTIME_PROVIDER) || DEFAULTS.REALTIME_PROVIDER,
    STORAGE_PROVIDER: clean(source.STORAGE_PROVIDER) || DEFAULTS.STORAGE_PROVIDER,
    STORAGE_PATH: clean(source.STORAGE_PATH) || DEFAULTS.STORAGE_PATH,
    CORS_ORIGIN: clean(source.CORS_ORIGIN) || DEFAULTS.CORS_ORIGIN,
    LOG_LEVEL: clean(source.LOG_LEVEL) || DEFAULTS.LOG_LEVEL,
    BACKUP_RETENTION_DAYS: asInt(source.BACKUP_RETENTION_DAYS, DEFAULTS.BACKUP_RETENTION_DAYS),
    EDGE_HUB_ID: clean(source.EDGE_HUB_ID) || '',
    EDGE_SYNC_UPSTREAM_URL: clean(source.EDGE_SYNC_UPSTREAM_URL) || '',
    EDGE_SYNC_SHARED_SECRET: clean(source.EDGE_SYNC_SHARED_SECRET) || '',
    EDGE_SYNC_ALLOWED_HUBS_JSON: clean(source.EDGE_SYNC_ALLOWED_HUBS_JSON) || '',
    // ONLINE-ONLY (quyết định owner 2026-08-26): offline-first Edge/Hub
    // replication BỊ NGƯNG mặc định. Server là source of truth duy nhất. KHÔNG
    // drop bảng/dữ liệu — legacy tables giữ inert để rollback. Đặt
    // OFFLINE_DECOMMISSIONED=false để bật lại edge sync runtime (không khuyến nghị).
    OFFLINE_DECOMMISSIONED: !(source.OFFLINE_DECOMMISSIONED === 'false'
      || source.OFFLINE_DECOMMISSIONED === '0'),
    // §8 HARDENING: legacy /auth/{shopee,lazada}/callback (branch từ client query,
    // KHÔNG state machine) fail-closed mặc định. Bật lại chỉ khi bắt buộc migrate.
    SHOPEE_LEGACY_CALLBACK: source.SHOPEE_LEGACY_CALLBACK === 'true'
      || source.SHOPEE_LEGACY_CALLBACK === '1',
    DATA_ENCRYPTION_KEY: clean(source.DATA_ENCRYPTION_KEY) || '',
    DISABLE_DEMO_SEED: source.DISABLE_DEMO_SEED === 'true' || source.DISABLE_DEMO_SEED === '1',
    DISABLE_WEB_UI: source.DISABLE_WEB_UI !== undefined ? (source.DISABLE_WEB_UI === 'true' || source.DISABLE_WEB_UI === '1') : DEFAULTS.DISABLE_WEB_UI,
    HARAVAN_ENABLED: source.HARAVAN_ENABLED === 'true' || source.HARAVAN_ENABLED === '1',
    HARAVAN_SHOP_DOMAIN: clean(source.HARAVAN_SHOP_DOMAIN) || '',
    HARAVAN_ACCESS_TOKEN: clean(source.HARAVAN_ACCESS_TOKEN) || '',
    HARAVAN_WEBHOOK_SECRET: clean(source.HARAVAN_WEBHOOK_SECRET) || '',
    HARAVAN_CLIENT_ID: clean(source.HARAVAN_CLIENT_ID) || '',
    HARAVAN_CLIENT_SECRET: clean(source.HARAVAN_CLIENT_SECRET) || '',
    HARAVAN_WEBHOOK_VERIFY_TOKEN: clean(source.HARAVAN_WEBHOOK_VERIFY_TOKEN) || '',
    HARAVAN_SCOPES: clean(source.HARAVAN_SCOPES) || '',
    HARAVAN_LOCATION_ID: clean(source.HARAVAN_LOCATION_ID) || '',
    HARAVAN_API_BASE_URL: clean(source.HARAVAN_API_BASE_URL) || 'https://apis.haravan.com',
    HARAVAN_DEFAULT_BRANCH_ID: clean(source.HARAVAN_DEFAULT_BRANCH_ID) || 'ONLINE',
    // 'auto' = server tự in trên phần cứng cùng máy (mô hình LAN 1 máy chủ).
    // 'agent' = server chỉ xếp hàng job; việc in vật lý + mở két do Hardware
    // Agent tại cửa hàng thực thi (mô hình VPS trung tâm — server ở datacenter
    // không với tới máy in LAN / két / A920 trong cửa hàng).
    PRINT_DISPATCH: clean(source.PRINT_DISPATCH) || 'auto',
  };

  env.CORS_ORIGINS = asList(env.CORS_ORIGIN);
  env.isProduction = env.NODE_ENV === 'production';
  env.isLocal = env.DEPLOYMENT_TARGET === 'local';
  // Stack Shopee Review/Staging: cách ly hoàn toàn với production (DB riêng, dữ
  // liệu synthetic, sandbox sàn). NODE_ENV vẫn 'production' để bật HTTPS/mã hoá.
  env.isReview = env.APP_ENV === 'review';
  env.warnings = validateEnv(env);

  return env;
}

function validateEnv(env) {
  const warnings = [];
  if (env.isProduction && !env.CORS_ORIGINS.length) {
    warnings.push('CORS_ORIGIN is not set; production should allow only trusted frontend origins.');
  }
  if (env.STORAGE_PROVIDER === 'local' && !env.STORAGE_PATH) {
    warnings.push('STORAGE_PATH is empty; local storage needs a durable path on VPS.');
  }
  if (env.HARAVAN_ENABLED && (!env.HARAVAN_SHOP_DOMAIN || !env.HARAVAN_ACCESS_TOKEN || !env.HARAVAN_WEBHOOK_SECRET)) {
    warnings.push('HARAVAN_ENABLED=true requires HARAVAN_SHOP_DOMAIN, HARAVAN_ACCESS_TOKEN and HARAVAN_WEBHOOK_SECRET.');
  }
  if ((env.HARAVAN_CLIENT_ID || env.HARAVAN_CLIENT_SECRET) && (!env.HARAVAN_CLIENT_ID || !env.HARAVAN_CLIENT_SECRET || !env.APP_URL)) {
    warnings.push('Haravan OAuth requires HARAVAN_CLIENT_ID, HARAVAN_CLIENT_SECRET and APP_URL.');
  }
  const senderRequested = !!(env.EDGE_HUB_ID || env.EDGE_SYNC_UPSTREAM_URL);
  if (senderRequested) {
    if (!env.EDGE_HUB_ID || !env.EDGE_SYNC_UPSTREAM_URL || env.EDGE_SYNC_SHARED_SECRET.length < 32) {
      warnings.push('Edge sender requires EDGE_HUB_ID, EDGE_SYNC_UPSTREAM_URL and a 32+ character EDGE_SYNC_SHARED_SECRET.');
    } else {
      try {
        if (new URL(env.EDGE_SYNC_UPSTREAM_URL).protocol !== 'https:') warnings.push('EDGE_SYNC_UPSTREAM_URL must use HTTPS.');
      } catch { warnings.push('EDGE_SYNC_UPSTREAM_URL is invalid.'); }
    }
  }
  if (env.EDGE_SYNC_ALLOWED_HUBS_JSON) {
    try {
      const hubs = JSON.parse(env.EDGE_SYNC_ALLOWED_HUBS_JSON);
      if (!hubs || Array.isArray(hubs) || typeof hubs !== 'object') throw new Error('not an object');
      if (env.EDGE_SYNC_SHARED_SECRET.length < 32) warnings.push('Edge receiver requires a 32+ character EDGE_SYNC_SHARED_SECRET.');
    } catch { warnings.push('EDGE_SYNC_ALLOWED_HUBS_JSON must be a JSON object mapping hub IDs to branch arrays.'); }
  }
  return warnings;
}

export const env = loadEnv();

export function assertSecureProductionEnv(config = env) {
  if (config.isReview && config.ALLOW_PRODUCTION_DATA) {
    throw new Error('APP_ENV=review cấm ALLOW_PRODUCTION_DATA=true. Review chỉ được dùng dữ liệu synthetic.');
  }
  if (config.isReview && ['production', 'live'].includes(String(config.SHOPEE_ENV || '').toLowerCase())) {
    throw new Error('APP_ENV=review không được dùng SHOPEE_ENV=production/live.');
  }
  if (!config.isProduction) return;
  const key = String(config.DATA_ENCRYPTION_KEY || '');
  const validKey = /^[0-9a-f]{64}$/i.test(key) ||
    (() => {
      try { return Buffer.from(key, 'base64').length === 32; } catch { return false; }
    })();
  if (!validKey) {
    throw new Error('Production requires DATA_ENCRYPTION_KEY (32 random bytes, hex or base64).');
  }
  for (const name of ['APP_URL', 'API_BASE_URL']) {
    const value = config[name];
    if (value && !value.startsWith('https://')) {
      throw new Error(`${name} must use HTTPS in production.`);
    }
  }
}

export function storagePath(...parts) {
  const root = isAbsolute(env.STORAGE_PATH) ? env.STORAGE_PATH : resolve(PROJECT_ROOT, env.STORAGE_PATH);
  return resolve(root, ...parts);
}

export function publicEnvSnapshot() {
  return {
    nodeEnv: env.NODE_ENV,
    deploymentTarget: env.DEPLOYMENT_TARGET,
    providers: {
      database: env.DATABASE_PROVIDER,
      realtime: env.REALTIME_PROVIDER,
      storage: env.STORAGE_PROVIDER,
    },
    corsConfigured: env.CORS_ORIGINS.length > 0,
    backupRetentionDays: env.BACKUP_RETENTION_DAYS,
    edgeSyncConfigured: !!(
      (env.EDGE_HUB_ID && env.EDGE_SYNC_UPSTREAM_URL && env.EDGE_SYNC_SHARED_SECRET.length >= 32) ||
      (env.EDGE_SYNC_ALLOWED_HUBS_JSON && env.EDGE_SYNC_SHARED_SECRET.length >= 32)
    ),
    warnings: env.warnings,
  };
}
