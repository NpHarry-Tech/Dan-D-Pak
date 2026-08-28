// SƠ ĐỒ BÀN: khu vực là thực thể riêng (tạo rỗng vẫn còn), bàn có vị trí lưới,
// lưu vị trí hàng loạt, xoá khu vực thì bàn về "chưa xếp" (không xoá bàn).
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

process.env.SQLITE_PATH = join(mkdtempSync(join(tmpdir(), 'ddp-floor-')), 'store.db');
process.env.STORAGE_PATH = join(tmpdir(), 'floor-store');

const { migrate } = await import('./db.js');
const Orders = await import('./services/orders.js');
migrate();

test('khu vuc rong VAN hien; ban co vi tri; xoa khu vuc -> ban ve chua xep', () => {
  // Tao khu vuc RONG (khong bàn) -> van con trong danh sach.
  const zA = Orders.createZone({ branch_id: 'sala', name: 'Tang Tret' });
  const zEmpty = Orders.createZone({ branch_id: 'sala', name: 'San Thuong' });
  let plan = Orders.getFloorPlan('sala');
  assert.ok(plan.zones.some(z => z.name === 'San Thuong'), 'khu vuc rong van hien');
  assert.equal(plan.zones.length, 2);

  // Tao ban gan khu vuc + vi tri luoi.
  const t1 = Orders.createTable({ branch_id: 'sala', zone_id: zA.id, code: 'ZZ01', seats: 4, pos_x: 0, pos_y: 0 });
  const t2 = Orders.createTable({ branch_id: 'sala', zone_id: zA.id, code: 'ZZ02', seats: 2 }); // chua xep (pos -1)
  plan = Orders.getFloorPlan('sala');
  const pt1 = plan.tables.find(t => t.id === t1.id);
  assert.equal(pt1.pos_x, 0);
  assert.equal(pt1.pos_y, 0);
  assert.equal(pt1.zone_id, zA.id);
  const pt2 = plan.tables.find(t => t.id === t2.id);
  assert.equal(pt2.pos_x, -1, 'ban chua xep vi tri = -1');

  // Luu HANG LOAT vi tri (keo-tha).
  Orders.saveTablePositions('sala', [
    { id: t2.id, pos_x: 3, pos_y: 1, zone_id: zA.id },
  ]);
  plan = Orders.getFloorPlan('sala');
  assert.equal(plan.tables.find(t => t.id === t2.id).pos_x, 3);

  // Xoa khu vuc -> ban thuoc no ve "chua xep" (KHONG xoa ban).
  Orders.deleteZone(zA.id, 'sala');
  plan = Orders.getFloorPlan('sala');
  assert.ok(!plan.zones.some(z => z.id === zA.id), 'khu vuc da xoa');
  const after = plan.tables.find(t => t.id === t1.id);
  assert.ok(after, 'ban KHONG bi xoa theo khu vuc');
  assert.equal(after.zone_id, null, 'ban ve khong-khu-vuc');
  assert.equal(after.pos_x, -1, 'ban ve chua xep vi tri');
});

test('createTable theo TEN khu vuc (tuong thich cu) tu tao zone', () => {
  const t = Orders.createTable({ branch_id: 'sala', zone: 'Khu VIP', code: 'ZZV1' });
  const plan = Orders.getFloorPlan('sala');
  const zone = plan.zones.find(z => z.name === 'Khu VIP');
  assert.ok(zone, 'nhap ten khu vuc moi -> tao zone');
  assert.equal(plan.tables.find(x => x.id === t.id).zone_id, zone.id);
});

test('vi tri SO THUC (dat tu do, khong snap o) luu + doc lai dung', () => {
  const z = Orders.createZone({ branch_id: 'sala', name: 'Free' });
  const t = Orders.createTable({ branch_id: 'sala', zone_id: z.id, code: 'ZZF1', pos_x: 3.5, pos_y: 2.25 });
  let plan = Orders.getFloorPlan('sala');
  let pt = plan.tables.find(x => x.id === t.id);
  assert.equal(pt.pos_x, 3.5, 'pos_x float giu nguyen');
  assert.equal(pt.pos_y, 2.25, 'pos_y float giu nguyen');
  // Luu lai vi tri le khac qua saveTablePositions.
  Orders.saveTablePositions('sala', [{ id: t.id, pos_x: 7.8, pos_y: 1.1, zone_id: z.id }]);
  plan = Orders.getFloorPlan('sala');
  pt = plan.tables.find(x => x.id === t.id);
  assert.equal(pt.pos_x, 7.8);
  assert.equal(pt.pos_y, 1.1);
});
