const DEFAULTS = {
  PORT: 3000,
  NODE_ENV: 'development',
  DEPLOYMENT_TARGET: 'local',
  DATABASE_PROVIDER: 'sqlite',
  REALTIME_PROVIDER: 'socketio',
  STORAGE_PROVIDER: 'local',
  SQLITE_PATH: '',
  STORAGE_PATH: 'storage',
  APP_DATA_DIR: '',
  BACKUP_PATH: '',
  PERMANENT_STORAGE_PATH: '',
  ENTERPRISE_STORAGE_PATH: '',
  UPLOADS_PATH: '',
  SYNC_REPLICA_PATH: '',
  DEVICE_ID: '',
  CENTRAL_SYNC_URL: '',
  CENTRAL_SYNC_TOKEN: '',
  CORS_ORIGIN: '',
  LOG_LEVEL: 'info',
  BACKUP_RETENTION_DAYS: 14,
  DISABLE_DEMO_SEED: false,
  CONFIG_SEED_URL: '',
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
    APP_DATA_DIR: clean(source.APP_DATA_DIR) || DEFAULTS.APP_DATA_DIR,
    BACKUP_PATH: clean(source.BACKUP_PATH) || DEFAULTS.BACKUP_PATH,
    PERMANENT_STORAGE_PATH: clean(source.PERMANENT_STORAGE_PATH) || DEFAULTS.PERMANENT_STORAGE_PATH,
    ENTERPRISE_STORAGE_PATH: clean(source.ENTERPRISE_STORAGE_PATH) || DEFAULTS.ENTERPRISE_STORAGE_PATH,
    UPLOADS_PATH: clean(source.UPLOADS_PATH) || DEFAULTS.UPLOADS_PATH,
    SYNC_REPLICA_PATH: clean(source.SYNC_REPLICA_PATH) || DEFAULTS.SYNC_REPLICA_PATH,
    DEVICE_ID: clean(source.DEVICE_ID) || DEFAULTS.DEVICE_ID,
    CENTRAL_SYNC_URL: clean(source.CENTRAL_SYNC_URL) || DEFAULTS.CENTRAL_SYNC_URL,
    CENTRAL_SYNC_TOKEN: clean(source.CENTRAL_SYNC_TOKEN) || DEFAULTS.CENTRAL_SYNC_TOKEN,
    CORS_ORIGIN: clean(source.CORS_ORIGIN) || DEFAULTS.CORS_ORIGIN,
    LOG_LEVEL: clean(source.LOG_LEVEL) || DEFAULTS.LOG_LEVEL,
    BACKUP_RETENTION_DAYS: asInt(source.BACKUP_RETENTION_DAYS, DEFAULTS.BACKUP_RETENTION_DAYS),
    DISABLE_DEMO_SEED: source.DISABLE_DEMO_SEED === 'true' || source.DISABLE_DEMO_SEED === '1',
    CONFIG_SEED_URL: clean(source.CONFIG_SEED_URL) || DEFAULTS.CONFIG_SEED_URL,
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
    warnings.push('CORS_ORIGIN is not set; production should allow only trusted client/admin origins.');
  }
  if (env.DATABASE_PROVIDER === 'postgres' && !env.DATABASE_URL) {
    warnings.push('DATABASE_PROVIDER=postgres requires DATABASE_URL before the Postgres adapter can be used.');
  }
  if (env.STORAGE_PROVIDER === 'local' && !env.STORAGE_PATH) {
    warnings.push('STORAGE_PATH is empty; local storage needs a durable path on VPS.');
  }
  if (env.CENTRAL_SYNC_URL && !/^https?:\/\//i.test(env.CENTRAL_SYNC_URL)) {
    warnings.push('CENTRAL_SYNC_URL must start with http:// or https://.');
  }
  if (env.isProduction && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === 'change-me')) {
    warnings.push('SESSION_SECRET must be changed in production.');
  }
  if (!process.env.AUDIT_LOG_KEY && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === 'change-me')) {
    warnings.push('AUDIT_LOG_KEY/SESSION_SECRET not set; audit-log compaction will encrypt with a built-in default key (no confidentiality). Set AUDIT_LOG_KEY before going live.');
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
    appDataDirConfigured: !!env.APP_DATA_DIR,
    centralSyncConfigured: !!env.CENTRAL_SYNC_URL,
    corsConfigured: env.CORS_ORIGINS.length > 0,
    backupRetentionDays: env.BACKUP_RETENTION_DAYS,
    warnings: env.warnings,
  };
}
