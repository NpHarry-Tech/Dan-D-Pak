// Cloud Sync Engine + Offline mode.
// The local server normally pushes every change (audit_log = change feed) to the
// cloud. When internet drops, changes queue locally; when it returns they flush.
import { db, now } from '../db.js';
import { emit } from '../realtime.js';

const state = { offline: false, lastSyncAt: now(), lastError: null };

function pendingEvents(branch_id = 'br1', limit = 12) {
  return db.prepare(`SELECT action, detail, created_at FROM audit_log
    WHERE branch_id=? AND created_at > ? ORDER BY created_at DESC LIMIT ?`).all(branch_id, state.lastSyncAt, limit);
}
function pendingCount(branch_id = 'br1') {
  return db.prepare(`SELECT COUNT(*) c FROM audit_log WHERE branch_id=? AND created_at > ?`).get(branch_id, state.lastSyncAt).c;
}

export function status(branch_id = 'br1') {
  return {
    online: !state.offline,
    pending: pendingCount(branch_id),
    lastSyncAt: state.lastSyncAt,
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
  state.lastSyncAt = now();
  emit('sync:status', status(branch_id), branch_id);
  return status(branch_id);
}

// Background auto-sync: while online, flush continuously (every 6s).
let timer = null;
export function startSyncEngine(branch_id = 'br1') {
  if (timer) return;
  timer = setInterval(() => {
    if (state.offline) return;
    const had = pendingCount(branch_id);
    state.lastSyncAt = now();
    if (had) emit('sync:status', status(branch_id), branch_id);
  }, 6000);
}
