// Màn đăng nhập không được biến thành danh bạ tài khoản, và khoá chống dò PIN
// phải sống sót qua restart server.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-login-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');

const { db, migrate } = await import('./db.js');
const { hashPin } = await import('./services/pin.js');
const Auth = await import('./services/auth.js');

migrate();

function makeUser(id, username, role) {
  db.prepare(`INSERT INTO users (id,branch_id,username,name,pin,role,active) VALUES (?,?,?,?,?,?,1)`)
    .run(id, 'br1', username, `Ten ${username}`, hashPin('5274'), role);
}

test('danh sách cho màn đăng nhập không lộ username hay vai trò', () => {
  makeUser('u_boss', 'chusohuu', 'owner');
  makeUser('u_cash', 'thungan1', 'cashier');

  const list = Auth.listLoginUsers('br1');
  assert.equal(list.length, 2);
  const boss = list.find(u => u.id === 'u_boss');
  for (const u of list) {
    // Đủ để nhận mặt và bấm chọn…
    assert.ok(u.id && u.name);
    // …nhưng không đủ để nhắm mục tiêu: không biết ai là chủ.
    assert.equal(u.role, undefined);
    assert.equal(u.branch_ids, undefined);
  }
  // Tên tài khoản THẬT không bao giờ rời server. Trường `username` vẫn còn (app
  // đang cài đọc nó) nhưng mang giá trị của `id`, không phải 'chusohuu'.
  assert.equal(boss.username, 'u_boss');
  assert.ok(!list.some(u => u.username === 'chusohuu' || u.username === 'thungan1'));

  // Bản đầy đủ (chỉ trả cho request ĐÃ đăng nhập) vẫn giữ nguyên các trường cũ.
  const full = Auth.listUsers('br1');
  assert.ok(full.every(u => u.username && u.role));
});

test('đăng nhập được bằng id lấy từ danh sách, không cần biết username', () => {
  const byId = Auth.login('u_cash', '5274', 'br1', { deviceId: 'dev_a' });
  assert.equal(byId.user.username, 'thungan1');

  // Ô nhập thủ công (gõ username) vẫn chạy như cũ.
  const byName = Auth.login('thungan1', '5274', 'br1', { deviceId: 'dev_a' });
  assert.equal(byName.user.username, 'thungan1');
});

test('app CŨ (đọc trường username) vẫn đăng nhập được với server MỚI', () => {
  // Kịch bản lên bản thật: server mới lên trước, máy khách còn bản cũ vài ngày.
  // App cũ lấy `username` từ danh sách rồi gửi kèm PIN — nếu server bỏ trường đó,
  // app cũ gửi chuỗi rỗng và cả cửa hàng không đăng nhập được.
  const fromOldApp = Auth.listLoginUsers('br1').find(u => u.id === 'u_cash');
  assert.ok(fromOldApp.username, 'app cũ phải có gì đó để gửi');
  assert.equal(Auth.login(fromOldApp.username, '5274', 'br1', { deviceId: 'dev_cu' }).user.username, 'thungan1');
});

test('khoá sau 5 lần sai và KHÔNG bị reset khi server khởi động lại', () => {
  makeUser('u_lock', 'bikhoa', 'cashier');
  for (let i = 0; i < 5; i++) {
    assert.throws(() => Auth.login('bikhoa', '0000', 'br1', { ip: '10.0.0.9' }), /Sai tài khoản/);
  }
  assert.throws(() => Auth.login('bikhoa', '5274', 'br1', { ip: '10.0.0.9' }), /tạm khóa/);

  // Bộ đếm nằm trong DB, không phải RAM → restart không xoá được nó.
  // KHÔNG so until_ms với Date.now(): mỗi lần login chạy scrypt, khi máy đang
  // bận (build song song) cả test có thể kéo dài quá cửa sổ khoá 5 phút và làm
  // phép so đồng hồ hỏng ngẫu nhiên. Điều cần khẳng định là đã ĐẶT khoá.
  const row = db.prepare(`SELECT * FROM login_failures WHERE scope='user' AND key=?`).get('bikhoa');
  assert.ok(row, 'phải có bản ghi đếm sai trong DB');
  assert.ok(row.count >= 5, `đếm đủ số lần sai, thực tế ${row.count}`);
  assert.ok(row.until_ms > row.last_fail_ms, 'đã đặt mốc hết khoá sau lần sai cuối');
});

test('một IP rải đều qua nhiều tài khoản vẫn bị chặn', () => {
  for (let i = 0; i < 12; i++) makeUser(`u_rai${i}`, `nhanvien${i}`, 'cashier');
  const ip = '203.0.113.77';
  // Mỗi tài khoản chỉ sai 2 lần — không tài khoản nào chạm ngưỡng 5 của riêng nó…
  for (let i = 0; i < 12; i++) {
    for (let k = 0; k < 2; k++) {
      try { Auth.login(`nhanvien${i}`, '1111', 'br1', { ip }); } catch {}
    }
  }
  // …nhưng tổng 24 lần từ cùng một IP thì vượt ngưỡng IP.
  const ipRow = db.prepare(`SELECT * FROM login_failures WHERE scope='ip' AND key=?`).get(ip);
  assert.ok(ipRow.count >= 20);
  makeUser('u_sach', 'tuoisach', 'cashier');
  assert.throws(() => Auth.login('tuoisach', '5274', 'br1', { ip }), /tạm khóa/);

  // IP khác không bị vạ lây.
  assert.ok(Auth.login('tuoisach', '5274', 'br1', { ip: '10.0.0.5', deviceId: 'dev_b' }).token);
});

test('đăng nhập đúng sẽ xoá bộ đếm sai của chính mình', () => {
  makeUser('u_ok', 'binhthuong', 'cashier');
  try { Auth.login('binhthuong', '0000', 'br1', { ip: '10.0.0.6' }); } catch {}
  assert.ok(Auth.login('binhthuong', '5274', 'br1', { ip: '10.0.0.6', deviceId: 'dev_c' }).token);
  assert.equal(db.prepare(`SELECT * FROM login_failures WHERE scope='user' AND key=?`).get('binhthuong'), undefined);
});
