// Cloud Sync Engine + Offline mode.
// The local server normally pushes every change (audit_log = change feed) to the
// cloud. When internet drops, changes queue locally; when it returns they flush.
import { db, now, migrate } from '../db.js';
import { emit } from '../realtime.js';
import { DatabaseSync } from 'node:sqlite';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { runtimePaths, DEVICE_ID } from '../config/paths.js';
import { env } from '../config/env.js';

const REPLICA_PATH = runtimePaths.syncReplica;

const state = { offline: false, lastSyncAt: now(), lastError: null };
let replicaDb = null;
const cachedStatements = {};
const DONE_QUEUE_RETENTION = Math.max(100, parseInt(process.env.SYNC_DONE_RETENTION || '500', 10) || 500);

export function getReplicaDb() {
  if (replicaDb) return replicaDb;
  try {
    mkdirSync(dirname(REPLICA_PATH), { recursive: true });
    replicaDb = new DatabaseSync(REPLICA_PATH);
    // Initialize replica schema
    migrate(replicaDb);
  } catch (err) {
    console.error('[sync] failed to initialize replica database:', err.message);
  }
  return replicaDb;
}

function fetchSourceRecord(table, ref) {
  try {
    if (table === 'app_settings') {
      const parts = ref.split(':');
      if (parts.length < 2) return null;
      const branch_id = parts[0];
      const key = parts.slice(1).join(':');
      return db.prepare(`SELECT * FROM app_settings WHERE branch_id = ? AND key = ?`).get(branch_id, key);
    }
    if (table === 'recipes') {
      const [menu_item_id, inventory_item_id] = ref.split(':');
      return db.prepare(`SELECT * FROM recipes WHERE menu_item_id = ? AND inventory_item_id = ?`).get(menu_item_id, inventory_item_id);
    }
    if (table === 'enterprise_storage') {
      const parts = ref.split(':');
      if (parts.length < 3) return null;
      const scope = parts[0];
      const scope_id = parts[1];
      const key = parts.slice(2).join(':');
      return db.prepare(`SELECT * FROM enterprise_storage WHERE scope = ? AND scope_id = ? AND key = ?`).get(scope, scope_id, key);
    }
    if (table === 'user_preferences') {
      const parts = ref.split(':');
      if (parts.length < 2) return null;
      const user_id = parts[0];
      const key = parts.slice(1).join(':');
      return db.prepare(`SELECT * FROM user_preferences WHERE user_id = ? AND key = ?`).get(user_id, key);
    }
    
    // Default lookup by singular 'id' primary key
    return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(ref);
  } catch (err) {
    console.warn(`[sync] failed to fetch source record for ${table}:${ref}:`, err.message);
    return null;
  }
}

function replicateRecord(replica, table, record) {
  const cols = Object.keys(record);
  if (cols.length === 0) return;
  const key = `${table}:${cols.join(',')}`;
  let stmt = cachedStatements[key];
  if (!stmt) {
    const placeholders = cols.map(() => '?').join(',');
    const sql = `INSERT OR REPLACE INTO ${table} (${cols.join(',')}) VALUES (${placeholders})`;
    stmt = replica.prepare(sql);
    cachedStatements[key] = stmt;
  }
  const vals = cols.map(c => {
    const val = record[c];
    if (val !== null && typeof val === 'object') return JSON.stringify(val);
    return val;
  });
  stmt.run(...vals);
}

function pruneDoneQueue(limit = DONE_QUEUE_RETENTION) {
  try {
    db.prepare(`
      DELETE FROM sync_queue
      WHERE status != 'pending'
        AND rowid NOT IN (
          SELECT rowid
          FROM sync_queue
          WHERE status != 'pending'
          ORDER BY created_at DESC
          LIMIT ?
        )
    `).run(limit);
  } catch (err) {
    console.warn('[sync] failed to prune completed sync_queue rows:', err.message);
  }
}

export function syncBatch(branch_id = 'br1') {
  if (state.offline) return 0;
  
  const replica = getReplicaDb();
  if (!replica) return 0;

  let pending;
  try {
    pending = db.prepare(`SELECT * FROM sync_queue WHERE status = 'pending' ORDER BY created_at ASC LIMIT 100`).all();
  } catch (err) {
    console.warn('[sync] failed to query sync_queue:', err.message);
    return 0;
  }

  if (pending.length === 0) return 0;

  let synced = 0;
  db.exec('BEGIN TRANSACTION;');
  try {
    for (const item of pending) {
      const record = fetchSourceRecord(item.kind, item.ref);
      if (record) {
        replicateRecord(replica, item.kind, record);
      }
      
      db.prepare(`UPDATE sync_queue SET status = 'done', synced_at = ? WHERE id = ?`)
        .run(now(), item.id);
      synced++;
    }
    db.exec('COMMIT;');
  } catch (err) {
    try {
      db.exec('ROLLBACK;');
    } catch {}
    console.error('[sync] batch replication failed:', err.message);
    state.lastError = err.message;
    throw err;
  }
  
  if (synced > 0) pruneDoneQueue();
  state.lastSyncAt = now();
  return synced;
}

function pendingCount(branch_id = 'br1') {
  try {
    return db.prepare(`SELECT COUNT(*) c FROM sync_queue WHERE status = 'pending'`).get().c;
  } catch {
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
    lastSyncAt: state.lastSyncAt,
    deviceId: DEVICE_ID,
    localReplicaPath: REPLICA_PATH,
    centralSync: {
      configured: !!env.CENTRAL_SYNC_URL,
      url: env.CENTRAL_SYNC_URL ? env.CENTRAL_SYNC_URL.replace(/\/+$/, '') : '',
      mode: env.CENTRAL_SYNC_URL ? 'ready-for-central-endpoint' : 'local-device-only',
    },
    recent: pendingEvents(branch_id),
  };
}

export function setOffline(offline, branch_id = 'br1') {
  state.offline = !!offline;
  emit('sync:status', status(branch_id), branch_id);
  return status(branch_id);
}

// Push pending changes to cloud. No-op (throws) while offline.
export function syncNow(branch_id = 'br1') {
  if (state.offline) throw new Error('Đang offline — chi nhánh sẽ sync bù khi có mạng lại');
  
  let totalSynced = 0;
  let count = 0;
  do {
    count = syncBatch(branch_id);
    totalSynced += count;
  } while (count > 0);

  state.lastSyncAt = now();
  emit('sync:status', status(branch_id), branch_id);
  return status(branch_id);
}

// Background auto-sync: while online, flush continuously (every 6s).
let timer = null;
export function startSyncEngine(branch_id = 'br1') {
  if (timer) return;
  
  // Try to initialize replica immediately on startup
  getReplicaDb();

  // Run initial sync on startup
  try {
    syncBatch(branch_id);
  } catch (err) {
    console.warn('[sync] startup sync failed:', err.message);
  }
  
  timer = setInterval(() => {
    if (state.offline) return;
    try {
      const synced = syncBatch(branch_id);
      if (synced > 0) {
        emit('sync:status', status(branch_id), branch_id);
      }
    } catch (err) {
      console.warn('[sync] background sync failed:', err.message);
    }
  }, 6000);
}
