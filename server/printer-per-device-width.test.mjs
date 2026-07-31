// KHỔ GIẤY THEO TỪNG MÁY IN, KHÔNG THEO CHI NHÁNH.
//
// Cửa hàng có máy POS để bàn dùng giấy K80 (48 ký tự) và máy POS cầm tay Sunmi
// V2 có đầu in 58mm gắn liền (32 ký tự) — CÙNG một chi nhánh. Bề ngang trước đây
// chỉ đọc từ cấu hình chi nhánh, nên phiếu in ở máy cầm tay dựng 48 ký tự rồi
// tràn khỏi mép giấy.
//
// Máy nào tự khai bề ngang thì server dựng theo con số đó; máy không khai (máy in
// Windows qua Hardware Agent) vẫn theo cấu hình chi nhánh như cũ.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-perdev-'));
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

// Chi nhánh cấu hình K80 cho máy để bàn, và CHƯA khai tuyến in nào.
AppSettings.updateSettings({
  print_config: { bill: { paper: 'K80', widthMm: 80 }, printers: [] },
}, 'ch');

// Máy để bàn: Hardware Agent Windows, KHÔNG khai bề ngang.
System.setAgentPrinters('ch', [{ Name: 'POS-80C' }], {
  deviceId: 'dev_ban', deviceName: 'POS-DE-BAN',
});
// Máy cầm tay Sunmi: app tu khai 58mm.
System.setAgentPrinters('ch', [{ Name: 'May in tich hop', widthMm: 58 }], {
  deviceId: 'dev_camtay', deviceName: 'SUNMI-V2',
});

const bill = (no) => ({
  number: no, total: 90000, subtotal: 90000,
  items: [{ name: 'Hat dieu rang muoi 500g', qty: 1, unit_price: 90000 }],
  lines: [{ method: 'cash', amount: 90000 }],
});

function beNgang(deviceId, soHoaDon, chiNhanh = 'ch') {
  Print.printReceipt(bill(soHoaDon), chiNhanh, { deviceId });
  const jobs = Print.pendingAgentJobs(chiNhanh, { limit: 10, deviceId });
  const j = jobs.find(x => x.type === 'receipt');
  assert.ok(j, `may ${deviceId} phai nhan duoc phieu`);
  return Math.max(...j.text.split('\n').map(l => l.length));
}

test('may cam tay Sunmi dung 32 ky tu, KHONG tran giay 58mm', () => {
  const w = beNgang('dev_camtay', 'Dan0108260001');
  assert.ok(w <= 32,
    `giay 58mm chi in duoc 32 ky tu, dang dung ${w} — chu se tran khoi mep`);
});

test('may de ban VAN theo cau hinh chi nhanh K80 = 48 ky tu', () => {
  const w = beNgang('dev_ban', 'Dan0108260002');
  assert.ok(w > 32 && w <= 48,
    `may de ban phai giu K80 (48 ky tu), dang dung ${w}`);
});

test('hai may cung chi nhanh ra hai be ngang KHAC NHAU', () => {
  const camTay = beNgang('dev_camtay', 'Dan0108260003');
  const deBan = beNgang('dev_ban', 'Dan0108260004');
  assert.notEqual(camTay, deBan,
    'day chinh la loi cu: mot be ngang dung chung cho ca hai loai may');
});

test('may KHONG khai be ngang thi theo chi nhanh, khong doan bua', () => {
  AppSettings.updateSettings({
    print_config: { bill: { paper: 'K57', widthMm: 57 }, printers: [] },
  }, 'ch2');
  System.setAgentPrinters('ch2', [{ Name: 'POS-80C' }], { deviceId: 'dev_x' });
  const w = beNgang('dev_x', 'Dan0108260005', 'ch2');
  assert.ok(w <= 32, 'chi nhanh khai K57 thi may khong khai gi phai theo K57');
});
