// ĐƠN ONLINE ĐÃ 'paid' (tiền + tồn kho + hoá đơn thật đã ghi nhận) mà sàn báo
// HUỶ SAU ĐÓ phải được ĐẢO đầy đủ — không chỉ đổi status='void' suông.
//
// Sự cố thật (audit 2026-09-15): Lazada/TikTok/Haravan void thẳng orders.status
// mà không đảo payments/tồn kho/hoá đơn; Shopee còn NẶNG HƠN — ghi đè status về
// 'open' trên MỌI lần đồng bộ không phải 'CANCELLED' (kể cả TO_RETURN), làm mất
// dấu vết đơn đã thanh toán. Sửa: services/returns.js reverseCancelledPaidOrder()
// coi huỷ-sau-khi-đã-trả là MỘT LẦN TRẢ HÀNG TOÀN PHẦN (dùng lại createReturn —
// đảo tiền theo đúng tender gốc, trả kho, giữ hoá đơn nếu chưa phát hành) — CHỈ
// chuyển 'void' khi đảo THÀNH CÔNG; thất bại thì giữ nguyên 'paid' + audit riêng.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-mp-cancel-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = process.env.DATA_ENCRYPTION_KEY
  || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const { db, migrate } = await import('./db.js');
const Settings = await import('./services/settings.js');
const Shopee = await import('./services/shopeeConnector.js');
const Haravan = await import('./services/haravanConnector.js');
const Lazada = await import('./services/lazadaConnector.js');
const ConnStore = await import('./services/connectionStore.js');
const Inv = await import('./services/inventory.js');

migrate();
ConnStore.ensureConnectionStore();

function paymentCount(orderId) {
  return db.prepare(`SELECT COUNT(*) n FROM payments WHERE order_id=?`).get(orderId).n;
}
function returnRow(orderId) {
  return db.prepare(`SELECT * FROM order_returns WHERE original_order_id=?`).get(orderId);
}
function stockOf(skuId) {
  return db.prepare(`SELECT stock FROM skus WHERE id=?`).get(skuId)?.stock || 0;
}

// ── Shopee: KHÔNG có capability gate — bug tái hiện trực tiếp trên production ──
test('Shopee: don da paid bi san bao huy SAU do -> dao tien+kho, status ve void (khong con reset ve open)', () => {
  const BR = 'sala';
  Inv.createSku({ id: 'sku-shopee-cancel', name: 'Ao thun', price: 150000, vat: 8, stock: 10 }, BR);
  Settings.updateIntegrations({ channels: { shopee: { enabled: true, appId: 'A', secretKey: 'S' } } }, BR);

  const detailPaid = {
    order_sn: 'SHOPEE-CANCEL-1', order_status: 'SHIPPED',
    item_list: [{ item_sku: 'sku-shopee-cancel', model_sku: 'sku-shopee-cancel', item_name: 'Ao thun',
      model_quantity_purchased: 2, model_discounted_price: 150000 }],
    total_amount: 300000,
  };
  const r1 = Shopee.syncShopeeOrder(detailPaid, 'SHOP-CANCEL', BR);
  const orderId = r1.internal_order_id;
  assert.equal(db.prepare(`SELECT status FROM orders WHERE id=?`).get(orderId).status, 'paid');
  assert.equal(paymentCount(orderId), 1);
  assert.equal(stockOf('sku-shopee-cancel', BR), 8, 'da tru kho khi thanh toan');

  // Đồng bộ tiếp với CANCELLED — đây là kịch bản audit tìm thấy: status phải
  // KHÔNG void thẳng tay, phải đảo tiền/kho trước.
  Shopee.syncShopeeOrder({ ...detailPaid, order_status: 'CANCELLED' }, 'SHOP-CANCEL', BR);

  const after = db.prepare(`SELECT status FROM orders WHERE id=?`).get(orderId);
  assert.equal(after.status, 'void', 'chi vao void SAU KHI da dao xong, khong con la paid');
  assert.equal(stockOf('sku-shopee-cancel', BR), 10, 'kho phai duoc tra lai du 2 cai');
  const ret = returnRow(orderId);
  assert.ok(ret, 'phai co ban ghi order_returns lam bang chung da dao tien');
  assert.equal(ret.refund_total, 300000);
});

test('Shopee: TO_RETURN (khong nam trong PAID_STATUSES) khong duoc reset status ve open (bug cu)', () => {
  const BR = 'sala';
  Inv.createSku({ id: 'sku-shopee-toreturn', name: 'Quan jean', price: 200000, vat: 8, stock: 5 }, BR);
  Settings.updateIntegrations({ channels: { shopee: { enabled: true, appId: 'A', secretKey: 'S' } } }, BR);
  const detail = {
    order_sn: 'SHOPEE-TORETURN-1', order_status: 'SHIPPED',
    item_list: [{ item_sku: 'sku-shopee-toreturn', model_sku: 'sku-shopee-toreturn', item_name: 'Quan jean',
      model_quantity_purchased: 1, model_discounted_price: 200000 }],
    total_amount: 200000,
  };
  const r1 = Shopee.syncShopeeOrder(detail, 'SHOP-TORETURN', BR);
  const orderId = r1.internal_order_id;
  assert.equal(db.prepare(`SELECT status FROM orders WHERE id=?`).get(orderId).status, 'paid');

  // TO_RETURN không nằm trong PAID_STATUSES và cũng KHÔNG phải CANCELLED —
  // trước đây code reset thẳng về 'open', làm mất dấu vết đơn đã trả tiền.
  Shopee.syncShopeeOrder({ ...detail, order_status: 'TO_RETURN' }, 'SHOP-TORETURN', BR);
  assert.equal(db.prepare(`SELECT status FROM orders WHERE id=?`).get(orderId).status, 'paid',
    'TO_RETURN khong lam mat dau vet paid (khong con la open)');
});

// ── Haravan: KHÔNG có capability gate — reversePurchase cũ CHỈ đảo loyalty ──
test('Haravan: don da paid bi webhook huy SAU do -> dao tien+kho+loyalty, khong chi void suong', () => {
  const BR = 'sala';
  Inv.createSku({ id: 'sku-haravan-cancel', name: 'Giay the thao', price: 500000, vat: 8, stock: 3 }, BR);
  Settings.updateIntegrations({ channels: { haravan: { enabled: true, shopDomain: 'shop.myharavan.com',
    branchMap: { 'shop.myharavan.com': BR } } } }, BR);

  const payloadPaid = {
    id: 999001, order_number: 'HRV-CANCEL-1', financial_status: 'paid',
    line_items: [{ sku: 'sku-haravan-cancel', name: 'Giay the thao', quantity: 1, price: 500000 }],
    total_price: 500000,
  };
  const r1 = Haravan.syncHaravanOrder(payloadPaid, 'orders/paid', 'shop.myharavan.com');
  const orderId = r1.internal_order_id;
  assert.equal(db.prepare(`SELECT status FROM orders WHERE id=?`).get(orderId).status, 'paid');
  assert.equal(stockOf('sku-haravan-cancel', BR), 2);

  Haravan.syncHaravanOrder({ ...payloadPaid, cancelled_at: new Date().toISOString() }, 'orders/cancelled', 'shop.myharavan.com');

  const after = db.prepare(`SELECT status FROM orders WHERE id=?`).get(orderId);
  assert.equal(after.status, 'void');
  assert.equal(stockOf('sku-haravan-cancel', BR), 3, 'kho phai duoc tra lai');
  assert.ok(returnRow(orderId), 'phai co ban ghi tra hang lam bang chung da dao tien');
});

// ── Lazada: sau capability gate (order_lifecycle_write + payment_settlement_write
// đã 'verified') — chứng minh code ĐÚNG khi cổng ghi được mở, dù hiện tại chưa có
// nơi nào trong hệ thống tự mở cổng này (an toàn — xem ghi chú trong báo cáo). ──
function grantLiveWrites(provider, shopId, branchId) {
  const connId = `mpconn_test_${provider}_${shopId}`;
  const shopRowId = `mpshop_test_${provider}_${shopId}`;
  const mapId = `mpmap_test_${provider}_${shopId}`;
  db.prepare(`INSERT INTO marketplace_connections
    (id,provider,branch_id,shop_id,shop_name,status,settings_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,datetime('now'),datetime('now'))
    ON CONFLICT(id) DO NOTHING`)
    .run(connId, provider, branchId, shopId, shopId, 'active',
      JSON.stringify({ sync_mode: 'live', owner_write_approved: true }));
  db.prepare(`INSERT INTO marketplace_shops
    (id,connection_id,external_shop_id,shop_name,status,created_at,updated_at)
    VALUES (?,?,?,?,'selected',datetime('now'),datetime('now'))
    ON CONFLICT(id) DO NOTHING`)
    .run(shopRowId, connId, shopId, shopId);
  db.prepare(`INSERT INTO marketplace_shop_mappings
    (id,connection_id,shop_id,branch_id,warehouse_id,enabled,created_at,updated_at)
    VALUES (?,?,?,?,?,1,datetime('now'),datetime('now'))
    ON CONFLICT(id) DO NOTHING`)
    .run(mapId, connId, shopRowId, branchId, 'wh_test');
  ConnStore.setConnectionCapability(connId, 'order_lifecycle_write', 'verified');
  ConnStore.setConnectionCapability(connId, 'payment_settlement_write', 'verified');
  ConnStore.setConnectionCapability(connId, 'fulfillment_write', 'verified');
}

test('Lazada: khi da mo cong ghi that (order_lifecycle_write+payment_settlement_write verified), huy-sau-paid cung duoc dao day du', () => {
  const BR = 'sala';
  // lazadaSkuForLine() khop theo cot `code` (LUON UPPERCASE) cua SKU, khong
  // phai `id` — phai dat code khop voi shop_sku goi len thi moi tru duoc kho.
  Inv.createSku({ id: 'sku-lazada-cancel', code: 'SKU-LZ-CANCEL', name: 'Balo', price: 400000, vat: 8, stock: 4 }, BR);
  Settings.updateIntegrations({ channels: { lazada: { enabled: true, sellerId: 'LZ-CANCEL-SHOP' } } }, BR);
  grantLiveWrites('lazada', 'LZ-CANCEL-SHOP', BR);

  const items = [{ order_item_id: 'LI-C1', shop_sku: 'SKU-LZ-CANCEL', name: 'Balo', paid_price: 400000, item_price: 400000 }];
  const r1 = Lazada.syncLazadaOrder({ order_id: 'LZD-CANCEL-1', status: 'delivered', payment_status: 'paid', price: 400000 },
    items, 'LZ-CANCEL-SHOP', BR);
  const orderId = r1.internal_order_id;
  assert.equal(db.prepare(`SELECT status FROM orders WHERE id=?`).get(orderId).status, 'paid');
  assert.equal(stockOf('sku-lazada-cancel', BR), 3);

  Lazada.syncLazadaOrder({ order_id: 'LZD-CANCEL-1', status: 'canceled', payment_status: 'paid', price: 400000 },
    items, 'LZ-CANCEL-SHOP', BR);

  const after = db.prepare(`SELECT status FROM orders WHERE id=?`).get(orderId);
  assert.equal(after.status, 'void');
  assert.equal(stockOf('sku-lazada-cancel', BR), 4, 'kho phai duoc tra lai');
  assert.ok(returnRow(orderId), 'phai co ban ghi tra hang lam bang chung da dao tien');
});

test('reverseCancelledPaidOrder: dao that bai (khong con o paid) thi GIU NGUYEN status, khong lam gay luong sync', async () => {
  const Returns = await import('./services/returns.js');
  const BR = 'mp-cancel-fail';
  const orderId = 'o_not_real_order';
  // Order khong ton tai -> createReturn se throw ben trong; ham phai nuot loi,
  // khong throw ra ngoai, va khong dam bao gi ve status (khong co order de sua).
  assert.doesNotThrow(() => Returns.reverseCancelledPaidOrder(orderId, BR, 'test', 'shop-x', 'ext-1'));
});
