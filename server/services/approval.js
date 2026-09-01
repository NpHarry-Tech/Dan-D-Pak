// CENTRAL MANAGER APPROVAL SERVICE (§1/§13-15).
//
// Một nơi DUY NHẤT xác thực uỷ quyền Quản lý/Admin cho thao tác nhạy cảm — thay
// cho việc mỗi màn/route tự kiểm PIN một kiểu. Đặc tính:
//   • xác thực dựa QUYỀN thật của người duyệt (verifyPinHasPerm): đúng PIN + đúng
//     branch access + có required_permission — sai bất kỳ điều nào → DENY;
//   • ONE-SHOT token có SCOPE (branch + action + target) + TTL ngắn + chống replay;
//   • KHÔNG log/lưu PIN plaintext (chỉ so khớp hash qua verifyPin; chỉ lưu người
//     duyệt + scope + thời điểm);
//   • tenant tách vật lý theo instance/DB → không thể cross-tenant.
import { db, uid, now, audit } from '../db.js';
import { verifyPinHasPerm } from './auth.js';

const DEFAULT_TTL_MS = 120 * 1000; // 2 phút — đủ để hoàn tất thao tác, đủ ngắn để an toàn.

function err(message, status, code) { const e = new Error(message); e.status = status; e.code = code; return e; }

let ready = false;
function ensure() {
  if (ready) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS manager_approvals (
      id TEXT PRIMARY KEY,
      branch_id TEXT NOT NULL,
      action TEXT NOT NULL,
      target_id TEXT NOT NULL DEFAULT '',
      required_perm TEXT NOT NULL,
      approver TEXT NOT NULL,
      requested_by TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_manager_approvals_scope
      ON manager_approvals(branch_id, action, target_id);
  `);
  ready = true;
}

// Xác thực INLINE (one-shot per lời gọi — PIN kiểm mỗi lần, không cache/không nâng
// quyền lâu dài §15). Trả approver hoặc THROW. Dùng khi mutation gửi kèm PIN.
export function authorize({ branch_id, action, target_id = '', required_perm, pin, requested_by = 'system' }) {
  ensure();
  if (!branch_id || !action || !required_perm) throw err('Thiếu ngữ cảnh uỷ quyền.', 400, 'APPROVAL_BAD_CONTEXT');
  const approver = verifyPinHasPerm(pin, required_perm, branch_id); // PIN + branch + perm
  if (!approver) throw err('Uỷ quyền bị từ chối: PIN sai, sai chi nhánh, hoặc không đủ quyền.', 403, 'APPROVAL_DENIED');
  audit('approval.authorized', { action, target_id, required_perm, approver: approver.username, requested_by }, branch_id, approver.username);
  return approver;
}

// Cấp ONE-SHOT TOKEN có scope + TTL. Dùng cho UI pre-authorize (vd màn trả hàng
// một phần: duyệt trước rồi mới submit). KHÔNG chứa PIN.
export function grantApproval({ branch_id, action, target_id = '', required_perm, pin, requested_by = 'system', ttlMs = DEFAULT_TTL_MS }) {
  const approver = authorize({ branch_id, action, target_id, required_perm, pin, requested_by });
  const id = uid('appr_');
  const created = now();
  const expires = new Date(Date.now() + Math.max(1000, ttlMs)).toISOString();
  db.prepare(`INSERT INTO manager_approvals
    (id,branch_id,action,target_id,required_perm,approver,requested_by,created_at,expires_at,used_at)
    VALUES (?,?,?,?,?,?,?,?,?,NULL)`)
    .run(id, branch_id, action, target_id, required_perm, approver.username, requested_by, created, expires);
  return { token: id, expires_at: expires, approver: { username: approver.username, name: approver.name } };
}

// Tiêu thụ token (ONE-SHOT). Kiểm scope khớp + chưa dùng + chưa hết hạn. Đánh dấu
// used → replay lần hai bị từ chối. Trả username người duyệt hoặc THROW.
export function consumeApproval(token, { branch_id, action, target_id = '' }) {
  ensure();
  const row = db.prepare(`SELECT * FROM manager_approvals WHERE id=?`).get(String(token || ''));
  if (!row) throw err('Uỷ quyền không hợp lệ.', 403, 'APPROVAL_INVALID');
  if (row.used_at) throw err('Uỷ quyền đã được dùng (chống dùng lại).', 409, 'APPROVAL_REPLAY');
  if (Date.parse(row.expires_at) < Date.now()) throw err('Uỷ quyền đã hết hạn.', 410, 'APPROVAL_EXPIRED');
  if (row.branch_id !== branch_id || row.action !== action || row.target_id !== String(target_id || '')) {
    throw err('Uỷ quyền không đúng phạm vi thao tác.', 403, 'APPROVAL_SCOPE_MISMATCH');
  }
  db.prepare(`UPDATE manager_approvals SET used_at=? WHERE id=? AND used_at IS NULL`).run(now(), row.id);
  // Xác nhận đã đánh dấu (chống race hai lần tiêu thụ đồng thời).
  const after = db.prepare(`SELECT used_at FROM manager_approvals WHERE id=?`).get(row.id);
  if (!after?.used_at) throw err('Uỷ quyền đã được dùng.', 409, 'APPROVAL_REPLAY');
  audit('approval.consumed', { action, target_id, approver: row.approver }, branch_id, row.approver);
  return row.approver;
}
