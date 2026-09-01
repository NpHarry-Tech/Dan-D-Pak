// MISA meInvoice — PHÁT HÀNH, TRA TRẠNG THÁI, HỦY hóa đơn.

import { callJson, authHeaders, sanitize, MisaError } from './client.js';
import { endpointUrl } from './config.js';
import { withToken } from './auth.js';
import { buildPublishPayload, refId } from './payload.js';

function unwrap(body) {
  return body?.data ?? body?.Data ?? body ?? {};
}

function pick(d, ...names) {
  for (const n of names) {
    if (d?.[n] !== undefined && d[n] !== null && d[n] !== '') return d[n];
  }
  return undefined;
}

/// Chuẩn hóa kết quả phát hành/tra cứu về một hình dạng duy nhất.
function normalizeResult(d) {
  return {
    provider: 'misa',
    invoice_no: String(pick(d, 'InvNo', 'invoiceNo', 'invoice_no', 'InvoiceNo', 'InvNumber') || ''),
    series: String(pick(d, 'InvSeries', 'invSeries', 'Series') || ''),
    lookup_code: String(pick(d, 'LookupCode', 'lookupCode', 'lookup_code') || ''),
    transaction_id: String(pick(d, 'TransactionID', 'transactionId', 'TransactionId') || ''),
    tax_authority_code: String(
      pick(d, 'TaxAuthorityCode', 'taxAuthorityCode', 'tax_authority_code', 'CQTCode') || '',
    ),
    lookup_url: String(pick(d, 'lookupUrl', 'LookupUrl', 'ViewUrl') || 'https://www.meinvoice.vn/tra-cuu'),
    raw: sanitize(d),
  };
}

/// Tra trạng thái hóa đơn theo RefID của bill.
///
/// Trả `null` khi MISA CHƯA CÓ hóa đơn nào cho bill này (404 / rỗng) — khác hẳn
/// với "gọi lỗi". Người gọi cần phân biệt để quyết định có được phép phát hành
/// hay không.
export async function getInvoiceStatus(snapshotRef, cfg) {
  const ref = typeof snapshotRef === 'string' ? snapshotRef : refId(snapshotRef);
  const url = `${endpointUrl(cfg, 'status')}?refId=${encodeURIComponent(ref)}`;
  try {
    const body = await withToken(cfg, (token) => callJson(url, {
      method: 'GET',
      headers: authHeaders(token, cfg.taxCode),
    }, 15000));
    const d = unwrap(body);
    const kq = normalizeResult(d);
    // Không có số hóa đơn lẫn transaction id = MISA chưa nhận gì.
    if (!kq.invoice_no && !kq.transaction_id) return null;
    return kq;
  } catch (e) {
    if (e instanceof MisaError && e.httpStatus === 404) return null;
    throw e;
  }
}

/// Phát hành hóa đơn.
///
/// CHỐNG TRÙNG (bắt buộc): trước khi gửi, nếu [mayHaveLanded] thì TRA TRẠNG
/// THÁI trước. Đây là tình huống request lần trước hết giờ/đứt mạng nhưng MISA
/// có thể ĐÃ NHẬN — gửi lại như hóa đơn mới là phát hành hai hóa đơn cho một
/// bill, sai sổ thuế và phải làm hóa đơn điều chỉnh để gỡ.
export async function issueInvoice({ snapshot, cfg, company = {}, mayHaveLanded = false }) {
  const ref = refId({
    taxCode: cfg?.taxCode,
    branchId: snapshot?.bill?.branch_id || snapshot?.branch_id,
    orderId: snapshot?.order_id,
    version: snapshot?.schema_version || 1,
  });

  if (mayHaveLanded) {
    const daCo = await getInvoiceStatus(ref, cfg);
    if (daCo?.invoice_no) return { ...daCo, deduplicated: true };
  }

  const payload = buildPublishPayload({ snapshot, cfg, company });
  const invoiceLines = payload.OrgInvoiceData.OriginalInvoiceDetail;
  const descriptionRows = invoiceLines.filter((line) => line.ItemType === 4).length;
  console.info(JSON.stringify({
    event: 'misa.single_invoice_payload',
    total_items_processed: Array.isArray(snapshot?.items) ? snapshot.items.length : 0,
    total_description_rows_injected: descriptionRows,
    invoice_ref_id: payload.RefID,
    unified_single_invoice: true,
  }));
  const url = endpointUrl(cfg, 'publish');

  let body;
  try {
    body = await withToken(cfg, (token) => callJson(url, {
      method: 'POST',
      headers: authHeaders(token, cfg.taxCode),
      body: JSON.stringify(payload),
    }, 25000));
  } catch (e) {
    // MISA báo RefID đã tồn tại = hóa đơn đã phát hành từ lần trước. Đồng bộ
    // lại thay vì coi là lỗi.
    const trung = e instanceof MisaError
      && (e.misaCode === 'DUPLICATE_REFID' || /đã tồn tại|already exist/i.test(e.message));
    if (trung) {
      const daCo = await getInvoiceStatus(ref, cfg);
      if (daCo?.invoice_no) return { ...daCo, deduplicated: true };
    }
    // Hết giờ / đứt mạng: MISA CÓ THỂ đã nhận. Gắn cờ để lần sau tra trước.
    if (e instanceof MisaError && e.retryable) e.mayHaveLanded = true;
    throw e;
  }

  const kq = normalizeResult(unwrap(body));
  if (!kq.invoice_no && !kq.transaction_id) {
    throw new MisaError(
      'MISA nhận request nhưng không trả số hóa đơn lẫn mã giao dịch.',
      { retryable: false, code: 'EMPTY_RESULT', body: sanitize(body) },
    );
  }
  return kq;
}

/// Hủy hóa đơn đã phát hành.
export async function cancelInvoice({ snapshot, cfg, reason }) {
  const ref = refId({
    taxCode: cfg?.taxCode,
    branchId: snapshot?.bill?.branch_id || snapshot?.branch_id,
    orderId: snapshot?.order_id,
    version: snapshot?.schema_version || 1,
  });
  const url = endpointUrl(cfg, 'cancel');
  const body = await withToken(cfg, (token) => callJson(url, {
    method: 'POST',
    headers: authHeaders(token, cfg.taxCode),
    body: JSON.stringify({ RefID: ref, CancelReason: String(reason || '').slice(0, 500) }),
  }, 20000));
  return sanitize(body);
}
