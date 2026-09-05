// Khoá dịch vụ FIREBASE CLOUD MESSAGING (đẩy thông báo).
//
// Cùng cơ chế encryptSecret/decryptSecret (AES-256-GCM) đang dùng cho token/
// secret tích hợp (Haravan…) — không lưu file .json thô trên đĩa máy chủ, và
// không bao giờ trả nguyên văn qua API (xem getSettings: chỉ trả cờ đã cấu hình).
import { db, now, audit } from '../../db.js';
import { decryptSecret, encryptSecret, secretContext } from '../../core/crypto.js';
import { FIREBASE_SERVICE_ACCOUNT_KEY } from './shared.js';

const FIREBASE_REQUIRED_FIELDS = ['project_id', 'private_key', 'client_email'];

function firebaseSecretContext(branch_id) {
  return [
    secretContext({ tenant: branch_id, provider: 'firebase', record: FIREBASE_SERVICE_ACCOUNT_KEY, field: 'service_account' }),
    `settings:${branch_id}:${FIREBASE_SERVICE_ACCOUNT_KEY}`,
  ];
}

/** Đọc + giải mã service-account (dùng NỘI BỘ để khởi tạo firebase-admin và
 *  gửi push) — KHÔNG BAO GIỜ gọi hàm này từ một route trả thẳng ra client. */
export function getFirebaseServiceAccount(branch_id = 'sala') {
  const row = db.prepare(`SELECT value FROM app_settings WHERE branch_id=? AND key=?`)
    .get(branch_id, FIREBASE_SERVICE_ACCOUNT_KEY);
  if (!row?.value) return null;
  try {
    return JSON.parse(decryptSecret(row.value, firebaseSecretContext(branch_id)));
  } catch {
    return null; // khoá hỏng/giải mã lệch context → coi như chưa cấu hình
  }
}

export function firebaseConfigured(branch_id = 'sala') {
  return !!getFirebaseServiceAccount(branch_id);
}

/** Public-safe health state; never exposes ciphertext or service credentials. */
export function firebaseConfigurationStatus(branch_id = 'sala') {
  const row = db.prepare(`SELECT value FROM app_settings WHERE branch_id=? AND key=?`)
    .get(branch_id, FIREBASE_SERVICE_ACCOUNT_KEY);
  if (!row?.value) return 'missing';
  return getFirebaseServiceAccount(branch_id) ? 'ready' : 'unreadable';
}

/** Nhận object HOẶC chuỗi JSON của file service-account tải từ Firebase
 *  Console, xác thực đủ trường bắt buộc, mã hoá rồi lưu — 1 dòng trong
 *  app_settings, không phải file trên đĩa. */
export function setFirebaseServiceAccount(raw, branch_id = 'sala') {
  let obj;
  try {
    obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    throw new Error('File service-account không phải JSON hợp lệ');
  }
  for (const field of FIREBASE_REQUIRED_FIELDS) {
    if (!obj?.[field]) throw new Error(`Thiếu trường "${field}" trong file service-account`);
  }
  const encrypted = encryptSecret(JSON.stringify(obj), firebaseSecretContext(branch_id));
  db.prepare(`INSERT OR REPLACE INTO app_settings (branch_id,key,value,updated_at) VALUES (?,?,?,?)`)
    .run(branch_id, FIREBASE_SERVICE_ACCOUNT_KEY, encrypted, now());
  audit('settings.firebase_configured', { project_id: obj.project_id }, branch_id);
  return { ok: true, project_id: obj.project_id, client_email: obj.client_email };
}
