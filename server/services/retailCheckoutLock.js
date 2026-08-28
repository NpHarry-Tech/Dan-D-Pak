// Step 2 multi-device P0 — CHECKOUT LOCK (mạnh hơn edit lease). Khoá theo
// `resource` = canonical order_id.
//
// OPEN → CHECKOUT_LOCKED → PAYMENT_PENDING → PAID. Ngay khi checkout bắt đầu:
// KHÔNG thiết bị nào được sửa cart, takeover BỊ CẤM, A/C thấy "Đang thanh toán
// tại POS…". Hai thiết bị checkout đồng thời → CHỈ MỘT thắng; kia nhận 409
// ORDER_ALREADY_CHECKING_OUT (hoặc CÙNG kết quả nếu trùng idempotency). PAID
// TERMINAL IMMUTABLE — mutation sau PAID → 409 ORDER_FINALIZED.
import { db, now } from '../db.js';
import { emit } from '../realtime.js';

db.exec(`CREATE TABLE IF NOT EXISTS retail_checkout_lock (
  branch_id TEXT NOT NULL,
  resource TEXT NOT NULL,
  device TEXT NOT NULL,
  user_id TEXT,
  user_name TEXT,
  idempotency_key TEXT,
  status TEXT NOT NULL DEFAULT 'locked',
  order_id TEXT,
  locked_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY(branch_id, resource)
);`);

export const CHECKOUT_LOCK_TTL_MS = 120_000; // 2 phút (chờ QR/đối soát).

function plus(iso, ms) { return new Date(Date.parse(iso) + ms).toISOString(); }
function active(row, at) { return row && row.status === 'locked' && Date.parse(row.expires_at) > Date.parse(at); }
function holder(row) {
  return row && { device: row.device, user_id: row.user_id, user_name: row.user_name, status: row.status, locked_at: row.locked_at };
}

export function acquireCheckoutLock(branch_id, resource, { device, user_id = '', user_name = '', idempotency_key = '', order_id = '', ttlMs = CHECKOUT_LOCK_TTL_MS, at = now() } = {}) {
  const r = String(resource);
  if (!device) { const e = new Error('Thiếu định danh thiết bị để thanh toán'); e.status = 400; throw e; }
  db.exec('BEGIN IMMEDIATE');
  try {
    const cur = db.prepare(`SELECT * FROM retail_checkout_lock WHERE branch_id=? AND resource=?`).get(branch_id, r);
    if (cur && cur.status === 'paid') {
      db.exec('COMMIT');
      const e = new Error('Hóa đơn đã được thanh toán — không thể thao tác tiếp.');
      e.status = 409; e.code = 'ORDER_FINALIZED'; e.holder = holder(cur);
      throw e;
    }
    const sameAttempt = cur && idempotency_key && cur.idempotency_key === idempotency_key;
    if (active(cur, at) && cur.device !== device && !sameAttempt) {
      db.exec('COMMIT');
      const e = new Error('Đơn đang được thanh toán ở thiết bị khác.');
      e.status = 409; e.code = 'ORDER_ALREADY_CHECKING_OUT'; e.holder = holder(cur);
      throw e;
    }
    if (sameAttempt) {
      db.exec('COMMIT');
      return { granted: true, idempotent: true, expires_at: cur.expires_at, order_id: r };
    }
    const expires = plus(at, ttlMs);
    db.prepare(`INSERT INTO retail_checkout_lock
        (branch_id,resource,device,user_id,user_name,idempotency_key,status,order_id,locked_at,expires_at)
        VALUES(?,?,?,?,?,?,'locked',?,?,?)
        ON CONFLICT(branch_id,resource) DO UPDATE SET
          device=excluded.device,user_id=excluded.user_id,user_name=excluded.user_name,
          idempotency_key=excluded.idempotency_key,status='locked',order_id=excluded.order_id,
          locked_at=excluded.locked_at,expires_at=excluded.expires_at`)
      .run(branch_id, r, device, user_id, user_name, idempotency_key, order_id || r, at, expires);
    db.exec('COMMIT');
    emit('order.checkout.locked', { order_id: r, holder: { device, user_id, user_name } }, branch_id);
    return { granted: true, expires_at: expires, order_id: r };
  } catch (err) {
    if (err.code !== 'ORDER_FINALIZED' && err.code !== 'ORDER_ALREADY_CHECKING_OUT') {
      try { db.exec('ROLLBACK'); } catch { /* đã COMMIT ở nhánh 409 */ }
    }
    throw err;
  }
}

export function markCheckoutPaid(branch_id, resource, { device = '', order_id = '', bill_no = '', at = now() } = {}) {
  const r = String(resource);
  db.prepare(`INSERT INTO retail_checkout_lock
      (branch_id,resource,device,status,order_id,locked_at,expires_at)
      VALUES(?,?,?,'paid',?,?,?)
      ON CONFLICT(branch_id,resource) DO UPDATE SET
        status='paid',order_id=COALESCE(excluded.order_id,retail_checkout_lock.order_id),
        expires_at=excluded.expires_at`)
    .run(branch_id, r, device, order_id || r, at, at);
  emit('order.paid', { order_id: order_id || r, resource: r, bill_no, device, at }, branch_id);
  return { ok: true, status: 'paid' };
}

export function releaseCheckoutLock(branch_id, resource, { device = '' } = {}) {
  const r = String(resource);
  const cur = db.prepare(`SELECT * FROM retail_checkout_lock WHERE branch_id=? AND resource=?`).get(branch_id, r);
  if (cur && cur.status !== 'paid' && (!device || cur.device === device)) {
    db.prepare(`DELETE FROM retail_checkout_lock WHERE branch_id=? AND resource=?`).run(branch_id, r);
    emit('order.checkout.unlocked', { order_id: r }, branch_id);
  }
  return { ok: true };
}

export function assertNotCheckingOut(branch_id, resource, { at = now() } = {}) {
  const cur = db.prepare(`SELECT * FROM retail_checkout_lock WHERE branch_id=? AND resource=?`).get(branch_id, String(resource));
  if (cur && cur.status === 'paid') {
    const e = new Error('Hóa đơn đã thanh toán — không thể sửa.');
    e.status = 409; e.code = 'ORDER_FINALIZED'; throw e;
  }
  if (active(cur, at)) {
    const e = new Error('Đơn đang thanh toán — tạm khoá chỉnh sửa.');
    e.status = 409; e.code = 'ORDER_ALREADY_CHECKING_OUT'; e.holder = holder(cur); throw e;
  }
}

export function checkoutLockStatus(branch_id, resource, { at = now() } = {}) {
  const cur = db.prepare(`SELECT * FROM retail_checkout_lock WHERE branch_id=? AND resource=?`).get(branch_id, String(resource));
  if (!cur) return null;
  if (cur.status === 'paid') return { status: 'paid', ...holder(cur) };
  return active(cur, at) ? { status: 'locked', ...holder(cur) } : null;
}
