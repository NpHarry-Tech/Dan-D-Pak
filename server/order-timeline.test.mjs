// NHẬT KÝ GỌI MÓN (order/dish timeline) — dựng dòng thời gian một đơn từ dữ liệu
// đã có (order_items lifecycle + audit_log), khoá theo pay_ref. Không bảng mới.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-timeline-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = process.env.DATA_ENCRYPTION_KEY
  || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const { migrate, db } = await import('./db.js');
const Orders = await import('./services/orders.js');
const History = await import('./services/history.js');
const AppSettings = await import('./services/settings.js');
const Catalog = await import('./services/catalog.js');

migrate();
const BR = 'sala';
AppSettings.updateSettings({ operations_config: { shifts: { requireOpenShift: false } } }, BR);
const cat = Catalog.createCategory({ name: 'Test' }, BR);
db.prepare(`INSERT INTO menu_items (id,branch_id,category_id,name,price) VALUES (?,?,?,?,?)`)
  .run('mi_a', BR, cat.id, 'Phở', 50000);
db.prepare(`INSERT INTO menu_items (id,branch_id,category_id,name,price) VALUES (?,?,?,?,?)`)
  .run('mi_b', BR, cat.id, 'Trà', 20000);
Catalog.cacheBust('menu:');

test('header keyed to pay_ref + per-item KDS timings + merged event stream with actor', () => {
  const order = Orders.createOrUpdateOrder({
    branch_id: BR, channel: 'dine_in', actor: 'Huy', linked_pos_device: 'dev_pos_1',
    items: [{ menu_item_id: 'mi_a', qty: 2 }, { menu_item_id: 'mi_b', qty: 1 }],
  });
  const items = db.prepare(`SELECT id,menu_item_id FROM order_items WHERE order_id=? ORDER BY created_at`).all(order.id);
  const pho = items.find(i => i.menu_item_id === 'mi_a').id;
  const tra = items.find(i => i.menu_item_id === 'mi_b').id;

  // Tiến độ KDS cho phở (bếp nhận → xong → phục vụ), ghi chú, rồi huỷ trà.
  Orders.setItemStatus(pho, 'accepted', BR, 'Bep');
  Orders.setItemStatus(pho, 'ready', BR, 'Bep');
  Orders.setItemStatus(pho, 'served', BR, 'Huy');
  Orders.updateItemNote(pho, 'Ít hành', BR, 'Huy');
  Orders.cancelItem(tra, 'Khách đổi ý', BR, 'Huy');

  const t = History.orderTimeline(order.pay_ref, BR);
  // Khoá theo pay_ref dạng mới 12 chữ số, gắn đúng đơn.
  assert.match(t.pay_ref, /^\d{12}$/);
  assert.equal(t.order_id, order.id);
  assert.equal(t.cashier ?? null, t.cashier); // không ném; header có mặt

  const phoRow = t.items.find(i => i.id === pho);
  assert.equal(phoRow.status, 'served');
  assert.ok(phoRow.prep_seconds !== null && phoRow.prep_seconds >= 0, 'có thời gian làm món (bếp nhận→xong)');
  assert.ok(phoRow.serve_seconds !== null && phoRow.serve_seconds >= 0, 'có thời gian phục vụ (gọi→bưng ra)');
  const traRow = t.items.find(i => i.id === tra);
  assert.equal(traRow.status, 'cancelled');

  const types = t.events.map(e => e.event_type);
  assert.ok(types.includes('order.item.added'), 'có sự kiện thêm món');
  assert.ok(types.includes('order.item.status'), 'có sự kiện đổi trạng thái bếp');
  assert.ok(types.includes('order.item.note'), 'có sự kiện ghi chú');
  assert.ok(types.includes('order.item.cancel'), 'có sự kiện huỷ món');
  // Sự kiện gắn NGƯỜI thao tác (không phải "system").
  assert.ok(t.events.some(e => e.actor === 'Huy'), 'sự kiện có tên người thao tác');
  // Dòng thời gian tăng dần.
  const ats = t.events.map(e => e.at);
  assert.deepEqual(ats, [...ats].sort(), 'sự kiện sắp theo thời gian tăng dần');
});

test('cũng tra được bằng order_id và bill_no, không chỉ pay_ref', () => {
  const order = Orders.createOrUpdateOrder({
    branch_id: BR, channel: 'retail', actor: 'Huy',
    items: [{ menu_item_id: 'mi_a', qty: 1 }],
  });
  assert.equal(History.orderTimeline(order.id, BR).order_id, order.id);
  assert.equal(History.orderTimeline(order.pay_ref, BR).order_id, order.id);
});
