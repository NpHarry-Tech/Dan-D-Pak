// Retail checkout & returns. Reuses the order + payment core so retail revenue
// flows into the same dashboard as FnB.
import { db, uid, now, audit } from '../db.js';
import { parseJson } from '../core/util.js';
import { emit } from '../realtime.js';
import { createOrUpdateOrder, getOrder, recomputeTotals } from './orders.js';
import { payOrder, paidForOrder, reverseOrderPayments, finalizeDeferredPaymentSideEffects } from './payments.js';
import { returnSku, applyChannelPrice } from './inventory.js';
import { buildDiscountPlan } from './vouchers.js';
import { getCustomer, recordPurchase } from './customers.js';
import { orderReceipt } from './history.js';

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
// XEM TRƯỚC giảm giá cho giỏ Retail POS — chạy ĐÚNG engine buildDiscountPlan để
// giỏ hiện được các CTKM TỰ ĐỘNG (combo, mua-X-tặng-1 mọi SKU) mà client không
// tự tính. Trả về tổng giảm + chi tiết từng dòng để giỏ hiển thị và thu đúng tiền.
export function previewDiscount({ items, voucher_id = null, customer = null, customer_id = null, manual_discount = 0, selected_combos = null } = {}, branch_id = 'sala') {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) {
    return { subtotal: 0, discount: 0, lineDiscount: 0, orderDiscount: 0, total: 0, appliedSkuPromos: [] };
  }
  const lines = normalizeCheckoutItems(list, branch_id);
  let cust = null;
  if (customer_id) cust = getCustomer(customer_id, branch_id);
  else if (customer?.id) cust = getCustomer(customer.id, branch_id) || customer;
  else if (customer && (customer.name || customer.tax_code)) cust = customer;
  const plan = buildDiscountPlan(lines, { voucher_id, customer: cust, manual_discount, branch_id, selected_combos });
  return {
    subtotal: plan.subtotal ?? lines.reduce((s, l) => s + l.qty * l.price, 0),
    discount: plan.discount || 0,
    lineDiscount: plan.lineDiscount || 0,
    orderDiscount: plan.orderDiscount || 0,
    total: plan.total ?? 0,
    appliedSkuPromos: plan.appliedSkuPromos || [],
  };
}

// §3 SERVER-AUTHORITATIVE PRICING dùng CHUNG cho canonical order command +
// checkout — KHÔNG tạo engine thứ hai. normalize (giá kênh + tồn) →
// buildDiscountPlan (CTKM sản phẩm → combo → voucher đơn → ưu đãi khách → giảm
// tay). Trả DÒNG đã định giá (client chỉ render) + tổng canonical.
export function priceCart({ items, voucher_id = null, customer = null, customer_id = null, manual_discount = 0, selected_combos = null } = {}, branch_id = 'sala') {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) {
    return { lines: [], subtotal: 0, discount: 0, lineDiscount: 0, orderDiscount: 0, total: 0, appliedSkuPromos: [] };
  }
  const norm = normalizeCheckoutItems(list, branch_id);
  let cust = null;
  if (customer_id) cust = getCustomer(customer_id, branch_id);
  else if (customer?.id) cust = getCustomer(customer.id, branch_id) || customer;
  else if (customer && (customer.name || customer.tax_code)) cust = customer;
  const plan = buildDiscountPlan(norm, { voucher_id, customer: cust, manual_discount, branch_id, selected_combos });
  const lines = norm.map((l, idx) => {
    const promo = (plan.appliedSkuPromos || []).find((p) => p.line_index === idx) || null;
    const lineTotal = Math.max(0, l.qty * l.price - (promo?.amount || 0));
    return {
      sku_id: l.sku_id, name: l.name, qty: l.qty, unit: l.unit,
      unit_price: l.price, orig_price: l.orig_price, vat_rate: l.vat_rate,
      lot_id: l.lot_id || null, price_override: l.price_override, promo, line_total: lineTotal,
    };
  });
  return {
    lines,
    subtotal: plan.subtotal ?? norm.reduce((s, l) => s + l.qty * l.price, 0),
    discount: plan.discount || 0,
    lineDiscount: plan.lineDiscount || 0,
    orderDiscount: plan.orderDiscount || 0,
    total: plan.total ?? 0,
    appliedSkuPromos: plan.appliedSkuPromos || [],
  };
}

// lines (cart): [{sku_id, qty, lot_id}]; payments: [{method, amount, reference}]
export function checkout({ items, payments, voucher_id = null, customer = null, customer_id = null, invoice_customer = null, note = '', manual_discount = 0, branch_id = 'sala', cashier = '', client_request_id = null, device_id = '', selected_combos = null, cart_slot = null, cart_version = null }) {
  if (!items?.length) throw new Error('Giỏ hàng trống');
  const requestId = String(client_request_id || '').trim();
  if (requestId.length > 128) throw new Error('client_request_id tối đa 128 ký tự');
  // Ô GIỎ CHIA SẺ đang thanh toán (nếu client gửi kèm). Dùng để CHỐNG THANH TOÁN
  // TRÙNG khi hai máy cùng mở một hóa đơn: máy nào chốt trước sẽ TIÊU THỤ giỏ
  // trong cùng transaction; máy thứ hai thấy giỏ mất/đổi phiên bản → 409, KHÔNG
  // tạo đơn thứ hai (tránh bán/trừ kho/thu tiền hai lần).
  const cartSlot = (cart_slot != null && Number.isInteger(Number(cart_slot))) ? Number(cart_slot) : null;
  const cartVersion = (cart_version != null) ? Number(cart_version) : null;

  db.prepare('BEGIN IMMEDIATE').run();
  try {
    if (requestId) {
      const existing = db.prepare(`SELECT id,status FROM orders WHERE branch_id=? AND client_request_id=?`).get(branch_id, requestId);
      if (existing) {
        if (existing.status === 'partially_paid') {
          const replay = payOrder(existing.id, Array.isArray(payments) ? payments : [], {
            skipTransaction: true,
            cashier,
            idempotency_key: requestId,
            device_id,
          }, branch_id);
          replay.idempotent_replay = true;
          db.prepare('COMMIT').run();
          finalizeDeferredPaymentSideEffects(replay, branch_id);
          return replay;
        }
        if (existing.status !== 'paid') throw Object.assign(new Error('Checkout trước với mã này chưa hoàn tất'), { status: 409 });
        const receipt = orderReceipt(existing.id, branch_id);
        receipt.idempotent_replay = true;
        db.prepare('COMMIT').run();
        return receipt;
      }
    }
    // CHỐNG THANH TOÁN TRÙNG (chỉ khi client gửi kèm slot+version giỏ chia sẻ):
    // giỏ chia sẻ luôn được đồng bộ lên server (có bản ghi + version) TRƯỚC khi
    // bấm thanh toán. Máy thứ nhất chốt xong sẽ xoá bản ghi này (ở cuối hàm),
    // nên máy thứ hai thấy: bản ghi MẤT hoặc version LỆCH → chặn tạo đơn thứ hai.
    if (cartSlot != null && cartVersion != null) {
      const cartRow = db.prepare(`SELECT version FROM retail_carts WHERE branch_id=? AND slot=?`).get(branch_id, cartSlot);
      if (!cartRow || Number(cartRow.version) !== cartVersion) {
        throw Object.assign(
          new Error('Giỏ này vừa được thanh toán hoặc thay đổi ở máy khác — không tạo hóa đơn trùng. Vui lòng kiểm tra lại.'),
          { status: 409, code: 'CART_ALREADY_CHECKED_OUT' });
      }
    }
    const lines = normalizeCheckoutItems(items, branch_id);

    // Resolve customer: saved (authoritative perk from DB) or ad-hoc walk-in object.
    let cust = null;
    if (customer_id) cust = getCustomer(customer_id, branch_id);
    else if (customer?.id) cust = getCustomer(customer.id, branch_id) || customer;
    else if (customer && (customer.name || customer.tax_code)) cust = customer;

    // Dùng CHUNG engine giảm giá với F&B (buildDiscountPlan trong vouchers.js) →
    // hai bên áp cùng thứ tự CTKM sản phẩm → voucher đơn → ưu đãi khách → giảm tay,
    // nên KHÔNG THỂ lệch nhau.
    const discountPlan = buildDiscountPlan(lines, {
      voucher_id,
      customer: cust,
      manual_discount,
      branch_id,
      selected_combos,
    });
    const orderItems = lines.map((line, idx) => {
      const promo = discountPlan.appliedSkuPromos.find(p => p.line_index === idx);
      return {
        sku_id: line.sku_id,
        qty: line.qty,
        lot_id: line.lot_id || null,
        // CHỈ truyền giá khi có chỉnh tay thật (null = để server tự áp bảng giá
        // kênh + chặn "SKU chưa có giá"). Truyền origPrice cho mọi dòng như trước
        // sẽ biến MỌI dòng thành "có override", bỏ qua bảng giá và lọt SKU 0đ.
        price: line.price_override,   // null nếu không chỉnh tay
        orig_price: line.orig_price,  // giá niêm yết gốc (cho bill in gốc→sau)
        note: line.note || null,      // ghi chú riêng dòng
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
    if (requestId) db.prepare(`UPDATE orders SET client_request_id=? WHERE id=?`).run(requestId, order.id);
    db.prepare(`UPDATE orders SET voucher_id=?, voucher_code=? WHERE id=?`)
      .run(discountPlan.orderVoucher?.id || null, discountPlan.orderVoucher?.code || null, order.id);
    const snap = snapshotCustomer(cust);
    const discountBreakdown = discountPlan.breakdown;
    const receipt = payOrder(order.id, Array.isArray(payments) ? payments : [], {
      discount: discountPlan.discount,
      cashier,
      customer: snap,
      invoice_customer,
      note,
      skipTransaction: true,
      discount_breakdown: discountBreakdown,
      voucher: discountPlan.orderVoucher,
      promotions: discountPlan.appliedSkuPromos,
      idempotency_key: requestId || null,
      // Máy đang thu tiền — payOrder chuyển tiếp cho printReceipt để bill ra ở
      // máy in của chính máy này.
      device_id,
    }, branch_id);
    if (receipt.fully_settled !== false && (cust?.id || cust?.phone)) {
      recordPurchase(cust, receipt.total, branch_id, order.id);
    }
    receipt.discount_breakdown = discountBreakdown;
    receipt.voucher = discountPlan.orderVoucher;
    receipt.promotions = discountPlan.appliedSkuPromos;
    if (!receipt.customer && snap) receipt.customer = snap;

    // TIÊU THỤ giỏ chia sẻ NGAY trong transaction: máy thứ hai (chạy sau vì
    // better-sqlite3 tuần tự) sẽ không còn thấy bản ghi → guard 409 ở trên chặn.
    if (cartSlot != null) {
      db.prepare(`DELETE FROM retail_carts WHERE branch_id=? AND slot=?`).run(branch_id, cartSlot);
      db.prepare(`DELETE FROM retail_cart_presence WHERE branch_id=? AND slot=?`).run(branch_id, cartSlot);
    }

    db.prepare('COMMIT').run();
    // Báo các máy khác đang xem ô này dọn giỏ (đơn đã chốt). Sau COMMIT để không
    // phát tín hiệu nếu transaction bị rollback.
    if (cartSlot != null) {
      try { emit('retail:cart', { slot: cartSlot, cleared: true, updated_at: now(), updated_by: cashier || 'system' }, branch_id); } catch { /* realtime lỗi không chặn thu tiền */ }
    }
    finalizeDeferredPaymentSideEffects(receipt, branch_id);
    return receipt;
  } catch (err) {
    db.prepare('ROLLBACK').run();
    throw err;
  }
}

// ===========================================================================
// Đơn NHÁP cho thanh toán chuyển khoản (SePay/Casso/payOS tự đối soát)
// TRƯỚC ĐÂY: đơn retail chỉ được tạo trên server lúc bấm "Xác nhận" cuối cùng
// → lúc thu ngân đang hiện QR cho khách quét, đơn CHƯA TỒN TẠI, nên webhook tìm
// "đơn đang mở" để khớp nội dung chuyển khoản sẽ KHÔNG THẤY GÌ (unmatched) — tiền
// về thật nhưng bill không tự đóng được. Hàm này tạo đơn 'open' THẬT ngay khi thu
// ngân chọn "Chuyển khoản", để webhook có đơn để khớp và tự đóng ngay khi tiền về
// (findOpenOrderByContent/processIncomingCredit trong payments.js đã có sẵn logic
// này — chỉ thiếu đơn để khớp). CHƯA trừ kho, CHƯA tính là doanh thu — chỉ trở
// thành thật khi payOrder() settle (qua webhook hoặc bấm Xác nhận).
export function createDraftOrder({ items, customer = null, customer_id = null, voucher_id = null, note = '', manual_discount = 0, branch_id = 'sala', cashier = '', client_request_id = null, device_id = '', selected_combos = null }) {
  const lines = normalizeCheckoutItems(items, branch_id);

  let cust = null;
  if (customer_id) cust = getCustomer(customer_id, branch_id);
  else if (customer?.id) cust = getCustomer(customer.id, branch_id) || customer;
  else if (customer && (customer.name || customer.tax_code)) cust = customer;

  const discountPlan = buildDiscountPlan(lines, { voucher_id, customer: cust, manual_discount, branch_id, selected_combos });
  const orderItems = lines.map((line, idx) => {
    const promo = discountPlan.appliedSkuPromos.find(p => p.line_index === idx);
    return {
      sku_id: line.sku_id,
      qty: line.qty,
      lot_id: line.lot_id || null,
      // #4e cho đường NHÁP (QR): mang theo chỉnh giá + orig + ghi chú để bill
      // QR cũng in đúng giá gốc→sau và ghi chú dòng, không mất khi settle.
      price: line.price_override,
      orig_price: line.orig_price,
      note: line.note || null,
      promo: promo ? {
        voucher_id: promo.voucher_id, code: promo.code, name: promo.name,
        amount: promo.amount, type: promo.type, value: promo.value,
        free_units: promo.free_units, free_product_name: promo.free_product_name,
        description: promo.description,
      } : null,
    };
  });

  const requestId = String(client_request_id || '').trim();
  if (requestId) {
    const existing = db.prepare(`SELECT id FROM orders WHERE branch_id=? AND client_request_id=? AND status IN ('open','partially_paid')`)
      .get(branch_id, requestId);
    if (existing) {
      const device = String(device_id || '').trim();
      if (device) db.prepare(`UPDATE orders SET linked_pos_device=? WHERE id=?`).run(device, existing.id);
      return getOrder(existing.id); // đã tạo nháp cho request này rồi — không tạo trùng.
    }
  }

  const order = createOrUpdateOrder({
    branch_id, table_id: null, channel: 'retail', items: orderItems,
    actor: cashier || 'system', linked_pos_device: String(device_id || '').trim(),
  });
  if (requestId) db.prepare(`UPDATE orders SET client_request_id=? WHERE id=?`).run(requestId, order.id);
  const snap = snapshotCustomer(cust);
  db.prepare(`UPDATE orders SET voucher_id=?, voucher_code=?, discount=?, customer_json=COALESCE(?,customer_json), note=? WHERE id=?`)
    .run(discountPlan.orderVoucher?.id || null, discountPlan.orderVoucher?.code || null, discountPlan.discount || 0,
      snap ? JSON.stringify(snap) : null, String(note || '').trim().slice(0, 500) || null, order.id);
  recomputeTotals(order.id);
  return getOrder(order.id);
}

// Dựng tạm tính hoàn toàn trong bộ nhớ: giá/tồn/CTKM đều do server xác thực,
// không tạo order và vì vậy không tiêu thụ số hóa đơn.
export function previewReceipt({ items, customer = null, customer_id = null, voucher_id = null, manual_discount = 0, branch_id = 'sala', cashier = '', note = '' }) {
  const lines = normalizeCheckoutItems(items, branch_id);
  const cust = customer_id ? getCustomer(customer_id, branch_id)
    : (customer?.id ? getCustomer(customer.id, branch_id) || customer : customer);
  const plan = buildDiscountPlan(lines, { voucher_id, customer: cust, manual_discount, branch_id });
  const receiptItems = lines.map((line, index) => ({
    name: line.name, unit: line.unit, qty: line.qty, unit_price: line.price, vat_rate: line.vat_rate,
    promo: plan.appliedSkuPromos.find(p => p.line_index === index) || null,
  }));
  const vat_amount = receiptItems.reduce((sum, item) => {
    const promo = Math.max(0, Number(item.promo?.amount) || 0);
    const gross = Math.max(0, item.qty * item.unit_price - promo);
    return sum + (item.vat_rate > 0 ? Math.round(gross - gross / (1 + item.vat_rate / 100)) : 0);
  }, 0);
  return {
    preview: true, bill_no: '', number: '', channel: 'retail', cashier,
    customer: snapshotCustomer(cust) || {}, items: receiptItems,
    subtotal: plan.subtotal, discount: plan.discount, total: plan.total,
    vat_amount, goods_amount: Math.max(0, plan.total - vat_amount), created_at: now(), lines: [],
    note: String(note || '').trim().slice(0, 500),
  };
}

// Hủy đơn nháp khi thu ngân đóng dialog/đổi phương thức mà chưa có tiền về —
// KHÔNG dùng cho đơn đã có thanh toán (dùng Retail.refund cho trường hợp đó).
export function voidDraftOrder(order_id, branch_id = 'sala') {
  const order = db.prepare(`SELECT * FROM orders WHERE id=? AND branch_id=?`).get(order_id, branch_id);
  if (!order || order.status === 'void') return { ok: true };
  if (!['open', 'partially_paid'].includes(order.status)) {
    throw new Error('Đơn đã đóng, không thể hủy nháp.');
  }
  if (paidForOrder(order_id) > 0) {
    throw new Error('Đơn đã có thanh toán — không thể hủy nháp, dùng chức năng Hoàn trả.');
  }
  db.prepare(`UPDATE orders SET status='void' WHERE id=?`).run(order_id);
  audit('retail.draft_voided', { order: order_id }, branch_id, 'system');
  emit('stats:dirty', {}, branch_id);
  return { ok: true };
}

// Dọn đơn nháp bị bỏ quên (mất mạng đúng lúc đóng dialog, app crash, tab bị đóng
// cứng…) — lưới an toàn cho voidDraftOrder() phía client; chỉ đụng đơn retail
// 'open' CHƯA có bất kỳ thanh toán nào và đã đủ cũ để chắc chắn không phải phiên
// đang thao tác thật.
export function maintainRetailDrafts({ minutes = 30 } = {}) {
  const cutoff = new Date(Date.now() - minutes * 60_000).toISOString();
  const rows = db.prepare(`SELECT id FROM orders WHERE channel='retail' AND status='open' AND created_at < ?`).all(cutoff);
  let voided = 0;
  for (const r of rows) {
    if (paidForOrder(r.id) > 0) continue;
    db.prepare(`UPDATE orders SET status='void' WHERE id=?`).run(r.id);
    voided++;
  }
  return voided;
}

export function listRetailSales(branch_id = 'sala', limit = 40) {
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

export function refund(order_id, reason, branch_id = 'sala', actor = 'system') {
  const order = getOrder(order_id);
  if (!order) throw new Error('Đơn không tồn tại');
  if (order.status === 'void') throw new Error('Đơn đã hoàn trước đó');
  db.prepare('BEGIN IMMEDIATE').run();
  try {
    reverseOrderPayments(order_id, reason, actor);
    // Retail goods are physically returned, so restore stock in the same tx.
    for (const it of order.items) {
      if (it.sku_id && it.status !== 'cancelled') returnSku(it.sku_id, it.qty, order_id, branch_id, { lot_id: it.lot_id });
    }
    db.prepare(`UPDATE orders SET status='void' WHERE id=?`).run(order_id);
    audit('retail.refund', {
      order: order_id, bill_no: order.bill_no, reason, total: order.total,
      deleted_from_history: true,
    }, branch_id, actor);
    db.prepare('COMMIT').run();
  } catch (error) {
    try { db.prepare('ROLLBACK').run(); } catch { /* already closed */ }
    throw error;
  }
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
    // Kiểm tra sớm để checkout trả lỗi rõ. Tầng kho kiểm tra lại atomically
    // trong transaction payment, nên hai máy không thể cùng bán phần tồn cuối.
    if (Number(sku.stock) + 0.000001 < qty) {
      throw new Error(`Hết hàng: ${sku.name} (còn ${Number(sku.stock) || 0})`);
    }
    // MÓN KHÔNG THEO LÔ (track_lot=false): BỎ QUA lô. Import ban đầu tạo các lô
    // "OPENING"/"NOLOT" rác cho cả món không quản lô; app tự chọn lô đó rồi
    // checkout kiểm lô → "Lot OPENING không đủ tồn" dù tồn SKU đủ (sự cố
    // 06/08/2026). Món quản lô THẬT (có HSD) mới giữ kiểm lô.
    let lot_id = sku.track_lot ? (raw.lot_id || null) : null;
    if (lot_id) {
      const lot = db.prepare(`SELECT * FROM stock_lots WHERE id=? AND branch_id=? AND item_type='sku' AND item_id=?`)
        .get(lot_id, branch_id, sku.id);
      if (!lot) throw new Error('Lot không tồn tại cho ' + sku.name);
      if (lot.qty_on_hand + 0.000001 < qty) throw new Error(`Lot ${lot.lot_no} của ${sku.name} không đủ tồn`);
    }
    // Giá server-authoritative: áp bảng giá kênh retail (nếu cấu hình). CHỈNH GIÁ
    // TỪNG DÒNG (price_override) chỉ được nhận sau khi checkout() đã xác thực PIN
    // Quản lý/Admin — client không tự quyết giá. orig_price giữ giá niêm yết để
    // bill in "giá gốc → giá sau đổi".
    const priced = applyChannelPrice(sku, branch_id, 'retail');
    const origPrice = priced.price;
    const override = (raw.price_override !== undefined && raw.price_override !== null && raw.price_override !== '')
      ? Math.max(0, Math.round(Number(raw.price_override) || 0))
      : null;
    out.push({
      sku_id: sku.id,
      qty,
      lot_id,
      voucher_id: raw.voucher_id || null,
      // `price` = giá HIỆU LỰC cho engine giảm giá (override nếu có, không thì
      // giá niêm yết). `price_override` = CHỈ giá chỉnh tay (null nếu không) —
      // createOrUpdateOrder dựa vào đây để biết có override thật hay không; nếu
      // không có nó tự áp bảng giá kênh + chặn "SKU chưa có giá".
      price: override != null ? override : origPrice,
      price_override: override,
      orig_price: origPrice,
      note: String(raw.note || '').trim().slice(0, 200) || null,
      vat_rate: Number(sku.vat) || 0,
      unit: sku.unit || 'cái',
      name: sku.name,
    });
  }
  return out;
}
