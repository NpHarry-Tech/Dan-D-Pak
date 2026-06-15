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

const DEFAULT_BASE = { sandbox: 'https://testapi.meinvoice.vn', production: 'https://api.meinvoice.vn' };

function baseUrl(cfg) {
  if (cfg.apiBase && /^https?:\/\//.test(cfg.apiBase)) return cfg.apiBase.replace(/\/+$/, '');
  return DEFAULT_BASE[cfg.environment === 'production' ? 'production' : 'sandbox'];
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
  const payload = {
    refId: order.id,
    invoiceData: {
      buyerLegalName: customer.name || customer.company || '',
      buyerTaxCode: customer.tax_code || '',
      buyerAddress: customer.address || '',
      buyerEmail: customer.email || '',
      paymentMethodName: 'TM/CK',
      items: items.map((it, i) => ({
        lineNumber: i + 1,
        itemName: it.name,
        quantity: it.qty,
        unitPrice: it.unit_price,
        amountWithoutVat: it.unit_price * it.qty,
        vatRate: it.vat_rate ?? 8,
      })),
      totalAmount: order.total,
    },
  };
  const url = baseUrl(cfg) + '/api/v1/invoices/issue';
  const r = await jsonFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify(payload),
  }, 20000);
  if (!r.ok) throw new Error(`MISA phát hành lỗi HTTP ${r.status}: ${r.body?.message || r.body?.error || ''}`.trim());
  const d = r.body?.data || r.body || {};
  const invoice_no = d.invoiceNo || d.invoice_no || d.InvoiceNo;
  const lookup_code = d.lookupCode || d.lookup_code || d.transactionId || d.LookupCode;
  if (!invoice_no) throw new Error('MISA: phản hồi không có số hóa đơn.');
  return {
    provider: 'misa',
    invoice_no,
    lookup_code: lookup_code || '',
    lookup_url: d.lookupUrl || 'https://www.meinvoice.vn/tra-cuu',
    raw: d,
  };
}
