// Local Store Server — entry point. Express REST + Socket.IO realtime + static client.
import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';
import zlib from 'node:zlib';
import { db, migrate, reconcileAuditFromArchive, compactAuditToMonthly, purgeAuditBeyondRetention, backupDatabase } from './db.js';
import { initRealtime } from './realtime.js';
import { api } from './api.js';
import { startSyncEngine } from './services/sync.js';
import {
  handleHaravanWebhook, verifyHaravanSubscribe, installUrl as haravanInstallUrl,
  oauthCallback as haravanOauthCallback, startHaravanWorker,
} from './services/haravanConnector.js';
import { processInvoiceQueue } from './services/einvoice.js';
import { ensureStorageDirectories } from './services/enterpriseStorage.js';
import { bootstrapDefaultAdmin } from './services/bootstrapAdmin.js';
import { migratePlaintextPins } from './services/pin.js';
import { env } from './config/env.js';
import { createCorsMiddleware } from './config/cors.js';
import { runtimeSnapshot } from './config/runtime.js';
import { apiNotFound, errorHandler } from './core/http.js';
import { logger } from './core/logger.js';
import { requestLogger } from './core/requestLogger.js';
import { requestContextMiddleware } from './core/requestContext.js';
import { logSystem, maintainSystemLogs } from './services/systemLogs.js';
import { maintainPrintJobs } from './services/printing.js';
import { maintainRetailCarts } from './services/retailCart.js';
import { rateLimit } from './core/rateLimit.js';

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
const ENGINE_ASSETS = join(__dirname, 'assets');
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
// (Cơ chế config-seed.json / CONFIG_SEED_URL thời server free không có disk
// đã GỠ BỎ 2026-07-16 — dữ liệu thật giờ sống bền trong SQLite + backup.)
const hasMenu = db.prepare(`SELECT COUNT(*) n FROM menu_items`).get().n;
const hasBranch = db.prepare(`SELECT COUNT(*) n FROM branches`).get().n;
const isEmpty = !hasMenu && !hasBranch;
if (isEmpty) {
  if (env.DISABLE_DEMO_SEED) {
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
// Security headers (tương đương helmet, không cần thêm thư viện).
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'");
  next();
});
app.use(createCorsMiddleware(env));
app.use(compressionMiddleware);              // gzip trước mọi API response
app.use('/api', rateLimit({ key: 'api', windowMs: 60_000, max: 6000 }));
// Rate-limit webhook Haravan (300/phút/IP) bằng limiter DÙNG CHUNG ở core/rateLimit.js.
const haravanWebhookRateLimit = rateLimit({ key: 'haravan-webhook', windowMs: 60_000, max: 300, message: 'rate_limited' });
app.get('/webhooks/haravan', haravanWebhookRateLimit, (req, res) => {
  try {
    res.status(200).send(verifyHaravanSubscribe(req.query));
  } catch (err) {
    res.status(err.status || 400).send(err.message || 'Haravan webhook verify failed');
  }
});
app.post('/webhooks/haravan', haravanWebhookRateLimit, express.raw({ type: '*/*', limit: '10mb' }), (req, res) => {
  try {
    handleHaravanWebhook(Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || ''), req.headers);
    res.status(200).send('OK');
  } catch (err) {
    res.status(err.status || 400).send(err.message || 'Haravan webhook failed');
  }
});
app.use(express.json({ limit: '35mb' })); // DMS cho phép file 25MB → base64 phình ~33MB

app.get('/auth/haravan/install', (req, res) => {
  try {
    res.redirect(haravanInstallUrl({ branch_id: req.query.branch_id || req.query.branch || 'ONLINE' }).url);
  } catch (err) {
    res.status(err.status || 400).send(err.message || 'Haravan install failed');
  }
});
app.get('/auth/haravan/callback', async (req, res) => {
  try {
    const out = await haravanOauthCallback(req.query);
    res.status(200).send(`Haravan connected: ${out.shopDomain}`);
  } catch (err) {
    res.status(err.status || 400).send(err.message || 'Haravan OAuth failed');
  }
});

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

app.use('/api', requestContextMiddleware, requestLogger, api);
app.use('/api', apiNotFound);
// During active development, always serve fresh HTML/CSS/JS (no stale browser cache).
app.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
app.use('/uploads', express.static(join(__dirname, 'uploads'), { etag: false, lastModified: false }));
app.use('/assets', express.static(ENGINE_ASSETS, { etag: false, lastModified: false }));

app.use(errorHandler);

const server = createServer(app);
initRealtime(server);
startSyncEngine();
startHaravanWorker();

// Vòng đời nhật ký hoạt động (giữ tối đa 3 năm / 36 tháng):
//  • Hot: các tháng gần nhất (3 tháng) nằm trong SQLite → tra cứu tức thì.
//  • Cold: tháng cũ hơn được gom thành 1 file .ndjson.gz/tháng → store.db gọn.
//  • Mở lại tháng cũ → rehydrate về SQLite, giữ "nóng" 7 ngày rồi tự nén lại.
//  • Tới tháng thứ 37 thì xóa tháng thứ 1 (cả file nén lẫn dòng SQLite).
function maintainAudit() {
  try {
    const redundant = db.prepare(
      `DELETE FROM audit_log WHERE action IN (
        'system.error','client.crash','print.failed','print.agent.failed',
        'einvoice.backfill_failed','einvoice.auto_create_failed'
      )`
    ).run().changes;
    if (redundant) logger.info('redundant audit rows pruned', { removed: redundant });
    const c = compactAuditToMonthly(3);
    if (c.archivedMonths || c.removedRows) logger.info('audit compacted to monthly archives', c);
    const p = purgeAuditBeyondRetention(36);
    if (p.removedFiles || p.removedRows) logger.warn('audit beyond 36-month retention purged', p);
  } catch (e) { logger.warn('audit maintenance failed', { message: e.message }); }
  // Nhật ký hệ thống hợp nhất: giữ 60 ngày / tối đa 200k dòng (log kỹ thuật
  // ngắn hạn — hồ sơ dài hạn đã có audit_log + kho NDJSON 36 tháng).
  const s = maintainSystemLogs();
  if (s.removedRedundant || s.removedExactDuplicates || s.removedByAge || s.removedByCount) {
    logger.info('system_logs pruned', s);
  }
  const pj = maintainPrintJobs();
  if (pj.removedByAge || pj.removedByCount) logger.info('print_jobs pruned', pj);
  const rc = maintainRetailCarts();
  if (rc) logger.info('retail_carts pruned', { removed: rc });
}
maintainAudit();
setInterval(maintainAudit, 24 * 60 * 60 * 1000).unref();

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

// E-invoice queue processor worker: runs every 10 seconds to issue and retry invoices
function runInvoiceWorker() {
  processInvoiceQueue().catch(err => {
    logger.error('Invoice worker error', { message: err.message, stack: err.stack });
    logSystem({
      level: 'error', source: 'misa', eventType: 'einvoice_error',
      title: 'Worker hóa đơn điện tử gặp lỗi',
      message: err.message, exceptionType: err.name, stackTrace: err.stack,
    });
  });
}
runInvoiceWorker();
setInterval(runInvoiceWorker, 10000).unref();

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    const message = `Server đã chạy hoặc cổng ${PORT} đang được chương trình khác sử dụng.`;
    logger.error('server port already in use', { port: PORT, message: err.message });
    logSystem({
      level: 'fatal',
      source: 'backend',
      eventType: 'startup_port_in_use',
      title: 'Không khởi động được server',
      message,
      exceptionType: err.name,
      stackTrace: err.stack,
    });
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, () => {
  logger.info('POS/ERP server started', {
    port: PORT,
    localUrl: `http://localhost:${PORT}`,
    runtime: runtimeSnapshot(),
  });
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
// Ghi cả vào system_logs (fatal) để màn Nhật ký hoạt động thấy được server chết.
process.on('uncaughtException', (err) => {
  logger.error('uncaughtException — server sẽ thoát', { message: err.message, stack: err.stack });
  try {
    logSystem({
      level: 'fatal', source: 'backend', eventType: 'crash',
      title: 'Server crash: uncaughtException',
      message: err.message, exceptionType: err.name, stackTrace: err.stack,
    });
  } catch { /* đang chết — không được ném thêm */ }
  setTimeout(() => process.exit(1), 500).unref();
});
process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : undefined;
  logger.error('unhandledRejection', { message, stack });
  try {
    logSystem({
      level: 'error', source: 'backend', eventType: 'unhandled_rejection',
      title: 'Server unhandledRejection',
      message, stackTrace: stack,
      exceptionType: reason instanceof Error ? reason.name : 'UnhandledRejection',
    });
  } catch { /* logging must never crash the handler */ }
});
