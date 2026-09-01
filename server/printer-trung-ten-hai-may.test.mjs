// HAI MÁY IN TRÙNG TÊN Ở HAI MÁY KHÁC NHAU.
//
// SỰ CỐ THẬT (04/08/2026, chi nhánh Vietfoods): cửa hàng có HAI máy in cùng tên
// Windows "POS-80C" — một cắm ở laptop DOF-09, một cắm ở máy POS dưới quầy.
// Khai tuyến mới tên 'test' trỏ máy in của DOF-09:
//   - IN THỬ  -> ra đúng máy in của DOF-09  (vì in thử gọi thẳng theo id tuyến)
//   - IN BILL -> lại ra máy in DƯỚI QUẦY    (SAI)
//
// Nguyên nhân: định tuyến ghép máy in với máy tính bằng TÊN MÁY IN. Hai máy in
// trùng tên thì cả hai tuyến đều "khớp" với cả hai máy tính, và tuyến nào đứng
// trước trong cấu hình thì thắng. Tên máy in KHÔNG phải định danh duy nhất —
// Windows cho đặt trùng thoải mái, và cửa hàng mua hai máy cùng model thì mặc
// định y hệt nhau.
//
// Định danh duy nhất phải là (MÃ THIẾT BỊ, tên máy in). Mã thiết bị do app gửi
// lên trong x-device-id và đã được lưu sẵn ở sổ đăng ký agent — chỉ tầng định
// tuyến là chưa dùng tới.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-trungten-'));
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

const BR = 'vietfoods';
const MAY_QUAY = 'dev_pos_quay';
const MAY_DOF09 = 'dev_dof09';

/// Dựng đúng cảnh cửa hàng: hai tuyến hoá đơn, CÙNG tên máy in "POS-80C",
/// nhưng gắn vào hai máy tính khác nhau.
function dungCuaHang() {
  AppSettings.updateSettings({
    print_config: {
      bill: { storeName: 'Vietfoods' },
      printers: [
        // Tuyến cũ dưới quầy — đứng TRƯỚC trong danh sách.
        {
          id: 'pos80c', label: 'POS 80C quầy', systemName: 'POS-80C',
          output: 'receipt', connection: 'system', active: true,
          primaryDeviceId: MAY_QUAY,
        },
        // Tuyến mới khai từ laptop DOF-09, máy in cũng tên "POS-80C".
        {
          id: 'test', label: 'test', systemName: 'POS-80C',
          output: 'receipt', connection: 'system', active: true,
          primaryDeviceId: MAY_DOF09,
        },
      ],
    },
  }, BR);

  System.setAgentPrinters(BR, [{ Name: 'POS-80C' }],
    { deviceId: MAY_QUAY, deviceName: 'POS-QUAY' });
  System.setAgentPrinters(BR, [{ Name: 'POS-80C' }],
    { deviceId: MAY_DOF09, deviceName: 'DOF-09' });
}

const bill = (so) => ({
  number: so, bill_no: so, total: 50000, subtotal: 50000,
  items: [{ name: 'Hat dieu', qty: 1, unit_price: 50000 }],
});

test('BILL in tu DOF-09 phai ra may in CUA DOF-09, khong nhay ve quay', () => {
  dungCuaHang();
  const jobs = Print.printReceipt(bill('HD001'), BR, { deviceId: MAY_DOF09 });
  assert.equal(jobs.length, 1, 'phai tao duoc lenh in');
  assert.equal(jobs[0].printer, 'test',
    'day chinh la loi bao ve: bill tu DOF-09 lai chay ve tuyen cua quay');
});

test('BILL in tu may QUAY van ra may in cua quay', () => {
  dungCuaHang();
  const jobs = Print.printReceipt(bill('HD002'), BR, { deviceId: MAY_QUAY });
  assert.equal(jobs[0].printer, 'pos80c');
});

test('TAM TINH cung phai theo dung may dang thao tac', () => {
  dungCuaHang();
  const jobs = Print.printReceipt(
    { ...bill('HD003'), preview: true }, BR, { deviceId: MAY_DOF09 });
  assert.equal(jobs[0].printer, 'test');
});

test('chuoi du phong cua DOF-09 dat may in CUA NO len dau', () => {
  dungCuaHang();
  const chuoi = Print.resolvePrinterChain('receipt', BR, { deviceId: MAY_DOF09 });
  assert.equal(chuoi[0].id, 'test',
    'may in cam thang vao may dang thao tac phai duoc thu truoc');
  // May in cua QUAY van nam trong chuoi — de khi may in cua DOF-09 hong thi
  // bill van ra giay o cho khac, khong tac ban hang.
  assert.ok(chuoi.some(p => p.id === 'pos80c'),
    'tuyen con lai van phai nam trong chuoi du phong');
});

test('agent cua QUAY khong duoc nhan job cua tuyen DOF-09', () => {
  dungCuaHang();
  const jobs = Print.printReceipt(bill('HD004'), BR, { deviceId: MAY_DOF09 });
  const id = jobs[0].id;

  const cuaQuay = Print.pendingAgentJobs(BR, { deviceId: MAY_QUAY });
  assert.ok(!cuaQuay.some(j => j.id === id),
    'may quay khong duoc keo job cua may khac ve in');

  const cuaDof = Print.pendingAgentJobs(BR, { deviceId: MAY_DOF09 });
  assert.ok(cuaDof.some(j => j.id === id),
    'may DOF-09 phai nhan duoc job cua chinh no');
});

test('tuyen KHONG khai may chu tri van chay nhu cu (cua hang mot may in)', () => {
  // Khong duoc bat cua hang nho phai khai gi them — ho chi co mot may in.
  const BR2 = 'motmayin';
  AppSettings.updateSettings({
    print_config: {
      printers: [{
        id: 'bill', systemName: 'IN-BILL', output: 'receipt',
        connection: 'system', active: true,
      }],
    },
  }, BR2);
  System.setAgentPrinters(BR2, [{ Name: 'IN-BILL' }],
    { deviceId: 'dev_mot', deviceName: 'POS' });

  const jobs = Print.printReceipt(bill('HD005'), BR2, { deviceId: 'dev_mot' });
  assert.equal(jobs[0].printer, 'bill');
});
