// FAILOVER thiết bị C (không cắm máy in): khi MỌI máy in bill đều CÓ CHỦ (cắm
// vào máy khác / primaryDeviceId), thiết bị không có máy in nào PHẢI trả bill về
// máy in ƯU TIÊN (đầu chuỗi) thay vì báo "receipt_printer_missing".
// (Khác printer-prefer-local: ở đó máy in KHÔNG có chủ nên resolve trả thẳng.)
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'ddp-rcpt-fb-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.RELEASES_DIR = join(temp, 'releases');
process.env.DATA_ENCRYPTION_KEY = process.env.DATA_ENCRYPTION_KEY
  || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.PRINT_DISPATCH = 'agent';

const { migrate } = await import('./db.js');
const Print = await import('./services/printing.js');
const System = await import('./services/system.js');
const AppSettings = await import('./services/settings.js');
migrate();

// Máy in bill AP-250 CÓ CHỦ = thiết bị dev_a (giống ảnh user: cắm vào DESKTOP khác).
AppSettings.updateSettings({
  print_config: {
    bill: { paper: 'K80', widthMm: 80 },
    printers: [{
      id: 'billA', name: 'AP-250', systemName: 'AP-250', label: 'May in bill A',
      output: 'receipt', connection: 'system', active: true, auto: true,
      primaryDeviceId: 'dev_a',
    }],
  },
}, 'ch');
System.setAgentPrinters('ch', [{ Name: 'AP-250' }], { deviceId: 'dev_a', deviceName: 'DESKTOP-A' });

test('resolveReceiptPrinter cho thiet bi C (khong may in) tra NULL (may in CO CHU)', () => {
  const p = Print.resolveReceiptPrinter('ch', { deviceId: 'dev_c' });
  assert.equal(p, null, 'may in co chu nen khong chon truc tiep cho thiet bi khac');
});

test('printReceipt: thiet bi C VAN in duoc (tra ve may in uu tien qua chuoi)', () => {
  const jobs = Print.printReceipt(
    { number: 'B1', bill_no: 'Dan140826001', total: 50000, items: [] },
    'ch', { deviceId: 'dev_c' });
  assert.ok(jobs.length > 0, 'thiet bi C phai in duoc, khong bo in');
  assert.equal(jobs[0].printer, 'billA', 'bill phai ve may in uu tien billA');
});

test('thiet bi CO may in rieng ma thieu tuyen thi KHONG gianh may khac', () => {
  // dev_b co may in rieng "POS-B" nhung KHONG khai tuyen receipt cho no.
  System.setAgentPrinters('ch', [{ Name: 'POS-B' }], { deviceId: 'dev_b', deviceName: 'DESKTOP-B' });
  // dev_b co may in cam san -> resolve tra chinh may do (tuyen ngam), khong phai billA.
  const p = Print.resolveReceiptPrinter('ch', { deviceId: 'dev_b' });
  assert.ok(p, 'may co may in cam san thi in ra chinh no');
  assert.notEqual(p.id, 'billA', 'khong duoc gianh may in cua thiet bi khac');
});
