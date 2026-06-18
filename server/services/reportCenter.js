import { db, now } from '../db.js';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdtemp, writeFile, readFile, rm } from 'fs/promises';
import os from 'os';
import path from 'path';

const execFileAsync = promisify(execFile);

export const REPORT_GROUPS = [
  { key: 'sales', label: 'Báo cáo bán hàng' },
  { key: 'inventory', label: 'Báo cáo kho' },
  { key: 'cash', label: 'Báo cáo tiền két' },
  { key: 'debt', label: 'Báo cáo công nợ' },
  { key: 'customers', label: 'Báo cáo quản trị khách hàng' },
  { key: 'staff', label: 'Báo cáo nhân viên' },
];

export const REPORTS = [
  { key: 'sales_overview', group: 'sales', label: 'Báo cáo bán hàng', description: 'Doanh thu, mặt hàng, hóa đơn, kênh bán hàng và phương thức thanh toán.' },
  { key: 'sales_online', group: 'sales', label: 'Bán hàng Online', description: 'GrabFood/ShopeeFood/Website và trạng thái fulfillment.' },
  { key: 'purchase', group: 'inventory', label: 'Báo cáo nhập hàng', description: 'Phiếu nhập, supplier, lot, hạn dùng, giá vốn.' },
  { key: 'issue', group: 'inventory', label: 'Báo cáo xuất hàng', description: 'Xuất kho, bán hàng, recipe, chuyển kho, kiểm kho.' },
  { key: 'stock', group: 'inventory', label: 'Báo cáo tồn kho chi tiết', description: 'Tồn hiện tại, min stock, giá trị tồn, hạn dùng.' },
  { key: 'stocktake', group: 'inventory', label: 'Báo cáo kiểm kho', description: 'Phiên kiểm kho, chênh lệch, lý do điều chỉnh.' },
  { key: 'cash_drawer', group: 'cash', label: 'Báo cáo tiền két', description: 'Thu tiền mặt, chi tiền, hoàn chi, số dư két theo ca và theo kỳ.' },
  { key: 'payables', group: 'debt', label: 'Công nợ phải trả', description: 'Ước tính phải trả theo phiếu nhập và supplier.' },
  { key: 'receivables', group: 'debt', label: 'Công nợ phải thu', description: 'Đơn/bill chưa thanh toán và thông tin khách.' },
  { key: 'customers_status', group: 'customers', label: 'Tình trạng khách hàng', description: 'Sinh nhật, sở thích, dị ứng, món hay mua, doanh số.' },
  { key: 'staff', group: 'staff', label: 'Báo cáo nhân viên', description: 'Tài khoản, vai trò, ca làm, doanh thu theo ca.' },
];

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function csvText(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}
function money(n) {
  return Math.round(Number(n) || 0).toLocaleString('vi-VN') + 'đ';
}
function qty(n) {
  return Number(n || 0).toLocaleString('vi-VN', { maximumFractionDigits: 3 });
}
function dateOnly(d) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}
function dayStart(s) {
  if (!s) return null;
  return new Date(String(s) + 'T00:00:00').toISOString();
}
function dayEnd(s) {
  if (!s) return null;
  return new Date(String(s) + 'T23:59:59.999').toISOString();
}
function rangeFromQuery(q = {}) {
  const nowDt = new Date();
  let from = dayStart(q.from);
  let to = dayEnd(q.to);
  if (!from || !to) {
    const d = new Date(nowDt.getFullYear(), nowDt.getMonth(), nowDt.getDate());
    const period = q.period || 'day';
    if (period === 'week') d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    if (period === 'month') d.setDate(1);
    if (period === 'quarter') d.setMonth(Math.floor(d.getMonth() / 3) * 3, 1);
    if (period === 'year') d.setMonth(0, 1);
    from = from || d.toISOString();
    to = to || nowDt.toISOString();
  }
  return {
    from,
    to,
    fromDate: dateOnly(from),
    toDate: dateOnly(to),
    label: `${dateOnly(from)} → ${dateOnly(to)}`,
  };
}
function channelLabel(v) {
  return { dine_in: 'Tại bàn', retail: 'Retail', online: 'Online', takeaway: 'Mang đi' }[v] || v || '';
}
function methodLabel(v) {
  return { cash: 'Tiền mặt', card: 'Thẻ/POS', qr: 'QR', qrcode: 'QR Code', bank_transfer: 'Chuyển khoản', voucher: 'Voucher', momo: 'MoMo', zalopay: 'ZaloPay', visa: 'Visa' }[v] || v || '';
}
function movementLabel(v) {
  return {
    receipt: 'Nhập hàng',
    opening: 'Tồn đầu',
    return: 'Hoàn nhập',
    issue: 'Xuất kho',
    sale: 'Bán retail',
    recipe: 'Tiêu hao F&B',
    transfer: 'Chuyển kho',
    transfer_in: 'Nhập chuyển kho',
    transfer_out: 'Xuất chuyển kho',
    stocktake: 'Kiểm kho',
  }[v] || v || '';
}
function rowsSum(rows, key) {
  return rows.reduce((s, r) => s + (Number(r[key]) || 0), 0);
}
function section(title, columns, rows, totals = null) {
  return { title, columns, rows, totals };
}
function reportShell(type, query) {
  const spec = REPORTS.find(r => r.key === type) || REPORTS[0];
  const range = rangeFromQuery(query);
  return {
    key: spec.key,
    title: spec.label,
    description: spec.description,
    generated_at: now(),
    range,
    filters: {
      period: query.period || 'day',
      channel: query.channel || '',
      product_id: query.product_id || '',
      warehouse_id: query.warehouse_id || '',
    },
    summary: [],
    sections: [],
  };
}
function paidOrderWhere(branch_id, range, extra = '') {
  return {
    sql: `o.branch_id=? AND o.status='paid' AND o.paid_at>=? AND o.paid_at<=? ${extra}`,
    params: [branch_id, range.from, range.to],
  };
}
function saleRows(branch_id, query = {}, kind = 'all') {
  const range = rangeFromQuery(query);
  const w = paidOrderWhere(branch_id, range);
  const params = [...w.params];
  let itemFilter = '';
  if (kind === 'fnb') itemFilter += ` AND oi.sku_id IS NULL`;
  if (kind === 'retail') itemFilter += ` AND oi.sku_id IS NOT NULL`;
  if (kind === 'online') itemFilter += ` AND (o.channel='online' OR o.online_channel IS NOT NULL)`;
  if (query.channel) { itemFilter += ` AND o.channel=?`; params.push(query.channel); }
  if (query.product_id) {
    const ids = String(query.product_id).split(',').map(s => s.trim()).filter(Boolean);
    if (ids.length > 0) {
      const placeholders = ids.map(() => '?').join(',');
      itemFilter += ` AND COALESCE(oi.menu_item_id, oi.sku_id) IN (${placeholders})`;
      params.push(...ids);
    }
  }
  return db.prepare(`
    SELECT o.id order_id, o.bill_no, o.channel, o.online_channel, o.online_ref, o.paid_at,
      t.code table_code, oi.menu_item_id, oi.sku_id, oi.name item_name, oi.station,
      oi.qty, oi.unit_price, oi.qty * oi.unit_price amount
    FROM order_items oi
    JOIN orders o ON o.id=oi.order_id
    LEFT JOIN tables t ON t.id=o.table_id
    WHERE ${w.sql} AND oi.status!='cancelled' ${itemFilter}
    ORDER BY o.paid_at DESC, oi.created_at DESC`).all(...params);
}
function buildSales(type, branch_id, query) {
  const report = reportShell(type, query);
  const kind = type === 'sales_fnb' ? 'all' : type === 'sales_retail' ? 'retail' : type === 'sales_online' ? 'online' : 'all';
  const rows = saleRows(branch_id, query, type === 'sales_by_product' ? 'all' : kind);
  const bills = new Set(rows.map(r => r.order_id));
  report.summary = [
    { label: 'Doanh thu', value: money(rowsSum(rows, 'amount')) },
    { label: 'Số bill', value: bills.size },
    { label: 'Số lượng', value: qty(rowsSum(rows, 'qty')) },
    { label: 'Bình quân/bill', value: money(bills.size ? rowsSum(rows, 'amount') / bills.size : 0) },
  ];
  const byProduct = new Map();
  for (const r of rows) {
    const k = r.menu_item_id || r.sku_id || r.item_name;
    const cur = byProduct.get(k) || { item_name: r.item_name, qty: 0, amount: 0 };
    cur.qty += Number(r.qty) || 0; cur.amount += Number(r.amount) || 0;
    byProduct.set(k, cur);
  }
  report.sections.push(section('Tổng hợp theo sản phẩm', [
    { key: 'item_name', label: 'Sản phẩm / món' },
    { key: 'qty_fmt', label: 'SL', align: 'right' },
    { key: 'amount_fmt', label: 'Doanh thu', align: 'right' },
  ], [...byProduct.values()].sort((a, b) => b.amount - a.amount).map(r => ({ ...r, qty_fmt: qty(r.qty), amount_fmt: money(r.amount) }))));
  report.sections.push(section('Chi tiết giao dịch', [
    { key: 'paid_at', label: 'Ngày giờ' },
    { key: 'bill', label: 'Bill' },
    { key: 'channel_label', label: 'Kênh' },
    { key: 'item_name', label: 'Sản phẩm / món' },
    { key: 'qty_fmt', label: 'SL', align: 'right' },
    { key: 'price_fmt', label: 'Đơn giá', align: 'right' },
    { key: 'amount_fmt', label: 'Thành tiền', align: 'right' },
  ], rows.map(r => ({
    ...r,
    bill: r.bill_no || String(r.order_id).slice(-6).toUpperCase(),
    channel_label: r.online_channel || channelLabel(r.channel),
    qty_fmt: qty(r.qty),
    price_fmt: money(r.unit_price),
    amount_fmt: money(r.amount),
  }))));
  return report;
}
function movementRows(branch_id, query, mode) {
  const range = rangeFromQuery(query);
  const params = [branch_id, range.from, range.to];
  let typeSql = '';
  if (mode === 'purchase') typeSql = `AND m.type IN ('receipt','opening','return')`;
  if (mode === 'issue') typeSql = `AND m.type IN ('issue','sale','recipe','transfer_out','stocktake') AND m.qty<0`;
  if (query.warehouse_id) { typeSql += ` AND m.warehouse_id=?`; params.push(query.warehouse_id); }
  return db.prepare(`
    SELECT m.*, COALESCE(i.name, s.name) item_name, COALESCE(i.unit, s.unit) unit,
      COALESCE(i.item_type, CASE WHEN s.id IS NOT NULL THEN 'retail' ELSE m.item_type END) item_kind,
      w.name warehouse_name, l.lot_no, l.expiry_date
    FROM stock_movements m
    LEFT JOIN inventory_items i ON i.id=m.inventory_item_id AND (m.item_type='inventory' OR m.item_type IS NULL)
    LEFT JOIN skus s ON s.id=m.inventory_item_id AND m.item_type='sku'
    LEFT JOIN warehouses w ON w.id=m.warehouse_id
    LEFT JOIN stock_lots l ON l.id=m.lot_id
    WHERE m.branch_id=? AND m.created_at>=? AND m.created_at<=? ${typeSql}
    ORDER BY m.created_at DESC`).all(...params);
}
function buildMovements(type, branch_id, query) {
  const report = reportShell(type, query);
  const rows = movementRows(branch_id, query, type === 'purchase' ? 'purchase' : 'issue');
  const value = rows.reduce((s, r) => s + Math.abs(Number(r.qty) || 0) * (Number(r.unit_cost) || 0), 0);
  report.summary = [
    { label: 'Số dòng', value: rows.length },
    { label: type === 'purchase' ? 'Tổng nhập' : 'Tổng xuất', value: qty(rows.reduce((s, r) => s + Math.abs(Number(r.qty) || 0), 0)) },
    { label: 'Giá trị ước tính', value: money(value) },
  ];
  report.sections.push(section(type === 'purchase' ? 'Chi tiết nhập hàng' : 'Chi tiết xuất hàng', [
    { key: 'created_at', label: 'Ngày giờ' },
    { key: 'warehouse_name', label: 'Kho' },
    { key: 'item_name', label: 'Mặt hàng' },
    { key: 'type_label', label: 'Loại' },
    { key: 'qty_fmt', label: 'SL', align: 'right' },
    { key: 'unit', label: 'ĐVT' },
    { key: 'unit_cost_fmt', label: 'Giá vốn', align: 'right' },
    { key: 'value_fmt', label: 'Giá trị', align: 'right' },
    { key: 'lot_no', label: 'Lot' },
    { key: 'expiry_date', label: 'HSD' },
    { key: 'reason', label: 'Lý do' },
  ], rows.map(r => ({
    ...r,
    type_label: movementLabel(r.type),
    qty_fmt: qty(Math.abs(Number(r.qty) || 0)),
    unit_cost_fmt: money(r.unit_cost || 0),
    value_fmt: money(Math.abs(Number(r.qty) || 0) * (Number(r.unit_cost) || 0)),
  }))));
  return report;
}
function buildStock(branch_id, query) {
  const report = reportShell('stock', query);
  const rows = [
    ...db.prepare(`SELECT 'inventory' stock_type, i.*, w.name warehouse_name FROM inventory_items i LEFT JOIN warehouses w ON w.id=i.warehouse_id WHERE i.branch_id=? AND i.active=1`).all(branch_id),
    ...db.prepare(`SELECT 'sku' stock_type, s.*, w.name warehouse_name FROM skus s LEFT JOIN warehouses w ON w.id=s.warehouse_id WHERE s.branch_id=? AND s.active=1`).all(branch_id),
  ].filter(r => !query.warehouse_id || r.warehouse_id === query.warehouse_id);
  report.summary = [
    { label: 'Số mặt hàng', value: rows.length },
    { label: 'Cảnh báo dưới min', value: rows.filter(r => Number(r.stock) <= Number(r.min_stock)).length },
    { label: 'Giá trị tồn', value: money(rows.reduce((s, r) => s + (Number(r.stock) || 0) * (Number(r.cost) || 0), 0)) },
  ];
  report.sections.push(section('Tồn kho hiện tại', [
    { key: 'warehouse_name', label: 'Kho' },
    { key: 'name', label: 'Mặt hàng' },
    { key: 'stock_type_label', label: 'Nhóm' },
    { key: 'stock_fmt', label: 'Tồn', align: 'right' },
    { key: 'min_stock_fmt', label: 'Tồn min', align: 'right' },
    { key: 'unit', label: 'ĐVT' },
    { key: 'cost_fmt', label: 'Giá vốn', align: 'right' },
    { key: 'value_fmt', label: 'Giá trị', align: 'right' },
    { key: 'category', label: 'Danh mục' },
    { key: 'supplier', label: 'Supplier' },
  ], rows.map(r => ({
    ...r,
    stock_type_label: r.stock_type === 'sku' ? 'Retail' : (r.item_type === 'supply' ? 'Vật dụng' : 'Nguyên liệu'),
    stock_fmt: qty(r.stock),
    min_stock_fmt: qty(r.min_stock),
    cost_fmt: money(r.cost || 0),
    value_fmt: money((Number(r.stock) || 0) * (Number(r.cost) || 0)),
  }))));
  const lots = db.prepare(`
    SELECT l.*, COALESCE(i.name, s.name) item_name, COALESCE(i.unit, s.unit) unit, w.name warehouse_name
    FROM stock_lots l
    LEFT JOIN inventory_items i ON i.id=l.item_id AND l.item_type='inventory'
    LEFT JOIN skus s ON s.id=l.item_id AND l.item_type='sku'
    LEFT JOIN warehouses w ON w.id=l.warehouse_id
    WHERE l.branch_id=? AND l.qty_on_hand>0
    ORDER BY COALESCE(l.expiry_date,'9999-12-31'), l.received_at DESC`).all(branch_id)
    .filter(r => !query.warehouse_id || r.warehouse_id === query.warehouse_id);
  report.sections.push(section('Chi tiết lot / hạn dùng', [
    { key: 'warehouse_name', label: 'Kho' },
    { key: 'item_name', label: 'Mặt hàng' },
    { key: 'lot_no', label: 'Lot' },
    { key: 'qty_fmt', label: 'Tồn lot', align: 'right' },
    { key: 'unit_cost_fmt', label: 'Giá vốn', align: 'right' },
    { key: 'expiry_date', label: 'HSD' },
    { key: 'supplier', label: 'Supplier' },
  ], lots.map(r => ({ ...r, qty_fmt: qty(r.qty_on_hand), unit_cost_fmt: money(r.unit_cost || 0) }))));
  return report;
}
function buildStocktake(branch_id, query) {
  const report = reportShell('stocktake', query);
  const range = rangeFromQuery(query);
  const rows = db.prepare(`
    SELECT ss.created_at, ss.approved_at, ss.name session_name, ss.mode, ss.status, w.name warehouse_name,
      COALESCE(i.name, s.name) item_name, sl.expected_qty, sl.counted_qty, sl.delta_qty, sl.reason
    FROM stocktake_lines sl
    JOIN stocktake_sessions ss ON ss.id=sl.session_id
    LEFT JOIN warehouses w ON w.id=ss.warehouse_id
    LEFT JOIN inventory_items i ON i.id=sl.item_id AND sl.item_type='inventory'
    LEFT JOIN skus s ON s.id=sl.item_id AND sl.item_type='sku'
    WHERE ss.branch_id=? AND ss.created_at>=? AND ss.created_at<=?
    ORDER BY ss.created_at DESC`).all(branch_id, range.from, range.to);
  report.summary = [
    { label: 'Dòng kiểm', value: rows.length },
    { label: 'Dòng lệch', value: rows.filter(r => Number(r.delta_qty) !== 0).length },
    { label: 'Tổng lệch', value: qty(rowsSum(rows, 'delta_qty')) },
  ];
  report.sections.push(section('Chi tiết kiểm kho', [
    { key: 'created_at', label: 'Ngày' },
    { key: 'session_name', label: 'Phiên' },
    { key: 'warehouse_name', label: 'Kho' },
    { key: 'item_name', label: 'Mặt hàng' },
    { key: 'expected_fmt', label: 'Sổ sách', align: 'right' },
    { key: 'counted_fmt', label: 'Thực đếm', align: 'right' },
    { key: 'delta_fmt', label: 'Lệch', align: 'right' },
    { key: 'reason', label: 'Lý do' },
  ], rows.map(r => ({ ...r, expected_fmt: qty(r.expected_qty), counted_fmt: qty(r.counted_qty), delta_fmt: qty(r.delta_qty) }))));
  return report;
}
function parseCustomer(raw) {
  try { return JSON.parse(raw || '{}') || {}; } catch { return {}; }
}
function buildReceivables(branch_id, query) {
  const report = reportShell('receivables', query);
  const rows = db.prepare(`
    SELECT o.id, o.bill_no, o.channel, o.status, o.total, o.created_at, o.customer_json, t.code table_code
    FROM orders o LEFT JOIN tables t ON t.id=o.table_id
    WHERE o.branch_id=? AND o.status IN ('open','pending','pending_payment')
    ORDER BY o.created_at DESC`).all(branch_id).map(r => ({ ...r, customer: parseCustomer(r.customer_json) }));
  report.summary = [
    { label: 'Số khoản phải thu', value: rows.length },
    { label: 'Tổng phải thu', value: money(rowsSum(rows, 'total')) },
  ];
  report.sections.push(section('Công nợ phải thu', [
    { key: 'created_at', label: 'Ngày' },
    { key: 'bill', label: 'Bill' },
    { key: 'customer_name', label: 'Khách hàng' },
    { key: 'channel_label', label: 'Kênh' },
    { key: 'table_code', label: 'Bàn' },
    { key: 'status', label: 'Trạng thái' },
    { key: 'total_fmt', label: 'Số tiền', align: 'right' },
  ], rows.map(r => ({
    ...r,
    bill: r.bill_no || String(r.id).slice(-6).toUpperCase(),
    customer_name: r.customer.name || r.customer.company || 'Khách lẻ',
    channel_label: channelLabel(r.channel),
    total_fmt: money(r.total),
  }))));
  return report;
}
function buildPayables(branch_id, query) {
  const report = reportShell('payables', query);
  const range = rangeFromQuery(query);
  const rows = db.prepare(`
    SELECT d.created_at, d.supplier, d.ref, d.reason, d.status, d.type, w.name warehouse_name,
      COALESCE(SUM(ABS(l.qty)*l.unit_cost),0) amount, COUNT(l.id) line_count
    FROM inventory_documents d
    LEFT JOIN inventory_document_lines l ON l.document_id=d.id
    LEFT JOIN warehouses w ON w.id=d.warehouse_id
    WHERE d.branch_id=? AND d.created_at>=? AND d.created_at<=? AND d.type IN ('receipt','opening','return')
    GROUP BY d.id ORDER BY d.created_at DESC`).all(branch_id, range.from, range.to);
  report.summary = [
    { label: 'Số phiếu nhập', value: rows.length },
    { label: 'Ước tính phải trả', value: money(rowsSum(rows, 'amount')) },
  ];
  report.sections.push(section('Công nợ phải trả theo phiếu nhập', [
    { key: 'created_at', label: 'Ngày' },
    { key: 'supplier', label: 'Nhà cung cấp' },
    { key: 'warehouse_name', label: 'Kho' },
    { key: 'ref', label: 'Tham chiếu' },
    { key: 'line_count', label: 'Số dòng', align: 'right' },
    { key: 'amount_fmt', label: 'Giá trị', align: 'right' },
    { key: 'status', label: 'Trạng thái' },
    { key: 'reason', label: 'Ghi chú' },
  ], rows.map(r => ({ ...r, supplier: r.supplier || 'Chưa khai báo', amount_fmt: money(r.amount) }))));
  return report;
}
function buildCashDrawer(branch_id, query) {
  const report = reportShell('cash_drawer', query);
  const range = rangeFromQuery(query);
  const entries = db.prepare(`
    SELECT e.*, s.shift_label, s.opened_at, s.closed_at,
      le.product linked_product, le.reason linked_reason, le.counterparty linked_counterparty,
      le.amount linked_amount, le.occurred_at linked_occurred_at,
      (SELECT GROUP_CONCAT(COALESCE(ae.product, ae.reason, ae.counterparty, ae.id) || ' ' || a.amount, ', ')
       FROM cash_drawer_reimbursement_allocations a
       JOIN cash_drawer_entries ae ON ae.id=a.expense_id
       WHERE a.reimbursement_id=e.id) allocation_text,
      (SELECT COALESCE(SUM(r.amount),0)
       FROM cash_drawer_entries r
       WHERE r.kind='reimbursement' AND r.reimburses_entry_id=e.id
         AND NOT EXISTS (SELECT 1 FROM cash_drawer_reimbursement_allocations a WHERE a.reimbursement_id=r.id))
      +
      (SELECT COALESCE(SUM(a.amount),0)
       FROM cash_drawer_reimbursement_allocations a
       JOIN cash_drawer_entries r ON r.id=a.reimbursement_id
       WHERE a.expense_id=e.id AND r.kind='reimbursement') reimbursed_amount
    FROM cash_drawer_entries e
    LEFT JOIN shifts s ON s.id=e.shift_id
    LEFT JOIN cash_drawer_entries le ON le.id=e.reimburses_entry_id
    WHERE e.branch_id=? AND e.occurred_at>=? AND e.occurred_at<=?
    ORDER BY e.occurred_at DESC, e.created_at DESC`).all(branch_id, range.from, range.to);
  const shifts = db.prepare(`
    SELECT s.*,
      (SELECT COALESCE(SUM(pl.amount),0)
        FROM payment_lines pl JOIN payments p ON p.id=pl.payment_id
        WHERE p.shift_id=s.id AND pl.method='cash') cash_sales,
      (SELECT COALESCE(SUM(amount),0) FROM cash_drawer_entries e WHERE e.shift_id=s.id AND e.kind='expense') drawer_expenses,
      (SELECT COALESCE(SUM(amount),0) FROM cash_drawer_entries e WHERE e.shift_id=s.id AND e.kind='reimbursement') drawer_reimbursements
    FROM shifts s
    WHERE s.branch_id=? AND s.opened_at<=? AND COALESCE(s.closed_at,?)>=?
    ORDER BY s.opened_at DESC`).all(branch_id, range.to, range.to, range.from)
    .map(s => ({
      ...s,
      expected_cash: (Number(s.opening_cash) || 0) + (Number(s.cash_sales) || 0) - (Number(s.drawer_expenses) || 0) + (Number(s.drawer_reimbursements) || 0),
    }));
  const expenseTotal = entries.filter(e => e.kind === 'expense').reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const reimbursementTotal = entries.filter(e => e.kind === 'reimbursement').reduce((s, e) => s + (Number(e.amount) || 0), 0);
  report.summary = [
    { label: 'Số khoản chi/hoàn', value: entries.length },
    { label: 'Tổng chi từ két', value: money(expenseTotal) },
    { label: 'Tổng hoàn chi', value: money(reimbursementTotal) },
    { label: 'Chênh lệch thu/chi', value: money(reimbursementTotal - expenseTotal) },
  ];
  report.sections.push(section('Tổng hợp theo ca', [
    { key: 'opened_at', label: 'Mở ca' },
    { key: 'closed_at', label: 'Kết ca' },
    { key: 'shift_label', label: 'Ca' },
    { key: 'opening_fmt', label: 'Đầu ca', align: 'right' },
    { key: 'cash_sales_fmt', label: 'Tiền mặt bán hàng', align: 'right' },
    { key: 'expense_fmt', label: 'Chi két', align: 'right' },
    { key: 'reimburse_fmt', label: 'Hoàn chi', align: 'right' },
    { key: 'expected_fmt', label: 'Số dư dự kiến', align: 'right' },
  ], shifts.map(s => ({
    ...s,
    opening_fmt: money(s.opening_cash),
    cash_sales_fmt: money(s.cash_sales),
    expense_fmt: money(s.drawer_expenses),
    reimburse_fmt: money(s.drawer_reimbursements),
    expected_fmt: money(s.expected_cash),
  }))));
  report.sections.push(section('Chi tiết chi / hoàn tiền két', [
    { key: 'occurred_at', label: 'Ngày giờ' },
    { key: 'kind_label', label: 'Loại' },
    { key: 'shift_label', label: 'Ca' },
    { key: 'counterparty', label: 'NCC / người hoàn' },
    { key: 'reason', label: 'Lý do' },
    { key: 'product', label: 'Sản phẩm / khoản mục' },
    { key: 'linked_text', label: 'Hoàn cho' },
    { key: 'actor_name', label: 'Người ghi nhận' },
    { key: 'amount_fmt', label: 'Số tiền', align: 'right' },
    { key: 'reimbursed_fmt', label: 'Đã hoàn', align: 'right' },
    { key: 'outstanding_fmt', label: 'Còn thiếu', align: 'right' },
    { key: 'before_fmt', label: 'Trước', align: 'right' },
    { key: 'after_fmt', label: 'Sau', align: 'right' },
    { key: 'note', label: 'Ghi chú' },
  ], entries.map(e => ({
    ...e,
    kind_label: e.kind === 'expense' ? 'Chi tiền' : 'Hoàn tiền',
    amount_fmt: money(e.amount),
    linked_text: e.allocation_text || (e.reimburses_entry_id ? [e.linked_product || e.linked_reason || e.linked_counterparty || e.reimburses_entry_id, e.linked_amount ? money(e.linked_amount) : ''].filter(Boolean).join(' · ') : ''),
    reimbursed_fmt: e.kind === 'expense' ? money(e.reimbursed_amount || 0) : '',
    outstanding_fmt: e.kind === 'expense' ? money(Math.max(0, (Number(e.amount) || 0) - (Number(e.reimbursed_amount) || 0))) : '',
    before_fmt: money(e.balance_before),
    after_fmt: money(e.balance_after),
  }))));
  return report;
}
function buildCustomers(branch_id, query) {
  const report = reportShell('customers_status', query);
  const rows = db.prepare(`SELECT * FROM customers WHERE branch_id=? ORDER BY total_spent DESC, updated_at DESC`).all(branch_id);
  report.summary = [
    { label: 'Số khách hàng', value: rows.length },
    { label: 'Có MST', value: rows.filter(r => r.tax_code).length },
    { label: 'Có dị ứng', value: rows.filter(r => r.allergies).length },
    { label: 'Doanh số tích lũy', value: money(rowsSum(rows, 'total_spent')) },
  ];
  report.sections.push(section('Tình trạng khách hàng', [
    { key: 'name', label: 'Khách hàng' },
    { key: 'phone', label: 'SĐT' },
    { key: 'birthday', label: 'Sinh nhật' },
    { key: 'preferences', label: 'Sở thích' },
    { key: 'allergies', label: 'Dị ứng' },
    { key: 'total_orders', label: 'Số đơn', align: 'right' },
    { key: 'spent_fmt', label: 'Tổng mua', align: 'right' },
    { key: 'favorite_text', label: 'Hay mua' },
    { key: 'updated_at', label: 'Cập nhật' },
  ], rows.map(r => {
    let fav = [];
    try { fav = JSON.parse(r.favorite_items_json || '[]'); } catch {}
    return { ...r, spent_fmt: money(r.total_spent), favorite_text: fav.slice(0, 5).map(x => `${x.name} (${qty(x.qty)})`).join(', ') };
  })));
  return report;
}
function buildStaff(branch_id, query) {
  const report = reportShell('staff', query);
  const range = rangeFromQuery(query);
  const users = db.prepare(`SELECT id,username,name,role,active,COALESCE(lang,'vi') lang FROM users WHERE branch_id=? OR branch_id IS NULL ORDER BY role,name`).all(branch_id);
  const shifts = db.prepare(`
    SELECT s.*,
      (SELECT COUNT(*) FROM payments p WHERE p.shift_id=s.id) bill_count,
      (SELECT COALESCE(SUM(p.total),0) FROM payments p WHERE p.shift_id=s.id) total_revenue,
      (SELECT COALESCE(SUM(pl.amount),0)
        FROM payment_lines pl JOIN payments p ON p.id=pl.payment_id
        WHERE p.shift_id=s.id AND pl.method='cash') cash_sales,
      (SELECT COALESCE(SUM(amount),0) FROM cash_drawer_entries e WHERE e.shift_id=s.id AND e.kind='expense') drawer_expenses,
      (SELECT COALESCE(SUM(amount),0) FROM cash_drawer_entries e WHERE e.shift_id=s.id AND e.kind='reimbursement') drawer_reimbursements
    FROM shifts s
    WHERE s.branch_id=? AND s.opened_at>=? AND s.opened_at<=?
    ORDER BY s.opened_at DESC`).all(branch_id, range.from, range.to)
    .map(s => ({ ...s, expected_cash: (Number(s.opening_cash) || 0) + (Number(s.cash_sales) || 0) - (Number(s.drawer_expenses) || 0) + (Number(s.drawer_reimbursements) || 0) }));
  report.summary = [
    { label: 'Nhân viên', value: users.length },
    { label: 'Đang hoạt động', value: users.filter(u => u.active).length },
    { label: 'Số ca trong kỳ', value: shifts.length },
    { label: 'Doanh thu ca', value: money(rowsSum(shifts, 'total_revenue')) },
  ];
  report.sections.push(section('Danh sách nhân viên', [
    { key: 'name', label: 'Tên' },
    { key: 'username', label: 'Tài khoản' },
    { key: 'role', label: 'Vai trò' },
    { key: 'active_label', label: 'Trạng thái' },
    { key: 'lang', label: 'Ngôn ngữ' },
  ], users.map(u => ({ ...u, active_label: u.active ? 'Đang hoạt động' : 'Tắt' }))));
  report.sections.push(section('Ca làm trong kỳ', [
    { key: 'opened_at', label: 'Mở ca' },
    { key: 'closed_at', label: 'Kết ca' },
    { key: 'shift_label', label: 'Ca' },
    { key: 'user_name', label: 'Nhân viên' },
    { key: 'bill_count', label: 'Bill', align: 'right' },
    { key: 'revenue_fmt', label: 'Doanh thu', align: 'right' },
    { key: 'expected_cash_fmt', label: 'Tiền mặt dự kiến', align: 'right' },
    { key: 'status', label: 'Trạng thái' },
  ], shifts.map(s => ({ ...s, revenue_fmt: money(s.total_revenue), expected_cash_fmt: money(s.expected_cash) }))));
  return report;
}

export function products(branch_id = 'br1') {
  return [
    ...db.prepare(`SELECT id, name, 'menu' type FROM menu_items WHERE hidden=0 AND deleted_at IS NULL ORDER BY name`).all(),
    ...db.prepare(`SELECT id, name, 'sku' type FROM skus WHERE branch_id=? AND active=1 ORDER BY name`).all(branch_id),
  ];
}
export function warehouses(branch_id = 'br1') {
  return db.prepare(`SELECT id, name, type FROM warehouses WHERE branch_id=? AND active=1 ORDER BY sort,name`).all(branch_id);
}
export function catalog(branch_id = 'br1') {
  return { groups: REPORT_GROUPS, reports: REPORTS, products: products(branch_id), warehouses: warehouses(branch_id) };
}
export function buildReport(type = 'sales_overview', branch_id = 'br1', query = {}) {
  if (['sales_fnb', 'sales_retail', 'sales_by_product'].includes(type)) type = 'sales_overview';
  if (['sales_overview', 'sales_online'].includes(type)) return buildSales(type, branch_id, query);
  if (type === 'purchase') return buildMovements(type, branch_id, query);
  if (type === 'issue') return buildMovements(type, branch_id, query);
  if (type === 'stock') return buildStock(branch_id, query);
  if (type === 'stocktake') return buildStocktake(branch_id, query);
  if (type === 'cash_drawer') return buildCashDrawer(branch_id, query);
  if (type === 'payables') return buildPayables(branch_id, query);
  if (type === 'receivables') return buildReceivables(branch_id, query);
  if (type === 'customers_status') return buildCustomers(branch_id, query);
  if (type === 'staff') return buildStaff(branch_id, query);
  return buildSales('sales_overview', branch_id, query);
}
function tableHtml(sec) {
  return `<h2>${esc(sec.title)}</h2><table><thead><tr>${sec.columns.map(c => `<th class="${c.align === 'right' ? 'r' : ''}">${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${sec.rows.length ? sec.rows.map(r => `<tr>${sec.columns.map(c => `<td class="${c.align === 'right' ? 'r' : ''}">${esc(r[c.key] ?? '')}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${sec.columns.length}" class="empty">Không có dữ liệu</td></tr>`}</tbody></table>`;
}
export function renderReportHtml(report, { mode = 'preview' } = {}) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(report.title)}</title><style>
    @page{size:A4;margin:12mm}
    body{font-family:"Arial","Helvetica",sans-serif;color:#172033;margin:0;background:#fff;font-size:12px}
    .page{max-width:1100px;margin:0 auto;padding:${mode === 'preview' ? '18px' : '0'}}
    h1{font-size:22px;margin:0 0 4px} h2{font-size:15px;margin:18px 0 8px}
    .meta{color:#667085;margin-bottom:12px}.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:12px 0 14px}
    .sum{border:1px solid #d9dee7;border-radius:6px;padding:8px}.sum b{display:block;font-size:15px;margin-top:4px}
    table{width:100%;border-collapse:collapse;margin-bottom:12px;page-break-inside:auto} tr{page-break-inside:avoid;page-break-after:auto}
    th{background:#eef3f8;color:#445065;text-transform:uppercase;font-size:10px;letter-spacing:.3px}
    th,td{border:1px solid #d9dee7;padding:6px 7px;vertical-align:top} td.r,th.r{text-align:right}.empty{text-align:center;color:#98a2b3}
    .foot{margin-top:18px;color:#667085;font-size:11px}
    @media print{.page{padding:0}.no-print{display:none!important} body{font-size:11px}}
  </style></head><body><div class="page">
    <div class="no-print" style="text-align:right;margin-bottom:10px"><button onclick="window.print()">In / Lưu PDF</button></div>
    <h1>${esc(report.title)}</h1>
    <div class="meta">Kỳ báo cáo: ${esc(report.range.label)} · Xuất lúc: ${esc(report.generated_at)}</div>
    <div class="summary">${report.summary.map(s => `<div class="sum">${esc(s.label)}<b>${esc(s.value)}</b></div>`).join('')}</div>
    ${report.sections.map(tableHtml).join('')}
    <div class="foot">Dan D Pak POS/ERP · Báo cáo được tạo tự động từ dữ liệu lưu trữ nội bộ.</div>
  </div></body></html>`;
}
export function renderReportXls(report) {
  const html = renderReportHtml(report, { mode: 'xls' });
  return Buffer.from('\ufeff' + html, 'utf8');
}
export function renderReportDoc(report) {
  const html = renderReportHtml(report, { mode: 'doc' });
  return Buffer.from('\ufeff' + html, 'utf8');
}
function safeFilePart(s) {
  return String(s || 'report').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w.-]+/g, '_').slice(0, 80);
}
export function reportFilename(report, ext) {
  return `${safeFilePart(report.key)}_${report.range.fromDate}_${report.range.toDate}.${ext}`;
}
function browserCandidates() {
  return [
    process.env.REPORT_PDF_BROWSER,
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'msedge',
    'chrome',
    'google-chrome',
  ].filter(Boolean);
}
export async function renderReportPdf(report) {
  const html = renderReportHtml(report, { mode: 'pdf' });
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dan-report-'));
  const htmlPath = path.join(dir, 'report.html');
  const pdfPath = path.join(dir, 'report.pdf');
  await writeFile(htmlPath, html, 'utf8');
  let lastErr = null;
  try {
    for (const browser of browserCandidates()) {
      try {
        await execFileAsync(browser, [
          '--headless',
          '--disable-gpu',
          '--no-sandbox',
          '--print-to-pdf-no-header',
          `--print-to-pdf=${pdfPath}`,
          htmlPath,
        ], { timeout: 25000, windowsHide: true });
        return await readFile(pdfPath);
      } catch (e) { lastErr = e; }
    }
    throw new Error('Không tìm thấy Edge/Chrome headless để tạo PDF: ' + (lastErr?.message || 'unknown'));
  } finally {
    rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
