// Tuyến in phải PHÂN GIẢI THẬT theo cấu hình + theo MÁY đang thao tác.
//
// Sự cố thật ở cửa hàng (2026-07-30): thanh toán xong bill KHÔNG tự in, lịch sử
// lệnh in hiện "Hóa đơn / Tạm tính — cancelled". Nguyên nhân: mọi hook in ghi
// CỨNG id tuyến ('bill', 'kitchen', 'bar', 'label', 'runner'). Cửa hàng tự tạo
// máy in với id riêng (POS-80C / AP-250 / BEP) và xoá các tuyến mặc định, nên job
// trỏ tới id không còn tồn tại → pendingAgentJobs coi là mồ côi và huỷ.
//
// Kèm theo 3 vấn đề cùng gốc "không biết máy in thuộc máy nào":
//   - Màn Máy in báo "Sẵn sàng" khi máy POS còn chưa mở app.
//   - Ai vào được danh mục Máy in cũng thấy + in thử được máy in của máy khác.
//   - Thu ngân ở POS 2 phải chạy sang POS 1 vì bill luôn ra ở cùng một tuyến.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-rcptroute-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = process.env.DATA_ENCRYPTION_KEY
  || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
// Chế độ cửa hàng thật: server ở VPS, Hardware Agent in tại chỗ. Cũng để test
// không bao giờ gọi máy in thật.
process.env.PRINT_DISPATCH = 'agent';

const { db, migrate } = await import('./db.js');
const Print = await import('./services/printing.js');
const System = await import('./services/system.js');
const AppSettings = await import('./services/settings.js');

migrate();

// Cấu hình ĐÚNG NHƯ cửa hàng: KHÔNG có tuyến nào mang id 'bill'/'kitchen'/'label'.
// POS-80C cắm ở máy quầy 1, AP-250 cắm ở máy quầy 2, BEP là máy in bếp LAN.
AppSettings.updateSettings({
  print_config: {
    printers: [
      {
        id: 'pos80c', name: 'POS-80C', systemName: 'POS-80C', label: 'in bill',
        output: 'receipt', connection: 'system', active: true, auto: true,
      },
      {
        id: 'ap250', name: 'AP-250 Printer', systemName: 'AP-250 Printer', label: 'in bill',
        output: 'receipt', connection: 'system', active: true, auto: true,
      },
      {
        id: 'bep', name: 'BEP', systemName: '', label: 'Bếp',
        output: 'kitchen_ticket', connection: 'lan', ip: '192.168.1.50', port: 9100,
        active: true, auto: true,
      },
    ],
  },
}, 'sala');

// Hai máy POS đang chạy app: mỗi máy báo lên máy in nó đang cắm.
function haiMayPOSDangChay() {
  System.setAgentPrinters('sala', [{ Name: 'POS-80C' }], { deviceId: 'dev_pos1', deviceName: 'POS-QUAY-1' });
  System.setAgentPrinters('sala', [{ Name: 'AP-250 Printer' }], { deviceId: 'dev_pos2', deviceName: 'POS-QUAY-2' });
}

const receiptMau = (billNo) => ({
  number: billNo, bill_no: billNo, total: 90000, subtotal: 90000,
  items: [{ name: 'Trà đào', qty: 1, unit_price: 90000 }],
  lines: [{ method: 'cash', amount: 90000 }],
});

function jobsCuaBill(billNo) {
  return db.prepare(
    `SELECT id, printer, status FROM print_jobs WHERE type='receipt' AND title LIKE ?`,
  ).all(`%${billNo}%`);
}

// ── #1 Bill phải tự in — không còn job mồ côi ────────────────────────────────
test('bill ra tuyến in THẬT dù cấu hình không có tuyến nào tên "bill"', () => {
  haiMayPOSDangChay();
  const jobs = Print.printReceipt(receiptMau('Dan3007260001'), 'sala');

  assert.equal(jobs.length, 1, 'phải tạo đúng 1 job hóa đơn');
  assert.notEqual(jobs[0].printer, 'bill', 'KHÔNG được ghi cứng id "bill" nữa');
  assert.ok(['pos80c', 'ap250'].includes(jobs[0].printer),
    `phải trỏ vào tuyến receipt có thật, đang trỏ: ${jobs[0].printer}`);
});

test('job hóa đơn tới được tay agent, KHÔNG bị huỷ vì mồ côi', () => {
  const pending = Print.pendingAgentJobs('sala', { limit: 40, deviceId: 'dev_pos1' });
  const receipt = pending.find(j => j.type === 'receipt');
  assert.ok(receipt, 'agent phải nhận được job hóa đơn');

  const rows = jobsCuaBill('Dan3007260001');
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].status, 'cancelled',
    'đây chính là lỗi cũ: job hóa đơn bị chuyển cancelled nên máy in im lặng');
});

// ── #4 Mỗi máy POS in ra máy in của CHÍNH NÓ ─────────────────────────────────
test('POS 1 và POS 2 mỗi máy in ra máy in cắm vào chính nó', () => {
  haiMayPOSDangChay();

  const cuaPos1 = Print.printReceipt(receiptMau('Dan3007260002'), 'sala', { deviceId: 'dev_pos1' });
  const cuaPos2 = Print.printReceipt(receiptMau('Dan3007260003'), 'sala', { deviceId: 'dev_pos2' });

  assert.equal(cuaPos1[0].printer, 'pos80c', 'POS 1 phải in ra POS-80C cắm ở chính nó');
  assert.equal(cuaPos2[0].printer, 'ap250', 'POS 2 phải in ra AP-250 cắm ở chính nó');
  assert.notEqual(cuaPos1[0].printer, cuaPos2[0].printer,
    'hai máy KHÔNG được dồn về cùng một tuyến — đó là lý do thu ngân phải chạy qua máy kia');
});

test('máy chưa cắm máy in nào vẫn in được, không chặn bán hàng', () => {
  haiMayPOSDangChay();
  const jobs = Print.printReceipt(receiptMau('Dan3007260004'), 'sala', { deviceId: 'dev_khong_may_in' });
  assert.equal(jobs.length, 1, 'phải rơi về một tuyến receipt bất kỳ chứ không bỏ in');
  assert.ok(['pos80c', 'ap250'].includes(jobs[0].printer));
});

test('tuyến gắn sẵn trên đơn được tôn trọng, nhưng tuyến đã XOÁ thì không', () => {
  haiMayPOSDangChay();
  const gan = Print.printReceipt(
    { ...receiptMau('Dan3007260005'), linked_printer_id: 'ap250' }, 'sala', { deviceId: 'dev_pos1' });
  assert.equal(gan[0].printer, 'ap250', 'tuyến gắn sẵn phải được dùng');

  const khongCoLocal = Print.printReceipt(
    { ...receiptMau('Dan3007260005B'), linked_printer_id: 'ap250' }, 'sala', { deviceId: 'dev_khong_may_in' });
  assert.equal(khongCoLocal[0].printer, 'ap250', 'không có máy local thì mới dùng tuyến gắn sẵn');

  // Đơn cũ còn trỏ tuyến đã bị xoá khỏi cấu hình → phải phân giải lại, không mồ côi.
  const cu = Print.printReceipt(
    { ...receiptMau('Dan3007260006'), linked_printer_id: 'bill' }, 'sala', { deviceId: 'dev_pos2' });
  assert.equal(cu[0].printer, 'ap250',
    'tuyến "bill" không còn tồn tại → phải rơi về máy in của chính máy đang thanh toán');
});

test('không có tuyến hóa đơn nào thì KHÔNG xếp job chết, và nói rõ lý do', () => {
  AppSettings.updateSettings({
    print_config: {
      printers: [{
        id: 'bep', name: 'BEP', label: 'Bếp', output: 'kitchen_ticket',
        connection: 'lan', ip: '192.168.1.50', active: true,
      }],
    },
  }, 'br2');

  const jobs = Print.printReceipt(receiptMau('Dan3007260007'), 'br2');
  assert.equal(jobs.length, 0, 'không tạo job hóa đơn khi không có tuyến nào in được');

  const log = db.prepare(
    `SELECT title FROM system_logs WHERE event_type='receipt_printer_missing' ORDER BY rowid DESC LIMIT 1`).get();
  assert.ok(log, 'phải ghi nhật ký để biết vì sao bill không ra giấy');
  assert.match(log.title, /không tự in/i);
});

// ── #2 Trạng thái máy in phải là SỰ THẬT ─────────────────────────────────────
test('máy POS chưa mở app thì máy in của nó KHÔNG được báo Sẵn sàng', async () => {
  // Chi nhánh riêng để dựng đúng tình huống: CHỈ POS 1 đang chạy app, POS 2 vừa
  // bật máy nhưng chưa mở app nên agent chưa báo cáo gì.
  AppSettings.updateSettings({
    print_config: {
      printers: [
        {
          id: 'pos80c', name: 'POS-80C', systemName: 'POS-80C', label: 'in bill',
          output: 'receipt', connection: 'system', active: true, auto: true,
        },
        {
          id: 'ap250', name: 'AP-250 Printer', systemName: 'AP-250 Printer', label: 'in bill',
          output: 'receipt', connection: 'system', active: true, auto: true,
        },
      ],
    },
  }, 'br3');
  System.setAgentPrinters('br3', [{ Name: 'POS-80C' }], { deviceId: 'dev_pos1', deviceName: 'POS-QUAY-1' });

  const list = await Print.listPrinters('br3');
  const pos80 = list.find(p => p.id === 'pos80c');
  const ap250 = list.find(p => p.id === 'ap250');

  assert.equal(pos80.online, true, 'POS-80C đang có máy báo cáo → sẵn sàng');
  assert.equal(pos80.status, 'ready');

  assert.equal(ap250.online, false,
    'ĐÂY LÀ LỖI CŨ: AP-250 nằm ở máy đã tắt app mà vẫn báo online');
  assert.equal(ap250.status, 'offline');
  assert.match(ap250.statusText, /chưa mở app/i, 'phải nói rõ lý do cho người dùng');
});

test('trạng thái đúng KHÔNG cần cờ live — màn Máy in mở ra là thấy thật', async () => {
  // Trước đây thiếu live=1 thì mọi tuyến trả 'ready' vô điều kiện.
  const list = await Print.listPrinters('br3', { live: false });
  const ap250 = list.find(p => p.id === 'ap250');
  assert.equal(ap250.status, 'offline');
  assert.notEqual(ap250.statusText, 'Chưa kiểm tra live');
});

test('mỗi tuyến nói rõ đang cắm ở MÁY NÀO', async () => {
  const list = await Print.listPrinters('br3', { deviceId: 'dev_pos1' });
  const pos80 = list.find(p => p.id === 'pos80c');
  assert.equal(pos80.owner_device_id, 'dev_pos1');
  assert.equal(pos80.owner_device_name, 'POS-QUAY-1');
  assert.equal(pos80.attached_to_me, true, 'với chính máy đó thì phải nhận là của mình');
});

// ── #3 Phân quyền: chỉ thấy + thao tác máy in của máy mình ───────────────────
test('người không quản lý máy in CHỈ thấy máy in cắm vào máy của mình', async () => {
  haiMayPOSDangChay();

  const cuaPos1 = (await Print.listPrinters('sala', { deviceId: 'dev_pos1', scope: 'device' }))
    .map(p => p.id).sort();
  assert.ok(cuaPos1.includes('pos80c'), 'phải thấy máy in cắm vào chính máy mình');
  assert.ok(!cuaPos1.includes('ap250'),
    'ĐÂY LÀ RỦI RO CŨ: thu ngân POS 1 KHÔNG được thấy máy in cắm ở POS 2');

  const cuaPos2 = (await Print.listPrinters('sala', { deviceId: 'dev_pos2', scope: 'device' }))
    .map(p => p.id).sort();
  assert.ok(cuaPos2.includes('ap250'));
  assert.ok(!cuaPos2.includes('pos80c'));

  const quanLy = await Print.listPrinters('sala', { deviceId: 'dev_pos1', scope: 'all' });
  assert.equal(quanLy.length, 3, 'Quản lý/Admin vẫn thấy toàn bộ hệ thống');
});

test('danh sách thấy được KHỚP CHÍNH XÁC quyền thao tác — không có tuyến "dùng được mà không thấy"', async () => {
  haiMayPOSDangChay();
  for (const me of ['dev_pos1', 'dev_pos2']) {
    const thay = await Print.listPrinters('sala', { deviceId: me, scope: 'device' });
    const thayIds = thay.map(p => p.id).sort();

    // Mọi tuyến trong cấu hình: thao tác được <=> phải nhìn thấy.
    const thaoTacDuoc = [];
    for (const id of ['pos80c', 'ap250', 'bep']) {
      try {
        Print.assertPrinterUsableBy(id, 'sala', { privileged: false, deviceId: me });
        thaoTacDuoc.push(id);
      } catch { /* bị chặn — đúng */ }
    }
    assert.deepEqual(thayIds, thaoTacDuoc.sort(),
      `máy ${me}: danh sách hiện ra phải trùng khớp danh sách được phép bấm`);
  }
});

test('không được in thử lên máy in của máy POS khác', () => {
  haiMayPOSDangChay();

  // POS 1 thao tác máy in của chính nó: OK.
  assert.ok(Print.assertPrinterUsableBy('pos80c', 'sala', { privileged: false, deviceId: 'dev_pos1' }));

  // POS 1 với sang máy in cắm ở POS 2: chặn.
  assert.throws(
    () => Print.assertPrinterUsableBy('ap250', 'sala', { privileged: false, deviceId: 'dev_pos1' }),
    /không cắm vào máy bạn đang dùng/i);

  // Quản lý/Admin thì thao tác được từ máy nào cũng được.
  assert.ok(Print.assertPrinterUsableBy('ap250', 'sala', { privileged: true, deviceId: 'dev_pos1' }));
});

test('máy in LAN dùng chung nên máy nào cũng thao tác được', () => {
  assert.ok(Print.assertPrinterUsableBy('bep', 'sala', { privileged: false, deviceId: 'dev_pos1' }),
    'máy in bếp trên mạng không thuộc riêng máy nào');
});

test('ai được coi là người quản lý máy in', () => {
  const co = (perm) => (user, p) => p === perm;
  const khong = () => false;
  assert.equal(Print.canManagePrinters({ role: 'owner' }, khong), true, 'Admin luôn qua');
  assert.equal(Print.canManagePrinters({ role: 'manager' }, co('settings.manage')), true);
  assert.equal(Print.canManagePrinters({ role: 'cashier' }, co('settings.printers')), true,
    'được cấp riêng quyền danh mục máy in thì cũng là người quản lý');
  assert.equal(Print.canManagePrinters({ role: 'cashier' }, co('pay')), false,
    'chỉ có quyền thu tiền thì KHÔNG được thấy máy in của máy khác');
  assert.equal(Print.canManagePrinters(null, khong), false);
});

// ── "In ngay" ở chế độ agent phải đẩy lại hàng đợi, không in từ VPS ──────────
test('bấm In ngay không đánh job thành lỗi oan khi server ở VPS', async () => {
  haiMayPOSDangChay();
  const [job] = Print.printReceipt(receiptMau('Dan3007260008'), 'sala', { deviceId: 'dev_pos1' });

  // Giả lập agent đã giữ chỗ rồi chết giữa đường.
  db.prepare(`UPDATE print_jobs SET status='failed', error='mat dien', claimed_by='dev_pos1' WHERE id=?`)
    .run(job.id);

  const sau = await Print.dispatchJob(job.id, 'sala', { force: true });
  assert.equal(sau.status, 'queued',
    'server VPS không in được máy in cửa hàng → phải xếp lại cho agent, KHÔNG đánh failed');
  assert.equal(sau.error, null, 'lỗi cũ phải được xoá');

  // Bỏ giữ chỗ nên agent nhận lại được ngay.
  const pending = Print.pendingAgentJobs('sala', { limit: 40, deviceId: 'dev_pos1' });
  assert.ok(pending.some(j => j.id === job.id), 'agent phải nhận lại job ngay nhịp poll kế tiếp');
});

// ── Phiếu IN THỬ: đúng khổ giấy, không đổ JSON thô ──────────────────────────
test('phiếu in thử KHÔNG được đổ JSON cấu hình ra giấy', () => {
  haiMayPOSDangChay();
  const job = {
    type: 'test', branch_id: 'sala', title: 'In thử POS-80C',
    payload: {
      ref: 'test_1', time: '30/07/2026 11:41',
      printer: { id: 'pos80c', label: 'in bill', name: 'POS-80C', systemName: 'POS-80C', connection: 'system' },
      print_config: { bill: { storeName: 'Dan', paper: 'K80', widthMm: 72, printDensity: 'dark' } },
    },
  };
  const text = Print.renderJobText(job, 'sala');

  // Lỗi thật: giấy in ra nguyên khối {"printer":{"id":"POS 2","systemName":...}
  assert.ok(!text.includes('"systemName"'), 'không được in khoá JSON ra giấy');
  assert.ok(!text.includes('"openDrawerOnPrint"'), 'không được lộ cấu hình máy in');
  assert.ok(!/\{\s*$/m.test(text), 'không được có dấu mở ngoặc JSON đứng cuối dòng');

  // Thay vào đó phải là thông tin người đứng máy đọc được.
  assert.match(text, /PHIEU IN THU/);
  assert.match(text, /in bill/, 'phải nói rõ in từ máy in nào');
  assert.match(text, /K80/, 'phải ghi khổ giấy đang cấu hình');
  assert.match(text, /Dam/, 'phải ghi độ đậm đang dùng');
});

test('phiếu in thử trải đúng bề ngang khổ giấy đã cấu hình', () => {
  const job = {
    type: 'test', branch_id: 'sala', title: 'x',
    payload: { printer: { id: 'pos80c', label: 'in bill' },
      print_config: { bill: { paper: 'K80', widthMm: 72 } } },
  };
  const rows = Print.renderJobText(job, 'sala').split('\n');

  // Giấy 80mm in được 72mm → 48 ký tự/dòng (font A). Không dòng nào được vượt.
  const W = 48;
  const qua = rows.filter(r => r.length > W);
  assert.equal(qua.length, 0,
    `không dòng nào được dài hơn ${W} ký tự, đang lỗi: ${JSON.stringify(qua.slice(0, 3))}`);

  // Phải có vạch thước đúng bằng bề ngang để đối chiếu với mép giấy thật.
  assert.ok(rows.some(r => r.length === W && /^[.|]+$/.test(r)),
    'phải có vạch thước dài đúng bằng bề ngang giấy');
});

test('khổ giấy nhỏ K58 thì phiếu in thử co lại theo', () => {
  AppSettings.updateSettings({ print_config: { bill: { paper: 'K58', widthMm: 48 } } }, 'br4');
  const job = { type: 'test', branch_id: 'br4', title: 'x', payload: { printer: { id: 'x' } } };
  const rows = Print.renderJobText(job, 'br4').split('\n');
  assert.equal(rows.filter(r => r.length > 32).length, 0,
    'giấy 58mm chỉ in được 32 ký tự/dòng — không dòng nào được vượt');
});

test('các phiếu khác cũng không đổ JSON thô nữa', () => {
  const job = {
    type: 'inventory_document', branch_id: 'sala', title: 'Phiếu kho PK001',
    payload: { ref: 'PK001', note: 'Nhập hàng', secret_field: 'KHONG_DUOC_IN' },
  };
  const text = Print.renderJobText(job, 'sala');
  assert.ok(!text.includes('secret_field'), 'không được đổ nguyên payload ra giấy');
  assert.ok(!text.includes('KHONG_DUOC_IN'));
  assert.match(text, /PK001/, 'nhưng vẫn phải in các trường có ý nghĩa');
  assert.match(text, /Nhap hang/, 'ghi chú vẫn phải in (đã bỏ dấu cho máy in nhiệt)');
});

// ── Độ đậm + đường in RAW cho máy in nhiệt ──────────────────────────────────
test('độ đậm mặc định là "dam" — trước đây bỏ trống nên bản in rất mờ', () => {
  const cfg = AppSettings.getPrintConfig('sala');
  assert.equal(cfg.bill.printDensity, 'dark',
    'thiếu mặc định thì densityPrefix() nhận chuỗi rỗng và không gửi lệnh làm đậm nào');
});

test('máy in nhiệt nhận cờ RAW; máy in A4 báo cáo thì KHÔNG', () => {
  AppSettings.updateSettings({
    print_config: {
      printers: [
        { id: 'nhiet', systemName: 'POS-80C', label: 'Bill', output: 'receipt',
          connection: 'system', active: true },
        { id: 'a4', systemName: 'HP LaserJet', label: 'Báo cáo A4', output: 'report',
          connection: 'system', active: true },
      ],
    },
  }, 'br5');
  System.setAgentPrinters('br5', [{ Name: 'POS-80C' }, { Name: 'HP LaserJet' }],
    { deviceId: 'dev_x', deviceName: 'MAY-X' });

  db.prepare(`INSERT INTO print_jobs (id,branch_id,printer,type,title,payload_json,status,created_at)
    VALUES (?,?,?,?,?,?,'queued',?)`).run('pj_nhiet', 'br5', 'nhiet', 'test', 'x', '{}', new Date().toISOString());
  db.prepare(`INSERT INTO print_jobs (id,branch_id,printer,type,title,payload_json,status,created_at)
    VALUES (?,?,?,?,?,?,'queued',?)`).run('pj_a4', 'br5', 'a4', 'inventory_document', 'x', '{}', new Date().toISOString());

  const jobs = Print.pendingAgentJobs('br5', { limit: 40, deviceId: 'dev_x' });
  const nhiet = jobs.find(j => j.id === 'pj_nhiet');
  const a4 = jobs.find(j => j.id === 'pj_a4');

  assert.equal(nhiet.raw, true,
    'máy in nhiệt phải nhận nguyên byte ESC/POS, nếu qua driver Windows thì chữ rất mờ');
  assert.equal(nhiet.density, 'dark', 'độ đậm phải được gửi kèm cho agent');
  assert.equal(a4.raw, false,
    'máy in A4 phải giữ đường driver — bắn ESC/POS vào máy laser sẽ ra ký tự rác');
});

// ── Cùng một lỗi mồ côi ở bếp / tem / runner ─────────────────────────────────
test('phiếu bếp cũng không còn mồ côi khi tuyến không tên "kitchen"', () => {
  const order = { id: 'o_test', table_code: 'A1', bill_no: 'Dan3007260009' };
  Print.printKitchenTickets(order, [{ name: 'Phở', qty: 1, station: 'kitchen' }], 'sala', 'Thu ngân');

  const rows = db.prepare(
    `SELECT printer, status FROM print_jobs WHERE type='kitchen_ticket'`).all();
  assert.ok(rows.length > 0, 'phải tạo được phiếu bếp');
  assert.ok(rows.every(r => r.printer === 'bep'),
    `phiếu bếp phải trỏ tuyến "bep" có thật, đang trỏ: ${rows.map(r => r.printer).join(',')}`);
});

test('món ở trạm bar rơi về máy in bếp khi chưa có tuyến bar riêng', () => {
  db.prepare(`DELETE FROM print_jobs WHERE type='kitchen_ticket'`).run();
  Print.printKitchenTickets({ id: 'o_bar', table_code: 'B2' },
    [{ name: 'Cà phê', qty: 1, station: 'bar' }], 'sala', '');

  const rows = db.prepare(`SELECT printer FROM print_jobs WHERE type='kitchen_ticket'`).all();
  assert.ok(rows.length > 0, 'không được im lặng bỏ món bar');
  assert.ok(rows.every(r => r.printer === 'bep'));
});

test('hàng retail không tạo phiếu hoặc tem bếp', () => {
  db.prepare(`DELETE FROM print_jobs WHERE type IN ('kitchen_ticket','cup_label')`).run();
  const retail = [{ name: 'Bánh đóng gói', qty: 2, station: 'retail', status: 'served' }];

  Print.printKitchenTickets({ id: 'o_retail', channel: 'retail' }, retail, 'sala', 'Thu ngân');
  Print.printCupLabels({ id: 'o_retail', channel: 'takeaway' }, retail, 'sala');

  const count = db.prepare(
    `SELECT COUNT(*) n FROM print_jobs WHERE type IN ('kitchen_ticket','cup_label')`).get().n;
  assert.equal(count, 0);
});
