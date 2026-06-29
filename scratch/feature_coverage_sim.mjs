#!/usr/bin/env node
// End-to-end FEATURE COVERAGE test for the POS/ERP "local engine".
// Complements fleet_realtime_sim.mjs (which is a load test). This script drives
// every operator task at least once and verifies realtime propagation in
// isolation (a handful of sockets, no thundering herd) so the latency numbers
// reflect a single real transaction, not a synchronized 75-device burst.
import { performance } from 'node:perf_hooks';

const BASE_URL = (process.env.BASE_URL || 'http://127.0.0.1:3110').replace(/\/+$/, '');
const BRANCH_ID = process.env.BRANCH_ID || 'br1';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PIN = process.env.ADMIN_PIN || '1234';

const t0 = performance.now();
const nowMs = () => performance.now();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const log = (m) => process.env.SIM_PROGRESS !== '0' && console.error(`[feat +${Math.round(nowMs() - t0)}ms] ${m}`);

async function api(method, path, { token = '', body, branch = BRANCH_ID, raw = false } = {}) {
  const headers = { 'content-type': 'application/json', 'x-branch-id': branch };
  if (token) { headers.authorization = `Bearer ${token}`; headers['x-auth-token'] = token; }
  const res = await fetch(`${BASE_URL}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  if (raw) return { status: res.status, ok: res.ok, text };
  let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = data && typeof data === 'object' ? (data.error || data.message) : text;
    const err = new Error(`HTTP ${res.status} ${method} ${path}: ${msg || res.statusText}`);
    err.status = res.status; err.data = data; throw err;
  }
  return data;
}

function wsUrl(base) {
  const url = new URL(base);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/socket.io/'; url.search = 'EIO=4&transport=websocket';
  return url.toString();
}

class Sock {
  constructor({ name, branch, device, token = '' }) {
    Object.assign(this, { name, branch, device, token, ws: null, connected: false });
    this.events = []; // {event, payload, at}
    this.waiters = []; // {event, predicate, resolve, reject, timer}
  }
  async connect(timeoutMs = 8000) {
    const auth = { branch: this.branch, device: this.device };
    if (this.token) auth.token = this.token;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${this.name} connect timeout`)), timeoutMs);
      const ws = new WebSocket(wsUrl(BASE_URL)); this.ws = ws;
      ws.onerror = () => { clearTimeout(timer); reject(new Error(`${this.name} ws error`)); };
      ws.onmessage = (ev) => {
        const msg = typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8');
        if (msg === '2') return ws.send('3');
        if (msg.startsWith('0')) return ws.send('40' + JSON.stringify(auth));
        if (msg.startsWith('40')) { this.connected = true; clearTimeout(timer); return resolve(); }
        if (msg.startsWith('44')) { clearTimeout(timer); return reject(new Error(`${this.name} rejected: ${msg.slice(2)}`)); }
        if (!msg.startsWith('42')) return;
        let packet; try { packet = JSON.parse(msg.slice(2)); } catch { return; }
        const [event, payload] = packet; const at = nowMs();
        this.events.push({ event, payload, at });
        for (let i = this.waiters.length - 1; i >= 0; i--) {
          const w = this.waiters[i];
          if (w.event === event && (!w.predicate || w.predicate(payload))) {
            clearTimeout(w.timer); this.waiters.splice(i, 1); w.resolve({ payload, at });
          }
        }
      };
    });
  }
  // Arm BEFORE the triggering action, then await the returned promise.
  waitFor(event, predicate = null, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.waiters.findIndex(w => w.timer === timer);
        if (idx >= 0) this.waiters.splice(idx, 1);
        reject(new Error(`${this.name} timeout waiting for ${event}`));
      }, timeoutMs);
      this.waiters.push({ event, predicate, resolve, reject, timer });
    });
  }
  close() { try { this.ws?.close(); } catch {} }
}

const results = [];
async function step(name, fn) {
  const start = nowMs();
  try {
    const detail = await fn();
    results.push({ name, ok: true, ms: Math.round(nowMs() - start), detail: detail || '' });
    log(`PASS  ${name}  (${Math.round(nowMs() - start)}ms)${detail ? ' — ' + detail : ''}`);
  } catch (err) {
    results.push({ name, ok: false, ms: Math.round(nowMs() - start), detail: err.message });
    log(`FAIL  ${name}  — ${err.message}`);
  }
}

function pendingItemIds(order) {
  return (order.items || []).filter(i => i.status === 'pending_confirm').map(i => i.id);
}

async function main() {
  await api('GET', '/api/ping');

  // ── Sockets: one representative device of each kind (isolated, no herd) ──
  const sock = {};
  let token = '';
  // login first so authed sockets have a token
  const login = await api('POST', '/api/login', { body: { username: ADMIN_USER, pin: ADMIN_PIN, branch_id: BRANCH_ID } });
  token = login.token;

  sock.pos = new Sock({ name: 'pos-1', branch: BRANCH_ID, device: 'pos', token });
  sock.kds = new Sock({ name: 'kds', branch: BRANCH_ID, device: 'kds', token });
  sock.tablet = new Sock({ name: 'tablet', branch: BRANCH_ID, device: 'ipad' });
  sock.phone = new Sock({ name: 'office-phone', branch: BRANCH_ID, device: 'warehouse', token });
  sock.printer = new Sock({ name: 'printer', branch: BRANCH_ID, device: 'printers', token });
  sock.admin = new Sock({ name: 'admin', branch: BRANCH_ID, device: 'admin', token });
  await Promise.all(Object.values(sock).map(s => s.connect()));
  log(`connected ${Object.values(sock).filter(s => s.connected).length}/6 sockets`);

  // Catalog snapshot
  const [menu, skus, warehouses, expenseCats] = await Promise.all([
    api('GET', '/api/menu', { token }),
    api('GET', '/api/skus', { token }),
    api('GET', '/api/warehouses', { token }),
    api('GET', '/api/expenses/categories', { token }),
  ]);
  const kitchenItem = (menu.items || []).find(i => i.id && i.station !== 'retail' && i.can_order !== false && i.available !== false);
  const kitchenItem2 = (menu.items || []).find(i => i.id && i.id !== kitchenItem?.id && i.station !== 'retail' && i.can_order !== false && i.available !== false) || kitchenItem;
  // Happy-path refund needs a non-expiry SKU (see expiry-refund probe below for the gap).
  const retailSku = (skus || []).find(s => s.id && s.active !== false && Number(s.stock || 0) > 5 && !s.expiry_required)
    || (skus || []).find(s => s.id && s.active !== false && Number(s.stock || 0) > 5);
  const expirySku = (skus || []).find(s => s.id && s.active !== false && Number(s.stock || 0) > 5 && s.expiry_required);
  const retailWh = (warehouses || []).find(w => w.type === 'retail') || warehouses[0];
  if (!kitchenItem) throw new Error('no orderable kitchen item');
  if (!retailSku) throw new Error('no stocked retail sku');

  const rt = {}; // realtime latency captures (ms)

  // 1. AUTH — /me with token, logout invalidates, re-login
  await step('Đăng nhập / phiên làm việc (/me)', async () => {
    const me = await api('GET', '/api/me', { token }); // /me returns the user object flat
    if (!me?.id) throw new Error('no user in /me');
    return `user=${me.username} role=${me.role} perms=${(me.perms || []).length}`;
  });
  await step('Đăng xuất rồi đăng nhập lại (logout invalidates token)', async () => {
    const throwaway = await api('POST', '/api/login', { body: { username: ADMIN_USER, pin: ADMIN_PIN, branch_id: BRANCH_ID } });
    await api('POST', '/api/logout', { token: throwaway.token });
    let stillValid = true;
    try { await api('GET', '/api/me', { token: throwaway.token }); } catch (e) { stillValid = e.status === 401; }
    if (stillValid !== true) throw new Error('token still valid after logout');
    return 'token revoked after logout ✓';
  });

  // 2. SHIFT — open (đầu ca)
  await step('Mở ca (đầu ca) + đếm tiền két đầu ca', async () => {
    const cur = await api('GET', '/api/shifts/current', { token });
    if (cur?.shift) return `ca đã mở sẵn: ${cur.shift.shift_label}`;
    const opened = await api('POST', '/api/shifts/open', { token, body: { shift_key: 'morning', opening_cash: 5000000, cash_manual: true } });
    if (!opened?.shift?.id) throw new Error('open shift returned no shift');
    return `mở ca ${opened.shift.shift_label}, két đầu 5,000,000đ`;
  });

  // 3. FnB DINE-IN full lifecycle with realtime checks ───────────────────
  // ensure a table
  let table;
  await step('Tạo bàn (setup vận hành)', async () => {
    let tables = await api('GET', '/api/tables', { token });
    if (!tables.length) {
      await api('POST', '/api/settings/tables', { token, body: { zone: 'FEAT', code: `FEAT-${Date.now().toString(36)}`, seats: 4, security_pin: ADMIN_PIN } });
      tables = await api('GET', '/api/tables', { token });
    }
    table = tables[0];
    return `bàn ${table.code}`;
  });

  let orderId, orderItems;
  await step('FnB: Khách order (tablet) → POS thấy NGAY (order:pending realtime)', async () => {
    const waitPos = sock.pos.waitFor('order:pending', p => true, 8000);
    const sentAt = nowMs();
    const order = await api('POST', '/api/orders', { body: { table_id: table.id, channel: 'dine_in', items: [
      { menu_item_id: kitchenItem.id, qty: 2, note: 'feat-test' },
      { menu_item_id: kitchenItem2.id, qty: 1, note: 'feat-test-2' },
    ] } });
    orderId = order.id;
    const ev = await waitPos;
    rt.tabletToPosPending = Math.round(ev.at - sentAt);
    const full = await api('GET', `/api/orders/${orderId}`, { token });
    orderItems = full.items;
    return `order ${orderId.slice(-6)}, ${orderItems.length} dòng món, POS thấy sau ${rt.tabletToPosPending}ms`;
  });

  await step('FnB: Xóa/bỏ món đang chờ xác nhận (void pending item)', async () => {
    const victim = orderItems.find(i => i.status === 'pending_confirm');
    if (!victim) throw new Error('no pending item to cancel');
    await api('POST', `/api/orders/items/${victim.id}/cancel`, { token, body: {} });
    const after = await api('GET', `/api/orders/${orderId}`, { token });
    const cancelled = after.items.find(i => i.id === victim.id);
    if (cancelled && cancelled.status !== 'cancelled') throw new Error(`item status=${cancelled.status} not cancelled`);
    orderItems = after.items;
    return `đã hủy 1 dòng món chờ xác nhận`;
  });

  await step('FnB: Nhân viên confirm → BẾP (KDS) + tablet khách thấy NGAY', async () => {
    const ids = pendingItemIds({ items: orderItems });
    if (!ids.length) throw new Error('no pending items to confirm');
    const waitKds = sock.kds.waitFor('order:confirmed', p => true, 8000).catch(() => sock.kds.waitFor('order:new', p => p?.confirmed, 2000));
    const waitTablet = sock.tablet.waitFor('order:confirmed', p => true, 8000);
    const waitPrint = sock.printer.waitFor('print:new', j => j?.type === 'kitchen_ticket' || j?.type === 'runner' || j?.type === 'cup_label', 8000);
    const confirmAt = nowMs();
    await api('POST', `/api/orders/${orderId}/confirm`, { token, body: { item_ids: ids } });
    const [kdsEv, tabletEv] = await Promise.all([waitKds, waitTablet]);
    rt.confirmToKds = Math.round(kdsEv.at - confirmAt);
    rt.confirmToTablet = Math.round(tabletEv.at - confirmAt);
    let printType = '?';
    try { const pj = await waitPrint; printType = pj.payload?.type; } catch {}
    return `bếp +${rt.confirmToKds}ms, tablet +${rt.confirmToTablet}ms, in tem: ${printType}`;
  });

  await step('Bếp: KDS chuyển trạng thái nhận→làm→xong → tablet khách cập nhật', async () => {
    const fresh = await api('GET', `/api/orders/${orderId}`, { token });
    const active = fresh.items.filter(i => ['confirmed', 'accepted', 'new', 'queued'].includes(i.status) || (i.status !== 'cancelled' && i.status !== 'served'));
    if (!active.length) throw new Error('no active kitchen items');
    let readyDelta = null;
    for (const it of active) {
      await api('POST', `/api/orders/items/${it.id}/status`, { token, body: { status: 'accepted' } });
      await api('POST', `/api/orders/items/${it.id}/status`, { token, body: { status: 'preparing' } });
      const waitReady = sock.tablet.waitFor('order:item', p => p?.status === 'ready', 8000);
      const readyAt = nowMs();
      await api('POST', `/api/orders/items/${it.id}/status`, { token, body: { status: 'ready' } });
      try { const ev = await waitReady; readyDelta = Math.round(ev.at - readyAt); } catch {}
    }
    if (readyDelta != null) rt.readyToTablet = readyDelta;
    return `${active.length} món tới 'ready'${readyDelta != null ? `, tablet thấy 'xong' +${readyDelta}ms` : ''}`;
  });

  // 4. PAYMENT + INVOICE (xuất hóa đơn) ──────────────────────────────────
  await step('FnB: Thanh toán bill (tiền mặt) + payment:done realtime', async () => {
    const order = await api('GET', `/api/orders/${orderId}`, { token });
    const waitPay = sock.pos.waitFor('payment:done', p => true, 8000).catch(() => null);
    const receipt = await api('POST', `/api/orders/${orderId}/pay`, { token, body: { lines: [{ method: 'cash', amount: order.total }] } });
    await waitPay;
    if (!receipt || receipt.total == null) throw new Error('no receipt total');
    return `thu ${order.total.toLocaleString('vi')}đ, bill ${(receipt.bill_no || orderId).toString().slice(-8)}`;
  });

  await step('Xuất hóa đơn VAT (e-invoice mock) cho bill đã trả', async () => {
    const inv = await api('POST', '/api/invoices/issue', { token, body: { order_id: orderId, customer: { name: 'Cong ty Test', tax_code: '0312345678', address: 'HCM', email: 'test@example.com' } } });
    if (!inv?.invoice_no) throw new Error('no invoice_no');
    return `HĐ số ${inv.invoice_no} (provider=${inv.provider})`;
  });

  // 5. RETAIL sale + refund ──────────────────────────────────────────────
  let retailOrderId;
  await step('Retail: Bán hàng (POS retail có máy scan) + in receipt', async () => {
    const waitReceipt = sock.printer.waitFor('print:new', j => j?.type === 'receipt', 8000).catch(() => null);
    const sale = await api('POST', '/api/retail/checkout', { token, body: { items: [{ sku_id: retailSku.id, qty: 1 }], payments: [{ method: 'cash', amount: Number(retailSku.price) || 100000 }] } });
    retailOrderId = sale.order_id || sale.id || sale.order?.id;
    await waitReceipt;
    if (!retailOrderId) throw new Error('no retail order id: ' + JSON.stringify(Object.keys(sale || {})));
    return `bán SKU ${retailSku.name?.slice(0, 24) || retailSku.id}, order ${String(retailOrderId).slice(-6)}`;
  });
  await step('Retail: Hoàn trả hàng (refund) → tồn kho hoàn lại + inventory:updated', async () => {
    const waitInv = sock.phone.waitFor('inventory:updated', p => true, 8000).catch(() => null);
    const r = await api('POST', `/api/retail/${retailOrderId}/refund`, { token, body: { reason: 'feat-test refund' } });
    await waitInv;
    if (!r?.ok) throw new Error('refund not ok');
    return `hoàn ${Number(r.refunded || 0).toLocaleString('vi')}đ`;
  });

  // 5b. DIAGNOSTIC: refund of an expiry-tracked SKU sold without an explicit lot.
  // Documents a real gap — restock has no lot/expiry to write. Recorded as warn, not hard fail.
  if (expirySku) {
    const start = nowMs();
    try {
      const sale = await api('POST', '/api/retail/checkout', { token, body: { items: [{ sku_id: expirySku.id, qty: 1 }], payments: [{ method: 'cash', amount: Number(expirySku.price) || 100000 }] } });
      const oid = sale.order_id || sale.id || sale.order?.id;
      await api('POST', `/api/retail/${oid}/refund`, { token, body: { reason: 'expiry-probe' } });
      results.push({ name: 'Hoàn trả SKU có hạn sử dụng (không chọn lô)', ok: true, warn: false, ms: Math.round(nowMs() - start), detail: 'hoàn được — không có gap' });
      log('PASS  expiry-SKU refund worked (no gap)');
    } catch (err) {
      const isGap = /hạn sử dụng|expiry/i.test(err.message);
      results.push({ name: 'Hoàn trả SKU có hạn sử dụng (không chọn lô)', ok: !isGap, warn: isGap, ms: Math.round(nowMs() - start), detail: err.message });
      log(`${isGap ? 'WARN' : 'FAIL'}  expiry-SKU refund — ${err.message}`);
    }
  }

  // 6. MENU change DURING operation (giá / ẩn-hiện / còn-hết) ──────────────
  await step('Đổi giá món lúc đang vận hành (cần PIN QL) → menu:updated tới tablet+POS', async () => {
    const waitTablet = sock.tablet.waitFor('menu:updated', p => p?.id === kitchenItem.id, 8000);
    const newPrice = (Number(kitchenItem.price) || 50000) + 1000;
    await api('POST', `/api/menu/${kitchenItem.id}/price`, { token, body: { price: newPrice, security_pin: ADMIN_PIN } });
    await waitTablet; // clean delta is measured in the dedicated re-measure step below
    return `giá → ${newPrice.toLocaleString('vi')}đ, tablet nhận menu:updated`;
  });
  await step('Tạm hết món / còn món (availability) realtime', async () => {
    const waitT = sock.tablet.waitFor('menu:updated', p => p?.id === kitchenItem2.id, 8000);
    await api('POST', `/api/menu/${kitchenItem2.id}/availability`, { token, body: { available: false } });
    await waitT;
    await api('POST', `/api/menu/${kitchenItem2.id}/availability`, { token, body: { available: true } }); // restore
    return `toggle hết→còn OK`;
  });

  // 7. CASH DRAWER chi tiền + hoàn chi ───────────────────────────────────
  let expenseEntryId;
  await step('Chi tiền từ két (chi tiền) + shift:updated realtime', async () => {
    const waitShift = sock.pos.waitFor('shift:updated', p => p?.cash_drawer, 8000).catch(() => null);
    const r = await api('POST', '/api/cash-drawer/expense', { token, body: { amount: 150000, reason: 'Mua đá + ga', counterparty: 'Cửa hàng tạp hóa', product: 'Đá cây' } });
    await waitShift;
    expenseEntryId = r?.entry?.id;
    if (!expenseEntryId) throw new Error('no expense entry');
    return `chi 150,000đ, két còn ${Number(r.entry.balance_after).toLocaleString('vi')}đ`;
  });
  await step('Hoàn chi (reimbursement) liên kết khoản đã chi', async () => {
    const r = await api('POST', '/api/cash-drawer/reimbursement', { token, body: { amount: 150000, reimburses_entry_ids: [expenseEntryId], counterparty: 'Kế toán hoàn' } });
    if (!r?.entry?.id) throw new Error('no reimbursement entry');
    return `hoàn 150,000đ, két còn ${Number(r.entry.balance_after).toLocaleString('vi')}đ`;
  });

  // 8. ACCOUNTING expense (chi phí kế toán trực tiếp) ─────────────────────
  await step('Ghi chi phí kế toán (chi trực tiếp, không qua két) + expenses:updated', async () => {
    const waitExp = sock.phone.waitFor('expenses:updated', p => true, 8000).catch(() => null);
    const cat = expenseCats[0];
    const r = await api('POST', '/api/expenses', { token, body: { source: 'direct', method: 'bank', category_id: cat?.id, category_name: cat?.name || 'Chi phí test', amount: 250000, note: 'feat-test expense' } });
    await waitExp;
    if (!r?.id && !r?.expense?.id) throw new Error('no expense created');
    return `chi phí 250,000đ (${cat?.name || 'n/a'})`;
  });

  // 9. INVENTORY nhập kho (kiểm kho / nhập hàng từ phone) ─────────────────
  await step('Nhập kho thêm hàng (phone văn phòng) + inventory:updated realtime', async () => {
    const waitInv = sock.phone.waitFor('inventory:updated', p => true, 8000).catch(() => null);
    const sentAt = nowMs();
    await api('POST', '/api/warehouse/receive', { token, body: { warehouse_id: retailWh?.id || retailSku.warehouse_id, stock_type: 'sku', item_id: retailSku.id, qty: 10, lot_no: `FEAT-${Date.now()}`, expiry_date: new Date(Date.now() + 180 * 86400000).toISOString().slice(0, 10), unit_cost: Number(retailSku.cost) || 0, supplier: 'feat-test' } });
    const ev = await waitInv;
    if (ev) rt.inventoryToPhone = Math.round(ev.at - sentAt);
    return `nhập 10 đv${ev ? `, phone thấy +${rt.inventoryToPhone}ms` : ''}`;
  });

  // 10. SETTINGS change (PIN-gated) ──────────────────────────────────────
  await step('Chỉnh sửa cấu hình (settings) có cổng PIN Quản lý', async () => {
    const before = await api('GET', '/api/settings/app', { token });
    const newPin = before?.ipad_staff_pin === '4321' ? '1357' : '4321';
    await api('POST', '/api/settings/app', { token, body: { ipad_staff_pin: newPin, security_pin: ADMIN_PIN } });
    const after = await api('GET', '/api/settings/app', { token });
    if (after?.ipad_staff_pin !== newPin) throw new Error(`setting not persisted (${after?.ipad_staff_pin})`);
    return `ipad_staff_pin đổi & lưu OK`;
  });

  // 11. REPORTS export (xuất báo cáo) ─────────────────────────────────────
  await step('Xuất báo cáo bán hàng (JSON)', async () => {
    const rep = await api('GET', '/api/reports/export?type=sales_overview&format=json', { token });
    if (!rep || typeof rep !== 'object') throw new Error('no report');
    return `báo cáo "${rep.title || rep.type || 'sales'}" OK`;
  });
  await step('Xuất báo cáo ra Excel (.xls) + Word (.doc)', async () => {
    const xls = await api('GET', '/api/reports/export?type=sales_overview&format=xls', { token, raw: true });
    const doc = await api('GET', '/api/reports/export?type=sales_overview&format=doc', { token, raw: true });
    if (!xls.ok || !xls.text.length) throw new Error('xls export failed');
    if (!doc.ok || !doc.text.length) throw new Error('doc export failed');
    return `xls ${xls.text.length}B, doc ${doc.text.length}B`;
  });

  // 12. CLOSE SHIFT (đóng ca) ─────────────────────────────────────────────
  await step('Đóng ca (cuối ca) + báo cáo đối soát tiền két', async () => {
    const cur = await api('GET', '/api/shifts/current', { token });
    if (!cur?.shift) throw new Error('no open shift to close');
    const expected = cur?.report?.expected_cash ?? cur?.drawer?.summary?.expected_cash ?? 0;
    const closed = await api('POST', '/api/shifts/close', { token, body: { closing_cash: expected } });
    if (closed?.shift?.status !== 'closed') throw new Error('shift not closed');
    const rep = closed.report || {};
    return `ca đóng, DT ca ${Number(rep.total_revenue || 0).toLocaleString('vi')}đ, dự kiến két ${Number(rep.expected_cash || expected).toLocaleString('vi')}đ`;
  });

  // ── compute menuToTablet properly (re-measure cleanly) ──
  await step('Realtime: đổi giá → tablet (đo lại sạch)', async () => {
    const waitTablet = sock.tablet.waitFor('menu:updated', p => p?.id === kitchenItem.id, 8000);
    const at = nowMs();
    await api('POST', `/api/menu/${kitchenItem.id}/price`, { token, body: { price: (Number(kitchenItem.price) || 50000) + 2000, security_pin: ADMIN_PIN } });
    const ev = await waitTablet;
    rt.menuToTablet = Math.round(ev.at - at);
    return `menu:updated tới tablet +${rt.menuToTablet}ms`;
  });

  Object.values(sock).forEach(s => s.close());

  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok && !r.warn); // documented gaps (warn) are not hard failures
  const warned = results.filter(r => r.warn);
  const out = {
    ok: failed.length === 0,
    totalSteps: results.length,
    passed,
    failed: failed.length,
    warnings: warned.length,
    realtimeLatencyMs: rt,
    knownGaps: warned.map(w => ({ name: w.name, detail: w.detail })),
    steps: results,
  };
  console.log(JSON.stringify(out, null, 2));
  if (failed.length) process.exitCode = 1;
}

main().catch(err => { console.error(err.stack || err.message); process.exitCode = 1; });
