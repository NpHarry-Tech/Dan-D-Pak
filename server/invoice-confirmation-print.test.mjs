// Phiếu XÁC NHẬN PHÁT HÀNH HÓA ĐƠN — tự in NGAY khi (và chỉ khi) bill có
// invoice_no thật từ MISA (invoice_status='ISSUED'), không sớm hơn. Test này
// khoá lại phần in (Print.printInvoiceConfirmation) độc lập với luồng MISA
// đầy đủ (đã có misa-end-to-end.test.mjs bao luồng phát hành thật).
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-invconf-print-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = process.env.DATA_ENCRYPTION_KEY
  || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
// Không bao giờ gọi máy in thật trong test — Hardware Agent giả lập nhận job.
process.env.PRINT_DISPATCH = 'agent';

const { db, migrate } = await import('./db.js');
const Print = await import('./services/printing.js');
const AppSettings = await import('./services/settings.js');
const System = await import('./services/system.js');
const Orders = await import('./services/orders.js');

migrate();
const BR = 'sala';
AppSettings.updateSettings({
  print_config: {
    printers: [{
      id: 'pos80c', name: 'POS-80C', systemName: 'POS-80C', label: 'in bill',
      output: 'receipt', connection: 'system', active: true, auto: true,
      renderMode: 'driver', driverFont: 'Segoe UI',
    }, {
      id: 'kitchen', name: 'Bếp', systemName: 'Bếp', label: 'in bếp',
      output: 'kitchen_ticket', connection: 'system', active: true, auto: true,
    }],
  },
}, BR);

function fixtureOrder() {
  const o = db.prepare(`INSERT INTO orders (id,branch_id,channel,status,subtotal,discount,total,created_at,bill_no)
    VALUES (?,?,?,?,?,?,?,?,?)`);
  const id = `o_test_${Math.random().toString(36).slice(2)}`;
  o.run(id, BR, 'retail', 'paid', 100000, 0, 100000, new Date().toISOString(), `Dan_TEST_${id.slice(-4)}`);
  return db.prepare(`SELECT * FROM orders WHERE id=?`).get(id);
}

function fixtureData(overrides = {}) {
  return {
    billNo: 'Dan130926099', branchName: 'Dan D Pak Sala', shiftLabel: 'Ca sang',
    issuedAt: new Date().toISOString(), cashier: 'Thu ngan A', buyerName: 'Ban cho nguoi tieu dung',
    items: [{ itemType: 1, name: 'Tra dao', code: 'SKU1', qty: 1, unitPrice: 92593, amount: 92593, vatRateName: '8%', vatAmount: 7407 }],
    subtotal: 92593, vatTotal: 7407, discount: 0, total: 100000, paymentMethod: 'TM',
    invoiceNo: '00000123', template: '1', series: 'C25MAA', lookupCode: 'ABC123',
    ...overrides,
  };
}

test('bill co invoice_no that thi tu tao dung 1 print_jobs loai invoice_confirmation', () => {
  const order = fixtureOrder();
  const job = Print.printInvoiceConfirmation(order, fixtureData(), BR, {});
  assert.ok(job, 'phai tao duoc job in');
  assert.equal(job.type, 'invoice_confirmation');
  assert.equal(job.status, 'queued');
  const row = db.prepare(`SELECT * FROM print_jobs WHERE id=?`).get(job.id);
  assert.equal(row.idempotency_key, `invconf:${BR}:${order.id}`);
  const payload = JSON.parse(row.payload_json);
  assert.equal(payload.invoiceNo, '00000123');
  assert.equal(payload.billNo, 'Dan130926099');
});

test('goi lai (worker replay) KHONG tao ban in thu hai — idempotency theo order', () => {
  const order = fixtureOrder();
  const first = Print.printInvoiceConfirmation(order, fixtureData(), BR, {});
  const again = Print.printInvoiceConfirmation(order, fixtureData({ invoiceNo: '99999999' }), BR, {});
  assert.equal(again.id, first.id, 'phai tra ve dung job cu, khong tao them');
  const count = db.prepare(`SELECT COUNT(*) n FROM print_jobs WHERE idempotency_key=?`)
    .get(`invconf:${BR}:${order.id}`).n;
  assert.equal(count, 1);
});

test('linked printer khong phai may hoa don thi van in vao tuyen Hoa don / Tam tinh', () => {
  const order = { ...fixtureOrder(), linked_printer_id: 'kitchen' };
  const job = Print.printInvoiceConfirmation(order, fixtureData(), BR, {});
  assert.equal(job.printer, 'pos80c', 'khong duoc gui phieu xac nhan sang may bep');
});

test('phieu xac nhan uu tien may in vat ly cua thiet bi da ban hang', () => {
  const localBranch = 'invoice-local-device';
  AppSettings.updateSettings({ print_config: { printers: [{
    id: 'quay-chung', systemName: 'QUAY-CHUNG', output: 'receipt',
    connection: 'system', active: true, priority: 1, primaryDeviceId: 'dev-quay',
  }] } }, localBranch);
  System.setAgentPrinters(localBranch, [{ Name: 'InnerPrinter', widthMm: 58 }],
    { deviceId: 'dev-cam-tay', deviceName: 'SUNMI' });

  const order = { ...fixtureOrder(), branch_id: localBranch, linked_pos_device: 'dev-cam-tay' };
  const job = Print.printInvoiceConfirmation(order, fixtureData(), localBranch, {});
  assert.match(job.printer, /^auto:dev-cam-tay:/,
    'phai in tren may gan lien thay vi day thang len quay chung');
});

test('may hoa don dung Windows driver nhan du driverDoc cua invoice confirmation', () => {
  const order = fixtureOrder();
  const job = Print.printInvoiceConfirmation(order, fixtureData(), BR, {});
  const pending = Print.pendingAgentJobs(BR, { deviceId: 'agent-test', limit: 100 })
    .find(x => x.id === job.id);
  assert.ok(pending, 'agent phai nhan duoc job');
  assert.equal(pending.renderMode, 'driver');
  const doc = JSON.parse(pending.driverDoc);
  assert.match(JSON.stringify(doc.blocks), /PHIẾU XÁC NHẬN HÓA ĐƠN ĐIỆN TỬ/);
  assert.match(JSON.stringify(doc.blocks), /00000123/);
});

test('chua co tuyen may in hoa don thi khong throw, chi log, tra ve null', () => {
  AppSettings.updateSettings({ print_config: { printers: [] } }, 'branch-no-printer');
  const order = fixtureOrder();
  const job = Print.printInvoiceConfirmation(order, fixtureData(), 'branch-no-printer', {});
  assert.equal(job, null, 'khong co tuyen in thi tra ve null, khong throw lam hong luong phat hanh');
});
