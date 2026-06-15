// Local Store Server — entry point. Express REST + Socket.IO realtime + static client.
import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { db, migrate } from './db.js';
import { initRealtime } from './realtime.js';
import { api } from './api.js';
import { startSyncEngine } from './services/sync.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB = join(__dirname, '..', 'web');
const PORT = process.env.PORT || 3000;

migrate();
// Auto-seed on first run if catalog is empty.
const hasMenu = db.prepare(`SELECT COUNT(*) n FROM menu_items`).get().n;
if (!hasMenu) {
  console.log('Empty catalog — seeding...');
  await import('./seed.js');
}

const app = express();
app.use(express.json({ limit: '8mb' })); // room for base64 image uploads
app.use('/api', api);
// During active development, always serve fresh HTML/CSS/JS (no stale browser cache).
app.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
app.use(express.static(WEB, { etag: false, lastModified: false }));
app.get('/', (req, res) => res.sendFile(join(WEB, 'index.html')));
for (const v of ['ipad', 'pos', 'kds', 'admin', 'retail', 'warehouse', 'sim', 'printers', 'online', 'settings']) {
  app.get('/' + v, (req, res) => res.sendFile(join(WEB, v + '.html')));
}

const server = createServer(app);
initRealtime(server);
startSyncEngine();

server.listen(PORT, () => {
  console.log(`\n  POS/ERP Local Store Server`);
  console.log(`  → http://localhost:${PORT}`);
  console.log(`  Devices: /ipad  /pos  /kds  /admin\n`);
  if (!existsSync(WEB)) console.warn('  [warn] web/ folder missing');
});
