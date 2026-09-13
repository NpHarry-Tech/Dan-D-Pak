import crypto from 'node:crypto';
import { db, uid, now, audit } from '../db.js';

const processors = new Map();
let timer = null;
let running = false;

export function ensureMarketplaceWebhookInbox() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS marketplace_webhook_inbox (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      connection_id TEXT,
      external_shop_id TEXT,
      event_type TEXT NOT NULL,
      provider_event_id TEXT NOT NULL,
      event_hash TEXT NOT NULL,
      raw_payload TEXT,
      status TEXT NOT NULL DEFAULT 'received',
      retry_count INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      received_at TEXT NOT NULL,
      next_retry_at TEXT,
      processed_at TEXT,
      UNIQUE(provider,external_shop_id,event_type,provider_event_id)
    );
    CREATE INDEX IF NOT EXISTS idx_marketplace_webhook_work
      ON marketplace_webhook_inbox(status,next_retry_at,received_at);
    CREATE TABLE IF NOT EXISTS marketplace_webhook_quarantine (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      external_shop_id TEXT,
      reason TEXT NOT NULL,
      event_hash TEXT NOT NULL,
      received_at TEXT NOT NULL
    );
  `);
}

function rawText(rawBody) {
  return Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '');
}

export function quarantineMarketplaceWebhook(provider, rawBody, { shopId = '', reason = 'rejected' } = {}) {
  ensureMarketplaceWebhookInbox();
  const hash = crypto.createHash('sha256').update(rawText(rawBody)).digest('hex');
  db.prepare(`INSERT INTO marketplace_webhook_quarantine
    (id,provider,external_shop_id,reason,event_hash,received_at) VALUES (?,?,?,?,?,?)`)
    .run(uid('mpwhq_'), String(provider), String(shopId || ''), String(reason).slice(0, 200), hash, now());
  return hash;
}

export function enqueueMarketplaceWebhook({
  provider, connectionId, shopId, eventType, providerEventId, rawBody,
}) {
  ensureMarketplaceWebhookInbox();
  const raw = rawText(rawBody);
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const stableEventId = String(providerEventId || hash);
  const inserted = db.prepare(`INSERT OR IGNORE INTO marketplace_webhook_inbox
    (id,provider,connection_id,external_shop_id,event_type,provider_event_id,event_hash,raw_payload,status,retry_count,received_at)
    VALUES (?,?,?,?,?,?,?,?, 'received',0,?)`)
    .run(uid('mpwh_'), String(provider), String(connectionId || ''), String(shopId || ''),
      String(eventType || 'UNKNOWN'), stableEventId, hash, raw, now()).changes;
  return { accepted: true, duplicate: inserted === 0, event_hash: hash };
}

export function registerMarketplaceWebhookProcessor(provider, processor) {
  processors.set(String(provider), processor);
}

export async function processMarketplaceWebhookQueue(limit = 25) {
  ensureMarketplaceWebhookInbox();
  if (running) return { skipped: true };
  running = true;
  let processed = 0;
  let failed = 0;
  try {
    for (let i = 0; i < Math.max(1, Math.min(100, Number(limit) || 25)); i++) {
      const row = db.prepare(`SELECT * FROM marketplace_webhook_inbox
        WHERE status IN ('received','retrying')
          AND (next_retry_at IS NULL OR next_retry_at<=?)
        ORDER BY received_at LIMIT 1`).get(now());
      if (!row) break;
      const processor = processors.get(row.provider);
      if (!processor) break;
      const claimed = db.prepare(`UPDATE marketplace_webhook_inbox SET status='processing'
        WHERE id=? AND status IN ('received','retrying')`).run(row.id).changes;
      if (!claimed) continue;
      try {
        await processor(row);
        db.prepare(`UPDATE marketplace_webhook_inbox SET
          status='success',raw_payload=NULL,error=NULL,processed_at=?,next_retry_at=NULL WHERE id=?`)
          .run(now(), row.id);
        processed++;
      } catch (error) {
        const retry = Number(row.retry_count || 0) + 1;
        const dead = retry >= 12;
        const delay = Math.min(3600, 5 * (2 ** Math.min(retry - 1, 9)));
        const next = new Date(Date.now() + delay * 1000).toISOString();
        db.prepare(`UPDATE marketplace_webhook_inbox SET status=?,retry_count=?,error=?,next_retry_at=? WHERE id=?`)
          .run(dead ? 'dead_letter' : 'retrying', retry,
            String(error?.message || error).slice(0, 500), dead ? null : next, row.id);
        audit('marketplace.webhook.process_failed', {
          provider: row.provider, shop_id: row.external_shop_id, retry_count: retry,
          dead_letter: dead, error: error?.message,
        }, '', row.provider);
        failed++;
      }
    }
    return { processed, failed };
  } finally {
    running = false;
  }
}

export function startMarketplaceWebhookWorker() {
  ensureMarketplaceWebhookInbox();
  if (timer) return;
  setTimeout(() => processMarketplaceWebhookQueue().catch(() => {}), 250).unref?.();
  timer = setInterval(() => processMarketplaceWebhookQueue().catch(() => {}), 1000);
  timer.unref?.();
}

export function marketplaceWebhookHealth(provider = '') {
  ensureMarketplaceWebhookInbox();
  const where = provider ? ' WHERE provider=?' : '';
  const rows = db.prepare(`SELECT status,COUNT(*) count FROM marketplace_webhook_inbox${where} GROUP BY status`)
    .all(...(provider ? [provider] : []));
  return Object.fromEntries(rows.map(r => [r.status, Number(r.count)]));
}
