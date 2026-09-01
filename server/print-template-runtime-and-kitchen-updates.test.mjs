import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'ddp-print-runtime-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.PRINT_DISPATCH = 'agent';
process.env.DATA_ENCRYPTION_KEY ||= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const { migrate, db } = await import('./db.js');
const Print = await import('./services/printing.js');
const Orders = await import('./services/orders.js');
const Payments = await import('./services/payments.js');
const Settings = await import('./services/settings.js');
const System = await import('./services/system.js');
migrate();

Settings.updateSettings({ print_config: {
  bill: { paper: 'K80', widthMm: 80 },
  kitchen: { splitPerItem: '0', perUnit: '0', showStaff: '1' },
  printers: [
    { id: 'billDrv', name: 'BILL', systemName: 'BILL', output: 'receipt', connection: 'system', active: true, renderMode: 'driver', primaryDeviceId: 'dev' },
    { id: 'kitchen', name: 'BEP', systemName: 'BEP', output: 'kitchen_ticket', connection: 'system', active: true, renderMode: 'driver', primaryDeviceId: 'dev' },
  ],
  templates: {
    bill: { kind: 'bill', standard: 'dan_payment_receipt', version: 10, rows: [
      { id: 'custom', type: 'text', text: 'MAU CUA TOI - {billNo}', align: 'center', bold: true, fontSize: 6 },
      { id: 'items', type: 'text', text: '{items}' },
      { id: 'total', type: 'text', text: '{grandTotalLine}', bold: true },
    ] },
    kitchen_ticket: { kind: 'kitchen_ticket', rows: [
      { id: 'head', type: 'text', text: 'BÀN {table}', align: 'center', bold: true, fontSize: 7 },
      { id: 'meta', type: 'text', text: 'Giờ: {time} | Ngày: {date}\nNV: {staff}\nSố TT: {seq}' },
      { id: 'items', type: 'items', showQty: true, showMods: true, showNote: true },
    ] },
  },
} }, 'sala');
System.setAgentPrinters('sala', [{ Name: 'BILL' }, { Name: 'BEP' }], { deviceId: 'dev', deviceName: 'POS' });

test('Windows driver renders the exact saved bill template instead of a hard-coded receipt', () => {
  const job = Print.createJob({ printer: 'billDrv', type: 'receipt', title: 'Bill', branch_id: 'sala', payload: {
    bill_no: 'Dan160826001', items: [{ name: 'Cơm cá hồi', qty: 2, unit_price: 100000 }],
    total: 200000, goods_amount: 200000, lines: [{ method: 'cash', amount: 200000 }],
  } });
  const pending = Print.pendingAgentJobs('sala', { deviceId: 'dev' }).find((x) => x.id === job.id);
  const doc = JSON.parse(pending.driverDoc);
  const flat = JSON.stringify(doc.blocks);
  assert.match(flat, /MAU CUA TOI - Dan160826001/);
  assert.match(flat, /Cơm cá hồi/);
  assert.equal(doc.offsetMm, -2);
});

test('kitchen driver template receives time, date, staff, sequence and quantity', () => {
  const job = Print.createJob({ printer: 'kitchen', type: 'kitchen_ticket', title: 'Bếp', branch_id: 'sala', payload: {
    table: 'A08', time: '10:33', date: '16/08/2026', staff: 'Nguyễn Phúc Huy', seq: '13',
    items: [{ name: 'Cơm cá hồi', qty: 3 }],
  } });
  const pending = Print.pendingAgentJobs('sala', { deviceId: 'dev' }).find((x) => x.id === job.id);
  const doc = JSON.parse(pending.driverDoc);
  const flat = JSON.stringify(doc.blocks);
  for (const value of ['BÀN A08', '10:33', '16/08/2026', 'Nguyễn Phúc Huy', 'Số TT: 13', 'Cơm cá hồi', '3']) {
    assert.match(flat, new RegExp(value));
  }
});

test('kitchen updates allocate X-1, X-2; cancellation is struck and table move is A => B', () => {
  const order = { id: 'o-update', pay_ref: 'Dan160826013', table_code: 'A08', zone: 'Tầng trệt' };
  assert.equal(Print.printKitchenUpdate(order, [{ name: 'Cơm cá hồi', qty: 2, station: 'kitchen', cancelled: true }], 'sala', 'Huy', 'cancel_item'), 1);
  assert.equal(Print.printKitchenUpdate(order, [{ name: 'Cơm cá hồi', qty: 2, station: 'kitchen' }], 'sala', 'Huy', 'move_table', { tableDisplay: 'A08 => BÀN B03' }), 2);
  const jobs = Print.listJobs('sala', { limit: 20 }).filter((j) => j.payload.order_id === order.id);
  assert.deepEqual(new Set(jobs.map((j) => j.payload.seq)), new Set(['13-1', '13-2']));
  const cancel = jobs.find((j) => j.payload.update_kind === 'cancel_item');
  const moved = jobs.find((j) => j.payload.update_kind === 'move_table');
  assert.equal(moved.payload.table, 'A08 => BÀN B03');
  const cancelDoc = JSON.parse(Print.pendingAgentJobs('sala', { deviceId: 'dev' }).find((x) => x.id === cancel.id).driverDoc);
  const cancelledRow = cancelDoc.blocks.find((b) => b.type === 'row'
    && b.cols?.some((c) => c.text === 'Cơm cá hồi'));
  assert.ok(cancelledRow, 'phiếu hủy phải có đúng món đã hủy');
  assert.deepEqual(cancelledRow.cols.map((c) => c.text), ['Cơm cá hồi', '2']);
  assert.ok(cancelledRow.cols.every((c) => c.strike === true),
    'cả tên và số lượng món hủy phải có gạch ngang');
});

test('real cancelItem and moveTable business flows create kitchen update tickets', () => {
  db.prepare(`INSERT INTO tables(id,branch_id,zone,code,status) VALUES(?,?,?,?,?)`).run('tb-a', 'sala', 'Trệt', 'Z91', 'busy');
  db.prepare(`INSERT INTO tables(id,branch_id,zone,code,status) VALUES(?,?,?,?,?)`).run('tb-b', 'sala', 'Trệt', 'Z92', 'free');
  const stamp = new Date().toISOString();
  db.prepare(`INSERT INTO orders(id,branch_id,table_id,channel,status,pay_ref,created_at) VALUES(?,?,?,?,?,?,?)`)
    .run('o-cancel-flow', 'sala', 'tb-a', 'dine_in', 'open', 'Dan160826021', stamp);
  db.prepare(`INSERT INTO order_items(id,order_id,name,qty,unit_price,station,status,created_at) VALUES(?,?,?,?,?,?,?,?)`)
    .run('oi-cancel-flow', 'o-cancel-flow', 'Món cần hủy', 2, 10000, 'kitchen', 'new', stamp);
  Orders.cancelItem('oi-cancel-flow', 'Khách đổi ý', 'sala', 'Nhan vien A');
  const cancelJob = Print.listJobs('sala', 50).find((j) => j.payload.order_id === 'o-cancel-flow');
  assert.equal(cancelJob.payload.update_kind, 'cancel_item');
  assert.equal(cancelJob.payload.items[0].cancelled, true);

  db.prepare(`UPDATE tables SET status='busy' WHERE id='tb-a'`).run();
  db.prepare(`INSERT INTO orders(id,branch_id,table_id,channel,status,pay_ref,created_at) VALUES(?,?,?,?,?,?,?)`)
    .run('o-move-flow', 'sala', 'tb-a', 'dine_in', 'open', 'Dan160826022', stamp);
  db.prepare(`INSERT INTO order_items(id,order_id,name,qty,unit_price,station,status,created_at) VALUES(?,?,?,?,?,?,?,?)`)
    .run('oi-move-flow', 'o-move-flow', 'Món chuyển bàn', 1, 20000, 'kitchen', 'new', stamp);
  Orders.moveTable('tb-a', 'tb-b', 'sala', 'Nhan vien B');
  const moveJob = Print.listJobs('sala', 50).find((j) => j.payload.order_id === 'o-move-flow');
  assert.equal(moveJob.payload.update_kind, 'move_table');
  assert.equal(moveJob.payload.table, 'Z91 => BÀN Z92');
  const moveDoc = JSON.parse(Print.pendingAgentJobs('sala', { deviceId: 'dev' })
    .find((x) => x.id === moveJob.id).driverDoc);
  assert.match(JSON.stringify(moveDoc.blocks), /BÀN Z91 => BÀN Z92/);
});

test('GDI agent applies the requested physical -2mm left offset and strikeout font', () => {
  const source = readFileSync(new URL('./agent.cjs', import.meta.url), 'utf8');
  assert.match(source, /offsetMm \* 3\.937007874/);
  assert.match(source, /FontStyle\]::Strikeout/);
  assert.match(source, /function Draw-StrikeLine/,
    'phải có đường gạch vật lý dự phòng khi driver bỏ qua FontStyle.Strikeout');
  assert.match(source, /if \(\[bool\]\$c\.strike\) \{ Draw-StrikeLine/,
    'tên và số lượng trong row phải thật sự gọi đường gạch dự phòng');
});

test('sales history excludes soft-deleted/void bills but database rows remain', async () => {
  const History = await import('./services/history.js');
  const stamp = new Date().toISOString();
  db.prepare(`INSERT INTO orders(id,branch_id,channel,status,bill_no,total,created_at,paid_at) VALUES(?,?,?,?,?,?,?,?)`)
    .run('o-paid-visible', 'sala', 'retail', 'paid', 'VISIBLE', 10, stamp, stamp);
  db.prepare(`INSERT INTO orders(id,branch_id,channel,status,bill_no,total,created_at,paid_at) VALUES(?,?,?,?,?,?,?,?)`)
    .run('o-soft-deleted', 'sala', 'retail', 'void', 'DELETED', 20, stamp, stamp);
  const rows = History.listOrderHistory('sala', { q: '' });
  assert.ok(rows.some((r) => r.id === 'o-paid-visible'));
  assert.ok(!rows.some((r) => r.id === 'o-soft-deleted'));
  assert.ok(db.prepare(`SELECT 1 FROM orders WHERE id='o-soft-deleted'`).get(), 'soft-delete không được xóa dữ liệu DB');
});

test('bill deletion reverses every payment method without deleting original evidence', () => {
  const stamp = new Date().toISOString();
  db.prepare(`INSERT INTO orders(id,branch_id,channel,status,bill_no,total,created_at,paid_at) VALUES(?,?,?,?,?,?,?,?)`)
    .run('o-reverse-payments', 'sala', 'retail', 'paid', 'REV001', 150000, stamp, stamp);
  db.prepare(`INSERT INTO payments(id,order_id,shift_id,cashier,total,created_at) VALUES(?,?,?,?,?,?)`)
    .run('pay-original', 'o-reverse-payments', 'shift-1', 'cashier', 150000, stamp);
  db.prepare(`INSERT INTO payment_lines(id,payment_id,method,amount,tendered_amount,reference) VALUES(?,?,?,?,?,?)`)
    .run('line-cash', 'pay-original', 'cash', 50000, 50000, null);
  db.prepare(`INSERT INTO payment_lines(id,payment_id,method,amount,tendered_amount,reference) VALUES(?,?,?,?,?,?)`)
    .run('line-bank', 'pay-original', 'bank', 100000, 100000, 'QR');

  const reversal = Payments.reverseOrderPayments('o-reverse-payments', 'Khách yêu cầu xóa', 'manager');
  assert.equal(reversal.amount, 150000);
  assert.equal(Payments.paidForOrder('o-reverse-payments'), 0);
  assert.ok(db.prepare(`SELECT 1 FROM payment_lines WHERE id='line-cash' AND amount=50000`).get(), 'chứng từ gốc phải giữ nguyên');
  const reversed = db.prepare(`SELECT method,amount FROM payment_lines WHERE payment_id=? ORDER BY method`).all(reversal.payment_id)
    .map((row) => ({ method: row.method, amount: row.amount }));
  assert.deepEqual(reversed, [{ method: 'bank', amount: -100000 }, { method: 'cash', amount: -50000 }]);
  assert.equal(db.prepare(`SELECT shift_id FROM payments WHERE id=?`).get(reversal.payment_id).shift_id, 'shift-1');
});
