// Chính sách "Phát hành khi kết ca" (settings.print.einvoice.issueTiming =
// 'at_shift_close'): bill thanh toán trong ca phải GIỮ ở QUEUED_FOR_SHIFT_CLOSE
// (không gọi MISA), và chỉ thật sự phát hành khi kết ca — xem einvoice.js
// issueShiftBatch() + shifts.js closeShift(). Dùng máy chủ MISA giả như
// misa-end-to-end.test.mjs, thu gọn còn đúng 2 endpoint cần cho luồng này.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-misa-shiftbatch-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = process.env.DATA_ENCRYPTION_KEY
  || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.PRINT_DISPATCH = 'agent';
process.env.MISA_MEINVOICE_APP_ID = 'test-app-id';

let publishCalls = 0;
let seq = 0;

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  if (path === '/api/v3/auth/token') {
    return json(res, 200, { access_token: 'tok', expires_in: 3600 });
  }
  if (path === '/api/v3/code/itg/invoice-calculating/invoiceandpublish') {
    publishCalls += 1;
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const b = JSON.parse(raw || '{}');
      seq += 1;
      json(res, 200, { data: { InvNo: String(2000 + seq), InvSeries: 'C26MBM', LookupCode: 'LK' + seq, TransactionID: 'TX' + seq, RefID: b.RefID } });
    });
    return;
  }
  json(res, 404, { message: 'not found in fake server' });
}).listen(0);
await new Promise((resolve) => server.once('listening', resolve));
const baseURL = `http://127.0.0.1:${server.address().port}`;
// appId/apiBase giờ là credential ứng dụng ở server (resolveServerCredentials
// đọc thẳng process.env, snapshot NGAY LÚC import config/env.js) — phải set
// TRƯỚC dòng import đầu tiên bên dưới, không phải trong before().
process.env.MISA_MEINVOICE_BASE_URL = baseURL;

const { migrate, db } = await import('./db.js');
const AppSettings = await import('./services/settings.js');
const Einvoices = await import('./services/einvoice.js');
const Inv = await import('./services/inventory.js');
const Retail = await import('./services/retail.js');
const Shifts = await import('./services/shifts.js');

migrate();
const BR = 'sala';
const TAX = '0312345678';
// updateSettings THAY THẾ nguyên khối print_config mỗi lần gọi (không gộp với
// lần trước) — luôn gửi ĐỦ cả printers lẫn einvoice.issueTiming trong CÙNG một
// lệnh gọi, không tách hai lần kẻo lần sau xoá mất printers của lần trước.
const PRINTER_CFG = { printers: [{ id: 'pos80c', name: 'POS-80C', systemName: 'POS-80C',
  label: 'in bill', output: 'receipt', connection: 'system', active: true, auto: true }] };
after(() => new Promise((resolve) => server.close(resolve)));

function batMisa() {
  AppSettings.updateIntegrations({
    channels: { misa: {
      enabled: true, environment: 'sandbox', apiBase: baseURL, taxCode: TAX,
      username: 'user', password: 'x', appId: 'app', integrationType: 'MISA_API_V3',
      taxMethod: 'CREDIT_METHOD', roundingPolicy: 'PER_INVOICE', invoiceType: 'CASH_REGISTER',
      defaultTaxRate: '8', templateId: 'tpl-1', series: 'C26MBM', configurationTestPassed: true,
    } },
  }, BR);
}

function datPhatHanhKhiKetCa() {
  AppSettings.updateSettings({ print_config: { ...PRINTER_CFG, einvoice: { issueTiming: 'at_shift_close' } } }, BR);
}

function banMotDon(sku) {
  if (!Shifts.getActiveShift(BR)) {
    Shifts.openShift({ shift_key: 'morning', opening_cash: 0, cash_manual: true },
      { id: 'u1', username: 'test', name: 'Test' }, BR);
  }
  Inv.createSku({ id: sku, name: 'Hat dieu 500g', price: 108000, vat: 8, stock: 50 }, BR);
  return Retail.checkout({
    items: [{ sku_id: sku, qty: 1 }],
    payments: [{ method: 'cash', amount: 108000 }],
    branch_id: BR, cashier: 'test', device_id: 'dev_test',
  });
}

const einvOf = (orderId) => db.prepare(`SELECT * FROM e_invoices WHERE order_id=?`).get(orderId);

test('bat chinh sach at_shift_close: thanh toan XONG bill giu QUEUED_FOR_SHIFT_CLOSE, KHONG goi MISA', async () => {
  batMisa();
  datPhatHanhKhiKetCa();
  const r = banMotDon('sku_batch_1');
  const orderId = r.order_id || r.id;
  const before1 = einvOf(orderId);
  assert.equal(before1.invoice_status, 'QUEUED_FOR_SHIFT_CLOSE');

  const truoc = publishCalls;
  await Einvoices.processInvoiceQueue();
  assert.equal(publishCalls, truoc, 'worker 10s KHONG duoc dung tay vao bill dang cho ket ca');
  assert.equal(einvOf(orderId).invoice_status, 'QUEUED_FOR_SHIFT_CLOSE', 'van con giu nguyen');

  // Dong ca de test sau khong ke thua bill/ca dang mo cua test nay.
  const shift = Shifts.getActiveShift(BR);
  await Shifts.closeShift({ shift_key: shift.shift_key, closing_cash: 0, counts: {} },
    { id: 'u1', username: 'test', name: 'Test' }, BR);
});

test('ket ca: tat ca bill dang cho trong ca duoc lan luot phat hanh that + tu in phieu xac nhan', async () => {
  batMisa();
  datPhatHanhKhiKetCa();
  const r1 = banMotDon('sku_batch_2');
  const shift = Shifts.getActiveShift(BR);
  const r2 = banMotDon('sku_batch_3');
  const id1 = r1.order_id || r1.id;
  const id2 = r2.order_id || r2.id;
  assert.equal(einvOf(id1).invoice_status, 'QUEUED_FOR_SHIFT_CLOSE');
  assert.equal(einvOf(id2).invoice_status, 'QUEUED_FOR_SHIFT_CLOSE');

  const jobsBefore = db.prepare(`SELECT COUNT(*) n FROM print_jobs WHERE type='invoice_confirmation'`).get().n;
  const closeResult = await Shifts.closeShift(
    { shift_key: shift.shift_key, closing_cash: 0, counts: {} },
    { id: 'u1', username: 'quanly', name: 'Quan Ly' }, BR);

  assert.equal(closeResult.shift.status, 'closed');
  assert.equal(closeResult.einvoice_batch.released, 2);
  assert.equal(closeResult.einvoice_batch.issued, 2);
  assert.equal(closeResult.einvoice_batch.failed, 0);

  const sau1 = einvOf(id1); const sau2 = einvOf(id2);
  assert.equal(sau1.invoice_status, 'ISSUED');
  assert.ok(sau1.invoice_no, 'phai co so hoa don that tu MISA');
  assert.equal(sau2.invoice_status, 'ISSUED');
  assert.ok(sau2.invoice_no);

  // Phieu xac nhan tu dong in cho CA HAI bill vua ISSUED trong batch.
  const jobsAfter = db.prepare(`SELECT COUNT(*) n FROM print_jobs WHERE type='invoice_confirmation'`).get().n;
  assert.equal(jobsAfter - jobsBefore, 2);
});

test('chinh sach mac dinh (at_payment) khong bi anh huong boi setting at_shift_close cua nhanh khac', async () => {
  batMisa();
  AppSettings.updateSettings({ print_config: { einvoice: { issueTiming: 'at_payment' } } }, BR);
  const r = banMotDon('sku_batch_4');
  const orderId = r.order_id || r.id;
  assert.equal(einvOf(orderId).invoice_status, 'QUEUED', 'chinh sach at_payment van hoat dong nhu cu');
});
