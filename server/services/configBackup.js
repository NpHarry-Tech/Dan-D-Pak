// Config export/import for persisting store configuration across server restarts.
// Covers setup tables only (branches, staff, catalog, settings) — not transactional data.
import { db } from '../db.js';
import dns from 'node:dns/promises';
import net from 'node:net';

const CONFIG_TABLES = [
  'branches',
  'users',
  'warehouses',
  'categories',
  'menu_items',
  'inventory_items',
  'skus',
  'tables',
  'recipes',
  'app_settings',
  'role_perms',
  'user_perms',
  'vouchers',
];

export function exportConfig() {
  const snapshot = { _version: 1, _exported_at: new Date().toISOString() };
  for (const table of CONFIG_TABLES) {
    try {
      snapshot[table] = db.prepare(`SELECT * FROM ${table}`).all();
    } catch {
      snapshot[table] = [];
    }
  }
  return snapshot;
}

export function importConfig(snapshot) {
  if (!snapshot || snapshot._version !== 1) throw new Error('Định dạng backup không hợp lệ (thiếu _version: 1)');

  const txn = db.transaction(() => {
    for (const table of CONFIG_TABLES) {
      const rows = snapshot[table];
      if (!Array.isArray(rows) || rows.length === 0) continue;
      db.exec(`DELETE FROM ${table}`);
      for (const row of rows) {
        const cols = Object.keys(row);
        if (cols.length === 0) continue;
        const placeholders = cols.map(() => '?').join(',');
        db.prepare(`INSERT OR REPLACE INTO ${table} (${cols.join(',')}) VALUES (${placeholders})`)
          .run(...Object.values(row));
      }
    }
  });

  txn();
  const counts = {};
  for (const t of CONFIG_TABLES) counts[t] = (snapshot[t] || []).length;
  return { ok: true, counts };
}

function isPrivateHostname(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost')) return true;

  const ipVersion = net.isIP(host);
  if (ipVersion === 4) {
    const parts = host.split('.').map(Number);
    return parts[0] === 0
      || parts[0] === 10
      || parts[0] === 127
      || (parts[0] === 169 && parts[1] === 254)
      || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
      || (parts[0] === 192 && parts[1] === 168);
  }
  if (ipVersion === 6) {
    return host === '::1'
      || host.startsWith('fc')
      || host.startsWith('fd')
      || host.startsWith('fe80:');
  }
  return false;
}

async function assertSafeConfigSeedUrl(rawUrl) {
  const url = new URL(String(rawUrl || ''));
  if (!['https:', 'http:'].includes(url.protocol)) {
    throw new Error('CONFIG_SEED_URL must use http or https.');
  }
  if (url.username || url.password) {
    throw new Error('CONFIG_SEED_URL must not include credentials.');
  }
  if (process.env.NODE_ENV === 'production'
      && url.protocol !== 'https:'
      && process.env.ALLOW_INSECURE_CONFIG_SEED !== 'true') {
    throw new Error('CONFIG_SEED_URL must use https in production.');
  }

  const allowPrivate = process.env.ALLOW_PRIVATE_CONFIG_SEED === 'true';
  if (!allowPrivate) {
    if (isPrivateHostname(url.hostname)) {
      throw new Error('CONFIG_SEED_URL must not target localhost or private network addresses.');
    }
    const answers = await dns.lookup(url.hostname, { all: true, verbatim: true });
    if (answers.some(a => isPrivateHostname(a.address))) {
      throw new Error('CONFIG_SEED_URL resolved to a private network address.');
    }
  }
  return url;
}

export async function fetchAndRestoreConfig(url) {
  const safeUrl = await assertSafeConfigSeedUrl(url);
  const res = await fetch(safeUrl, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Không tải được config từ URL (HTTP ${res.status})`);
  const snapshot = await res.json();
  return importConfig(snapshot);
}
