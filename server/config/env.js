const DEFAULTS = {
  PORT: 3000,
  NODE_ENV: 'development',
  DEPLOYMENT_TARGET: 'local',
  DATABASE_PROVIDER: 'sqlite',
  REALTIME_PROVIDER: 'socketio',
  STORAGE_PROVIDER: 'local',
  SQLITE_PATH: 'runtime/server-data/store.db',
  STORAGE_PATH: 'storage',
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
  return warnings;
}

export const env = loadEnv();

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
    warnings: env.warnings,
  };
}
