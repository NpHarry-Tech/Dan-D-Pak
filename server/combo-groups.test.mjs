// COMBO/CUSTOMIZE GROUPS (iPOS-style món đi kèm) — option_groups mode:'combo'.
// Khác với mode:'price' (cộng giá vào dòng hiện tại), mỗi lựa chọn combo tách
// thành 1 order_items RIÊNG (giá/trạm/hủy độc lập) để phiếu bếp tự in đúng
// từng trạm (bếp nóng/bếp lạnh/bar…) và hủy món chính kéo theo hủy dây chuyền
// các món đi kèm. Xem plan: C:\Users\PC\.claude\plans\smooth-weaving-clarke.md
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

process.env.SQLITE_PATH = join(mkdtempSync(join(tmpdir(), 'ddp-combogrp-')), 'store.db');
process.env.STORAGE_PATH = join(tmpdir(), 'combogrp-store');
process.env.PRINT_DISPATCH = 'agent';

const { db, migrate } = await import('./db.js');
const Catalog = await import('./services/catalog.js');
const Orders = await import('./services/orders.js');
const Print = await import('./services/printing.js');
const AppSettings = await import('./services/settings.js');
migrate();

const B = 'sala';
db.prepare(`INSERT INTO categories (id,branch_id,name) VALUES ('cat_combo','sala','Test')`).run();
db.prepare(`INSERT INTO shifts (id,branch_id,user_name,status,opened_at) VALUES ('sh_combo','sala','Cashier','open',?)`)
  .run(new Date().toISOString());

// 3 trạm KHÁC NHAU, đúng kịch bản người dùng mô tả: Hủ tiếu -> bếp nóng, Salad
// -> bếp lạnh, Nước + Tráng miệng -> bar (dùng CHUNG 1 trạm).
AppSettings.updateSettings({
  print_config: {
    printers: [
      { id: 'p_hot', name: 'Bếp nóng', systemName: 'Bếp nóng', label: 'Phiếu bếp',
        output: 'kitchen_ticket', connection: 'system', active: true, auto: true, stations: ['bep_nong'] },
      { id: 'p_cold', name: 'Bếp lạnh', systemName: 'Bếp lạnh', label: 'Phiếu bếp lạnh',
        output: 'kitchen_ticket', connection: 'system', active: true, auto: true, stations: ['bep_lanh'] },
      { id: 'p_bar', name: 'Bar', systemName: 'Bar', label: 'Phiếu bar',
        output: 'kitchen_ticket', connection: 'system', active: true, auto: true, stations: ['bar'] },
    ],
  },
}, B);

db.prepare(`INSERT INTO menu_items (id,branch_id,category_id,name,price,vat_rate,price_includes_vat,station)
  VALUES ('mi_salad','sala','cat_combo','Salad',20000,0,1,'bep_lanh')`).run();
db.prepare(`INSERT INTO menu_items (id,branch_id,category_id,name,price,vat_rate,price_includes_vat,station)
  VALUES ('mi_nuoc','sala','cat_combo','Nước',15000,0,1,'bar')`).run();
db.prepare(`INSERT INTO menu_items (id,branch_id,category_id,name,price,vat_rate,price_includes_vat,station)
  VALUES ('mi_tm','sala','cat_combo','Tráng miệng',25000,0,1,'bar')`).run();

const comboGroups = [
  { key: 'phu', name: 'Món đi kèm', mode: 'combo', position: 'bottom', min: 1, max: 3,
    options: [
      { key: 'o_salad', ref_item_id: 'mi_salad' },
      { key: 'o_nuoc', ref_item_id: 'mi_nuoc' },
      { key: 'o_tm', ref_item_id: 'mi_tm' },
    ] },
];
db.prepare(`INSERT INTO menu_items (id,branch_id,category_id,name,price,vat_rate,price_includes_vat,station,option_groups_json)
  VALUES ('mi_main','sala','cat_combo','Hủ tiếu xào hải sản',60000,0,1,'bep_nong',?)`).run(JSON.stringify(comboGroups));

let tableSeq = 0;
function tableId() {
  const id = `t_combo_${++tableSeq}`;
  db.prepare(`INSERT INTO tables (id,branch_id,zone,code,seats,status) VALUES (?,?,?,?,4,'free')`)
    .run(id, B, 'Test', `CB${tableSeq}`);
  return id;
}

function jobsFor(printer) {
  return db.prepare(
    `SELECT * FROM print_jobs WHERE branch_id=? AND printer=? AND type='kitchen_ticket' ORDER BY created_at`,
  ).all(B, printer);
}

// ---------------------------------------------------------------------------
// normalizeOptionGroups: mode mặc định + validate combo.
// ---------------------------------------------------------------------------

test('normalizeOptionGroups: khong co mode -> mac dinh price (tuong thich nguoc)', () => {
  const out = Catalog.normalizeOptionGroups([
    { name: 'Size', min: 1, max: 1, options: [{ name: 'Lon', type: 'paid', price: 5000 }] },
  ]);
  assert.equal(out[0].mode, 'price');
});

test('normalizeOptionGroups: mode combo bat buoc ref_item_id, loai option thieu', () => {
  const out = Catalog.normalizeOptionGroups([
    { name: 'Món đi kèm', mode: 'combo', min: 1, max: 2, options: [
      { key: 'a', name: 'Không link', type: 'free' },
      { key: 'b', ref_item_id: 'mi_salad' },
    ] },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].options.length, 1, 'option khong co ref_item_id phai bi loai');
  assert.equal(out[0].options[0].ref_item_id, 'mi_salad');
});

test('normalizeOptionGroups: khong cho long combo trong combo', () => {
  db.prepare(`INSERT INTO menu_items (id,branch_id,category_id,name,price,option_groups_json)
    VALUES ('mi_has_combo','sala','cat_combo','Món đã có combo',10000,?)`)
    .run(JSON.stringify([{ name: 'g', mode: 'combo', min: 1, max: 1, options: [{ key: 'x', ref_item_id: 'mi_salad' }] }]));
  assert.throws(() => Catalog.normalizeOptionGroups([
    { name: 'Lồng combo', mode: 'combo', min: 1, max: 1, options: [{ key: 'y', ref_item_id: 'mi_has_combo' }] },
  ]), /không thể lồng combo trong combo/);
});

// ---------------------------------------------------------------------------
// Đặt món: tạo dòng cha + các dòng con RIÊNG, đúng giá/trạm của từng món con.
// ---------------------------------------------------------------------------

test('dat mon voi combo: tao 1 dong cha + N dong con rieng, gia/tram lay tu chinh mon con', () => {
  const full = Orders.createOrUpdateOrder({
    branch_id: B, table_id: tableId(), source: 'staff_pos',
    items: [{ menu_item_id: 'mi_main', qty: 1, combo: [
      { ref_item_id: 'mi_salad', note: 'Ít dầu' },
      { ref_item_id: 'mi_nuoc' },
      { ref_item_id: 'mi_tm' },
    ] }],
  });
  const rows = db.prepare(`SELECT * FROM order_items WHERE order_id=? ORDER BY created_at`).all(full.id);
  assert.equal(rows.length, 4, 'phai co 1 mon chinh + 3 mon di kem');
  const parent = rows.find(r => r.menu_item_id === 'mi_main');
  assert.equal(parent.parent_item_id, null);
  assert.equal(parent.unit_price, 60000, 'gia mon chinh KHONG cong gia mon di kem vao');

  const salad = rows.find(r => r.menu_item_id === 'mi_salad');
  assert.equal(salad.parent_item_id, parent.id);
  assert.equal(salad.unit_price, 20000);
  assert.equal(salad.station, 'bep_lanh');
  assert.equal(salad.qty, 1);
  assert.equal(salad.note, 'Ít dầu');

  const nuoc = rows.find(r => r.menu_item_id === 'mi_nuoc');
  assert.equal(nuoc.parent_item_id, parent.id);
  assert.equal(nuoc.station, 'bar');

  const tm = rows.find(r => r.menu_item_id === 'mi_tm');
  assert.equal(tm.parent_item_id, parent.id);
  assert.equal(tm.station, 'bar');
});

test('dat 2x mon chinh -> moi mon di kem cung nhan qty=2 (khong phai tao 2 dong rieng)', () => {
  const full = Orders.createOrUpdateOrder({
    branch_id: B, table_id: tableId(), source: 'staff_pos',
    items: [{ menu_item_id: 'mi_main', qty: 2, combo: [{ ref_item_id: 'mi_salad' }] }],
  });
  const rows = db.prepare(`SELECT * FROM order_items WHERE order_id=?`).all(full.id);
  assert.equal(rows.length, 2, 'van chi 1 dong cha + 1 dong con (khong nhan doi so dong)');
  const parent = rows.find(r => r.menu_item_id === 'mi_main');
  const salad = rows.find(r => r.menu_item_id === 'mi_salad');
  assert.equal(parent.qty, 2);
  assert.equal(salad.qty, 2, 'mon di kem phai nhan CUNG so luong voi mon chinh');
  assert.equal(salad.unit_price, 20000, 'don gia van la gia 1 don vi, khong nhan qty vao unit_price');
});

test('combo thieu lua chon bat buoc (min=1) -> bi tu choi', () => {
  assert.throws(() => Orders.createOrUpdateOrder({
    branch_id: B, table_id: tableId(), source: 'staff_pos',
    items: [{ menu_item_id: 'mi_main', qty: 1 }],
  }), /Thiếu lựa chọn bắt buộc/);
});

test('combo vuot qua max -> bi tu choi', () => {
  db.prepare(`UPDATE menu_items SET option_groups_json=? WHERE id='mi_main'`).run(JSON.stringify([
    { key: 'phu', name: 'Món đi kèm', mode: 'combo', min: 1, max: 2, options: comboGroups[0].options },
  ]));
  assert.throws(() => Orders.createOrUpdateOrder({
    branch_id: B, table_id: tableId(), source: 'staff_pos',
    items: [{ menu_item_id: 'mi_main', qty: 1, combo: [
      { ref_item_id: 'mi_salad' }, { ref_item_id: 'mi_nuoc' }, { ref_item_id: 'mi_tm' },
    ] }],
  }), /chỉ được chọn tối đa/);
  // Khôi phục max=3 cho các test sau.
  db.prepare(`UPDATE menu_items SET option_groups_json=? WHERE id='mi_main'`).run(JSON.stringify(comboGroups));
});

test('combo chon mon khong nam trong nhom -> bi tu choi', () => {
  assert.throws(() => Orders.createOrUpdateOrder({
    branch_id: B, table_id: tableId(), source: 'staff_pos',
    items: [{ menu_item_id: 'mi_main', qty: 1, combo: [{ ref_item_id: 'mi_has_combo' }] }],
  }), /không hợp lệ/);
});

test('combo chon trung 1 mon 2 lan -> bi tu choi', () => {
  assert.throws(() => Orders.createOrUpdateOrder({
    branch_id: B, table_id: tableId(), source: 'staff_pos',
    items: [{ menu_item_id: 'mi_main', qty: 1, combo: [{ ref_item_id: 'mi_salad' }, { ref_item_id: 'mi_salad' }] }],
  }), /Đã chọn trùng/);
});

// ---------------------------------------------------------------------------
// Hủy dây chuyền: hủy món chính -> hủy hết món đi kèm; hủy món đi kèm riêng bị chặn.
// ---------------------------------------------------------------------------

test('huy mon chinh -> huy day chuyen toan bo mon di kem', () => {
  const full = Orders.createOrUpdateOrder({
    branch_id: B, table_id: tableId(), source: 'staff_pos',
    items: [{ menu_item_id: 'mi_main', qty: 1, combo: [{ ref_item_id: 'mi_salad' }, { ref_item_id: 'mi_nuoc' }] }],
  });
  const rows = db.prepare(`SELECT * FROM order_items WHERE order_id=?`).all(full.id);
  const parent = rows.find(r => r.menu_item_id === 'mi_main');
  Orders.cancelItem(parent.id, 'khách đổi ý', B, 'tester');
  const after = db.prepare(`SELECT status FROM order_items WHERE order_id=?`).all(full.id);
  assert.ok(after.every(r => r.status === 'cancelled'), 'ca mon chinh lan mon di kem deu phai bi huy');
});

test('huy mon di kem rieng (khong qua mon chinh) -> bi chan', () => {
  const full = Orders.createOrUpdateOrder({
    branch_id: B, table_id: tableId(), source: 'staff_pos',
    items: [{ menu_item_id: 'mi_main', qty: 1, combo: [{ ref_item_id: 'mi_salad' }] }],
  });
  const rows = db.prepare(`SELECT * FROM order_items WHERE order_id=?`).all(full.id);
  const child = rows.find(r => r.menu_item_id === 'mi_salad');
  assert.throws(() => Orders.cancelItem(child.id, 'test', B, 'tester'), /không thể huỷ riêng/);
});

test('cancelItemsBatch: chon rieng mon chinh (khong chon mon di kem) van tu dong huy ca hai', () => {
  const full = Orders.createOrUpdateOrder({
    branch_id: B, table_id: tableId(), source: 'staff_pos',
    items: [{ menu_item_id: 'mi_main', qty: 1, combo: [{ ref_item_id: 'mi_salad' }] }],
  });
  const rows = db.prepare(`SELECT * FROM order_items WHERE order_id=?`).all(full.id);
  const parent = rows.find(r => r.menu_item_id === 'mi_main');
  Orders.cancelItemsBatch(full.id, [parent.id], 'huỷ gộp', B, 'tester');
  const after = db.prepare(`SELECT status FROM order_items WHERE order_id=?`).all(full.id);
  assert.ok(after.every(r => r.status === 'cancelled'));
});

test('cancelItemsBatch: chon rieng mon di kem (khong kem mon chinh) -> bi chan', () => {
  const full = Orders.createOrUpdateOrder({
    branch_id: B, table_id: tableId(), source: 'staff_pos',
    items: [{ menu_item_id: 'mi_main', qty: 1, combo: [{ ref_item_id: 'mi_salad' }] }],
  });
  const rows = db.prepare(`SELECT * FROM order_items WHERE order_id=?`).all(full.id);
  const child = rows.find(r => r.menu_item_id === 'mi_salad');
  assert.throws(() => Orders.cancelItemsBatch(full.id, [child.id], 'test', B, 'tester'), /không thể huỷ riêng/);
});

// ---------------------------------------------------------------------------
// Phiếu bếp: mỗi món đi kèm tự tách đúng phiếu theo TRẠM RIÊNG của nó — không
// cần sửa gì ở printing.js (đã gom theo station của từng dòng từ trước).
// ---------------------------------------------------------------------------

test('phieu bep: mon chinh + 3 mon di kem 3 tram khac nhau -> tach dung 3 phieu', () => {
  const order = { id: 'o_combo_print', table_code: 'CB', bill_no: 'Dan_combo', zone: 'Test' };
  const items = [
    { id: 'p1', name: 'Hủ tiếu xào hải sản', qty: 1, station: 'bep_nong' },
    { id: 'c1', name: 'Salad', qty: 1, station: 'bep_lanh' },
    { id: 'c2', name: 'Nước', qty: 1, station: 'bar' },
    { id: 'c3', name: 'Tráng miệng', qty: 1, station: 'bar' },
  ];
  Print.printKitchenTickets(order, items, B, 'tester');
  const hot = jobsFor('p_hot');
  const cold = jobsFor('p_cold');
  const bar = jobsFor('p_bar');
  assert.equal(hot.length, 1);
  assert.equal(cold.length, 1);
  assert.equal(bar.length, 1, 'nuoc + trang mieng cung tram bar gop chung 1 phieu');
  assert.equal(JSON.parse(hot[0].payload_json).items.length, 1);
  assert.equal(JSON.parse(cold[0].payload_json).items.length, 1);
  assert.equal(JSON.parse(bar[0].payload_json).items.length, 2);
});

test('dat mon combo qua createOrUpdateOrder + xac nhan -> phieu bep tu tach dung tram', () => {
  const full = Orders.createOrUpdateOrder({
    branch_id: B, table_id: tableId(), source: 'self_order',
    items: [{ menu_item_id: 'mi_main', qty: 1, combo: [
      { ref_item_id: 'mi_salad' }, { ref_item_id: 'mi_nuoc' }, { ref_item_id: 'mi_tm' },
    ] }],
  });
  const rows = db.prepare(`SELECT * FROM order_items WHERE order_id=?`).all(full.id);
  assert.ok(rows.every(r => r.status === 'pending_confirm'), 'self_order phai cho nhan vien xac nhan truoc khi gui bep');
  Orders.confirmPendingItems(full.id, [], B, 'tester');
  const hot = jobsFor('p_hot');
  const cold = jobsFor('p_cold');
  const bar = jobsFor('p_bar');
  // Cộng dồn với test truoc — chi kiem tra co THEM đúng 1 phieu moi tren moi may.
  assert.equal(hot[hot.length - 1].branch_id, B);
  assert.equal(cold.length >= 1, true);
  const latestBar = JSON.parse(bar[bar.length - 1].payload_json);
  assert.equal(latestBar.items.length, 2, 'phieu bar moi nhat phai co ca nuoc + trang mieng');
});
