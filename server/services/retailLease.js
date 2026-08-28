// Step 2 multi-device P0 — EDIT LEASE (single active writer).
//
// Một canonical order (order_id) chỉ có MỘT thiết bị được SỬA tại một thời điểm
// — KHÔNG collaborative editing. Lease có TTL + heartbeat (không giữ lock vô
// hạn). Máy khác muốn sửa khi đang có người giữ → nhận CẢNH BÁO (ai/máy nào
// đang giữ) và phải TAKEOVER theo policy (quyền retail.order.takeover / duyệt
// Quản lý). Takeover ATOMIC: thu hồi token cũ, phát order.lease.revoked.
//
// Khoá theo `resource` = canonical order_id (không phải display slot).
import { db, now } from '../db.js';
import { emit } from '../realtime.js';

db.exec(`CREATE TABLE IF NOT EXISTS retail_edit_lease (
  branch_id TEXT NOT NULL,
  resource TEXT NOT NULL,
  device TEXT NOT NULL,
  user_id TEXT,
  user_name TEXT,
  lease_token TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  heartbeat_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY(branch_id, resource)
);`);

export const LEASE_TTL_MS = 30_000; // 30s; client heartbeat ~10s.

function token() {
  return `lease_${now().replace(/[^0-9]/g, '')}_${Math.floor(Math.random() * 1e9)}`;
}
function plus(iso, ms) { return new Date(Date.parse(iso) + ms).toISOString(); }
function isActive(row, at) { return row && Date.parse(row.expires_at) > Date.parse(at); }
function holderView(row) {
  return row && {
    device: row.device, user_id: row.user_id, user_name: row.user_name,
    acquired_at: row.acquired_at, expires_at: row.expires_at,
  };
}

/**
 * Xin lease để SỬA order (branch, resource=order_id).
 * - Không có / hết hạn → cấp lease mới.
 * - Chính device này → gia hạn (giữ token).
 * - Device KHÁC còn hạn → {granted:false, conflict:true, holder}.
 */
export function acquireLease(branch_id, resource, { device, user_id = '', user_name = '', ttlMs = LEASE_TTL_MS, at = now() } = {}) {
  const r = String(resource);
  if (!device) { const e = new Error('Thiếu định danh thiết bị để giữ quyền sửa'); e.status = 400; throw e; }
  if (!r) { const e = new Error('Thiếu order_id để giữ quyền sửa'); e.status = 400; throw e; }
  db.exec('BEGIN IMMEDIATE');
  try {
    const cur = db.prepare(`SELECT * FROM retail_edit_lease WHERE branch_id=? AND resource=?`).get(branch_id, r);
    if (isActive(cur, at) && cur.device !== device) {
      db.exec('COMMIT');
      return { granted: false, conflict: true, holder: holderView(cur) };
    }
    const tok = (cur && cur.device === device && isActive(cur, at)) ? cur.lease_token : token();
    const acquired = (cur && cur.device === device) ? cur.acquired_at : at;
    const expires = plus(at, ttlMs);
    db.prepare(`INSERT INTO retail_edit_lease
        (branch_id,resource,device,user_id,user_name,lease_token,acquired_at,heartbeat_at,expires_at)
        VALUES(?,?,?,?,?,?,?,?,?)
        ON CONFLICT(branch_id,resource) DO UPDATE SET
          device=excluded.device,user_id=excluded.user_id,user_name=excluded.user_name,
          lease_token=excluded.lease_token,acquired_at=excluded.acquired_at,
          heartbeat_at=excluded.heartbeat_at,expires_at=excluded.expires_at`)
      .run(branch_id, r, device, user_id, user_name, tok, acquired, at, expires);
    db.exec('COMMIT');
    emit('retail:lease', { order_id: r, holder: { device, user_id, user_name, expires_at: expires } }, branch_id);
    return { granted: true, lease_token: tok, expires_at: expires, order_id: r };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** Gia hạn lease. Token sai/không còn giữ → 409 EDIT_LEASE_LOST. */
export function heartbeatLease(branch_id, resource, { device, lease_token, ttlMs = LEASE_TTL_MS, at = now() } = {}) {
  const r = String(resource);
  const cur = db.prepare(`SELECT * FROM retail_edit_lease WHERE branch_id=? AND resource=?`).get(branch_id, r);
  if (!cur || cur.device !== device || cur.lease_token !== lease_token || !isActive(cur, at)) {
    const e = new Error('Quyền sửa đã mất (thiết bị khác đã tiếp quản hoặc hết hạn).');
    e.status = 409; e.code = 'EDIT_LEASE_LOST';
    throw e;
  }
  const expires = plus(at, ttlMs);
  db.prepare(`UPDATE retail_edit_lease SET heartbeat_at=?,expires_at=? WHERE branch_id=? AND resource=?`)
    .run(at, expires, branch_id, r);
  return { ok: true, expires_at: expires };
}

/** Kiểm tra device có đang giữ lease hợp lệ không (dùng trong transaction command). */
export function assertLeaseHeld(branch_id, resource, { device, lease_token, at = now() } = {}) {
  const cur = db.prepare(`SELECT * FROM retail_edit_lease WHERE branch_id=? AND resource=?`).get(branch_id, String(resource));
  if (!cur || cur.device !== device || cur.lease_token !== lease_token || !isActive(cur, at)) {
    const e = new Error('Quyền sửa đã mất (thiết bị khác đã tiếp quản hoặc hết hạn).');
    e.status = 409; e.code = 'EDIT_LEASE_LOST';
    throw e;
  }
  return true;
}

export function releaseLease(branch_id, resource, { device, lease_token } = {}) {
  const r = String(resource);
  const cur = db.prepare(`SELECT * FROM retail_edit_lease WHERE branch_id=? AND resource=?`).get(branch_id, r);
  if (cur && cur.device === device && cur.lease_token === lease_token) {
    db.prepare(`DELETE FROM retail_edit_lease WHERE branch_id=? AND resource=?`).run(branch_id, r);
    emit('retail:lease', { order_id: r, holder: null }, branch_id);
  }
  return { ok: true };
}

/**
 * TIẾP QUẢN quyền sửa (ATOMIC). Route phải chặn quyền retail.order.takeover /
 * duyệt Quản lý TRƯỚC. Thu hồi token cũ → device cũ heartbeat nhận
 * EDIT_LEASE_LOST; phát order.lease.revoked.
 */
export function takeoverLease(branch_id, resource, { device, user_id = '', user_name = '', ttlMs = LEASE_TTL_MS, at = now() } = {}) {
  const r = String(resource);
  if (!device) { const e = new Error('Thiếu định danh thiết bị tiếp quản'); e.status = 400; throw e; }
  db.exec('BEGIN IMMEDIATE');
  try {
    const prev = db.prepare(`SELECT * FROM retail_edit_lease WHERE branch_id=? AND resource=?`).get(branch_id, r);
    const tok = token();
    const expires = plus(at, ttlMs);
    db.prepare(`INSERT INTO retail_edit_lease
        (branch_id,resource,device,user_id,user_name,lease_token,acquired_at,heartbeat_at,expires_at)
        VALUES(?,?,?,?,?,?,?,?,?)
        ON CONFLICT(branch_id,resource) DO UPDATE SET
          device=excluded.device,user_id=excluded.user_id,user_name=excluded.user_name,
          lease_token=excluded.lease_token,acquired_at=excluded.acquired_at,
          heartbeat_at=excluded.heartbeat_at,expires_at=excluded.expires_at`)
      .run(branch_id, r, device, user_id, user_name, tok, at, at, expires);
    db.exec('COMMIT');
    if (prev && prev.device !== device) {
      emit('order.lease.revoked', { order_id: r, revoked_device: prev.device, by: { device, user_id, user_name } }, branch_id);
    }
    emit('retail:lease', { order_id: r, holder: { device, user_id, user_name, expires_at: expires } }, branch_id);
    return { granted: true, lease_token: tok, expires_at: expires, order_id: r, revoked: holderView(prev) };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function leaseStatus(branch_id, resource, { at = now() } = {}) {
  const cur = db.prepare(`SELECT * FROM retail_edit_lease WHERE branch_id=? AND resource=?`).get(branch_id, String(resource));
  return isActive(cur, at) ? holderView(cur) : null;
}
