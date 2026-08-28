import { db, uid, now, audit } from '../db.js';
import { parseJson } from '../core/util.js';
import { emit } from '../realtime.js';
import { getOrder } from './orders.js';
import { getIntegrations, getPrintConfig } from './settings.js';
import * as Misa from './misa/index.js';
import { enqueueIssuedInvoice } from './haravanConnector.js';
import { archiveInvoice, archiveOrder } from './archive.js';
import { silentSaveFromInvoice } from './customers.js';

const RETRY_BACKOFF = [10, 30, 60, 300, 900, 1800]; // seconds backoff
const MAX_ATTEMPTS = 10;
const SENDING_LEASE_MS = 10 * 60 * 1000;

function completedReturnSummary(orderId) {
  try {
    return db.prepare(`SELECT COUNT(*) count,COALESCE(SUM(refund_total),0) amount
      FROM order_returns WHERE original_order_id=? AND status='completed'`).get(orderId) || { count: 0, amount: 0 };
  } catch {
    return { count: 0, amount: 0 };
  }
}

function assertNoCompletedReturnBeforeInitialIssue(orderId) {
  const summary = completedReturnSummary(orderId);
  if (Number(summary.count) > 0) {
    throw Object.assign(new Error(
      'Bill da co giao dich tra hang. Hoa don dien tu ban dau dang duoc giu de ra soat.'),
    { status: 409, code: 'RETURNED_ORDER_INVOICE_HOLD' });
  }
}

// Hóa đơn điện tử chỉ cần dữ liệu tài chính bất biến. Ảnh base64 là tài sản giao
// diện, không phải chứng từ: giữ nó trong snapshot làm một hóa đơn vài MB và còn
// lặp lại cùng ảnh ở từng dòng. Giữ URL/path ngắn để truy vết, bỏ riêng data URI.
export function compactInvoiceSnapshot(value) {
  if (Array.isArray(value)) return value.map(compactInvoiceSnapshot);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string' && /^data:image\//i.test(item)) {
      if (!/^(image|image_url|thumbnail|photo|logo)$/i.test(key)) out[key] = null;
      continue;
    }
    out[key] = compactInvoiceSnapshot(item);
  }
  return out;
}

/**
 * Creates an e-invoice request in the queue (NOT_CREATED -> QUEUED)
 * Enforces business rules: consumer-sale mode still gets an invoice.
 */
export function createInvoiceRequest(order_id, customer_mode = 'WALK_IN', buyer_info = {}, branch_id = 'sala', actor = 'system', allocation = {}) {
  const order = getOrder(order_id);
  if (!order || order.branch_id !== branch_id) throw new Error('Đơn hàng không tồn tại');
  if (order.status !== 'paid') throw new Error('Chỉ xuất hóa đơn cho đơn hàng đã thanh toán');

  assertNoCompletedReturnBeforeInitialIssue(order_id);

  // No-split invariant: one paid order has exactly one active legal invoice.
  // Legacy clients may still send an allocation object; reject a real partial
  // allocation instead of silently creating a second invoice.
  const splitRequested = allocation.amount != null
    || allocation.order_item_id != null
    || allocation.qty != null;
  if (splitRequested) {
    throw Object.assign(new Error(
      'Tách hóa đơn đã bị loại bỏ: mỗi đơn hàng chỉ được phát hành một hóa đơn duy nhất.'),
    { status: 409, code: 'SPLIT_INVOICE_DISABLED' });
  }
  const existing = db.prepare(`SELECT * FROM e_invoices
    WHERE order_id=? AND branch_id=? AND invoice_status!='CANCELLED'
    ORDER BY created_at DESC LIMIT 1`).get(order_id, branch_id);

  // Determine buyer details based on mode
  let finalBuyer = {
    name: 'Bán cho người tiêu dùng',
    tax_code: '',
    address: '',
    email: '',
    phone: ''
  };

  if (customer_mode === 'NO_BUYER_INFO') {
    finalBuyer.name = 'Bán cho người tiêu dùng';
  } else if (customer_mode === 'BUYER_PROVIDED_INFO') {
    finalBuyer.name = buyer_info.name || 'Khách hàng cá nhân';
    finalBuyer.email = buyer_info.email || '';
    finalBuyer.phone = buyer_info.phone || '';
    finalBuyer.address = buyer_info.address || '';
  } else if (customer_mode === 'COMPANY_TAX_INFO') {
    finalBuyer.name = buyer_info.company || buyer_info.name || '';
    finalBuyer.company = buyer_info.company || '';
    finalBuyer.tax_code = String(buyer_info.tax_code || '').replace(/\D/g, '');
    finalBuyer.address = buyer_info.address || '';
    finalBuyer.email = buyer_info.email || '';
    finalBuyer.phone = buyer_info.phone || '';
    if (!/^\d{10}(\d{3})?$/.test(finalBuyer.tax_code)) {
      throw new Error('Mã số thuế doanh nghiệp phải gồm 10 hoặc 13 chữ số');
    }
    if (!finalBuyer.name) throw new Error('Thiếu tên công ty/tổ chức');
    if (!finalBuyer.email) throw new Error('Thiếu email nhận hóa đơn');
  }

  // Payment creates a consumer placeholder for every paid bill. If the buyer
  // subsequently chooses "Xuất hóa đơn" before provider submission, upgrade
  // that SAME record instead of returning the stale consumer snapshot.
  if (existing) {
    const wantsNamedBuyer = customer_mode === 'BUYER_PROVIDED_INFO'
      || customer_mode === 'COMPANY_TAX_INFO';
    if (!wantsNamedBuyer) return get(existing.id);

    const mutable = new Set([
      'NOT_CREATED', 'PENDING_PROVIDER', 'PENDING_EDGE_SYNC',
      'QUEUED', 'RETRYING', 'FAILED',
    ]);
    if (!mutable.has(existing.invoice_status)
        || Number(existing.attempt_count || 0) > 0
        || existing.provider_invoice_id) {
      throw Object.assign(new Error(
        'Hóa đơn đã gửi nhà cung cấp nên không thể đổi thông tin người mua. Hãy lập hóa đơn điều chỉnh/thay thế.'),
      { status: 409 });
    }

    const snapshot = parseJson(existing.request_snapshot, {});
    snapshot.customer_mode = customer_mode;
    snapshot.buyer = finalBuyer;
    const changedAt = now();
    const update = db.prepare(`UPDATE e_invoices SET
      customer_mode=?,buyer_name=?,buyer_tax_code=?,buyer_address=?,buyer_email=?,buyer_phone=?,
      request_snapshot=?,updated_at=?,error_code=NULL,error_message=NULL
      WHERE id=? AND invoice_status IN ('NOT_CREATED','PENDING_PROVIDER','PENDING_EDGE_SYNC','QUEUED','RETRYING','FAILED')
        AND COALESCE(attempt_count,0)=0 AND COALESCE(provider_invoice_id,'')=''`)
      .run(customer_mode, finalBuyer.name, finalBuyer.tax_code, finalBuyer.address,
        finalBuyer.email, finalBuyer.phone, JSON.stringify(snapshot), changedAt, existing.id);
    if (update.changes !== 1) {
      throw Object.assign(new Error(
        'Hóa đơn vừa bắt đầu gửi nhà cung cấp; không thể đổi thông tin người mua.'),
      { status: 409 });
    }

    // Backfill chạy định kỳ theo lô. Bản ghi HĐ cũ có thể đã tồn tại với một
    // idempotency_key đời cũ; nếu không đóng dấu canonical thì phút sau truy
    // vấn backfill lại chọn đúng hóa đơn này và ghi `invoice.buyer_updated`
    // vô hạn. Chỉ tác vụ hệ thống được phép chuẩn hóa khóa ở đây.
    const isBackfill = String(actor || '').toLowerCase() === 'system_backfill';
    if (isBackfill) {
      db.prepare(`UPDATE e_invoices SET idempotency_key=? WHERE id=?`)
        .run(`einv:${branch_id}:${order_id}`, existing.id);
    }

    let savedCustomer = {};
    try { savedCustomer = JSON.parse(order.customer_json || '{}') || {}; } catch {}
    savedCustomer = {
      ...savedCustomer,
      ...finalBuyer,
      company: buyer_info.company || savedCustomer.company || '',
      invoice_request: true,
      invoice_customer_name: finalBuyer.name,
    };
    db.prepare(`UPDATE orders SET customer_json=?,invoice_choice='requested' WHERE id=? AND branch_id=?`)
      .run(JSON.stringify(savedCustomer), order_id, branch_id);
    writeAuditLog({
      order_id,
      e_invoice_id: existing.id,
      actor_id: actor,
      actor_role: actor === 'system' ? 'system' : 'staff',
      action: 'BUYER_UPDATED',
      old_status: existing.invoice_status,
      new_status: existing.invoice_status,
      reason: `Cập nhật người mua trước phát hành (${customer_mode})`,
      payload_snapshot: JSON.stringify({ customer_mode, buyer: finalBuyer }),
    });
    // Chi tiết pháp lý vẫn nằm trong e_invoice_audit ở trên. Main activity log
    // chỉ dành cho thao tác người dùng; backfill hàng trăm hóa đơn không được
    // đẩy từng dòng làm che mất các sự kiện vận hành khác.
    if (!isBackfill) {
      audit('invoice.buyer_updated', {
        order: order_id, invoice: existing.id, customer_mode,
      }, branch_id, actor);
    }
    silentSaveFromInvoice(finalBuyer, branch_id);
    emit('invoice:updated', { id: existing.id, order_id, buyer: finalBuyer }, branch_id);
    return get(existing.id);
  }

  const id = uid('einv_');
  const suppliedKey = String(allocation.idempotency_key || '').trim();
  if (suppliedKey.length > 128) throw new Error('Idempotency-Key must not exceed 128 characters');
  // Client request keys are transport idempotency only. The durable legal key
  // is always order-scoped so no caller can manufacture a second invoice ID.
  const idempotency_key = `einv:${branch_id}:${order_id}`;
  const timeNow = now();

  // Determine provider based on config.
  // NĐ 70/2025: hóa đơn đầu ra phải được GHI NHẬN cho MỌI giao dịch — kể cả
  // khi MISA chưa bật. Trước đây chỗ này `return null` khi MISA off → không
  // có bản ghi nào, bật MISA sau không phát hành bù được (thiếu HĐ đầu ra —
  // kiểm toán vào là phạt). Giờ: MISA off → vẫn INSERT với trạng thái
  // PENDING_PROVIDER; bật MISA → requeuePendingProvider() đẩy tất cả vào
  // hàng đợi phát hành thật.
  const misaCfg = getIntegrations(branch_id).channels?.misa || {};
  const providerReady = Misa.isLive(misaCfg);
  // Store Edge records the legal intent atomically but never calls MISA. The
  // VPS becomes the single provider authority after the sale snapshot is ACKed.
  const storeEdge = !!String(process.env.EDGE_HUB_ID || '').trim();
  const provider = storeEdge ? 'edge' : (providerReady ? 'misa' : 'pending');
  const initialStatus = storeEdge ? 'PENDING_EDGE_SYNC' : (providerReady ? 'QUEUED' : 'PENDING_PROVIDER');

  // Snapshot request body for auditing
  const paymentSnapshot = db.prepare(`SELECT p.id,p.shift_id,p.cashier,p.created_at,pl.method,pl.amount,pl.tendered_amount,pl.reference
    FROM payments p JOIN payment_lines pl ON pl.payment_id=p.id WHERE p.order_id=? ORDER BY p.created_at,pl.rowid`).all(order_id);
  const requestSnapshot = {
    order_id,
    bill: {
      id: order.id,
      code: order.bill_no || order.id,
      branch_id: order.branch_id,
      table_id: order.table_id,
      channel: order.channel,
      status: order.status,
      subtotal: order.subtotal,
      goods_amount: order.goods_amount,
      discount: order.discount,
      vat_amount: order.vat_amount,
      total: order.total,
      paid_at: order.paid_at,
    },
    customer_mode,
    buyer: finalBuyer,
    items: compactInvoiceSnapshot(order.items || []),
    payments: paymentSnapshot,
    total: order.total,
  };

  const ownsTransaction = !db.isTransaction;
  if (ownsTransaction) db.prepare('BEGIN IMMEDIATE').run();
  try {
    let allocated = Number(db.prepare(`
      SELECT COALESCE(SUM(a.amount),0) total
      FROM invoice_allocations a
      JOIN e_invoices e ON e.id=a.e_invoice_id
      WHERE a.order_id=? AND e.invoice_status!='CANCELLED'
    `).get(order_id)?.total) || 0;
    const remaining = Number(order.total) - allocated;
    const requested = remaining;
    if (!Number.isFinite(requested) || requested <= 0) throw new Error('Invoice allocation amount must be greater than zero');
    if (requested > remaining) {
      throw Object.assign(new Error(`Invoice allocation exceeds remaining order amount (${remaining})`), { status: 409 });
    }
    requestSnapshot.total = Number(order.total);

    db.prepare(`
      INSERT INTO e_invoices (
        id, order_id, branch_id, provider, invoice_status, idempotency_key,
        customer_mode, buyer_name, buyer_tax_code, buyer_address, buyer_email, buyer_phone,
        request_snapshot, attempt_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `).run(
      id, order_id, branch_id, provider, initialStatus, idempotency_key,
      customer_mode, finalBuyer.name, finalBuyer.tax_code, finalBuyer.address, finalBuyer.email, finalBuyer.phone,
      JSON.stringify(requestSnapshot), timeNow, timeNow
    );
    db.prepare(`
      INSERT INTO invoice_allocations (id,e_invoice_id,order_id,order_item_id,qty,amount,created_at)
      VALUES (?,?,?,?,?,?,?)
    `).run(uid('ialloc_'), id, order_id, null, null, requested, timeNow);
    if (ownsTransaction) db.prepare('COMMIT').run();
  } catch (error) {
    if (ownsTransaction && db.isTransaction) db.prepare('ROLLBACK').run();
    throw error;
  }

  // Update order with e-invoice status
  db.prepare(`UPDATE orders SET einvoice_id = ?, einvoice_status = ?, locked_at = ? WHERE id = ?`).run(id, initialStatus, timeNow, order_id);

  // Add immutable audit log
  writeAuditLog({
    order_id,
    e_invoice_id: id,
    actor_id: actor,
    actor_role: actor === 'system' ? 'system' : 'staff',
    action: 'CREATE_REQUEST',
    old_status: 'NOT_CREATED',
    new_status: initialStatus,
    reason: storeEdge
      ? `Store Edge ghi nhan hoa don dau ra — cho VPS dong bo (${customer_mode})`
      : providerReady
      ? `Tạo yêu cầu HĐĐT tự động theo chế độ ${customer_mode}`
      : `Ghi nhận HĐ đầu ra (MISA chưa bật — chờ phát hành bù) theo chế độ ${customer_mode}`,
    payload_snapshot: JSON.stringify(requestSnapshot)
  });
  for (const action of ['BILL_PAID', 'BILL_CLOSED', 'SNAPSHOT_CREATED', 'REF_ID_CREATED']) {
    writeAuditLog({ order_id, e_invoice_id: id, actor_id: actor, actor_role: actor === 'system' ? 'system' : 'staff', action });
  }

  emit('einvoice:queued', { id, order_id, status: initialStatus }, branch_id);

  // Khách khai thông tin khi xuất HĐ → âm thầm lưu/bổ sung hồ sơ khách hàng
  // (không toast/label gì phía UI; hàm tự nuốt lỗi).
  silentSaveFromInvoice(finalBuyer, branch_id);

  // Return fresh record
  return get(id);
}
/**
 * Backfill: khi bật MISA, đẩy toàn bộ hóa đơn đã ghi nhận lúc MISA off
 * (PENDING_PROVIDER) vào hàng đợi để phát hành thật. Idempotent.
 */
export function requeuePendingProvider(branch_id = 'sala', actor = 'system') {
  const misaCfg = getIntegrations(branch_id).channels?.misa || {};
  if (!misaCfg.enabled) return { requeued: 0 };
  if (!Misa.isLive(misaCfg)) return { requeued: 0 };
  const provider = 'misa';
  const rows = db.prepare(
    `SELECT id, order_id FROM e_invoices WHERE branch_id=? AND invoice_status='PENDING_PROVIDER'`
  ).all(branch_id);
  const timeNow = now();
  const upd = db.prepare(
    `UPDATE e_invoices SET invoice_status='QUEUED', provider=?, next_retry_at=NULL, updated_at=? WHERE id=?`
  );
  for (const r of rows) {
    upd.run(provider, timeNow, r.id);
    db.prepare(`UPDATE orders SET einvoice_status='QUEUED' WHERE id=?`).run(r.order_id);
    writeAuditLog({
      order_id: r.order_id,
      e_invoice_id: r.id,
      actor_id: actor,
      actor_role: 'system',
      action: 'REQUEUE',
      old_status: 'PENDING_PROVIDER',
      new_status: 'QUEUED',
      reason: 'MISA được bật — phát hành bù hóa đơn đã ghi nhận'
    });
  }
  if (rows.length) {
    audit('einvoice.requeue_pending', { count: rows.length }, branch_id, actor);
    emit('einvoice:queued', { requeued: rows.length }, branch_id);
  }
  return { requeued: rows.length };
}

/** One-time/idempotent repair for paid bills created before atomic snapshots existed. */
export function backfillPaidBills(limit = 1000) {
  const rows = db.prepare(`SELECT o.id,o.branch_id,o.customer_json FROM orders o
    WHERE o.status='paid' AND COALESCE(o.total,0)>0 AND NOT EXISTS (
      SELECT 1 FROM e_invoices e WHERE e.order_id=o.id AND e.branch_id=o.branch_id
        AND e.invoice_status!='CANCELLED'
    ) ORDER BY o.paid_at LIMIT ?`).all(limit);
  let created = 0;
  for (const row of rows) {
    const buyer = parseJson(row.customer_json, {});
    const mode = buyer.tax_code && buyer.email && (buyer.company || buyer.name) ? 'COMPANY_TAX_INFO'
      : (buyer.name || buyer.phone || buyer.email ? 'BUYER_PROVIDED_INFO' : 'WALK_IN');
    try {
      createInvoiceRequest(row.id, mode, buyer, row.branch_id, 'system_backfill');
      created++;
    } catch (error) {
      writeAuditLog({ order_id: row.id, actor_id: 'system_backfill', actor_role: 'system',
        action: 'ERROR_OCCURRED', reason: error.message });
    }
  }
  return { scanned: rows.length, created };
}

/**
 * Background worker to process the queued/retrying invoices
 */
export async function processInvoiceQueue() {
  // A process can die after the durable SENDING claim but before persisting the
  // provider response. Reclaim only an expired lease. Force attempt_count >= 1
  // so the next attempt checks MISA by deterministic RefID before any publish.
  const staleBefore = new Date(Date.now() - SENDING_LEASE_MS).toISOString();
  const stale = db.prepare(`SELECT id,order_id,branch_id,updated_at,attempt_count
    FROM e_invoices WHERE invoice_status='SENDING' AND updated_at<=?`).all(staleBefore);
  for (const row of stale) {
    const recoveredAt = now();
    const recovered = db.prepare(`UPDATE e_invoices SET
      invoice_status='RETRYING',attempt_count=MAX(attempt_count,1),next_retry_at=NULL,
      error_code='WORKER_LEASE_EXPIRED',error_message=?,updated_at=?
      WHERE id=? AND invoice_status='SENDING' AND updated_at=?`).run(
      'Worker trước dừng giữa chừng; bắt buộc tra provider trước khi gửi lại.',
      recoveredAt, row.id, row.updated_at);
    if (recovered.changes !== 1) continue;
    db.prepare(`UPDATE orders SET einvoice_status='RETRYING' WHERE id=? AND branch_id=?`)
      .run(row.order_id, row.branch_id);
    writeAuditLog({
      order_id: row.order_id,
      e_invoice_id: row.id,
      actor_id: 'worker',
      actor_role: 'system',
      action: 'SENDING_LEASE_RECOVERED',
      old_status: 'SENDING',
      new_status: 'RETRYING',
      reason: 'Lease SENDING quá 10 phút; chuyển sang retry có provider-status check.',
    });
    emit('einvoice:retrying', {
      id: row.id, order_id: row.order_id, status: 'RETRYING', recovered: true,
    }, row.branch_id);
  }

  const pendingJobs = db.prepare(`
    SELECT * FROM e_invoices 
    WHERE invoice_status IN ('QUEUED', 'RETRYING') 
      AND (next_retry_at IS NULL OR next_retry_at <= ?)
    ORDER BY created_at ASC 
    LIMIT 10
  `).all(now());

  for (const job of pendingJobs) {
    await processJob(job);
  }
}

async function processJob(job) {
  const timeNow = now();
  // Atomic claim: two timer ticks/manual retries may select the same QUEUED row
  // before either awaits the provider. Only the worker that changes the exact
  // previously observed state may cross the external side-effect boundary.
  const claim = db.prepare(`UPDATE e_invoices SET invoice_status='SENDING',updated_at=?
    WHERE id=? AND invoice_status=?`).run(timeNow, job.id, job.invoice_status);
  if (claim.changes !== 1) return false;
  db.prepare(`UPDATE orders SET einvoice_status = 'SENDING' WHERE id = ?`).run(job.order_id);

  writeAuditLog({
    order_id: job.order_id,
    e_invoice_id: job.id,
    actor_id: 'worker',
    actor_role: 'system',
    action: 'SENDING',
    old_status: job.invoice_status,
    new_status: 'SENDING',
    reason: `Worker bắt đầu xử lý job (lần thử ${job.attempt_count + 1})`
  });

  const misaCfg = getIntegrations(job.branch_id).channels?.misa || {};
  const order = getOrder(job.order_id);

  if (!order) {
    markJobFailed(job, 'ORDER_NOT_FOUND', 'Không tìm thấy đơn hàng tương ứng');
    return;
  }

  const returnSummary = completedReturnSummary(job.order_id);
  if (Number(returnSummary.count) > 0) {
    const heldAt = now();
    db.prepare(`UPDATE e_invoices SET invoice_status='REVIEW_REQUIRED',
      error_code='RETURNED_ORDER_INVOICE_HOLD',error_message=?,updated_at=? WHERE id=?`)
      .run('Bill da tra hang truoc khi phat hanh; can xu ly chung tu dieu chinh/thay the.', heldAt, job.id);
    db.prepare(`UPDATE orders SET einvoice_status='REVIEW_REQUIRED' WHERE id=?`).run(job.order_id);
    writeAuditLog({
      order_id: job.order_id, e_invoice_id: job.id, actor_id: 'worker', actor_role: 'system',
      action: 'RETURN_HOLD', old_status: 'SENDING', new_status: 'REVIEW_REQUIRED',
      reason: `Khong phat hanh hoa don ban dau vi bill da tra hang (${Number(returnSummary.amount || 0)} VND).`,
    });
    emit('einvoice:review_required', { id: job.id, order_id: job.order_id, status: 'REVIEW_REQUIRED' }, job.branch_id);
    return true;
  }

  const buyer = {
    name: job.buyer_name,
    tax_code: job.buyer_tax_code,
    address: job.buyer_address,
    email: job.buyer_email,
    phone: job.buyer_phone
  };
  // SNAPSHOT LÀ NGUỒN SỰ THẬT. Không đọc lại giá/tên hàng hiện tại của sản
  // phẩm: sửa giá sau khi bán KHÔNG được phép làm đổi hóa đơn đã chốt.
  const request = parseJson(job.request_snapshot, {});
  const snapshot = {
    ...request,
    order_id: job.order_id,
    branch_id: job.branch_id,
    buyer,
    items: Array.isArray(request.items) ? request.items : (order.items || []),
    total: Number(request.total) || order.total,
    bill: { ...(request.bill || {}), branch_id: job.branch_id, paid_at: request.bill?.paid_at || order.paid_at },
    schema_version: Number(request.schema_version) || 1,
  };

  try {
    let result;
    if (job.provider !== 'misa' || !Misa.isLive(misaCfg)) {
      db.prepare(`UPDATE e_invoices SET invoice_status='PENDING_PROVIDER',provider='pending',updated_at=? WHERE id=?`)
        .run(now(), job.id);
      db.prepare(`UPDATE orders SET einvoice_status='PENDING_PROVIDER' WHERE id=?`).run(job.order_id);
      return true;
    }
    // CHỐNG HÓA ĐƠN TRÙNG: đây không phải lần thử đầu, nghĩa là lần trước đã
    // gửi đi và KHÔNG BIẾT MISA có nhận hay không (hết giờ, đứt mạng, server
    // restart giữa chừng). Bắt buộc TRA TRẠNG THÁI trước khi gửi lại.
    const coTheDaGuiRoi = Number(job.attempt_count) > 0;
    result = await Misa.issueInvoice({
      snapshot,
      cfg: misaCfg,
      company: { invoiceWithCode: misaCfg.invoiceCodeType === 'WITHOUT_CODE' ? false : null },
      mayHaveLanded: coTheDaGuiRoi,
    });

    // Success! Update invoice record
    const updatedTime = now();
    db.prepare(`
      UPDATE e_invoices 
      SET invoice_status = 'ISSUED', 
          invoice_no = ?, 
          tax_authority_code = ?,
          lookup_code = ?, 
          lookup_url = ?, 
          issued_at = ?,
          attempt_count = attempt_count + 1,
          response_snapshot = ?,
          updated_at = ?
      WHERE id = ?
    `).run(
      result.invoice_no, 
      result.tax_authority_code || null,
      result.lookup_code, 
      result.lookup_url, 
      updatedTime,
      JSON.stringify(result.raw || {}),
      updatedTime,
      job.id
    );

    db.prepare(`UPDATE orders SET einvoice_id = ?, einvoice_status = 'ISSUED' WHERE id = ?`).run(job.id, job.order_id);

    writeAuditLog({
      order_id: job.order_id,
      e_invoice_id: job.id,
      actor_id: 'worker',
      actor_role: 'system',
      action: 'ISSUE_SUCCESS',
      old_status: 'SENDING',
      new_status: 'ISSUED',
      reason: `Phát hành hóa đơn thành công. Số HĐ: ${result.invoice_no}`,
      response_snapshot: JSON.stringify(result.raw || {})
    });

    emit('einvoice:issued', { id: job.id, order_id: job.order_id, invoice_no: result.invoice_no, status: 'ISSUED' }, job.branch_id);
    try { enqueueIssuedInvoice(job.id); } catch { /* Haravan không được chặn phát hành hóa đơn */ }
    archiveOrder(order);
    return true;

  } catch (err) {
    const errorMsg = err.message || 'Lỗi không xác định';
    const nextAttempt = job.attempt_count + 1;

    // Lỗi DỮ LIỆU (sai mã số thuế, thiếu trường, mẫu ngừng dùng, tổng tiền
    // lệch…) thử lại bao nhiêu lần cũng hỏng y như vậy. Dừng ngay để người
    // vận hành thấy lỗi thật trong vài giây, thay vì sau 10 lần và nửa tiếng.
    if (err && err.retryable === false) {
      markJobFailed(job, err.misaCode || 'DATA_ERROR', errorMsg);
      return true;
    }

    if (nextAttempt >= MAX_ATTEMPTS) {
      markJobFailed(job, 'MAX_ATTEMPTS_EXCEEDED', `Lỗi phát hành sau ${MAX_ATTEMPTS} lần: ${errorMsg}`);
    } else {
      // Calculate backoff
      const backoffSec = RETRY_BACKOFF[Math.min(nextAttempt - 1, RETRY_BACKOFF.length - 1)];
      const nextRetryDate = new Date(Date.now() + backoffSec * 1000).toISOString();

      db.prepare(`
        UPDATE e_invoices 
        SET invoice_status = 'RETRYING', 
            attempt_count = ?, 
            next_retry_at = ?, 
            error_message = ?, 
            updated_at = ?
        WHERE id = ?
      `).run(nextAttempt, nextRetryDate, errorMsg, now(), job.id);

      db.prepare(`UPDATE orders SET einvoice_status = 'RETRYING' WHERE id = ?`).run(job.order_id);

      writeAuditLog({
        order_id: job.order_id,
        e_invoice_id: job.id,
        actor_id: 'worker',
        actor_role: 'system',
        action: 'ISSUE_RETRY_SCHEDULED',
        old_status: 'SENDING',
        new_status: 'RETRYING',
        reason: `Lỗi: ${errorMsg}. Lên lịch thử lại lần thứ ${nextAttempt + 1} lúc ${nextRetryDate}`
      });

      emit('einvoice:retrying', { id: job.id, order_id: job.order_id, status: 'RETRYING', attempt_count: nextAttempt }, job.branch_id);
    }
    return true;
  }
}

function markJobFailed(job, errorCode, errorMsg) {
  const updatedTime = now();
  db.prepare(`
    UPDATE e_invoices 
    SET invoice_status = 'FAILED', 
        error_code = ?,
        error_message = ?,
        attempt_count = attempt_count + 1,
        next_retry_at = NULL,
        updated_at = ?
    WHERE id = ?
  `).run(errorCode, errorMsg, updatedTime, job.id);

  db.prepare(`UPDATE orders SET einvoice_status = 'FAILED' WHERE id = ?`).run(job.order_id);

  writeAuditLog({
    order_id: job.order_id,
    e_invoice_id: job.id,
    actor_id: 'worker',
    actor_role: 'system',
    action: 'ISSUE_FAILED',
    old_status: 'SENDING',
    new_status: 'FAILED',
    reason: `Phát hành hóa đơn thất bại hoàn toàn. Mã lỗi: ${errorCode}. Chi tiết: ${errorMsg}`
  });

  emit('einvoice:failed', { id: job.id, order_id: job.order_id, status: 'FAILED', error: errorMsg }, job.branch_id);
}

/**
 * Manually triggers a retry of a FAILED or RETRYING invoice (e.g. from Dashboard)
 */
export async function retryInvoice(e_invoice_id, actor = 'system', branch_id = null) {
  const job = get(e_invoice_id, branch_id);
  if (!job) throw new Error('Không tìm thấy yêu cầu hóa đơn');
  if (job.invoice_status !== 'FAILED' && job.invoice_status !== 'RETRYING') {
    throw new Error('Chỉ có thể thử lại các yêu cầu hóa đơn bị lỗi hoặc đang chờ thử lại');
  }

  const timeNow = now();
  db.prepare(`
    UPDATE e_invoices 
    SET invoice_status = 'QUEUED', 
        next_retry_at = NULL, 
        error_message = NULL,
        updated_at = ? 
    WHERE id = ?
  `).run(timeNow, e_invoice_id);

  db.prepare(`UPDATE orders SET einvoice_status = 'QUEUED' WHERE id = ?`).run(job.order_id);

  writeAuditLog({
    order_id: job.order_id,
    e_invoice_id,
    actor_id: actor,
    actor_role: 'manager',
    action: 'MANUAL_RETRY',
    old_status: job.invoice_status,
    new_status: 'QUEUED',
    reason: `Người dùng ${actor} kích hoạt phát hành lại thủ công`
  });

  emit('einvoice:queued', { id: e_invoice_id, order_id: job.order_id, status: 'QUEUED' }, job.branch_id);

  // Trigger worker execution immediately in background
  processJob(get(e_invoice_id, job.branch_id)).catch(() => {});

  return get(e_invoice_id, job.branch_id);
}

/**
 * Sync status with MISA meInvoice directly for a specific invoice
 */
export async function syncInvoiceStatus(e_invoice_id, branch_id = null) {
  const job = get(e_invoice_id, branch_id);
  if (!job) throw new Error('Không tìm thấy yêu cầu hóa đơn');

  const misaCfg = getIntegrations(job.branch_id).channels?.misa || {};
  if (job.provider === 'misa' && Misa.isLive(misaCfg)) {
    try {
      const statusResult = await Misa.getInvoiceStatus({
        taxCode: misaCfg.taxCode,
        branchId: job.branch_id,
        orderId: job.order_id,
        version: 1,
      }, misaCfg);
      if (statusResult && statusResult.invoice_no) {
        const timeNow = now();
        db.prepare(`
          UPDATE e_invoices 
          SET invoice_status = 'ISSUED', 
              invoice_no = ?, 
              tax_authority_code = ?,
              lookup_code = ?,
              last_sync_at = ?,
              updated_at = ?
          WHERE id = ?
        `).run(
          statusResult.invoice_no,
          statusResult.tax_authority_code || null,
          statusResult.lookup_code,
          timeNow,
          timeNow,
          e_invoice_id
        );

        db.prepare(`UPDATE orders SET einvoice_status = 'ISSUED' WHERE id = ?`).run(job.order_id);

        writeAuditLog({
          order_id: job.order_id,
          e_invoice_id,
          actor_id: 'system',
          actor_role: 'system',
          action: 'SYNC_STATUS',
          old_status: job.invoice_status,
          new_status: 'ISSUED',
          reason: `Đồng bộ trạng thái từ MISA thành công. Số HĐ mới cập nhật: ${statusResult.invoice_no}`
        });

        emit('einvoice:issued', { id: e_invoice_id, order_id: job.order_id, invoice_no: statusResult.invoice_no, status: 'ISSUED' }, job.branch_id);
        try { enqueueIssuedInvoice(e_invoice_id); } catch { /* best effort outbox */ }
        return { ok: true, status: 'ISSUED', invoice_no: statusResult.invoice_no };
      }
    } catch (err) {
      throw new Error(`Đồng bộ MISA lỗi: ${err.message}`);
    }
  } else {
    // Local mock sync
    if (job.invoice_status !== 'ISSUED') {
      return retryInvoice(e_invoice_id, 'sync_trigger', job.branch_id);
    }
  }

  return { ok: true, status: job.invoice_status };
}

/**
 * Voids/cancels an e-invoice per government regulations
 */
export async function cancelInvoice(e_invoice_id, reason, actor = 'system', branch_id = null) {
  const job = get(e_invoice_id, branch_id);
  if (!job) throw new Error('Không tìm thấy hóa đơn');
  if (job.invoice_status !== 'ISSUED') {
    throw new Error('Chỉ có thể hủy hóa đơn đã được phát hành thành công');
  }
  if (!reason || !reason.trim()) {
    throw new Error('Vui lòng cung cấp lý do hủy hóa đơn');
  }

  // Claim before crossing the provider boundary. Two manager clicks or two
  // devices must never submit two cancellation requests for one invoice.
  const claimedAt = now();
  const claim = db.prepare(`UPDATE e_invoices SET invoice_status='CANCELLING',updated_at=?
    WHERE id=? AND branch_id=? AND invoice_status='ISSUED'`).run(
    claimedAt, e_invoice_id, job.branch_id);
  if (claim.changes !== 1) {
    throw Object.assign(new Error('Hóa đơn đang được hủy hoặc trạng thái đã thay đổi.'),
      { status: 409 });
  }
  db.prepare(`UPDATE orders SET einvoice_status='CANCELLING'
    WHERE id=? AND branch_id=?`).run(job.order_id, job.branch_id);

  const misaCfg = getIntegrations(job.branch_id).channels?.misa || {};
  if (job.provider === 'misa' && Misa.isLive(misaCfg)) {
    try {
      const request = parseJson(job.request_snapshot, {});
      await Misa.cancelInvoice({
        snapshot: {
          ...request,
          order_id: job.order_id,
          branch_id: job.branch_id,
          bill: { ...(request.bill || {}), branch_id: job.branch_id },
          schema_version: Number(request.schema_version) || 1,
        },
        cfg: misaCfg,
        reason,
      });
    } catch (err) {
      // Provider did not confirm cancellation: keep the legal local state as
      // ISSUED. The error remains visible and a later explicit retry is allowed.
      db.prepare(`UPDATE e_invoices SET invoice_status='ISSUED',error_code='CANCEL_PROVIDER_ERROR',
        error_message=?,updated_at=? WHERE id=? AND branch_id=? AND invoice_status='CANCELLING'`)
        .run(String(err.message || err), now(), e_invoice_id, job.branch_id);
      db.prepare(`UPDATE orders SET einvoice_status='ISSUED'
        WHERE id=? AND branch_id=?`).run(job.order_id, job.branch_id);
      throw new Error(`Hủy hóa đơn trên MISA meInvoice lỗi: ${err.message}`);
    }
  }

  const timeNow = now();
  db.prepare(`
    UPDATE e_invoices 
    SET invoice_status = 'CANCELLED', 
        error_message = ?, 
        updated_at = ? 
    WHERE id = ? AND branch_id=? AND invoice_status='CANCELLING'
  `).run(`Bị hủy bởi ${actor} lúc ${timeNow}. Lý do: ${reason}`, timeNow, e_invoice_id, job.branch_id);

  db.prepare(`UPDATE orders SET einvoice_status = 'CANCELLED', einvoice_id = NULL
    WHERE id = ? AND branch_id=?`).run(job.order_id, job.branch_id);

  writeAuditLog({
    order_id: job.order_id,
    e_invoice_id,
    actor_id: actor,
    actor_role: 'manager',
    action: 'CANCEL_INVOICE',
    old_status: 'ISSUED',
    new_status: 'CANCELLED',
    reason: `Hủy hóa đơn lý do: ${reason}`
  });

  emit('einvoice:cancelled', { id: e_invoice_id, order_id: job.order_id, status: 'CANCELLED' }, job.branch_id);

  return { ok: true, status: 'CANCELLED' };
}

/**
 * Returns single invoice request by ID
 */
export function get(id, branch_id = null) {
  const i = branch_id
    ? db.prepare(`SELECT * FROM e_invoices WHERE id = ? AND branch_id = ?`).get(id, branch_id)
    : db.prepare(`SELECT * FROM e_invoices WHERE id = ?`).get(id);
  if (!i) return null;
  return {
    ...i,
    request_snapshot: parseJson(i.request_snapshot, {}),
    response_snapshot: parseJson(i.response_snapshot, {})
  };
}

/**
 * Returns invoice for a specific order
 */
export function getInvoiceByOrder(order_id, branch_id = null) {
  const i = branch_id
    ? db.prepare(`SELECT * FROM e_invoices WHERE order_id = ? AND branch_id = ? ORDER BY created_at DESC LIMIT 1`).get(order_id, branch_id)
    : db.prepare(`SELECT * FROM e_invoices WHERE order_id = ? ORDER BY created_at DESC LIMIT 1`).get(order_id);
  if (!i) return null;
  return get(i.id, branch_id);
}

/**
 * Khách yêu cầu hóa đơn cá nhân/công ty SAU khi thanh toán (từ Lịch sử):
 * nâng cấp thông tin người mua trên CÙNG bản ghi HĐĐT nếu CHƯA phát hành —
 * tuyệt đối không tạo hóa đơn thứ hai cho một giao dịch. Đã phát hành rồi
 * thì phải đi đường hủy/thay thế theo NĐ 70.
 */
export function upgradeBuyer(order_id, customer = {}, branch_id = 'sala', actor = 'staff') {
  const inv = getInvoiceByOrder(order_id, branch_id);
  if (!inv) throw new Error('Chưa có bản ghi HĐĐT cho bill này');
  if (inv.invoice_status === 'ISSUED') {
    throw new Error(
      `Bill đã có HĐĐT${inv.invoice_no ? ` số ${inv.invoice_no}` : ''} đã phát hành. ` +
      'Muốn đổi sang hóa đơn công ty phải HỦY/THAY THẾ hóa đơn cũ trước — không được xuất trùng 2 hóa đơn cho 1 giao dịch.');
  }
  const mutable = new Set([
    'NOT_CREATED', 'PENDING_PROVIDER', 'PENDING_EDGE_SYNC',
    'QUEUED', 'RETRYING', 'FAILED',
  ]);
  if (!mutable.has(inv.invoice_status)) {
    throw new Error(`HĐĐT đang ở trạng thái ${inv.invoice_status} — thử lại sau ít phút.`);
  }
  if (Number(inv.attempt_count || 0) > 0 || inv.provider_invoice_id) {
    throw Object.assign(new Error(
      'Hóa đơn đã bắt đầu gửi nhà cung cấp nên không thể đổi thông tin người mua. Hãy lập hóa đơn điều chỉnh/thay thế.'),
    { status: 409 });
  }
  const tax_code = String(customer.tax_code || '').replace(/\D/g, '');
  const isCompany = !!tax_code;
  if (isCompany && !/^\d{10}(\d{3})?$/.test(tax_code)) {
    throw new Error('Mã số thuế phải gồm 10 hoặc 13 chữ số');
  }
  const name = String(customer.name || customer.company || '').trim();
  if (!name) throw new Error('Thiếu tên người mua / công ty');
  if (isCompany && !String(customer.email || '').trim()) {
    throw new Error('Thiếu email nhận hóa đơn công ty');
  }
  const mode = isCompany ? 'COMPANY_TAX_INFO' : 'BUYER_PROVIDED_INFO';
  const misaCfg = getIntegrations(branch_id).channels?.misa || {};
  const providerReady = Misa.isLive(misaCfg);
  const provider = providerReady ? 'misa' : 'pending';
  const status = providerReady ? 'QUEUED' : 'PENDING_PROVIDER';
  const timeNow = now();
  const requestSnapshot = parseJson(inv.request_snapshot, {});
  requestSnapshot.customer_mode = mode;
  requestSnapshot.buyer = {
    name,
    company: String(customer.company || ''),
    tax_code,
    address: String(customer.address || ''),
    email: String(customer.email || ''),
    phone: String(customer.phone || ''),
  };
  const update = db.prepare(`UPDATE e_invoices SET
      customer_mode=?, buyer_name=?, buyer_tax_code=?, buyer_address=?, buyer_email=?, buyer_phone=?,
      request_snapshot=?, invoice_status=?, provider=?, next_retry_at=NULL, updated_at=?,
      error_code=NULL,error_message=NULL
    WHERE id=? AND invoice_status=? AND COALESCE(attempt_count,0)=0
      AND COALESCE(provider_invoice_id,'')=''`).run(
    mode, name, tax_code, String(customer.address || ''), String(customer.email || ''), String(customer.phone || ''),
    JSON.stringify(requestSnapshot), status, provider, timeNow, inv.id, inv.invoice_status);
  if (update.changes !== 1) {
    throw Object.assign(new Error(
      'Hóa đơn vừa bắt đầu gửi nhà cung cấp; không thể đổi thông tin người mua.'),
    { status: 409 });
  }
  const order = getOrder(order_id);
  const savedCustomer = {
    ...(parseJson(order?.customer_json, {}) || {}),
    ...requestSnapshot.buyer,
    invoice_request: true,
    invoice_customer_name: name,
  };
  db.prepare(`UPDATE orders SET einvoice_status=?,customer_json=?,invoice_choice='issued'
    WHERE id=? AND branch_id=?`).run(
    status, JSON.stringify(savedCustomer), order_id, branch_id);
  writeAuditLog({
    order_id,
    e_invoice_id: inv.id,
    actor_id: actor,
    actor_role: 'staff',
    action: 'UPDATE_BUYER',
    old_status: inv.invoice_status,
    new_status: status,
    reason: `Khách yêu cầu hóa đơn ${isCompany ? 'CÔNG TY (MST ' + tax_code + ')' : 'cá nhân'} sau thanh toán`,
    payload_snapshot: JSON.stringify({ mode, buyer: { name, tax_code, email: customer.email || '' } })
  });
  emit('einvoice:queued', { id: inv.id, order_id, status }, branch_id);
  // Âm thầm lưu/bổ sung hồ sơ khách từ thông tin HĐ vừa khai (tự nuốt lỗi).
  silentSaveFromInvoice(requestSnapshot.buyer, branch_id);
  return get(inv.id);
}

/**
 * Reconciliation dashboard query for accountants
 */
export function getReconciliation(branch_id = 'sala', filters = {}) {
  const limit = Math.max(1, Math.min(200, parseInt(filters.limit) || 100));
  // A bill can have cancelled/replacement/allocation rows. Select the same
  // canonical row as the paid-bill ledger so one bill never multiplies revenue.
  const canonicalInvoiceJoin = `LEFT JOIN e_invoices e ON e.id=(
    SELECT x.id FROM e_invoices x
    WHERE x.branch_id=o.branch_id AND x.order_id=o.id
    ORDER BY CASE WHEN x.idempotency_key='einv:'||x.branch_id||':'||x.order_id
      THEN 0 ELSE 1 END,x.created_at DESC LIMIT 1
  )`;
  let query = `
    SELECT 
      o.id as order_id, o.bill_no, o.total as order_total, o.paid_at,
      e.id as e_invoice_id, e.invoice_no, e.invoice_status, e.buyer_name, e.buyer_tax_code, e.error_message, e.issued_at
    FROM orders o
    ${canonicalInvoiceJoin}
    WHERE o.branch_id = ? AND o.status = 'paid'
  `;
  const params = [branch_id];

  if (filters.status) {
    if (filters.status === 'MISSING') {
      query += ` AND (e.id IS NULL OR e.invoice_status IN ('FAILED', 'NOT_CREATED'))`;
    } else {
      query += ` AND e.invoice_status = ?`;
      params.push(filters.status);
    }
  }

  if (filters.date_from) {
    query += ` AND o.paid_at >= ?`;
    params.push(filters.date_from);
  }
  if (filters.date_to) {
    query += ` AND o.paid_at <= ?`;
    params.push(filters.date_to);
  }

  query += ` ORDER BY o.paid_at DESC LIMIT ?`;
  params.push(limit);

  const rows = db.prepare(query).all(...params);

  // Compute overall totals for reconciliation card
  const summary = db.prepare(`
    SELECT 
      COUNT(o.id) as total_bills,
      SUM(o.total) as total_revenue,
      SUM(CASE WHEN e.invoice_status = 'ISSUED' THEN 1 ELSE 0 END) as issued_count,
      SUM(CASE WHEN e.invoice_status IN ('QUEUED', 'SENDING', 'RETRYING', 'PROCESSING',
        'CANCELLING', 'PENDING_PROVIDER', 'PENDING_EDGE_SYNC') THEN 1 ELSE 0 END) as queued_count,
      SUM(CASE WHEN e.id IS NULL OR e.invoice_status IN ('FAILED', 'NOT_CREATED') THEN 1 ELSE 0 END) as missing_count
    FROM orders o
    ${canonicalInvoiceJoin}
    WHERE o.branch_id = ? AND o.status = 'paid'
  `).get(branch_id);

  return {
    summary: {
      total_bills: summary.total_bills || 0,
      total_revenue: summary.total_revenue || 0,
      issued_count: summary.issued_count || 0,
      queued_count: summary.queued_count || 0,
      missing_count: summary.missing_count || 0,
    },
    items: rows
  };
}

/**
 * Returns summary of e-invoices for the shift before closing
 */
export function getShiftInvoiceSummary(branch_id = 'sala', shift_id) {
  // If MISA integration is disabled, do not block closing shift
  const misaCfg = getIntegrations(branch_id).channels?.misa || {};
  if (!misaCfg.enabled) {
    const payments = db.prepare(`SELECT COUNT(DISTINCT p.order_id) as count
      FROM payments p JOIN orders o ON o.id=p.order_id
      WHERE p.shift_id=? AND o.branch_id=?`).get(shift_id, branch_id);
    return {
      total_bills: payments?.count || 0,
      issued_count: 0,
      queued_count: 0,
      failed_count: 0,
      missing_count: 0,
      can_close: true
    };
  }

  // Find all payments made in this shift
  const payments = db.prepare(`SELECT DISTINCT p.order_id FROM payments p
    JOIN orders o ON o.id=p.order_id WHERE p.shift_id=? AND o.branch_id=?`).all(shift_id, branch_id);
  const orderIds = payments.map(p => p.order_id);

  if (!orderIds.length) {
    return {
      total_bills: 0,
      issued_count: 0,
      queued_count: 0,
      failed_count: 0,
      missing_count: 0,
      can_close: true
    };
  }

  // Query database
  const placeholders = orderIds.map(() => '?').join(',');
  const stats = db.prepare(`
    SELECT 
      COUNT(o.id) as total_bills,
      SUM(CASE WHEN e.invoice_status = 'ISSUED' THEN 1 ELSE 0 END) as issued_count,
      SUM(CASE WHEN e.invoice_status IN ('QUEUED', 'SENDING', 'RETRYING', 'PROCESSING',
        'CANCELLING', 'PENDING_PROVIDER', 'PENDING_EDGE_SYNC') THEN 1 ELSE 0 END) as queued_count,
      SUM(CASE WHEN e.invoice_status = 'FAILED' THEN 1 ELSE 0 END) as failed_count,
      SUM(CASE WHEN e.id IS NULL OR e.invoice_status = 'NOT_CREATED' THEN 1 ELSE 0 END) as missing_count
    FROM orders o
    LEFT JOIN e_invoices e ON e.id=(
      SELECT x.id FROM e_invoices x
      WHERE x.branch_id=o.branch_id AND x.order_id=o.id
      ORDER BY CASE WHEN x.idempotency_key='einv:'||x.branch_id||':'||x.order_id
        THEN 0 ELSE 1 END,x.created_at DESC LIMIT 1
    )
    WHERE o.branch_id=? AND o.id IN (${placeholders})
  `).get(branch_id, ...orderIds);

  const missing = stats.missing_count || 0;
  const failed = stats.failed_count || 0;

  return {
    total_bills: stats.total_bills || 0,
    issued_count: stats.issued_count || 0,
    queued_count: stats.queued_count || 0,
    failed_count: failed,
    missing_count: missing,
    // Strictly block closing if any PAID bills do not have an associated e-invoice record
    can_close: missing === 0 && failed === 0
  };
}

/**
 * Customer self-service request (from iPad or QR checkout)
 */
export function customerRequest(order_id, { decision = 'issue', customer = {} } = {}, branch_id = 'sala') {
  const order = getOrder(order_id);
  if (!order || order.branch_id !== branch_id) throw new Error('Đơn hàng không tồn tại');
  if (order.status !== 'paid') throw new Error('Chỉ xuất hóa đơn cho đơn hàng đã thanh toán');

  if (decision === 'decline') {
    db.prepare(`UPDATE orders SET invoice_choice = 'declined' WHERE id = ?`).run(order_id);
    audit('invoice.customer_declined', { order: order_id, bill_no: order.bill_no || null }, branch_id);
    archiveOrder(getOrder(order_id));
    emit('invoice:choice', { order_id, choice: 'declined' }, branch_id);
    
    // Compliance (NĐ 70/2025): Even if declined, queue an invoice with customer_mode = 'NO_BUYER_INFO'
    createInvoiceRequest(order_id, 'NO_BUYER_INFO', {}, branch_id, 'customer_decline');

    return { ok: true, choice: 'declined' };
  }

  // ĐÃ có bản ghi HĐĐT cho đơn này → đây là SỬA thông tin người mua (từ nút
  // "Xuất VAT" ở Lịch sử), KHÔNG phải tạo mới. Dùng upgradeBuyer: CHƯA phát hành
  // (chưa có số) thì cập nhật + re-queue; ĐÃ có số thì chặn (phải hủy/thay thế
  // theo NĐ 70). Trước đây rơi vào createInvoiceRequest → "return existing" nên
  // đổi thông tin KHÔNG ăn (sự cố 06/08/2026).
  const existingInv = getInvoiceByOrder(order_id, branch_id);
  if (existingInv && existingInv.invoice_status !== 'CANCELLED') {
    const updated = upgradeBuyer(order_id, customer, branch_id, 'customer_self_service');
    db.prepare(`UPDATE orders SET invoice_choice = 'issued' WHERE id = ?`).run(order_id);
    archiveOrder(getOrder(order_id));
    emit('invoice:choice', { order_id, choice: 'issued', invoice_no: updated.invoice_no || null }, branch_id);
    return { ok: true, choice: 'updated', invoice: updated };
  }

  const phone = String(customer.phone || '').trim();
  const email = String(customer.email || '').trim();
  if (!phone || !email) throw new Error('Vui lòng nhập số điện thoại và email để nhận hóa đơn');

  const buyerInfo = {
    name: customer.name || customer.company || '',
    company: customer.company || customer.name || '',
    tax_code: String(customer.tax_code || '').replace(/\s+/g, ''),
    address: customer.address || '',
    phone,
    email
  };

  const mode = buyerInfo.tax_code ? 'COMPANY_TAX_INFO' : 'BUYER_PROVIDED_INFO';
  const inv = createInvoiceRequest(order_id, mode, buyerInfo, branch_id, 'customer_self_service');
  db.prepare(`UPDATE orders SET invoice_choice = 'issued' WHERE id = ?`).run(order_id);
  emit('invoice:choice', { order_id, choice: 'issued', invoice_no: inv.invoice_no }, branch_id);
  
  return { ok: true, choice: 'issued', invoice: inv };
}

function writeAuditLog({ order_id, e_invoice_id, actor_id, actor_role, action, old_status, new_status, reason, payload_snapshot, response_snapshot }) {
  db.prepare(`
    INSERT INTO invoice_audit_logs (
      id, order_id, e_invoice_id, actor_id, actor_role, action,
      old_status, new_status, reason, payload_snapshot, response_snapshot, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    uid('eial_'), order_id, e_invoice_id ?? null, actor_id ?? null,
    actor_role ?? null, action, old_status ?? null, new_status ?? null,
    reason ?? null, payload_snapshot ?? null, response_snapshot ?? null, now()
  );
}
