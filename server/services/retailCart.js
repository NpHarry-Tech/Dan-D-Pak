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
if (!db.prepare(`PRAGMA table_info(retail_carts)`).all().some(c => c.name === 'version')) {
  db.exec(`ALTER TABLE retail_carts ADD COLUMN version INTEGER NOT NULL DEFAULT 1;`);
}
db.exec(`CREATE TABLE IF NOT EXISTS retail_cart_presence (
  branch_id TEXT NOT NULL,
  slot INTEGER NOT NULL,
  device TEXT NOT NULL,
  actor TEXT,
  last_seen TEXT NOT NULL,
  PRIMARY KEY(branch_id,slot,device)
);
CREATE INDEX IF NOT EXISTS idx_retail_cart_presence_seen
  ON retail_cart_presence(branch_id,slot,last_seen);`);

// ── GIỎ DO KHÁCH TỰ CHỌN TRÊN MÁY CATALOGUE ─────────────────────────────────
// Ba trường dưới đây là thứ phân biệt giỏ của KHÁCH với giỏ do nhân viên bấm:
//
//   origin       'catalogue' = khách tự thêm trên máy tablet đặt ngoài quầy.
//   device_name  Tên máy đó (VD "Quầy trước", "Kệ hạt điều"). Thu ngân nhìn
//                tên là biết chạy tới đâu, thay cho nhãn vô nghĩa "Hóa đơn 03".
//   pay_requested Khách đã bấm thanh toán và đang đứng chờ. POS tô ĐỎ tab đó.
//
// Cố ý KHÔNG gửi thông báo/chuông: cửa hàng có nhân viên đứng quầy, một tab đổi
// màu là đủ. Thêm thông báo chỉ tạo tiếng ồn giữa ca đông khách.
const ORIGINS = new Set(['staff', 'catalogue']);

// ── DISPLAY SEQUENCE (Step 2 multi-device P0) ────────────────────────────────
// "Hóa đơn N" chỉ là NHÃN HIỂN THỊ, do SERVER cấp ATOMIC theo branch — client
// TUYỆT ĐỐI không tự sinh (tabs.length+1 gây "hai Hóa đơn 1" khác nội dung trên
// hai thiết bị). Monotonic, KHÔNG reuse số đã huỷ. Reset khi sang ngày business
// để số không phình mãi (nghiệp vụ POS quen đánh số theo ngày).
db.exec(`CREATE TABLE IF NOT EXISTS retail_display_sequence (
  branch_id TEXT NOT NULL,
  business_date TEXT NOT NULL,
  next_seq INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(branch_id, business_date)
);`);

/**
 * Cấp số hiển thị kế tiếp cho một branch trong ngày business.
 * ATOMIC: node:sqlite chạy đồng bộ đơn luồng nên read→increment không xen kẽ
 * giữa các request; bọc BEGIN IMMEDIATE để bền vững + an toàn nếu sau này đa
 * tiến trình. 2–10 thiết bị tạo draft đồng thời KHÔNG BAO GIỜ nhận cùng số.
 */
export function allocateDisplaySequence(branch_id = 'sala', businessDate = null) {
  const bd = String(businessDate || now().slice(0, 10));
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`INSERT INTO retail_display_sequence(branch_id,business_date,next_seq)
      VALUES(?,?,1) ON CONFLICT(branch_id,business_date) DO NOTHING`).run(branch_id, bd);
    const row = db.prepare(`SELECT next_seq FROM retail_display_sequence
      WHERE branch_id=? AND business_date=?`).get(branch_id, bd);
    const seq = Number(row.next_seq);
    db.prepare(`UPDATE retail_display_sequence SET next_seq=next_seq+1
      WHERE branch_id=? AND business_date=?`).run(branch_id, bd);
    db.exec('COMMIT');
    return { display_sequence: seq, business_date: bd };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function safeText(v, max = 120) {
  return String(v ?? '').trim().slice(0, max);
}

// Chuẩn hoá snapshot đọc từ DB về đúng shape client cần (chống JSON hỏng).
function safeSnap(json) {
  try {
    const s = JSON.parse(json || '{}');
    return {
      lines: Array.isArray(s.lines) ? s.lines : [],
      customer: s.customer || null,
      order_voucher_id: s.order_voucher_id || null,
      manual_discount: parseInt(s.manual_discount) || 0,
      note: safeText(s.note, 1000),
      origin: ORIGINS.has(s.origin) ? s.origin : 'staff',
      device_name: safeText(s.device_name),
      pay_requested: s.pay_requested === true,
      pay_method: safeText(s.pay_method, 40),
    };
  } catch {
    return {
      lines: [], customer: null, order_voucher_id: null, manual_discount: 0,
      note: '', origin: 'staff', device_name: '', pay_requested: false, pay_method: '',
    };
  }
}

function isEmpty(snap) {
  const lines = Array.isArray(snap?.lines) ? snap.lines : [];
  return lines.length === 0 && !snap?.customer && !snap?.order_voucher_id;
}

export function listCarts(branch_id = 'sala') {
  prunePresence();
  const devices = db.prepare(`SELECT slot,device,actor,last_seen FROM retail_cart_presence
    WHERE branch_id=? ORDER BY last_seen DESC`).all(branch_id);
  const bySlot = new Map();
  for (const row of devices) {
    if (!bySlot.has(row.slot)) bySlot.set(row.slot, []);
    bySlot.get(row.slot).push(row);
  }
  return db.prepare(`SELECT slot, snapshot_json, updated_at, updated_by, device, version
      FROM retail_carts WHERE branch_id=? ORDER BY slot`).all(branch_id)
    .map(r => ({ slot: r.slot, updated_at: r.updated_at, updated_by: r.updated_by,
      device: r.device, version: r.version || 1, active_devices: bySlot.get(r.slot) || [],
      ...safeSnap(r.snapshot_json) }));
}

/** Đọc snapshot giỏ của một ô (slot). Dùng cho catalogue checkout đọc lại giỏ. */
export function getCart(branch_id, slot) {
  const row = db.prepare(`SELECT snapshot_json FROM retail_carts WHERE branch_id=? AND slot=?`)
    .get(branch_id, Number(slot));
  return row ? safeSnap(row.snapshot_json) : {};
}

export function saveCart(branch_id, slot, snapshot, { actor = 'system', device = '', expectedVersion = null } = {}) {
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
    note: safeText(snap.note, 1000),
    origin: ORIGINS.has(snap.origin) ? snap.origin : 'staff',
    device_name: safeText(snap.device_name),
    pay_requested: snap.pay_requested === true,
    pay_method: safeText(snap.pay_method, 40),
  }).slice(0, 300000);
  const ts = now();
  const current = db.prepare(`SELECT version FROM retail_carts WHERE branch_id=? AND slot=?`).get(branch_id, s);
  if (expectedVersion != null && current && Number(expectedVersion) !== Number(current.version)) {
    const error = new Error('Giỏ đã được thiết bị khác cập nhật. Đã tải phiên bản mới nhất; vui lòng kiểm tra trước khi thao tác tiếp.');
    error.status = 409;
    error.code = 'CART_VERSION_CONFLICT';
    throw error;
  }
  const version = (Number(current?.version) || 0) + 1;
  db.prepare(`INSERT INTO retail_carts (branch_id,slot,snapshot_json,updated_at,updated_by,device,version)
      VALUES (?,?,?,?,?,?,?) ON CONFLICT(branch_id,slot) DO UPDATE SET
      snapshot_json=excluded.snapshot_json,updated_at=excluded.updated_at,
      updated_by=excluded.updated_by,device=excluded.device,version=excluded.version`)
    .run(branch_id, s, clean, ts, actor, device, version);
  touchCartPresence(branch_id, s, { actor, device });
  const payload = { slot: s, updated_at: ts, updated_by: actor, device, version,
    active_devices: activeDevices(branch_id, s), ...safeSnap(clean) };
  emit('retail:cart', payload, branch_id);
  return payload;
}

export function clearCart(branch_id, slot, { actor = 'system', device = '' } = {}) {
  const s = Number(slot);
  db.prepare(`DELETE FROM retail_carts WHERE branch_id=? AND slot=?`).run(branch_id, s);
  db.prepare(`DELETE FROM retail_cart_presence WHERE branch_id=? AND slot=?`).run(branch_id, s);
  const payload = { slot: s, cleared: true, updated_at: now(), updated_by: actor, device };
  emit('retail:cart', payload, branch_id);
  return payload;
}

const PRESENCE_SECONDS = 35;

function presenceCutoff() {
  return new Date(Date.now() - PRESENCE_SECONDS * 1000).toISOString();
}

function prunePresence() {
  return db.prepare(`DELETE FROM retail_cart_presence WHERE last_seen<?`)
    .run(presenceCutoff()).changes;
}

function activeDevices(branch_id, slot) {
  prunePresence();
  return db.prepare(`SELECT device,actor,last_seen FROM retail_cart_presence
    WHERE branch_id=? AND slot=? ORDER BY last_seen DESC`).all(branch_id, Number(slot));
}

export function touchCartPresence(branch_id, slot, { actor = 'system', device = '' } = {}) {
  const s = Number(slot);
  const d = safeText(device, 160);
  if (!Number.isInteger(s) || s < 1 || !d) throw new Error('Thiếu định danh thiết bị/giỏ để báo đang sử dụng');
  const ts = now();
  db.prepare(`INSERT INTO retail_cart_presence(branch_id,slot,device,actor,last_seen)
    VALUES (?,?,?,?,?) ON CONFLICT(branch_id,slot,device) DO UPDATE SET
    actor=excluded.actor,last_seen=excluded.last_seen`).run(branch_id, s, d, safeText(actor), ts);
  const payload = { slot: s, device: d, active_devices: activeDevices(branch_id, s) };
  emit('retail:presence', payload, branch_id);
  return payload;
}

export function leaveCartPresence(branch_id, slot, { device = '' } = {}) {
  const s = Number(slot);
  const d = safeText(device, 160);
  if (d) db.prepare(`DELETE FROM retail_cart_presence WHERE branch_id=? AND slot=? AND device=?`)
    .run(branch_id, s, d);
  const payload = { slot: s, device: d, active_devices: activeDevices(branch_id, s) };
  emit('retail:presence', payload, branch_id);
  return payload;
}

/**
 * Ô GIỎ HÀNG CỦA MỘT MÁY CATALOGUE.
 *
 * Máy tablet đặt ngoài quầy phải luôn ghi vào ĐÚNG MỘT ô của nó, không giành ô
 * với thu ngân và không nhảy ô giữa chừng. Quy tắc:
 *   1. Máy này đã có ô đang mở  -> dùng lại (khách quay lại vẫn thấy giỏ cũ).
 *   2. Chưa có                  -> lấy ô TRỐNG NHỎ NHẤT còn lại.
 *
 * Ghép theo `device` chứ không theo tên: cửa hàng đổi tên máy giữa ca thì giỏ
 * đang có hàng vẫn phải nằm nguyên chỗ cũ.
 */
export function claimCatalogueSlot(branch_id, { device = '', deviceName = '' } = {}) {
  const may = safeText(device);
  if (!may) throw new Error('Thiếu định danh thiết bị catalogue');

  const dangDung = db.prepare(
    `SELECT slot FROM retail_carts WHERE branch_id=? AND device=? ORDER BY slot LIMIT 1`)
    .get(branch_id, may);
  if (dangDung) return { slot: dangDung.slot, device: may, device_name: safeText(deviceName) };

  const dangCo = new Set(db.prepare(`SELECT slot FROM retail_carts WHERE branch_id=?`)
    .all(branch_id).map(r => r.slot));
  let slot = 1;
  while (dangCo.has(slot) && slot < 999) slot++;
  return { slot, device: may, device_name: safeText(deviceName) };
}

/**
 * Khách bấm "Thanh toán" trên máy catalogue → tô đỏ tab bên POS.
 * KHÔNG tự tạo đơn: nhân viên vẫn phải xác nhận và thu tiền như mọi giỏ khác.
 */
export function requestCataloguePayment(branch_id, slot, { method = '', device = '' } = {}) {
  const s = Number(slot);
  const row = db.prepare(`SELECT snapshot_json FROM retail_carts WHERE branch_id=? AND slot=?`)
    .get(branch_id, s);
  if (!row) throw new Error('Giỏ hàng không còn trên hệ thống');
  const snap = safeSnap(row.snapshot_json);
  if (!snap.lines.length) throw new Error('Giỏ hàng đang trống');
  return saveCart(branch_id, s,
    { ...snap, pay_requested: true, pay_method: safeText(method, 40) },
    { actor: 'catalogue', device });
}

// Dọn giỏ bỏ quên (>24h) để bảng không phình.
export function maintainRetailCarts({ hours = 24 } = {}) {
  try {
    const cutoff = new Date(Date.now() - hours * 3_600_000).toISOString();
    prunePresence();
    return db.prepare(`DELETE FROM retail_carts WHERE updated_at < ?`).run(cutoff).changes;
  } catch {
    return 0;
  }
}
