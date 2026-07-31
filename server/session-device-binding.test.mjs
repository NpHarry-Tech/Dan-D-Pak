// Phiên đăng nhập phải gắn với THIẾT BỊ: token rút được từ máy này không dùng
// lại được ở máy khác. Đây là lớp chặn cho kịch bản app bị hook / máy bị chiếm
// / tablet root — nơi token trên đĩa phải coi như đã lộ.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-session-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');

const { db, migrate, now } = await import('./db.js');
const { hashPin, newToken, tokenDigest } = await import('./services/pin.js');
const Auth = await import('./services/auth.js');

migrate();

function makeUser(username) {
  const id = `u_${username}`;
  db.prepare(`INSERT INTO users (id,branch_id,username,name,pin,role,active) VALUES (?,?,?,?,?,?,1)`)
    .run(id, 'sala', username, username, hashPin('4821'), 'cashier');
  return id;
}

test('a token copied to another device is rejected and the session is killed', () => {
  makeUser('binder');
  const { token } = Auth.login('binder', '4821', 'sala', { deviceId: 'dev_till_01' });

  // Đúng máy → dùng bình thường.
  assert.equal(Auth.userFor(token, 'dev_till_01')?.username, 'binder');

  // Token bị chép sang máy khác → từ chối. Phải chặn được KỂ CẢ khi phiên đang
  // nằm trong cache RAM, nếu không cache trở thành đường vòng qua mặt kiểm tra.
  assert.equal(Auth.userFor(token, 'dev_attacker'), null);

  // Và phiên bị huỷ hẳn: máy gốc cũng phải đăng nhập lại (token coi như đã lộ).
  assert.equal(Auth.userFor(token, 'dev_till_01'), null);
});

test('sessions created before this change bind to the first device that uses them', () => {
  const userId = makeUser('legacy');
  // Mô phỏng phiên cũ: có trong DB nhưng chưa gắn thiết bị.
  const token = newToken();
  const digest = tokenDigest(token);
  const ts = now();
  db.prepare(`INSERT INTO auth_sessions (token,user_id,branch_id,created_at,last_seen_at,device_id) VALUES (?,?,?,?,?,NULL)`)
    .run(digest, userId, 'sala', ts, ts);

  // Lần dùng đầu tiên gắn thiết bị — nhân viên đang làm việc không bị đá ra.
  assert.equal(Auth.userFor(token, 'dev_till_02')?.username, 'legacy');
  assert.equal(
    db.prepare(`SELECT device_id FROM auth_sessions WHERE token=?`).get(digest).device_id,
    'dev_till_02');

  // Từ đó trở đi ràng buộc có hiệu lực.
  assert.equal(Auth.userFor(token, 'dev_other'), null);
});

test('a client that sends no device id still works and does not bind the session', () => {
  makeUser('oldapp');
  const { token } = Auth.login('oldapp', '4821', 'sala', { deviceId: 'dev_till_03' });

  // Bản app cũ chưa gửi header → không chặn (tránh làm hỏng máy chưa cập nhật).
  assert.equal(Auth.userFor(token, '')?.username, 'oldapp');
  // Nhưng ràng buộc đã có vẫn giữ nguyên, không bị xoá bởi request thiếu header.
  assert.equal(
    db.prepare(`SELECT device_id FROM auth_sessions WHERE token=?`).get(tokenDigest(token)).device_id,
    'dev_till_03');
  assert.equal(Auth.userFor(token, 'dev_somewhere_else'), null);
});
