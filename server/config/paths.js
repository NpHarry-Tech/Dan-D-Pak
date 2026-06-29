import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from './env.js';

export const SERVER_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const ROOT = resolve(SERVER_ROOT, '..');
const LOCAL_APP_NAME = 'Dan D Pak POS ERP';

function cleanPath(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function resolveRuntimePath(value, fallback, base = ROOT) {
  const raw = cleanPath(value);
  if (!raw) return fallback;
  return isAbsolute(raw) ? raw : resolve(base, raw);
}

function defaultLocalAppDataDir() {
  if (env.DEPLOYMENT_TARGET !== 'local') return '';
  if (process.env.APPDATA) return join(process.env.APPDATA, LOCAL_APP_NAME, 'data');
  if (process.env.XDG_DATA_HOME) return join(process.env.XDG_DATA_HOME, LOCAL_APP_NAME, 'data');
  if (process.env.HOME) return join(process.env.HOME, '.local', 'share', LOCAL_APP_NAME, 'data');
  return '';
}

export const APP_DATA_DIR = resolveRuntimePath(env.APP_DATA_DIR, defaultLocalAppDataDir());
const hasAppData = !!APP_DATA_DIR;

export const DEVICE_ID = env.DEVICE_ID || 'local-store';

export const runtimePaths = {
  root: ROOT,
  serverRoot: SERVER_ROOT,
  appDataDir: APP_DATA_DIR,
  backups: resolveRuntimePath(
    env.BACKUP_PATH,
    hasAppData ? join(APP_DATA_DIR, 'backups') : join(ROOT, 'backups'),
  ),
  permanentStorage: resolveRuntimePath(
    env.PERMANENT_STORAGE_PATH,
    hasAppData ? join(APP_DATA_DIR, 'permanent-storage') : join(SERVER_ROOT, 'permanent-storage'),
  ),
  enterpriseStorage: resolveRuntimePath(
    env.ENTERPRISE_STORAGE_PATH,
    hasAppData ? join(APP_DATA_DIR, 'enterprise-storage') : join(SERVER_ROOT, 'enterprise-storage'),
  ),
  uploads: resolveRuntimePath(
    env.UPLOADS_PATH,
    hasAppData ? join(APP_DATA_DIR, 'uploads', 'documents') : join(SERVER_ROOT, 'uploads', 'documents'),
  ),
  syncReplica: resolveRuntimePath(
    env.SYNC_REPLICA_PATH,
    hasAppData ? join(APP_DATA_DIR, 'replica', 'eternal_replica.db') : join(SERVER_ROOT, 'permanent-storage', 'eternal_replica.db'),
  ),
};

export function defaultSqlitePath() {
  return hasAppData ? join(APP_DATA_DIR, 'store.db') : join(SERVER_ROOT, 'store.db');
}
