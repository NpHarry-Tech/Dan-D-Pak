const DEFAULTS = {
  PORT: 3000,
  NODE_ENV: 'development',
  DEPLOYMENT_TARGET: 'local',
  DATABASE_PROVIDER: 'sqlite',
  REALTIME_PROVIDER: 'socketio',
  STORAGE_PROVIDER: 'local',
  SQLITE_PATH: '',
  STORAGE_PATH: 'storage',
  CORS_ORIGIN: '',
  LOG_LEVEL: 'info',
  BACKUP_RETENTION_DAYS: 14,
  DISABLE_DEMO_SEED: false,
  CONFIG_SEED_URL: '',
  // Path to a JSON file where config (users, settings, menu…) is auto-saved after every
  // change and auto-restored on startup when the DB is empty.  Set this to a path on a
  // persistent volume (e.g. /app/server-data/config-backup.json on Render paid disk)
  // so that data survives redeploys.
  CONFIG_BACKUP_PATH: '',
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
    CONFIG_SEED_URL: clean(source.CONFIG_SEED_URL) || DEFAULTS.CONFIG_SEED_URL,
    CONFIG_BACKUP_PATH: clean(source.CONFIG_BACKUP_PATH) || DEFAULTS.CONFIG_BACKUP_PATH,
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
  if (env.DATABASE_PROVIDER === 'postgres' && !env.DATABASE_URL) {
    warnings.push('DATABASE_PROVIDER=postgres requires DATABASE_URL before the Postgres adapter can be used.');
  }
  if (env.STORAGE_PROVIDER === 'local' && !env.STORAGE_PATH) {
    warnings.push('STORAGE_PATH is empty; local storage needs a durable path on VPS.');
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
