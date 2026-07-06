import { db, now } from '../db.js';
import { hashPin } from './pin.js';

const ADMIN_USER = {
  id: 'u_admin',
  branch_id: 'br1',
  username: 'admin',
  name: 'Admin',
  pin: '1234',        // chỉ dùng cho lần tạo đầu tiên (DB rỗng) — KHÔNG ép lại sau đó
  role: 'owner',
  lang: 'vi',
};

// Khôi phục PIN admin một cách CÓ CHỦ ĐÍCH (khi quên), thay cho việc reset ngầm
// mỗi lần khởi động: đặt biến môi trường DANDPAK_ADMIN_RESET_PIN=<4 số> rồi chạy
// server đúng 1 lần. Hệ thống ghi cảnh báo rõ ràng vào nhật ký.
function requestedAdminResetPin() {
  const v = String(process.env.DANDPAK_ADMIN_RESET_PIN || '').trim();
  return /^\d{4}$/.test(v) ? v : null;
}

export function bootstrapDefaultAdmin() {
  db.prepare(`INSERT OR IGNORE INTO branches (id,name,address,code,active,sort) VALUES (?,?,?,?,1,?)`)
    .run('br1', 'Dan D Pak Sala', 'Sala, TP.HCM', 'SALA', 1);

  const hasAdmin = db.prepare(`SELECT 1 FROM users WHERE username=?`).get(ADMIN_USER.username);
  const activeOwners = db.prepare(`SELECT COUNT(*) n FROM users WHERE role='owner' AND active=1`).get().n;
  const totalUsers = db.prepare(`SELECT COUNT(*) n FROM users`).get().n;
  const legacyOwner = db.prepare(`SELECT id FROM users WHERE username='owner' AND role='owner'`).get();
  const resetPin = requestedAdminResetPin();

  if (hasAdmin) {
    // Tự chữa lành vai trò/chi nhánh nhưng TUYỆT ĐỐI không đụng tới PIN — PIN do chủ
    // cửa hàng đặt và được băm; chỉ đổi khi có yêu cầu khôi phục tường minh qua env.
    db.prepare(`
      UPDATE users
      SET role='owner', active=1, branch_id=COALESCE(branch_id,?), branch_access_json='["*"]'
      WHERE username=?
    `).run(ADMIN_USER.branch_id, ADMIN_USER.username);
    if (resetPin) {
      db.prepare(`UPDATE users SET pin=? WHERE username=?`).run(hashPin(resetPin), ADMIN_USER.username);
      db.prepare(`INSERT INTO audit_log (id,branch_id,actor,action,detail,created_at) VALUES (?,?,?,?,?,?)`)
        .run('a_' + Math.random().toString(36).slice(2, 10), ADMIN_USER.branch_id, 'system', 'auth.admin.pin_reset', JSON.stringify({ username: ADMIN_USER.username, via: 'env' }), now());
      return { created: false, pinReset: true, username: ADMIN_USER.username };
    }
    return { created: false, username: ADMIN_USER.username };
  }

  if (legacyOwner) {
    // Đổi tên tài khoản owner cũ -> admin, GIỮ NGUYÊN PIN hiện có.
    db.prepare(`
      UPDATE users
      SET username=?, role='owner', active=1, branch_id=COALESCE(branch_id,?), branch_access_json='["*"]'
      WHERE id=?
    `).run(ADMIN_USER.username, ADMIN_USER.branch_id, legacyOwner.id);
    if (resetPin) db.prepare(`UPDATE users SET pin=? WHERE id=?`).run(hashPin(resetPin), legacyOwner.id);
    return { created: false, renamed: true, username: ADMIN_USER.username };
  }

  if (totalUsers > 0 && activeOwners > 0) {
    return { created: false, skipped: true };
  }

  db.prepare(`
    INSERT INTO users (id,branch_id,username,name,pin,role,active,lang,branch_access_json)
    VALUES (?,?,?,?,?,?,1,?,?)
  `).run(
    ADMIN_USER.id,
    ADMIN_USER.branch_id,
    ADMIN_USER.username,
    ADMIN_USER.name,
    hashPin(resetPin || ADMIN_USER.pin),
    ADMIN_USER.role,
    ADMIN_USER.lang,
    JSON.stringify(['*']),
  );

  db.prepare(`INSERT INTO audit_log (id,branch_id,actor,action,detail,created_at) VALUES (?,?,?,?,?,?)`)
    .run('a_bootstrap_admin', ADMIN_USER.branch_id, 'system', 'auth.bootstrap.admin', JSON.stringify({ username: ADMIN_USER.username }), now());

  return { created: true, username: ADMIN_USER.username };
}
