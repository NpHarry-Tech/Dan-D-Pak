// NGÀY GIỜ TRÊN GIẤY IN PHẢI LÀ GIỜ CỬA HÀNG, KHÔNG PHẢI GIỜ MÁY CHỦ.
//
// Sự cố thật (2026-08-03): phiếu in thử ghi "19:08 2/8" trong khi đồng hồ cửa
// hàng là "02:08 3/8" — lệch 7 tiếng VÀ sai luôn ngày. Nguyên nhân: container
// trên VPS không đặt TZ nên chạy UTC, mà nhiều chỗ dựng giờ bằng
// `new Date().toLocaleString('vi-VN')` / `getHours()` — hai hàm đó lấy GIỜ MÁY
// rồi gắn nhãn như giờ Việt Nam.
//
// Test này ÉP TZ=UTC để tái lập đúng môi trường VPS. Đặt TZ trong
// docker-compose là cần, nhưng chưa đủ: code phải đúng kể cả khi biến đó bị
// mất hoặc chạy ở máy khác.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

process.env.TZ = 'UTC'; // GIỐNG HỆT container VPS khi chưa đặt múi giờ

const temp = mkdtempSync(join(tmpdir(), 'dandpak-tz-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = process.env.DATA_ENCRYPTION_KEY
  || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.PRINT_DISPATCH = 'agent';

const { migrate } = await import('./db.js');
const Print = await import('./services/printing.js');
const System = await import('./services/system.js');
const AppSettings = await import('./services/settings.js');
const { localInvDate } = await import('./services/misa/payload.js');

migrate();

const BR = 'sala';
System.setAgentPrinters(BR, [{ Name: 'P1' }, { Name: 'P2' }], { deviceId: 'd1', deviceName: 'M1' });
AppSettings.updateSettings({
  print_config: {
    printers: [{
      id: 'p1', connection: 'system', systemName: 'P1', output: 'receipt',
      active: true, auto: true, label: 'May in 1', primaryDeviceId: 'd1',
    }, {
      id: 'p2', connection: 'system', systemName: 'P2', output: 'kitchen_ticket',
      active: true, auto: true, label: 'May bep', primaryDeviceId: 'd1',
    }],
  },
}, BR);

/// Giờ Việt Nam thật sự, tính độc lập với code đang test.
function gioVN(value = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(value)).map((x) => [x.type, x.value]));
  return { date: `${p.day}/${p.month}/${p.year}`, time: `${p.hour}:${p.minute}` };
}

// Bill thanh toán 10:30 giờ VN ngày 01/08/2026 (= 03:30 UTC cùng ngày).
const PAID = '2026-08-01T03:30:00.000Z';
const billMau = () => ({
  number: 'HD777', bill_no: 'HD777', total: 108000,
  paid_at: PAID, created_at: PAID,
  items: [{ name: 'Hat dieu', qty: 1, unit_price: 108000, vat_rate: 8 }],
});

test('IN THU: lay dung gio CUA HANG tai luc in, khong phai gio UTC', async () => {
  const job = await Print.testPrinter('p1', BR);
  const text = Print.renderJobText(Print.getJob(job.id));
  // Phieu in thu nay in tieng Viet CO DAU nhu moi phieu khac.
  const dong = text.split('\n').find((l) => /Th[oờ]i gian/i.test(l));
  assert.ok(dong, 'phieu in thu phai co dong Thoi gian');

  const vn = gioVN();
  assert.ok(dong.includes(vn.date),
    `phai ghi NGAY cua hang ${vn.date}, dang ghi: ${dong.trim()}`);
  // Chỉ so giờ (phút có thể nhảy giữa hai lời gọi).
  assert.ok(dong.includes(vn.time.slice(0, 2)),
    `phai ghi GIO cua hang ${vn.time}, dang ghi: ${dong.trim()}`);
});

test('BILL IN LAI: giu NGUYEN gio ra hoa don goc, khong lay gio in lai', () => {
  const jobs = Print.printReceipt(billMau(), BR, { deviceId: 'd1' });
  const goc = Print.renderJobText(Print.getJob(jobs[0].id));

  const lai = Print.reprint(jobs[0].id, BR);
  const inLai = Print.renderJobText(Print.getJob(lai.id));

  const vnGoc = gioVN(PAID); // 01/08/2026 10:30
  assert.equal(vnGoc.date, '01/08/2026');
  assert.equal(vnGoc.time, '10:30');

  for (const [ten, txt] of [['bill goc', goc], ['bill in lai', inLai]]) {
    assert.ok(txt.includes('01.08.2026 10.30'),
      `${ten} phai ghi gio ra hoa don 01.08.2026 10.30`);
    // Và TUYỆT ĐỐI không được mang ngày hôm nay.
    const homNay = gioVN().date.replaceAll('/', '.');
    if (homNay !== '01.08.2026') {
      assert.ok(!txt.includes(`Ngay/Gio ra: ${homNay}`),
        `${ten} khong duoc lay gio in lai lam gio hoa don`);
    }
  }
});

test('NGAY HOA DON MISA: bill 00:10 gio VN thuoc NGAY MOI, khong lui mot ngay', () => {
  // 00:10 ngày 03/08 giờ VN = 17:10 ngày 02/08 UTC. Lấy theo giờ máy (UTC) là
  // hóa đơn rơi về ngày 02/08 → sai kỳ kê khai thuế.
  assert.equal(localInvDate('2026-08-02T17:10:00.000Z'), '2026-08-03T00:10:00');
  // 23:50 ngày 02/08 giờ VN = 16:50 cùng ngày UTC — vẫn phải là 02/08.
  assert.equal(localInvDate('2026-08-02T16:50:00.000Z'), '2026-08-02T23:50:00');
});

test('PHIEU BEP: payload va noi dung deu ghi gio Viet Nam khi server chay UTC', () => {
  Print.printKitchenTickets(
    { id: 'ord_tz_kitchen', table_code: 'A01', pay_ref: 'Dan260826001' },
    [{ name: 'Phở', qty: 1, station: 'kitchen' }], BR, 'Bếp', { deviceId: 'd1' },
  );
  const job = Print.listJobs(BR, 20).find((x) => x.type === 'kitchen_ticket'
    && x.payload?.order_id === 'ord_tz_kitchen');
  assert.ok(job, 'phải tạo được phiếu bếp');
  const vn = gioVN();
  assert.equal(job.payload.date, vn.date);
  assert.equal(job.payload.time.slice(0, 2), vn.time.slice(0, 2));
  const text = Print.renderJobText(job);
  assert.ok(text.includes(vn.date), `phiếu bếp phải có ngày VN ${vn.date}`);
});

test('KHONG con cho nao dung gio may de dung ngay gio in', async () => {
  // Chốt chặn cho lần sau: `toLocaleString/toLocaleTimeString/toLocaleDateString`
  // trên một Date là lấy GIỜ MÁY. Chỉ được phép dùng cho định dạng SỐ TIỀN.
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('./services/printing.js', import.meta.url), 'utf8');
  const viPham = src.split('\n')
    .map((dong, i) => [i + 1, dong])
    // Bỏ qua dòng chú thích — chính chỗ giải thích lỗi này cũng nhắc tên hàm đó.
    .filter(([, dong]) => !/^\s*(\/\/|\*|\/\*)/.test(dong))
    .filter(([, dong]) => /(?:new Date\([^)]*\)|\b(?:now|date|d))\.toLocale(Time|Date)?String/.test(dong));
  assert.deepEqual(viPham, [],
    `Cac dong sau lay gio MAY CHU de in, phai doi sang vietnamParts():\n${
      viPham.map(([n, d]) => `  dong ${n}: ${d.trim()}`).join('\n')}`);
});
