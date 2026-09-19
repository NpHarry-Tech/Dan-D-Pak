// MISA meInvoice — PHÁT HÀNH, TRA TRẠNG THÁI, HỦY hóa đơn.

import { callJson, authHeaders, authHeadersDeveloperPortal, sanitize, MisaError } from './client.js';
import { endpointUrl, isDeveloperPortal } from './config.js';
import { withToken } from './auth.js';
import { buildPublishPayload, refId } from './payload.js';
import { publishDeveloperPortal, portalRefId } from './developerPortal.js';
import { fetchTemplates } from './company.js';

/// Header nghiệp vụ đúng provider của cfg — v3 mang CompanyTaxCode, Developer
/// Portal mang ClientID (xem client.js).
function businessHeaders(token, cfg) {
  return isDeveloperPortal(cfg)
    ? authHeadersDeveloperPortal(token, cfg.clientId)
    : authHeaders(token, cfg.taxCode);
}

function unwrap(body) {
  let value = body?.data ?? body?.Data ?? body ?? {};
  for (let i = 0; i < 3 && typeof value === 'string'; i += 1) {
    try { value = JSON.parse(value); } catch { break; }
  }
  return value;
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
  const logicalRef = typeof snapshotRef === 'string' ? snapshotRef : refId(snapshotRef);
  const portal = isDeveloperPortal(cfg);
  const ref = portal ? portalRefId(logicalRef) : logicalRef;
  const url = portal
    ? `${endpointUrl(cfg, 'status')}?inputType=2&invoiceWithCode=${String(cfg.invoiceCodeType !== 'WITHOUT_CODE')}&invoiceCalcu=${String(cfg.invoiceType === 'CASH_REGISTER')}`
    : `${endpointUrl(cfg, 'status')}?refId=${encodeURIComponent(ref)}`;
  try {
    const body = await withToken(cfg, (token) => callJson(url, {
      method: portal ? 'POST' : 'GET',
      headers: businessHeaders(token, cfg),
      ...(portal ? { body: JSON.stringify([ref]) } : {}),
    }, 15000));
    const unwrapped = unwrap(body);
    const d = Array.isArray(unwrapped) ? unwrapped[0] : unwrapped;
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

  let payload;
  try {
    payload = buildPublishPayload({ snapshot, cfg, company });
  } catch (e) {
    // Lỗi dựng payload (lệch tiền, vượt 400 dòng…) là lỗi DỮ LIỆU — retry
    // không giúp gì, phải dừng ngay để người vận hành thấy lỗi thật.
    throw e instanceof MisaError ? e : new MisaError(e.message, { retryable: false, code: 'PAYLOAD_ERROR' });
  }
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
  const portal = isDeveloperPortal(cfg);

  let kq;
  try {
    if (portal) {
      // Cấu hình cũ chỉ lưu GUID mẫu. Tự đồng bộ lại mẫu số thật một lần để
      // bill đang FAILED có thể retry ngay sau deploy, không buộc cập nhật app.
      let templateNo = String(cfg.templateNo || '').trim();
      if (!templateNo) {
        const templates = await fetchTemplates(cfg);
        const selected = templates.find((t) => t.id === cfg.templateId);
        templateNo = String(selected?.templateNo || '').trim();
      }
      if (!templateNo) {
        throw new MisaError('Không tìm thấy mẫu số InvTemplateNo của mẫu hóa đơn đã chọn.', {
          retryable: false, code: 'MISSING_TEMPLATE_NO',
        });
      }
      kq = await withToken(cfg, (token) => publishDeveloperPortal({
        url, token, clientId: cfg.clientId, payload, templateNo,
      }));
    } else {
      const body = await withToken(cfg, (token) => callJson(url, {
        method: 'POST',
        headers: authHeaders(token, cfg.taxCode),
        body: JSON.stringify(payload),
      }, 25000));
      kq = normalizeResult(unwrap(body));
    }
  } catch (e) {
    // MISA báo RefID đã tồn tại = hóa đơn đã phát hành từ lần trước. Đồng bộ
    // lại thay vì coi là lỗi. 'DUPLICATE_REFID'/regex = mã v3 cũ;
    // 'InvoiceDuplicated' = mã Developer Portal (nguyên văn theo yêu cầu bàn giao).
    const trung = e instanceof MisaError
      && (e.misaCode === 'DUPLICATE_REFID' || e.misaCode === 'InvoiceDuplicated'
        || /đã tồn tại|already exist/i.test(e.message));
    if (trung) {
      const daCo = await getInvoiceStatus(ref, cfg);
      if (daCo?.invoice_no) return { ...daCo, deduplicated: true };
    }
    // Hết giờ / đứt mạng: MISA CÓ THỂ đã nhận. Gắn cờ để lần sau tra trước.
    if (e instanceof MisaError && e.retryable) e.mayHaveLanded = true;
    throw e;
  }

  if (!kq.invoice_no && !kq.transaction_id) {
    throw new MisaError(
      'MISA nhận request nhưng không trả số hóa đơn lẫn mã giao dịch.',
      { retryable: false, code: 'EMPTY_RESULT', body: sanitize(kq.raw) },
    );
  }
  return kq;
}

/// SendEmailStatus nguyên văn theo tài liệu Developer Portal (xác nhận thật
/// 2026-09-19): 0 chưa gửi, 1 đang gửi, 2 lỗi, 3 đã gửi, 4 yêu cầu gửi.
const SEND_EMAIL_STATUS = { 0: 'NOT_SENT', 1: 'SENDING', 2: 'SEND_ERROR', 3: 'SENT', 4: 'SEND_REQUESTED' };

/// Gửi email hóa đơn ĐÃ PHÁT HÀNH cho khách. CHỈ Developer Portal — API v3 cũ
/// không có đường dẫn này trong tài liệu đưa xuống.
export async function sendInvoiceEmail(cfg, { transactionId, receiverName = '', receiverEmail, ccEmail = '', replyEmail = '' } = {}) {
  if (!isDeveloperPortal(cfg)) {
    throw new MisaError('Gửi email hóa đơn hiện chỉ hỗ trợ MISA Developer Portal.', { retryable: false, code: 'UNSUPPORTED_PROVIDER' });
  }
  if (!transactionId) throw new MisaError('Thiếu mã giao dịch (TransactionID) để gửi email.', { retryable: false, code: 'MISSING_TRANSACTION_ID' });
  if (!receiverEmail) throw new MisaError('Thiếu email người nhận.', { retryable: false, code: 'MISSING_EMAIL' });

  const url = endpointUrl(cfg, 'sendEmail');
  const body = await withToken(cfg, (token) => callJson(url, {
    method: 'POST',
    headers: businessHeaders(token, cfg),
    body: JSON.stringify({
      SendEmailDatas: [{
        TransactionID: transactionId,
        ReceiverName: receiverName,
        ReceiverEmail: receiverEmail,
        CCEmail: ccEmail,
        ReplyEmail: replyEmail,
      }],
      IsInvoiceCode: String(cfg.invoiceCodeType || '') !== 'WITHOUT_CODE',
      IsInvoiceCalculatingMachine: String(cfg.invoiceType || '') === 'CASH_REGISTER',
    }),
  }, 20000));

  const rows = Array.isArray(body?.Data) ? body.Data : (Array.isArray(body?.data) ? body.data : []);
  const row = rows.find((r) => pick(r, 'TransactionID', 'transactionId') === transactionId) || rows[0] || {};
  const statusCode = Number(pick(row, 'SendEmailStatus', 'sendEmailStatus'));
  if (body?.Success === false || statusCode === 2) {
    throw new MisaError(
      String(pick(row, 'ErrorCode') || body?.DescriptionErrorCode || 'MISA từ chối gửi email hóa đơn.'),
      { retryable: true, code: String(pick(row, 'ErrorCode') || body?.ErrorCode || ''), body: sanitize(body) },
    );
  }
  return {
    transactionId: String(pick(row, 'TransactionID', 'transactionId') || transactionId),
    status: SEND_EMAIL_STATUS[statusCode] || 'UNKNOWN',
  };
}

/// Tải file hóa đơn ĐÃ PHÁT HÀNH (mặc định PDF; Xml/Html/All qua downloadDataType).
/// CHỈ Developer Portal — API v3 cũ không có đường dẫn này trong tài liệu đưa xuống.
export async function downloadInvoiceFile(cfg, { transactionIds, downloadDataType = 'Pdf' } = {}) {
  if (!isDeveloperPortal(cfg)) {
    throw new MisaError('Tải hóa đơn hiện chỉ hỗ trợ MISA Developer Portal.', { retryable: false, code: 'UNSUPPORTED_PROVIDER' });
  }
  const ids = (Array.isArray(transactionIds) ? transactionIds : [transactionIds]).filter(Boolean);
  if (!ids.length) throw new MisaError('Thiếu mã giao dịch (TransactionID) để tải hóa đơn.', { retryable: false, code: 'MISSING_TRANSACTION_ID' });

  const query = new URLSearchParams({
    downloadDataType,
    invoiceWithCode: String(String(cfg.invoiceCodeType || '') !== 'WITHOUT_CODE'),
    invoiceCalcu: String(String(cfg.invoiceType || '') === 'CASH_REGISTER'),
  });
  const url = `${endpointUrl(cfg, 'download')}?${query}`;
  const body = await withToken(cfg, (token) => callJson(url, {
    method: 'POST',
    headers: businessHeaders(token, cfg),
    body: JSON.stringify(ids),
  }, 20000));

  if (body?.Success === false) {
    throw new MisaError(
      String(body?.DescriptionErrorCode || body?.ErrorCode || 'MISA từ chối tải hóa đơn.'),
      { retryable: true, code: String(body?.ErrorCode || ''), body: sanitize(body) },
    );
  }
  const rows = Array.isArray(body?.Data) ? body.Data : (Array.isArray(body?.data) ? body.data : []);
  return rows.map((r) => ({
    transactionId: String(pick(r, 'TransactionID', 'transactionId') || ''),
    // Field "data" (chữ thường) đúng theo tài liệu — khác mọi field khác trong
    // API này đều viết hoa chữ cái đầu.
    data: String(pick(r, 'data', 'Data') || ''),
    errorCode: String(pick(r, 'ErrorCode', 'errorCode') || ''),
  }));
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
    headers: businessHeaders(token, cfg),
    body: JSON.stringify({ RefID: ref, CancelReason: String(reason || '').slice(0, 500) }),
  }, 20000));
  return sanitize(body);
}
