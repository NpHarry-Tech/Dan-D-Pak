// Local Store Server — entry point. Express REST + Socket.IO realtime + static client.
import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import zlib from 'node:zlib';
import { db, migrate, purgeOldAudit, reconcileAuditFromArchive, compactOldAuditLogs, backupDatabase } from './db.js';
import { initRealtime } from './realtime.js';
import { api } from './api.js';
import { startSyncEngine } from './services/sync.js';
import { ensureStorageDirectories } from './services/enterpriseStorage.js';
import { bootstrapDefaultAdmin } from './services/bootstrapAdmin.js';
import { migratePlaintextPins } from './services/pin.js';
import { env } from './config/env.js';
import { createCorsMiddleware } from './config/cors.js';
import { runtimeSnapshot } from './config/runtime.js';
import { apiNotFound, errorHandler } from './core/http.js';
import { logger } from './core/logger.js';
import { requestLogger } from './core/requestLogger.js';

// Gzip middleware dùng Node built-in zlib — không cần thêm npm package.
// Với 50 thiết bị, menu JSON ~50KB → ~8KB sau nén, giảm tải mạng LAN 80%.
function compressionMiddleware(req, res, next) {
  const ae = req.headers['accept-encoding'] || '';
  if (!ae.includes('gzip') && !ae.includes('deflate')) return next();
  const encoding = ae.includes('gzip') ? 'gzip' : 'deflate';
  const origJson = res.json.bind(res);
  res.json = (body) => {
    const raw = JSON.stringify(body);
    if (raw.length < 1024) return origJson(body); // không nén payload nhỏ
    const compress = encoding === 'gzip' ? zlib.gzip : zlib.deflate;
    compress(Buffer.from(raw, 'utf8'), (err, buf) => {
      if (err) return origJson(body);
      res.set('Content-Encoding', encoding);
      res.set('Content-Type', 'application/json; charset=utf-8');
      res.set('Content-Length', buf.length);
      res.end(buf);
    });
  };
  next();
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB = join(__dirname, '..', 'web');
const PORT = env.PORT;
export const UPLOADS_DIR = join(__dirname, 'uploads', 'documents');
mkdirSync(UPLOADS_DIR, { recursive: true });
globalThis.__DANDPAK_STARTED_AT = new Date().toISOString();

migrate();
// Self-heal the footprint log after an unclean shutdown: replay any entries the
// durable NDJSON archive kept but SQLite's WAL lost on power loss (idempotent).
try {
  const restoredAudit = reconcileAuditFromArchive();
  if (restoredAudit > 0) logger.warn(`restored ${restoredAudit} footprint entr${restoredAudit === 1 ? 'y' : 'ies'} from durable archive after unclean shutdown`);
} catch (err) {
  logger.warn(`footprint reconcile skipped: ${err.message}`);
}
// Auto-seed on first run only if the database is empty and not suppressed.
const hasMenu = db.prepare(`SELECT COUNT(*) n FROM menu_items`).get().n;
const hasBranch = db.prepare(`SELECT COUNT(*) n FROM branches`).get().n;
const isEmpty = !hasMenu && !hasBranch;
if (isEmpty) {
  if (env.CONFIG_SEED_URL) {
    try {
      logger.info(`empty database detected; restoring config from CONFIG_SEED_URL`);
      const { fetchAndRestoreConfig } = await import('./services/configBackup.js');
      const result = await fetchAndRestoreConfig(env.CONFIG_SEED_URL);
      logger.info('config restored from URL', result.counts);
    } catch (err) {
      logger.warn(`failed to restore config from URL: ${err.message}; falling back to demo seed`);
      await import('./seed.js');
    }
  } else if (env.DISABLE_DEMO_SEED) {
    logger.warn('empty database detected; DISABLE_DEMO_SEED=true — skipping demo seed');
  } else {
    logger.warn('empty catalog detected; running demo seed');
    await import('./seed.js');
  }
}
// Băm mọi PIN còn ở dạng plaintext (DB cũ / sau seed demo) trước khi bootstrap admin.
try {
  const migratedPins = migratePlaintextPins(db);
  if (migratedPins > 0) logger.warn('hashed legacy plaintext PINs', { count: migratedPins });
} catch (err) {
  logger.warn('PIN migration skipped', { message: err.message });
}
const adminBootstrap = bootstrapDefaultAdmin();
if (adminBootstrap.created) logger.warn('default admin account created', { username: adminBootstrap.username });
if (adminBootstrap.pinReset) logger.warn('admin PIN reset via DANDPAK_ADMIN_RESET_PIN env (remove the env var after this run)', { username: adminBootstrap.username });

const app = express();
app.disable('x-powered-by');
// Security headers (tương đương helmet, không cần thêm thư viện). Không đặt CSP
// vì app dùng nhiều inline module/handler — sẽ bổ sung CSP riêng sau nếu cần.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
});
app.use(createCorsMiddleware(env));
app.use(compressionMiddleware);              // gzip trước mọi API response
app.use(express.json({ limit: '35mb' })); // DMS cho phép file 25MB → base64 phình ~33MB

app.get('/health', (req, res) => {
  const mem = process.memoryUsage();
  const health = {
    ok: true,
    service: 'dan-d-pak-pos-erp',
    time: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    memory: {
      heapUsedMb: Math.round(mem.heapUsed / 1048576),
      heapTotalMb: Math.round(mem.heapTotal / 1048576),
      rssMb: Math.round(mem.rss / 1048576),
    },
    ...runtimeSnapshot(),
    database: { ok: true, provider: env.DATABASE_PROVIDER },
  };
  try {
    db.prepare('SELECT 1 AS ok').get();
  } catch (error) {
    health.ok = false;
    health.database = { ok: false, provider: env.DATABASE_PROVIDER, message: error.message };
  }
  return res.status(health.ok ? 200 : 503).json(health);
});

app.use('/api', requestLogger, api);
app.use('/api', apiNotFound);
// During active development, always serve fresh HTML/CSS/JS (no stale browser cache).
app.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
app.use(express.static(WEB, { etag: false, lastModified: false }));
app.get('/', (req, res) => res.sendFile(join(WEB, 'index.html')));
app.get('/settings', (req, res) => res.sendFile(join(WEB, 'admin.html')));
// Haravan-style settings sub-routes (/settings/staff, /settings/location, ...) all serve the admin shell.
app.get('/settings/:tab', (req, res) => res.sendFile(join(WEB, 'admin.html')));
// Report center lives in the admin shell; /reports/<type> deep-links a specific report.
app.get('/reports', (req, res) => res.sendFile(join(WEB, 'admin.html')));
app.get('/reports/:type', (req, res) => res.sendFile(join(WEB, 'admin.html')));
// Module sub-tabs deep-linked Haravan-style (/contacts/customers, /database/logs, ...).
app.get('/contacts/:tab', (req, res) => res.sendFile(join(WEB, 'contacts.html')));
app.get('/database/:tab', (req, res) => res.sendFile(join(WEB, 'database.html')));
for (const v of ['ipad', 'pos', 'kds', 'admin', 'retail', 'warehouse', 'sim', 'printers', 'online', 'contacts', 'purchase', 'expenses', 'invoices', 'database', 'documents']) {
  app.get('/' + v, (req, res) => res.sendFile(join(WEB, v + '.html')));
}
app.use(errorHandler);

const server = createServer(app);
initRealtime(server);
startSyncEngine();

// Nhật ký hoạt động lưu trữ lâu dài trong cơ sở dữ liệu (tối đa 3 năm)
const AUDIT_RETENTION_DAYS = 1095;
function purgeAudit() {
  try {
    const compacted = compactOldAuditLogs(90);
    if (compacted) logger.info('old audit logs compacted/encrypted', { compacted });
    const removed = purgeOldAudit(AUDIT_RETENTION_DAYS);
    if (removed) logger.warn('old audit rows purged from live SQLite window', { removed, retentionDays: AUDIT_RETENTION_DAYS });
  } catch (e) { logger.warn('audit purge/compaction failed', { message: e.message }); }
}
purgeAudit();
setInterval(purgeAudit, 24 * 60 * 60 * 1000).unref();

// Sao lưu local định kỳ: snapshot store.db ra backups/ để có thể copy ra ổ ngoài/VPS.
function runBackup() {
  try {
    const r = backupDatabase(env.BACKUP_RETENTION_DAYS);
    if (r.ok) logger.info('database backup written', { path: r.path, bytes: r.bytes, pruned: r.pruned });
    else logger.warn('database backup failed', { error: r.error });
  } catch (e) { logger.warn('database backup threw', { message: e.message }); }
}
runBackup();
setInterval(runBackup, 24 * 60 * 60 * 1000).unref();

server.listen(PORT, () => {
  logger.info('POS/ERP server started', {
    port: PORT,
    localUrl: `http://localhost:${PORT}`,
    webRoot: WEB,
    runtime: runtimeSnapshot(),
  });
  if (!existsSync(WEB)) logger.warn('web folder missing', { webRoot: WEB });
});

function shutdown(signal) {
  logger.info('shutdown signal received', { signal });
  server.close(() => {
    logger.info('http server closed');
    process.exit(0);
  });
  setTimeout(() => {
    logger.error('forced shutdown after timeout', { signal });
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Trap lỗi không bắt được — log rõ ràng trước khi crash thay vì crash thầm lặng.
process.on('uncaughtException', (err) => {
  logger.error('uncaughtException — server sẽ thoát', { message: err.message, stack: err.stack });
  setTimeout(() => process.exit(1), 500).unref();
});
process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : undefined;
  logger.error('unhandledRejection', { message, stack });
});
