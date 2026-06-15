// Reporting Core: realtime KPIs for the Admin dashboard.
import { db } from '../db.js';

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

  return { revenue, bills, avg, openOrders, byHour, byChannel, methods, topItems, lowStock, stations, window };
}

export function recentAudit(branch_id = 'br1', limit = 30) {
  return db.prepare(`SELECT action,detail,actor,created_at FROM audit_log WHERE branch_id=? ORDER BY created_at DESC LIMIT ?`)
    .all(branch_id, limit);
}
