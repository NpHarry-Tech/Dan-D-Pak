import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { env } from '../config/env.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(join(__dirname, '..', '..'));

function resolveDbPath() {
  if (env.DATABASE_URL && env.DATABASE_PROVIDER === 'sqlite') {
    if (env.DATABASE_URL.startsWith('sqlite://')) {
      const path = env.DATABASE_URL.replace('sqlite://', '');
      return isAbsolute(path) ? path : resolve(ROOT, path);
    }
  }
  if (!env.SQLITE_PATH) return resolve(ROOT, 'runtime/server-data/store.db');
  return isAbsolute(env.SQLITE_PATH) ? env.SQLITE_PATH : resolve(ROOT, env.SQLITE_PATH);
}

export const DB_PATH = resolveDbPath();
export const DB_WAS_EMPTY = !existsSync(DB_PATH) || statSync(DB_PATH).size === 0;
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA busy_timeout = 5000;');
db.exec('PRAGMA synchronous = NORMAL;');
db.exec('PRAGMA cache_size = -65536;');
db.exec('PRAGMA temp_store = MEMORY;');
db.exec('PRAGMA mmap_size = 134217728;');
db.exec('PRAGMA wal_autocheckpoint = 1000;');
