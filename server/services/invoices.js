// Read-only compatibility for legacy `invoices` rows plus the unified paid-bill
// ledger. All NEW issuance goes through services/einvoice.js and its durable,
// idempotent provider queue; do not add a second direct-issue implementation here.
import { db } from '../db.js';
import { getOrder } from './orders.js';
import { getPrintConfig } from './settings.js';
import { returnedQtyByItem, listReturnsForOrder, returnStatus } from './returns.js';

export function get(id, branch_id = null) {
  const i = branch_id
    ? db.prepare(`SELECT * FROM invoices WHERE id=? AND branch_id=?`).get(id, branch_id)
    : db.prepare(`SELECT * FROM invoices WHERE id=?`).get(id);
  if (!i) return null;
  const ein = getPrintConfig(i.branch_id).einvoice || {};
  return { ...i, customer: JSON.parse(i.customer_json || '{}'),
    symbol: ein.series || '', tax_code_seller: ein.taxCode || '',
    lookup_url: `https://tracuu.example.vn/?code=${i.lookup_code}` };
}
export function byOrder(order_id, branch_id = null) {
  // branch_id != null → khóa theo chi nhánh để chống IDOR (đọc HĐĐT chi nhánh khác).
  const i = branch_id
    ? db.prepare(`SELECT id FROM invoices WHERE order_id=? AND branch_id=? AND status!='cancelled' ORDER BY issued_at DESC LIMIT 1`).get(order_id, branch_id)
    : db.prepare(`SELECT id FROM invoices WHERE order_id=? AND status!='cancelled' ORDER BY issued_at DESC LIMIT 1`).get(order_id);
  return i ? get(i.id, branch_id) : null;
}

const einvoiceState = (raw = '') => {
  const s = String(raw || 'NOT_CREATED').toUpperCase();
  if (s === 'ISSUED') return 'ISSUED';
  if (s === 'FAILED') return 'FAILED';
  if (s === 'CANCELLED') return 'CANCELLED';
  if (['QUEUED', 'SENDING', 'RETRYING', 'PROCESSING', 'CANCELLING'].includes(s)) return 'PROCESSING';
  return 'NOT_ISSUED';
};

const json = (value, fallback) => {
  try { return JSON.parse(value || '') || fallback; } catch { return fallback; }
};

function ledgerRow(row) {
  const buyer = json(row.request_snapshot, {}).buyer || {
    name: row.buyer_name, tax_code: row.buyer_tax_code, address: row.buyer_address,
    email: row.buyer_email, phone: row.buyer_phone,
  };
  const methods = String(row.payment_methods || '').split(',').filter(Boolean);
  const status = einvoiceState(row.invoice_status);
  return {
    order_id: row.order_id,
    bill_id: row.order_id,
    bill_code: row.bill_no || row.order_id,
    bill_status: String(row.bill_status || '').toUpperCase(),
    paid_at: row.paid_at,
    created_at: row.created_at,
    business_type: row.channel === 'retail' ? 'RETAIL' : 'FNB',
    sales_channel: row.channel,
    employee: row.cashier || '',
    shift_id: row.shift_id,
    gross_total: Number(row.goods_amount || row.subtotal || 0),
    discount_total: Number(row.discount || 0),
    surcharge_total: 0,
    packaging_total: 0,
    vat_total: Number(row.vat_amount || 0),
    total: Number(row.total || 0),
    paid_total: Number(row.paid_total || 0),
    payment_methods: methods,
    buyer,
    customer: buyer,
    status: status.toLowerCase(),
    e_invoice_id: row.e_invoice_id,
    einvoice_status: status,
    provider_status: row.invoice_status || 'NOT_CREATED',
    tax_authority_status: row.tax_authority_code ? 'ACCEPTED' : 'WAITING',
    invoice_no: row.invoice_no || '',
    invoice_series: row.invoice_series || '',
    provider: row.provider || '',
    lookup_code: row.lookup_code || '',
    lookup_url: row.lookup_url || '',
    pdf_url: row.pdf_url || '',
    xml_url: row.xml_url || '',
    qr_data: row.qr_data || '',
    error_code: row.error_code || '',
    error_message: row.error_message || '',
    attempt_count: Number(row.attempt_count || 0),
    issued_at: row.issued_at,
    return_status: returnStatus(row.order_id),
  };
}

/** Paid-bill ledger. It deliberately starts from orders, never from MISA rows. */
export function ledger(branch_id = 'sala', query = {}) {
  const q = String(query.q || query.search || '').trim();
  const requestedStatus = String(query.status || '').toUpperCase();
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 50));
  const params = [branch_id];
  let where = `o.branch_id=? AND o.status='paid'`;
  // Keep the normal browsing/search surface bounded to the legally useful
  // rolling year instead of an arbitrary 50 most-recent rows.
  if (!query.date_from) {
    where += ` AND COALESCE(o.paid_at,o.created_at)>=?`;
    params.push(new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString());
  }
  if (q) {
    where += ` AND (o.id LIKE ? OR o.bill_no LIKE ? OR e.invoice_no LIKE ? OR e.buyer_name LIKE ? OR e.buyer_tax_code LIKE ? OR e.buyer_phone LIKE ? OR e.buyer_email LIKE ? OR e.lookup_code LIKE ? OR e.provider_invoice_id LIKE ?)`;
    const like = `%${q}%`;
    params.push(...Array(9).fill(like));
  }
  if (query.date_from) { where += ` AND o.paid_at>=?`; params.push(String(query.date_from)); }
  if (query.date_to) { where += ` AND o.paid_at<=?`; params.push(String(query.date_to)); }
  if (query.business_type) {
    where += String(query.business_type).toUpperCase() === 'RETAIL' ? ` AND o.channel='retail'` : ` AND o.channel!='retail'`;
  }
  if (query.payment_method) {
    where += ` AND EXISTS (SELECT 1 FROM payments px JOIN payment_lines lx ON lx.payment_id=px.id WHERE px.order_id=o.id AND lx.method=?)`;
    params.push(String(query.payment_method));
  }
  const join = `LEFT JOIN e_invoices e ON e.id=(
    SELECT x.id FROM e_invoices x
    WHERE x.branch_id=o.branch_id AND x.order_id=o.id
    ORDER BY CASE WHEN x.idempotency_key='einv:'||x.branch_id||':'||x.order_id
      THEN 0 ELSE 1 END,x.created_at DESC LIMIT 1
  )`;
  const payment = `LEFT JOIN (SELECT p.order_id, SUM(pl.amount) paid_total, GROUP_CONCAT(DISTINCT pl.method) payment_methods,
    MAX(p.cashier) cashier, MAX(p.shift_id) shift_id FROM payments p JOIN payment_lines pl ON pl.payment_id=p.id GROUP BY p.order_id) pay ON pay.order_id=o.id`;
  const normalizedStatus = `CASE
    WHEN UPPER(COALESCE(e.invoice_status,'NOT_CREATED'))='ISSUED' THEN 'ISSUED'
    WHEN UPPER(COALESCE(e.invoice_status,'NOT_CREATED'))='FAILED' THEN 'FAILED'
    WHEN UPPER(COALESCE(e.invoice_status,'NOT_CREATED'))='CANCELLED' THEN 'CANCELLED'
    WHEN UPPER(COALESCE(e.invoice_status,'NOT_CREATED')) IN ('QUEUED','SENDING','RETRYING','PROCESSING','CANCELLING') THEN 'PROCESSING'
    ELSE 'NOT_ISSUED' END`;
  const baseSql = `SELECT o.id order_id,o.bill_no,o.status bill_status,o.channel,o.subtotal,o.goods_amount,o.discount,o.vat_amount,o.total,o.created_at,o.paid_at,
      pay.*,e.id e_invoice_id,e.provider,e.invoice_status,e.invoice_series,e.invoice_no,e.provider_invoice_id,e.tax_authority_code,e.lookup_code,e.lookup_url,e.pdf_url,e.xml_url,e.qr_data,
      e.customer_mode,e.buyer_name,e.buyer_tax_code,e.buyer_address,e.buyer_email,e.buyer_phone,e.error_code,e.error_message,e.attempt_count,e.request_snapshot,e.issued_at,
      ${normalizedStatus} normalized_invoice_status
    FROM orders o ${join} ${payment} WHERE ${where}`;
  const summaryRow = db.prepare(`SELECT COUNT(*) total_bills,
      COALESCE(SUM(CASE WHEN normalized_invoice_status='NOT_ISSUED' THEN 1 ELSE 0 END),0) not_issued,
      COALESCE(SUM(CASE WHEN normalized_invoice_status='PROCESSING' THEN 1 ELSE 0 END),0) processing,
      COALESCE(SUM(CASE WHEN normalized_invoice_status='ISSUED' THEN 1 ELSE 0 END),0) issued,
      COALESCE(SUM(CASE WHEN normalized_invoice_status='FAILED' THEN 1 ELSE 0 END),0) failed,
      COALESCE(SUM(CASE WHEN normalized_invoice_status='FAILED' THEN 1 ELSE 0 END),0) needs_attention,
      COALESCE(SUM(total),0) total_amount FROM (${baseSql})`).get(...params);
  const statusWhere = requestedStatus
    ? `WHERE normalized_invoice_status=? OR UPPER(COALESCE(invoice_status,''))=?`
    : '';
  const statusParams = requestedStatus ? [requestedStatus, requestedStatus] : [];
  const total = Number(db.prepare(`SELECT COUNT(*) n FROM (${baseSql}) ${statusWhere}`)
    .get(...params, ...statusParams).n) || 0;
  const start = (page - 1) * limit;
  const items = db.prepare(`SELECT * FROM (${baseSql}) ${statusWhere}
      ORDER BY paid_at DESC,created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, ...statusParams, limit, start).map(ledgerRow);
  return { summary: summaryRow, items, page, limit, total,
    pages: Math.max(1, Math.ceil(total / limit)) };
}

export function ledgerDetail(order_id, branch_id = 'sala') {
  const page = ledger(branch_id, { q: order_id, limit: 100 });
  const bill = page.items.find(row => row.order_id === order_id);
  if (!bill) throw Object.assign(new Error('Hóa đơn không tồn tại'), { status: 404 });
  const order = getOrder(order_id);
  const document = bill.e_invoice_id ? db.prepare(`SELECT * FROM e_invoices WHERE id=? AND branch_id=?`).get(bill.e_invoice_id, branch_id) : null;
  const snapshot = json(document?.request_snapshot, {});
  const payments = db.prepare(`SELECT p.id,p.cashier,p.shift_id,p.created_at,pl.method,pl.amount,pl.tendered_amount,pl.reference
    FROM payments p JOIN payment_lines pl ON pl.payment_id=p.id WHERE p.order_id=? ORDER BY p.created_at,pl.rowid`).all(order_id);
  const timeline = db.prepare(`SELECT action,old_status,new_status,reason,created_at FROM invoice_audit_logs WHERE order_id=? ORDER BY created_at`).all(order_id);
  const actions = ['VIEW', 'PRINT'];
  if (bill.einvoice_status === 'NOT_ISSUED') actions.push('ISSUE');
  if (bill.einvoice_status === 'FAILED') actions.push('RETRY');
  if (bill.einvoice_status === 'PROCESSING') actions.push('SYNC');
  if (bill.pdf_url) actions.push('DOWNLOAD_PDF');
  if (bill.xml_url) actions.push('DOWNLOAD_XML');
  if (bill.einvoice_status === 'ISSUED' && bill.buyer?.email) actions.push('SEND_EMAIL');
  // Trả hàng liên quan + SL đã trả theo từng dòng (§4 màn Hóa đơn: hiện returned qty).
  const returnedMap = returnedQtyByItem(order_id);
  const returns = listReturnsForOrder(order_id, branch_id);
  const items = (snapshot.items || order.items || []).map(it => {
    const qty = Number(it.qty || 0);
    const unit = Number(it.unit_price || 0);
    const vatRate = Number(it.vat_rate || 0);
    const lineTotal = qty * unit;
    return {
      ...it,
      returned_qty: returnedMap[it.id] || 0,
      line_total: lineTotal,
      vat_amount: Math.round(lineTotal * (vatRate / 100)),
    };
  });
  return {
    bill: { ...bill, return_status: returnStatus(order_id) },
    order: { id: order.id, code: order.bill_no || order.id, branch_id: order.branch_id, table_id: order.table_id, channel: order.channel },
    buyer_snapshot: snapshot.buyer || bill.buyer,
    item_snapshot: items,
    returns,
    totals: {
      gross: bill.gross_total, discount: bill.discount_total, surcharge: bill.surcharge_total,
      packaging: bill.packaging_total, before_vat: bill.total - bill.vat_total,
      vat: bill.vat_total, total: bill.total, paid: bill.paid_total,
      change: Math.max(0, bill.paid_total - bill.total),
    },
    payment_history: payments,
    invoice_document: document ? { ...document, request_snapshot: undefined, response_snapshot: undefined } : null,
    timeline,
    available_actions: actions,
  };
}
