// Local sync status + offline mode.
// One live DB only: sync_queue stays in the main SQLite database. External sync
// is not enabled, so this service must not create a second database.
import { db, now } from '../db.js';
import { emit } from '../realtime.js';
import { logger } from '../core/logger.js';

const state = { offline: false, lastSyncAt: now(), lastError: null };
const DONE_RETENTION_DAYS = 7;
const DONE_MAX_ROWS = 1000;
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;
let lastPruneMs = 0;

export function syncBatch(branch_id = 'br1') {
  if (state.offline) return 0;

  let pending;
  try {
    pending = db.prepare(`SELECT * FROM sync_queue WHERE status = 'pending' ORDER BY created_at ASC LIMIT 100`).all();
  } catch (err) {
    logger.warn('sync failed to query sync_queue', { message: err.message });
    return 0;
  }

  if (pending.length === 0) return 0;

  // External write is intentionally disabled. Mark the local queue as
  // observed so it does not grow forever or create a fake second source of truth.
  db.exec('BEGIN TRANSACTION;');
  try {
    for (const item of pending) {
      db.prepare(`UPDATE sync_queue SET status = 'done', synced_at = ? WHERE id = ?`)
        .run(now(), item.id);
    }
    db.exec('COMMIT;');
  } catch (err) {
    try {
      db.exec('ROLLBACK;');
    } catch {}
    logger.error('sync batch flush failed', { message: err.message });
    state.lastError = err.message;
    throw err;
  }
  
  state.lastSyncAt = now();
  return pending.length;
}

function pendingCount(branch_id = 'br1') {
  try {
    return db.prepare(`SELECT COUNT(*) c FROM sync_queue WHERE status = 'pending'`).get().c;
  } catch {
    return 0;
  }
}

function doneCount() {
  try {
    return db.prepare(`SELECT COUNT(*) c FROM sync_queue WHERE status = 'done'`).get().c;
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
    try {
      db.exec('ROLLBACK;');
    } catch {}
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

function pendingEvents(branch_id = 'br1', limit = 12) {
  try {
    // Show recent events from sync_queue (both pending and completed) so the user gets real feedback
    return db.prepare(`SELECT kind as action, ref as detail, created_at FROM sync_queue ORDER BY created_at DESC LIMIT ?`).all(limit);
  } catch {
    return [];
  }
}

export function status(branch_id = 'br1') {
  return {
    online: !state.offline,
    pending: pendingCount(branch_id),
    doneRetained: doneCount(),
    lastSyncAt: state.lastSyncAt,
    recent: pendingEvents(branch_id),
  };
}

export function setOffline(offline, branch_id = 'br1') {
  state.offline = !!offline;
  emit('sync:status', status(branch_id), branch_id);
  return status(branch_id);
}

// Flush the local queue marker. No external DB is written.
export function syncNow(branch_id = 'br1') {
  if (state.offline) throw new Error('Đang offline - chi nhánh sẽ đồng bộ bù khi có mạng lại');
  
  let totalSynced = 0;
  let count = 0;
  do {
    count = syncBatch(branch_id);
    totalSynced += count;
  } while (count > 0);

  maybePruneDoneQueue(true);
  state.lastSyncAt = now();
  emit('sync:status', status(branch_id), branch_id);
  return status(branch_id);
}

// Background local queue cleanup.
let timer = null;
export function startSyncEngine(branch_id = 'br1') {
  if (timer) return;

  try {
    syncBatch(branch_id);
    maybePruneDoneQueue(true);
  } catch (err) {
    logger.warn('sync startup sync failed', { message: err.message });
  }
  
  timer = setInterval(() => {
    if (state.offline) return;
    try {
      const synced = syncBatch(branch_id);
      const pruned = maybePruneDoneQueue();
      if (synced > 0) {
        emit('sync:status', status(branch_id), branch_id);
      } else if (pruned > 0) {
        emit('sync:status', status(branch_id), branch_id);
      }
    } catch (err) {
      logger.warn('sync background sync failed', { message: err.message });
    }
  }, 6000);
}
