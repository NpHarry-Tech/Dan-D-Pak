// Online Channel integration: receive orders from GrabFood / ShopeeFood / Website
// via webhook, map to internal items, route to KDS (FnB) or packing (retail),
// and track fulfillment status. Orders are treated as prepaid (channel revenue).
import { db, uid, now, audit } from '../db.js';
import { headerVal, safeEqual } from '../core/util.js';
import { emit } from '../realtime.js';
import { createOrUpdateOrder, getOrder } from './orders.js';
import { deductForOrder } from './inventory.js';
import { getIntegrations } from './settings.js';
import { getActiveShift } from './shifts.js';
import { printCupLabels } from './printing.js';
import { haravanCapabilities, performHaravanOrderAction } from './haravanConnector.js';
import { payOrder } from './payments.js';

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

export function listChannels(branch_id = 'sala') {
  const cfg = getIntegrations(branch_id);
  const out = {};
  for (const [key, name] of Object.entries(CHANNELS)) {
    const integKey = CHANNEL_INTEGRATION[key] || key;
    if (cfg.channels?.[integKey]?.enabled) out[key] = name;
  }
  return out;
}

function assertChannelEnabled(channel, branch_id = 'sala') {
  if (!CHANNELS[channel]) throw new Error('Kenh online khong hop le: ' + channel);
  const available = listChannels(branch_id);
  if (!available[channel]) throw new Error('Kenh ' + CHANNELS[channel] + ' chua duoc bat trong Cai dat ket noi.');
}

// Enabled online channels must be authenticated. Missing or wrong webhookSecret
// rejects the request; public order intake should not fail open.
function assertWebhookSecret(channel, headers = {}, branch_id = 'sala') {
  const integKey = CHANNEL_INTEGRATION[channel] || channel;
  const cfg = getIntegrations(branch_id).channels?.[integKey] || {};
  const secret = String(cfg.webhookSecret || '').trim();
  if (!secret) {
    audit('online.webhook.rejected', { channel, reason: 'missing_secret_config' }, branch_id, `webhook:${channel}`);
    const e = new Error('Kenh online da bat nhung chua cau hinh webhook secret.');
    e.status = 401;
    throw e;
  }
  const provided = (headerVal(headers, 'x-webhook-secret')
    || headerVal(headers, 'secure-token')
    || headerVal(headers, 'authorization').replace(/^(bearer|apikey)\s+/i, '')).trim();
  if (!safeEqual(provided, secret)) {
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
    const exists = db.prepare(`SELECT id FROM menu_items WHERE id=? AND branch_id=?`).get(line.menu_item_id, branch_id);
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

    const mi = db.prepare(`SELECT id FROM menu_items WHERE LOWER(name)=LOWER(?) AND branch_id=?`).get(name, branch_id);
    if (mi) return { menu_item_id: mi.id, qty };
  }

  // KHÔNG fallback về "SKU/món đầu tiên": làm vậy sẽ trừ nhầm kho một sản phẩm bất kỳ
  // và ghi doanh thu ảo khi đối tác gửi dòng hàng lạ. Từ chối để đối soát thủ công.
  const e = new Error(`Không khớp được sản phẩm online: "${name || line.sku || line.barcode || '?'}". Đơn bị từ chối để tránh trừ nhầm kho — hãy ánh xạ sản phẩm trong Cài đặt.`);
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
      : 'Khách hàng Haravan';
    
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
        delivery_time: payload.shipping_lines?.[0]?.title || 'Giao hàng tiêu chuẩn',
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
        name: customer.name || 'Khách hàng GrabFood',
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
        name: customer.name || 'Khách hàng ShopeeFood',
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

  throw new Error('Payload webhook không hợp lệ hoặc cấu trúc không được hỗ trợ.');
}

// payload: { channel, ref?, customer?, items:[{menu_item_id|sku_id, name, qty, price, note}] }
export function receive(payload, branch_id = 'sala', headers = {}) {
  // Xác thực + chuẩn hoá NGOÀI transaction để audit từ chối không bị rollback theo.
  const norm = normalizeWebhookPayload(payload);
  const channel = norm.channel;
  assertChannelEnabled(channel, branch_id);
  assertWebhookSecret(channel, headers, branch_id);
  const ref = norm.ref || (channel.slice(0, 2).toUpperCase() + '-' + Math.floor(Math.random() * 90000 + 10000));
  if (!norm.items?.length) throw new Error('Đơn online rỗng');

  db.prepare('BEGIN IMMEDIATE').run();
  try {
    const existing = db.prepare(`SELECT id FROM orders WHERE branch_id=? AND online_channel=? AND online_ref=? ORDER BY created_at DESC LIMIT 1`)
      .get(branch_id, channel, ref);
    if (existing) {
      audit('online.receive.duplicate', { channel, ref, order: existing.id }, branch_id);
      const full = listOne(existing.id);
      db.prepare('COMMIT').run();
      return full;
    }

    const mappedItems = norm.items.map(line => {
      const mapped = resolveItemMapping(line, branch_id);
      return {
        ...mapped,
        originalName: line.name || 'Sản phẩm online',
        originalPrice: Number(line.price || line.unit_price || 0),
        originalNote: line.note || '',
      };
    });

    const order = createOrUpdateOrder({ branch_id, table_id: null, channel: 'online', items: mappedItems, skipTransaction: true });
    
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
    db.prepare(`INSERT INTO online_order_state(order_id,workflow_status,locked_at,created_at,updated_at)
      VALUES (?,'processed',?,?,?) ON CONFLICT(order_id) DO UPDATE SET
      workflow_status='processed',locked_at=COALESCE(online_order_state.locked_at,excluded.locked_at),updated_at=excluded.updated_at`)
      .run(order.id, now(), now(), now());

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

export function listOnline(branch_id = 'sala', limit = 40) {
  return db.prepare(`SELECT id FROM orders WHERE branch_id=? AND channel='online' ORDER BY created_at DESC LIMIT ?`)
    .all(branch_id, limit).map(r => listOne(r.id));
}

export function setStatus(order_id, status, branch_id = 'sala') {
  if (!FLOW.includes(status)) throw new Error('Trạng thái online không hợp lệ');
  db.prepare(`UPDATE orders SET online_status=? WHERE id=?`).run(status, order_id);
  const workflow = status === 'ready' ? 'ready_to_ship' : status === 'completed' ? 'delivered' : status;
  db.prepare(`INSERT INTO online_order_state(order_id,workflow_status,created_at,updated_at)
    VALUES (?,?,?,?) ON CONFLICT(order_id) DO UPDATE SET workflow_status=excluded.workflow_status,
    revision=online_order_state.revision+1,updated_at=excluded.updated_at`).run(order_id, workflow, now(), now());
  audit('online.status', { order: order_id, status }, branch_id);
  const full = listOne(order_id);
  emit('online:updated', full, branch_id);
  return full;
}

export function confirmPayment(order_id, branch_id = 'sala') {
  const order = getOrder(order_id);
  if (!order) throw new Error('Đơn online không tồn tại.');
  if (order.status !== 'paid') payOrder(order_id, order.total > 0 ? [{
    method: 'online', amount: order.total, reference: order.online_ref || 'online',
  }] : [], {
    cashier: `online:${order.online_channel || 'channel'}`,
    idempotency_key: `online:${order.online_channel || 'channel'}:${order.online_ref || order.id}:paid`.slice(0, 128),
    external_settlement: true,
    // The connector owns this remote order; do not mirror it into Haravan again.
    skip_channel_outbound: true,
  }, branch_id);
  db.prepare(`INSERT INTO online_order_state(order_id,workflow_status,locked_at,created_at,updated_at)
    VALUES (?,'processed',?,?,?) ON CONFLICT(order_id) DO UPDATE SET workflow_status='processed',
    locked_at=COALESCE(online_order_state.locked_at,excluded.locked_at),revision=online_order_state.revision+1,
    updated_at=excluded.updated_at`).run(order_id, now(), now(), now());
  audit('online.confirm_payment', { order: order_id }, branch_id);
  const full = listOne(order_id);
  emit('online:updated', full, branch_id);
  return full;
}

export function confirmDelivery(order_id, branch_id = 'sala') {
  db.prepare(`UPDATE orders SET online_status='completed' WHERE id=?`).run(order_id);
  db.prepare(`UPDATE online_order_state SET workflow_status='delivered',revision=revision+1,updated_at=? WHERE order_id=?`)
    .run(now(), order_id);
  audit('online.confirm_delivery', { order: order_id }, branch_id);
  const full = listOne(order_id);
  emit('online:updated', full, branch_id);
  return full;
}

export function returnOrder(order_id, branch_id = 'sala') {
  db.prepare(`UPDATE orders SET status='void' WHERE id=?`).run(order_id);
  db.prepare(`UPDATE online_order_state SET workflow_status='return_refund',revision=revision+1,updated_at=? WHERE order_id=?`)
    .run(now(), order_id);
  audit('online.return', { order: order_id }, branch_id);
  const full = listOne(order_id);
  emit('online:updated', full, branch_id);
  return full;
}

function parseJson(value, fallback = {}) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

function sourceWorkflow(order, raw = {}, localStatus = '') {
  const financial = String(raw.financial_status || '').toLowerCase();
  const fulfillment = String(raw.fulfillment_status || '').toLowerCase();
  if (raw.cancelled_at || order.status === 'void') return 'cancelled';
  if (['refunded', 'partially_refunded'].includes(financial) || (raw.refunds || []).length) return 'return_refund';
  if (fulfillment === 'fulfilled' || raw.closed_at) return 'delivered';
  if ((raw.fulfillments || []).some(x => !['cancelled', 'failure'].includes(String(x.status || '').toLowerCase()))) return 'shipping';
  if (['preparing', 'ready_to_ship', 'processed'].includes(localStatus)) return localStatus;
  if (raw.confirmed_at || raw.confirmed === true || order.status === 'paid') return 'processed';
  return 'pending';
}

function onlineOperationRow(row) {
  const raw = parseJson(row.external_raw, {});
  const customer = parseJson(row.customer_json, {});
  const workflowStatus = sourceWorkflow(row, raw, row.local_workflow_status);
  const shipping = raw.shipping_address || {};
  const fulfillments = Array.isArray(raw.fulfillments) ? raw.fulfillments : [];
  const tracking = fulfillments.flatMap(x => x.tracking_numbers || (x.tracking_number ? [x.tracking_number] : []));
  // Dòng hàng (để thẻ đơn hiện ảnh/tên/SL như KiotViet) + tổng hợp.
  const items = db.prepare(`SELECT name,qty,emoji FROM order_items WHERE order_id=? ORDER BY created_at LIMIT 5`).all(row.id);
  const agg = db.prepare(`SELECT COUNT(*) n,COALESCE(SUM(qty),0) q FROM order_items WHERE order_id=?`).get(row.id);
  const rawItems = raw.item_list || raw.items || raw.line_items || [];
  const firstImage = String(rawItems[0]?.image_info?.image_url
    || rawItems[0]?.image?.src || rawItems[0]?.sku_image || rawItems[0]?.image || '');
  const paymentMethod = String(raw.payment_method || raw.gateway
    || (Array.isArray(raw.payment_gateway_names) ? raw.payment_gateway_names[0] : '')
    || raw.payment?.method || raw.payment_info?.method || '');
  return {
    id: row.id,
    bill_no: row.bill_no || null,
    branch_id: row.branch_id,
    provider: row.provider || row.online_channel || 'unknown',
    shop_domain: row.shop_domain || '',
    external_order_id: row.external_order_id || row.online_ref || '',
    external_order_code: row.external_order_code || row.online_ref || '',
    workflow_status: workflowStatus,
    financial_status: raw.financial_status || (row.status === 'paid' ? 'paid' : 'pending'),
    fulfillment_status: raw.fulfillment_status || null,
    total: Number(row.total || 0),
    discount: Number(row.discount || 0),
    created_at: row.created_at,
    updated_at: row.external_updated_at || row.state_updated_at || row.created_at,
    assignee_user_id: row.assignee_user_id || null,
    assignee_name: row.assignee_name || null,
    revision: Number(row.revision || 0),
    locked_at: row.locked_at || null,
    needs_product_mapping: Number(row.unmapped_items || 0) > 0,
    unmapped_items: Number(row.unmapped_items || 0),
    payment_method: paymentMethod,
    first_item_image: firstImage,
    item_count: Number(agg?.n || 0),
    total_qty: Number(agg?.q || 0),
    items: items.map(it => ({ name: it.name || '', qty: Number(it.qty || 0), emoji: it.emoji || '' })),
    customer: {
      id: customer.id || null,
      name: customer.name || raw.customer?.name || shipping.name || '',
      phone: customer.phone || raw.phone || raw.customer?.phone || shipping.phone || '',
      email: customer.email || raw.email || raw.customer?.email || '',
      address: customer.address || shipping.address1 || '',
    },
    shipping: {
      carrier: fulfillments[0]?.tracking_company || raw.shipping_lines?.[0]?.title || '',
      tracking_numbers: [...new Set(tracking.filter(Boolean).map(String))],
    },
  };
}

const OPERATION_SELECT = `SELECT o.*,eo.provider,eo.shop_domain,eo.external_order_id,eo.external_order_code,
  eo.raw_payload external_raw,eo.updated_at external_updated_at,
  s.workflow_status local_workflow_status,s.assignee_user_id,s.locked_at,s.revision,s.updated_at state_updated_at,
  u.name assignee_name,
  (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id=o.id AND oi.sku_id IS NULL AND oi.menu_item_id IS NULL) unmapped_items
  FROM orders o
  LEFT JOIN external_orders eo ON eo.id=(SELECT eo2.id FROM external_orders eo2
    WHERE eo2.internal_order_id=o.id ORDER BY eo2.updated_at DESC,eo2.created_at DESC LIMIT 1)
  LEFT JOIN online_order_state s ON s.order_id=o.id
  LEFT JOIN users u ON u.id=s.assignee_user_id
  WHERE o.branch_id=? AND o.channel='online'`;

export function listOnlineOperations(branch_id = 'sala', query = {}) {
  const limit = Math.max(1, Math.min(200, Number(query.limit) || 50));
  const offset = Math.max(0, Number(query.offset) || 0);
  const wantedStatus = String(query.status || query.bucket || '').trim();
  const provider = String(query.provider || '').trim().toLowerCase();
  const shop = String(query.shop_domain || query.shopDomain || '').trim().toLowerCase();
  const search = String(query.q || query.search || '').trim().toLowerCase();
  const conditions = [];
  const params = [branch_id];
  if (wantedStatus === 'product_attention') {
    conditions.push(`EXISTS (SELECT 1 FROM order_items missing WHERE missing.order_id=o.id
      AND missing.sku_id IS NULL AND missing.menu_item_id IS NULL)`);
  } else if (wantedStatus && wantedStatus !== 'all') {
    conditions.push(`COALESCE(s.workflow_status,CASE WHEN o.status='void' THEN 'cancelled'
      WHEN o.status='paid' THEN 'processed' ELSE 'pending' END)=?`);
    params.push(wantedStatus);
  }
  if (provider) { conditions.push(`LOWER(COALESCE(eo.provider,o.online_channel,''))=?`); params.push(provider); }
  if (shop) { conditions.push(`LOWER(COALESCE(eo.shop_domain,''))=?`); params.push(shop); }
  if (search) {
    conditions.push(`LOWER(COALESCE(o.bill_no,'')||' '||COALESCE(eo.external_order_id,'')||' '||
      COALESCE(eo.external_order_code,'')||' '||COALESCE(o.customer_json,'')) LIKE ?`);
    params.push(`%${search}%`);
  }
  const suffix = conditions.length ? ` AND ${conditions.join(' AND ')}` : '';
  const rows = db.prepare(`${OPERATION_SELECT}${suffix}
    ORDER BY COALESCE(eo.updated_at,s.updated_at,o.created_at) DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset).map(onlineOperationRow);
  const countSql = `SELECT COUNT(*) n FROM orders o
    LEFT JOIN external_orders eo ON eo.id=(SELECT eo2.id FROM external_orders eo2 WHERE eo2.internal_order_id=o.id
      ORDER BY eo2.updated_at DESC,eo2.created_at DESC LIMIT 1)
    LEFT JOIN online_order_state s ON s.order_id=o.id
    WHERE o.branch_id=? AND o.channel='online'${suffix}`;
  const total = Number(db.prepare(countSql).get(...params).n || 0);
  return { rows, total, limit, offset };
}

export function onlineOperationsSummary(branch_id = 'sala') {
  const buckets = { pending: 0, processed: 0, preparing: 0, ready_to_ship: 0, shipping: 0,
    delivered: 0, cancelled: 0, return_refund: 0, product_attention: 0 };
  const statuses = db.prepare(`SELECT COALESCE(s.workflow_status,CASE WHEN o.status='void' THEN 'cancelled'
    WHEN o.status='paid' THEN 'processed' ELSE 'pending' END) status,COUNT(*) count
    FROM orders o LEFT JOIN online_order_state s ON s.order_id=o.id
    WHERE o.branch_id=? AND o.channel='online' GROUP BY status`).all(branch_id);
  for (const row of statuses) {
    if (buckets[row.status] !== undefined) buckets[row.status] = Number(row.count || 0);
  }
  buckets.product_attention = Number(db.prepare(`SELECT COUNT(DISTINCT o.id) count FROM orders o
    JOIN order_items oi ON oi.order_id=o.id WHERE o.branch_id=? AND o.channel='online'
      AND oi.sku_id IS NULL AND oi.menu_item_id IS NULL`).get(branch_id).count || 0);
  const total = Object.entries(buckets).filter(([key]) => key !== 'product_attention')
    .reduce((sum, [, value]) => sum + value, 0);
  return { total, buckets, capabilities: { haravan: haravanCapabilities(branch_id) } };
}

// ĐỐI SOÁT (reconciliation) — tổng hợp theo sàn từ đơn đã ghi nhận. Phí sàn và
// số "sàn thanh toán" thật lấy từ báo cáo đối soát của sàn (chưa có credential →
// để 0 và đánh dấu pending_settlement_report), KHÔNG bịa số để tránh sai sổ.
const RECON_PROVIDERS = { haravan: 'Haravan', shopee: 'Shopee', tiktokshop: 'TikTok Shop',
  lazada: 'Lazada', tiki: 'Tiki', website: 'Website' };

export function reconciliationSummary(branch_id = 'sala', query = {}) {
  const provider = String(query.provider || '').trim().toLowerCase();
  const params = [branch_id];
  let extra = '';
  if (provider) { extra = ` AND LOWER(COALESCE(eo.provider,o.online_channel,''))=?`; params.push(provider); }
  const rows = db.prepare(`SELECT LOWER(COALESCE(eo.provider,o.online_channel,'other')) provider,
      COUNT(*) orders,
      SUM(COALESCE(o.total,0)) revenue,
      SUM(CASE WHEN o.status='paid' THEN COALESCE(o.total,0) ELSE 0 END) settled,
      SUM(CASE WHEN o.status NOT IN ('paid','void') THEN COALESCE(o.total,0) ELSE 0 END) unsettled
    FROM orders o LEFT JOIN external_orders eo ON eo.id=(SELECT eo2.id FROM external_orders eo2
      WHERE eo2.internal_order_id=o.id ORDER BY eo2.updated_at DESC, eo2.created_at DESC LIMIT 1)
    WHERE o.branch_id=? AND o.channel='online'${extra} GROUP BY provider ORDER BY revenue DESC`)
    .all(...params);
  const providers = rows.map(r => ({
    provider: r.provider,
    provider_name: RECON_PROVIDERS[r.provider] || r.provider,
    orders: Number(r.orders || 0),
    revenue: Number(r.revenue || 0),
    settled: Number(r.settled || 0),
    unsettled: Number(r.unsettled || 0),
    platform_fee: 0,
    difference: 0,
    settlement_source: 'pending_settlement_report',
  }));
  const totals = providers.reduce((a, p) => ({
    orders: a.orders + p.orders, revenue: a.revenue + p.revenue,
    settled: a.settled + p.settled, unsettled: a.unsettled + p.unsettled,
  }), { orders: 0, revenue: 0, settled: 0, unsettled: 0 });
  return { totals, providers, note: 'Phí sàn và số tiền sàn thanh toán thật cần báo cáo đối soát từ sàn (đang chờ cấp quyền API).' };
}

export function reconciliationRows(branch_id = 'sala', query = {}) {
  const limit = Math.max(1, Math.min(200, Number(query.limit) || 50));
  const offset = Math.max(0, Number(query.offset) || 0);
  const provider = String(query.provider || '').trim().toLowerCase();
  const settled = String(query.settled || '').trim(); // 'paid' | 'unpaid' | ''
  const params = [branch_id];
  const conds = [];
  if (provider) { conds.push(`LOWER(COALESCE(eo.provider,o.online_channel,''))=?`); params.push(provider); }
  if (settled === 'paid') conds.push(`o.status='paid'`);
  else if (settled === 'unpaid') conds.push(`o.status NOT IN ('paid','void')`);
  const suffix = conds.length ? ` AND ${conds.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT o.id, o.bill_no, o.total, o.status, o.created_at, o.paid_at,
      eo.provider, eo.external_order_code, eo.shop_domain
    FROM orders o LEFT JOIN external_orders eo ON eo.id=(SELECT eo2.id FROM external_orders eo2
      WHERE eo2.internal_order_id=o.id ORDER BY eo2.updated_at DESC, eo2.created_at DESC LIMIT 1)
    WHERE o.branch_id=? AND o.channel='online'${suffix}
    ORDER BY o.created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
  const total = Number(db.prepare(`SELECT COUNT(*) n FROM orders o
    LEFT JOIN external_orders eo ON eo.id=(SELECT eo2.id FROM external_orders eo2
      WHERE eo2.internal_order_id=o.id ORDER BY eo2.updated_at DESC, eo2.created_at DESC LIMIT 1)
    WHERE o.branch_id=? AND o.channel='online'${suffix}`).get(...params).n || 0);
  return {
    rows: rows.map(r => ({
      id: r.id, bill_no: r.bill_no, provider: r.provider || r.online_channel || 'other',
      external_order_code: r.external_order_code || '', shop_domain: r.shop_domain || '',
      customer_pays: Number(r.total || 0), platform_fee: 0, platform_pays: r.status === 'paid' ? Number(r.total || 0) : 0,
      settled: r.status === 'paid', created_at: r.created_at, paid_at: r.paid_at || null,
    })), total, limit, offset,
  };
}

export function getOnlineOperation(order_id, branch_id = 'sala') {
  const row = db.prepare(`${OPERATION_SELECT} AND o.id=? LIMIT 1`).get(branch_id, order_id);
  if (!row) return null;
  const operation = onlineOperationRow(row);
  operation.items = db.prepare(`SELECT id,sku_id,menu_item_id,item_code,item_barcode,name,qty,unit_price,vat_rate,note,promo_json
    FROM order_items WHERE order_id=? ORDER BY created_at,id`).all(order_id);
  operation.source = parseJson(row.external_raw, {});
  return operation;
}

function assertOnlineOrder(order_id, branch_id) {
  const order = db.prepare(`SELECT id FROM orders WHERE id=? AND branch_id=? AND channel='online'`).get(order_id, branch_id);
  if (!order) { const error = new Error('Không tìm thấy đơn Retail Online.'); error.status = 404; throw error; }
}

export function assignOnlineOperation(order_id, user_id, branch_id = 'sala', actor = 'system') {
  assertOnlineOrder(order_id, branch_id);
  const user = db.prepare(`SELECT id,name FROM users WHERE id=? AND active=1`).get(user_id);
  if (!user) throw new Error('Nhân viên được phân công không tồn tại hoặc đã ngừng hoạt động.');
  db.prepare(`INSERT INTO online_order_state(order_id,workflow_status,assignee_user_id,last_action,last_action_by,revision,created_at,updated_at)
    VALUES (?,'pending',?,'assign',?,1,?,?) ON CONFLICT(order_id) DO UPDATE SET
    assignee_user_id=excluded.assignee_user_id,last_action='assign',last_action_by=excluded.last_action_by,
    revision=online_order_state.revision+1,updated_at=excluded.updated_at`)
    .run(order_id, user.id, actor, now(), now());
  audit('online.order.assign', { order_id, assignee_user_id: user.id }, branch_id, actor);
  const result = getOnlineOperation(order_id, branch_id);
  emit('online:updated', result, branch_id);
  return result;
}

export async function transitionOnlineOperation(order_id, action, input = {}, branch_id = 'sala', actor = 'system') {
  assertOnlineOrder(order_id, branch_id);
  const current = getOnlineOperation(order_id, branch_id);
  const localActions = { preparing: 'preparing', ready_to_ship: 'ready_to_ship', mark_shipping: 'shipping' };
  const remoteActions = { confirm: 'processed', cancel: 'cancelled', close: 'delivered', reopen: 'processed', refund: 'return_refund' };
  if (!localActions[action] && !remoteActions[action]) throw new Error('Thao tác đơn online không hợp lệ.');
  if (['cancelled', 'return_refund'].includes(current.workflow_status) && action !== 'reopen') {
    throw new Error('Đơn đã ở trạng thái kết thúc; không thể tiếp tục xử lý.');
  }
  if (remoteActions[action]) {
    if (current.provider === 'haravan') {
      await performHaravanOrderAction({ internalOrderId: order_id, action, input, branchId: branch_id });
    } else if (action !== 'confirm') {
      // cancel/refund/close/reopen cần API sàn (chỉ Haravan có). "confirm" thì
      // với sàn chỉ là XÁC NHẬN NỘI BỘ (đơn đã nằm sẵn trên sàn) → cho đổi trạng
      // thái pending→processed mà không gọi API ngoài.
      throw new Error(`Kênh ${current.provider} chưa hỗ trợ đồng bộ thao tác này.`);
    }
  }
  const status = localActions[action] || remoteActions[action];
  db.prepare(`INSERT INTO online_order_state(order_id,workflow_status,locked_at,last_action,last_action_by,revision,created_at,updated_at)
    VALUES (?,?,?,?,?,1,?,?) ON CONFLICT(order_id) DO UPDATE SET
    workflow_status=excluded.workflow_status,
    locked_at=CASE WHEN excluded.workflow_status='processed' THEN COALESCE(online_order_state.locked_at,excluded.locked_at) ELSE online_order_state.locked_at END,
    last_action=excluded.last_action,last_action_by=excluded.last_action_by,
    revision=online_order_state.revision+1,updated_at=excluded.updated_at`)
    .run(order_id, status, status === 'processed' ? now() : null, action, actor, now(), now());
  audit('online.order.transition', { order_id, action, status }, branch_id, actor);
  const result = getOnlineOperation(order_id, branch_id);
  emit('online:updated', result, branch_id);
  return result;
}


// Xác nhận / chuyển trạng thái NHIỀU đơn cùng lúc (chọn tất cả ở KiotViet).
// Chạy tuần tự, gom kết quả từng đơn để UI biết cái nào lỗi.
export async function bulkTransitionOnlineOperations(ids = [], action, input = {}, branch_id = 'sala', actor = 'system') {
  const list = [...new Set((Array.isArray(ids) ? ids : []).map(x => String(x || '').trim()).filter(Boolean))];
  const results = [];
  for (const id of list) {
    try {
      await transitionOnlineOperation(id, action, input, branch_id, actor);
      results.push({ id, ok: true });
    } catch (e) {
      results.push({ id, ok: false, error: e.message || String(e) });
    }
  }
  return {
    action,
    total: list.length,
    ok_count: results.filter(r => r.ok).length,
    fail_count: results.filter(r => !r.ok).length,
    results,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// LIÊN KẾT HÀNG HÓA SÀN ↔ SKU KHO — đa sàn (Haravan/Shopee/Lazada/TikTok/Tiki).
//
// Bảng external_products là NGUỒN CHUNG cho mọi provider. raw_payload giữ dữ
// liệu gốc listing; product-sync mỗi connector nên lưu kèm envelope chuẩn hoá
// {name,image,sku,...} để list hiển thị nhanh mà không phải hiểu mọi shape sàn.
// "Đã liên kết" = internal_variant_id trỏ tới SKU thật (không phải shadow hvn_).
// ─────────────────────────────────────────────────────────────────────────

// Rút tên/ảnh/sku listing từ raw_payload — ưu tiên envelope chuẩn hoá, sau đó
// fallback theo shape từng sàn (haravan {product,variant}, shopee, lazada, tiktok).
function externalListingMeta(raw) {
  if (!raw || typeof raw !== 'object') return { name: '', image: '', sku: '' };
  let name = raw.name || '';
  let image = raw.image || '';
  let sku = raw.sku || '';
  const p = raw.product || {};
  const v = raw.variant || {};
  if (!name) name = v.title || v.name || p.title || p.name || p.item_name || raw.title || raw.item_name || '';
  if (!image) {
    image = p.image?.src
      || (Array.isArray(p.images) ? (p.images[0]?.src || p.images[0]) : '')
      || (p.image?.image_url_list?.[0])
      || (Array.isArray(p.main_images) ? (p.main_images[0]?.urls?.[0]) : '')
      || (Array.isArray(raw.images) ? (raw.images[0]?.src || raw.images[0]) : '')
      || '';
  }
  if (!sku) sku = v.sku || p.sku || raw.seller_sku || '';
  return { name: String(name || ''), image: String(image || ''), sku: String(sku || '') };
}

// SKU "bóng" do connector tự tạo để đơn có chỗ trừ kho khi CHƯA liên kết mặt
// hàng thật (haravan hvn_, shopee shp_, lazada lzd_, tiktok ttk_). Liên kết vào
// shadow = coi như CHƯA liên kết; auto-link cũng KHÔNG được khớp vào shadow.
const SHADOW_PREFIXES = ['hvn_', 'shp_', 'lzd_', 'ttk_'];
const isShadowId = (id) => SHADOW_PREFIXES.some(p => String(id || '').startsWith(p));
const SHADOW_SKU = `(${SHADOW_PREFIXES.map(p => `ep.internal_variant_id LIKE '${p}%'`).join(' OR ')})`;
// Điều kiện SQL loại trừ shadow khi tìm mặt hàng kho THẬT (cho autoLink).
const NOT_SHADOW_SKU_SQL = SHADOW_PREFIXES.map(p => `id NOT LIKE '${p}%'`).join(' AND ');
const IS_LINKED = `(ep.internal_variant_id IS NOT NULL AND NOT ${SHADOW_SKU})`;

function mapMappingRow(r) {
  const meta = externalListingMeta(parseJson(r.raw_payload, {}));
  const linked = !!r.sku_id && !isShadowId(r.internal_variant_id);
  return {
    provider: r.provider,
    shop_domain: r.shop_domain || '',
    external_product_id: r.external_product_id,
    external_variant_id: r.external_variant_id || '',
    external_sku: r.external_sku || meta.sku || '',
    external_name: meta.name,
    external_image: meta.image,
    mapping_status: linked ? 'catalog_linked' : 'unlinked',
    pos: linked ? {
      sku_id: r.sku_id,
      name: r.pos_name || '',
      code: r.pos_code || '',
      barcode: r.pos_barcode || '',
      image: r.pos_image || '',
      price: Number(r.pos_price || 0),
      stock: Number(r.pos_stock || 0),
    } : null,
  };
}

export function listProductMappings(branch_id = 'sala', query = {}) {
  const provider = String(query.provider || '').trim().toLowerCase();
  const shop = String(query.shop_domain || query.shopDomain || '').trim().toLowerCase();
  const status = String(query.status || 'all').trim();
  const q = String(query.q || query.search || '').trim().toLowerCase();
  const limit = Math.max(1, Math.min(200, Number(query.limit) || 100));
  const offset = Math.max(0, Number(query.offset) || 0);

  const base = [`1=1`];
  const params = [];
  if (provider) { base.push('LOWER(ep.provider)=?'); params.push(provider); }
  if (shop) { base.push('LOWER(ep.shop_domain)=?'); params.push(shop); }
  if (q) {
    base.push(`LOWER(COALESCE(ep.sku,'')||' '||ep.external_product_id||' '||ep.external_variant_id||' '||COALESCE(ep.raw_payload,'')||' '||COALESCE(s.name,'')) LIKE ?`);
    params.push(`%${q}%`);
  }
  const where = [...base];
  if (status === 'linked' || status === 'catalog_linked') where.push(IS_LINKED);
  else if (status === 'unlinked' || status === 'shadow_import') where.push(`NOT ${IS_LINKED}`);

  const join = `external_products ep LEFT JOIN skus s ON s.id=ep.internal_variant_id AND s.active=1`;
  const from = `FROM ${join} WHERE ${where.join(' AND ')}`;
  const rows = db.prepare(`SELECT ep.provider,ep.shop_domain,ep.external_product_id,ep.external_variant_id,
      ep.sku external_sku,ep.raw_payload,ep.internal_variant_id,
      s.id sku_id,s.name pos_name,s.code pos_code,s.barcode pos_barcode,s.price pos_price,s.stock pos_stock,s.image pos_image
    ${from} ORDER BY ep.updated_at DESC,ep.created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset).map(mapMappingRow);

  // Đếm cho các tab Tất cả / Đã liên kết / Chưa liên kết (giữ nguyên filter
  // provider/shop/tìm-kiếm, BỎ filter trạng thái).
  const counts = db.prepare(`SELECT COUNT(*) total,
      SUM(CASE WHEN ${IS_LINKED} THEN 1 ELSE 0 END) linked
    FROM ${join} WHERE ${base.join(' AND ')}`).get(...params);
  const all = Number(counts?.total || 0);
  const linked = Number(counts?.linked || 0);
  const total = status === 'linked' || status === 'catalog_linked' ? linked
    : status === 'unlinked' || status === 'shadow_import' ? all - linked
    : all;
  return { rows, total, limit, offset, counts: { all, linked, unlinked: all - linked } };
}

function findExternalRow(provider, shop, pid, vid) {
  return db.prepare(`SELECT * FROM external_products
    WHERE provider=? AND shop_domain=? AND external_product_id=? AND external_variant_id=?`)
    .get(provider, shop, pid, vid);
}

function normLinkArgs(a = {}) {
  return {
    prov: String(a.provider || '').trim().toLowerCase(),
    shop: String(a.shop_domain || a.shopDomain || '').trim().toLowerCase(),
    pid: String(a.external_product_id || a.externalProductId || '').trim(),
    vid: String(a.external_variant_id || a.externalVariantId || '').trim(),
  };
}

export function linkProduct(a = {}) {
  const branch_id = a.branch_id || a.branchId || 'sala';
  const actor = a.actor || 'system';
  const { prov, shop, pid, vid } = normLinkArgs(a);
  const target = String(a.sku_id || a.skuId || '').trim();
  const ep = findExternalRow(prov, shop, pid, vid);
  if (!ep) throw new Error('Không tìm thấy listing trên sàn cần liên kết.');
  const sku = db.prepare(`SELECT id FROM skus WHERE id=? AND branch_id=? AND active=1`).get(target, branch_id);
  if (!sku) throw new Error('Mặt hàng POS không tồn tại trong chi nhánh này.');
  const prev = String(ep.internal_variant_id || '');
  db.prepare(`UPDATE external_products SET internal_product_id=?,internal_variant_id=?,updated_at=?
    WHERE provider=? AND shop_domain=? AND external_product_id=? AND external_variant_id=?`)
    .run(target, target, now(), prov, shop, pid, vid);
  // Dọn shadow SKU cũ (hvn_) nếu không còn được dùng — tránh rác kho.
  if (prev && prev !== target && prev.startsWith('hvn_')) {
    const used = db.prepare(`SELECT 1 FROM order_items WHERE sku_id=? LIMIT 1`).get(prev);
    if (!used) db.prepare(`UPDATE skus SET active=0 WHERE id=?`).run(prev);
  }
  audit('online.product.link', { provider: prov, shop_domain: shop,
    external_product_id: pid, external_variant_id: vid, sku_id: target, previous: prev || null }, branch_id, actor);
  return { linked: true, provider: prov, shop_domain: shop, external_product_id: pid, external_variant_id: vid, sku_id: target };
}

export function unlinkProduct(a = {}) {
  const branch_id = a.branch_id || a.branchId || 'sala';
  const actor = a.actor || 'system';
  const { prov, shop, pid, vid } = normLinkArgs(a);
  const ep = findExternalRow(prov, shop, pid, vid);
  if (!ep) throw new Error('Không tìm thấy listing trên sàn.');
  db.prepare(`UPDATE external_products SET internal_product_id=NULL,internal_variant_id=NULL,updated_at=?
    WHERE provider=? AND shop_domain=? AND external_product_id=? AND external_variant_id=?`)
    .run(now(), prov, shop, pid, vid);
  audit('online.product.unlink', { provider: prov, shop_domain: shop,
    external_product_id: pid, external_variant_id: vid }, branch_id, actor);
  return { linked: false, provider: prov, shop_domain: shop, external_product_id: pid, external_variant_id: vid };
}

// "Sao chép": tự đối chiếu SKU rồi ID của listing sàn với mặt hàng trong kho.
// KHỚP → liên kết ngay. KHÔNG KHỚP → trả matched=false để UI cho chọn tay
// (KHÔNG tự tạo mặt hàng mới — theo quyết định của chủ hệ thống).
export function autoLinkProduct(a = {}) {
  const branch_id = a.branch_id || a.branchId || 'sala';
  const actor = a.actor || 'system';
  const { prov, shop, pid, vid } = normLinkArgs(a);
  const ep = findExternalRow(prov, shop, pid, vid);
  if (!ep) throw new Error('Không tìm thấy listing trên sàn.');
  const meta = externalListingMeta(parseJson(ep.raw_payload, {}));
  const extSku = String(ep.sku || meta.sku || '').trim();
  // CHỈ khớp mặt hàng kho THẬT — bỏ qua SKU bóng do connector tạo (nếu không sẽ
  // "liên kết" listing vào chính shadow của nó → vẫn hiện chưa liên kết).
  let sku = null;
  if (extSku) {
    sku = db.prepare(`SELECT id,name,code,barcode,price,stock FROM skus
      WHERE branch_id=? AND active=1 AND (code=? OR barcode=?) AND ${NOT_SHADOW_SKU_SQL} LIMIT 1`)
      .get(branch_id, extSku, extSku);
  }
  if (!sku && pid) {
    sku = db.prepare(`SELECT id,name,code,barcode,price,stock FROM skus
      WHERE branch_id=? AND active=1 AND id=? AND ${NOT_SHADOW_SKU_SQL} LIMIT 1`).get(branch_id, pid);
  }
  if (!sku) {
    return { matched: false, external_sku: extSku,
      reason: 'Không tìm thấy mặt hàng trong kho có SKU/ID khớp — hãy chọn tay để liên kết.' };
  }
  const res = linkProduct({ branch_id, provider: prov, shop_domain: shop,
    external_product_id: pid, external_variant_id: vid, sku_id: sku.id, actor });
  return { matched: true, ...res,
    pos: { sku_id: sku.id, name: sku.name, code: sku.code || '', price: Number(sku.price || 0), stock: Number(sku.stock || 0) } };
}

// Upsert MỘT listing sàn vào external_products — DÙNG CHUNG cho product-sync mọi
// connector (Shopee/Lazada/TikTok…). raw_payload lưu envelope chuẩn hoá
// {name,image,sku,raw} để list hiển thị nhanh. ON CONFLICT KHÔNG đụng
// internal_variant_id nên KHÔNG làm mất liên kết đã có khi đồng bộ lại.
export function upsertExternalProduct(a = {}) {
  const prov = String(a.provider || '').trim().toLowerCase();
  const shop = String(a.shop_domain || a.shopDomain || '').trim();
  const pid = String(a.external_product_id || a.externalProductId || '').trim();
  const vid = String(a.external_variant_id || a.externalVariantId || '').trim();
  if (!prov || !pid) return null;
  const sku = String(a.sku || '').trim();
  const payload = JSON.stringify({
    name: String(a.name || ''),
    image: String(a.image || ''),
    sku,
    raw: a.raw ?? null,
  });
  db.prepare(`INSERT INTO external_products
    (id,provider,shop_domain,external_product_id,external_variant_id,internal_product_id,internal_variant_id,sku,raw_payload,created_at,updated_at)
    VALUES (?,?,?,?,?,NULL,NULL,?,?,?,?)
    ON CONFLICT(provider, shop_domain, external_product_id, external_variant_id) DO UPDATE SET
      sku=excluded.sku,raw_payload=excluded.raw_payload,updated_at=excluded.updated_at`)
    .run(uid('ep_'), prov, shop, pid, vid, sku, payload, now(), now());
  return { provider: prov, shop_domain: shop, external_product_id: pid, external_variant_id: vid };
}
