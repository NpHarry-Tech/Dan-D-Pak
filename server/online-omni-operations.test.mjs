import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-online-omni-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.HARAVAN_DEFAULT_BRANCH_ID = 'sala';

const { db, migrate, now } = await import('./db.js');
migrate();
const Auth = await import('./services/auth.js');
const Haravan = await import('./services/haravanConnector.js');
const Online = await import('./services/online.js');

test('vai tro Quan don Retail Online co bo quyen rieng', () => {
  assert.equal(Auth.ROLES.some(role => role.key === 'online_manager'), true);
  for (const permission of ['online.order.manage', 'online.order.assign', 'online.order.cancel',
    'online.order.refund', 'online.product_mapping', 'online.reconciliation']) {
    assert.equal(Auth.can('online_manager', permission), true, permission);
  }
});

test('connector don web Haravan dung read model hien co va khoa snapshot khi da thanh toan', () => {
  const first = Haravan.syncHaravanOrder({
    id: 9001,
    order_number: 'WEB9001',
    financial_status: 'pending',
    total_price: 120000,
    line_items: [{ id: 1, product_id: 71, variant_id: 81, sku: 'NOT-MAPPED', name: 'Hat dieu web', quantity: 1, price: 120000 }],
  }, 'orders/create', 'shop.myharavan.com');
  const pending = Online.getOnlineOperation(first.internal_order_id, 'sala');
  assert.equal(pending.workflow_status, 'pending');
  assert.equal(pending.needs_product_mapping, true);

  Haravan.syncHaravanOrder({
    id: 9001,
    order_number: 'WEB9001',
    financial_status: 'paid',
    total_price: 100000,
    line_items: [{ id: 1, product_id: 71, variant_id: 81, sku: 'NOT-MAPPED', name: 'Ten tai luc chot', quantity: 1, price: 100000 }],
  }, 'orders/paid', 'shop.myharavan.com');
  const locked = Online.getOnlineOperation(first.internal_order_id, 'sala');
  assert.equal(locked.workflow_status, 'processed');
  assert.ok(locked.locked_at);
  assert.equal(locked.items[0].name, 'Ten tai luc chot');
  assert.equal(locked.items[0].unit_price, 100000);
  const canonical = db.prepare(`SELECT status,bill_no,paid_at FROM orders WHERE id=?`).get(first.internal_order_id);
  assert.equal(canonical.status, 'paid');
  assert.ok(canonical.bill_no);
  assert.ok(canonical.paid_at);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM payments WHERE order_id=?`).get(first.internal_order_id).n, 1);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM sale_snapshots WHERE order_id=?`).get(first.internal_order_id).n, 1);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM e_invoices WHERE order_id=?`).get(first.internal_order_id).n, 1);

  Haravan.syncHaravanOrder({
    id: 9001,
    order_number: 'WEB9001',
    financial_status: 'paid',
    total_price: 1,
    line_items: [{ id: 1, product_id: 71, variant_id: 81, sku: 'NOT-MAPPED', name: 'Ten bi sua ve sau', quantity: 1, price: 1 }],
  }, 'orders/updated', 'shop.myharavan.com');
  const historical = Online.getOnlineOperation(first.internal_order_id, 'sala');
  assert.equal(historical.items[0].name, 'Ten tai luc chot');
  assert.equal(historical.items[0].unit_price, 100000);
  assert.equal(historical.total, 100000);
});

test('lien ket hang Haravan vao SKU co san khong tao them san pham nghiep vu', () => {
  db.prepare(`INSERT INTO skus(id,branch_id,barcode,name,price,cost,stock,unit,active)
    VALUES ('sku_real','sala','REAL-001','San pham POS',99000,0,5,'cai',1)`).run();
  Haravan.syncHaravanProduct({ id: 501, title: 'San pham tren web', variants: [
    { id: 601, sku: 'WEB-001', title: 'Default Title', price: 99000, inventory_quantity: 2 },
  ] }, 'shop.myharavan.com');
  const before = db.prepare(`SELECT COUNT(*) n FROM skus`).get().n;
  Haravan.linkHaravanProduct({ branchId: 'sala', shopDomain: 'shop.myharavan.com',
    externalProductId: 501, externalVariantId: 601, skuId: 'sku_real', actor: 'test' });
  const mapping = Haravan.listHaravanProductMappings({ branchId: 'sala', shopDomain: 'shop.myharavan.com' });
  assert.equal(mapping.rows[0].sku_id, 'sku_real');
  assert.equal(mapping.rows[0].mapping_status, 'catalog_linked');
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM skus`).get().n, before);
});

test('don web da thanh toan di qua kho, bao cao va hoa don dung mot lan', () => {
  const beforeStock = db.prepare(`SELECT stock FROM skus WHERE id='sku_real'`).get().stock;
  const result = Haravan.syncHaravanOrder({
    id: 9002, order_number: 'WEB9002', financial_status: 'paid', total_price: 198000,
    line_items: [{ id: 2, product_id: 501, variant_id: 601, sku: 'WEB-001', name: 'Snapshot web', quantity: 2, price: 99000 }],
  }, 'orders/paid', 'shop.myharavan.com');
  assert.equal(db.prepare(`SELECT stock FROM skus WHERE id='sku_real'`).get().stock, beforeStock - 2);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM stock_movements WHERE ref=? AND type='sale'`).get(result.internal_order_id).n, 1);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM payments WHERE order_id=?`).get(result.internal_order_id).n, 1);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM e_invoices WHERE order_id=?`).get(result.internal_order_id).n, 1);
  Haravan.syncHaravanOrder({
    id: 9002, order_number: 'WEB9002', financial_status: 'paid', total_price: 198000,
    line_items: [{ id: 2, product_id: 501, variant_id: 601, sku: 'WEB-001', name: 'Retry', quantity: 2, price: 99000 }],
  }, 'orders/updated', 'shop.myharavan.com');
  assert.equal(db.prepare(`SELECT stock FROM skus WHERE id='sku_real'`).get().stock, beforeStock - 2);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM payments WHERE order_id=?`).get(result.internal_order_id).n, 1);
});

test('phan cong va luong dong goi chi cap nhat state, khong tao don moi', async () => {
  const order = db.prepare(`SELECT id FROM orders WHERE online_ref='9001'`).get();
  db.prepare(`INSERT INTO users(id,branch_id,username,name,pin,role,active,lang,branch_access_json)
    VALUES (?,?,?,?,?,'online_manager',1,'vi','["sala"]')`)
    .run('u_online', 'sala', 'online.op', 'Nhan vien Online', 'x');
  Online.assignOnlineOperation(order.id, 'u_online', 'sala', 'test');
  const preparing = await Online.transitionOnlineOperation(order.id, 'preparing', {}, 'sala', 'test');
  assert.equal(preparing.workflow_status, 'preparing');
  const ready = await Online.transitionOnlineOperation(order.id, 'ready_to_ship', {}, 'sala', 'test');
  assert.equal(ready.workflow_status, 'ready_to_ship');
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM orders WHERE online_ref='9001'`).get().n, 1);
});

test('Dan D Pak Omni tach khoi capability cua connector Haravan', () => {
  const capabilities = Haravan.haravanCapabilities();
  assert.equal(capabilities.orders.webhooks, true);
  assert.equal(capabilities.conversations.read, false);
  assert.match(capabilities.conversations.reason, /Harasocial/);
});

test.after(() => {
  db.close();
  rmSync(temp, { recursive: true, force: true });
});
