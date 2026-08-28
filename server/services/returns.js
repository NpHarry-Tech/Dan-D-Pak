// RETURN / REFUND — mô hình giao dịch trả hàng (STEP 3-4,7-10 + hardening).
//
// Nguyên tắc: bill đã thanh toán là BẤT BIẾN (§6) — KHÔNG xoá/void bill gốc. Mỗi
// lần trả tạo một RETURN record riêng liên kết về order gốc; hỗ trợ trả một phần
// (§8), disposition tồn kho (§9), hoàn tiền BÁM PHƯƠNG THỨC GỐC (mixed tender §4),
// idempotent (§29), branch/tenant-scoped, audit (§19). Chống over-return khi chạy
// đồng thời: validate + ghi trong CÙNG transaction (BEGIN IMMEDIATE serialize).
import { db, uid, now, audit } from '../db.js';
import { getOrder } from './orders.js';
import { returnSku } from './inventory.js';
import { reverseOrderPayments } from './payments.js';
import { emit } from '../realtime.js';

function err(message, status = 400, code = undefined) {
  const e = new Error(message); e.status = status; if (code) e.code = code; return e;
}

let ready = false;
function ensure() {
  if (ready) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS order_returns (
      id TEXT PRIMARY KEY,
      branch_id TEXT NOT NULL,
      original_order_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'completed',
      reason TEXT,
      refund_total INTEGER NOT NULL DEFAULT 0,
      refund_method TEXT,
      refund_breakdown_json TEXT,
      created_at TEXT NOT NULL,
      created_by TEXT,
      approved_by TEXT,
      correlation_id TEXT,
      idempotency_key TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_order_returns_idem
      ON order_returns(idempotency_key) WHERE idempotency_key IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_order_returns_order ON order_returns(original_order_id);
    CREATE INDEX IF NOT EXISTS idx_order_returns_branch ON order_returns(branch_id, created_at);
    CREATE TABLE IF NOT EXISTS order_return_items (
      id TEXT PRIMARY KEY,
      return_id TEXT NOT NULL,
      original_order_id TEXT NOT NULL,
      order_item_id TEXT,
      sku_id TEXT,
      name TEXT,
      qty INTEGER NOT NULL,
      unit_price INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      disposition TEXT NOT NULL DEFAULT 'restock',
      branch_id TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_order_return_items_ret ON order_return_items(return_id);
    CREATE INDEX IF NOT EXISTS idx_order_return_items_order ON order_return_items(original_order_id);
  `);
  ready = true;
}

// Số lượng ĐÃ trả theo từng order_item_id (đọc trong transaction để chống race).
function returnedQtyMap(order_id) {
  const rows = db.prepare(`SELECT order_item_id, COALESCE(SUM(qty),0) q
    FROM order_return_items WHERE original_order_id=? GROUP BY order_item_id`).all(order_id);
  const m = {};
  for (const r of rows) m[r.order_item_id] = Number(r.q || 0);
  return m;
}
export function returnedQtyByItem(order_id) { ensure(); return returnedQtyMap(order_id); }

// Số dư đã trả (tiền) cho order (mọi return completed).
function refundedTotal(order_id) {
  return Number(db.prepare(`SELECT COALESCE(SUM(refund_total),0) t FROM order_returns
    WHERE original_order_id=? AND status='completed'`).get(order_id).t || 0);
}

// Trạng thái trả của bill: none / partial / full (§5 reporting).
export function returnStatus(order_id) {
  ensure();
  const order = getOrder(order_id);
  if (!order) return 'none';
  const already = returnedQtyMap(order_id);
  const soldTotal = order.items.reduce((s, it) => s + Number(it.qty || 0), 0);
  const retTotal = Object.values(already).reduce((s, q) => s + q, 0);
  if (retTotal <= 0) return 'none';
  return retTotal >= soldTotal ? 'full' : 'partial';
}

export function listReturnsForOrder(order_id, branch_id = null) {
  ensure();
  const rows = branch_id
    ? db.prepare(`SELECT * FROM order_returns WHERE original_order_id=? AND branch_id=? ORDER BY created_at`).all(order_id, branch_id)
    : db.prepare(`SELECT * FROM order_returns WHERE original_order_id=? ORDER BY created_at`).all(order_id);
  return rows.map(r => ({
    ...r,
    refund_breakdown: (() => { try { return JSON.parse(r.refund_breakdown_json || '[]'); } catch { return []; } })(),
    items: db.prepare(`SELECT * FROM order_return_items WHERE return_id=?`).all(r.id),
  }));
}

// MIXED TENDER (§4): hoàn tiền BÁM số dư từng phương thức gốc, KHÔNG dùng dominant
// mù. Số dư ròng mỗi method = tổng payment_lines (đã trừ các bút toán hoàn trước).
// Cash → dòng âm method cash trong ca (giảm két đúng); card/transfer → không giảm két.
function tenderBalances(order_id) {
  return db.prepare(`
    SELECT pl.method, SUM(pl.amount) net
    FROM payment_lines pl JOIN payments p ON p.id=pl.payment_id
    WHERE p.order_id=? GROUP BY pl.method HAVING SUM(pl.amount) > 0`).all(order_id)
    .map(r => ({ method: r.method, net: Number(r.net || 0) }))
    .sort((a, b) => b.net - a.net);
}

function allocateRefund(order_id, amount, requestedMethod) {
  // Merchant chỉ định method cụ thể (khác 'original') → hoàn đúng method đó.
  if (requestedMethod && requestedMethod !== 'original') {
    return [{ method: requestedMethod, amount }];
  }
  const balances = tenderBalances(order_id);
  const alloc = [];
  let remaining = amount;
  for (const b of balances) {
    if (remaining <= 0) break;
    const take = Math.min(b.net, remaining);
    if (take > 0) { alloc.push({ method: b.method, amount: take }); remaining -= take; }
  }
  if (remaining > 0) { // dư (bù trừ làm tròn) → dồn về method lớn nhất, hoặc cash.
    const m = balances[0]?.method || 'cash';
    const found = alloc.find(a => a.method === m);
    if (found) found.amount += remaining; else alloc.push({ method: m, amount: remaining });
  }
  return alloc;
}

function recordRefund(order_id, amount, requestedMethod, reason, actor) {
  if (amount <= 0) return { alloc: [] };
  const alloc = allocateRefund(order_id, amount, requestedMethod);
  const latest = db.prepare(`SELECT shift_id FROM payments WHERE order_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1`).get(order_id);
  const paymentId = uid('pay_ret_');
  db.prepare(`INSERT INTO payments (id,order_id,shift_id,cashier,total,created_at) VALUES (?,?,?,?,?,?)`)
    .run(paymentId, order_id, latest?.shift_id || null, actor || 'system', -amount, now());
  const ins = db.prepare(`INSERT INTO payment_lines (id,payment_id,method,amount,tendered_amount,reference) VALUES (?,?,?,?,?,?)`);
  const ref = `Trả hàng: ${String(reason || '').trim()}`.slice(0, 250);
  for (const a of alloc) ins.run(uid('pl_ret_'), paymentId, a.method, -a.amount, -a.amount, ref);
  return { payment_id: paymentId, alloc };
}

/// Tạo giao dịch trả hàng. items rỗng ⇒ trả TOÀN BỘ phần còn lại.
/// items: [{ order_item_id, qty, disposition:'restock'|'damaged' }]
export function createReturn(order_id, {
  items = null, reason = '', refund_method = 'original',
  branch_id = 'sala', actor = 'system', approved_by = null, idempotency_key = null,
} = {}) {
  ensure();
  const order = getOrder(order_id);
  if (!order) throw err('Đơn không tồn tại', 404);
  if (order.branch_id !== branch_id) throw err('Đơn không thuộc chi nhánh này', 403); // branch scope
  if (order.status !== 'paid') throw err('Chỉ trả hàng cho bill đã thanh toán', 400);

  if (idempotency_key) {
    const ex = db.prepare(`SELECT id,refund_total FROM order_returns WHERE idempotency_key=?`).get(idempotency_key);
    if (ex) return { ok: true, return_id: ex.id, refund_total: ex.refund_total, idempotent: true };
  }

  const byId = new Map(order.items.map(it => [it.id, it]));

  db.prepare('BEGIN IMMEDIATE').run();
  try {
    // Idempotency re-check TRONG lock (một request song song đã tạo trước đó).
    if (idempotency_key) {
      const ex = db.prepare(`SELECT id,refund_total FROM order_returns WHERE idempotency_key=?`).get(idempotency_key);
      if (ex) { db.prepare('COMMIT').run(); return { ok: true, return_id: ex.id, refund_total: ex.refund_total, idempotent: true }; }
    }
    // §3 chống over-return khi song song: đọc số đã trả TRONG transaction.
    const already = returnedQtyMap(order_id);
    const src = (Array.isArray(items) && items.length)
      ? items
      : order.items.map(it => ({ order_item_id: it.id, qty: Number(it.qty) - (already[it.id] || 0), disposition: 'restock' }));

    const lines = [];
    for (const reqLine of src) {
      const it = byId.get(reqLine.order_item_id);
      if (!it) throw err('Dòng món không thuộc đơn: ' + reqLine.order_item_id, 400);
      const remaining = Number(it.qty) - (already[it.id] || 0);
      const wanted = Number(reqLine.qty) || 0;
      if (wanted <= 0) continue;
      if (wanted > remaining) throw err(`Trả vượt số đã bán: ${it.name} (còn ${remaining})`, 400); // §8
      lines.push({
        it, qty: wanted,
        disposition: reqLine.disposition === 'damaged' ? 'damaged' : 'restock',
        amount: wanted * Number(it.unit_price || 0),
      });
    }
    if (!lines.length) throw err('Không có món hợp lệ để trả (có thể đã trả hết).', 400);

    const refund_total = lines.reduce((s, l) => s + l.amount, 0);
    if (refundedTotal(order_id) + refund_total > Number(order.total || 0) + 0.5) {
      throw err('Hoàn vượt số tiền đã thanh toán của bill', 400); // §10
    }

    const noPriorReturns = Object.keys(already).length === 0;
    const coversAllFully = order.items.every(it => {
      const l = lines.find(x => x.it.id === it.id);
      return (l ? l.qty : 0) >= Number(it.qty);
    });
    const isFullExact = noPriorReturns && coversAllFully;

    const rid = uid('ret_');
    // Hoàn tiền TRƯỚC để có breakdown lưu vào return record.
    let breakdown = [];
    if (isFullExact) {
      reverseOrderPayments(order_id, reason, actor); // đảo đúng tender gốc (chính xác)
      breakdown = tenderBalancesSnapshot(order_id, refund_total);
    } else {
      breakdown = recordRefund(order_id, refund_total, refund_method, reason, actor).alloc;
    }

    db.prepare(`INSERT INTO order_returns
      (id,branch_id,original_order_id,status,reason,refund_total,refund_method,refund_breakdown_json,created_at,created_by,approved_by,idempotency_key)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(rid, branch_id, order_id, 'completed', reason, refund_total,
        refund_method, JSON.stringify(breakdown), now(), actor, approved_by, idempotency_key);

    const insItem = db.prepare(`INSERT INTO order_return_items
      (id,return_id,original_order_id,order_item_id,sku_id,name,qty,unit_price,amount,disposition,branch_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    for (const l of lines) {
      insItem.run(uid('reti_'), rid, order_id, l.it.id, l.it.sku_id || null, l.it.name,
        l.qty, Number(l.it.unit_price || 0), l.amount, l.disposition, branch_id);
      if (l.disposition === 'restock' && l.it.sku_id && l.it.status !== 'cancelled') {
        returnSku(l.it.sku_id, l.qty, rid, branch_id, { lot_id: l.it.lot_id }); // §9 restock once
      }
    }

    // A return completed before the first provider submission invalidates the
    // original full-sale invoice snapshot. Hold every unsent initial invoice;
    // the invoice worker independently rechecks this invariant before I/O.
    try {
      const heldAt = now();
      db.prepare(`UPDATE e_invoices SET invoice_status='REVIEW_REQUIRED',
        error_code='RETURNED_ORDER_INVOICE_HOLD',
        error_message='Bill da tra hang truoc khi phat hanh; can ra soat chung tu.',updated_at=?
        WHERE order_id=? AND branch_id=? AND COALESCE(attempt_count,0)=0
          AND invoice_status IN ('NOT_CREATED','PENDING_PROVIDER','PENDING_EDGE_SYNC','QUEUED','RETRYING','FAILED')`)
        .run(heldAt, order_id, branch_id);
      db.prepare(`UPDATE orders SET einvoice_status='REVIEW_REQUIRED'
        WHERE id=? AND branch_id=? AND EXISTS (
          SELECT 1 FROM e_invoices e WHERE e.order_id=orders.id AND e.invoice_status='REVIEW_REQUIRED')`)
        .run(order_id, branch_id);
    } catch { /* legacy database without the e-invoice tables */ }

    audit('retail.return', {
      order: order_id, bill_no: order.bill_no, return_id: rid,
      refund_total, refund_breakdown: breakdown, items: lines.length,
      approved_by: approved_by || null, full: isFullExact,
    }, branch_id, actor);
    db.prepare('COMMIT').run();

    emit('stats:dirty', {}, branch_id);
    emit('inventory:updated', {}, branch_id);
    return { ok: true, return_id: rid, refund_total, refund_breakdown: breakdown, full: isFullExact };
  } catch (error) {
    try { db.prepare('ROLLBACK').run(); } catch { /* already closed */ }
    throw error;
  }
}

// Với full-exact, reverseOrderPayments đảo đúng tender gốc; ghi lại breakdown để báo cáo.
function tenderBalancesSnapshot(order_id, amount) {
  // Sau reverse, số dư về 0; tính breakdown = phần vừa đảo (âm) gộp theo method.
  const rows = db.prepare(`
    SELECT pl.method, SUM(pl.amount) net
    FROM payment_lines pl JOIN payments p ON p.id=pl.payment_id
    WHERE p.order_id=? AND pl.amount<0 GROUP BY pl.method`).all(order_id);
  const out = rows.map(r => ({ method: r.method, amount: Math.abs(Number(r.net || 0)) })).filter(x => x.amount > 0);
  const sum = out.reduce((s, x) => s + x.amount, 0);
  return sum ? out : [{ method: 'cash', amount }];
}
