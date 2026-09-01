// Step 2 multi-device P0 — CANONICAL ORDER COMMAND SERVICE.
//
// Mọi mutation trên draft bán lẻ đi qua đây với HỢP ĐỒNG:
//   order_id (canonical) + lease_token + expected_revision + command_id.
// Server là nguồn sự thật: validate branch (cách ly tenant/branch) + lease hợp
// lệ + không đang checkout/paid + revision đúng → áp lệnh + revision++ trong
// CÙNG transaction. Sai lease → 409 EDIT_LEASE_LOST; sai revision → 409
// ORDER_VERSION_CONFLICT (+ canonical state); đã finalize → 409 ORDER_FINALIZED.
// command_id đảm bảo idempotency (retry KHÔNG áp 2 lần).
import { db, now } from '../db.js';
import { emit } from '../realtime.js';
import { allocateDisplaySequence } from './retailCart.js';
import { acquireLease, assertLeaseHeld } from './retailLease.js';
import { assertNotCheckingOut } from './retailCheckoutLock.js';
import { priceCart } from './retail.js';

db.exec(`CREATE TABLE IF NOT EXISTS retail_draft_order (
  order_id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  display_sequence INTEGER NOT NULL,
  business_date TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open',   -- open | checkout_locked | paid | void
  snapshot_json TEXT NOT NULL DEFAULT '{}',
  created_device TEXT, created_user TEXT, register_id TEXT, session_id TEXT,
  last_device TEXT, last_user TEXT,
  created_at TEXT, updated_at TEXT
);`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_retail_draft_branch ON retail_draft_order(branch_id, status);`);
db.exec(`CREATE TABLE IF NOT EXISTS retail_command_log (
  order_id TEXT NOT NULL,
  command_id TEXT NOT NULL,
  revision_after INTEGER,
  result_json TEXT,
  applied_at TEXT,
  PRIMARY KEY(order_id, command_id)
);`);

const COMMANDS = new Set(['ADD_LINE', 'CHANGE_QTY', 'REMOVE_LINE', 'SET_CUSTOMER', 'SET_NOTE',
  'APPLY_PROMOTION', 'REMOVE_PROMOTION', 'SET_MANUAL_DISCOUNT', 'SET_COMBOS']);

function newOrderId() {
  return `ord_${now().replace(/[^0-9]/g, '')}_${Math.floor(Math.random() * 1e9).toString(36)}`;
}
function emptySnap() {
  return {
    lines: [], customer: null, note: '', voucher_id: null,
    manual_discount: 0, selected_combos: null,
    priced_lines: [], pricing: { subtotal: 0, discount: 0, total: 0, appliedSkuPromos: [] }, total: 0,
  };
}
// §3 SERVER-AUTHORITATIVE: định giá canonical bằng ENGINE CHUNG (priceCart) —
// combo/promotion/voucher/giảm-tay/giá-kênh đều đúng, KHÔNG plain-sum. Giỏ rỗng
// → 0 (không gọi engine). Ném lỗi (SKU không tồn tại/ hết hàng) sẽ nổi lên đúng.
function recompute(snap, branch_id) {
  if (!snap.lines.length) {
    snap.priced_lines = [];
    snap.pricing = { subtotal: 0, discount: 0, total: 0, appliedSkuPromos: [] };
    snap.total = 0;
    return snap;
  }
  const priced = priceCart({
    items: snap.lines.map((l) => ({ sku_id: l.sku_id, qty: l.qty, lot_id: l.lot_id, price_override: l.price_override })),
    voucher_id: snap.voucher_id, customer: snap.customer,
    manual_discount: snap.manual_discount, selected_combos: snap.selected_combos,
  }, branch_id);
  // Gắn line_id (từ structural snap.lines) vào từng priced_line để CLIENT có thể
  // tham chiếu đúng dòng khi CHANGE_QTY/REMOVE_LINE. Match theo sku_id+lot_id
  // (đã dedup ở ADD_LINE nên duy nhất) — bền vững, không phụ thuộc thứ tự.
  const usedLineIds = new Set();
  snap.priced_lines = priced.lines.map((pl) => {
    const m = snap.lines.find((l) => l.sku_id === pl.sku_id
      && (l.lot_id || null) === (pl.lot_id || null)
      && (l.price_override ?? null) === (pl.price_override ?? null)
      && !usedLineIds.has(l.line_id));
    if (m) usedLineIds.add(m.line_id);
    return { ...pl, line_id: m ? m.line_id : null };
  });
  snap.pricing = {
    subtotal: priced.subtotal, discount: priced.discount, total: priced.total,
    lineDiscount: priced.lineDiscount, orderDiscount: priced.orderDiscount,
    appliedSkuPromos: priced.appliedSkuPromos,
  };
  snap.total = priced.total;
  return snap;
}

/** Tạo draft mới: cấp display_sequence ATOMIC + order_id canonical + lease cho device tạo. */
export function createDraft(branch_id, { device, user_id = '', user_name = '', register_id = '', session_id = '', business_date = null, at = now() } = {}) {
  if (!device) { const e = new Error('Thiếu device_id'); e.status = 400; throw e; }
  const { display_sequence, business_date: bd } = allocateDisplaySequence(branch_id, business_date);
  const id = newOrderId();
  const snap = emptySnap();
  db.prepare(`INSERT INTO retail_draft_order
      (order_id,branch_id,display_sequence,business_date,revision,status,snapshot_json,
       created_device,created_user,register_id,session_id,last_device,last_user,created_at,updated_at)
      VALUES(?,?,?,?,0,'open',?,?,?,?,?,?,?,?,?)`)
    .run(id, branch_id, display_sequence, bd, JSON.stringify(snap), device, user_id, register_id, session_id, device, user_id, at, at);
  const lease = acquireLease(branch_id, id, { device, user_id, user_name, at });
  emit('order.created', { order_id: id, display_sequence, revision: 0 }, branch_id);
  return {
    order_id: id, display_sequence, business_date: bd, revision: 0, status: 'open',
    register_id, session_id, lease_token: lease.lease_token, lease_expires_at: lease.expires_at, snapshot: snap,
  };
}

/** Trạng thái canonical từ server (dùng khi conflict/reconnect — KHÔNG replay local). */
export function getCanonical(branch_id, order_id) {
  const row = db.prepare(`SELECT * FROM retail_draft_order WHERE order_id=? AND branch_id=?`).get(order_id, branch_id);
  if (!row) { const e = new Error('Đơn không tồn tại ở chi nhánh này'); e.status = 404; e.code = 'ORDER_NOT_FOUND'; throw e; }
  return {
    order_id: row.order_id, branch_id: row.branch_id, display_sequence: row.display_sequence,
    revision: row.revision, status: row.status, snapshot: JSON.parse(row.snapshot_json),
  };
}

// STRUCTURAL mutation (không định giá ở đây). Giá do recompute()/priceCart() áp.
// ADD_LINE chỉ giữ sku_id + qty + lot_id + price_override — GIÁ do server áp
// (không tin unit_price client). price_override chỉ hiệu lực khi checkout xác
// thực PIN (như luồng hiện tại), ở draft chỉ để engine tính hiển thị.
function applyToSnap(command, payload, snap) {
  switch (command) {
    case 'ADD_LINE': {
      const sku_id = payload.sku_id;
      const qty = Math.max(1, Number(payload.qty) || 1);
      const lot_id = payload.lot_id || null;
      const price_override = (payload.price_override !== undefined && payload.price_override !== null && payload.price_override !== '')
        ? Number(payload.price_override) : null;
      if (!sku_id) { const e = new Error('Thiếu sku_id'); e.status = 400; throw e; }
      const ex = snap.lines.find(l => l.sku_id === sku_id && (l.lot_id || null) === lot_id && (l.price_override ?? null) === price_override);
      if (ex) ex.qty = Number(ex.qty) + qty;
      else snap.lines.push({ line_id: `ln_${snap.lines.length + 1}_${Math.floor(Math.random() * 1e6)}`, sku_id, qty, lot_id, price_override });
      break;
    }
    case 'CHANGE_QTY': {
      const l = snap.lines.find(x => x.line_id === payload.line_id);
      if (!l) { const e = new Error('Dòng hàng không tồn tại'); e.status = 400; throw e; }
      const q = Number(payload.qty);
      if (q <= 0) snap.lines = snap.lines.filter(x => x.line_id !== payload.line_id);
      else l.qty = q;
      break;
    }
    case 'REMOVE_LINE':
      snap.lines = snap.lines.filter(x => x.line_id !== payload.line_id);
      break;
    case 'SET_CUSTOMER': snap.customer = payload.customer || null; break;
    case 'SET_NOTE': snap.note = String(payload.note || '').slice(0, 1000); break;
    case 'APPLY_PROMOTION': snap.voucher_id = payload.voucher_id || null; break;
    case 'REMOVE_PROMOTION': snap.voucher_id = null; break;
    case 'SET_MANUAL_DISCOUNT': snap.manual_discount = Math.max(0, Number(payload.manual_discount) || 0); break;
    case 'SET_COMBOS': snap.selected_combos = Array.isArray(payload.selected_combos) ? payload.selected_combos : null; break;
  }
  return snap;
}

/** Áp một lệnh mutation theo đúng hợp đồng. */
export function applyCommand(branch_id, order_id, { command_id, expected_revision, lease_token, device, user_id = '', command, payload = {}, at = now() } = {}) {
  if (!command_id) { const e = new Error('Thiếu command_id (idempotency)'); e.status = 400; throw e; }
  if (!COMMANDS.has(command)) { const e = new Error(`Lệnh không hợp lệ: ${command}`); e.status = 400; throw e; }
  // Idempotent replay: cùng command_id đã áp → trả kết quả cũ, KHÔNG áp lại.
  const prior = db.prepare(`SELECT result_json FROM retail_command_log WHERE order_id=? AND command_id=?`).get(order_id, command_id);
  if (prior) return { ...JSON.parse(prior.result_json), idempotent: true };

  db.exec('BEGIN IMMEDIATE');
  try {
    const row = db.prepare(`SELECT * FROM retail_draft_order WHERE order_id=? AND branch_id=?`).get(order_id, branch_id);
    if (!row) { const e = new Error('Đơn không tồn tại ở chi nhánh này'); e.status = 404; e.code = 'ORDER_NOT_FOUND'; throw e; }
    if (row.status === 'paid' || row.status === 'void') { const e = new Error('Đơn đã kết thúc.'); e.status = 409; e.code = 'ORDER_FINALIZED'; throw e; }
    assertNotCheckingOut(branch_id, order_id, { at }); // 409 nếu đang checkout / đã paid
    assertLeaseHeld(branch_id, order_id, { device, lease_token, at }); // 409 EDIT_LEASE_LOST
    if (Number(expected_revision) !== Number(row.revision)) {
      const e = new Error('Bản sửa đã lạc hậu — tải lại trạng thái mới nhất.');
      e.status = 409; e.code = 'ORDER_VERSION_CONFLICT';
      e.canonical = { order_id, revision: row.revision, status: row.status, snapshot: JSON.parse(row.snapshot_json) };
      throw e;
    }
    const snap = recompute(applyToSnap(command, payload, JSON.parse(row.snapshot_json)), branch_id);
    const newRev = Number(row.revision) + 1;
    db.prepare(`UPDATE retail_draft_order SET snapshot_json=?,revision=?,last_device=?,last_user=?,updated_at=? WHERE order_id=?`)
      .run(JSON.stringify(snap), newRev, device, user_id, at, order_id);
    const result = { order_id, revision: newRev, status: row.status, snapshot: snap };
    db.prepare(`INSERT INTO retail_command_log (order_id,command_id,revision_after,result_json,applied_at) VALUES(?,?,?,?,?)`)
      .run(order_id, command_id, newRev, JSON.stringify(result), at);
    db.exec('COMMIT');
    emit('order.changed', { order_id, revision: newRev }, branch_id);
    return result;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* nếu chưa mở transaction */ }
    throw err;
  }
}

/** Đánh dấu draft đã thanh toán (gọi sau khi payment transaction thành công). */
export function markDraftPaid(branch_id, order_id, { at = now() } = {}) {
  db.prepare(`UPDATE retail_draft_order SET status='paid',updated_at=? WHERE order_id=? AND branch_id=?`).run(at, order_id, branch_id);
  return { ok: true };
}
