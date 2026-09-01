import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'haravan-outbound-'));
process.env.SQLITE_PATH = join(tmp, 'test.db');
process.env.STORAGE_PATH = join(tmp, 'storage');
process.env.DATA_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.HARAVAN_ENABLED = 'true';
process.env.HARAVAN_DEFAULT_BRANCH_ID = 'sala';

const { db, migrate, now } = await import('./db.js');
const Settings = await import('./services/settings.js');
const Customers = await import('./services/customers.js');
const Haravan = await import('./services/haravanConnector.js');
migrate(db);
Settings.updateIntegrations({ channels: { haravan: {
  enabled: true, shopDomain: 'shop.myharavan.com', accessToken: 'token',
  defaultBranchId: 'sala', syncOrders: true, syncCustomers: true,
} } }, 'sala');

try {
  const customer = Customers.upsertCustomer({ name: 'Nguyen Van An', phone: '0909000001' }, 'sala');
  db.prepare(`INSERT INTO orders
    (id,branch_id,channel,status,subtotal,discount,total,created_at,paid_at,customer_json,bill_no)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run('order_pos_1', 'sala', 'retail', 'paid', 50000, 0, 50000,
      now(), now(), JSON.stringify(customer), 'Dan170800001');
  db.prepare(`INSERT INTO order_items
    (id,order_id,name,qty,unit_price,station,sla_minutes,mods_json,status,created_at)
    VALUES (?,?,?,?,?,?,?,'[]','served',?)`).run('item_1', 'order_pos_1', 'Hat dieu', 2, 25000, 'retail', 0, now());

  let postedOrder;
  let postedVat;
  globalThis.fetch = async (url, init = {}) => {
    const value = String(url);
    if (value.includes('/com/customers/search.json')) {
      return { ok: true, json: async () => ({ customers: [{ id: 7001, phone: '0909000001' }] }) };
    }
    if (value.endsWith('/com/orders.json') && init.method === 'POST') {
      postedOrder = JSON.parse(init.body).order;
      return { ok: true, json: async () => ({ order: { id: 8001, order_number: 'H8001' } }) };
    }
    if (value.endsWith('/com/orders/8001.json') && init.method === 'PUT') {
      postedVat = JSON.parse(init.body).order;
      return { ok: true, json: async () => ({ order: { id: 8001, tags: postedVat.tags } }) };
    }
    throw new Error(`unexpected URL ${value}`);
  };

  const queued = Haravan.enqueuePaidPosOrder('order_pos_1');
  assert.equal(queued.queued, true);
  await Haravan.processHaravanOutboundQueue();
  assert.equal(postedOrder.financial_status, 'paid');
  assert.equal(postedOrder.note.includes('Dan170800001'), true);
  assert.equal(postedOrder.customer.id, 7001);
  assert.equal(postedOrder.note.includes('Điểm vừa nhận:'), true);
  assert.equal(postedOrder.note.includes('Ghi chú:'), false);
  assert.equal(postedOrder.note_attributes.some(x => x.name === 'customer_note'), false);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM external_orders WHERE internal_order_id='order_pos_1'`).get().n, 1);
  assert.equal(Haravan.enqueuePaidPosOrder('order_pos_1').duplicate, true);

  const sessions = Haravan.listSyncSessions();
  assert.equal(sessions.some(row => row.id === queued.session_id && row.direction === 'outbound'), true);
  assert.equal(Haravan.syncSessionDetails(queued.session_id).length, 1);

  db.prepare(`INSERT INTO e_invoices
    (id,order_id,branch_id,provider,invoice_status,invoice_template,invoice_series,invoice_no,lookup_url,
     idempotency_key,customer_mode,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('invoice_1', 'order_pos_1', 'sala', 'misa', 'ISSUED',
      '1', 'C26TDP', '00001234', 'https://invoice.example/view/1', 'invoice:test:1', 'BUYER_PROVIDED_INFO', now(), now());
  const vatQueued = Haravan.enqueueIssuedInvoice('invoice_1');
  assert.equal(vatQueued.queued, true);
  await Haravan.processHaravanOutboundQueue();
  assert.equal(postedVat.note.includes('Hóa đơn VAT đã phát hành'), true);
  assert.equal(postedVat.note.includes('00001234'), true);
  assert.equal(postedVat.note_attributes.some(x => x.name === 'invoice_url'), true);
  assert.equal(Haravan.enqueueIssuedInvoice('invoice_1').duplicate, true);

  Customers.recordPurchase(customer.id, 50000, 'sala', 'order_pos_1');
  Customers.recordPurchase(customer.id, 50000, 'sala', 'order_pos_1');
  assert.equal(db.prepare(`SELECT total_orders FROM customers WHERE id=?`).get(customer.id).total_orders, 1);
  Customers.reversePurchase('order_pos_1', 'sala');
  Customers.reversePurchase('order_pos_1', 'sala');
  assert.equal(db.prepare(`SELECT total_orders FROM customers WHERE id=?`).get(customer.id).total_orders, 0);
  await new Promise(resolve => setImmediate(resolve));
} finally {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
}
