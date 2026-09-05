// KẾT CA IDEMPOTENT (continuation gate 8, phần server). Kết ca hai lần KHÔNG được
// tạo hai lần đóng / ghi đè closing_cash của lần kết hợp lệ. Runtime một tiến trình:
// lần hai bị chặn ở getActiveShift (null). Điều kiện UPDATE ... AND status='open'
// là lưới an toàn cho nhiều tiến trình (changes=0 → 409 SHIFT_ALREADY_CLOSED).
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-closeidem-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = process.env.DATA_ENCRYPTION_KEY
  || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const { migrate, db } = await import('./db.js');
const Shifts = await import('./services/shifts.js');
migrate();
const BR = 'sala';
const user = { username: 'thu-ngan', name: 'Thu Ngan' };

const closedShifts = () =>
  db.prepare(`SELECT closing_cash FROM shifts WHERE branch_id=? AND status='closed'`).all(BR);

test('kết ca lần hai bị từ chối; đúng MỘT ca đóng; closing_cash không bị ghi đè', () => {
  Shifts.openShift({ shift_key: 'sang', opening_cash: 100000 }, user, BR);
  const r1 = Shifts.closeShift({ shift_key: 'sang', closing_cash: 500000, counts: {} }, user, BR);
  assert.equal(r1.shift.status, 'closed');
  assert.equal(closedShifts().length, 1);

  // Lần kết ca thứ hai (bấm dồn / máy khác) với số tiền KHÁC → phải bị từ chối.
  assert.throws(
    () => Shifts.closeShift({ shift_key: 'sang', closing_cash: 999999, counts: {} }, user, BR),
    /Chua co ca dang mo|đã được kết|đã kết|SHIFT_ALREADY_CLOSED/i,
    'không được kết ca lần hai');

  const closed = closedShifts();
  assert.equal(closed.length, 1, 'vẫn CHỈ một ca đóng, không nhân đôi');
  assert.equal(closed[0].closing_cash, 500000,
    'closing_cash của lần kết HỢP LỆ không bị lần hai ghi đè');
});

test('mở ca mới sau khi đã kết thì bình thường (không kẹt)', () => {
  const r = Shifts.openShift({ shift_key: 'chieu', opening_cash: 200000 }, user, BR);
  assert.ok(r.shift, 'mở được ca mới sau khi ca trước đã kết');
  assert.equal(r.shift.status, 'open');
});
