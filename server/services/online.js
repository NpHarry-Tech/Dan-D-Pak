// Online Channel integration: receive orders from GrabFood / ShopeeFood / Website
// via webhook, map to internal items, route to KDS (FnB) or packing (retail),
// and track fulfillment status. Orders are treated as prepaid (channel revenue).
import { db, uid, now, audit } from '../db.js';
import { emit } from '../realtime.js';
import { createOrUpdateOrder, getOrder } from './orders.js';
import { deductForOrder } from './inventory.js';
import { getIntegrations } from './settings.js';
import { getActiveShift } from './shifts.js';
import { printCupLabels } from './printing.js';

export const CHANNELS = {
  grabfood: 'GrabFood',
  grabmerchant: 'GrabMerchant / GrabFood',
  shopeefood: 'Shopee Food',
  befood: 'BeFood',
  grabmart: 'GrabMart',
  website: 'Website',
};
const FLOW = ['received', 'confirmed', 'preparing', 'ready', 'completed'];
const CHANNEL_INTEGRATION = {
  grabfood: 'grabmerchant',
  grabmerchant: 'grabmerchant',
  shopeefood: 'shopeefood',
  befood: 'befood',
  grabmart: 'grabmart',
  website: 'website',
};

export function listChannels(branch_id = 'br1') {
  const cfg = getIntegrations(branch_id);
  const out = {};
  for (const [key, name] of Object.entries(CHANNELS)) {
    const integKey = CHANNEL_INTEGRATION[key] || key;
    if (cfg.channels?.[integKey]?.enabled) out[key] = name;
  }
  return out;
}

function assertChannelEnabled(channel, branch_id = 'br1') {
  if (!CHANNELS[channel]) throw new Error('Kenh online khong hop le: ' + channel);
  const available = listChannels(branch_id);
  if (!available[channel]) throw new Error('Kenh ' + CHANNELS[channel] + ' chua duoc bat trong Cai dat ket noi.');
}

// payload: { channel, ref?, customer?, items:[{menu_item_id|sku_id, qty, note}] }
export function receive(payload, branch_id = 'br1') {
  const channel = payload.channel;
  assertChannelEnabled(channel, branch_id);
  if (!CHANNELS[channel]) throw new Error('Kênh online không hợp lệ: ' + channel);
  if (!payload.items?.length) throw new Error('Đơn online rỗng');

  const order = createOrUpdateOrder({ branch_id, table_id: null, channel: 'online', items: payload.items });
  const ref = payload.ref || (channel.slice(0, 2).toUpperCase() + '-' + Math.floor(Math.random() * 90000 + 10000));
  db.prepare(`UPDATE orders SET online_channel=?, online_ref=?, online_status='received', customer_json=? WHERE id=?`)
    .run(channel, ref, JSON.stringify(payload.customer || {}), order.id);

  // Prepaid: record revenue + deduct stock, but keep KDS item workflow alive.
  const fresh = getOrder(order.id);
  printCupLabels({ ...fresh, online_channel: channel, online_ref: ref, customer: payload.customer || {} }, fresh.items, branch_id);
  const pid = uid('pay_');
  const shift = getActiveShift(branch_id);
  db.prepare(`INSERT INTO payments (id,order_id,shift_id,total,created_at) VALUES (?,?,?,?,?)`).run(pid, order.id, shift?.id || null, fresh.total, now());
  db.prepare(`INSERT INTO payment_lines (id,payment_id,method,amount,reference) VALUES (?,?,?,?,?)`)
    .run(uid('pl_'), pid, 'online', fresh.total, ref);
  db.prepare(`UPDATE orders SET status='paid', paid_at=? WHERE id=?`).run(now(), order.id);
  deductForOrder(fresh, branch_id);

  audit('online.receive', { channel, ref, total: fresh.total, shift_id: shift?.id || null }, branch_id);
  const full = listOne(order.id);
  emit('online:new', full, branch_id);
  emit('stats:dirty', {}, branch_id);
  return full;
}

function listOne(order_id) {
  const o = getOrder(order_id);
  if (!o) return null;
  const payments = db.prepare(`SELECT pl.method,pl.amount,pl.reference,p.created_at
    FROM payments p JOIN payment_lines pl ON pl.payment_id=p.id
    WHERE p.order_id=? ORDER BY p.created_at ASC`).all(order_id);
  return { ...o, channel_name: CHANNELS[o.online_channel] || o.online_channel,
    customer: JSON.parse(o.customer_json || '{}'), payments };
}

export function listOnline(branch_id = 'br1', limit = 40) {
  return db.prepare(`SELECT id FROM orders WHERE branch_id=? AND channel='online' ORDER BY created_at DESC LIMIT ?`)
    .all(branch_id, limit).map(r => listOne(r.id));
}

export function setStatus(order_id, status, branch_id = 'br1') {
  if (!FLOW.includes(status)) throw new Error('Trạng thái online không hợp lệ');
  db.prepare(`UPDATE orders SET online_status=? WHERE id=?`).run(status, order_id);
  audit('online.status', { order: order_id, status }, branch_id);
  const full = listOne(order_id);
  emit('online:updated', full, branch_id);
  return full;
}
