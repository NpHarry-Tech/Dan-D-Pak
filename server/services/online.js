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

function headerVal(headers = {}, name) {
  if (!headers) return '';
  const lower = name.toLowerCase();
  for (const k of Object.keys(headers)) if (k.toLowerCase() === lower) return String(headers[k] || '');
  return '';
}

// Online partner webhook auth is fail-closed.
// Enabled channels must configure webhookSecret and every request must send it
// through x-webhook-secret, secure-token, Bearer, or Apikey.
function assertWebhookSecret(channel, headers = {}, branch_id = 'br1') {
  const integKey = CHANNEL_INTEGRATION[channel] || channel;
  const cfg = getIntegrations(branch_id).channels?.[integKey] || {};
  const secret = String(cfg.webhookSecret || '').trim();
  if (!secret) {
    audit('online.webhook.rejected', { channel, reason: 'no_secret_configured' }, branch_id, `webhook:${channel}`);
    const e = new Error('Kenh online dang bat nhung chua cau hinh webhook secret.');
    e.status = 401;
    throw e;
  }
  const provided = (headerVal(headers, 'x-webhook-secret')
    || headerVal(headers, 'secure-token')
    || headerVal(headers, 'authorization').replace(/^(bearer|apikey)\s+/i, '')).trim();
  if (provided !== secret) {
    audit('online.webhook.rejected', { channel, reason: 'bad_secret' }, branch_id, `webhook:${channel}`);
    const e = new Error('Sai webhook secret cho kenh ' + (CHANNELS[channel] || channel));
    e.status = 401;
    throw e;
  }
}

function resolveItemMapping(line, branch_id) {
  const qty = Math.max(1, parseInt(line.qty || line.quantity) || 1);
  
  // 1. Try by direct sku_id
  if (line.sku_id) {
    const exists = db.prepare(`SELECT id FROM skus WHERE id=? AND branch_id=?`).get(line.sku_id, branch_id);
    if (exists) return { sku_id: line.sku_id, qty };
  }
  // 2. Try by direct menu_item_id
  if (line.menu_item_id) {
    const exists = db.prepare(`SELECT id FROM menu_items WHERE id=?`).get(line.menu_item_id);
    if (exists) return { menu_item_id: line.menu_item_id, qty };
  }
  // 3. Try mapping by barcode / sku code
  const code = line.sku || line.barcode || '';
  if (code) {
    const sku = db.prepare(`SELECT id FROM skus WHERE (barcode=? OR id=?) AND branch_id=?`).get(code, code, branch_id);
    if (sku) return { sku_id: sku.id, qty };
  }
  // 4. Try matching by name (case-insensitive)
  const name = String(line.name || '').trim();
  if (name) {
    const sku = db.prepare(`SELECT id FROM skus WHERE LOWER(name)=LOWER(?) AND branch_id=?`).get(name, branch_id);
    if (sku) return { sku_id: sku.id, qty };

    const mi = db.prepare(`SELECT id FROM menu_items WHERE LOWER(name)=LOWER(?)`).get(name);
    if (mi) return { menu_item_id: mi.id, qty };
  }

  // KHÃ”NG fallback vá» "SKU/mÃ³n Ä‘áº§u tiÃªn": lÃ m váº­y sáº½ trá»« nháº§m kho má»™t sáº£n pháº©m báº¥t ká»³
  // vÃ  ghi doanh thu áº£o khi Ä‘á»‘i tÃ¡c gá»­i dÃ²ng hÃ ng láº¡. Tá»« chá»‘i Ä‘á»ƒ Ä‘á»‘i soÃ¡t thá»§ cÃ´ng.
  const e = new Error(`KhÃ´ng khá»›p Ä‘Æ°á»£c sáº£n pháº©m online: "${name || line.sku || line.barcode || '?'}". ÄÆ¡n bá»‹ tá»« chá»‘i Ä‘á»ƒ trÃ¡nh trá»« nháº§m kho â€” hÃ£y Ã¡nh xáº¡ sáº£n pháº©m trong CÃ i Ä‘áº·t.`);
  e.code = 'ONLINE_ITEM_UNMAPPED';
  throw e;
}

export function normalizeWebhookPayload(payload) {
  // If it's already normalized (native)
  if (payload.channel && payload.items && !payload.line_items && !payload.orderID && !payload.order_id) {
    return payload;
  }

  // 1. Haravan / Shopify webhook format
  if (payload.line_items && (payload.id || payload.order_number)) {
    const customer = payload.customer || {};
    const shipping = payload.shipping_address || {};
    const name = customer.first_name || customer.last_name
      ? `${customer.first_name || ''} ${customer.last_name || ''}`.trim()
      : 'KhÃ¡ch hÃ ng Haravan';
    
    const items = payload.line_items.map(li => ({
      sku: li.sku,
      name: li.name,
      qty: li.quantity || 1,
      price: Math.round(Number(li.price || 0)),
      note: li.note || ''
    }));

    const shipping_fee = Math.round(Number(payload.total_shipping_fee || payload.shipping_fee || 0));
    const discount = Math.round(Number(payload.total_discounts || payload.discount || 0));
    const vat = Math.round(Number(payload.total_tax || payload.vat || 0));

    return {
      channel: 'website',
      ref: String(payload.order_number || payload.id),
      customer: {
        name,
        phone: customer.phone || payload.phone || '',
        email: customer.email || payload.email || '',
        address: shipping.address1 ? `${shipping.address1}, ${shipping.city || ''}` : '',
        company: shipping.company || '',
        need_invoice: !!shipping.company,
        shipping_fee,
        discount,
        vat,
        delivery_time: payload.shipping_lines?.[0]?.title || 'Giao hÃ ng tiÃªu chuáº©n',
        note: payload.note || ''
      },
      items
    };
  }

  // 2. GrabFood Webhook format
  if (payload.orderID || payload.shortOrderNumber) {
    const grabItems = payload.items || [];
    const items = grabItems.map(gi => ({
      sku: gi.id || gi.sku,
      name: gi.name,
      qty: gi.quantity || gi.qty || 1,
      price: Math.round(Number(gi.price || gi.unit_price || 0)),
      note: gi.note || ''
    }));

    const customer = payload.customer || {};
    const shipping_fee = Math.round(Number(payload.deliveryFee || 0));
    const discount = Math.round(Number(payload.discount || 0));

    return {
      channel: 'grabfood',
      ref: payload.orderID || payload.shortOrderNumber,
      customer: {
        name: customer.name || 'KhÃ¡ch hÃ ng GrabFood',
        phone: customer.phone || '',
        email: customer.email || '',
        address: payload.deliveryAddress || '',
        shipping_fee,
        discount,
        vat: 0,
        delivery_time: 'Giao ngay (GrabExpress)',
        note: payload.note || ''
      },
      items
    };
  }

  // 3. ShopeeFood Webhook format
  if (payload.order_id || payload.restaurant_id) {
    const shopeeItems = payload.items || [];
    const items = shopeeItems.map(si => ({
      sku: si.item_id || si.sku,
      name: si.name,
      qty: si.qty || si.quantity || 1,
      price: Math.round(Number(si.price || si.unit_price || 0)),
      note: si.note || ''
    }));

    const customer = payload.customer || {};
    const shipping_fee = Math.round(Number(payload.delivery_fee || 0));
    const discount = Math.round(Number(payload.discount || 0));

    return {
      channel: 'shopeefood',
      ref: payload.order_id,
      customer: {
        name: customer.name || 'KhÃ¡ch hÃ ng ShopeeFood',
        phone: customer.phone || '',
        email: customer.email || '',
        address: payload.delivery_address || '',
        shipping_fee,
        discount,
        vat: 0,
        delivery_time: 'Giao ngay (ShopeeFood)',
        note: payload.note || ''
      },
      items
    };
  }

  // Default fallback if unknown shape but has items
  if (payload.items) {
    return {
      channel: payload.channel || 'website',
      ref: payload.ref || 'ON-' + Math.floor(Math.random() * 90000 + 10000),
      customer: payload.customer || {},
      items: payload.items
    };
  }

  throw new Error('Payload webhook khÃ´ng há»£p lá»‡ hoáº·c cáº¥u trÃºc khÃ´ng Ä‘Æ°á»£c há»— trá»£.');
}

// payload: { channel, ref?, customer?, items:[{menu_item_id|sku_id, name, qty, price, note}] }
export function receive(payload, branch_id = 'br1', headers = {}) {
  // XÃ¡c thá»±c + chuáº©n hoÃ¡ NGOÃ€I transaction Ä‘á»ƒ audit tá»« chá»‘i khÃ´ng bá»‹ rollback theo.
  const norm = normalizeWebhookPayload(payload);
  const channel = norm.channel;
  assertChannelEnabled(channel, branch_id);
  assertWebhookSecret(channel, headers, branch_id);
  if (!norm.items?.length) throw new Error('ÄÆ¡n online rá»—ng');

  db.prepare('BEGIN IMMEDIATE').run();
  try {
    const mappedItems = norm.items.map(line => {
      const mapped = resolveItemMapping(line, branch_id);
      return {
        ...mapped,
        originalName: line.name || 'Sáº£n pháº©m online',
        originalPrice: Number(line.price || line.unit_price || 0),
        originalNote: line.note || '',
      };
    });

    const order = createOrUpdateOrder({ branch_id, table_id: null, channel: 'online', items: mappedItems, skipTransaction: true });
    const ref = norm.ref || (channel.slice(0, 2).toUpperCase() + '-' + Math.floor(Math.random() * 90000 + 10000));
    
    // Update order items with original webhook names, prices, and notes
    const dbItems = db.prepare(`SELECT id FROM order_items WHERE order_id=? ORDER BY created_at ASC`).all(order.id);
    const updItem = db.prepare(`UPDATE order_items SET name=?, unit_price=?, note=? WHERE id=?`);
    for (let i = 0; i < dbItems.length; i++) {
      const mapped = mappedItems[i];
      if (mapped && dbItems[i]) {
        updItem.run(mapped.originalName, mapped.originalPrice, mapped.originalNote || null, dbItems[i].id);
      }
    }

    // Update order totals with discount and metadata
    const subtotal = mappedItems.reduce((s, it) => s + it.qty * it.originalPrice, 0);
    const discount = Math.round(Number(norm.customer?.discount || 0));
    const total = Math.max(0, subtotal - discount);
    
    db.prepare(`UPDATE orders SET subtotal=?, discount=?, total=?, online_channel=?, online_ref=?, online_status='received', customer_json=? WHERE id=?`)
      .run(subtotal, discount, total, channel, ref, JSON.stringify(norm.customer || {}), order.id);

    // Prepaid: record revenue + deduct stock, but keep KDS item workflow alive.
    const fresh = getOrder(order.id);
    printCupLabels({ ...fresh, online_channel: channel, online_ref: ref, customer: norm.customer || {} }, fresh.items, branch_id);
    
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

    db.prepare('COMMIT').run();
    return full;
  } catch (err) {
    db.prepare('ROLLBACK').run();
    throw err;
  }
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
  if (!FLOW.includes(status)) throw new Error('Tráº¡ng thÃ¡i online khÃ´ng há»£p lá»‡');
  db.prepare(`UPDATE orders SET online_status=? WHERE id=?`).run(status, order_id);
  audit('online.status', { order: order_id, status }, branch_id);
  const full = listOne(order_id);
  emit('online:updated', full, branch_id);
  return full;
}

export function confirmPayment(order_id, branch_id = 'br1') {
  db.prepare(`UPDATE orders SET status='paid', paid_at=? WHERE id=?`).run(now(), order_id);
  const order = getOrder(order_id);
  const shift = getActiveShift(branch_id);
  // Ensure a payment is recorded
  const hasPayment = db.prepare(`SELECT COUNT(*) c FROM payments WHERE order_id=?`).get(order_id).c;
  if (!hasPayment) {
    const pid = uid('pay_');
    db.prepare(`INSERT INTO payments (id,order_id,shift_id,total,created_at) VALUES (?,?,?,?,?)`).run(pid, order_id, shift?.id || null, order.total, now());
    db.prepare(`INSERT INTO payment_lines (id,payment_id,method,amount,reference) VALUES (?,?,?,?,?)`)
      .run(uid('pl_'), pid, 'online', order.total, order.online_ref || 'online');
  }
  audit('online.confirm_payment', { order: order_id }, branch_id);
  const full = listOne(order_id);
  emit('online:updated', full, branch_id);
  return full;
}

export function confirmDelivery(order_id, branch_id = 'br1') {
  db.prepare(`UPDATE orders SET online_status='completed' WHERE id=?`).run(order_id);
  audit('online.confirm_delivery', { order: order_id }, branch_id);
  const full = listOne(order_id);
  emit('online:updated', full, branch_id);
  return full;
}

export function returnOrder(order_id, branch_id = 'br1') {
  db.prepare(`UPDATE orders SET status='void' WHERE id=?`).run(order_id);
  audit('online.return', { order: order_id }, branch_id);
  const full = listOne(order_id);
  emit('online:updated', full, branch_id);
  return full;
}

