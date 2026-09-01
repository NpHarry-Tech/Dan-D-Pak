// BÀN KẸT VÌ BILL ĐÃ NHẬN TIỀN NHƯNG KHÔNG CÒN MÓN — PHẢI CÓ ĐƯỜNG THOÁT.
//
// Sự cố thật (2026-08-03, bàn A06): bill Dan260726023 đã ghi nhận 30.000đ rồi
// mất hết món. Bàn nằm chết, kể cả tài khoản admin:
//   - Không thanh toán tiếp được: bill không còn gì để bán.
//   - Không hoàn trả được: đường hoàn trả đòi đơn ở trạng thái đã thanh toán.
//   - Không dọn bàn được: chốt an toàn từ chối mọi bill đã ghi nhận tiền.
//
// Chốt an toàn đó ĐÚNG về nguyên tắc — xoá trắng một bill đã thu tiền là làm
// mất dấu khoản tiền. Cái thiếu là đường thoát HỢP LỆ: hoàn tiền có chứng từ.
// Test này khoá cả hai chiều: vẫn cấm xoá trắng, VÀ hoàn tiền phải dọn được bàn
// mà KHÔNG làm biến mất khoản tiền cũ.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-stuck-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = process.env.DATA_ENCRYPTION_KEY
  || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.PRINT_DISPATCH = 'agent';

const { migrate, db, uid, now } = await import('./db.js');
const Orders = await import('./services/orders.js');

migrate();

const BR = 'sala';

/// Dựng lại ĐÚNG tình trạng bàn A06: bill đang mở, đã nhận tiền, KHÔNG còn món.
function dungBanKet(maBan, soTien) {
  db.prepare(`INSERT OR REPLACE INTO tables (id,branch_id,code,zone,seats,status)
    VALUES (?,?,?,?,?,'busy')`).run(maBan, BR, maBan, 'TANG TRET', 4);
  const orderId = uid('o_');
  db.prepare(`INSERT INTO orders (id,branch_id,table_id,channel,status,bill_no,total,created_at)
    VALUES (?,?,?,'dine_in','open',?,0,?)`)
    .run(orderId, BR, maBan, `Dan${maBan}`, now());
  const payId = uid('pay_');
  db.prepare(`INSERT INTO payments (id,order_id,cashier,total,created_at) VALUES (?,?,?,?,?)`)
    .run(payId, orderId, 'thu-ngan', soTien, now());
  db.prepare(`INSERT INTO payment_lines (id,payment_id,method,amount,tendered_amount)
    VALUES (?,?,'cash',?,?)`).run(uid('pl_'), payId, soTien, soTien);
  return orderId;
}

const tongTien = (orderId) => db
  .prepare(`SELECT COALESCE(SUM(total),0) n FROM payments WHERE order_id=?`)
  .get(orderId).n;

const soDongTien = (orderId) => db
  .prepare(`SELECT COUNT(*) n FROM payments WHERE order_id=?`)
  .get(orderId).n;

test('VAN cam xoa trang bill da nhan tien (chot an toan giu nguyen)', () => {
  const orderId = dungBanKet('A06', 30000);
  assert.throws(
    () => Orders.resetTable('A06', BR, 'admin', 'thu don'),
    /đã ghi nhận 30.000đ/,
    'xoa trang bill da thu tien la lam mat dau khoan tien');
  // Bàn vẫn bận, tiền vẫn còn nguyên.
  assert.equal(db.prepare(`SELECT status FROM tables WHERE id='A06'`).get().status, 'busy');
  assert.equal(tongTien(orderId), 30000);
});

test('HOAN TIEN thi don duoc ban, va tien KHONG bi xoa dau vet', () => {
  const orderId = dungBanKet('A07', 30000);
  const kq = Orders.resetTable('A07', BR, 'admin', 'khach bo ve, bill loi khong con mon', {
    refundPaid: true,
  });
  assert.equal(kq.ok, true);

  // 1. Bàn về trống — đây là thứ cửa hàng cần.
  assert.equal(db.prepare(`SELECT status FROM tables WHERE id='A07'`).get().status, 'free');
  // 2. Bill bị huỷ, không còn treo ở bàn.
  assert.equal(db.prepare(`SELECT status FROM orders WHERE id=?`).get(orderId).status, 'void');
  // 3. Khoản thu CŨ còn nguyên + có thêm khoản ÂM đối ứng => còn chứng từ hai chiều.
  assert.equal(soDongTien(orderId), 2, 'phai co ca khoan thu cu VA khoan hoan');
  assert.equal(tongTien(orderId), 0, 'doanh thu cua bill nay ve 0');
  const hoan = db.prepare(
    `SELECT total FROM payments WHERE order_id=? AND total<0`).get(orderId);
  assert.equal(hoan.total, -30000);
  // 4. Dòng hoàn phải ghi rõ lý do để sau này còn giải thích được.
  const dong = db.prepare(`SELECT reference FROM payment_lines pl
    JOIN payments p ON p.id=pl.payment_id WHERE p.order_id=? AND pl.amount<0`).get(orderId);
  assert.match(String(dong.reference), /refund:reset_table:khach bo ve/);
});

test('ban KHONG co tien van don duoc binh thuong, khong sinh khoan hoan thua', () => {
  db.prepare(`INSERT OR REPLACE INTO tables (id,branch_id,code,zone,seats,status)
    VALUES ('A08',?,'A08','TANG TRET',4,'busy')`).run(BR);
  const orderId = uid('o_');
  db.prepare(`INSERT INTO orders (id,branch_id,table_id,channel,status,bill_no,total,created_at)
    VALUES (?,?,'A08','dine_in','open','DanA08',0,?)`).run(orderId, BR, now());

  const kq = Orders.resetTable('A08', BR, 'admin', 'ban ket');
  assert.equal(kq.ok, true);
  assert.equal(db.prepare(`SELECT status FROM tables WHERE id='A08'`).get().status, 'free');
  assert.equal(soDongTien(orderId), 0, 'khong duoc tu sinh khoan tien nao');
});

test('hoan tien roi thi bill KHONG con bi tinh vao doanh thu', () => {
  const orderId = dungBanKet('A09', 50000);
  Orders.resetTable('A09', BR, 'admin', 'bill loi', { refundPaid: true });
  // Tổng tiền ròng của bill = 0 → mọi báo cáo cộng theo payments đều ra 0.
  assert.equal(tongTien(orderId), 0);
});
