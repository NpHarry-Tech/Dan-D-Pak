// Local change backlog + offline mode.
// IMPORTANT: sync_queue is only an outbox. Until an acknowledged upstream
// transport is configured, rows must remain pending. Observing a local row is
// not cloud synchronization and must never turn it into `done`.
import { db } from '../db.js';
import { emit } from '../realtime.js';
import { logger } from '../core/logger.js';
import { edgeSignature } from './edgeSync.js';
import { applyCatalogueSnapshot } from './catalogueSync.js';

const TRANSPORT_NOT_CONFIGURED = 'Cloud sync transport is not configured; local changes remain pending.';
const state = {
  offline: false,
  upstreamReachable: null,
  lastSyncAt: null,
  lastCataloguePullAt: null,
  lastCatalogueHash: null,
  lastError: TRANSPORT_NOT_CONFIGURED,
};
const DONE_RETENTION_DAYS = 7;
const DONE_MAX_ROWS = 1000;
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;
const CATALOGUE_PULL_INTERVAL_MS = 5 * 60 * 1000;
const MAX_CATALOGUE_SNAPSHOT_BYTES = 50 * 1024 * 1024;
let lastPruneMs = 0;

function transportConfig() {
  const upstream = String(process.env.EDGE_SYNC_UPSTREAM_URL || '').trim();
  const secret = String(process.env.EDGE_SYNC_SHARED_SECRET || '');
  const hubId = db.prepare(`SELECT hub_id FROM sync_hub_state WHERE id=1`).get()?.hub_id || 'unconfigured';
  if (!upstream || secret.length < 32 || hubId === 'unconfigured') return null;
  let url;
  try { url = new URL('/api/sync/edge/push', upstream); } catch { return null; }
  const loopbackTest = process.env.NODE_ENV === 'test' && url.protocol === 'http:' &&
    ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !loopbackTest) return null;
  return { url: url.toString(), secret, hubId };
}

function payloadForTransport(row) {
  const payload = JSON.parse(row.payload_json);
  if (row.kind === 'orders' && payload.einvoice_status === 'PENDING_EDGE_SYNC') {
    // Edge-local invoice IDs never exist on the VPS. The cloud reconciliation
    // worker creates its own idempotent legal request after the paid sale lands.
    payload.einvoice_id = null;
    payload.einvoice_status = null;
    payload.locked_at = null;
  }
  return payload;
}

export async function syncBatch(branchId = 'sala') {
  if (state.offline) return 0;
  const config = transportConfig();
  if (!config) {
    state.lastError = TRANSPORT_NOT_CONFIGURED;
    return 0;
  }
  const pending = db.prepare(
    `SELECT id,branch_id,kind,ref,sequence,operation,payload_json
     FROM sync_queue
     WHERE status='pending' AND branch_id=? AND hub_id=?
       AND sequence IS NOT NULL AND payload_json IS NOT NULL
     ORDER BY sequence LIMIT 100`,
  ).all(branchId, config.hubId);
  if (!pending.length) return 0;

  const sentAt = new Date().toISOString();
  const markAttempt = db.prepare(
    `UPDATE sync_queue SET attempt_count=attempt_count+1,last_attempt_at=?,last_error=NULL WHERE id=?`,
  );
  db.exec('BEGIN;');
  try {
    for (const row of pending) markAttempt.run(sentAt, row.id);
    db.exec('COMMIT;');
  } catch (error) {
    try { db.exec('ROLLBACK;'); } catch {}
    throw error;
  }

  try {
    const requestBody = {
      hubId: config.hubId,
      events: pending.map((row) => ({
        eventId: row.id,
        sequence: Number(row.sequence),
        kind: row.kind,
        ref: row.ref,
        branchId: row.branch_id,
        operation: row.operation,
        payload: payloadForTransport(row),
      })),
    };
    const timestamp = String(Date.now());
    const response = await fetch(config.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-edge-sync-timestamp': timestamp,
        'x-edge-sync-signature': edgeSignature(config.secret, timestamp, requestBody),
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(15_000),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || result?.ok !== true || !Array.isArray(result.acknowledged)) {
      throw new Error(`Upstream rejected edge batch (${response.status})`);
    }
    const acked = new Set(result.acknowledged.map((ack) => String(ack.eventId)));
    const markDone = db.prepare(
      `UPDATE sync_queue SET status='done',synced_at=?,last_error=NULL
       WHERE id=? AND status='pending' AND payload_json=?`,
    );
    const markEdgeInvoiceSynced = db.prepare(
      `UPDATE e_invoices SET invoice_status='SYNCED_TO_CLOUD',updated_at=?
       WHERE order_id=? AND invoice_status='PENDING_EDGE_SYNC'`,
    );
    const markOrderInvoiceSynced = db.prepare(
      `UPDATE orders SET einvoice_status='SYNCED_TO_CLOUD'
       WHERE id=? AND einvoice_status='PENDING_EDGE_SYNC'`,
    );
    let count = 0;
    db.exec('BEGIN;');
    try {
      for (const row of pending) {
        if (!acked.has(row.id)) continue;
        const syncedAt = new Date().toISOString();
        const changed = markDone.run(syncedAt, row.id, row.payload_json).changes;
        count += changed;
        if (changed && row.kind === 'sale_snapshots') {
          const orderId = JSON.parse(row.payload_json).order_id;
          db.prepare(`UPDATE sync_apply_state SET remote_apply=1 WHERE id=1`).run();
          markEdgeInvoiceSynced.run(syncedAt, orderId);
          markOrderInvoiceSynced.run(orderId);
          db.prepare(`UPDATE sync_apply_state SET remote_apply=0 WHERE id=1`).run();
        }
      }
      db.exec('COMMIT;');
    } catch (error) {
      try { db.exec('ROLLBACK;'); } catch {}
      throw error;
    }
    state.lastSyncAt = new Date().toISOString();
    state.upstreamReachable = true;
    state.lastError = null;
    return count;
  } catch (error) {
    const message = String(error?.message || error).slice(0, 500);
    const markFailed = db.prepare(`UPDATE sync_queue SET last_error=? WHERE id=? AND status='pending'`);
    for (const row of pending) markFailed.run(message, row.id);
    state.lastError = message;
    state.upstreamReachable = false;
    throw error;
  }
}

function pendingCount(branchId = 'sala') {
  try {
    return db.prepare(
      `SELECT COUNT(*) c FROM sync_queue
       WHERE status = 'pending' AND payload_json IS NOT NULL AND branch_id = ?`,
    ).get(branchId).c;
  } catch {
    return 0;
  }
}

function localOnlyCount(branchId = 'sala') {
  try {
    return db.prepare(
      `SELECT COUNT(*) c FROM sync_queue
       WHERE status = 'pending' AND payload_json IS NULL AND branch_id = ?`,
    ).get(branchId).c;
  } catch {
    return 0;
  }
}

function doneCount(branchId = 'sala') {
  try {
    return db.prepare(
      `SELECT COUNT(*) c FROM sync_queue WHERE status = 'done' AND branch_id = ?`,
    ).get(branchId).c;
  } catch {
    return 0;
  }
}

export function pruneDoneQueue() {
  const cutoff = new Date(Date.now() - DONE_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  let removed = 0;
  db.exec('BEGIN TRANSACTION;');
  try {
    removed += db.prepare(
      `DELETE FROM sync_queue
       WHERE status = 'done'
         AND COALESCE(synced_at, created_at) < ?`,
    ).run(cutoff).changes;
    removed += db.prepare(
      `DELETE FROM sync_queue
       WHERE id IN (
         SELECT id FROM sync_queue
         WHERE status = 'done'
         ORDER BY COALESCE(synced_at, created_at) DESC
         LIMIT -1 OFFSET ?
       )`,
    ).run(DONE_MAX_ROWS).changes;
    db.exec('COMMIT;');
  } catch (err) {
    try { db.exec('ROLLBACK;'); } catch {}
    state.lastError = err.message;
    throw err;
  }
  lastPruneMs = Date.now();
  return removed;
}

function maybePruneDoneQueue(force = false) {
  if (!force && Date.now() - lastPruneMs < PRUNE_INTERVAL_MS) return 0;
  try {
    return pruneDoneQueue();
  } catch (err) {
    logger.warn('sync prune done queue failed', { message: err.message });
    return 0;
  }
}

function pendingEvents(branchId = 'sala', limit = 12) {
  try {
    return db.prepare(
      `SELECT kind AS action, ref AS detail, created_at
       FROM sync_queue WHERE branch_id = ?
       ORDER BY created_at DESC LIMIT ?`,
    ).all(branchId, limit);
  } catch {
    return [];
  }
}

export function status(branchId = 'sala') {
  const configured = !!transportConfig();
  return {
    online: !state.offline && state.upstreamReachable !== false,
    syncAvailable: configured,
    syncMode: configured ? 'edge-acknowledged' : 'local-outbox-only',
    pending: pendingCount(branchId),
    localOnlyMarkers: localOnlyCount(branchId),
    doneRetained: doneCount(branchId),
    lastSyncAt: state.lastSyncAt,
    lastCataloguePullAt: state.lastCataloguePullAt,
    lastCatalogueHash: state.lastCatalogueHash,
    lastError: state.lastError,
    recent: pendingEvents(branchId),
  };
}

export function isStoreOffline() {
  return state.offline || (!!transportConfig() && state.upstreamReachable === false);
}

export function setOffline(offline, branchId = 'sala') {
  state.offline = !!offline;
  emit('sync:status', status(branchId), branchId);
  return status(branchId);
}

export async function syncNow(branchId = 'sala') {
  if (state.offline) {
    const error = new Error('Store is offline; changes remain safely pending in the local outbox.');
    error.code = 'STORE_OFFLINE';
    throw error;
  }
  if (!transportConfig()) {
    state.lastError = TRANSPORT_NOT_CONFIGURED;
    emit('sync:status', status(branchId), branchId);
    const error = new Error(TRANSPORT_NOT_CONFIGURED);
    error.code = 'SYNC_TRANSPORT_NOT_CONFIGURED';
    throw error;
  }
  let total = 0;
  let synced;
  do {
    synced = await syncBatch(branchId);
    total += synced;
  } while (synced > 0);
  let catalogue;
  try {
    catalogue = await pullCatalogueSnapshot(branchId, transportConfig());
  } catch (error) {
    state.lastError = String(error?.message || error).slice(0, 500);
    throw error;
  }
  maybePruneDoneQueue(true);
  emit('sync:status', status(branchId), branchId);
  return { ...status(branchId), synced: total, catalogue };
}

async function pullCatalogueSnapshot(branchId, config) {
  if (!config) throw new Error(TRANSPORT_NOT_CONFIGURED);
  const requestBody = { hubId: config.hubId, branchId };
  const timestamp = String(Date.now());
  const url = new URL('/api/sync/edge/catalogue', config.url);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-edge-sync-timestamp': timestamp,
      'x-edge-sync-signature': edgeSignature(config.secret, timestamp, requestBody),
    },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(20_000),
  });
  const declaredBytes = Number(response.headers.get('content-length') || 0);
  if (declaredBytes > MAX_CATALOGUE_SNAPSHOT_BYTES) throw new Error('Catalogue snapshot exceeds 50MB');
  const responseText = await response.text();
  if (Buffer.byteLength(responseText) > MAX_CATALOGUE_SNAPSHOT_BYTES) throw new Error('Catalogue snapshot exceeds 50MB');
  let snapshot = null;
  try { snapshot = JSON.parse(responseText); } catch {}
  if (!response.ok || !snapshot?.hash) throw new Error(`Catalogue pull failed (${response.status})`);
  const applied = applyCatalogueSnapshot(snapshot, branchId);
  state.lastCataloguePullAt = new Date().toISOString();
  state.lastCatalogueHash = snapshot.hash;
  return applied;
}

// Background work only prunes rows that a real transport previously ACKed.
let timer = null;
let engineRunning = false;
export function startSyncEngine(branchId = 'sala') {
  if (timer) return;
  maybePruneDoneQueue(true);
  timer = setInterval(async () => {
    if (state.offline || engineRunning) return;
    engineRunning = true;
    try {
      const config = transportConfig();
      const synced = config ? await syncBatch(branchId) : 0;
      const catalogueDue = config && pendingCount(branchId) === 0 && (
        synced > 0 || !state.lastCataloguePullAt ||
        Date.now() - Date.parse(state.lastCataloguePullAt) >= CATALOGUE_PULL_INTERVAL_MS
      );
      if (catalogueDue) await pullCatalogueSnapshot(branchId, config);
      const pruned = maybePruneDoneQueue();
      if (synced > 0 || pruned > 0) emit('sync:status', status(branchId), branchId);
    } catch (error) {
      state.lastError = String(error?.message || error).slice(0, 500);
      logger.warn('edge sync batch failed', { message: error.message });
    } finally {
      engineRunning = false;
    }
  }, 6000);
  timer.unref?.();
}
