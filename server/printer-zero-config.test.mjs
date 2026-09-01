// CẮM MÁY IN LÀ IN ĐƯỢC — không bắt khai tuyến trước.
//
// Sự cố thật (2026-07-31): thanh toán xong, hệ thống báo "đã thanh toán" nhưng
// không ra giấy, lý do "chưa cấu hình tuyến máy in" — trong khi máy POS ĐANG
// cắm máy in và agent đã báo tên máy in đó lên server.
//
// Cấu hình tuyến là tính năng NÂNG CAO cho cửa hàng nhiều máy in (bill/bếp/bar/
// tem). Cửa hàng bình thường cắm một máy in và mong nó in ngay. Bắt khai tuyến
// trước khi in được cái bill đầu tiên là chặn nhầm chỗ.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-zerocfg-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = process.env.DATA_ENCRYPTION_KEY
  || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.PRINT_DISPATCH = 'agent';

const { migrate } = await import('./db.js');
const Print = await import('./services/printing.js');
const System = await import('./services/system.js');
const AppSettings = await import('./services/settings.js');

migrate();

// Chi nhánh CHƯA AI VÀO CÀI ĐẶT IN: danh sách tuyến rỗng.
AppSettings.updateSettings({ print_config: { printers: [] } }, 'zero');

// Nhưng máy POS đang chạy app và có cắm một máy in USB.
System.setAgentPrinters('zero', [{ Name: 'POS-80C' }], {
  deviceId: 'dev_pos1', deviceName: 'POS-QUAY-1',
});

const billMau = (no) => ({
  number: no, bill_no: no, total: 120000, subtotal: 120000,
  items: [{ name: 'Hạt điều 500g', qty: 1, unit_price: 120000 }],
  lines: [{ method: 'cash', amount: 120000 }],
});

test('chua khai tuyen nao van in duoc bill', () => {
  const jobs = Print.printReceipt(billMau('Dan3107260001'), 'zero', { deviceId: 'dev_pos1' });
  assert.equal(jobs.length, 1, 'phai tao job in chu khong bo qua');
  assert.match(jobs[0].printer, /^auto:dev_pos1:POS-80C$/,
    `phai dung may in cam san o may do, dang tro: ${jobs[0].printer}`);
});

test('job tuyen ngam KHONG bi coi la mo coi va huy', () => {
  const pending = Print.pendingAgentJobs('zero', { limit: 20, deviceId: 'dev_pos1' });
  const receipt = pending.find(j => j.type === 'receipt');
  assert.ok(receipt, 'agent phai nhan duoc job — day la cho de bi huy nham nhat');
  assert.equal(receipt.systemName, 'POS-80C');
  assert.equal(receipt.connection, 'system');
  assert.equal(receipt.raw, true, 'phai gui byte ESC/POS tho, khong qua driver');
});

test('khai tuyen that thi tuyen do THANG tuyen ngam', () => {
  AppSettings.updateSettings({
    print_config: {
      printers: [{
        id: 'tuyen_bill', name: 'AP-250', systemName: 'AP-250', label: 'in bill',
        output: 'receipt', connection: 'system', active: true, auto: true,
      }],
    },
  }, 'zero');
  System.setAgentPrinters('zero', [{ Name: 'POS-80C' }, { Name: 'AP-250' }], {
    deviceId: 'dev_pos1', deviceName: 'POS-QUAY-1',
  });

  const jobs = Print.printReceipt(billMau('Dan3107260002'), 'zero', { deviceId: 'dev_pos1' });
  assert.equal(jobs[0].printer, 'tuyen_bill',
    'cau hinh cua cua hang phai duoc ton trong hon suy doan cua he thong');
});

test('may POS rut may in ra thi KHONG in mo', () => {
  AppSettings.updateSettings({ print_config: { printers: [] } }, 'zero2');
  // Agent bao len danh sach RONG = may nay khong con may in nao.
  System.setAgentPrinters('zero2', [], { deviceId: 'dev_pos9', deviceName: 'POS-KHONG-MAY-IN' });

  const jobs = Print.printReceipt(billMau('Dan3107260003'), 'zero2', { deviceId: 'dev_pos9' });
  assert.equal(jobs.length, 0, 'khong co may in nao that thi dung xep job chet');
});
