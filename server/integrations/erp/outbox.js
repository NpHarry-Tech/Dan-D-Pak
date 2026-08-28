// ─────────────────────────────────────────────────────────────────────────
// ERP OUTBOX (mission #12/#23/#24/#25) — POS thanh toán XONG (đã commit local)
// mới enqueue sự kiện ở đây; worker nền đẩy sang Business Central. BC down → POS
// VẪN BÁN, sự kiện 'pending' rồi retry. KHÔNG bao giờ rollback payment đã thành
// công vì BC lỗi.
//
// Idempotency: external_id UNIQUE (enqueue trùng bị bỏ qua; BC nhận trùng → coi
// DUPLICATE = đã post = thành công). Retry chỉ cho lỗi TẠM THỜI, backoff tăng
// dần, hết lượt → DEAD LETTER (không đấm mãi lỗi validation/mapping).
// ─────────────────────────────────────────────────────────────────────────
import crypto from 'node:crypto';
import { db, uid } from '../../db.js';
import { logSystem } from '../../services/systemLogs.js';
import { emit } from '../../realtime.js';
import { getErpRuntimeConfig } from '../../services/settings/erp.js';
import {
  ERP_DOC_TYPES, buildExternalId, canonicalSaleDoc, isTransient, isDuplicate,
  ERROR_CLASS,
} from './erp_adapter.js';
import { createBusinessCentralAdapter } from './business_central.js';

// Lịch backoff (ms). Hết lịch mà vẫn lỗi tạm thời → DEAD (để người xử lý tay).
const BACKOFF_MS = [
  60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000,
  60 * 60_000, 2 * 60 * 60_000, 6 * 60 * 60_000, 12 * 60 * 60_000,
];
const MAX_RETRY = BACKOFF_MS.length;

const nowIso = () => new Date(Date.now()).toISOString();
const plusMs = (ms) => new Date(Date.now() + ms).toISOString();
function payloadHash(obj) {
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

/**
 * Enqueue idempotent. external_id trùng → BỎ QUA (không tạo bản thứ 2). Trả về
 * row (mới hoặc đã có).
 */
export function enqueueErpDoc(branch_id, docType, externalId, entityId, payload, eventId = null) {
  const existing = db.prepare(`SELECT * FROM erp_outbox WHERE external_id=?`).get(externalId);
  if (existing) return existing;
  const id = uid('erp_');
  const ts = nowIso();
  db.prepare(`
    INSERT INTO erp_outbox
      (id, branch_id, event_id, external_id, doc_type, entity_id, payload_json,
       payload_hash, status, retry_count, next_attempt_at, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?, 'pending', 0, ?, ?, ?)
    ON CONFLICT(external_id) DO NOTHING
  `).run(id, branch_id, eventId, externalId, docType, entityId || null,
    JSON.stringify(payload), payloadHash(payload), ts, ts, ts);
  const row = db.prepare(`SELECT * FROM erp_outbox WHERE external_id=?`).get(externalId);
  emit('erp:queued', { external_id: externalId, doc_type: docType }, branch_id);
  return row;
}

/**
 * Enqueue một hoá đơn bán hàng. Gọi SAU khi thanh toán đủ + đã cấp bill_no. An
 * toàn: bọc try/catch ở nơi gọi; ERP tắt thì bỏ qua. external_id theo bill_no
 * (ổn định, duy nhất theo chi nhánh/ngày).
 */
export function enqueueSale(order, receipt, branch_id = 'sala') {
  const cfg = getErpRuntimeConfig(branch_id);
  if (!cfg.enabled) return null;
  const billNo = receipt?.bill_no || order?.bill_no || order?.pay_ref;
  if (!billNo) return null;
  const externalId = buildExternalId(ERP_DOC_TYPES.SALE, branch_id, billNo);
  const doc = canonicalSaleDoc(order, receipt, {
    externalId, eventId: uid('evt_'), branch: branch_id,
    occurredAt: order?.paid_at || nowIso(),
    customerNo: cfg.defaultCustomerNo, locationCode: cfg.defaultLocationCode,
  });
  return enqueueErpDoc(branch_id, ERP_DOC_TYPES.SALE, externalId, order?.id, doc, doc.event_id);
}

// Adapter theo provider (hiện chỉ BC). Tiêm được để test.
function defaultAdapterFor(branch_id) {
  const cfg = getErpRuntimeConfig(branch_id);
  return createBusinessCentralAdapter(cfg);
}

function markSynced(row, result) {
  db.prepare(`UPDATE erp_outbox SET status='synced', nav_document_no=?, nav_entry_no=?,
    last_error=NULL, error_class=NULL, updated_at=? WHERE id=?`)
    .run(result?.documentNo || null, result?.entryNo || null, nowIso(), row.id);
  emit('erp:synced', { external_id: row.external_id, document_no: result?.documentNo || null }, row.branch_id);
}

function scheduleRetryOrDead(row, errorClass, message) {
  const retry = Number(row.retry_count || 0) + 1;
  const transient = isTransient(errorClass);
  if (!transient || retry >= MAX_RETRY) {
    db.prepare(`UPDATE erp_outbox SET status='dead', error_class=?, last_error=?,
      retry_count=?, next_attempt_at=NULL, updated_at=? WHERE id=?`)
      .run(errorClass, String(message).slice(0, 500), retry, nowIso(), row.id);
    logSystem({
      level: 'error', source: 'erp', eventType: 'erp_dead_letter',
      title: `ERP dead-letter (${errorClass}): ${row.external_id}`,
      message: String(message).slice(0, 500), branchId: row.branch_id,
      action: 'erp:sync', extra: { external_id: row.external_id, retry },
    });
    emit('erp:dead', { external_id: row.external_id, error_class: errorClass }, row.branch_id);
    return;
  }
  const backoff = BACKOFF_MS[Math.min(retry - 1, BACKOFF_MS.length - 1)];
  db.prepare(`UPDATE erp_outbox SET status='pending', error_class=?, last_error=?,
    retry_count=?, next_attempt_at=?, updated_at=? WHERE id=?`)
    .run(errorClass, String(message).slice(0, 500), retry, plusMs(backoff), nowIso(), row.id);
}

/**
 * Xử lý các sự kiện tới hạn. Trả về thống kê. adapterFactory(branch_id) tiêm để test.
 */
export async function processErpOutbox({ limit = 20, adapterFactory = defaultAdapterFor } = {}) {
  const due = db.prepare(`
    SELECT * FROM erp_outbox
     WHERE status='pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
     ORDER BY created_at ASC LIMIT ?
  `).all(nowIso(), Math.max(1, Math.min(100, limit)));

  const stats = { processed: 0, synced: 0, retried: 0, dead: 0 };
  const adapters = new Map();
  for (const row of due) {
    // Giữ chỗ: chuyển 'processing' để lần chạy song song không lấy trùng.
    const claim = db.prepare(`UPDATE erp_outbox SET status='processing', updated_at=? WHERE id=? AND status='pending'`)
      .run(nowIso(), row.id);
    if (claim.changes === 0) continue;
    stats.processed++;
    let doc; try { doc = JSON.parse(row.payload_json); } catch { doc = null; }
    if (!doc) { scheduleRetryOrDead(row, ERROR_CLASS.VALIDATION, 'payload_json hỏng'); stats.dead++; continue; }
    try {
      if (!adapters.has(row.branch_id)) adapters.set(row.branch_id, adapterFactory(row.branch_id));
      const adapter = adapters.get(row.branch_id);
      const result = await adapter.postSale(doc);
      markSynced(row, result);
      stats.synced++;
    } catch (e) {
      const errorClass = e?.errorClass || ERROR_CLASS.UNKNOWN;
      if (isDuplicate(errorClass)) {
        // BC đã có document này rồi → idempotent thành công.
        markSynced(row, { documentNo: e?.extra?.documentNo || null });
        stats.synced++;
        continue;
      }
      const before = row.retry_count;
      scheduleRetryOrDead(row, errorClass, e?.message || String(e));
      const after = db.prepare(`SELECT status FROM erp_outbox WHERE id=?`).get(row.id);
      if (after?.status === 'dead') stats.dead++; else stats.retried++;
      void before;
    }
  }
  return stats;
}

let erpTimer = null;
export function startErpWorker() {
  if (erpTimer) return;
  // 30s một nhịp — nhẹ, và retry backoff tự giãn.
  erpTimer = setInterval(() => {
    processErpOutbox().catch((e) =>
      logSystem({
        level: 'warn', source: 'erp', eventType: 'erp_worker_error',
        title: 'ERP outbox worker lỗi', message: e?.message || String(e), action: 'erp:sync',
      }));
  }, 30_000);
  if (erpTimer.unref) erpTimer.unref();
}
export function stopErpWorker() { if (erpTimer) { clearInterval(erpTimer); erpTimer = null; } }
