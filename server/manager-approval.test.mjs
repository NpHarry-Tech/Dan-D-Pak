// Xác nhận thao tác nhạy cảm bằng PIN Quản lý/Admin.
//
// Yêu cầu: nếu CHÍNH người đang đăng nhập đã là Quản lý/Admin thì không bắt gõ
// lại PIN của mình nữa. Nhưng nới lỏng chỗ này chạm tới quyền, nên phải chứng
// minh nó KHÔNG mở cửa cho người không đủ vai trò.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-approval-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = process.env.DATA_ENCRYPTION_KEY
  || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const { db, migrate } = await import('./db.js');
const { hashPin } = await import('./services/pin.js');
const { requestContext } = await import('./core/requestContext.js');
const Auth = await import('./services/auth.js');

migrate();

function makeUser(id, username, role, { active = 1, branchAccess = null } = {}) {
  db.prepare(`INSERT INTO users (id,branch_id,username,name,pin,role,active,branch_access_json)
    VALUES (?,?,?,?,?,?,?,?)`)
    .run(id, 'sala', username, username, hashPin('8317'), role, active,
      branchAccess === null ? '[]' : JSON.stringify(branchAccess));
}

/** Chạy trong ngữ cảnh request của một người dùng, như attachUser vẫn làm. */
function asUser(user, fn) {
  return requestContext.run({ user }, fn);
}

makeUser('u_chu', 'chusohuu', 'owner');
makeUser('u_ql', 'quanly', 'manager');
makeUser('u_tn', 'thungan', 'cashier');
makeUser('u_nghi', 'daNghi', 'manager', { active: 0 });

test('Admin đang đăng nhập tự duyệt — KHÔNG cần PIN', () => {
  const me = { id: 'u_chu', role: 'owner' };
  const r = asUser(me, () => Auth.verifyManagerOwnerPin('', 'sala'));
  assert.ok(r, 'phải duyệt được mà không có PIN');
  assert.equal(r.username, 'chusohuu');
});

test('Quản lý đang đăng nhập tự duyệt — KHÔNG cần PIN', () => {
  const r = asUser({ id: 'u_ql', role: 'manager' }, () => Auth.verifyManagerOwnerPin('', 'sala'));
  assert.equal(r?.username, 'quanly');
});

test('Thu ngân KHÔNG tự duyệt được — vẫn phải mượn PIN quản lý', () => {
  const me = { id: 'u_tn', role: 'cashier' };
  assert.equal(asUser(me, () => Auth.verifyManagerOwnerPin('', 'sala')), null,
    'thu ngân gửi PIN rỗng thì phải bị từ chối');
  assert.equal(asUser(me, () => Auth.verifyManagerOwnerPin('0000', 'sala')), null,
    'PIN sai vẫn bị từ chối');

  const ok = asUser(me, () => Auth.verifyManagerOwnerPin('8317', 'sala'));
  assert.ok(ok, 'nhập đúng PIN quản lý thì được duyệt');
  assert.ok(['chusohuu', 'quanly'].includes(ok.username));
});

test('tài khoản quản lý ĐÃ NGHỈ không tự duyệt được', () => {
  assert.equal(
    asUser({ id: 'u_nghi', role: 'manager' }, () => Auth.verifyManagerOwnerPin('', 'sala')),
    null, 'active=0 thì không được duyệt dù vai trò là quản lý');
});

test('vai trò trong phiên bị giả mạo cũng vô ích — server đọc lại từ CSDL', () => {
  // Kẻ tấn công sửa payload phiên để tự phong 'owner'. selfApprover nạp lại từ
  // DB nên vai trò thật (cashier) mới có giá trị.
  assert.equal(
    asUser({ id: 'u_tn', role: 'owner' }, () => Auth.verifyManagerOwnerPin('', 'sala')),
    null);
});

test('quản lý không có quyền vào chi nhánh đó thì không tự duyệt được', () => {
  makeUser('u_ql2', 'quanly2', 'manager', { branchAccess: ['sala'] });
  assert.ok(asUser({ id: 'u_ql2' }, () => Auth.verifyManagerOwnerPin('', 'sala')));
  assert.equal(asUser({ id: 'u_ql2' }, () => Auth.verifyManagerOwnerPin('', 'br_khac')), null);
});

test('không có ngữ cảnh request (tác vụ nền) thì vẫn theo đường PIN như cũ', () => {
  assert.equal(Auth.verifyManagerOwnerPin('', 'sala'), null);
  assert.ok(Auth.verifyManagerOwnerPin('8317', 'sala'));
});
