// Smoke test for P0 fixes round 2 (guards, customer-qr-pay, DMS, mod-price). Temp DB only.
process.env.SQLITE_PATH = 'scratch/p0_test2.db';
process.env.DISABLE_DEMO_SEED = 'false';
process.env.NODE_ENV = 'development';
import { rmSync } from 'node:fs';
for (const f of ['scratch/p0_test2.db', 'scratch/p0_test2.db-wal', 'scratch/p0_test2.db-shm']) {
  try { rmSync(f, { force: true }); } catch {}
}

const pass = [], fail = [];
const check = (name, cond) => (cond ? pass : fail).push(name);

const { migrate, db } = await import('../server/db.js');
migrate();
await import('../server/seed.js');
const { migratePlaintextPins } = await import('../server/services/pin.js');
migratePlaintextPins(db);
const { bootstrapDefaultAdmin } = await import('../server/services/bootstrapAdmin.js');
bootstrapDefaultAdmin();

// Loading api.js validates the entire import graph (syntax + every imported name).
await import('../server/api.js');
check('api.js import graph loads', true);

const Auth = await import('../server/services/auth.js');
check('Auth.requirePermission is a function', typeof Auth.requirePermission === 'function');
let threw = false, status = 0;
try { Auth.requirePermission({ headers: {} }, 'module.documents'); } catch (e) { threw = true; status = e.status; }
check('requirePermission throws 401 without auth', threw && status === 401);

const Shifts = await import('../server/services/shifts.js');
const Orders = await import('../server/services/orders.js');
const Pay = await import('../server/services/payments.js');
const adminUser = db.prepare(`SELECT * FROM users WHERE username='admin'`).get();
Shifts.openShift({ opening_cash: 0, cash_manual: true, counts: {} }, adminUser, 'br1');
const mi = db.prepare(`SELECT id, price FROM menu_items WHERE price>0 LIMIT 1`).get();

// customer-qr-pay must NOT close the bill by default (secure).
const order = Orders.createOrUpdateOrder({ branch_id: 'br1', table_id: null, channel: 'dine_in', source: 'staff_pos', items: [{ menu_item_id: mi.id, qty: 1 }] });
const r = Pay.customerQrPay(order.id, { method: 'qrcode' }, 'br1');
check('customerQrPay returns awaiting_staff by default', r.status === 'awaiting_staff');
check('bill stays OPEN after customer self-claim', db.prepare(`SELECT status FROM orders WHERE id=?`).get(order.id).status === 'open');

// Negative modifier price must be clamped (no zeroing the bill).
const order2 = Orders.createOrUpdateOrder({ branch_id: 'br1', table_id: null, channel: 'dine_in', source: 'staff_pos', items: [{ menu_item_id: mi.id, qty: 1, mods: [{ name: 'hack', price: -999999 }] }] });
const it = db.prepare(`SELECT unit_price FROM order_items WHERE order_id=?`).get(order2.id);
check('negative mod price clamped (unit_price === base price)', it.unit_price === mi.price);

// Positive modifier still adds.
const order3 = Orders.createOrUpdateOrder({ branch_id: 'br1', table_id: null, channel: 'dine_in', source: 'staff_pos', items: [{ menu_item_id: mi.id, qty: 1, mods: [{ name: 'extra', price: 5000 }] }] });
const it3 = db.prepare(`SELECT unit_price FROM order_items WHERE order_id=?`).get(order3.id);
check('positive mod price still added', it3.unit_price === mi.price + 5000);

console.log('\nPASS (' + pass.length + '):\n  ' + pass.join('\n  '));
console.log('\nFAIL (' + fail.length + '):\n  ' + (fail.join('\n  ') || '(none)'));
for (const f of ['scratch/p0_test2.db', 'scratch/p0_test2.db-wal', 'scratch/p0_test2.db-shm']) {
  try { rmSync(f, { force: true }); } catch {}
}
process.exit(fail.length ? 1 : 0);
