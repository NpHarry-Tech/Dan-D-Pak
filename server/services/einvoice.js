import { db, uid, now, audit } from '../db.js';
import { emit } from '../realtime.js';
import { getOrder } from './orders.js';
import { getIntegrations, getPrintConfig } from './settings.js';
import * as Misa from './misa.js';
import { archiveInvoice, archiveOrder } from './archive.js';

const RETRY_BACKOFF = [10, 30, 60, 300, 900, 1800]; // seconds backoff
const MAX_ATTEMPTS = 10;

/**
 * Creates an e-invoice request in the queue (NOT_CREATED -> QUEUED)
 * Enforces business rules: consumer-sale mode still gets an invoice.
 */
export function createInvoiceRequest(order_id, customer_mode = 'WALK_IN', buyer_info = {}, branch_id = 'br1', actor = 'system') {
  const order = getOrder(order_id);
  if (!order) throw new Error('Đơn hàng không tồn tại');
  if (order.status !== 'paid') throw new Error('Chỉ xuất hóa đơn cho đơn hàng đã thanh toán');

  // Check if an active/issued e-invoice already exists
  const existing = db.prepare(`SELECT * FROM e_invoices WHERE order_id = ? AND invoice_status != 'CANCELLED'`).get(order_id);
  if (existing) {
    return existing;
  }

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

  const id = uid('einv_');
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
  const providerReady = !!misaCfg.enabled;
  const provider = providerReady ? (Misa.isLive(misaCfg) ? 'misa' : 'local') : 'pending';
  const initialStatus = providerReady ? 'QUEUED' : 'PENDING_PROVIDER';

  // Snapshot request body for auditing
  const requestSnapshot = {
    order_id,
    customer_mode,
    buyer: finalBuyer,
    items: order.items || [],
    total: order.total
  };

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
    reason: providerReady
      ? `Tạo yêu cầu HĐĐT tự động theo chế độ ${customer_mode}`
      : `Ghi nhận HĐ đầu ra (MISA chưa bật — chờ phát hành bù) theo chế độ ${customer_mode}`,
    payload_snapshot: JSON.stringify(requestSnapshot)
  });

  emit('einvoice:queued', { id, order_id, status: initialStatus }, branch_id);

  // Return fresh record
  return get(id);
}

/**
 * Backfill: khi bật MISA, đẩy toàn bộ hóa đơn đã ghi nhận lúc MISA off
 * (PENDING_PROVIDER) vào hàng đợi để phát hành thật. Idempotent.
 */
export function requeuePendingProvider(branch_id = 'br1', actor = 'system') {
  const misaCfg = getIntegrations(branch_id).channels?.misa || {};
  if (!misaCfg.enabled) return { requeued: 0 };
  const provider = Misa.isLive(misaCfg) ? 'misa' : 'local';
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

/**
 * Background worker to process the queued/retrying invoices
 */
export async function processInvoiceQueue() {
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
  db.prepare(`UPDATE e_invoices SET invoice_status = 'SENDING', updated_at = ? WHERE id = ?`).run(timeNow, job.id);
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

  const buyer = {
    name: job.buyer_name,
    tax_code: job.buyer_tax_code,
    address: job.buyer_address,
    email: job.buyer_email,
    phone: job.buyer_phone
  };

  try {
    let result;
    if (job.provider === 'misa' && Misa.isLive(misaCfg)) {
      result = await Misa.issueInvoice(order, buyer, order.items || [], misaCfg);
    } else {
      // Mock local issue (sandbox/demo)
      const mockInvoiceNo = String(db.prepare(`SELECT COUNT(*) c FROM e_invoices WHERE provider='local'`).get().c + 1).padStart(8, '0');
      const hex = () => Math.floor(Math.random() * 16).toString(16).toUpperCase();
      const mockTaxAuthorityCode = `MTT-${hex()}${hex()}-${hex()}${hex()}`;
      result = {
        invoice_no: mockInvoiceNo,
        lookup_code: `LOOK-${hex()}${hex()}`,
        lookup_url: 'https://tracuu.meinvoice.vn',
        tax_authority_code: mockTaxAuthorityCode,
        raw: { success: true }
      };
    }

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
    archiveOrder(order);

  } catch (err) {
    const errorMsg = err.message || 'Lỗi không xác định';
    const nextAttempt = job.attempt_count + 1;

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
export async function retryInvoice(e_invoice_id, actor = 'system') {
  const job = get(e_invoice_id);
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
  processJob(get(e_invoice_id)).catch(() => {});

  return get(e_invoice_id);
}

/**
 * Sync status with MISA meInvoice directly for a specific invoice
 */
export async function syncInvoiceStatus(e_invoice_id) {
  const job = get(e_invoice_id);
  if (!job) throw new Error('Không tìm thấy yêu cầu hóa đơn');

  const misaCfg = getIntegrations(job.branch_id).channels?.misa || {};
  if (job.provider === 'misa' && Misa.isLive(misaCfg)) {
    try {
      const statusResult = await Misa.getInvoiceStatus(job.order_id, misaCfg);
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
        return { ok: true, status: 'ISSUED', invoice_no: statusResult.invoice_no };
      }
    } catch (err) {
      throw new Error(`Đồng bộ MISA lỗi: ${err.message}`);
    }
  } else {
    // Local mock sync
    if (job.invoice_status !== 'ISSUED') {
      return retryInvoice(e_invoice_id, 'sync_trigger');
    }
  }

  return { ok: true, status: job.invoice_status };
}

/**
 * Voids/cancels an e-invoice per government regulations
 */
export async function cancelInvoice(e_invoice_id, reason, actor = 'system') {
  const job = get(e_invoice_id);
  if (!job) throw new Error('Không tìm thấy hóa đơn');
  if (job.invoice_status !== 'ISSUED') {
    throw new Error('Chỉ có thể hủy hóa đơn đã được phát hành thành công');
  }
  if (!reason || !reason.trim()) {
    throw new Error('Vui lòng cung cấp lý do hủy hóa đơn');
  }

  const misaCfg = getIntegrations(job.branch_id).channels?.misa || {};
  if (job.provider === 'misa' && Misa.isLive(misaCfg)) {
    try {
      await Misa.cancelInvoice(job.order_id, reason, misaCfg);
    } catch (err) {
      throw new Error(`Hủy hóa đơn trên MISA meInvoice lỗi: ${err.message}`);
    }
  }

  const timeNow = now();
  db.prepare(`
    UPDATE e_invoices 
    SET invoice_status = 'CANCELLED', 
        error_message = ?, 
        updated_at = ? 
    WHERE id = ?
  `).run(`Bị hủy bởi ${actor} lúc ${timeNow}. Lý do: ${reason}`, timeNow, e_invoice_id);

  db.prepare(`UPDATE orders SET einvoice_status = 'CANCELLED', einvoice_id = NULL WHERE id = ?`).run(job.order_id);

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
export function get(id) {
  const i = db.prepare(`SELECT * FROM e_invoices WHERE id = ?`).get(id);
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
export function getInvoiceByOrder(order_id) {
  const i = db.prepare(`SELECT * FROM e_invoices WHERE order_id = ? ORDER BY created_at DESC LIMIT 1`).get(order_id);
  if (!i) return null;
  return get(i.id);
}

/**
 * Khách yêu cầu hóa đơn cá nhân/công ty SAU khi thanh toán (từ Lịch sử):
 * nâng cấp thông tin người mua trên CÙNG bản ghi HĐĐT nếu CHƯA phát hành —
 * tuyệt đối không tạo hóa đơn thứ hai cho một giao dịch. Đã phát hành rồi
 * thì phải đi đường hủy/thay thế theo NĐ 70.
 */
export function upgradeBuyer(order_id, customer = {}, branch_id = 'br1', actor = 'staff') {
  const inv = getInvoiceByOrder(order_id);
  if (!inv) throw new Error('Chưa có bản ghi HĐĐT cho bill này');
  if (inv.invoice_status === 'ISSUED') {
    throw new Error(
      `Bill đã có HĐĐT${inv.invoice_no ? ` số ${inv.invoice_no}` : ''} đã phát hành. ` +
      'Muốn đổi sang hóa đơn công ty phải HỦY/THAY THẾ hóa đơn cũ trước — không được xuất trùng 2 hóa đơn cho 1 giao dịch.');
  }
  if (!['PENDING_PROVIDER', 'QUEUED', 'RETRYING', 'FAILED'].includes(inv.invoice_status)) {
    throw new Error(`HĐĐT đang ở trạng thái ${inv.invoice_status} — thử lại sau ít phút.`);
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
  const providerReady = !!misaCfg.enabled;
  const provider = providerReady ? (Misa.isLive(misaCfg) ? 'misa' : 'local') : 'pending';
  const status = providerReady ? 'QUEUED' : 'PENDING_PROVIDER';
  const timeNow = now();
  db.prepare(`UPDATE e_invoices SET
      customer_mode=?, buyer_name=?, buyer_tax_code=?, buyer_address=?, buyer_email=?, buyer_phone=?,
      invoice_status=?, provider=?, next_retry_at=NULL, updated_at=?
    WHERE id=?`).run(
    mode, name, tax_code, String(customer.address || ''), String(customer.email || ''), String(customer.phone || ''),
    status, provider, timeNow, inv.id);
  db.prepare(`UPDATE orders SET einvoice_status=? WHERE id=?`).run(status, order_id);
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
  return get(inv.id);
}

/**
 * Reconciliation dashboard query for accountants
 */
export function getReconciliation(branch_id = 'br1', filters = {}) {
  const limit = Math.max(1, Math.min(200, parseInt(filters.limit) || 100));
  let query = `
    SELECT 
      o.id as order_id, o.bill_no, o.total as order_total, o.paid_at,
      e.id as e_invoice_id, e.invoice_no, e.invoice_status, e.buyer_name, e.buyer_tax_code, e.error_message, e.issued_at
    FROM orders o
    LEFT JOIN e_invoices e ON o.id = e.order_id
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
      SUM(CASE WHEN e.invoice_status IN ('QUEUED', 'SENDING', 'RETRYING') THEN 1 ELSE 0 END) as queued_count,
      SUM(CASE WHEN e.id IS NULL OR e.invoice_status IN ('FAILED', 'NOT_CREATED') THEN 1 ELSE 0 END) as missing_count
    FROM orders o
    LEFT JOIN e_invoices e ON o.id = e.order_id
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
export function getShiftInvoiceSummary(branch_id = 'br1', shift_id) {
  // If MISA integration is disabled, do not block closing shift
  const misaCfg = getIntegrations(branch_id).channels?.misa || {};
  if (!misaCfg.enabled) {
    const payments = db.prepare(`SELECT COUNT(DISTINCT order_id) as count FROM payments WHERE shift_id = ?`).get(shift_id);
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
  const payments = db.prepare(`SELECT order_id FROM payments WHERE shift_id = ?`).all(shift_id);
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
      SUM(CASE WHEN e.invoice_status IN ('QUEUED', 'SENDING', 'RETRYING') THEN 1 ELSE 0 END) as queued_count,
      SUM(CASE WHEN e.invoice_status = 'FAILED' THEN 1 ELSE 0 END) as failed_count,
      SUM(CASE WHEN e.id IS NULL OR e.invoice_status = 'NOT_CREATED' THEN 1 ELSE 0 END) as missing_count
    FROM orders o
    LEFT JOIN e_invoices e ON o.id = e.order_id
    WHERE o.id IN (${placeholders})
  `).get(...orderIds);

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
export function customerRequest(order_id, { decision = 'issue', customer = {} } = {}, branch_id = 'br1') {
  const order = getOrder(order_id);
  if (!order) throw new Error('Đơn hàng không tồn tại');
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
    uid('eial_'), order_id, e_invoice_id, actor_id, actor_role, action,
    old_status, new_status, reason, payload_snapshot, response_snapshot, now()
  );
}

function parseJson(raw, fallback) {
  try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
}
