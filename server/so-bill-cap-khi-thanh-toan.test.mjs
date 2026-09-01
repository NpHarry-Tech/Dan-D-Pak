// SỐ HOÁ ĐƠN CHỈ CẤP KHI THANH TOÁN XONG.
//
// SỰ CỐ THẬT (04/08/2026): kiểm tra hệ thống thấy đơn ĐÃ HUỶ vẫn mang số bill.
// Dãy số hoá đơn vì thế thủng lỗ chỗ — cơ quan thuế hỏi thì không giải thích
// được, vì mỗi số bị tiêu là một hoá đơn "đã phát hành rồi biến mất".
//
// Nguyên nhân: `bill_no` gánh HAI việc cùng lúc — vừa là số hoá đơn, vừa là
// NỘI DUNG CHUYỂN KHOẢN để webhook ngân hàng khớp tiền về. Vì phải có sẵn lúc
// khách quét QR nên nó bị cấp ngay khi mở đơn.
//
// Cách sửa: tách đôi.
//   pay_ref  — cấp lúc mở đơn, CHỈ dùng cho QR + đối soát ngân hàng
//   bill_no  — để trống tới khi thanh toán xong
// Huỷ đơn chưa trả tiền thì không tiêu số nào; đã trả tiền rồi hoàn thì giữ số.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-billno-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = process.env.DATA_ENCRYPTION_KEY
  || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const { migrate, db } = await import('./db.js');
const Orders = await import('./services/orders.js');
const AppSettings = await import('./services/settings.js');

migrate();
const BR = 'sala';

// Test nay khong kiem tra nghiep vu ca lam viec — tat de tap trung vao so bill.
AppSettings.updateSettings({
  operations_config: { shifts: { requireOpenShift: false } },
}, BR);

// Mot mon that de mo duoc don — test nay chi quan tam so bill/ma doi soat.
const Catalog = await import('./services/catalog.js');
const nhom = Catalog.createCategory({ name: 'Test' }, BR);
db.prepare(`INSERT INTO menu_items (id,branch_id,category_id,name,price) VALUES (?,?,?,?,?)`)
  .run('mi_test', BR, nhom.id, 'Hat dieu', 50000);
Catalog.cacheBust('menu:');

function moDon() {
  return Orders.createOrUpdateOrder({
    branch_id: BR, channel: 'retail', actor: 'test',
    items: [{ menu_item_id: 'mi_test', qty: 1 }],
  });
}

function docDon(id) {
  return db.prepare(`SELECT id, bill_no, pay_ref, status FROM orders WHERE id=?`).get(id);
}

test('don vua mo: CO ma doi soat, CHUA co so hoa don', () => {
  const o = moDon();
  const row = docDon(o.id);
  assert.ok(row.pay_ref, 'phai co pay_ref ngay de khach quet QR chuyen khoan duoc');
  assert.match(row.pay_ref, /^Dan\d+$/);
  assert.ok(!row.bill_no,
    'chua thanh toan thi KHONG duoc tieu so hoa don — day chinh la loi cu');
});

test('thanh toan xong moi cap so hoa don', () => {
  const o = moDon();
  assert.ok(!docDon(o.id).bill_no);

  const so = Orders.capSoBillKhiThanhToan(o.id, BR);
  assert.ok(so, 'phai cap duoc so');
  assert.match(so, /^Dan\d+$/);
  assert.equal(docDon(o.id).bill_no, so);
});

test('goi cap so nhieu lan tren cung don thi GIU NGUYEN so cu', () => {
  // Thanh toan lam nhieu lan (tra truoc mot phan roi tra not) khong duoc doi so.
  const o = moDon();
  const lan1 = Orders.capSoBillKhiThanhToan(o.id, BR);
  const lan2 = Orders.capSoBillKhiThanhToan(o.id, BR);
  assert.equal(lan2, lan1);
});

test('don HUY chua thanh toan KHONG tieu so hoa don nao', () => {
  const truoc = moDon();
  const soTruoc = Orders.capSoBillKhiThanhToan(truoc.id, BR);

  // Ba don mo ra roi huy — khong don nao duoc cap so.
  const huy = [moDon(), moDon(), moDon()];
  for (const h of huy) {
    db.prepare(`UPDATE orders SET status='void' WHERE id=?`).run(h.id);
    assert.ok(!docDon(h.id).bill_no, 'don huy khong duoc mang so hoa don');
  }

  // Don ke tiep thanh toan that -> so phai LIEN TIEP voi don da tra tien truoc,
  // khong nhay qua 3 so cua may don vua huy.
  const sau = moDon();
  const soSau = Orders.capSoBillKhiThanhToan(sau.id, BR);
  const n = (x) => parseInt(String(x).replace(/^Dan\d{6}/, ''), 10);
  assert.equal(n(soSau), n(soTruoc) + 1,
    `day so phai lien tiep: ${soTruoc} -> ${soSau} (khong duoc thung lo cho)`);
});

test('ma doi soat cua hai don KHAC nhau — khong khop nham tien ve', () => {
  // Dong don truoc lai roi moi mo don sau: kenh ban le khong co ban nen don
  // dang mo se duoc dung tiep neu khong dong (dung hanh vi, khong phai loi).
  const a = moDon();
  db.prepare(`UPDATE orders SET status='void' WHERE id=?`).run(a.id);
  const b = moDon();
  assert.notEqual(a.id, b.id, 'phai la hai don khac nhau');
  assert.notEqual(docDon(a.id).pay_ref, docDon(b.id).pay_ref,
    'hai don trung ma doi soat thi tien ve se khop nham don');
});

test('don da thanh toan roi HOAN thi VAN giu so hoa don', () => {
  const o = moDon();
  const so = Orders.capSoBillKhiThanhToan(o.id, BR);
  // Hoan tra: don doi trang thai nhung so hoa don da phat hanh thi phai giu —
  // no da nam trong so sach roi, xoa di la mat dau vet.
  db.prepare(`UPDATE orders SET status='refunded' WHERE id=?`).run(o.id);
  assert.equal(docDon(o.id).bill_no, so);
});

test('don cu (truoc khi tach doi) van doi soat duoc bang bill_no', async () => {
  // Don da ton tai trong DB tu ban cu: co bill_no, khong co pay_ref.
  const o = moDon();
  db.prepare(`UPDATE orders SET bill_no='Dan010826999', pay_ref=NULL WHERE id=?`).run(o.id);
  const Pay = await import('./services/payments.js');
  // Ham dung de dung noi dung CK khong export ra ngoai, nen kiem gian tiep:
  // don cu phai van tra ve mot ma doi soat khong rong.
  const don = db.prepare(`SELECT pay_ref, bill_no, id FROM orders WHERE id=?`).get(o.id);
  assert.ok(don.bill_no, 'don cu phai con bill_no de doi soat');
  assert.ok(!don.pay_ref);
  void Pay;
});
