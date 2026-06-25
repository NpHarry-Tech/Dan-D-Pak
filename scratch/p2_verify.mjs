// Service-level verification for the latest batch: bill_no anti-dup, real backup,
// online webhook secret + unmapped-item rejection (no stock drain). Temp DB only.
process.env.SQLITE_PATH = 'scratch/p2_verify.db';
process.env.NODE_ENV = 'development';
import { rmSync, existsSync } from 'node:fs';
for (const f of ['scratch/p2_verify.db', 'scratch/p2_verify.db-wal', 'scratch/p2_verify.db-shm']) { try { rmSync(f, { force: true }); } catch {} }

const pass = [], fail = [];
const check = (n, c, e = '') => (c ? pass : fail).push(n + (e ? ` (${e})` : ''));

const { migrate, db, backupDatabase, listBackups, uid, now } = await import('../server/db.js');
migrate();
await import('../server/seed.js');
const { migratePlaintextPins } = await import('../server/services/pin.js');
migratePlaintextPins(db);
const { bootstrapDefaultAdmin } = await import('../server/services/bootstrapAdmin.js');
bootstrapDefaultAdmin();

const Shifts = await import('../server/services/shifts.js');
const Orders = await import('../server/services/orders.js');
const AppSettings = await import('../server/services/settings.js');
const Online = await import('../server/services/online.js');

const admin = db.prepare(`SELECT * FROM users WHERE username='admin'`).get();
Shifts.openShift({ opening_cash: 0, cash_manual: true, counts: {} }, admin, 'br1');
const mi = db.prepare(`SELECT id FROM menu_items WHERE price>0 LIMIT 1`).get();

// 1) bill_no uniqueness across rapid creation
const billNos = [];
for (let i = 0; i < 5; i++) {
  const o = Orders.createOrUpdateOrder({ branch_id: 'br1', table_id: null, channel: 'dine_in', source: 'staff_pos', items: [{ menu_item_id: mi.id, qty: 1 }] });
  billNos.push(o.bill_no);
}
check('5 orders get unique bill_no', new Set(billNos).size === 5, billNos.join(','));

// 2) UNIQUE index actually enforced (manual duplicate INSERT must throw)
let dupThrew = false;
try {
  db.prepare(`INSERT INTO orders (id,branch_id,table_id,channel,status,bill_no,created_at) VALUES (?,?,?,?,'open',?,?)`)
    .run(uid('o_'), 'br1', null, 'dine_in', billNos[0], now());
} catch { dupThrew = true; }
check('UNIQUE idx_orders_bill_no rejects duplicate', dupThrew);

// 3) real backup
const bk = backupDatabase(14);
check('backupDatabase creates a snapshot file', bk.ok && existsSync(bk.path), bk.error || bk.path);
check('listBackups sees the snapshot', listBackups().length >= 1);

// 4) online webhook: enable website channel + secret
const integ = AppSettings.getIntegrations('br1');
integ.channels.website = { ...(integ.channels.website || {}), enabled: true, webhookSecret: 'S3CRET' };
AppSettings.updateIntegrations(integ, 'br1');
const skuName = db.prepare(`SELECT name FROM skus WHERE branch_id='br1' LIMIT 1`).get().name;
const skuBefore = db.prepare(`SELECT stock FROM skus WHERE name=? AND branch_id='br1'`).get(skuName).stock;

// 4a) unmapped item must be REJECTED (and must not drain stock)
let unmappedRejected = false;
try { Online.receive({ channel: 'website', items: [{ name: '__KHONG_TON_TAI__', qty: 1, price: 50000 }] }, 'br1', { 'x-webhook-secret': 'S3CRET' }); }
catch (e) { unmappedRejected = /unmapped|Không khớp/i.test(e.message) || e.code === 'ONLINE_ITEM_UNMAPPED'; }
check('online: unmapped item rejected (no first-SKU fallback)', unmappedRejected);

// 4b) wrong secret -> 401
let wrongSecret = false;
try { Online.receive({ channel: 'website', items: [{ name: skuName, qty: 1, price: 50000 }] }, 'br1', { 'x-webhook-secret': 'WRONG' }); }
catch (e) { wrongSecret = e.status === 401; }
check('online: wrong webhook secret -> 401', wrongSecret);

// 4c) missing secret -> 401
let noSecret = false;
try { Online.receive({ channel: 'website', items: [{ name: skuName, qty: 1, price: 50000 }] }, 'br1', {}); }
catch (e) { noSecret = e.status === 401; }
check('online: missing secret (when configured) -> 401', noSecret);

const skuAfterBad = db.prepare(`SELECT stock FROM skus WHERE name=? AND branch_id='br1'`).get(skuName).stock;
check('online: stock NOT drained by rejected orders', skuAfterBad === skuBefore, `${skuBefore} -> ${skuAfterBad}`);

// 4d) valid secret + mappable item -> success
let okOrder = null;
try { okOrder = Online.receive({ channel: 'website', items: [{ name: skuName, qty: 1, price: 50000 }] }, 'br1', { 'x-webhook-secret': 'S3CRET' }); } catch (e) { okOrder = { err: e.message }; }
check('online: valid secret + real product -> order created', !!okOrder?.id, okOrder?.err || '');

console.log('\nPASS (' + pass.length + '):\n  ' + pass.join('\n  '));
console.log('\nFAIL (' + fail.length + '):\n  ' + (fail.join('\n  ') || '(none)'));
for (const f of ['scratch/p2_verify.db', 'scratch/p2_verify.db-wal', 'scratch/p2_verify.db-shm']) { try { rmSync(f, { force: true }); } catch {} }
process.exit(fail.length ? 1 : 0);
