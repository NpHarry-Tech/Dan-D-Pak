// Retail checkout & returns. Reuses the order + payment core so retail revenue
// flows into the same dashboard as FnB.
import { db, uid, now, audit } from '../db.js';
import { emit } from '../realtime.js';
import { createOrUpdateOrder, getOrder } from './orders.js';
import { payOrder } from './payments.js';
import { returnSku } from './inventory.js';
import { calculateRetailDiscount } from './vouchers.js';
import { getCustomer, perkDiscount, recordPurchase } from './customers.js';

function snapshotCustomer(c) {
  if (!c) return null;
  return {
    id: c.id || null, name: c.name || '', phone: c.phone || '', email: c.email || '',
    tax_code: c.tax_code || '', company: c.company || '', address: c.address || '',
    address_detail: c.address_detail || '', address_ward: c.address_ward || '',
    address_province: c.address_province || '', ward_code: c.ward_code || '',
    province_code: c.province_code || '',
    birthday: c.birthday || '', preferences: c.preferences || '', allergies: c.allergies || '',
    perk_type: c.perk_type || 'none', perk_value: c.perk_value || 0,
  };
}

// lines (cart): [{sku_id, qty, lot_id}]; payments: [{method, amount, reference}]
export function checkout({ items, payments, voucher_id = null, customer = null, customer_id = null, invoice_customer = null, manual_discount = 0, branch_id = 'br1', cashier = '' }) {
  if (!items?.length) throw new Error('Giỏ hàng trống');

  db.prepare('BEGIN IMMEDIATE').run();
  try {
    const lines = normalizeCheckoutItems(items, branch_id);

    // Resolve customer: saved (authoritative perk from DB) or ad-hoc walk-in object.
    let cust = null;
    if (customer_id) cust = getCustomer(customer_id, branch_id);
    else if (customer?.id) cust = getCustomer(customer.id, branch_id) || customer;
    else if (customer && (customer.name || customer.tax_code)) cust = customer;

    // First pass (promos + order voucher) to know the base the perk/manual applies on.
    const pre = calculateRetailDiscount(lines, voucher_id, branch_id, { customer: cust });
    const baseForExtra = Math.max(0, pre.subtotal - pre.lineDiscount - pre.orderDiscount);
    const customerPerk = cust ? perkDiscount(cust, baseForExtra) : 0;
    const manual = Math.max(0, Math.round(Number(manual_discount) || 0));
    const extraDiscount = customerPerk + manual;

    const discountPlan = calculateRetailDiscount(lines, voucher_id, branch_id, { customer: cust, extraDiscount });
    const orderItems = lines.map((line, idx) => {
      const promo = discountPlan.appliedSkuPromos.find(p => p.line_index === idx);
      return {
        sku_id: line.sku_id,
        qty: line.qty,
        lot_id: line.lot_id || null,
        promo: promo ? {
          voucher_id: promo.voucher_id,
          code: promo.code,
          name: promo.name,
          amount: promo.amount,
          type: promo.type,
          value: promo.value,
          free_units: promo.free_units,
          free_product_name: promo.free_product_name,
          description: promo.description,
        } : null,
      };
    });
    const order = createOrUpdateOrder({ branch_id, table_id: null, channel: 'retail', items: orderItems, actor: cashier || 'system', skipTransaction: true });
    db.prepare(`UPDATE orders SET voucher_id=?, voucher_code=? WHERE id=?`)
      .run(discountPlan.orderVoucher?.id || null, discountPlan.orderVoucher?.code || null, order.id);
    const snap = snapshotCustomer(cust);
    const discountBreakdown = {
      product_promos: discountPlan.lineDiscount,
      voucher: discountPlan.orderDiscount,
      customer_perk: customerPerk,
      manual,
    };
    const receipt = payOrder(order.id, Array.isArray(payments) ? payments : [], {
      discount: discountPlan.discount,
      cashier,
      customer: snap,
      invoice_customer,
      skipTransaction: true,
      discount_breakdown: discountBreakdown,
      voucher: discountPlan.orderVoucher,
      promotions: discountPlan.appliedSkuPromos,
    }, branch_id);
    if (cust?.id || cust?.phone) recordPurchase(cust, receipt.total, branch_id, order.id);
    receipt.discount_breakdown = discountBreakdown;
    receipt.voucher = discountPlan.orderVoucher;
    receipt.promotions = discountPlan.appliedSkuPromos;
    if (!receipt.customer && snap) receipt.customer = snap;

    db.prepare('COMMIT').run();
    return receipt;
  } catch (err) {
    db.prepare('ROLLBACK').run();
    throw err;
  }
}

export function listRetailSales(branch_id = 'br1', limit = 40) {
  const rows = db.prepare(`SELECT * FROM orders WHERE branch_id=? AND channel='retail' AND status='paid' ORDER BY paid_at DESC LIMIT ?`)
    .all(branch_id, limit);
  return rows.map(o => ({ ...o, number: o.bill_no || o.id.slice(-6).toUpperCase(),
    items: db.prepare(`
      SELECT oi.name, oi.qty, oi.unit_price, oi.sku_id, oi.lot_id, oi.promo_json, l.lot_no, l.expiry_date
      FROM order_items oi
      LEFT JOIN stock_lots l ON l.id=oi.lot_id
      WHERE oi.order_id=? AND oi.status!='cancelled'`).all(o.id)
      .map(i => ({ ...i, promo: parseJson(i.promo_json, null) })) }));
}

export function refund(order_id, reason, branch_id = 'br1') {
  const order = getOrder(order_id);
  if (!order) throw new Error('Đơn không tồn tại');
  if (order.status === 'void') throw new Error('Đơn đã hoàn trước đó');
  // Restock returned SKUs and reverse.
  for (const it of order.items) {
    if (it.sku_id && it.status !== 'cancelled') returnSku(it.sku_id, it.qty, order_id, branch_id, { lot_id: it.lot_id });
  }
  db.prepare(`UPDATE orders SET status='void' WHERE id=?`).run(order_id);
  audit('retail.refund', { order: order_id, reason, total: order.total }, branch_id);
  emit('stats:dirty', {}, branch_id);
  emit('inventory:updated', {}, branch_id);
  return { ok: true, refunded: order.total };
}

function normalizeCheckoutItems(items, branch_id) {
  const out = [];
  for (const raw of items || []) {
    const qty = Math.max(1, parseInt(raw.qty) || 1);
    const sku = db.prepare(`SELECT * FROM skus WHERE id=? AND branch_id=? AND active=1`).get(raw.sku_id, branch_id);
    if (!sku) throw new Error('SKU không tồn tại: ' + raw.sku_id);
    if (sku.stock + 0.000001 < qty) throw new Error(`Hết hàng: ${sku.name} (còn ${sku.stock})`);
    const lot_id = raw.lot_id || null;
    if (lot_id) {
      const lot = db.prepare(`SELECT * FROM stock_lots WHERE id=? AND branch_id=? AND item_type='sku' AND item_id=?`)
        .get(lot_id, branch_id, sku.id);
      if (!lot) throw new Error('Lot không tồn tại cho ' + sku.name);
      if (lot.qty_on_hand + 0.000001 < qty) throw new Error(`Lot ${lot.lot_no} của ${sku.name} không đủ tồn`);
    }
    out.push({
      sku_id: sku.id,
      qty,
      lot_id,
      voucher_id: raw.voucher_id || null,
      price: sku.price,
      name: sku.name,
    });
  }
  return out;
}

function parseJson(raw, fallback) {
  try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
}
