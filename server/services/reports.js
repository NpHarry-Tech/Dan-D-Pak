// Reporting Core: realtime KPIs for the Admin dashboard.
import { db } from '../db.js';
import { archiveDashboardReport } from './archive.js';

const todayStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); };
const tomorrowStart = () => { const d = new Date(); d.setHours(24, 0, 0, 0); return d.toISOString(); };

function businessWindow(branch_id = 'br1') {
  const calendarStart = todayStart();
  const calendarEnd = tomorrowStart();
  const firstShift = db.prepare(`
    SELECT opened_at FROM shifts
    WHERE branch_id=? AND opened_at>=? AND opened_at<?
    ORDER BY opened_at ASC LIMIT 1`).get(branch_id, calendarStart, calendarEnd);
  const lastShift = db.prepare(`
    SELECT opened_at,closed_at,status FROM shifts
    WHERE branch_id=? AND opened_at>=? AND opened_at<?
    ORDER BY opened_at DESC LIMIT 1`).get(branch_id, calendarStart, calendarEnd);

  const start = firstShift?.opened_at || calendarStart;
  const end = lastShift?.status === 'closed' && lastShift.closed_at ? lastShift.closed_at : new Date().toISOString();
  return {
    start,
    end,
    calendar_start: calendarStart,
    calendar_end: calendarEnd,
    source: firstShift ? 'shift' : 'calendar',
    closed: !!(lastShift?.status === 'closed' && lastShift.closed_at),
  };
}

export function dashboard(branch_id = 'br1') {
  const window = businessWindow(branch_id);
  const paid = db.prepare(`SELECT * FROM orders WHERE branch_id=? AND status='paid' AND paid_at>=? AND paid_at<=?`).all(branch_id, window.start, window.end);
  const revenue = paid.reduce((s, o) => s + o.total, 0);
  const bills = paid.length;
  const avg = bills ? Math.round(revenue / bills) : 0;
  const openOrders = db.prepare(`SELECT COUNT(*) n FROM orders WHERE branch_id=? AND status='open'`).get(branch_id).n;

  // revenue by hour
  const byHour = Array.from({ length: 24 }, () => 0);
  for (const o of paid) byHour[new Date(o.paid_at).getHours()] += o.total;

  // payment methods
  const methods = db.prepare(`
    SELECT pl.method, SUM(pl.amount) amt FROM payment_lines pl
    JOIN payments p ON p.id=pl.payment_id
    JOIN orders o ON o.id=p.order_id
    WHERE o.branch_id=? AND o.paid_at>=? AND o.paid_at<=? GROUP BY pl.method`).all(branch_id, window.start, window.end);

  // top items today
  const topItems = db.prepare(`
    SELECT oi.name, oi.emoji, SUM(oi.qty) qty, SUM(oi.qty*oi.unit_price) revenue
    FROM order_items oi JOIN orders o ON o.id=oi.order_id
    WHERE o.branch_id=? AND o.status='paid' AND o.paid_at>=? AND o.paid_at<=? AND oi.status!='cancelled'
    GROUP BY oi.name ORDER BY qty DESC LIMIT 8`).all(branch_id, window.start, window.end);

  // revenue by channel
  const byChannel = {};
  for (const o of paid) byChannel[o.channel] = (byChannel[o.channel] || 0) + o.total;

  const lowStock = [
    ...db.prepare(`SELECT name,stock,min_stock,unit FROM inventory_items WHERE branch_id=? AND stock<=min_stock`).all(branch_id),
    ...db.prepare(`SELECT name,stock,min_stock,unit FROM skus WHERE branch_id=? AND stock<=min_stock`).all(branch_id),
  ].sort((a, b) => a.stock - b.stock);

  // station load (active KDS items)
  const stations = db.prepare(`
    SELECT oi.station, COUNT(*) n FROM order_items oi JOIN orders o ON o.id=oi.order_id
    WHERE o.branch_id=? AND oi.status IN ('new','accepted','preparing') GROUP BY oi.station`).all(branch_id);

  const report = { revenue, bills, avg, openOrders, byHour, byChannel, methods, topItems, lowStock, stations, window };
  archiveDashboardReport(report, branch_id);
  return report;
}

// Revenue trends across calendar periods (day / week / month / quarter / year),
// bucketed in server local time so labels match the dashboard clock.
export function revenueTrends(branch_id = 'br1') {
  const pad = (n) => String(n).padStart(2, '0');
  const now = new Date();
  // earliest data we need is for the 5-year series
  const cutoff = new Date(now.getFullYear() - 4, 0, 1).toISOString();
  const rows = db.prepare(
    `SELECT paid_at, total FROM orders WHERE branch_id=? AND status='paid' AND paid_at>=?`
  ).all(branch_id, cutoff);

  const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const monthKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  const quarterKey = (d) => `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
  const yearKey = (d) => `${d.getFullYear()}`;
  const mondayOf = (d) => {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // back to Monday
    return x;
  };
  const weekKey = (d) => dayKey(mondayOf(d));

  // Pre-build the period buckets (chronological) so empty periods render as zero.
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = [];
  for (let i = 6; i >= 0; i--) { const d = new Date(today); d.setDate(d.getDate() - i); days.push({ key: dayKey(d), label: `${pad(d.getDate())}/${pad(d.getMonth() + 1)}` }); }
  const weeks = [];
  const thisMonday = mondayOf(today);
  for (let i = 7; i >= 0; i--) { const d = new Date(thisMonday); d.setDate(d.getDate() - i * 7); weeks.push({ key: dayKey(d), label: `${pad(d.getDate())}/${pad(d.getMonth() + 1)}` }); }
  const months = [];
  for (let i = 11; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); months.push({ key: monthKey(d), label: `${pad(d.getMonth() + 1)}/${d.getFullYear()}` }); }
  const quarters = [];
  for (let i = 7; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i * 3, 1); quarters.push({ key: quarterKey(d), label: `Q${Math.floor(d.getMonth() / 3) + 1}/${d.getFullYear()}` }); }
  const years = [];
  for (let i = 4; i >= 0; i--) { const d = new Date(now.getFullYear() - i, 0, 1); years.push({ key: yearKey(d), label: `${d.getFullYear()}` }); }

  const sum = (list, keyFn) => {
    const map = new Map(list.map((p) => [p.key, 0]));
    for (const r of rows) { const k = keyFn(new Date(r.paid_at)); if (map.has(k)) map.set(k, map.get(k) + r.total); }
    return list.map((p) => ({ label: p.label, value: map.get(p.key) || 0 }));
  };

  return {
    byDay: sum(days, dayKey),
    byWeek: sum(weeks, weekKey),
    byMonth: sum(months, monthKey),
    byQuarter: sum(quarters, quarterKey),
    byYear: sum(years, yearKey),
  };
}

// before: con trỏ phân trang — chỉ lấy các dòng cũ hơn mốc thời gian này (để "Xem thêm").
// from / to: khoảng thời gian cụ thể (ISO, nửa mở [from, to)) do client tính theo
//   múi giờ trình duyệt — dùng cho bộ lọc Ngày/Tuần/Tháng/Quý/Năm cụ thể. Khi có
//   from/to thì `period` (mốc tương đối) không cần thiết nữa.
export function recentAudit(branch_id = 'br1', limit = 30, before = null, period = null, search = '', from = null, to = null) {
  const lim = Math.min(Math.max(parseInt(limit) || 30, 1), 1000);
  let timeCutoff = null;
  const now = new Date();

  if (period === 'day') {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    timeCutoff = d.toISOString();
  } else if (period === 'week') {
    const d = new Date(now);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d.setDate(diff));
    monday.setHours(0, 0, 0, 0);
    timeCutoff = monday.toISOString();
  } else if (period === 'month') {
    const d = new Date(now.getFullYear(), now.getMonth(), 1);
    timeCutoff = d.toISOString();
  } else if (period === 'quarter') {
    const currentQuarter = Math.floor(now.getMonth() / 3);
    const d = new Date(now.getFullYear(), currentQuarter * 3, 1);
    timeCutoff = d.toISOString();
  } else if (period === 'year') {
    const d = new Date(now.getFullYear(), 0, 1);
    timeCutoff = d.toISOString();
  }

  let query = `SELECT action,detail,actor,created_at FROM audit_log WHERE branch_id=?`;
  const params = [branch_id];

  if (timeCutoff) {
    query += ` AND created_at >= ?`;
    params.push(timeCutoff);
  }

  // Bounded specific period [from, to): từ client (đúng múi giờ trình duyệt).
  if (from) {
    query += ` AND created_at >= ?`;
    params.push(String(from));
  }
  if (to) {
    query += ` AND created_at < ?`;
    params.push(String(to));
  }

  if (before) {
    query += ` AND created_at < ?`;
    params.push(before);
  }

  if (search && String(search).trim()) {
    query += ` AND (actor LIKE ? OR action LIKE ? OR detail LIKE ?)`;
    const s = `%${String(search).trim()}%`;
    params.push(s, s, s);
  }

  query += ` ORDER BY created_at DESC LIMIT ?`;
  params.push(lim);

  return db.prepare(query).all(...params);
}
