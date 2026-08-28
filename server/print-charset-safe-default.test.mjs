// MẶC ĐỊNH AN TOÀN CHO BẢNG MÃ MÁY IN.
//
// SỰ CỐ THẬT (04/08/2026): sau khi đổi mặc định sang UTF-8 để "đồng bộ tiếng
// Việt có dấu", bill in ra ở cửa hàng biến mọi chữ có dấu thành Ô HÌNH KIM
// CƯƠNG. Chữ latinh bình thường thì vẫn đúng.
//
// Bài học: máy in nhiệt phổ thông KHÔNG có sẵn phông tiếng Việt. Máy in gắn
// liền của máy POS cầm tay (Sunmi) đọc được UTF-8 nhưng đó là NGOẠI LỆ, không
// phải mặt bằng chung. Mặc định phải là phương án KHÔNG BAO GIỜ HỎNG (bỏ dấu —
// vẫn đọc được), còn chữ có dấu là thứ bật thêm cho ĐÚNG tuyến in đã kiểm chứng
// bằng nút In thử.
//
// Nội dung phiếu vẫn dựng bằng tiếng Việt có dấu; việc bỏ dấu nằm ở bước MÃ HOÁ
// nên tuyến nào khai UTF-8 vẫn ra chữ có dấu, không phải dựng lại hai bản.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-charset-'));
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

function dungKho(branch, printer = {}) {
  AppSettings.updateSettings({
    print_config: {
      bill: { storeName: 'Dan D Pak' },
      printers: [{
        id: 'p1', systemName: 'P1', output: 'receipt', connection: 'system',
        active: true, primaryDeviceId: `dev_${branch}`, ...printer,
      }],
    },
  }, branch);
  System.setAgentPrinters(branch, [{ Name: 'P1' }],
    { deviceId: `dev_${branch}`, deviceName: 'POS' });
}

const bill = () => ({
  number: 'HD001', bill_no: 'HD001', total: 99000, subtotal: 99000,
  items: [{ name: 'Hat dieu 500g', qty: 1, unit_price: 99000 }],
});

function jobBill(branch) {
  Print.printReceipt(bill(), branch, { deviceId: `dev_${branch}` });
  const j = Print.pendingAgentJobs(branch, { deviceId: `dev_${branch}` })
    .find(x => x.type === 'receipt');
  assert.ok(j, 'phai co job hoa don');
  return j;
}

test('tuyen chua khai gi thi BO DAU — khong bao gio ra o kim cuong', () => {
  dungKho('cs_auto');
  assert.equal(jobBill('cs_auto').charset, 'ascii');
});

test('khai ro UTF-8 thi ton trong — may in doc duoc dau van co dau', () => {
  dungKho('cs_utf8', { charset: 'utf8' });
  assert.equal(jobBill('cs_utf8').charset, 'utf8');
});

test('khai CP1258 cho may in doi cu cung ton trong', () => {
  dungKho('cs_1258', { charset: 'cp1258' });
  assert.equal(jobBill('cs_1258').charset, 'cp1258');
});

test('co chu mac dinh cao gap doi — co chuan cua may in nhiet qua nho de doc', () => {
  // Chi nhan BE CAO nen so cot giu nguyen, bo cuc cot tien khong doi.
  dungKho('cs_scale');
  assert.equal(jobBill('cs_scale').fontScale, 1);
});

test('noi dung phieu VAN giu dau — bo dau la viec cua buoc ma hoa', () => {
  dungKho('cs_noidung');
  const j = jobBill('cs_noidung');
  assert.match(j.text, /HÓA ĐƠN THANH TOÁN/,
    'server phai dung mot ban noi dung duy nhat, co dau');
});

test('ca ba duong in deu quy auto ve ascii, khong noi nao tu chon utf8', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const server = readFileSync(join(here, 'services', 'printing.js'), 'utf8');
  // Chot chan: doi mac dinh nay lan nua la lap lai su co bill ra o kim cuong.
  assert.match(server, /cs === 'auto' \? 'ascii' : cs/,
    "charsetOf() phai quy 'auto' ve 'ascii'");
  const dart = readFileSync(join(here, '..', 'flutter-apps', 'dandpak_core', 'lib',
    'src', 'services', 'local_print_agent.dart'), 'utf8');
  assert.match(dart, /charset == 'ascii'/,
    'agent trong app phai biet bo dau khi server yeu cau');
});
