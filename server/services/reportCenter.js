import { db, now } from '../db.js';
import writeExcelFile from 'write-excel-file/node';
import PDFDocument from 'pdfkit';
import { execFile } from 'child_process';
import { existsSync } from 'fs';
import { promisify } from 'util';
import { mkdtemp, writeFile, readFile, rm } from 'fs/promises';
import os from 'os';
import path from 'path';

const execFileAsync = promisify(execFile);

export const REPORT_GROUPS = [
  { key: 'sales', label: 'Báo cáo bán hàng' },
  { key: 'purchase', label: 'Báo cáo mua hàng' },
  { key: 'inventory', label: 'Báo cáo kho' },
  { key: 'expense', label: 'Báo cáo chi phí' },
  { key: 'cash', label: 'Báo cáo tiền két' },
  { key: 'debt', label: 'Báo cáo công nợ' },
  { key: 'customers', label: 'Báo cáo quản trị khách hàng' },
  { key: 'staff', label: 'Báo cáo nhân viên' },
];

export const REPORTS = [
  { key: 'sales_overview', group: 'sales', label: 'Báo cáo bán hàng', description: 'Doanh thu, mặt hàng, hóa đơn, kênh bán hàng và phương thức thanh toán.' },
  { key: 'sales_online', group: 'sales', label: 'Bán hàng Online', description: 'GrabFood/ShopeeFood/Website và trạng thái fulfillment.' },
  { key: 'purchase_orders', group: 'purchase', label: 'Báo cáo mua hàng', description: 'Đơn mua theo kỳ/NCC, đã nhận, đã trả và công nợ phải trả.' },
  { key: 'purchase_price_analysis', group: 'purchase', label: 'Biến động & So sánh giá nhập', description: 'Biến động giá nhập theo thời gian, so sánh giá giữa các nhà cung cấp, và chi phí mua hàng từ két.' },
  { key: 'expenses', group: 'expense', label: 'Báo cáo chi phí', description: 'Chi phí theo danh mục, nguồn tiền (két/trực tiếp) và kỳ.' },
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
function dateTime(d) {
  if (!d) return '';
  const x = new Date(d);
  if (isNaN(x)) return String(d);
  const p = n => String(n).padStart(2, '0');
  return `${p(x.getDate())}/${p(x.getMonth() + 1)}/${x.getFullYear()} ${p(x.getHours())}:${p(x.getMinutes())}`;
}
function dMy(d) {
  if (!d) return '';
  const parts = String(d).slice(0, 10).split('-');
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  const x = new Date(d);
  if (isNaN(x.getTime())) return String(d);
  const p = n => String(n).padStart(2, '0');
  return `${p(x.getDate())}/${p(x.getMonth() + 1)}/${x.getFullYear()}`;
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
  return {
    cash: 'Tiền mặt', card: 'Thẻ / POS', pos: 'Máy POS', qr: 'QR', qrcode: 'QR Code',
    bank_transfer: 'Chuyển khoản', internet_banking: 'Internet Banking', transfer: 'Chuyển khoản',
    wallet: 'Ví điện tử', voucher: 'Voucher', momo: 'MoMo', zalopay: 'ZaloPay', visa: 'Visa', other: 'Khác',
  }[v] || v || '';
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
function stat(label, value, raw = null) {
  return raw === null ? { label, value } : { label, value, raw };
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
function branchRowsFor(ids = []) {
  const clean = [...new Set(ids.map(id => String(id || '').trim()).filter(Boolean))];
  if (!clean.length) return [];
  const rows = db.prepare(`SELECT id,name,code FROM branches WHERE id IN (${clean.map(() => '?').join(',')})`).all(...clean);
  const map = new Map(rows.map(r => [r.id, { id: r.id, name: r.name || r.code || r.id, code: r.code || r.id }]));
  return clean.map(id => map.get(id) || { id, name: id, code: id });
}
function normalizeScope(scope = 'br1') {
  if (typeof scope === 'string') {
    const branches = branchRowsFor([scope]);
    return { branch_ids: [scope], branches, label: branches[0]?.name || scope };
  }
  const ids = Array.isArray(scope) ? scope : (scope.branch_ids || scope.branchIds || []);
  const branch_ids = [...new Set(ids.map(id => String(id || '').trim()).filter(Boolean))];
  const provided = Array.isArray(scope.branches) ? scope.branches : [];
  const providedMap = new Map(provided.map(b => [String(b.id), { id: String(b.id), name: b.name || b.code || b.id, code: b.code || b.id }]));
  const branches = branch_ids.map(id => providedMap.get(id)).filter(Boolean);
  const finalBranches = branches.length === branch_ids.length ? branches : branchRowsFor(branch_ids);
  const label = finalBranches.length > 1
    ? `${finalBranches.length} chi nhánh`
    : (finalBranches[0]?.name || branch_ids[0] || 'Chi nhánh');
  return { branch_ids, branches: finalBranches, label };
}
function withScope(report, scope) {
  report.scope = {
    branch_ids: scope.branch_ids,
    branches: scope.branches,
    label: scope.label,
  };
  report.range = { ...report.range, label: `${report.range.label} · ${scope.label}` };
  return report;
}
function combineBranchReports(type, scope, query, reports) {
  const report = reportShell(type, query);
  if (reports[0]) {
    report.title = reports[0].title;
    report.description = reports[0].description;
  }
  const branchById = new Map(scope.branches.map(b => [b.id, b]));
  const perBranchCols = [{ key: 'branch_name', label: 'Chi nhánh' }];
  for (const s of reports[0]?.summary || []) {
    perBranchCols.push({ key: `sum_${perBranchCols.length}`, label: s.label, align: 'right' });
  }
  const perBranchRows = reports.map(r => {
    const b = branchById.get(r.branch_id) || { name: r.branch_id };
    const row = { branch_id: r.branch_id, branch_name: b.name };
    r.summary.forEach((s, i) => { row[`sum_${i + 1}`] = s.value; });
    return row;
  });
  const sectionMap = new Map();
  for (const r of reports) {
    const branch = branchById.get(r.branch_id) || { id: r.branch_id, name: r.branch_id };
    for (const sec of r.sections || []) {
      const key = sec.title;
      if (!sectionMap.has(key)) {
        sectionMap.set(key, {
          title: sec.title,
          columns: [{ key: 'branch_name', label: 'Chi nhánh' }, ...sec.columns],
          rows: [],
        });
      }
      const target = sectionMap.get(key);
      for (const row of sec.rows || []) {
        target.rows.push({ ...row, _branch_id: branch.id, branch_name: branch.name });
      }
    }
  }
  const allRows = [...sectionMap.values()].flatMap(sec => sec.rows || []);
  if (['sales_overview', 'sales_online'].includes(type)) {
    const detailRows = allRows.filter(r => r.order_id && r.amount !== undefined);
    const bills = new Set(detailRows.map(r => `${r._branch_id}:${r.order_id}`));
    const amount = rowsSum(detailRows, 'amount');
    const quantity = rowsSum(detailRows, 'qty');
    report.summary = [
      stat('Doanh thu', money(amount), amount),
      stat('Số bill', bills.size, bills.size),
      stat('Số lượng', qty(quantity), quantity),
      stat('Bình quân/bill', money(bills.size ? amount / bills.size : 0), bills.size ? amount / bills.size : 0),
    ];
  } else {
    report.summary = [
      stat('Chi nhánh', scope.branches.length, scope.branches.length),
      stat('Số dòng dữ liệu', allRows.length, allRows.length),
    ];
  }
  report.sections = [
    section('Tổng hợp theo chi nhánh', perBranchCols, perBranchRows),
    ...sectionMap.values(),
  ];
  return withScope(report, scope);
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
  const revenue = rowsSum(rows, 'amount');
  const quantity = rowsSum(rows, 'qty');
  report.summary = [
    stat('Doanh thu', money(revenue), revenue),
    stat('Số bill', bills.size, bills.size),
    stat('Số lượng', qty(quantity), quantity),
    stat('Bình quân/bill', money(bills.size ? revenue / bills.size : 0), bills.size ? revenue / bills.size : 0),
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

  // Phương thức thanh toán theo từng bill (gộp từ payment_lines của các đơn trong kỳ).
  const billIds = [...bills];
  const payLines = billIds.length
    ? db.prepare(`SELECT p.order_id, pl.method, pl.amount
        FROM payments p JOIN payment_lines pl ON pl.payment_id=p.id
        WHERE p.order_id IN (${billIds.map(() => '?').join(',')})`).all(...billIds)
    : [];
  const methodsByOrder = new Map(); // order_id -> Map(method -> amount)
  const byMethod = new Map();        // method -> { bills:Set, amount }
  for (const l of payLines) {
    if (!methodsByOrder.has(l.order_id)) methodsByOrder.set(l.order_id, new Map());
    const om = methodsByOrder.get(l.order_id);
    om.set(l.method, (om.get(l.method) || 0) + (Number(l.amount) || 0));
    const bm = byMethod.get(l.method) || { method: l.method, bills: new Set(), amount: 0 };
    bm.bills.add(l.order_id); bm.amount += Number(l.amount) || 0;
    byMethod.set(l.method, bm);
  }
  const orderMethodLabel = oid => {
    const om = methodsByOrder.get(oid);
    if (!om || !om.size) return '—';
    return [...om.keys()].map(methodLabel).join(' + ');
  };
  if (byMethod.size) {
    report.sections.push(section('Tổng hợp theo phương thức thanh toán', [
      { key: 'method_label', label: 'Phương thức' },
      { key: 'bills_fmt', label: 'Số bill', align: 'right' },
      { key: 'amount_fmt', label: 'Số tiền', align: 'right' },
    ], [...byMethod.values()].sort((a, b) => b.amount - a.amount).map(m => ({
      method_label: methodLabel(m.method),
      bills_fmt: m.bills.size,
      amount_fmt: money(m.amount),
    }))));
  }

  report.sections.push(section('Chi tiết giao dịch', [
    { key: 'time_fmt', label: 'Thời gian mua' },
    { key: 'bill', label: 'Bill' },
    { key: 'channel_label', label: 'Kênh' },
    { key: 'method_label', label: 'Thanh toán' },
    { key: 'item_name', label: 'Sản phẩm / món' },
    { key: 'qty_fmt', label: 'SL', align: 'right' },
    { key: 'price_fmt', label: 'Đơn giá', align: 'right' },
    { key: 'amount_fmt', label: 'Thành tiền', align: 'right' },
  ], rows.map(r => ({
    ...r,
    time_fmt: dateTime(r.paid_at),
    bill: r.bill_no || String(r.order_id).slice(-6).toUpperCase(),
    channel_label: r.online_channel || channelLabel(r.channel),
    method_label: orderMethodLabel(r.order_id),
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
    customer_name: r.customer.name || r.customer.company || 'Bán cho người tiêu dùng',
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
function buildPurchaseOrders(branch_id, query) {
  const report = reportShell('purchase_orders', query);
  const range = rangeFromQuery(query);
  const rows = db.prepare(`
    SELECT * FROM purchase_orders
    WHERE branch_id=? AND status!='cancelled' AND order_date>=? AND order_date<=?
    ORDER BY order_date DESC, created_at DESC`).all(branch_id, range.from, range.to);
  const totalVal = rowsSum(rows, 'total');
  const totalPaid = rowsSum(rows, 'amount_paid');
  const ST = { draft: 'Nháp', confirmed: 'Đã xác nhận', received: 'Đã nhận' };
  report.summary = [
    { label: 'Số đơn mua', value: rows.length },
    { label: 'Tổng giá trị', value: money(totalVal) },
    { label: 'Đã thanh toán', value: money(totalPaid) },
    { label: 'Còn nợ NCC', value: money(Math.max(0, totalVal - totalPaid)) },
  ];
  report.sections.push(section('Đơn mua hàng theo kỳ', [
    { key: 'order_date', label: 'Ngày' },
    { key: 'code', label: 'Mã đơn' },
    { key: 'supplier_name', label: 'Nhà cung cấp' },
    { key: 'status_label', label: 'Trạng thái' },
    { key: 'total_fmt', label: 'Tổng tiền', align: 'right' },
    { key: 'paid_fmt', label: 'Đã trả', align: 'right' },
    { key: 'due_fmt', label: 'Còn nợ', align: 'right' },
  ], rows.map(r => ({
    ...r,
    order_date: dateOnly(r.order_date),
    supplier_name: r.supplier_name || 'Chưa khai báo',
    status_label: ST[r.status] || r.status,
    total_fmt: money(r.total),
    paid_fmt: money(r.amount_paid),
    due_fmt: money(Math.max(0, (Number(r.total) || 0) - (Number(r.amount_paid) || 0))),
  }))));
  // By supplier (công nợ phải trả)
  const bySup = new Map();
  for (const r of rows) {
    const k = r.supplier_name || 'Chưa khai báo';
    const cur = bySup.get(k) || { supplier_name: k, orders: 0, total: 0, paid: 0 };
    cur.orders += 1; cur.total += Number(r.total) || 0; cur.paid += Number(r.amount_paid) || 0;
    bySup.set(k, cur);
  }
  report.sections.push(section('Tổng hợp theo nhà cung cấp', [
    { key: 'supplier_name', label: 'Nhà cung cấp' },
    { key: 'orders', label: 'Số đơn', align: 'right' },
    { key: 'total_fmt', label: 'Tổng mua', align: 'right' },
    { key: 'paid_fmt', label: 'Đã trả', align: 'right' },
    { key: 'due_fmt', label: 'Còn nợ', align: 'right' },
  ], [...bySup.values()].sort((a, b) => (b.total - b.paid) - (a.total - a.paid)).map(s => ({
    ...s, total_fmt: money(s.total), paid_fmt: money(s.paid), due_fmt: money(Math.max(0, s.total - s.paid)),
  }))));
  return report;
}
function buildPurchasePriceAnalysis(branch_id, query) {
  const report = reportShell('purchase_price_analysis', query);
  const range = rangeFromQuery(query);

  const poRows = db.prepare(`
    SELECT pol.name AS item_name, pol.unit, pol.qty, pol.unit_cost, po.supplier_name, po.order_date AS date, 'Đơn mua' AS source
    FROM purchase_order_lines pol
    JOIN purchase_orders po ON po.id = pol.po_id
    WHERE po.branch_id=? AND po.status!='cancelled' AND po.order_date>=? AND po.order_date<=?
  `).all(branch_id, range.fromDate, range.toDate);

  const idocRows = db.prepare(`
    SELECT COALESCE(i.name, s.name, idl.item_id) AS item_name, COALESCE(i.unit, s.unit, '') AS unit,
      ABS(idl.qty) AS qty, idl.unit_cost, idoc.supplier AS supplier_name,
      SUBSTR(idoc.created_at, 1, 10) AS date, 'Nhập kho' AS source
    FROM inventory_document_lines idl
    JOIN inventory_documents idoc ON idoc.id = idl.document_id
    LEFT JOIN inventory_items i ON i.id = idl.item_id AND idl.item_type = 'inventory'
    LEFT JOIN skus s ON s.id = idl.item_id AND idl.item_type = 'sku'
    WHERE idoc.branch_id=? AND idoc.type IN ('receipt', 'opening')
      AND idoc.created_at>=? AND idoc.created_at<=?
      AND (idoc.ref IS NULL OR idoc.ref NOT LIKE 'PO-%')
  `).all(branch_id, range.from, range.to);

  const purchaseRecords = [...poRows, ...idocRows];

  const posExpenses = db.prepare(`
    SELECT occurred_at, counterparty AS supplier_name, product, reason, amount, actor_name
    FROM cash_drawer_entries
    WHERE branch_id=? AND kind='expense' AND occurred_at>=? AND occurred_at<=?
      AND (product IS NULL OR product != 'Trả nhà cung cấp')
      AND (reason IS NULL OR reason NOT LIKE 'Trả NCC%')
    ORDER BY occurred_at DESC
  `).all(branch_id, range.from, range.to);

  const byItem = new Map();
  for (const r of purchaseRecords) {
    if (!r.item_name || !r.unit_cost) continue;
    const key = r.item_name.trim();
    if (!byItem.has(key)) {
      byItem.set(key, {
        name: key,
        unit: r.unit || '',
        prices: [],
        records: [],
      });
    }
    byItem.get(key).records.push(r);
    byItem.get(key).prices.push(Number(r.unit_cost) || 0);
  }

  const itemSummaryRows = [];
  const comparisonRows = [];

  for (const [name, data] of byItem.entries()) {
    data.records.sort((a, b) => a.date.localeCompare(b.date));
    const oldestRecord = data.records[0];
    const latestRecord = data.records[data.records.length - 1];

    const oldestPrice = oldestRecord.unit_cost;
    const latestPrice = latestRecord.unit_cost;

    const minPrice = Math.min(...data.prices);
    const maxPrice = Math.max(...data.prices);
    const avgPrice = data.prices.reduce((s, p) => s + p, 0) / data.prices.length;

    let fluctuationText = '—';
    if (oldestPrice > 0 && latestPrice !== oldestPrice) {
      const pct = ((latestPrice - oldestPrice) / oldestPrice) * 100;
      fluctuationText = `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
    }

    itemSummaryRows.push({
      item_name: name,
      unit: data.unit,
      latest_price_fmt: money(latestPrice),
      latest_info: `${latestRecord.supplier_name || 'Mua lẻ'} (${dMy(latestRecord.date)})`,
      price_range: `${money(minPrice)} - ${money(maxPrice)}`,
      avg_price_fmt: money(avgPrice),
      fluctuation: fluctuationText,
      _avg: avgPrice
    });

    const bySupplier = new Map();
    for (const r of data.records) {
      const sup = r.supplier_name || 'Mua lẻ';
      bySupplier.set(sup, r);
    }

    if (bySupplier.size > 1) {
      for (const [sup, r] of bySupplier.entries()) {
        comparisonRows.push({
          item_name: name,
          supplier_name: sup,
          price_fmt: money(r.unit_cost),
          date_fmt: dMy(r.date),
        });
      }
    }
  }

  itemSummaryRows.sort((a, b) => b._avg - a._avg);
  comparisonRows.sort((a, b) => a.item_name.localeCompare(b.item_name));

  const historyRows = purchaseRecords
    .map(r => ({
      date_fmt: dMy(r.date),
      item_name: r.item_name,
      supplier_name: r.supplier_name || 'Mua lẻ',
      qty_fmt: qty(r.qty) + (r.unit ? ' ' + r.unit : ''),
      price_fmt: money(r.unit_cost),
      source: r.source,
      _date: r.date
    }))
    .sort((a, b) => b._date.localeCompare(a._date));

  const totalPurchaseValue = purchaseRecords.reduce((s, r) => s + (r.qty * r.unit_cost), 0);
  const posExpensesValue = posExpenses.reduce((s, r) => s + (r.amount), 0);

  report.summary = [
    { label: 'Tổng chi nhập hàng', value: money(totalPurchaseValue) },
    { label: 'Số mặt hàng nhập', value: byItem.size },
    { label: 'Số lần nhập hàng', value: purchaseRecords.length },
    { label: 'Chi két POS', value: money(posExpensesValue) },
  ];

  report.sections.push(section('Biến động giá nhập theo mặt hàng', [
    { key: 'item_name', label: 'Mặt hàng' },
    { key: 'unit', label: 'ĐVT' },
    { key: 'latest_price_fmt', label: 'Giá gần nhất', align: 'right' },
    { key: 'latest_info', label: 'NCC & Ngày nhập gần nhất' },
    { key: 'price_range', label: 'Khoảng giá (Min - Max)', align: 'right' },
    { key: 'avg_price_fmt', label: 'Giá trung bình', align: 'right' },
    { key: 'fluctuation', label: 'Biến động (%)', align: 'right' },
  ], itemSummaryRows));

  if (comparisonRows.length > 0) {
    report.sections.push(section('So sánh giá giữa các nhà cung cấp', [
      { key: 'item_name', label: 'Mặt hàng' },
      { key: 'supplier_name', label: 'Nhà cung cấp' },
      { key: 'price_fmt', label: 'Giá nhập gần nhất', align: 'right' },
      { key: 'date_fmt', label: 'Ngày nhập gần nhất' },
    ], comparisonRows));
  }

  report.sections.push(section('Lịch sử biến động chi tiết', [
    { key: 'date_fmt', label: 'Ngày nhập' },
    { key: 'item_name', label: 'Mặt hàng' },
    { key: 'supplier_name', label: 'Nhà cung cấp' },
    { key: 'qty_fmt', label: 'Số lượng', align: 'right' },
    { key: 'price_fmt', label: 'Đơn giá', align: 'right' },
    { key: 'source', label: 'Nguồn' },
  ], historyRows));

  report.sections.push(section('Chi phí mua hàng/nhập hàng từ két POS (POS Expenses)', [
    { key: 'occurred_at_fmt', label: 'Ngày giờ chi' },
    { key: 'supplier_name', label: 'NCC / Bên nhận' },
    { key: 'product', label: 'Sản phẩm / Khoản chi' },
    { key: 'reason', label: 'Lý do chi' },
    { key: 'amount_fmt', label: 'Số tiền', align: 'right' },
    { key: 'actor_name', label: 'Nhân viên thực hiện' },
  ], posExpenses.map(e => ({
    occurred_at_fmt: dateTime(e.occurred_at),
    supplier_name: e.supplier_name || 'Mua lẻ',
    product: e.product || '—',
    reason: e.reason || '—',
    amount_fmt: money(e.amount),
    actor_name: e.actor_name || '—',
  }))));

  return report;
}
function buildExpenses(branch_id, query) {
  const report = reportShell('expenses', query);
  const range = rangeFromQuery(query);
  const rows = db.prepare(`
    SELECT * FROM expenses
    WHERE branch_id=? AND expense_date>=? AND expense_date<=?
    ORDER BY expense_date DESC, created_at DESC`).all(branch_id, range.from, range.to);
  const total = rowsSum(rows, 'amount');
  const drawer = rows.filter(r => r.source === 'drawer').reduce((s, r) => s + (Number(r.amount) || 0), 0);
  report.summary = [
    { label: 'Tổng chi', value: money(total) },
    { label: 'Chi từ két', value: money(drawer) },
    { label: 'Chi trực tiếp', value: money(total - drawer) },
    { label: 'Số phiếu', value: rows.length },
  ];
  report.sections.push(section('Chi tiết chi phí', [
    { key: 'expense_date', label: 'Ngày' },
    { key: 'code', label: 'Mã' },
    { key: 'category_name', label: 'Danh mục' },
    { key: 'payee_name', label: 'Người nhận' },
    { key: 'source_label', label: 'Nguồn' },
    { key: 'amount_fmt', label: 'Số tiền', align: 'right' },
  ], rows.map(r => ({
    ...r,
    expense_date: dateOnly(r.expense_date),
    payee_name: r.payee_name || '—',
    source_label: r.source === 'drawer' ? 'Tiền két' : 'Chi trực tiếp',
    amount_fmt: money(r.amount),
  }))));
  // By category
  const byCat = new Map();
  for (const r of rows) {
    const k = r.category_name || 'Khác';
    byCat.set(k, (byCat.get(k) || 0) + (Number(r.amount) || 0));
  }
  report.sections.push(section('Chi phí theo danh mục', [
    { key: 'name', label: 'Danh mục' },
    { key: 'amount_fmt', label: 'Số tiền', align: 'right' },
  ], [...byCat.entries()].sort((a, b) => b[1] - a[1]).map(([name, amount]) => ({ name, amount_fmt: money(amount) }))));
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
function buildSingleReport(type = 'sales_overview', branch_id = 'br1', query = {}) {
  if (['sales_fnb', 'sales_retail', 'sales_by_product'].includes(type)) type = 'sales_overview';
  let report;
  if (['sales_overview', 'sales_online'].includes(type)) report = buildSales(type, branch_id, query);
  else if (type === 'purchase_orders') report = buildPurchaseOrders(branch_id, query);
  else if (type === 'purchase_price_analysis') report = buildPurchasePriceAnalysis(branch_id, query);
  else if (type === 'expenses') report = buildExpenses(branch_id, query);
  else if (type === 'purchase') report = buildMovements(type, branch_id, query);
  else if (type === 'issue') report = buildMovements(type, branch_id, query);
  else if (type === 'stock') report = buildStock(branch_id, query);
  else if (type === 'stocktake') report = buildStocktake(branch_id, query);
  else if (type === 'cash_drawer') report = buildCashDrawer(branch_id, query);
  else if (type === 'payables') report = buildPayables(branch_id, query);
  else if (type === 'receivables') report = buildReceivables(branch_id, query);
  else if (type === 'customers_status') report = buildCustomers(branch_id, query);
  else if (type === 'staff') report = buildStaff(branch_id, query);
  else report = buildSales('sales_overview', branch_id, query);
  report.branch_id = branch_id;
  return report;
}
export function buildReport(type = 'sales_overview', scopeInput = 'br1', query = {}) {
  const scope = normalizeScope(scopeInput);
  const branchIds = scope.branch_ids.length ? scope.branch_ids : ['br1'];
  if (branchIds.length === 1) return withScope(buildSingleReport(type, branchIds[0], query), normalizeScope(branchIds[0]));
  return combineBranchReports(type, scope, query, branchIds.map(id => buildSingleReport(type, id, query)));
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
function sheetName(name, used = new Set()) {
  const base = String(name || 'Sheet')
    .replace(/[:\\/?*\[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 28) || 'Sheet';
  let out = base;
  let i = 2;
  while (used.has(out)) out = `${base.slice(0, 25)} ${i++}`;
  used.add(out);
  return out;
}
export async function renderReportXlsx(report) {
  const thinBorder = { bottomBorderColor: '#E1E7EF', bottomBorderStyle: 'thin' };
  const headerStyle = {
    fontWeight: 'bold',
    textColor: '#172033',
    backgroundColor: '#EFF6FF',
    alignVertical: 'center',
    wrap: true,
    ...thinBorder,
  };
  const bodyStyle = { alignVertical: 'top', wrap: true, ...thinBorder };
  const rightBodyStyle = { ...bodyStyle, align: 'right' };
  const titleStyle = { fontWeight: 'bold', fontSize: 14, textColor: '#172033' };
  const labelStyle = { fontWeight: 'bold', textColor: '#445065', ...bodyStyle };

  const cellValue = value => {
    if (value === undefined || value === null) return '';
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'boolean' || value instanceof Date) return value;
    return String(value);
  };
  const numericCell = (value, style = {}) => ({
    value: Number(value),
    type: Number,
    format: '#,##0.##',
    ...style,
  });
  const cell = (value, style = {}) => {
    const out = cellValue(value);
    if (typeof out === 'number') return numericCell(out, style);
    return { value: out, ...style };
  };
  const rawAliases = {
    amount_fmt: 'amount',
    total_fmt: 'total',
    paid_fmt: 'amount_paid',
    qty_fmt: 'qty',
    price_fmt: 'unit_price',
    unit_cost_fmt: 'unit_cost',
    cost_fmt: 'cost',
    stock_fmt: 'stock',
    min_stock_fmt: 'min_stock',
    expected_fmt: 'expected_qty',
    counted_fmt: 'counted_qty',
    delta_fmt: 'delta_qty',
    spent_fmt: 'total_spent',
    revenue_fmt: 'total_revenue',
    expected_cash_fmt: 'expected_cash',
    opening_fmt: 'opening_cash',
    cash_sales_fmt: 'cash_sales',
    expense_fmt: 'drawer_expenses',
    reimburse_fmt: 'drawer_reimbursements',
    before_fmt: 'balance_before',
    after_fmt: 'balance_after',
    reimbursed_fmt: 'reimbursed_amount',
  };
  const sectionValue = (row, key) => {
    const rawKey = rawAliases[key] || (key.endsWith('_fmt') ? key.slice(0, -4) : '');
    if (rawKey && Object.prototype.hasOwnProperty.call(row, rawKey)) {
      const n = Number(row[rawKey]);
      if (Number.isFinite(n)) return n;
    }
    return row[key];
  };

  const usedNames = new Set();
  const sheets = [{
    sheet: sheetName('Tổng quan', usedNames),
    data: [
      [{ value: report.title || 'Report', columnSpan: 2, ...titleStyle }, null],
      [cell('Báo cáo', labelStyle), cell(report.title, bodyStyle)],
      [cell('Kỳ báo cáo', labelStyle), cell(report.range?.label || '', bodyStyle)],
      [cell('Xuất lúc', labelStyle), cell(report.generated_at || '', bodyStyle)],
      [cell('Chi nhánh', labelStyle), cell(report.scope?.label || '', bodyStyle)],
      [cell('', bodyStyle), cell('', bodyStyle)],
      [cell('Chỉ số', headerStyle), cell('Giá trị', headerStyle)],
      ...(report.summary || []).map(s => [
        cell(s.label, bodyStyle),
        s.raw !== undefined && Number.isFinite(Number(s.raw))
          ? numericCell(s.raw, rightBodyStyle)
          : cell(s.value, rightBodyStyle),
      ]),
    ],
    columns: [{ width: 28 }, { width: 34 }],
    stickyRowsCount: 1,
    showGridLines: false,
  }];

  for (const sec of report.sections || []) {
    const cols = sec.columns || [];
    const rows = sec.rows || [];
    const header = cols.length
      ? cols.map(c => cell(c.label, { ...headerStyle, align: c.align === 'right' ? 'right' : 'left' }))
      : [cell('Dữ liệu', headerStyle)];
    const dataRows = rows.length
      ? rows.map(row => cols.map(c => cell(sectionValue(row, c.key), c.align === 'right' ? rightBodyStyle : bodyStyle)))
      : [[cell('Không có dữ liệu', bodyStyle)]];
    sheets.push({
      sheet: sheetName(sec.title, usedNames),
      data: [header, ...dataRows],
      columns: cols.length ? cols.map(c => ({ width: c.align === 'right' ? 16 : 24 })) : [{ width: 24 }],
      stickyRowsCount: 1,
      showGridLines: false,
      orientation: cols.length > 5 ? 'landscape' : 'portrait',
    });
  }
  return Buffer.from(await writeExcelFile(sheets, {
    fontFamily: 'Arial',
    fontSize: 10,
  }).toBuffer());
}
export function renderReportXls(report) {
  return renderReportXlsx(report);
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
    'chromium',
    'chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
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

export async function renderReportPdfKit(report) {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 28, bufferPages: true });
  const chunks = [];
  doc.on('data', c => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  const regular = path.resolve(process.cwd(), 'flutter-apps/dandpak_desktop/assets/fonts/BeVietnamPro-Regular.ttf');
  const bold = path.resolve(process.cwd(), 'flutter-apps/dandpak_desktop/assets/fonts/BeVietnamPro-Bold.ttf');
  const hasFont = existsSync(regular) && existsSync(bold);
  if (hasFont) {
    doc.registerFont('ReportRegular', regular);
    doc.registerFont('ReportBold', bold);
  }
  const font = (weight = 'regular') => doc.font(hasFont ? (weight === 'bold' ? 'ReportBold' : 'ReportRegular') : (weight === 'bold' ? 'Helvetica-Bold' : 'Helvetica'));
  const pageWidth = () => doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const ensure = (height) => {
    if (doc.y + height > doc.page.height - doc.page.margins.bottom) doc.addPage();
  };

  font('bold');
  doc.fontSize(18).fillColor('#172033').text(report.title || 'Báo cáo');
  font();
  doc.fontSize(9).fillColor('#667085')
    .text(`Kỳ báo cáo: ${report.range?.label || ''}`)
    .text(`Xuất lúc: ${report.generated_at || ''}`);
  doc.moveDown(.7);

  const gap = 8;
  const cardWidth = (pageWidth() - gap * 3) / 4;
  let cardX = doc.page.margins.left;
  let cardY = doc.y;
  for (const [i, s] of (report.summary || []).entries()) {
    if (i > 0 && i % 4 === 0) {
      cardX = doc.page.margins.left;
      cardY += 48;
    }
    doc.roundedRect(cardX, cardY, cardWidth, 40, 5).strokeColor('#D9DEE7').stroke();
    font();
    doc.fontSize(8).fillColor('#667085').text(String(s.label || ''), cardX + 8, cardY + 7, { width: cardWidth - 16 });
    font('bold');
    doc.fontSize(11).fillColor('#172033').text(String(s.value ?? ''), cardX + 8, cardY + 22, { width: cardWidth - 16 });
    cardX += cardWidth + gap;
  }
  doc.y = cardY + 54;

  const drawTable = (sec) => {
    ensure(52);
    font('bold');
    doc.fontSize(12).fillColor('#172033').text(sec.title || 'Chi tiết');
    doc.moveDown(.35);
    const cols = (sec.columns || []).slice(0, 10);
    if (!cols.length) return;
    const rightCount = cols.filter(c => c.align === 'right').length;
    const baseWidths = cols.map(c => c.align === 'right' ? 70 : Math.max(72, (pageWidth() - 70 * rightCount) / Math.max(1, cols.length - rightCount)));
    const scale = pageWidth() / baseWidths.reduce((a, b) => a + b, 0);
    const widths = baseWidths.map(w => w * scale);
    const drawRow = (values, header = false) => {
      const startY = doc.y;
      const heights = values.map((v, i) => doc.heightOfString(String(v ?? ''), { width: widths[i] - 8 }) + 10);
      const rowHeight = Math.max(header ? 24 : 22, Math.min(58, Math.max(...heights)));
      ensure(rowHeight + 2);
      let x = doc.page.margins.left;
      for (let i = 0; i < cols.length; i++) {
        doc.rect(x, doc.y, widths[i], rowHeight).fillAndStroke(header ? '#EFF6FF' : '#FFFFFF', '#D9DEE7');
        font(header ? 'bold' : 'regular');
        doc.fontSize(header ? 8 : 7.6).fillColor(header ? '#445065' : '#172033')
          .text(String(values[i] ?? ''), x + 4, doc.y + 5, {
            width: widths[i] - 8,
            height: rowHeight - 8,
            align: cols[i].align === 'right' ? 'right' : 'left',
          });
        x += widths[i];
      }
      doc.y = startY + rowHeight;
    };
    drawRow(cols.map(c => c.label), true);
    const rows = (sec.rows || []).slice(0, 400);
    if (!rows.length) drawRow(['Không có dữ liệu']);
    for (const row of rows) drawRow(cols.map(c => row[c.key] ?? ''));
    if ((sec.rows || []).length > rows.length) {
      font();
      doc.fontSize(8).fillColor('#667085').text(`Còn ${sec.rows.length - rows.length} dòng, vui lòng xem trong Excel/Google Sheet.`);
    }
    doc.moveDown(.8);
  };

  for (const sec of report.sections || []) drawTable(sec);
  doc.end();
  return done;
}
