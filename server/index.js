// Local Store Server — entry point. Express REST + Socket.IO realtime + static client.
import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { db, migrate, purgeOldAudit } from './db.js';
import { initRealtime } from './realtime.js';
import { api } from './api.js';
import { startSyncEngine } from './services/sync.js';
import { ensureStorageDirectories } from './services/enterpriseStorage.js';
import { bootstrapDefaultAdmin } from './services/bootstrapAdmin.js';
import { restoreConfigBackupIfNeeded } from './services/configBackup.js';
import { env } from './config/env.js';
import { createCorsMiddleware } from './config/cors.js';
import { runtimeSnapshot } from './config/runtime.js';
import { apiNotFound, errorHandler } from './core/http.js';
import { logger } from './core/logger.js';
import { requestLogger } from './core/requestLogger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB = join(__dirname, '..', 'web');
const PORT = env.PORT;
globalThis.__DANDPAK_STARTED_AT = new Date().toISOString();

migrate();

// Restore config from local backup file first (before seed logic), so user accounts and
// settings created in the UI survive a redeploy that wiped the SQLite file.
// Only active when CONFIG_BACKUP_PATH env var points to a persistent-disk path.
const backupRestore = restoreConfigBackupIfNeeded();
if (backupRestore?.ok) {
  logger.info('config restored from local backup file', backupRestore.counts);
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
const adminBootstrap = bootstrapDefaultAdmin();
if (adminBootstrap.created) logger.warn('default admin account created', { username: adminBootstrap.username });

const app = express();
app.disable('x-powered-by');
app.use(createCorsMiddleware(env));
app.use(express.json({ limit: '8mb' })); // room for base64 image uploads

app.get('/health', (req, res) => {
  const health = {
    ok: true,
    service: 'dan-d-pak-pos-erp',
    time: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
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
for (const v of ['ipad', 'pos', 'kds', 'admin', 'retail', 'warehouse', 'sim', 'printers', 'online', 'contacts', 'purchase', 'expenses']) {
  app.get('/' + v, (req, res) => res.sendFile(join(WEB, v + '.html')));
}
app.use(errorHandler);

const server = createServer(app);
initRealtime(server);
startSyncEngine();

// Nhật ký hoạt động chỉ giữ 7 ngày gần nhất — dọn khi khởi động rồi lặp lại mỗi ngày.
const AUDIT_RETENTION_DAYS = 7;
function purgeAudit() {
  try {
    const removed = purgeOldAudit(AUDIT_RETENTION_DAYS);
    if (removed) logger.warn('old audit rows purged from live SQLite window', { removed, retentionDays: AUDIT_RETENTION_DAYS });
  } catch (e) { logger.warn('audit purge failed', { message: e.message }); }
}
purgeAudit();
setInterval(purgeAudit, 24 * 60 * 60 * 1000).unref();

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
