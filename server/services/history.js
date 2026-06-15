// Order & invoice history: review past orders, rebuild receipts, support reprint.
// Read-only over orders/payments/invoices — like KiotViet "Lịch sử bán hàng" / Odoo orders.
import { db } from '../db.js';

export function listOrderHistory(branch_id = 'br1', { limit = 60, q = '', channel = '', from = '', to = '' } = {}) {
  const params = [branch_id];
  let sql = `SELECT o.id, o.channel, o.status, o.total, o.subtotal, o.discount, o.created_at, o.paid_at,
      o.online_channel, o.online_ref, o.invoice_id, t.code AS table_code, i.invoice_no
    FROM orders o
    LEFT JOIN tables t ON t.id=o.table_id
    LEFT JOIN invoices i ON i.id=o.invoice_id
    WHERE o.branch_id=? AND o.status IN ('paid','void')`;
  if (channel) { sql += ' AND o.channel=?'; params.push(channel); }
  if (from) { sql += ' AND COALESCE(o.paid_at,o.created_at) >= ?'; params.push(from); }
  if (to) { sql += ' AND COALESCE(o.paid_at,o.created_at) <= ?'; params.push(to); }
  sql += ' ORDER BY COALESCE(o.paid_at,o.created_at) DESC LIMIT ?';
  params.push(Math.min(parseInt(limit) || 60, 300));

  const methodStmt = db.prepare(`SELECT pl.method, SUM(pl.amount) amount
    FROM payment_lines pl JOIN payments p ON p.id=pl.payment_id WHERE p.order_id=? GROUP BY pl.method`);
  const itemCountStmt = db.prepare(`SELECT COALESCE(SUM(qty),0) n FROM order_items WHERE order_id=? AND status!='cancelled'`);

  let rows = db.prepare(sql).all(...params).map(o => ({
    ...o,
    number: o.id.slice(-6).toUpperCase(),
    methods: methodStmt.all(o.id),
    item_count: itemCountStmt.get(o.id).n,
    channel_label: o.online_channel ? ({ grabfood: 'GrabFood', shopeefood: 'ShopeeFood', website: 'Website' }[o.online_channel] || o.online_channel)
      : (o.channel === 'retail' ? 'Bán lẻ' : o.table_code ? 'Bàn ' + o.table_code : 'Tại quầy'),
  }));
  if (q) {
    const s = q.toLowerCase();
    rows = rows.filter(o => o.number.toLowerCase().includes(s) || (o.table_code || '').toLowerCase().includes(s)
      || (o.online_ref || '').toLowerCase().includes(s) || (o.invoice_no || '').toLowerCase().includes(s));
  }
  return rows;
}

export function orderReceipt(order_id, branch_id = 'br1') {
  const o = db.prepare(`SELECT * FROM orders WHERE id=? AND branch_id=?`).get(order_id, branch_id);
  if (!o) throw new Error('Đơn không tồn tại');
  const branch = db.prepare(`SELECT name,address FROM branches WHERE id=?`).get(branch_id);
  const table = o.table_id ? db.prepare(`SELECT code FROM tables WHERE id=?`).get(o.table_id) : null;
  const items = db.prepare(`SELECT name,qty,unit_price,mods_json FROM order_items WHERE order_id=? AND status!='cancelled' ORDER BY created_at`).all(order_id)
    .map(i => { let mods = []; try { mods = JSON.parse(i.mods_json || '[]'); } catch {} return { ...i, mods }; });
  const lines = db.prepare(`SELECT pl.method, pl.amount, pl.reference FROM payment_lines pl
    JOIN payments p ON p.id=pl.payment_id WHERE p.order_id=? ORDER BY pl.rowid`).all(order_id);
  const inv = o.invoice_id ? db.prepare(`SELECT invoice_no,lookup_code FROM invoices WHERE id=?`).get(o.invoice_id) : null;
  const paid = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  return {
    order_id, number: o.id.slice(-6).toUpperCase(), branch: branch?.name, address: branch?.address,
    table_code: table?.code, channel: o.channel, online_channel: o.online_channel, online_ref: o.online_ref,
    status: o.status, items, subtotal: o.subtotal, discount: o.discount, total: o.total,
    lines, paid, change: Math.max(0, paid - o.total), paid_at: o.paid_at, created_at: o.created_at,
    invoice: inv ? { ...inv, lookup_url: `https://tracuu.example.vn/?code=${inv.lookup_code}` } : null,
  };
}
