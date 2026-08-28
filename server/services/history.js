// Order & invoice history: review past orders, rebuild receipts, support reprint.
// Read-only over orders/payments/invoices — like KiotViet "Lịch sử bán hàng" / Odoo orders.
import { db } from '../db.js';
import { getPrintConfig } from './settings.js';
import { returnedQtyByItem } from './returns.js';

function customerNameOf(raw) {
  try {
    const customer = JSON.parse(raw || '{}');
    return customer.name || customer.company || '';
  } catch {
    return '';
  }
}

// Đọc số tiền VND thành chữ tiếng Việt.
export function moneyToWords(n) {
  n = Math.round(Number(n) || 0);
  if (n === 0) return 'Không đồng';
  const d = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
  const readTriple = (num, full) => {
    const tram = Math.floor(num / 100), chuc = Math.floor((num % 100) / 10), donvi = num % 10;
    let s = '';
    if (full || tram > 0) s += d[tram] + ' trăm';
    if (chuc > 1) { s += ' ' + d[chuc] + ' mươi'; if (donvi === 1) s += ' mốt'; else if (donvi === 5) s += ' lăm'; else if (donvi > 0) s += ' ' + d[donvi]; }
    else if (chuc === 1) { s += ' mười'; if (donvi === 5) s += ' lăm'; else if (donvi > 0) s += ' ' + d[donvi]; }
    else if (donvi > 0) { if (full || tram > 0) s += ' lẻ'; s += ' ' + d[donvi]; }
    return s.trim();
  };
  const units = ['', ' nghìn', ' triệu', ' tỷ'];
  const groups = [];
  let x = n;
  while (x > 0) { groups.unshift(x % 1000); x = Math.floor(x / 1000); }
  let words = '';
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    if (g === 0) continue;
    const isFull = i > 0;
    words += ' ' + readTriple(g, isFull && words.trim() !== '') + units[groups.length - 1 - i];
  }
  words = words.trim().replace(/\s+/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1) + ' đồng';
}

export const SALES_HISTORY_RETENTION_DAYS = 365;

function defaultHistoryFrom() {
  return new Date(Date.now() - SALES_HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

export function listOrderHistory(branch_id = 'sala', {
  limit = 100, page = 1, q = '', channel = '', from = '', to = '',
} = {}) {
  const params = [branch_id];
  let sql = `SELECT o.id, o.bill_no, o.channel, o.status, o.total, o.subtotal, o.discount, o.created_at, o.paid_at,
      o.online_channel, o.online_ref, o.invoice_id, o.customer_json, t.code AS table_code, i.invoice_no
    FROM orders o
    LEFT JOIN tables t ON t.id=o.table_id
    LEFT JOIN invoices i ON i.id=o.invoice_id
    WHERE o.branch_id=? AND o.status='paid'`;
  if (channel) { sql += ' AND o.channel=?'; params.push(channel); }
  const effectiveFrom = from || defaultHistoryFrom();
  if (effectiveFrom) { sql += ' AND COALESCE(o.paid_at,o.created_at) >= ?'; params.push(effectiveFrom); }
  if (to) { sql += ' AND COALESCE(o.paid_at,o.created_at) <= ?'; params.push(to); }
  // TÌM THEO TỪ KHOÁ Ở SERVER (không chỉ lọc trong 3000 đơn gần nhất): search bill
  // của ngày cũ trước đây bị trượt vì LIMIT 3000 cắt trước khi lọc → user tưởng
  // "lịch sử bị xoá" (thực ra đơn vẫn còn). Có từ khoá → LIKE thẳng trên toàn bộ
  // đơn, tìm ra bill bất kỳ ngày nào.
  const rawQ = String(q || '').replace(/^#/, '').trim();
  if (rawQ) {
    const like = `%${rawQ}%`;
    sql += ` AND (o.bill_no LIKE ? OR o.id LIKE ? OR i.invoice_no LIKE ? OR o.online_ref LIKE ? OR t.code LIKE ? OR o.customer_json LIKE ?
      OR EXISTS (SELECT 1 FROM payment_intents pi WHERE pi.order_id=o.id AND pi.branch_id=o.branch_id AND pi.transfer_reference LIKE ?))`;
    params.push(like, like, like, like, like, like, like);
  }
  const max = Math.min(Math.max(parseInt(limit) || 100, 1), 200);
  const pageNo = Math.max(parseInt(page) || 1, 1);
  sql += ' ORDER BY COALESCE(o.paid_at,o.created_at) DESC LIMIT ? OFFSET ?';
  params.push(max, (pageNo - 1) * max);

  const baseRows = db.prepare(sql).all(...params);
  const ids = baseRows.map(row => row.id);
  const methodsByOrder = new Map();
  const itemCountByOrder = new Map();
  const shiftByOrder = new Map();
  const returnsByOrder = new Map();
  if (ids.length) {
    // Lazily ensures the return ledger exists on upgraded databases.
    returnedQtyByItem(ids[0]);
    const slots = ids.map(() => '?').join(',');
    for (const row of db.prepare(`SELECT p.order_id,pl.method,SUM(pl.amount) amount
      FROM payments p JOIN payment_lines pl ON pl.payment_id=p.id
      WHERE p.order_id IN (${slots}) GROUP BY p.order_id,pl.method`).all(...ids)) {
      const methods = methodsByOrder.get(row.order_id) || [];
      methods.push({ method: row.method, amount: row.amount });
      methodsByOrder.set(row.order_id, methods);
    }
    for (const row of db.prepare(`SELECT order_id,COALESCE(SUM(qty),0) n FROM order_items
      WHERE order_id IN (${slots}) AND status!='cancelled' GROUP BY order_id`).all(...ids)) {
      itemCountByOrder.set(row.order_id, row.n);
    }
    // Newest payment first: the first row seen owns the shift-lock state.
    for (const row of db.prepare(`SELECT p.order_id,s.status FROM payments p
      LEFT JOIN shifts s ON s.id=p.shift_id WHERE p.order_id IN (${slots})
      ORDER BY p.order_id,p.created_at DESC`).all(...ids)) {
      if (!shiftByOrder.has(row.order_id)) shiftByOrder.set(row.order_id, row.status);
    }
    for (const row of db.prepare(`SELECT original_order_id order_id,
      COALESCE(SUM(refund_total),0) returned_amount
      FROM order_returns WHERE status='completed' AND original_order_id IN (${slots})
      GROUP BY original_order_id`).all(...ids)) {
      returnsByOrder.set(row.order_id, { returned_amount: Number(row.returned_amount || 0) });
    }
    for (const row of db.prepare(`SELECT original_order_id order_id,COALESCE(SUM(qty),0) returned_qty
      FROM order_return_items WHERE original_order_id IN (${slots}) GROUP BY original_order_id`).all(...ids)) {
      const projection = returnsByOrder.get(row.order_id) || { returned_amount: 0 };
      projection.returned_qty = Number(row.returned_qty || 0);
      returnsByOrder.set(row.order_id, projection);
    }
  }

  let rows = baseRows
    // Tìm kiếm đã lọc ở SQL (rawQ) — không lọc lại bằng matchesSearch để tránh
    // loại nhầm kết quả hợp lệ do khác cách tách token.
    .map(o => ({
    ...o,
    number: o.bill_no || o.id.slice(-6).toUpperCase(),
    methods: methodsByOrder.get(o.id) || [],
    item_count: itemCountByOrder.get(o.id) || 0,
    returned_qty: returnsByOrder.get(o.id)?.returned_qty || 0,
    returned_amount: returnsByOrder.get(o.id)?.returned_amount || 0,
    remaining_refundable_amount: Math.max(0, Number(o.total || 0) - (returnsByOrder.get(o.id)?.returned_amount || 0)),
    return_status: (returnsByOrder.get(o.id)?.returned_qty || 0) <= 0
      ? 'NONE'
      : (returnsByOrder.get(o.id)?.returned_qty || 0) >= (itemCountByOrder.get(o.id) || 0) ? 'FULL' : 'PARTIAL',
    locked: shiftByOrder.get(o.id) === 'closed',   // ca đã kết → khóa thay đổi sau bán
    channel_label: o.online_channel ? ({ grabfood: 'GrabFood', shopeefood: 'ShopeeFood', website: 'Website' }[o.online_channel] || o.online_channel)
      : (o.channel === 'retail' ? 'Bán lẻ' : o.table_code ? 'Bàn ' + o.table_code : 'Tại quầy'),
    customer_name: customerNameOf(o.customer_json),
  }));
  return rows;
}

// Trạng thái ca của bill theo payment mới nhất: 'open' | 'closed' | null (chưa có payment/ca).
// Dùng cho cổng khóa thay đổi sau bán: ca 'closed' → cần PIN Quản lý mới sửa được.
export function billShiftStatus(order_id, branch_id = 'sala') {
  const row = db.prepare(`SELECT s.status FROM payments p
    JOIN shifts s ON s.id=p.shift_id
    JOIN orders o ON o.id=p.order_id
    WHERE p.order_id=? AND o.branch_id=? ORDER BY p.created_at DESC LIMIT 1`).get(order_id, branch_id);
  return row?.status || null;
}

export function orderReceipt(order_id, branch_id = 'sala') {
  const o = db.prepare(`SELECT * FROM orders WHERE id=? AND branch_id=?`).get(order_id, branch_id);
  if (!o) throw new Error('Đơn không tồn tại');
  const cfg = getPrintConfig(branch_id);
  const ein = cfg.einvoice || {};
  const company = {
    name: ein.company || 'CÔNG TY TNHH DỊCH VỤ TIẾP THỊ BCM',
    address: ein.address || '',
    tax_code: ein.taxCode || '',
    phone: ein.phone || '',
    email: ein.email || '',
  };
  const table = o.table_id ? db.prepare(`SELECT code FROM tables WHERE id=?`).get(o.table_id) : null;

  const returnedByItem = returnedQtyByItem(order_id);
  const items = db.prepare(`SELECT oi.id AS order_item_id,oi.name,oi.qty,oi.unit_price,oi.orig_price,oi.note,oi.vat_rate,oi.mods_json,oi.promo_json,oi.menu_item_id,oi.sku_id,oi.item_code,oi.item_barcode,oi.station,
      COALESCE(oi.unit_snapshot,CASE WHEN oi.sku_id IS NOT NULL THEN 'cái' ELSE 'phần' END) unit
    FROM order_items oi
    WHERE oi.order_id=? AND oi.status!='cancelled' ORDER BY oi.created_at`).all(order_id)
    .map(i => { let mods = []; try { mods = JSON.parse(i.mods_json || '[]'); } catch {}
      let promo = null; try { promo = JSON.parse(i.promo_json || 'null'); } catch {}
      return { ...i, mods, promo, returned_qty: returnedByItem[i.order_item_id] || 0,
        line_total: i.qty * i.unit_price, kind: i.sku_id ? 'retail' : 'fnb' }; });

  const lines = db.prepare(`SELECT pl.method, COALESCE(pl.tendered_amount,pl.amount) amount, pl.reference FROM payment_lines pl
    JOIN payments p ON p.id=pl.payment_id WHERE p.order_id=? ORDER BY pl.rowid`).all(order_id);
  const reconciliation = db.prepare(`SELECT pi.id payment_intent_id,pi.transfer_reference reference,pi.amount,
      pi.state,pi.confirmed_at,pi.confirmation_source,pi.confirmed_by,pi.payment_id,pi.payment_line_id
    FROM payment_intents pi WHERE pi.order_id=? AND pi.branch_id=? AND pi.state='SUCCEEDED'
    ORDER BY pi.confirmed_at,pi.created_at`).all(order_id, branch_id);
  // Customer receipt contract intentionally excludes every operational reference.
  // Internal reconciliation is returned separately and rendered outside the white receipt preview.
  const customerLines = lines.map(({ method, amount }) => ({ method, amount }));

  // Thu ngân = người THỰC SỰ bấm thanh toán lần gần nhất (payments.cashier), KHÔNG
  // phải người mở ca (shifts.user_name) — một ca có thể nhiều người dùng chung
  // (BR-SHIFT-001). payments.cashier vắng ở các bản ghi cũ trước migration nên
  // fallback về shifts.user_name để không hiện trống trên hóa đơn cũ.
  const cashierRow = db.prepare(`SELECT p.id AS payment_id, COALESCE(p.cashier, s.user_name) AS user_name, s.status AS shift_status FROM payments p
    LEFT JOIN shifts s ON s.id=p.shift_id WHERE p.order_id=? ORDER BY p.created_at DESC LIMIT 1`).get(order_id);

  const inv = o.invoice_id ? db.prepare(`SELECT invoice_no,lookup_code,issued_at,customer_json FROM invoices WHERE id=?`).get(o.invoice_id) : null;
  const paid = lines.filter(line => Number(line.amount) > 0)
    .reduce((s, l) => s + (Number(l.amount) || 0), 0);
  let customer = {};
  try { customer = JSON.parse((inv?.customer_json) || o.customer_json || '{}') || {}; } catch {}
  const namedInvoiceBuyer = !!inv || customer.invoice_request === true
    || ['requested', 'issued'].includes(String(o.invoice_choice || ''));
  const receiptCustomerName = namedInvoiceBuyer
    ? (customer.name || customer.company || 'Bán cho người tiêu dùng')
    : 'Bán cho người tiêu dùng';

  const total = o.total;
  const returnedQty = Object.values(returnedByItem).reduce((sum, qty) => sum + Number(qty || 0), 0);
  const soldQty = items.reduce((sum, item) => sum + Number(item.qty || 0), 0);
  const returnedAmount = Number(db.prepare(`SELECT COALESCE(SUM(refund_total),0) total FROM order_returns
    WHERE original_order_id=? AND status='completed'`).get(order_id)?.total || 0);
  const returnStatus = returnedQty <= 0 ? 'NONE' : returnedQty >= soldQty ? 'FULL' : 'PARTIAL';
  const vat = Number(o.vat_amount) || 0;
  const goods = Number(o.goods_amount) || Math.max(0, total - vat);
  const rates = [...new Set(items.map(item => Number(item.vat_rate) || 0).filter(rate => rate > 0))];
  const vatRate = rates.length === 1 ? rates[0] : null;

  return {
    order_id,
    payment_id: cashierRow?.payment_id || null,
    number: o.bill_no || o.id.slice(-6).toUpperCase(),
    bill_no: o.bill_no || o.id.slice(-6).toUpperCase(),
    company,
    customer: { name: receiptCustomerName, tax_code: namedInvoiceBuyer ? (customer.tax_code || '') : '', address: namedInvoiceBuyer ? (customer.address || '') : '', email: namedInvoiceBuyer ? (customer.email || '') : '' },
    cashier: cashierRow?.user_name || '',
    shift_status: cashierRow?.shift_status || null,
    locked: cashierRow?.shift_status === 'closed',   // ca đã kết → khóa thay đổi sau bán
    table_code: table?.code, channel: o.channel, online_channel: o.online_channel, online_ref: o.online_ref,
    status: o.status,
    return_status: returnStatus,
    returned_qty: returnedQty,
    returned_amount: returnedAmount,
    remaining_refundable_amount: Math.max(0, Number(total || 0) - returnedAmount),
    note: o.note || '',
    items,
    subtotal: o.subtotal, discount: o.discount, total,
    vat_rate: vatRate, goods_amount: goods, vat_amount: vat, total_words: moneyToWords(total),
    lines: customerLines, payment_reconciliation: reconciliation,
    paid, change: Math.max(0, paid - total), paid_at: o.paid_at, created_at: o.created_at,
    invoice: inv ? {
      invoice_no: inv.invoice_no, symbol: ein.series || '', lookup_code: inv.lookup_code, issued_at: inv.issued_at,
      lookup_url: `https://tracuu.example.vn/?code=${inv.lookup_code}`,
    } : null,
  };
}
