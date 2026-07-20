// Giỏ hàng bán lẻ CHIA SẺ (sync đa thiết bị). Mỗi (chi nhánh, slot) là một giỏ
// ("Hóa đơn 01", 02…). Server chỉ LƯU + PHÁT LẠI snapshot JSON của giỏ để mọi thiết
// bị NHÂN VIÊN trong cùng chi nhánh thấy đúng cùng giỏ/khách/món TRƯỚC khi thanh toán.
// Đây KHÔNG phải đơn hàng thật — chỉ trở thành đơn khi gọi /retail/checkout (luồng cũ
// giữ nguyên). Snapshot chứa PII khách nên `retail:cart` chỉ phát cho room nhân viên
// (không nằm trong IPAD_EVENTS ở realtime.js).
import { db, now } from '../db.js';
import { emit } from '../realtime.js';

db.exec(`CREATE TABLE IF NOT EXISTS retail_carts (
  branch_id TEXT NOT NULL,
  slot INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL,
  updated_by TEXT,
  device TEXT,
  PRIMARY KEY(branch_id, slot)
);`);

// Chuẩn hoá snapshot đọc từ DB về đúng shape client cần (chống JSON hỏng).
function safeSnap(json) {
  try {
    const s = JSON.parse(json || '{}');
    return {
      lines: Array.isArray(s.lines) ? s.lines : [],
      customer: s.customer || null,
      order_voucher_id: s.order_voucher_id || null,
      manual_discount: parseInt(s.manual_discount) || 0,
    };
  } catch {
    return { lines: [], customer: null, order_voucher_id: null, manual_discount: 0 };
  }
}

function isEmpty(snap) {
  const lines = Array.isArray(snap?.lines) ? snap.lines : [];
  return lines.length === 0 && !snap?.customer && !snap?.order_voucher_id;
}

export function listCarts(branch_id = 'br1') {
  return db.prepare(`SELECT slot, snapshot_json, updated_at, updated_by, device
      FROM retail_carts WHERE branch_id=? ORDER BY slot`).all(branch_id)
    .map(r => ({ slot: r.slot, updated_at: r.updated_at, updated_by: r.updated_by, device: r.device, ...safeSnap(r.snapshot_json) }));
}

export function saveCart(branch_id, slot, snapshot, { actor = 'system', device = '' } = {}) {
  const s = Number(slot);
  if (!Number.isInteger(s) || s < 1 || s > 999) throw new Error('Slot giỏ hàng không hợp lệ');
  const snap = snapshot && typeof snapshot === 'object' ? snapshot : {};
  // Giỏ rỗng hoàn toàn → xóa hàng (đồng nghĩa clear) để không tích rác.
  if (isEmpty(snap)) return clearCart(branch_id, s, { actor, device });
  const clean = JSON.stringify({
    lines: Array.isArray(snap.lines) ? snap.lines.slice(0, 200) : [],
    customer: snap.customer || null,
    order_voucher_id: snap.order_voucher_id || null,
    manual_discount: parseInt(snap.manual_discount) || 0,
  }).slice(0, 300000);
  const ts = now();
  db.prepare(`INSERT OR REPLACE INTO retail_carts (branch_id,slot,snapshot_json,updated_at,updated_by,device)
      VALUES (?,?,?,?,?,?)`).run(branch_id, s, clean, ts, actor, device);
  const payload = { slot: s, updated_at: ts, updated_by: actor, device, ...safeSnap(clean) };
  emit('retail:cart', payload, branch_id);
  return payload;
}

export function clearCart(branch_id, slot, { actor = 'system', device = '' } = {}) {
  const s = Number(slot);
  db.prepare(`DELETE FROM retail_carts WHERE branch_id=? AND slot=?`).run(branch_id, s);
  const payload = { slot: s, cleared: true, updated_at: now(), updated_by: actor, device };
  emit('retail:cart', payload, branch_id);
  return payload;
}

// Dọn giỏ bỏ quên (>24h) để bảng không phình.
export function maintainRetailCarts({ hours = 24 } = {}) {
  try {
    const cutoff = new Date(Date.now() - hours * 3_600_000).toISOString();
    return db.prepare(`DELETE FROM retail_carts WHERE updated_at < ?`).run(cutoff).changes;
  } catch {
    return 0;
  }
}
