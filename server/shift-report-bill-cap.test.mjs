// /shifts/current: poll live KHÔNG được gửi cả nghìn bill mỗi nhịp (payload
// 577KB ở 2000 bill — nút thắt băng thông LAN đã đo). Giới hạn CHI TIẾT bill,
// nhưng MỌI số tổng vẫn phải chính xác trên toàn bộ ca.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-billcap-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = process.env.DATA_ENCRYPTION_KEY
  || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const { db, migrate, uid, now } = await import('./db.js');
migrate();
const Shifts = await import('./services/shifts.js');

const BR = 'sala';
const N = 250;
try { db.prepare(`INSERT INTO branches (id,name,code,active,sort) VALUES (?,?,?,1,0)`).run(BR, 'Sala', 'SALA'); } catch { /* may exist */ }
const shiftId = uid('shift_');
db.prepare(`INSERT INTO shifts (id,branch_id,shift_key,shift_label,status,opening_cash,opened_at)
  VALUES (?,?,?,?, 'open', 1000000, ?)`).run(shiftId, BR, 'sang', 'Ca sang', now());
for (let i = 0; i < 40; i++) {
  db.prepare(`INSERT OR IGNORE INTO tables (id,branch_id,code,zone,seats,status) VALUES (?,?,?,?,4,'free')`)
    .run(`T${i}`, BR, `T${i}`, 'Z1');
}
let expectedRevenue = 0;
db.prepare('BEGIN').run();
for (let i = 0; i < N; i++) {
  const total = 20000 + (i % 50) * 1000;
  expectedRevenue += total;
  const oid = uid('o_');
  const ts = new Date(Date.now() - (N - i) * 1000).toISOString();
  db.prepare(`INSERT INTO orders (id,branch_id,table_id,channel,status,bill_no,total,created_at,paid_at) VALUES (?,?,?,?,'paid',?,?,?,?)`)
    .run(oid, BR, `T${i % 40}`, 'dine_in', `Dan${100000 + i}`, total, ts, ts);
  const pid = uid('pay_');
  db.prepare(`INSERT INTO payments (id,order_id,shift_id,cashier,total,created_at) VALUES (?,?,?,?,?,?)`)
    .run(pid, oid, shiftId, 'thu-ngan', total, ts);
  db.prepare(`INSERT INTO payment_lines (id,payment_id,method,amount,tendered_amount) VALUES (?,?, 'cash', ?, ?)`)
    .run(uid('pl_'), pid, total, total);
}
db.prepare('COMMIT').run();

test('currentShift GIỚI HẠN chi tiết bill nhưng số tổng CHÍNH XÁC toàn ca', () => {
  const state = Shifts.currentShift(BR);
  const r = state.report;
  assert.ok(r, 'phải có report');
  assert.equal(r.bills.length, 200, 'chi tiết bill bị giới hạn 200 gần nhất');
  assert.equal(r.bill_count, N, 'bill_count vẫn là TOÀN BỘ ca');
  assert.equal(r.total_revenue, expectedRevenue, 'doanh thu tính trên toàn bộ, không bị cắt');
  assert.equal(r.cash_sales, expectedRevenue, 'tổng tiền mặt cũng đủ');
  // Payload nhẹ hẳn: JSON của report < 100KB thay vì hàng trăm KB.
  assert.ok(JSON.stringify(state).length < 120000, 'payload live phải nhẹ');
});

test('shiftReport KHÔNG giới hạn (đường close/report) trả ĐỦ bill', () => {
  const full = Shifts.shiftReport(shiftId, BR); // không billLimit
  assert.equal(full.bills.length, N, 'đường report đầy đủ giữ nguyên mọi bill');
  assert.equal(full.bill_count, N);
  assert.equal(full.total_revenue, expectedRevenue);
});

test('bills trả về là các bill GẦN NHẤT (đuôi danh sách theo thời gian)', () => {
  const state = Shifts.currentShift(BR);
  const numbers = state.report.bills.map(b => b.number);
  // Bill mới nhất (Dan{100000+249}) phải nằm trong tập trả về; bill cũ nhất thì không.
  assert.ok(numbers.includes(`Dan${100000 + N - 1}`), 'phải có bill mới nhất');
  assert.ok(!numbers.includes('Dan100000'), 'bill cũ nhất đã bị cắt khỏi chi tiết');
});
