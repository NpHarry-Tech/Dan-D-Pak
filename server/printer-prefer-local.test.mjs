// MÁY IN CẮM VÀO CHÍNH MÁY ĐANG THAO TÁC ĐƯỢC ƯU TIÊN TRƯỚC.
//
// Tình huống thật: cửa hàng đã khai một tuyến hóa đơn cho máy in ngoài quầy.
// Nhân viên cầm máy POS cầm tay (Sunmi V2, có đầu in gắn liền) đi thu tiền tại
// bàn. Bill phải in NGAY TRÊN TAY khách — không phải chạy ra máy in ngoài quầy
// rồi nhân viên đi bộ ra lấy.
//
// Máy in gắn liền KHÔNG BAO GIỜ nằm trong print_config: nó do agent trong app báo
// lên. Nên nếu xét tuyến đã khai trước, máy cầm tay luôn thua và bill luôn ra
// nhầm chỗ.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-preflocal-'));
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

// Cửa hàng ĐÃ KHAI một tuyến hóa đơn: máy in ngoài quầy.
AppSettings.updateSettings({
  print_config: {
    bill: { paper: 'K80', widthMm: 80 },
    printers: [{
      id: 'quay', name: 'POS-80C', systemName: 'POS-80C', label: 'May in quay',
      output: 'receipt', connection: 'system', active: true, auto: true,
    }],
  },
}, 'ch');

// Máy để bàn ngoài quầy: cắm đúng cái máy in đã khai.
System.setAgentPrinters('ch', [{ Name: 'POS-80C' }], {
  deviceId: 'dev_quay', deviceName: 'POS-QUAY',
});
// Máy POS cầm tay: đầu in gắn liền, KHÔNG nằm trong print_config.
System.setAgentPrinters('ch', [{ Name: 'May in tich hop', widthMm: 58 }], {
  deviceId: 'dev_camtay', deviceName: 'SUNMI-V2',
});

test('may cam tay in RA CHINH NO, khong chay ra may in ngoai quay', () => {
  const p = Print.resolveReceiptPrinter('ch', { deviceId: 'dev_camtay' });
  assert.ok(p, 'phai tim duoc may in');
  assert.equal(p.systemName, 'May in tich hop',
    `bill dang chay ra "${p.systemName}" — nhan vien phai di bo ra quay lay`);
});

test('may de ban VAN dung tuyen da khai cua no', () => {
  const p = Print.resolveReceiptPrinter('ch', { deviceId: 'dev_quay' });
  assert.equal(p.id, 'quay',
    'tuyen da khai mang them thiet lap (ket tien, do dam) nen phai duoc ton trong');
});

test('may la khong co may in thi dung tuyen chung, khong bo in', () => {
  const p = Print.resolveReceiptPrinter('ch', { deviceId: 'dev_khong_co' });
  assert.ok(p, 'khong duoc bo in chi vi may do khong cam may in');
  assert.equal(p.id, 'quay');
});

test('tuyen khai DICH DANH cho may cam tay thi thang tuyen ngam', () => {
  AppSettings.updateSettings({
    print_config: {
      bill: { paper: 'K80' },
      printers: [{
        id: 'rieng', name: 'MAY RIENG', systemName: 'MAY RIENG',
        output: 'receipt', connection: 'lan', ip: '192.168.1.9',
        active: true, primaryDeviceId: 'dev_ct2',
      }],
    },
  }, 'ch2');
  System.setAgentPrinters('ch2', [{ Name: 'May in tich hop', widthMm: 58 }], {
    deviceId: 'dev_ct2',
  });
  const p = Print.resolveReceiptPrinter('ch2', { deviceId: 'dev_ct2' });
  // Máy in cắm sẵn vẫn thắng: người khai primaryDeviceId là muốn tuyến đó cho
  // máy đó, nhưng máy đó ĐANG CÓ đầu in gắn liền — in tại chỗ vẫn đúng ý hơn.
  // Ghi lại lựa chọn này để sau có ai đổi ý thì biết nó là cố ý.
  assert.equal(p.systemName, 'May in tich hop');
});
