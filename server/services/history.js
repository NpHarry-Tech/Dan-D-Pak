// Order & invoice history: review past orders, rebuild receipts, support reprint.
// Read-only over orders/payments/invoices — like KiotViet "Lịch sử bán hàng" / Odoo orders.
import { db } from '../db.js';
import { getPrintConfig } from './settings.js';

// Đọc số tiền VND thành chữ tiếng Việt.
function moneyToWords(n) {
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

export function listOrderHistory(branch_id = 'br1', { limit = 60, q = '', channel = '', from = '', to = '' } = {}) {
  const params = [branch_id];
  const search = String(q || '').trim().replace(/^#/, '').toLowerCase();
  let sql = `SELECT o.id, o.bill_no, o.channel, o.status, o.total, o.subtotal, o.discount, o.created_at, o.paid_at,
      o.online_channel, o.online_ref, o.invoice_id, t.code AS table_code, i.invoice_no
    FROM orders o
    LEFT JOIN tables t ON t.id=o.table_id
    LEFT JOIN invoices i ON i.id=o.invoice_id
    WHERE o.branch_id=? AND o.status IN ('paid','void')`;
  if (channel) { sql += ' AND o.channel=?'; params.push(channel); }
  if (from) { sql += ' AND COALESCE(o.paid_at,o.created_at) >= ?'; params.push(from); }
  if (to) { sql += ' AND COALESCE(o.paid_at,o.created_at) <= ?'; params.push(to); }
  if (search) {
    sql += ` AND (
      LOWER(COALESCE(o.bill_no,'')) LIKE ?
      OR LOWER(o.id) LIKE ?
      OR LOWER(COALESCE(t.code,'')) LIKE ?
      OR LOWER(COALESCE(o.online_ref,'')) LIKE ?
      OR LOWER(COALESCE(i.invoice_no,'')) LIKE ?
    )`;
    const like = `%${search}%`;
    params.push(like, like, like, like, like);
  }
  sql += ' ORDER BY COALESCE(o.paid_at,o.created_at) DESC LIMIT ?';
  params.push(Math.min(parseInt(limit) || 60, 300));

  const methodStmt = db.prepare(`SELECT pl.method, SUM(pl.amount) amount
    FROM payment_lines pl JOIN payments p ON p.id=pl.payment_id WHERE p.order_id=? GROUP BY pl.method`);
  const itemCountStmt = db.prepare(`SELECT COALESCE(SUM(qty),0) n FROM order_items WHERE order_id=? AND status!='cancelled'`);
  const shiftStmt = db.prepare(`SELECT s.status FROM payments p JOIN shifts s ON s.id=p.shift_id WHERE p.order_id=? ORDER BY p.created_at DESC LIMIT 1`);

  let rows = db.prepare(sql).all(...params).map(o => ({
    ...o,
    number: o.bill_no || o.id.slice(-6).toUpperCase(),
    methods: methodStmt.all(o.id),
    item_count: itemCountStmt.get(o.id).n,
    locked: shiftStmt.get(o.id)?.status === 'closed',   // ca đã kết → khóa thay đổi sau bán
    channel_label: o.online_channel ? ({ grabfood: 'GrabFood', shopeefood: 'ShopeeFood', website: 'Website' }[o.online_channel] || o.online_channel)
      : (o.channel === 'retail' ? 'Bán lẻ' : o.table_code ? 'Bàn ' + o.table_code : 'Tại quầy'),
  }));
  return rows;
}

// Trạng thái ca của bill theo payment mới nhất: 'open' | 'closed' | null (chưa có payment/ca).
// Dùng cho cổng khóa thay đổi sau bán: ca 'closed' → cần PIN Quản lý mới sửa được.
export function billShiftStatus(order_id, branch_id = 'br1') {
  const row = db.prepare(`SELECT s.status FROM payments p
    JOIN shifts s ON s.id=p.shift_id
    JOIN orders o ON o.id=p.order_id
    WHERE p.order_id=? AND o.branch_id=? ORDER BY p.created_at DESC LIMIT 1`).get(order_id, branch_id);
  return row?.status || null;
}

export function orderReceipt(order_id, branch_id = 'br1') {
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

  const items = db.prepare(`SELECT name,qty,unit_price,mods_json,menu_item_id,sku_id,station FROM order_items
    WHERE order_id=? AND status!='cancelled' ORDER BY created_at`).all(order_id)
    .map(i => { let mods = []; try { mods = JSON.parse(i.mods_json || '[]'); } catch {}
      return { ...i, mods, line_total: i.qty * i.unit_price, kind: i.sku_id ? 'retail' : 'fnb' }; });

  const lines = db.prepare(`SELECT pl.method, pl.amount, pl.reference FROM payment_lines pl
    JOIN payments p ON p.id=pl.payment_id WHERE p.order_id=? ORDER BY pl.rowid`).all(order_id);

  // Thu ngân + trạng thái ca: lấy theo ca làm việc của lần thanh toán (nếu có).
  const cashierRow = db.prepare(`SELECT s.user_name, s.status AS shift_status FROM payments p
    JOIN shifts s ON s.id=p.shift_id WHERE p.order_id=? ORDER BY p.created_at DESC LIMIT 1`).get(order_id);

  const inv = o.invoice_id ? db.prepare(`SELECT invoice_no,lookup_code,issued_at,customer_json FROM invoices WHERE id=?`).get(o.invoice_id) : null;
  const paid = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  let customer = {};
  try { customer = JSON.parse((inv?.customer_json) || o.customer_json || '{}') || {}; } catch {}

  // VAT: giá đã gồm thuế (mặc định) → tách thuế ra từ tổng đã trả để tổng luôn khớp tiền thực thu.
  const vatRate = parseInt(ein.defaultVatRate || '8') || 8;
  const incl = (ein.priceIncludesVat ?? '1') !== '0';
  const total = o.total;
  const goods = incl ? Math.round(total / (1 + vatRate / 100)) : (o.subtotal - (o.discount || 0));
  const vat = incl ? (total - goods) : Math.round(goods * vatRate / 100);

  return {
    order_id,
    number: o.bill_no || o.id.slice(-6).toUpperCase(),
    bill_no: o.bill_no || o.id.slice(-6).toUpperCase(),
    company,
    customer: { name: customer.name || customer.company || '', tax_code: customer.tax_code || '', address: customer.address || '', email: customer.email || '' },
    cashier: cashierRow?.user_name || '',
    shift_status: cashierRow?.shift_status || null,
    locked: cashierRow?.shift_status === 'closed',   // ca đã kết → khóa thay đổi sau bán
    table_code: table?.code, channel: o.channel, online_channel: o.online_channel, online_ref: o.online_ref,
    status: o.status,
    items,
    subtotal: o.subtotal, discount: o.discount, total,
    vat_rate: vatRate, goods_amount: goods, vat_amount: vat, total_words: moneyToWords(total),
    lines, paid, change: Math.max(0, paid - total), paid_at: o.paid_at, created_at: o.created_at,
    invoice: inv ? {
      invoice_no: inv.invoice_no, symbol: ein.series || '', lookup_code: inv.lookup_code, issued_at: inv.issued_at,
      lookup_url: `https://tracuu.example.vn/?code=${inv.lookup_code}`,
    } : null,
  };
}
