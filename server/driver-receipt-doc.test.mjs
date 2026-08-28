// WindowsDriverBackend: máy in bill đặt renderMode='driver' phải nhận SEMANTIC
// DOC (font TrueType) để agent Windows in qua GDI — KHÔNG in ảnh tầng app. Máy
// in ESC/POS bình thường KHÔNG được dính driverDoc. IN THỬ (type 'test') trên
// máy driver dùng bill mẫu để so sánh font.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'ddp-drv-doc-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.PRINT_DISPATCH = 'agent';
process.env.DATA_ENCRYPTION_KEY = process.env.DATA_ENCRYPTION_KEY
  || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const { migrate } = await import('./db.js');
const Print = await import('./services/printing.js');
const System = await import('./services/system.js');
const AppSettings = await import('./services/settings.js');
const { buildReceiptDoc, sampleReceiptPayload } = await import('./services/receipt_doc.js');
migrate();

test('buildReceiptDoc: có header + bảng món + TỔNG CỘNG, dữ liệu đúng', () => {
  const doc = buildReceiptDoc({
    company: { name: 'DAN D PAK' },
    bill_no: 'Dan140826001', cashier: 'Huy',
    items: [{ name: 'Cà phê', qty: 2, unit_price: 25000, vat_rate: 8 }],
    total: 50000, vat_amount: 3704, goods_amount: 46296,
    lines: [{ method: 'cash', amount: 50000 }], paid: 50000,
  }, { bill: {} });
  assert.equal(doc.font, 'Segoe UI');
  const flat = JSON.stringify(doc.blocks);
  assert.match(flat, /DAN D PAK/);
  assert.match(flat, /HÓA ĐƠN THANH TOÁN/);
  assert.match(flat, /Cà phê/);
  assert.match(flat, /TỔNG CỘNG/);
  // Phải có block 'row' (bảng cột) — đây là điểm khác in-ảnh: cấu trúc, không phải bitmap.
  assert.ok(doc.blocks.some((b) => b.type === 'row'), 'phải có row cột');
  // Tiếng Việt GIỮ NGUYÊN DẤU (không ascii()).
  assert.ok(flat.includes('Cà phê'), 'không được bỏ dấu');
});

// Chi nhánh + máy in driver.
AppSettings.updateSettings({
  print_config: {
    bill: { paper: 'K80', widthMm: 80 },
    printers: [
      { id: 'billDrv', name: 'K80', systemName: 'K80', output: 'receipt',
        connection: 'system', active: true, auto: true, primaryDeviceId: 'dev_a',
        renderMode: 'driver', driverFont: 'Roboto' },
      { id: 'kitchen', name: 'BEP', systemName: 'BEP', output: 'kitchen_ticket',
        connection: 'system', active: true, auto: true, primaryDeviceId: 'dev_a',
        renderMode: 'driver' },   // renderMode driver nhưng KHÔNG phải receipt
    ],
  },
}, 'sala');
System.setAgentPrinters('sala', [{ Name: 'K80' }, { Name: 'BEP' }],
  { deviceId: 'dev_a', deviceName: 'DESKTOP-A' });

test('config lưu renderMode + driverFont', () => {
  const cfg = AppSettings.getPrintConfig('sala');
  const drv = cfg.printers.find((p) => p.id === 'billDrv');
  assert.equal(drv.renderMode, 'driver');
  assert.equal(drv.driverFont, 'Roboto');
});

test('receipt trên máy driver → pendingAgentJobs trả driverDoc (không phải ảnh)', () => {
  const job = Print.createJob({
    printer: 'billDrv', type: 'receipt', title: 'Bill',
    payload: { company: { name: 'DAN D PAK' }, bill_no: 'B1', items: [
      { name: 'Trà đào cam sả', qty: 1, unit_price: 35000, vat_rate: 8 }],
      total: 35000, lines: [{ method: 'cash', amount: 35000 }], paid: 35000 },
    branch_id: 'sala',
  });
  const j = Print.pendingAgentJobs('sala', { deviceId: 'dev_a' }).find((x) => x.id === job.id);
  assert.ok(j, 'job phải có trong pending');
  assert.equal(j.renderMode, 'driver');
  assert.equal(j.driverFont, 'Roboto');
  assert.ok(j.driverDoc, 'phải có semantic doc');
  const doc = JSON.parse(j.driverDoc);
  assert.match(JSON.stringify(doc.blocks), /Trà đào cam sả/);
  // Doc là CẤU TRÚC, không phải ảnh — không có trường base64/png.
  assert.ok(!j.rawB64 && !JSON.stringify(j).includes('data:image'), 'tuyệt đối không in ảnh');
});

test('phiếu bếp trên máy driver → driverDoc font LỚN qua GDI (khong phai anh)', () => {
  const job = Print.createJob({
    printer: 'kitchen', type: 'kitchen_ticket', title: 'Bep',
    payload: { zone: 'Bếp', table: 'A1', seq: '01',
      items: [{ name: 'Phở bò tái', qty: 2, note: 'ít hành' }] },
    branch_id: 'sala',
  });
  const j = Print.pendingAgentJobs('sala', { deviceId: 'dev_a' }).find((x) => x.id === job.id);
  assert.ok(j, 'job bếp phải có trong pending');
  assert.equal(j.renderMode, 'driver', 'phiếu bếp đi luồng driver');
  assert.ok(j.driverDoc, 'phiếu bếp driver phải có semantic doc');
  const doc = JSON.parse(j.driverDoc);
  const flat = JSON.stringify(doc.blocks);
  assert.match(flat, /Phở bò tái/);
  assert.match(flat, /BÀN A1/);
  // Tên món cỡ LỚN (>=18pt) — điểm khác ESC/POS (bị giới hạn 2x).
  assert.ok(doc.blocks.some((b) => b.type === 'row' && (b.cols || []).some((c) => (c.size || 0) >= 18)),
    'tên món phải cỡ lớn');
  assert.ok(j.text && j.text.length > 0, 'vẫn có text ESC/POS fallback');
});

test('IN THỬ (test) trên máy driver → bill mẫu để so sánh font', () => {
  const job = Print.createJob({
    printer: 'billDrv', type: 'test', title: 'In thu',
    payload: { ref: 'test1' }, branch_id: 'sala',
  });
  const j = Print.pendingAgentJobs('sala', { deviceId: 'dev_a' }).find((x) => x.id === job.id);
  assert.ok(j.driverDoc, 'in thử driver phải có doc mẫu');
  assert.match(JSON.stringify(JSON.parse(j.driverDoc).blocks), /Cà phê sữa đá/);
});

test('sampleReceiptPayload có món tên dài để thử xuống dòng', () => {
  const p = sampleReceiptPayload();
  assert.ok(p.items.some((i) => i.name.length > 20), 'phải có tên món dài');
});
