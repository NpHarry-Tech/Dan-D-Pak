// BA HÀNH VI GIỮ CHO BILL LUÔN RA GIẤY ĐÚNG LÚC, ĐÚNG CHỖ.
//
// Cả ba đều là sự cố thật báo về ngày 04/08/2026 từ cửa hàng:
//
// 1. CHUYỂN TUYẾN DỰ PHÒNG — máy in đầu hỏng thì phiếu phải tự sang máy kế
//    tiếp. Trước đây job nằm 'failed' rồi quay lại đúng cái máy đang hỏng, cửa
//    hàng có 2-3 máy in mà không ra nổi một tờ.
//
// 2. PHIẾU QUÁ HẠN — bill kéo lúc 12:52 đêm mà máy in tắt thì SÁNG HÔM SAU vừa
//    mở app là nó tự chui ra. Phiếu bán hàng có tính thời điểm; quá hạn phải
//    gỡ khỏi hàng đợi, không in muộn.
//
// 3. BẢNG MÃ + CỠ CHỮ — server phải nói cho agent biết in bằng bảng mã nào và
//    cỡ chữ nào, để máy in Windows, máy in LAN và máy in gắn liền trên máy cầm
//    tay ra CÙNG một kiểu chữ (trước đây mỗi đường tự quyết → chỗ có dấu chỗ
//    không).
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-failover-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = process.env.DATA_ENCRYPTION_KEY
  || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.PRINT_DISPATCH = 'agent';

const { migrate, db } = await import('./db.js');
const Print = await import('./services/printing.js');
const System = await import('./services/system.js');
const AppSettings = await import('./services/settings.js');

migrate();

const bill = () => ({
  number: 'HD001', bill_no: 'HD001', total: 99000, subtotal: 99000,
  items: [{ name: 'Hat dieu 500g', qty: 1, unit_price: 99000 }],
});

// ── 1. Chuyển tuyến dự phòng ────────────────────────────────────────────────
test('may in dau hong thi phieu tu sang may ke tiep theo thu tu uu tien', async () => {
  const BR = 'failover';
  AppSettings.updateSettings({
    print_config: {
      printers: [
        { id: 'quay1', systemName: 'QUAY-1', output: 'receipt', connection: 'system', active: true, priority: 1 },
        { id: 'quay2', systemName: 'QUAY-2', output: 'receipt', connection: 'system', active: true, priority: 2 },
        { id: 'quay3', systemName: 'QUAY-3', output: 'receipt', connection: 'system', active: true, priority: 3 },
      ],
    },
  }, BR);
  // Một máy POS thấy cả ba máy in (VD ba máy in cùng cắm vào máy đó).
  System.setAgentPrinters(BR, [{ Name: 'QUAY-1' }, { Name: 'QUAY-2' }, { Name: 'QUAY-3' }],
    { deviceId: 'dev1', deviceName: 'POS-1' });

  const chuoi = Print.resolvePrinterChain('receipt', BR, { deviceId: 'dev1' });
  assert.deepEqual(chuoi.map(p => p.id), ['quay1', 'quay2', 'quay3'],
    'chuoi phai xep theo priority');

  const jobs = Print.printReceipt(bill(), BR, { deviceId: 'dev1' });
  const id = jobs[0].id;
  assert.equal(Print.getJob(id).printer, 'quay1');

  // Agent báo hỏng: lần đầu chỉ ghi lỗi, chưa vội đổi máy (có thể kẹt giấy tạm).
  Print.agentReportResult(id, BR, { ok: false, error: 'het giay', deviceId: 'dev1' });
  assert.equal(Print.getJob(id).printer, 'quay1', 'mot lan hong chua doi may');
  assert.equal(Print.getJob(id).status, 'failed');

  // Lần thứ hai thì kết luận máy đó không dùng được → sang máy 2, và job phải
  // quay lại hàng đợi chứ không nằm 'failed'.
  Print.agentReportResult(id, BR, { ok: false, error: 'het giay', deviceId: 'dev1' });
  assert.equal(Print.getJob(id).printer, 'quay2', 'phai chuyen sang may in ke tiep');
  assert.equal(Print.getJob(id).status, 'queued');
  assert.equal(Print.getJob(id).error, null);

  // Máy 2 cũng hỏng → sang máy 3.
  Print.agentReportResult(id, BR, { ok: false, error: 'mat ket noi', deviceId: 'dev1' });
  Print.agentReportResult(id, BR, { ok: false, error: 'mat ket noi', deviceId: 'dev1' });
  assert.equal(Print.getJob(id).printer, 'quay3');

  // Hết chuỗi thì dừng ở 'failed' — không quay vòng vô tận về máy đầu.
  Print.agentReportResult(id, BR, { ok: false, error: 'hong', deviceId: 'dev1' });
  Print.agentReportResult(id, BR, { ok: false, error: 'hong', deviceId: 'dev1' });
  assert.equal(Print.getJob(id).printer, 'quay3', 'het chuoi thi dung lai');
  assert.equal(Print.getJob(id).status, 'failed');
});

test('may in cam tai cho luon dung dau chuoi, bat ke so uu tien', () => {
  const BR = 'failover_local';
  AppSettings.updateSettings({
    print_config: {
      printers: [
        { id: 'lan_quay', output: 'receipt', connection: 'lan', ip: '10.0.0.9', active: true, priority: 1 },
        { id: 'tai_cho', systemName: 'IN-TAI-CHO', output: 'receipt', connection: 'system', active: true, priority: 9 },
      ],
    },
  }, BR);
  System.setAgentPrinters(BR, [{ Name: 'IN-TAI-CHO' }], { deviceId: 'dev_cam', deviceName: 'SUNMI' });

  const chuoi = Print.resolvePrinterChain('receipt', BR, { deviceId: 'dev_cam' });
  assert.equal(chuoi[0].id, 'tai_cho',
    'may in cam vao chinh may dang thao tac phai duoc thu truoc');
  assert.ok(chuoi.some(p => p.id === 'lan_quay'), 'may in LAN van nam trong chuoi du phong');
});

// ── 2. Phiếu quá hạn ────────────────────────────────────────────────────────
test('bill de qua dem KHONG tu in vao sang hom sau', () => {
  const BR = 'qua_han';
  AppSettings.updateSettings({ print_config: { printers: [] } }, BR);
  System.setAgentPrinters(BR, [{ Name: 'InnerPrinter' }],
    { deviceId: 'dev_dem', deviceName: 'SUNMI-V2' });

  const jobs = Print.printReceipt(bill(), BR, { deviceId: 'dev_dem' });
  const id = jobs[0].id;

  // Chưa quá hạn thì agent vẫn nhận được.
  assert.ok(Print.pendingAgentJobs(BR, { deviceId: 'dev_dem' }).some(j => j.id === id));

  // Đẩy ngày tạo lùi 10 tiếng — đúng cảnh bill kéo lúc nửa đêm, sáng mới mở máy.
  const cu = new Date(Date.now() - 10 * 3600_000).toISOString();
  db.prepare('UPDATE print_jobs SET created_at=?, claimed_by=NULL, claimed_at=NULL WHERE id=?')
    .run(cu, id);

  const conLai = Print.pendingAgentJobs(BR, { deviceId: 'dev_dem' });
  assert.ok(!conLai.some(j => j.id === id), 'phieu qua han khong duoc phat cho agent');
  assert.equal(Print.getJob(id).status, 'expired');
  assert.match(Print.getJob(id).error, /quá hạn/i);
});

test('IN THU khong bao gio qua han — nguoi dung dang dung cho to giay', async () => {
  const BR = 'qua_han_thu';
  AppSettings.updateSettings({
    print_config: {
      printers: [{
        id: 'p1', systemName: 'P1', output: 'receipt', connection: 'system',
        active: true, primaryDeviceId: 'dev_thu',
      }],
    },
  }, BR);
  System.setAgentPrinters(BR, [{ Name: 'P1' }], { deviceId: 'dev_thu', deviceName: 'POS' });

  const job = await Print.testPrinter('p1', BR);
  db.prepare('UPDATE print_jobs SET created_at=? WHERE id=?')
    .run(new Date(Date.now() - 48 * 3600_000).toISOString(), job.id);

  assert.ok(Print.pendingAgentJobs(BR, { deviceId: 'dev_thu' }).some(j => j.id === job.id),
    'in thu phai in duoc du tao tu lau');
});

// ── 3. Bảng mã + cỡ chữ đi cùng job ─────────────────────────────────────────
test('server noi ro bang ma va co chu cho agent; MAC DINH LA BO DAU, co chu chuan', () => {
  const BR = 'kieu_chu';
  AppSettings.updateSettings({
    print_config: {
      bill: { storeName: 'Dan D Pak' },
      printers: [{
        id: 'p1', systemName: 'P1', output: 'receipt', connection: 'system',
        active: true, primaryDeviceId: 'dev_kc',
      }],
    },
  }, BR);
  System.setAgentPrinters(BR, [{ Name: 'P1' }], { deviceId: 'dev_kc', deviceName: 'POS' });

  Print.printReceipt(bill(), BR, { deviceId: 'dev_kc' });
  const job = Print.pendingAgentJobs(BR, { deviceId: 'dev_kc' })
    .find(j => j.type === 'receipt');
  assert.ok(job, 'phai co job hoa don');
  // MAC DINH PHAI AN TOAN. May in nhiet pho thong khong co phong tieng Viet;
  // gui UTF-8 xuong la moi chu co dau in ra mot o hinh kim cuong (su co that
  // 04/08/2026). Chu khong dau van doc duoc, con o kim cuong thi khong.
  assert.equal(job.charset, 'ascii', "'auto' phai quy ve ascii cho an toan");
  assert.equal(job.fontScale, 1, 'mac dinh cao gap doi cho de doc o quay');

  // NOI DUNG van giu nguyen dau — viec bo dau do buoc ma hoa lam, tuy theo bang
  // ma cua tung may in. Nho vay tuyen nao doc duoc UTF-8 thi van co dau.
  assert.match(job.text, /HÓA ĐƠN THANH TOÁN/);
});

test('tuyen khai bang ma rieng thi job mang dung bang ma do', () => {
  const BR = 'kieu_chu_cu';
  AppSettings.updateSettings({
    print_config: {
      bill: { storeName: 'Dan D Pak', fontScale: 0 },
      printers: [{
        id: 'p1', systemName: 'P1', output: 'receipt', connection: 'system',
        active: true, primaryDeviceId: 'dev_cu', charset: 'cp1258',
      }],
    },
  }, BR);
  System.setAgentPrinters(BR, [{ Name: 'P1' }], { deviceId: 'dev_cu', deviceName: 'POS' });

  Print.printReceipt(bill(), BR, { deviceId: 'dev_cu' });
  const job = Print.pendingAgentJobs(BR, { deviceId: 'dev_cu' })
    .find(j => j.type === 'receipt');
  assert.equal(job.charset, 'cp1258');
  assert.equal(job.fontScale, 0, 'cua hang chon co chu chuan thi ton trong');
});

test('TEM khong bi phong to — tem 50mm chu cao gap doi la tran mep', () => {
  const BR = 'tem_co_chu';
  AppSettings.updateSettings({
    print_config: {
      bill: { storeName: 'Dan D Pak', fontScale: 2 },
      labels: { widthMm: 50 },
      printers: [{
        id: 'tem', systemName: 'TEM', output: 'product_label', connection: 'system',
        active: true, primaryDeviceId: 'dev_tem',
      }],
    },
  }, BR);
  System.setAgentPrinters(BR, [{ Name: 'TEM' }], { deviceId: 'dev_tem', deviceName: 'POS' });

  Print.printProductLabel(BR, { sku: { name: 'Hat dieu', barcode: '123' } });
  const job = Print.pendingAgentJobs(BR, { deviceId: 'dev_tem' })
    .find(j => j.type === 'product_label');
  assert.ok(job, 'phai co job tem');
  assert.equal(job.fontScale, 0, 'tem giu nguyen co chu du bill dang phong to');
});

// ── 4. In lại ra ở MÁY ĐANG BẤM ─────────────────────────────────────────────
test('IN LAI dinh tuyen theo may dang bam, khong sao chep tuyen ban goc', () => {
  const BR = 'in_lai';
  AppSettings.updateSettings({ print_config: { printers: [] } }, BR);
  // Bill gốc in ở máy cầm tay.
  System.setAgentPrinters(BR, [{ Name: 'InnerPrinter' }],
    { deviceId: 'dev_cam', deviceName: 'SUNMI' });
  const goc = Print.printReceipt(bill(), BR, { deviceId: 'dev_cam' })[0];
  assert.match(String(goc.printer), /^auto:dev_cam:/);

  // Thu ngân đứng ở quầy (máy khác, máy in khác) bấm In lại.
  System.setAgentPrinters(BR, [{ Name: 'QUAY-80C' }],
    { deviceId: 'dev_quay', deviceName: 'POS-QUAY' });
  const lai = Print.reprint(goc.id, BR, { deviceId: 'dev_quay' });
  assert.match(String(lai.printer), /^auto:dev_quay:/,
    'in lai phai ra o may dang bam, khong gui ve may cam tay');
});
