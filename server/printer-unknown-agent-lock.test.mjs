// AGENT KHÔNG ĐỊNH DANH KHÔNG ĐƯỢC KHOÁ TUYẾN IN.
//
// Sự cố thật tại chi nhánh sala ngày 2026-08-01: thanh toán xong báo "đã thanh
// toán" nhưng giấy không ra, phiếu nằm ở trạng thái queued không ai nhận.
//
// Chuỗi nguyên nhân:
//   1. Agent bản cũ trên máy POS Windows KHÔNG gửi định danh máy.
//   2. Server gom nó vào khoá giữ chỗ 'agent-khong-dinh-danh' (system.js).
//   3. Cả hai tuyến hóa đơn của chi nhánh đều mang primaryDeviceId là khoá đó.
//   4. Luật "máy chủ trì" thấy khoá đó ĐANG ONLINE nên CHẶN mọi máy khác nhận
//      phiếu — kể cả máy POS cầm tay đang đứng trước mặt khách.
//   5. Còn chính agent cũ thì in hỏng (Out-Printer, "Settings to access printer
//      'POS-80C' are not valid").
//
// Kết quả: không máy nào in được, mà cũng không ai báo lỗi ra màn hình.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-unknownlock-'));
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

// Dựng ĐÚNG cấu hình của chi nhánh sala: hai tuyến hóa đơn, cả hai đều bị khoá
// vào máy không định danh.
AppSettings.updateSettings({
  print_config: {
    bill: { paper: 'K80', widthMm: 72 },
    printers: [
      {
        id: 'POS 2', name: 'POS-80C', systemName: 'POS-80C', label: 'in bill',
        output: 'receipt', connection: 'system', active: true, auto: true,
        primaryDeviceId: 'agent-khong-dinh-danh',
      },
      {
        id: 'POS 1', name: 'AP-250 Printer', systemName: 'AP-250 Printer',
        output: 'receipt', connection: 'system', active: true, auto: true,
        primaryDeviceId: 'agent-khong-dinh-danh',
      },
    ],
  },
}, 'sala');

// Agent CŨ đang chạy: không gửi device id nên rơi vào khoá giữ chỗ.
System.setAgentPrinters('sala', [{ Name: 'POS-80C' }], { deviceId: '' });
// Máy POS cầm tay đang đứng trước mặt khách, có đầu in gắn liền.
System.setAgentPrinters('sala', [{ Name: 'May in tich hop', widthMm: 58 }], {
  deviceId: 'dev_camtay', deviceName: 'SUNMI-V2',
});

const bill = (no) => ({
  number: no, total: 90000, subtotal: 90000,
  items: [{ name: 'Hat dieu', qty: 1, unit_price: 90000 }],
  lines: [{ method: 'cash', amount: 90000 }],
});

test('may cam tay VAN nhan duoc phieu du tuyen bi khoa vao may khong dinh danh',
    () => {
  Print.printReceipt(bill('Dan0108260101'), 'sala', { deviceId: 'dev_camtay' });
  const jobs = Print.pendingAgentJobs('sala', { limit: 10, deviceId: 'dev_camtay' });
  const r = jobs.find(j => j.type === 'receipt');
  assert.ok(r,
    'day chinh la loi: phieu nam queued mai vi mot may KHONG TON TAI dang giu tuyen');
});

test('may KHONG dinh danh van in duoc binh thuong', () => {
  Print.printReceipt(bill('Dan0108260102'), 'sala', { deviceId: '' });
  const jobs = Print.pendingAgentJobs('sala', { limit: 10, deviceId: '' });
  assert.ok(jobs.some(j => j.type === 'receipt'),
    'sua loi nay khong duoc lam agent cu het in');
});

test('may chu tri THAT van khoa duoc tuyen cua no', () => {
  AppSettings.updateSettings({
    print_config: {
      bill: { paper: 'K80' },
      printers: [{
        id: 'rieng', name: 'POS-80C', systemName: 'POS-80C',
        output: 'receipt', connection: 'system', active: true,
        primaryDeviceId: 'dev_chutri',
      }],
    },
  }, 'br9');
  System.setAgentPrinters('br9', [{ Name: 'POS-80C' }], { deviceId: 'dev_chutri' });
  System.setAgentPrinters('br9', [{ Name: 'POS-80C' }], { deviceId: 'dev_khac' });

  Print.printReceipt(bill('Dan0108260103'), 'br9', { deviceId: 'dev_chutri' });
  const cuaKhac = Print.pendingAgentJobs('br9', { limit: 10, deviceId: 'dev_khac' });
  assert.ok(!cuaKhac.some(j => j.type === 'receipt'),
    'may chu tri that dang online thi may khac KHONG duoc gianh — chong in trung');
});
