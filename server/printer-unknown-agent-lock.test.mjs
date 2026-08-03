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

test('may chu tri offline thi may khac cung ten KHONG duoc tiep quan', async () => {
  AppSettings.updateSettings({
    print_config: {
      printers: [{
        id: 'handy_2', name: 'May in tich hop', systemName: 'May in tich hop',
        label: 'Handy 2', output: 'receipt', connection: 'system', active: true,
        primaryDeviceId: 'dev_handy_2',
      }],
    },
  }, 'br10');
  System.setAgentPrinters('br10', [{ Name: 'May in tich hop' }], {
    deviceId: 'dev_handy_1', deviceName: 'Handy 1',
  });

  const job = await Print.testPrinter('handy_2', 'br10');
  const jobs = Print.pendingAgentJobs('br10', { limit: 10, deviceId: 'dev_handy_1' });
  assert.ok(!jobs.some(j => j.id === job.id),
    'Handy 2 tat thi phieu phai cho Handy 2, khong duoc chay sang Handy 1');
});

test('tuyen system chua gan thiet bi thi tu choi in thu thay vi in bua', async () => {
  AppSettings.updateSettings({
    print_config: {
      printers: [{
        id: 'handy_chua_gan', name: 'May in tich hop', systemName: 'May in tich hop',
        label: 'Handy chua gan', output: 'receipt', connection: 'system', active: true,
      }],
    },
  }, 'br11');
  await assert.rejects(() => Print.testPrinter('handy_chua_gan', 'br11'),
    /chưa gắn với thiết bị cụ thể/i);
});

test('may khac khong duoc bao ket qua thay may dang giu job', async () => {
  AppSettings.updateSettings({
    print_config: {
      printers: [{
        id: 'handy_claim', name: 'May in tich hop', systemName: 'May in tich hop',
        output: 'receipt', connection: 'system', active: true,
        primaryDeviceId: 'dev_claim_1',
      }],
    },
  }, 'br12');
  System.setAgentPrinters('br12', [{ Name: 'May in tich hop' }], {
    deviceId: 'dev_claim_1', deviceName: 'Handy claim 1',
  });
  const queued = await Print.testPrinter('handy_claim', 'br12');
  const jobs = Print.pendingAgentJobs('br12', { limit: 10, deviceId: 'dev_claim_1' });
  assert.ok(jobs.some(j => j.id === queued.id));
  assert.throws(
    () => Print.agentReportResult(queued.id, 'br12', { ok: true, deviceId: 'dev_claim_2' }),
    /không giữ chỗ lệnh in/i,
  );
});

test('thanh toan tren MAY CAM TAY thi in tren may in CUA NO, khong dinh gi toi POS 1/POS 2',
    () => {
  // Day la yeu cau go gon cua chu cua hang: "toi thanh toan tren handy thi in
  // tren may in tren handy, chu lien quan gi POS 1 va POS 2".
  // POS 1 va POS 2 la may in cua hai may de ban — chung PHAI duoc giu nguyen cho
  // hai may do, va cung khong duoc gianh bill cua may cam tay.
  Print.printReceipt(bill('Dan0108260104'), 'sala', { deviceId: 'dev_camtay' });
  const jobs = Print.pendingAgentJobs('sala', { limit: 10, deviceId: 'dev_camtay' });
  const r = jobs.find(j => j.type === 'receipt');
  assert.ok(r, 'may cam tay phai nhan duoc phieu cua chinh no');
  assert.equal(r.systemName, 'May in tich hop',
    `bill dang chay ra "${r.systemName}" — phai ra may in gan lien cua may cam tay`);
});
