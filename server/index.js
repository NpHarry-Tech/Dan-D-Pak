// Local Store Server — entry point. Express REST + Socket.IO realtime + static client.
import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';
import zlib from 'node:zlib';
import { db, DB_WAS_EMPTY, migrate, reconcileAuditFromArchive, compactAuditToMonthly, purgeAuditBeyondRetention, backupDatabase } from './db.js';
import { seedShopeeReview } from './db/reviewSeed.js';
import { tenantMiddleware } from './services/tenantContext.js';
import { initRealtime } from './realtime.js';
import { api } from './api.js';
import { startSyncEngine } from './services/sync.js';
import {
  handleHaravanWebhook, verifyHaravanSubscribe, installUrl as haravanInstallUrl,
  oauthCallback as haravanOauthCallback, startHaravanWorker, maintainHaravanLogs,
} from './services/haravanConnector.js';
import { receiveShopeePush, startShopeePushWorker, shopeeExchangeToken } from './services/shopeeConnector.js';
import { handleCallback as handleMarketplaceCallback } from './services/connectionPlatform.js';
import { handleLazadaPush, lazadaExchangeToken } from './services/lazadaConnector.js';
import { handleTiktokWebhook, tiktokExchangeToken } from './services/tiktokConnector.js';
import { verifyMetaSubscribe, handleMetaWebhook } from './services/metaConnector.js';
import { handleZaloWebhook } from './services/zaloConnector.js';
import { backfillPaidBills, processInvoiceQueue } from './services/einvoice.js';
import { startErpWorker } from './integrations/erp/outbox.js';
import { ensureStorageDirectories } from './services/enterpriseStorage.js';
import { bootstrapDefaultAdmin } from './services/bootstrapAdmin.js';
import { migratePlaintextPins } from './services/pin.js';
import { env, storagePath, assertSecureProductionEnv } from './config/env.js';
import { createCorsMiddleware } from './config/cors.js';
import { runtimeSnapshot } from './config/runtime.js';
import { apiNotFound, errorHandler } from './core/http.js';
import { logger } from './core/logger.js';
import { requestLogger } from './core/requestLogger.js';
import { requestContextMiddleware } from './core/requestContext.js';
import { beginRequestTiming } from './core/requestTiming.js';
import { logSystem, maintainSystemLogs } from './services/systemLogs.js';
import { maintainPrintJobs, processReceiptPrintOutbox } from './services/printing.js';
import { maintainRetailCarts } from './services/retailCart.js';
import { maintainRetailDrafts } from './services/retail.js';
import { rateLimit } from './core/rateLimit.js';
import { buildInfo } from './core/buildInfo.js';
import { immutableUploadStaticOptions, bundledAssetStaticOptions } from './core/staticAssets.js';

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
export const UPLOADS_DIR = storagePath('uploads', 'documents');
mkdirSync(UPLOADS_DIR, { recursive: true });
globalThis.__DANDPAK_STARTED_AT = new Date().toISOString();

assertSecureProductionEnv();
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
if (DB_WAS_EMPTY) {
  if (env.isReview) {
    // Tenant review KHÔNG BAO GIỜ chạy demo seed chung (nhân sự/kho/bàn/máy in
    // production-like). Review chỉ có reviewSeed tối thiểu bên dưới. Đây là bất
    // biến cách ly tenant (§16/§42) — không phụ thuộc cờ DISABLE_DEMO_SEED.
    logger.warn('review env: skipping common demo seed (minimal review seed only)');
  } else if (env.DISABLE_DEMO_SEED) {
    logger.warn('empty database detected; DISABLE_DEMO_SEED=true — skipping demo seed');
  } else {
    logger.warn('empty catalog detected; running demo seed');
    await import('./seed.js');
  }
}
// Băm mọi PIN legacy còn plaintext trước khi mở HTTP server.
try {
  const migratedPins = migratePlaintextPins(db);
  if (migratedPins > 0) logger.warn('hashed legacy plaintext PINs', { count: migratedPins });
} catch (err) {
  logger.warn('PIN migration skipped', { message: err.message });
}

if (env.isReview) {
  // Review public internet-facing: seed failure là STARTUP FAILURE, không được tiếp
  // tục chạy với account mặc định/demo. seedShopeeReview cũng vô hiệu user khác.
  const r = seedShopeeReview();
  logger.warn('Shopee review env seeded', r);
} else {
  const adminBootstrap = bootstrapDefaultAdmin();
  if (adminBootstrap.created) logger.warn('default admin account created', { username: adminBootstrap.username });
  if (adminBootstrap.pinReset) logger.warn('admin PIN reset via DANDPAK_ADMIN_RESET_PIN env (remove the env var after this run)', { username: adminBootstrap.username });
}

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
// TenantContext + chặn Host giả mạo cho data-plane /api (§8/§38). Chỉ enforce khi
// tenant đã khai host (API_BASE_URL/APP_URL/TENANT_ALLOWED_HOSTS); dev/LAN bỏ qua.
// /health và /webhooks không đi qua đây (health dùng localhost; webhook có chữ ký).
app.use('/api', tenantMiddleware());
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
// Shopee Push: verify chữ ký + durable enqueue rồi ACK ngay. Worker xử lý nghiệp vụ
// sau ACK để không phụ thuộc latency Shopee API/SQLite trong cửa sổ timeout webhook.
const shopeeWebhookRateLimit = rateLimit({ key: 'shopee-webhook', windowMs: 60_000, max: 600, message: 'rate_limited' });
app.post('/webhooks/shopee', shopeeWebhookRateLimit, express.raw({ type: '*/*', limit: '10mb' }), (req, res) => {
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
  const host = req.get('host');
  const candidates = [
    `https://${host}/webhooks/shopee`,
    `http://${host}/webhooks/shopee`,
    `${req.protocol}://${host}${req.originalUrl}`,
  ];
  try {
    receiveShopeePush(raw, req.headers, candidates);
    res.status(200).send('OK');
  } catch (err) {
    res.status(err.status || 400).send(err.message || 'Shopee push failed');
  }
});
// Lazada Push — ký body HMAC(app_secret); đọc raw TRƯỚC express.json.
const lazadaWebhookRateLimit = rateLimit({ key: 'lazada-webhook', windowMs: 60_000, max: 600, message: 'rate_limited' });
app.post('/webhooks/lazada', lazadaWebhookRateLimit, express.raw({ type: '*/*', limit: '10mb' }), async (req, res) => {
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
  try {
    await handleLazadaPush(raw, req.headers);
    res.status(200).send('OK');
  } catch (err) {
    res.status(err.status || 400).send(err.message || 'Lazada push failed');
  }
});
// TikTok Shop webhook — Authorization = HMAC(app_secret, app_key+body); raw body.
const tiktokWebhookRateLimit = rateLimit({ key: 'tiktok-webhook', windowMs: 60_000, max: 600, message: 'rate_limited' });
app.post('/webhooks/tiktok', tiktokWebhookRateLimit, express.raw({ type: '*/*', limit: '10mb' }), async (req, res) => {
  try { await handleTiktokWebhook(Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || ''), req.headers); res.status(200).send('OK'); }
  catch (err) { res.status(err.status || 400).send(err.message || 'TikTok webhook failed'); }
});
// Meta (Facebook Page + Instagram) — GET verify + POST X-Hub-Signature-256; raw body.
const metaWebhookRateLimit = rateLimit({ key: 'meta-webhook', windowMs: 60_000, max: 600, message: 'rate_limited' });
app.get('/webhooks/meta', (req, res) => {
  try { res.status(200).send(verifyMetaSubscribe(req.query, req.query.branch_id || 'sala')); }
  catch (err) { res.status(err.status || 403).send(err.message || 'Meta verify failed'); }
});
app.post('/webhooks/meta', metaWebhookRateLimit, express.raw({ type: '*/*', limit: '10mb' }), (req, res) => {
  try { handleMetaWebhook(Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || ''), req.headers); res.status(200).send('EVENT_RECEIVED'); }
  catch (err) { res.status(err.status || 400).send(err.message || 'Meta webhook failed'); }
});
// Zalo OA — X-ZEvent-Signature = mac=SHA256(appId+body+timestamp+OASecret); raw body.
const zaloWebhookRateLimit = rateLimit({ key: 'zalo-webhook', windowMs: 60_000, max: 600, message: 'rate_limited' });
app.post('/webhooks/zalo', zaloWebhookRateLimit, express.raw({ type: '*/*', limit: '10mb' }), (req, res) => {
  try { handleZaloWebhook(Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || ''), req.headers); res.status(200).send('OK'); }
  catch (err) { res.status(err.status || 400).send(err.message || 'Zalo webhook failed'); }
});
app.use(express.json({ limit: '35mb' })); // DMS cho phép file 25MB → base64 phình ~33MB

// TikTok Shop OAuth redirect: seller authorize xong → kèm ?code= (auth_code).
app.get('/auth/tiktok/callback', async (req, res) => {
  try {
    const branchId = req.query.branch_id || req.query.branch || req.query.state || 'sala';
    await tiktokExchangeToken(branchId, req.query.code || req.query.auth_code);
    res.status(200).send('TikTok Shop đã kết nối. Có thể đóng cửa sổ này.');
  } catch (err) { res.status(err.status || 400).send(err.message || 'TikTok OAuth failed'); }
});

// Trang xác nhận kết nối (đóng lại, app tự cập nhật qua poll).
function connectedHtml(name, shop) {
  return `<html><body style="font-family:sans-serif;text-align:center;padding:40px">` +
    `<h2>✓ Đã kết nối ${name}${shop ? ` (shop ${shop})` : ''}</h2>` +
    `<p>Quay lại ứng dụng Dan-D Pak — kết nối sẽ tự cập nhật. Có thể đóng cửa sổ này.</p></body></html>`;
}

// Lazada OAuth redirect: seller authorize xong → Lazada gọi kèm ?code=.
app.get('/auth/lazada/callback', async (req, res) => {
  try {
    const state = String(req.query.state || '');
    if (state.startsWith('mpatt_')) {
      const out = await handleMarketplaceCallback('lazada', req.query);
      return res.status(200).send(connectedHtml('Lazada', out.shop_id));
    }
    // §8 HARDENING: legacy fallback (branch từ client query, không state machine)
    // fail-closed mặc định; chỉ bật qua SHOPEE_LEGACY_CALLBACK=1.
    if (!env.SHOPEE_LEGACY_CALLBACK) {
      const e = new Error('Phiên kết nối Lazada không hợp lệ. Hãy kết nối lại bằng nút "Kết nối" 1-chạm.');
      e.status = 400;
      throw e;
    }
    const branchId = req.query.branch_id || req.query.branch || 'sala';
    const out = await lazadaExchangeToken(branchId, req.query.code);
    res.status(200).send(`Lazada đã kết nối seller ${out.seller_id}. Có thể đóng cửa sổ này.`);
  } catch (err) {
    res.status(err.status || 400).send(err.message || 'Lazada OAuth failed');
  }
});

// Shopee OAuth redirect: shop authorize xong → Shopee gọi kèm ?code=&shop_id=.
app.get('/auth/shopee/callback', async (req, res) => {
  try {
    const state = String(req.query.state || '');
    // Flow MỚI (Connection Platform 1-chạm): state = marketplace_auth_attempt id.
    // ĐÂY là đường canonical — có state one-shot + TTL + branch bind server-side +
    // anti-replay + token mã hoá.
    if (state.startsWith('mpatt_')) {
      const out = await handleMarketplaceCallback('shopee', req.query);
      return res.status(200).send(connectedHtml('Shopee', out.shop_id));
    }
    // §8 HARDENING: đường LEGACY (per-branch settings) KHÔNG có state machine và
    // lấy branch_id TỪ CLIENT QUERY để cấp token → bypass được cổng bảo mật. NGƯNG
    // mặc định (fail-closed). Chỉ bật khi bắt buộc tương thích migrate cũ, qua cờ
    // tường minh SHOPEE_LEGACY_CALLBACK=1 (chấp nhận rủi ro, ghi rõ technical debt).
    if (!env.SHOPEE_LEGACY_CALLBACK) {
      const e = new Error('Phiên kết nối Shopee không hợp lệ. Hãy kết nối lại bằng nút "Kết nối" 1-chạm trong mục Kết nối sàn.');
      e.status = 400;
      throw e;
    }
    const branchId = req.query.branch_id || req.query.branch || 'sala';
    const out = await shopeeExchangeToken(branchId, req.query.code, req.query.shop_id);
    res.status(200).send(`Shopee đã kết nối shop ${out.shop_id}. Có thể đóng cửa sổ này.`);
  } catch (err) {
    res.status(err.status || 400).send(err.message || 'Shopee OAuth failed');
  }
});

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

// LIVENESS: tiến trình còn sống? Không đụng DB/integration — luôn 200 nếu process
// chạy. Dùng cho orchestrator restart. READINESS ở /health/ready. (mission #54)
app.get('/health/live', (req, res) =>
  res.status(200).json({ ok: true, live: true, time: new Date().toISOString() }));

// READINESS: sẵn sàng nhận traffic? CHỈ phụ thuộc DB (thành phần lõi). Integration
// ngoài (MISA/NAV/Haravan) down KHÔNG được làm readiness fail — POS vẫn phải bán.
app.get('/health/ready', (req, res) => {
  let dbOk = true; let message;
  try { db.prepare('SELECT 1 AS ok').get(); } catch (error) { dbOk = false; message = error.message; }
  return res.status(dbOk ? 200 : 503).json({
    ok: dbOk, ready: dbOk, database: { ok: dbOk, provider: env.DATABASE_PROVIDER, message },
    time: new Date().toISOString(),
  });
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
    build: buildInfo(db.prepare('PRAGMA user_version').get()?.user_version),
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

app.use('/api', beginRequestTiming, requestContextMiddleware, requestLogger, api);
app.use('/api', apiNotFound);
app.use('/uploads', express.static(storagePath('uploads'), immutableUploadStaticOptions));
app.use('/assets', express.static(ENGINE_ASSETS, bundledAssetStaticOptions));
// Non-asset fallthroughs must never retain a stale error/HTML response.
app.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

app.use(errorHandler);

const server = createServer(app);
initRealtime(server);
// ONLINE-ONLY: KHÔNG khởi động engine đồng bộ offline Edge→Hub khi đã ngưng
// offline-first. Bảng/dữ liệu sync giữ nguyên (inert) cho rollback. Các worker
// tích hợp ONLINE (Haravan/Shopee/ERP outbox) và outbox durability KHÔNG bị ảnh
// hưởng — chúng không phải "offline feature".
if (env.OFFLINE_DECOMMISSIONED) {
  logger.warn('online-only mode: Edge offline sync engine NOT started (OFFLINE_DECOMMISSIONED=true)');
} else {
  startSyncEngine();
}
startHaravanWorker();
startShopeePushWorker();
startErpWorker();   // ERP outbox → Business Central (no-op khi chưa cấu hình/tắt)

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
        'einvoice.backfill_failed','einvoice.auto_create_failed',
        'settings.template_autosave'
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
  const hl = maintainHaravanLogs();
  if (hl.compacted || hl.removed) logger.info('haravan sync logs pruned', hl);
  // Đơn nháp bỏ quên (thu ngân đóng dialog chuyển khoản lúc mất mạng, app crash…):
  // client đã tự hủy khi đóng dialog bình thường — đây chỉ là lưới an toàn.
  const rd = maintainRetailDrafts();
  if (rd) logger.info('retail draft orders voided (stale)', { voided: rd });
}
maintainAudit();
setInterval(maintainAudit, 24 * 60 * 60 * 1000).unref();

// Sao lưu local định kỳ: snapshot store.db ra backups/ để có thể copy ra ổ ngoài/VPS.
async function runBackup() {
  try {
    const r = await backupDatabase(env.BACKUP_RETENTION_DAYS);
    if (r.ok && r.skipped) logger.info('database backup skipped (already have one today)', { pruned: r.pruned });
    else if (r.ok) logger.info('database backup written', { path: r.path, bytes: r.bytes, pruned: r.pruned });
    else logger.warn('database backup failed', { error: r.error });
  } catch (e) { logger.warn('database backup threw', { message: e.message }); }
}
runBackup();
setInterval(runBackup, 24 * 60 * 60 * 1000).unref();

// E-invoice queue processor worker: runs every 10 seconds to issue and retry invoices
function runInvoiceWorker() {
  // Paid bills can arrive after startup through Store Edge replication. The old
  // one-shot backfill below ran too early and those bills never entered HĐĐT.
  // Reconcile idempotently on every worker cycle before sending provider jobs.
  try {
    const repaired = backfillPaidBills(100);
    if (repaired.created > 0) logger.info('created missing e-invoice requests', repaired);
  } catch (err) {
    logger.error('Invoice backfill worker error', { message: err.message, stack: err.stack });
  }
  processInvoiceQueue().catch(err => {
    logger.error('Invoice worker error', { message: err.message, stack: err.stack });
    logSystem({
      level: 'error', source: 'misa', eventType: 'einvoice_error',
      title: 'Worker hóa đơn điện tử gặp lỗi',
      message: err.message, exceptionType: err.name, stackTrace: err.stack,
    });
  });
}
backfillPaidBills();
runInvoiceWorker();
setInterval(runInvoiceWorker, 10000).unref();

// Durable receipt outbox: payment commits the intent first; printer failures or
// a process restart cannot lose it. Print-job semantic keys make replay safe.
function runReceiptPrintWorker() {
  try {
    const result = processReceiptPrintOutbox({ limit: 20 });
    if (result.failed) logger.warn('receipt print outbox retry pending', result);
  } catch (err) {
    logger.error('Receipt print outbox worker error', { message: err.message, stack: err.stack });
  }
}
runReceiptPrintWorker();
setInterval(runReceiptPrintWorker, 5000).unref();

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
