// Real MISA meInvoice adapter.
// When the MISA integration is enabled with production credentials, this performs
// REAL HTTP calls to the MISA meInvoice REST API to authenticate and issue a VAT
// e-invoice. When disabled / sandbox / missing credentials, callers fall back to
// the local mock issuance so the demo keeps working.
//
// NOTE: MISA meInvoice exposes its API per-tenant. Base URLs:
//   sandbox    → https://testapi.meinvoice.vn
//   production → https://api.meinvoice.vn   (or the apiBase the user is given)
// The auth + issue endpoints/field names below follow MISA's published REST
// integration shape. The exact contract (template/series codes, item field
// names, tax category ids) MUST be confirmed against the customer's own MISA
// account & contract — that is data only the account owner has. Everything is
// wrapped so a mismatch degrades gracefully instead of breaking checkout.

import { db } from '../db.js';
import { getPrintConfig } from './settings.js';

const DEFAULT_BASE = { sandbox: 'https://testapi.meinvoice.vn', production: 'https://api.meinvoice.vn' };

// Ngày lập hóa đơn theo GIỜ ĐỊA PHƯƠNG của máy POS (VN). Không dùng
// toISOString (UTC): bill lúc 6h sáng +07 sẽ bị lùi sang NGÀY HÔM TRƯỚC →
// sai kỳ kê khai thuế.
function localInvDate(value) {
  const d = value ? new Date(value) : new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// Hình thức thanh toán thật của bill: TM / CK / TM,CK (map từ payment_lines
// đã gom về 4 method chuẩn — cash là TM, còn lại là CK).
function paymentMethodNameFor(orderId) {
  try {
    const rows = db.prepare(`
      SELECT DISTINCT pl.method FROM payment_lines pl
      JOIN payments p ON pl.payment_id = p.id
      WHERE p.order_id = ?`).all(orderId).map(r => r.method);
    if (!rows.length) return 'TM/CK';
    const hasCash = rows.includes('cash');
    const hasNonCash = rows.some(m => m !== 'cash');
    if (hasCash && hasNonCash) return 'TM/CK';
    return hasCash ? 'TM' : 'CK';
  } catch {
    return 'TM/CK';
  }
}

function baseUrl(cfg) {
  let base = '';
  if (cfg.apiBase && /^https?:\/\//.test(cfg.apiBase)) {
    base = cfg.apiBase.replace(/\/+$/, '');
  } else {
    base = DEFAULT_BASE[cfg.environment === 'production' ? 'production' : 'sandbox'];
  }
  if (!base.includes('/api/v3') && !base.includes('/api/v1') && !base.includes('/api/v2')) {
    base += '/api/v3';
  }
  return base;
}

// True only when we have everything needed to attempt a real call.
export function isLive(cfg = {}) {
  return !!(cfg.enabled && cfg.environment === 'production'
    && cfg.taxCode && cfg.appId && cfg.username && cfg.password);
}

async function jsonFetch(url, opts = {}, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    const text = await res.text();
    let body; try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
    return { ok: res.ok, status: res.status, body };
  } finally { clearTimeout(t); }
}

// Authenticate → returns an access token string (throws on failure).
export async function authenticate(cfg) {
  const url = baseUrl(cfg) + '/auth/token';
  const r = await jsonFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appid: cfg.appId, taxcode: cfg.taxCode, username: cfg.username, password: cfg.password }),
  });
  if (!r.ok) throw new Error(`MISA auth lỗi HTTP ${r.status}: ${r.body?.message || r.body?.error || ''}`.trim());
  const token = r.body?.access_token || r.body?.token || r.body?.data?.access_token;
  if (!token) throw new Error('MISA auth: không nhận được access_token (kiểm tra appId/taxCode/tài khoản).');
  return token;
}

// Lightweight connectivity/credentials check used by the Settings "Test kết nối".
export async function testConnection(cfg) {
  if (!cfg.enabled) return { ok: false, mode: 'disabled', message: 'Kênh MISA đang tắt.' };
  if (cfg.environment !== 'production') return { ok: true, mode: 'sandbox', message: 'Đang ở chế độ sandbox — hóa đơn sẽ phát hành nội bộ (mock), chưa gọi MISA thật.' };
  if (!isLive(cfg)) return { ok: false, mode: 'missing', message: 'Thiếu thông tin: cần Mã số thuế, AppID, tài khoản & mật khẩu MISA.' };
  try {
    await authenticate(cfg);
    return { ok: true, mode: 'live', message: 'Kết nối MISA meInvoice thành công — sẵn sàng phát hành hóa đơn thật.' };
  } catch (e) {
    return { ok: false, mode: 'error', message: e.message };
  }
}

// Issue a real e-invoice. `order` is the internal order, `customer` the buyer info.
// Returns { invoice_no, lookup_code, lookup_url, provider:'misa', raw } on success.
export async function issueInvoice(order, customer = {}, items = [], cfg = {}) {
  const token = await authenticate(cfg);

  // Cấu hình thuế lấy từ Cài đặt → HĐĐT (không hardcode): giá bán trên POS
  // mặc định là giá ĐÃ GỒM VAT → phải TÁCH ngược ra tiền hàng + tiền thuế,
  // không được cộng thuế chồng lên (làm tổng hóa đơn ≠ tổng bill).
  const einvCfg = (getPrintConfig(order.branch_id || 'br1')?.einvoice) || {};
  const includesVat = String(einvCfg.priceIncludesVat ?? '1') !== '0';
  const defaultRate = parseFloat(einvCfg.defaultVatRate) || 8;

  const qtyOf = (it) => Number(it.qty) || 1;
  // Giá dòng THU THẬT của khách: đơn giá + topping/mods, nhân số lượng.
  const grossOf = (it) => {
    const mods = Array.isArray(it.mods)
      ? it.mods.reduce((s, m) => s + (parseInt(m?.price) || 0), 0)
      : 0;
    return ((parseInt(it.unit_price) || 0) + mods) * qtyOf(it);
  };
  const lineGross = items.map(grossOf);
  const grossSum = lineGross.reduce((a, b) => a + b, 0);
  const totalAmount = parseInt(order.total) || 0;
  // Giảm giá (voucher/khuyến mãi/giảm tay) = chênh lệch tổng — PHÂN BỔ vào
  // từng dòng theo tỷ trọng để tổng các dòng khớp TUYỆT ĐỐI tổng bill
  // (dòng cuối nhận phần dư làm tròn).
  const scale = grossSum > 0 ? totalAmount / grossSum : 0;
  let allocated = 0;
  const originalInvoiceDetail = items.map((it, i) => {
    const qty = qtyOf(it);
    const isLast = i === items.length - 1;
    const netLine = isLast
      ? totalAmount - allocated
      : Math.round(lineGross[i] * scale);
    allocated += isLast ? 0 : netLine;

    const vatRate = it.vat_rate !== undefined ? Number(it.vat_rate) : defaultRate;
    let amountWithoutVAT;
    let vatAmount;
    if (includesVat) {
      // netLine đã gồm VAT → tách: tiền hàng = net / (1 + rate)
      amountWithoutVAT = Math.round(netLine / (1 + vatRate / 100));
      vatAmount = netLine - amountWithoutVAT;
    } else {
      amountWithoutVAT = netLine;
      vatAmount = Math.round(netLine * (vatRate / 100));
    }
    const unitPrice = qty > 0
      ? Math.round((amountWithoutVAT / qty) * 100) / 100
      : amountWithoutVAT;

    return {
      LineNumber: i + 1,
      ItemName: it.name,
      UnitName: it.unit || 'cái',
      Qty: qty,
      UnitPrice: unitPrice,
      Amount: amountWithoutVAT,
      VATRateName: `${vatRate}%`,
      VATRate: vatRate,
      VATAmount: vatAmount
    };
  });

  const totalAmountWithoutVAT = originalInvoiceDetail.reduce((sum, item) => sum + item.Amount, 0);
  const totalVATAmount = originalInvoiceDetail.reduce((sum, item) => sum + item.VATAmount, 0);
  // Giá gồm VAT: tổng hóa đơn = đúng tổng bill khách trả. Giá chưa VAT:
  // tổng = tiền hàng + thuế.
  const grandTotal = includesVat ? totalAmount : totalAmountWithoutVAT + totalVATAmount;

  const payload = {
    RefID: `einv:${cfg.taxCode}:${order.id}`,
    OrgInvoiceData: {
      IsInvoiceCalculatingMachine: true,
      InvSeries: cfg.series || 'C26MBM',
      InvDate: localInvDate(order.paid_at),
      BuyerLegalName: customer.name || 'Bán cho người tiêu dùng',
      BuyerTaxCode: customer.tax_code || '',
      BuyerAddress: customer.address || '',
      BuyerEmail: customer.email || '',
      BuyerPhone: customer.phone || '',
      PaymentMethodName: paymentMethodNameFor(order.id),
      OriginalInvoiceDetail: originalInvoiceDetail,
      TotalAmountWithoutVAT: totalAmountWithoutVAT,
      TotalVATAmount: totalVATAmount,
      TotalAmount: grandTotal
    }
  };

  const url = baseUrl(cfg) + '/code/itg/invoice-calculating/invoiceandpublish';
  const r = await jsonFetch(url, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json', 
      'Authorization': 'Bearer ' + token,
      'CompanyTaxCode': cfg.taxCode
    },
    body: JSON.stringify(payload),
  }, 20000);

  if (!r.ok) {
    // If the error indicates duplicate RefID, attempt to recover by syncing status
    if (r.body?.errorCode === 'DUPLICATE_REFID' || String(r.body?.message || '').includes('đã tồn tại')) {
      try {
        const synced = await getInvoiceStatus(order.id, cfg);
        return {
          provider: 'misa',
          invoice_no: synced.invoice_no,
          lookup_code: synced.lookup_code,
          tax_authority_code: synced.tax_authority_code,
          lookup_url: synced.lookup_url,
          raw: r.body
        };
      } catch (syncErr) {
        throw new Error(`HĐĐT đã tồn tại trên MISA nhưng không thể đồng bộ: ${syncErr.message}`);
      }
    }
    throw new Error(`MISA phát hành lỗi HTTP ${r.status}: ${r.body?.message || r.body?.error || JSON.stringify(r.body) || ''}`.trim());
  }

  const d = r.body?.data || r.body || {};
  const invoice_no = d.InvNo || d.invoiceNo || d.invoice_no || d.InvoiceNo;
  const lookup_code = d.LookupCode || d.lookupCode || d.lookup_code || d.transactionId;
  const tax_authority_code = d.TaxAuthorityCode || d.taxAuthorityCode || d.tax_authority_code;
  
  if (!invoice_no) {
    throw new Error('MISA: phản hồi không có số hóa đơn.');
  }

  return {
    provider: 'misa',
    invoice_no,
    lookup_code: lookup_code || '',
    tax_authority_code: tax_authority_code || '',
    lookup_url: d.lookupUrl || 'https://www.meinvoice.vn/tra-cuu',
    raw: d,
  };
}

// Fetch status from MISA using refId
export async function getInvoiceStatus(orderId, cfg) {
  const token = await authenticate(cfg);
  const refId = `einv:${cfg.taxCode}:${orderId}`;
  const url = `${baseUrl(cfg)}/invoice/status?refId=${encodeURIComponent(refId)}`;
  
  const r = await jsonFetch(url, {
    method: 'GET',
    headers: { 
      'Authorization': 'Bearer ' + token,
      'CompanyTaxCode': cfg.taxCode
    }
  });

  if (!r.ok) {
    throw new Error(`MISA check status lỗi HTTP ${r.status}: ${r.body?.message || ''}`);
  }

  const d = r.body?.data || r.body || {};
  return {
    invoice_no: d.InvNo || d.invoiceNo || d.invoice_no,
    lookup_code: d.LookupCode || d.lookupCode || d.lookup_code,
    tax_authority_code: d.TaxAuthorityCode || d.taxAuthorityCode || d.tax_authority_code,
    lookup_url: d.lookupUrl || 'https://www.meinvoice.vn/tra-cuu'
  };
}

// Cancel invoice on MISA
export async function cancelInvoice(orderId, reason, cfg) {
  const token = await authenticate(cfg);
  const refId = `einv:${cfg.taxCode}:${orderId}`;
  const url = `${baseUrl(cfg)}/invoice/cancel`;
  
  const r = await jsonFetch(url, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token,
      'CompanyTaxCode': cfg.taxCode
    },
    body: JSON.stringify({
      RefID: refId,
      CancelReason: reason
    })
  });

  if (!r.ok) {
    throw new Error(`MISA hủy hóa đơn lỗi HTTP ${r.status}: ${r.body?.message || ''}`);
  }
  return r.body;
}
