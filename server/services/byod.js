import crypto from 'node:crypto';
import { db, uid, now, audit } from '../db.js';
import { emitByodTable } from '../realtime.js';
import * as Catalog from './catalog.js';
import * as Orders from './orders.js';
import * as Payments from './payments.js';
import { getByodBannerConfig } from './settings/byodBanner.js';

const PUBLIC_ORIGIN = String(process.env.BYOD_PUBLIC_ORIGIN || 'https://dandpakpos.io.vn').replace(/\/$/, '');
const DEVICE_RE = /^[A-Za-z0-9_-]{20,128}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;
const ACTIVE_ORDER = new Set(['open', 'partially_paid']);

function fail(message, status = 400, code = 'BYOD_INVALID') {
  throw Object.assign(new Error(message), { status, code });
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function tokenForQrId(qrId) {
  const configured = process.env.BYOD_TOKEN_SECRET || process.env.SESSION_SECRET || process.env.JWT_SECRET;
  if (!configured && process.env.NODE_ENV === 'production') fail('Máy chủ chưa cấu hình BYOD_TOKEN_SECRET.', 503, 'BYOD_SECRET_MISSING');
  const secret = String(configured || 'dandpak-byod-development-secret-change-me');
  const opaque = Buffer.from(String(qrId), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(opaque).digest('base64url');
  return `${opaque}_${signature}`;
}

function cleanNote(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/<[^>]*>/g, '')
    .trim()
    .slice(0, 200) || null;
}

function cleanDeviceKey(value) {
  const key = String(value || '').trim();
  if (!DEVICE_RE.test(key)) fail('Thiết bị không hợp lệ.', 400, 'BYOD_DEVICE_INVALID');
  return key;
}

function publicUrl(rawToken) {
  return `${PUBLIC_ORIGIN}/BYOD/${rawToken}`;
}

function tableQr(tableId, branchId) {
  return db.prepare(`SELECT q.*,t.code table_code,t.zone,t.zone_id,t.status table_status,
      b.name branch_name,b.code branch_code,b.active branch_active
    FROM byod_qr_codes q JOIN tables t ON t.id=q.table_id
    JOIN branches b ON b.id=q.branch_id
    WHERE q.table_id=? AND q.branch_id=? AND q.enabled=1 AND q.revoked_at IS NULL
    ORDER BY q.generation DESC LIMIT 1`).get(tableId, branchId);
}

function qrView(row, rawToken = null) {
  const visibleToken = rawToken || (row.enabled && !row.revoked_at ? tokenForQrId(row.id) : null);
  return {
    id: row.id,
    enabled: !!row.enabled && !row.revoked_at,
    generation: row.generation,
    created_at: row.created_at,
    last_used_at: row.last_used_at,
    revoked_at: row.revoked_at,
    table: { code: row.table_code, zone: row.zone, zone_id: row.zone_id },
    branch: { name: row.branch_name, code: row.branch_code },
    ...(visibleToken ? { token: visibleToken, url: publicUrl(visibleToken) } : {}),
  };
}

export function ensureTableQr(tableId, branchId = 'sala', actor = 'system') {
  const existing = tableQr(tableId, branchId);
  if (existing) return qrView(existing);
  const table = db.prepare(`SELECT t.*,b.name branch_name,b.code branch_code,b.active branch_active
    FROM tables t JOIN branches b ON b.id=t.branch_id WHERE t.id=? AND t.branch_id=?`).get(tableId, branchId);
  if (!table) fail('Bàn không tồn tại.', 404, 'BYOD_TABLE_NOT_FOUND');
  const id = uid('byodqr_');
  const rawToken = tokenForQrId(id);
  const generation = (db.prepare(`SELECT COALESCE(MAX(generation),0)+1 n FROM byod_qr_codes WHERE table_id=?`).get(tableId).n || 1);
  db.prepare(`INSERT INTO byod_qr_codes(id,branch_id,table_id,token_hash,enabled,created_at,generation)
    VALUES(?,?,?,?,1,?,?)`).run(id, branchId, tableId, hash(rawToken), now(), generation);
  audit('byod.qr.create', { id, table_id: tableId, generation }, branchId, actor);
  return qrView({ ...table, id, branch_id: branchId, table_id: tableId, enabled: 1,
    table_code: table.code, generation, created_at: now(), last_used_at: null, revoked_at: null }, rawToken);
}

// Clear-text QR credentials are deliberately returned only once (create/regenerate).
// Existing records expose status; regeneration is required when the printed value is lost.
export function getTableQr(tableId, branchId = 'sala') {
  return tableQr(tableId, branchId) ? qrView(tableQr(tableId, branchId)) : ensureTableQr(tableId, branchId);
}

export function regenerateTableQr(tableId, branchId = 'sala', actor = 'system') {
  revokeTableQr(tableId, branchId, actor, { silentMissing: true });
  const created = ensureTableQr(tableId, branchId, actor);
  audit('byod.qr.regenerate', { table_id: tableId, generation: created.generation }, branchId, actor);
  return created;
}

export function setTableQrEnabled(tableId, enabled, branchId = 'sala', actor = 'system') {
  if (enabled) {
    const active = tableQr(tableId, branchId);
    return active ? qrView(active) : ensureTableQr(tableId, branchId, actor);
  }
  const current = tableQr(tableId, branchId);
  revokeTableQr(tableId, branchId, actor);
  return current ? qrView({ ...current, enabled: 0, revoked_at: now() }) : { enabled: false };
}

export function revokeTableQr(tableId, branchId = 'sala', actor = 'system', { silentMissing = false } = {}) {
  const rows = db.prepare(`SELECT id FROM byod_qr_codes WHERE table_id=? AND branch_id=? AND enabled=1 AND revoked_at IS NULL`).all(tableId, branchId);
  if (!rows.length && !silentMissing) return { enabled: false };
  const at = now();
  db.prepare(`UPDATE byod_qr_codes SET enabled=0,revoked_at=? WHERE table_id=? AND branch_id=? AND enabled=1`).run(at, tableId, branchId);
  db.prepare(`UPDATE byod_sessions SET status='revoked',closed_at=? WHERE table_id=? AND branch_id=? AND status='active'`).run(at, tableId, branchId);
  audit('byod.qr.revoke', { table_id: tableId, qr_ids: rows.map(r => r.id) }, branchId, actor);
  emitByodTable(tableId, 'byod:closed', { reason: 'qr_revoked' });
  return { enabled: false };
}

export function revokeForDeletedTable(tableId, branchId = 'sala', actor = 'system') {
  return revokeTableQr(tableId, branchId, actor, { silentMissing: true });
}

export function resolveQr(rawToken, { touch = true } = {}) {
  const candidate = String(rawToken || '').trim();
  if (!TOKEN_RE.test(candidate)) fail('QR không hợp lệ hoặc đã bị thu hồi.', 404, 'BYOD_QR_INVALID');
  const row = db.prepare(`SELECT q.*,t.code table_code,t.zone,t.zone_id,t.status table_status,
      b.name branch_name,b.code branch_code,b.active branch_active
    FROM byod_qr_codes q JOIN tables t ON t.id=q.table_id
    JOIN branches b ON b.id=q.branch_id WHERE q.token_hash=?`).get(hash(candidate));
  if (!row || !row.enabled || row.revoked_at) fail('QR không hợp lệ hoặc đã bị thu hồi.', 410, 'BYOD_QR_REVOKED');
  if (!row.branch_active) fail('Chi nhánh hiện không hoạt động.', 423, 'BYOD_BRANCH_INACTIVE');
  if (touch) db.prepare(`UPDATE byod_qr_codes SET last_used_at=? WHERE id=?`).run(now(), row.id);
  return row;
}

function sessionFor(qr) {
  let session = db.prepare(`SELECT * FROM byod_sessions WHERE qr_id=? AND table_id=? AND status='active' ORDER BY created_at DESC LIMIT 1`).get(qr.id, qr.table_id);
  if (!session) {
    const id = uid('byods_');
    const at = now();
    db.prepare(`INSERT INTO byod_sessions(id,qr_id,branch_id,table_id,status,created_at,last_active_at) VALUES(?,?,?,?,'active',?,?)`)
      .run(id, qr.id, qr.branch_id, qr.table_id, at, at);
    session = db.prepare(`SELECT * FROM byod_sessions WHERE id=?`).get(id);
  }
  return session;
}

function friendlyName(hint, count) {
  const v = String(hint || '').toLowerCase();
  if (v.includes('iphone') || v.includes('ipad')) return 'iPhone';
  if (v.includes('android')) return 'Android';
  return count === 0 ? 'Thiết bị của tôi' : `Khách ${count + 1}`;
}

function deviceFor(session, deviceKey, hint = '') {
  const deviceHash = hash(cleanDeviceKey(deviceKey));
  let device = db.prepare(`SELECT * FROM byod_devices WHERE session_id=? AND device_key_hash=?`).get(session.id, deviceHash);
  const at = now();
  if (!device) {
    const count = db.prepare(`SELECT COUNT(*) n FROM byod_devices WHERE session_id=?`).get(session.id).n;
    const id = uid('byodd_');
    db.prepare(`INSERT INTO byod_devices(id,session_id,device_key_hash,friendly_name,created_at,last_active_at) VALUES(?,?,?,?,?,?)`)
      .run(id, session.id, deviceHash, friendlyName(hint, count), at, at);
    device = db.prepare(`SELECT * FROM byod_devices WHERE id=?`).get(id);
  } else {
    db.prepare(`UPDATE byod_devices SET last_active_at=? WHERE id=?`).run(at, device.id);
  }
  db.prepare(`UPDATE byod_sessions SET last_active_at=? WHERE id=?`).run(at, session.id);
  return device;
}

function context(rawToken, deviceKey, hint = '') {
  const qr = resolveQr(rawToken);
  const cleanKey = cleanDeviceKey(deviceKey);
  const recentPaid = db.prepare(`SELECT s.*,d.id device_id,d.friendly_name,d.device_key_hash,d.created_at device_created_at,d.last_active_at device_last_active_at
    FROM byod_sessions s JOIN byod_devices d ON d.session_id=s.id
    WHERE s.qr_id=? AND s.table_id=? AND s.status='paid' AND d.device_key_hash=?
      AND s.closed_at>=datetime('now','-10 minutes') ORDER BY s.closed_at DESC LIMIT 1`)
    .get(qr.id, qr.table_id, hash(cleanKey));
  if (recentPaid) {
    return { qr, session: recentPaid, device: { id: recentPaid.device_id,
      session_id: recentPaid.id, friendly_name: recentPaid.friendly_name,
      device_key_hash: recentPaid.device_key_hash, created_at: recentPaid.device_created_at,
      last_active_at: recentPaid.device_last_active_at } };
  }
  const session = sessionFor(qr);
  const device = deviceFor(session, cleanKey, hint);
  return { qr, session, device };
}

function requireActiveSession(ctx) {
  if (ctx.session.status !== 'active') fail('Phiên gọi món của bàn đã kết thúc.', 410, 'BYOD_SESSION_CLOSED');
}

function menu(branchId, lang = 'vi') {
  const result = Catalog.listMenu({ forCustomer: true, selfOrder: true, branch_id: branchId, lang });
  return Array.isArray(result) ? result : (result.items || []);
}

// Catalog.listMenu() đã tính sẵn danh sách category hiển thị cho khách (lọc
// self_order_hidden) nhưng menu() ở trên chỉ giữ lại `items` — khách BYOD chưa
// bao giờ nhận được TÊN category thật, chỉ có category_id trên từng món. Hàm
// này chỉ trả về id+name (không icon/sort/nội bộ) để frontend dựng chip danh mục.
function menuCategories(branchId, lang = 'vi') {
  const result = Catalog.listMenu({ forCustomer: true, selfOrder: true, branch_id: branchId, lang });
  const categories = Array.isArray(result) ? [] : (result.categories || []);
  return categories.map(c => ({ id: c.id, name: c.name }));
}

function safeMenu(branchId, lang = 'vi') {
  // CHỈ loại tuỳ chọn combo/addon trỏ tới món đã ẨN KHỎI TOÀN HỆ THỐNG hoặc đã
  // xoá — self_order_hidden nghĩa là "không cho đặt RIÊNG LẺ trên self-order",
  // KHÔNG có nghĩa "không được chọn làm thành phần combo của món khác". Các món
  // đặt tên "(CB) ..." được đánh self_order_hidden CHÍNH LÀ để làm việc này —
  // gộp self_order_hidden vào forbidden xoá sạch mọi option combo trỏ tới
  // chúng, tiêu đề nhóm vẫn hiện nhưng danh sách chọn rỗng hoàn toàn.
  const forbidden = new Set(db.prepare(`SELECT id FROM menu_items WHERE branch_id=?
    AND (hidden=1 OR deleted_at IS NOT NULL)`).all(branchId).map(row => row.id));
  return menu(branchId, lang).map(item => {
    const optionGroups = (item.option_groups || []).map(group => ({
      ...group,
      options: (group.options || []).filter(option => !option.ref_item_id || !forbidden.has(option.ref_item_id)),
    }));
    const unavailableRequiredCombo = optionGroups.some(group => group.mode === 'combo'
      && Number(group.min || 0) > group.options.length);
    return ({
    id: item.id, category_id: item.category_id, category: item.category,
    name: item.name, description: item.description, image: item.image, emoji: item.emoji,
    price: item.sale_price ?? item.price, available: !!item.available, can_order: !!item.can_order,
    availability_reason: unavailableRequiredCombo ? 'combo_unavailable' : item.availability_reason,
    modifiers: item.modifiers || [], option_groups: optionGroups,
    addons: (item.addons || []).filter(addon => !addon.ref_item_id || !forbidden.has(addon.ref_item_id)),
    sla_minutes: item.sla_minutes, translations: item.translations || {},
    can_order: !!item.can_order && !unavailableRequiredCombo,
  }); });
}

function serializeCart(ctx, lang = 'vi') {
  const items = db.prepare(`SELECT c.*,d.friendly_name FROM byod_cart_items c JOIN byod_devices d ON d.id=c.device_id WHERE c.session_id=? ORDER BY c.created_at,c.id`).all(ctx.session.id);
  const menuById = new Map(safeMenu(ctx.qr.branch_id, lang).map(i => [i.id, i]));
  const rows = items.map(row => {
    const item = menuById.get(row.menu_item_id);
    const mods = JSON.parse(row.mods_json || '[]');
    const combo = JSON.parse(row.combo_json || '[]');
    const allowedMods = new Map((item?.modifiers || []).map(m => [`${m.group}\u0000${m.name}`, Number(m.sale_price ?? m.price) || 0]));
    const extras = mods.reduce((sum, m) => sum + (allowedMods.get(`${m.group}\u0000${m.name}`) || 0), 0);
    const comboPrices = new Map((item?.option_groups || []).filter(g => g.mode === 'combo')
      .flatMap(g => g.options || []).map(o => [o.ref_item_id, Number(o.sale_price ?? o.price) || 0]));
    const comboExtra = combo.reduce((sum, choice) => sum + (comboPrices.get(choice.ref_item_id) || 0), 0);
    const unitPrice = (Number(item?.price) || 0) + extras + comboExtra;
    return { id: row.id, device_id: row.device_id, device_name: row.friendly_name,
      mine: row.device_id === ctx.device.id, menu_item_id: row.menu_item_id,
      name: item?.name || 'Món không còn phục vụ', image: item?.image || null,
      qty: row.qty, note: row.note, mods, combo, available: !!item?.can_order,
      unit_price: unitPrice, amount: unitPrice * row.qty };
  });
  const my = rows.filter(r => r.mine);
  return { mine: my, table: rows, my_total: my.reduce((s, r) => s + r.amount, 0), table_total: rows.reduce((s, r) => s + r.amount, 0) };
}

function publicOrders(ctx) {
  const order = db.prepare(`SELECT id,status,total,goods_amount,vat_amount,created_at,paid_at FROM orders
    WHERE table_id=? AND branch_id=? AND (created_at>=? OR status IN ('open','partially_paid'))
    ORDER BY created_at DESC LIMIT 1`).get(ctx.qr.table_id, ctx.qr.branch_id, ctx.session.created_at);
  if (!order) return [];
  const items = db.prepare(`SELECT id,menu_item_id,name,qty,unit_price,note,mods_json status_json,status,created_at,accepted_at,ready_at,served_at,reject_reason,parent_item_id
    FROM order_items WHERE order_id=? ORDER BY created_at,id`).all(order.id).map(i => ({ ...i, mods: JSON.parse(i.status_json || '[]'), status_json: undefined }));
  return [{ ...order, items }];
}

export function bootstrap(rawToken, deviceKey, hint = '', lang = 'vi') {
  const ctx = context(rawToken, deviceKey, hint);
  return {
    session_id: ctx.session.id, device: { id: ctx.device.id, name: ctx.device.friendly_name },
    branch: { name: ctx.qr.branch_name },
    table: { code: ctx.qr.table_code, zone: ctx.qr.zone, status: ctx.qr.table_status },
    categories: menuCategories(ctx.qr.branch_id, lang),
    menu: safeMenu(ctx.qr.branch_id, lang), cart: serializeCart(ctx, lang), orders: publicOrders(ctx),
    payment_request: paymentRequest(ctx), banner: getByodBannerConfig(ctx.qr.branch_id), server_time: now(),
  };
}

function assertOwnCart(ctx, itemId) {
  const row = db.prepare(`SELECT * FROM byod_cart_items WHERE id=? AND session_id=?`).get(itemId, ctx.session.id);
  if (!row) fail('Món nháp không tồn tại.', 404, 'BYOD_CART_NOT_FOUND');
  if (row.device_id !== ctx.device.id) fail('Không thể sửa giỏ của thiết bị khác.', 403, 'BYOD_CART_FOREIGN');
  return row;
}

export function addCartItem(rawToken, deviceKey, body = {}, hint = '') {
  const ctx = context(rawToken, deviceKey, hint);
  requireActiveSession(ctx);
  const item = safeMenu(ctx.qr.branch_id).find(i => i.id === String(body.menu_item_id || ''));
  if (!item || !item.can_order) fail('Món vừa hết hoặc hiện không phục vụ.', 409, 'BYOD_ITEM_UNAVAILABLE');
  const qty = Math.max(1, Math.min(50, Number.parseInt(body.qty, 10) || 1));
  const mods = Array.isArray(body.mods) ? body.mods.slice(0, 40).map(m => ({ group: String(m?.group || '').slice(0, 100), name: String(m?.name || '').slice(0, 100) })) : [];
  const allowed = new Set((item.modifiers || []).map(m => `${m.group}\u0000${m.name}`));
  if (mods.some(m => !allowed.has(`${m.group}\u0000${m.name}`))) {
    fail('Tùy chọn không còn hợp lệ trong thực đơn.', 409, 'BYOD_OPTION_INVALID');
  }
  for (const group of item.option_groups || []) {
    if (group.mode === 'combo') continue;
    const count = mods.filter(m => m.group === group.name).length;
    const min = Math.max(0, Number(group.min) || 0);
    const max = Math.max(0, Number(group.max) || 0);
    if (count < min || (max && count > max)) fail(`Nhóm "${group.name}" chưa chọn đúng số lượng.`, 409, 'BYOD_OPTION_COUNT');
  }
  const combo = Array.isArray(body.combo) ? body.combo.slice(0, 40).map(c => ({ ref_item_id: String(c?.ref_item_id || '').slice(0, 100), note: cleanNote(c?.note) })) : [];
  const comboGroups = (item.option_groups || []).filter(group => group.mode === 'combo');
  const allowedCombo = new Set(comboGroups.flatMap(group => (group.options || []).map(option => option.ref_item_id).filter(Boolean)));
  if (combo.some(choice => !allowedCombo.has(choice.ref_item_id))) {
    fail('Món thành phần combo không còn hợp lệ.', 409, 'BYOD_COMBO_INVALID');
  }
  for (const group of comboGroups) {
    const refs = new Set((group.options || []).map(option => option.ref_item_id));
    const count = combo.filter(choice => refs.has(choice.ref_item_id)).length;
    const min = Math.max(0, Number(group.min) || 0);
    const max = Math.max(0, Number(group.max) || 0);
    if (count < min || (max && count > max)) fail(`Nhóm "${group.name}" chưa chọn đúng số lượng.`, 409, 'BYOD_COMBO_COUNT');
  }
  const id = uid('byodci_');
  const at = now();
  db.prepare(`INSERT INTO byod_cart_items(id,session_id,device_id,menu_item_id,qty,note,mods_json,combo_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`)
    .run(id, ctx.session.id, ctx.device.id, item.id, qty, cleanNote(body.note), JSON.stringify(mods), JSON.stringify(combo), at, at);
  emitByodTable(ctx.qr.table_id, 'byod:cart', { session_id: ctx.session.id });
  return serializeCart(ctx);
}

export function updateCartItem(rawToken, deviceKey, itemId, body = {}, hint = '') {
  const ctx = context(rawToken, deviceKey, hint);
  requireActiveSession(ctx);
  const row = assertOwnCart(ctx, itemId);
  const qty = Math.max(1, Math.min(50, Number.parseInt(body.qty, 10) || row.qty));
  db.prepare(`UPDATE byod_cart_items SET qty=?,note=?,updated_at=? WHERE id=?`).run(qty, body.note === undefined ? row.note : cleanNote(body.note), now(), row.id);
  emitByodTable(ctx.qr.table_id, 'byod:cart', { session_id: ctx.session.id });
  return serializeCart(ctx);
}

export function removeCartItem(rawToken, deviceKey, itemId, hint = '') {
  const ctx = context(rawToken, deviceKey, hint);
  requireActiveSession(ctx);
  const row = assertOwnCart(ctx, itemId);
  db.prepare(`DELETE FROM byod_cart_items WHERE id=?`).run(row.id);
  emitByodTable(ctx.qr.table_id, 'byod:cart', { session_id: ctx.session.id });
  return serializeCart(ctx);
}

export function submitCart(rawToken, deviceKey, idempotencyKey, { scope = 'mine', confirm_table_cart = false } = {}, hint = '') {
  const key = String(idempotencyKey || '').trim().slice(0, 200);
  if (key.length < 16) fail('Thiếu mã chống gửi trùng.', 400, 'BYOD_IDEMPOTENCY_REQUIRED');
  const ctx = context(rawToken, deviceKey, hint);
  requireActiveSession(ctx);
  const old = db.prepare(`SELECT * FROM byod_submissions WHERE session_id=? AND idempotency_key=?`).get(ctx.session.id, key);
  if (old) {
    if (!old.order_id) fail('Yêu cầu trước đang được xử lý.', 409, 'BYOD_SUBMIT_RUNNING');
    return { duplicate: true, order: publicOrders(ctx)[0] || null };
  }
  if (scope === 'table' && confirm_table_cart !== true) {
    fail('Cần xác nhận rõ trước khi gửi giỏ chung của bàn.', 400, 'BYOD_TABLE_CONFIRM_REQUIRED');
  }
  const rows = scope === 'table'
    ? db.prepare(`SELECT * FROM byod_cart_items WHERE session_id=? ORDER BY created_at,id`).all(ctx.session.id)
    : db.prepare(`SELECT * FROM byod_cart_items WHERE session_id=? AND device_id=? ORDER BY created_at,id`).all(ctx.session.id, ctx.device.id);
  if (!rows.length) fail('Giỏ hàng đang trống.', 409, 'BYOD_CART_EMPTY');
  const lines = rows.map(r => ({ menu_item_id: r.menu_item_id, qty: r.qty, note: cleanNote(r.note), mods: JSON.parse(r.mods_json || '[]'), combo: JSON.parse(r.combo_json || '[]') }));
  const submissionId = uid('byodsub_');
  db.prepare(`INSERT INTO byod_submissions(id,session_id,device_id,idempotency_key,order_id,item_ids_json,created_at) VALUES(?,?,?,?,?,'[]',?)`)
    .run(submissionId, ctx.session.id, ctx.device.id, key, '', now());
  let order;
  try {
    order = Orders.createOrUpdateOrder({ branch_id: ctx.qr.branch_id, table_id: ctx.qr.table_id,
      channel: 'dine_in', source: 'self_order', actor: ctx.device.friendly_name, items: lines });
  } catch (error) {
    db.prepare(`DELETE FROM byod_submissions WHERE id=? AND order_id=''`).run(submissionId);
    throw error;
  }
  const submittedIds = new Set(order.items?.map(i => i.id) || []);
  db.prepare(`UPDATE byod_submissions SET order_id=?,item_ids_json=? WHERE id=?`)
    .run(order.id, JSON.stringify([...submittedIds]), submissionId);
  const skipped = new Set((order.skipped_items || []).map(s => Number(s.index)));
  const del = db.prepare(`DELETE FROM byod_cart_items WHERE id=?`);
  rows.forEach((row, index) => { if (!skipped.has(index)) del.run(row.id); });
  emitByodTable(ctx.qr.table_id, 'byod:submitted', { order_id: order.id, session_id: ctx.session.id });
  return { duplicate: false, order: publicOrders(ctx)[0] || null, skipped_items: order.skipped_items || [] };
}

function paymentRequest(ctx) {
  const row = db.prepare(`SELECT * FROM byod_payment_requests WHERE session_id=? ORDER BY created_at DESC LIMIT 1`).get(ctx.session.id);
  const order = db.prepare(`SELECT status,paid_at FROM orders WHERE table_id=? AND branch_id=? ORDER BY created_at DESC LIMIT 1`).get(ctx.qr.table_id, ctx.qr.branch_id);
  if (order?.status === 'paid' || order?.paid_at) return { status: 'paid' };
  return row ? { status: row.status, created_at: row.created_at, acknowledged_at: row.acknowledged_at } : { status: 'none' };
}

export function requestPayment(rawToken, deviceKey, hint = '') {
  const ctx = context(rawToken, deviceKey, hint);
  requireActiveSession(ctx);
  const recent = db.prepare(`SELECT * FROM byod_payment_requests WHERE session_id=? AND status IN ('requested','acknowledged') ORDER BY created_at DESC LIMIT 1`).get(ctx.session.id);
  if (recent) return paymentRequest(ctx);
  const order = db.prepare(`SELECT id,status FROM orders WHERE table_id=? AND branch_id=? AND status IN ('open','partially_paid') ORDER BY created_at DESC LIMIT 1`).get(ctx.qr.table_id, ctx.qr.branch_id);
  if (!order || !ACTIVE_ORDER.has(order.status)) fail('Bàn chưa có món để thanh toán.', 409, 'BYOD_NO_OPEN_ORDER');
  db.prepare(`INSERT INTO byod_payment_requests(id,session_id,order_id,status,created_at) VALUES(?,?,?,'requested',?)`)
    .run(uid('byodpay_'), ctx.session.id, order.id, now());
  Payments.requestPayment(ctx.qr.table_id, ctx.qr.branch_id);
  audit('byod.payment.request', { table_id: ctx.qr.table_id, order_id: order.id }, ctx.qr.branch_id, ctx.device.friendly_name);
  emitByodTable(ctx.qr.table_id, 'byod:payment', { status: 'requested' });
  return paymentRequest(ctx);
}

const STAFF_CALL_COOLDOWN_SQL = `datetime('now','-90 seconds')`;

// Dùng ĐÚNG cơ chế "gọi nhân viên" hiện có của Tablet Self Order
// (Orders.createStaffCall → bảng staff_calls → sự kiện 'staff:call' + 'table:updated'
// → RingController/socket_service.dart trên F&B POS), không tạo kênh thông báo riêng
// cho BYOD. Khác biệt duy nhất: table_id/branch_id lấy từ token đã ký (như mọi route
// BYOD khác), không tin trực tiếp body như route /api/calls gốc — khách cầm QR không
// có cách nào tự khai table_id của bàn khác.
export function callStaff(rawToken, deviceKey, hint = '') {
  const ctx = context(rawToken, deviceKey, hint);
  requireActiveSession(ctx);
  const recent = db.prepare(`SELECT id FROM staff_calls WHERE table_id=? AND branch_id=? AND status='open' AND created_at>=${STAFF_CALL_COOLDOWN_SQL}`)
    .get(ctx.qr.table_id, ctx.qr.branch_id);
  if (recent) return { ok: true, already: true };
  Orders.createStaffCall(ctx.qr.table_id, 'Gọi nhân viên từ điện thoại khách', ctx.qr.branch_id);
  audit('byod.staff_call', { table_id: ctx.qr.table_id }, ctx.qr.branch_id, ctx.device.friendly_name);
  return { ok: true, already: false };
}

export function closeTableSessions(tableId, branchId = 'sala', reason = 'table_closed') {
  const at = now();
  if (reason === 'paid') {
    db.prepare(`UPDATE byod_payment_requests SET status='paid',completed_at=? WHERE session_id IN
      (SELECT id FROM byod_sessions WHERE table_id=? AND branch_id=? AND status='active')`).run(at, tableId, branchId);
  }
  const changed = db.prepare(`UPDATE byod_sessions SET status=?,closed_at=? WHERE table_id=? AND branch_id=? AND status='active'`).run(reason, at, tableId, branchId).changes;
  if (changed) emitByodTable(tableId, 'byod:closed', { reason });
  return changed;
}
