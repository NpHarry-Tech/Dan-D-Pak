// NÚT "IN NGAY" PHẢI CHẠY ĐƯỢC VỚI TUYẾN IN NGẦM.
//
// Sự cố thật (2026-08-01, máy POS cầm tay): thanh toán xong màn bán báo "Đã thu
// tiền, nhưng chưa in được: Chưa cấu hình tuyến máy in auto:dev_...", trong khi
// IN THỬ vẫn tốt. Máy in gắn liền của máy cầm tay chưa ai khai tuyến, nên bill
// đi vào TUYẾN NGẦM 'auto:<device>:<tên máy in>'. Vòng quét hàng đợi và
// resolveAgentJobFast đã biết dựng lại tuyến đó, nhưng dispatchJob (đường mà
// /print/jobs/:id/print gọi — chính là nút app bấm ngay sau thanh toán) thì
// chưa: nó chỉ tra print_config nên luôn ném "chưa cấu hình".
//
// In thử không dính vì in thử luôn chọn từ danh sách tuyến ĐÃ KHAI.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-printnow-'));
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

// Cửa hàng chưa khai tuyến in nào; máy cầm tay có máy in gắn liền.
AppSettings.updateSettings({ print_config: { printers: [] } }, 'cam');
System.setAgentPrinters('cam', [{ Name: 'InnerPrinter' }], {
  deviceId: 'dev_sunmi', deviceName: 'SUNMI-V2',
});

const bill = {
  number: 'HD001', bill_no: 'HD001', total: 99000, subtotal: 99000,
  items: [{ name: 'Hat dieu 500g', qty: 1, unit_price: 99000 }],
};

test('in ngay ngay sau thanh toan KHONG con bao "chua cau hinh tuyen"', async () => {
  const jobs = Print.printReceipt(bill, 'cam', { deviceId: 'dev_sunmi' });
  assert.ok(jobs.length > 0, 'phai tao duoc lenh in bill');
  const job = jobs[0];
  assert.ok(String(job.printer).startsWith('auto:'),
    `phai la tuyen ngam, dang la ${job.printer}`);

  // Đây chính là đường /api/print/jobs/:id/print mà app gọi sau thanh toán.
  const sau = await Print.dispatchJob(job.id, 'cam', { force: true });
  assert.equal(sau.status, 'queued',
    'phai day lai hang doi cho agent tai cho in, khong duoc nem loi');
  assert.equal(sau.error, null);
});

test('tuyen ngam cua MAY KHAC van bi tu choi, khong in mo', async () => {
  // Máy in không còn được máy nào báo lên → tuyến ngầm không dựng lại được.
  System.setAgentPrinters('cam', [], {
    deviceId: 'dev_sunmi', deviceName: 'SUNMI-V2',
  });
  const jobs = Print.printReceipt({ ...bill, bill_no: 'HD002', number: 'HD002' },
    'cam', { deviceId: 'dev_sunmi' });
  if (!jobs.length) return; // khong con tuyen nao -> khong tao job, cung dung
  await assert.rejects(
    () => Print.dispatchJob(jobs[0].id, 'cam', { force: true }),
    /Chưa cấu hình tuyến máy in/,
  );
});
