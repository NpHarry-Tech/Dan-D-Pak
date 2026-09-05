import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { env } from '../config/env.js';
import {
  synchronizeTransactionState, transactionBatchSucceeded, transactionSqlSucceeded,
} from './transactionLifecycle.js';

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
// Trên VPS mỗi stack bị khoá vào ĐÚNG một file DB để không thể vô tình trỏ nhầm
// sang DB của stack khác. Production → store.db; stack Shopee Review → review.db
// (dữ liệu synthetic, tách hẳn). Guard này chặn review đọc/ghi nhầm DB thật.
const CANONICAL_DB = env.isReview ? '/app/server-data/review.db' : '/app/server-data/store.db';
if (env.isProduction && env.DEPLOYMENT_TARGET === 'vps' && resolve(DB_PATH) !== resolve(CANONICAL_DB)) {
  throw new Error(`VPS ${env.isReview ? 'review' : 'production'} chỉ được dùng DB duy nhất tại ${CANONICAL_DB} (đang cấu hình: ${DB_PATH})`);
}
export const DB_WAS_EMPTY = !existsSync(DB_PATH) || statSync(DB_PATH).size === 0;
mkdirSync(dirname(DB_PATH), { recursive: true });

export const DB_READ_ONLY = process.env.DATABASE_READ_ONLY === 'true';
const rawDb = new DatabaseSync(DB_PATH, { readOnly: DB_READ_ONLY });

// Preserve raw SQL callers while exposing actual commit/savepoint boundaries.
export const db = new Proxy(rawDb, {
  get(target, property) {
    if (property === 'exec') return (sql) => {
      try {
        const result = target.exec(sql);
        transactionBatchSucceeded(sql);
        return result;
      } catch (error) {
        synchronizeTransactionState(target.isTransaction);
        throw error;
      }
    };
    if (property === 'prepare') return (sql) => {
      const statement = target.prepare(sql);
      return new Proxy(statement, {
        get(statementTarget, statementProperty) {
          if (statementProperty === 'run') return (...args) => {
            try {
              const result = statementTarget.run(...args);
              transactionSqlSucceeded(sql);
              return result;
            } catch (error) {
              synchronizeTransactionState(target.isTransaction);
              throw error;
            }
          };
          const value = Reflect.get(statementTarget, statementProperty, statementTarget);
          return typeof value === 'function' ? value.bind(statementTarget) : value;
        },
      });
    };
    const value = Reflect.get(target, property, target);
    return typeof value === 'function' ? value.bind(target) : value;
  },
});

if (DB_READ_ONLY) {
  db.exec('PRAGMA query_only = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
} else {
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  // Tiền, kho và hoá đơn là dữ liệu production: ưu tiên durability khi mất điện.
  db.exec('PRAGMA synchronous = FULL;');
  db.exec('PRAGMA cache_size = -65536;');
  db.exec('PRAGMA temp_store = MEMORY;');
  db.exec('PRAGMA mmap_size = 134217728;');
  db.exec('PRAGMA wal_autocheckpoint = 1000;');
}
