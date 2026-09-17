// KITCHEN-ROUTING-05: trạm chế biến là entity theo chi nhánh (production_stations),
// và máy in phiếu bếp khai RÕ (những) trạm nào nó nhận job (printer.stations) thay
// vì chỉ có bản đồ cứng 'kitchen'/'bar'. Test này chứng minh printKitchenTickets
// thật sự dùng đúng cấu hình đó: món của trạm nào chỉ ra đúng máy của trạm đó, đơn
// hỗn hợp gom đúng 1 ticket cho mỗi (máy, trạm), không trùng/lặp món.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

process.env.SQLITE_PATH = join(mkdtempSync(join(tmpdir(), 'ddp-kstation-')), 'store.db');
process.env.STORAGE_PATH = join(tmpdir(), 'kstation-store');
process.env.PRINT_DISPATCH = 'agent';

const { db, migrate } = await import('./db.js');
const Print = await import('./services/printing.js');
const AppSettings = await import('./services/settings.js');

migrate();

const BR = 'kstation';

// Hai trạm tự đặt (không nằm trong bản đồ cứng cũ 'kitchen'/'salad'/'bar'/'beverage')
// — đúng kịch bản một quán tự tạo "Quầy nước" / "Bếp nóng" qua Cài đặt.
AppSettings.updateSettings({
  print_config: {
    printers: [
      {
        id: 'may_quay_nuoc', name: 'Máy quầy nước', systemName: 'Máy quầy nước',
        label: 'Phiếu bar', output: 'kitchen_ticket', connection: 'system',
        active: true, auto: true, stations: ['quay_nuoc'],
      },
      {
        id: 'may_bep_nong', name: 'Máy bếp nóng', systemName: 'Máy bếp nóng',
        label: 'Phiếu bếp', output: 'kitchen_ticket', connection: 'system',
        active: true, auto: true, stations: ['bep_nong'],
      },
    ],
  },
}, BR);

function jobsFor(printer) {
  return db.prepare(
    `SELECT * FROM print_jobs WHERE branch_id=? AND printer=? AND type='kitchen_ticket' ORDER BY created_at`,
  ).all(BR, printer);
}

test('món nước chỉ tới máy quầy nước, món nóng chỉ tới bếp nóng', () => {
  const order = { id: 'o_test1', table_code: 'A01', bill_no: 'Dan_test1', zone: 'Tầng trệt' };
  const items = [
    { id: 'oi1', name: 'Trà đào cam sả', qty: 2, station: 'quay_nuoc' },
    { id: 'oi2', name: 'Mì Bò Kho Việt Nam', qty: 1, station: 'bep_nong' },
  ];
  Print.printKitchenTickets(order, items, BR, 'tester');

  const nuoc = jobsFor('may_quay_nuoc');
  const bep = jobsFor('may_bep_nong');
  assert.equal(nuoc.length, 1, 'phải có đúng 1 job trên máy quầy nước');
  assert.equal(bep.length, 1, 'phải có đúng 1 job trên máy bếp nóng');

  const nuocPayload = JSON.parse(nuoc[0].payload_json);
  const bepPayload = JSON.parse(bep[0].payload_json);
  assert.equal(nuocPayload.items.length, 1);
  assert.equal(nuocPayload.items[0].name, 'Trà đào cam sả');
  assert.equal(bepPayload.items.length, 1);
  assert.equal(bepPayload.items[0].name, 'Mì Bò Kho Việt Nam');
});

test('đơn hỗn hợp: 2 món cùng trạm gộp vào 1 ticket, khác trạm tách riêng, không trùng món', () => {
  const order = { id: 'o_test2', table_code: 'A02', bill_no: 'Dan_test2', zone: 'Tầng trệt' };
  const items = [
    { id: 'oi3', name: 'Trà đào cam sả', qty: 1, station: 'quay_nuoc' },
    { id: 'oi4', name: 'Nước ép cam', qty: 1, station: 'quay_nuoc' },
    { id: 'oi5', name: 'Mì Bò Kho Việt Nam', qty: 1, station: 'bep_nong' },
  ];
  Print.printKitchenTickets(order, items, BR, 'tester');

  // Cộng dồn với test trước (mỗi máy có thêm đúng 1 job mới).
  const nuoc = jobsFor('may_quay_nuoc');
  const bep = jobsFor('may_bep_nong');
  assert.equal(nuoc.length, 2);
  assert.equal(bep.length, 2);

  const latestNuoc = JSON.parse(nuoc[nuoc.length - 1].payload_json);
  const latestBep = JSON.parse(bep[bep.length - 1].payload_json);
  assert.equal(latestNuoc.items.length, 2, 'hai món cùng trạm phải gộp vào đúng 1 ticket');
  assert.deepEqual(latestNuoc.items.map(i => i.name).sort(),
    ['Nước ép cam', 'Trà đào cam sả']);
  assert.equal(latestBep.items.length, 1);
  assert.equal(latestBep.items[0].name, 'Mì Bò Kho Việt Nam');
});

// SỰ CỐ THẬT báo 17/09/2026: máy in phiếu bếp khai stations:['kitchen'] (CHỈ
// nhận trạm Bếp) vẫn nhận luôn phiếu trạm Bar khi cửa hàng chưa khai máy in
// riêng cho Bar — vì bước rơi-về cũ lọc theo `output` (loại phiếu) mà không hề
// biết tới `stations`, nên một máy đã tự giới hạn cho trạm KHÁC vẫn lọt qua làm
// "máy dùng chung". Đúng ra phải báo lỗi rõ ràng (không có máy cho trạm Bar),
// không được lặng lẽ in nhầm sang máy Bếp.
test('máy in đã khai riêng cho Bếp KHÔNG được nhận job của Bar khi chưa có máy Bar', () => {
  const BR2 = 'kstation_excl';
  AppSettings.updateSettings({
    print_config: {
      printers: [
        {
          id: 'may_bep_rieng', name: 'Máy bếp', systemName: 'Máy bếp',
          label: 'Phiếu bếp', output: 'kitchen_ticket', connection: 'system',
          active: true, auto: true, stations: ['kitchen'],
        },
      ],
    },
  }, BR2);

  const order = { id: 'o_test3', table_code: 'A03', bill_no: 'Dan_test3', zone: 'Tầng trệt' };
  const items = [
    { id: 'oi6', name: 'Bia Sài Gòn', qty: 2, station: 'bar' },
  ];
  Print.printKitchenTickets(order, items, BR2, 'tester');

  const bepJobs = db.prepare(
    `SELECT * FROM print_jobs WHERE branch_id=? AND printer=? AND type='kitchen_ticket'`,
  ).all(BR2, 'may_bep_rieng');
  assert.equal(bepJobs.length, 0,
    'máy đã tự giới hạn cho trạm Bếp không được lặng lẽ in phiếu của trạm Bar');

  const anyJob = db.prepare(
    `SELECT COUNT(*) n FROM print_jobs WHERE branch_id=? AND type='kitchen_ticket'`,
  ).get(BR2);
  assert.equal(anyJob.n, 0, 'không có máy nào cho trạm Bar thì không được tạo job nào cả');
});

// Đối chứng: máy KHÔNG khai stations (mảng rỗng/không có field) vẫn là "dùng
// chung cho mọi trạm" như hành vi cũ — không được vô tình siết luôn cả trường
// hợp chưa ai cấu hình gì (đa số cửa hàng chỉ có 1 máy in bếp/bar).
test('máy chưa khai stations vẫn nhận job của MỌI trạm (giữ hành vi cũ)', () => {
  const BR3 = 'kstation_default';
  AppSettings.updateSettings({
    print_config: {
      printers: [
        {
          id: 'may_chung', name: 'Máy bếp chung', systemName: 'Máy bếp chung',
          label: 'Phiếu bếp', output: 'kitchen_ticket', connection: 'system',
          active: true, auto: true,
        },
      ],
    },
  }, BR3);

  const order = { id: 'o_test4', table_code: 'A04', bill_no: 'Dan_test4', zone: 'Tầng trệt' };
  const items = [
    { id: 'oi7', name: 'Bia Sài Gòn', qty: 1, station: 'bar' },
    { id: 'oi8', name: 'Phở bò', qty: 1, station: 'kitchen' },
  ];
  Print.printKitchenTickets(order, items, BR3, 'tester');

  const jobs = db.prepare(
    `SELECT * FROM print_jobs WHERE branch_id=? AND printer=? AND type='kitchen_ticket'`,
  ).all(BR3, 'may_chung');
  assert.equal(jobs.length, 2, 'máy dùng chung phải nhận cả 2 ticket (bar + kitchen)');
});
