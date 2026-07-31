// TÀI KHOẢN QUẢN TRỊ KHÔNG ĐƯỢC HIỆN TRONG LƯỚI CHỌN NHÂN VIÊN.
//
// Màn đăng nhập có nút riêng "Đăng nhập quản trị viên" (gõ tài khoản + PIN), nên
// ô bấm một chạm của admin nằm ngay cạnh đó là vừa thừa vừa lộ.
//
// VÌ SAO PHẢI LỌC Ở SERVER: payload của listLoginUsers CỐ Ý không gửi `role`, và
// ô `username` thực chất chứa `id` (xem chú thích trong auth.js). Client từng tự
// lọc bằng `u.role == 'owner' || u.username == 'admin'` — cả hai vế đều luôn sai,
// nên ô "Admin" vẫn hiện. Client KHÔNG CÓ CÁCH NÀO tự biết ai là quản trị; chỉ
// server biết, và cũng chỉ server giấu được.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-logingrid-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.RELEASES_DIR = join(temp, 'releases');
process.env.DATA_ENCRYPTION_KEY = process.env.DATA_ENCRYPTION_KEY
  || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const { db, migrate } = await import('./db.js');
const Auth = await import('./services/auth.js');

migrate();

function themNguoi({ id, username, name, role }) {
  db.prepare(
    `INSERT OR REPLACE INTO users (id, username, name, role, pin, active, branch_id)
     VALUES (?,?,?,?,'0000',1,'sala')`,
  ).run(id, username, name, role);
}

// Dung dung tinh huong that o cua hang: mot tai khoan admin, mot chu, va nhan
// vien binh thuong.
themNguoi({ id: 'u_admin', username: 'admin', name: 'Admin', role: 'manager' });
themNguoi({ id: 'u_chu', username: 'chuquan', name: 'Chu Quan', role: 'owner' });
themNguoi({ id: 'u_tan', username: 'tan', name: 'Bui Van Tan', role: 'cashier' });
themNguoi({ id: 'u_vinh', username: 'vinh', name: 'Le Quoc Vinh', role: 'manager' });

const ten = () => Auth.listLoginUsers('sala').map(u => u.name);

test('tai khoan ten dang nhap "admin" KHONG hien trong luoi', () => {
  assert.ok(!ten().includes('Admin'),
    `luoi dang co: ${ten().join(', ')} — admin phai vao bang nut rieng`);
});

test('tai khoan vai tro owner KHONG hien trong luoi', () => {
  assert.ok(!ten().includes('Chu Quan'));
});

test('nhan vien binh thuong VAN hien du', () => {
  const ds = ten();
  assert.ok(ds.includes('Bui Van Tan'), 'thu ngan phai hien de bam mot cham');
  assert.ok(ds.includes('Le Quoc Vinh'), 'quan ly (khong phai owner) van hien');
  assert.equal(ds.length, 2, `chi con 2 nguoi, dang co: ${ds.join(', ')}`);
});

test('KHONG lo username that va vai tro ra man hinh cong khai', () => {
  // Day la man CHUA dang nhap. Lo username la lo mot nua thong tin dang nhap;
  // lo vai tro la chi thang cho ai la chu quan.
  for (const u of Auth.listLoginUsers('sala')) {
    assert.equal(u.role, undefined, 'khong duoc gui role');
    assert.notEqual(u.username, 'tan', 'o username phai la id, khong phai username that');
    assert.equal(u.username, u.id);
  }
});

test('admin bi vo hieu hoa thi cung khong hien (khong ai hien)', () => {
  db.prepare(`UPDATE users SET active=0 WHERE id='u_tan'`).run();
  const ds = ten();
  assert.ok(!ds.includes('Bui Van Tan'), 'nguoi da tat khong duoc hien');
  assert.ok(!ds.includes('Admin'));
});
