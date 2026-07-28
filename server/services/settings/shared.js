// Helper dùng chung cho MỌI nhóm cấu hình trong settings/.
// Không chứa nghiệp vụ — chỉ ép kiểu và đọc/ghi một dòng app_settings.
import { db, now } from '../../db.js';

// ── Khoá lưu trong bảng app_settings ────────────────────────────────────────
// Mỗi nhóm cấu hình = 1 dòng (branch_id, key) chứa JSON. Gom toàn bộ khoá ở
// đây để nhìn một chỗ là biết hệ thống đang lưu những nhóm cấu hình nào.
export const INTEGRATIONS_KEY = 'integrations_config';
export const PRINT_CONFIG_KEY = 'print_config';
export const OPERATIONS_CONFIG_KEY = 'operations_config';
export const NOTIFICATION_SOUND_KEY = 'notification_sound_config';
export const TAX_FILING_PROFILE_KEY = 'tax_filing_profile';
export const CUSTOMER_DISPLAY_KEY = 'customer_display';
export const LOYALTY_CONFIG_KEY = 'loyalty_config';
export const RETAIL_CONFIG_KEY = 'retail_config';
export const FIREBASE_SERVICE_ACCOUNT_KEY = 'firebase_service_account';

// ── Ép kiểu giá trị từ client ───────────────────────────────────────────────
export function bool(v, fallback = false) {
  if (v === undefined) return fallback;
  return v === true || v === 1 || v === '1' || v === 'true';
}

export function str(v, max = 800) {
  return String(v ?? '').trim().slice(0, max);
}

export function plainObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

export function mergePlain(def, input = {}) {
  return { ...def, ...plainObject(input) };
}

export function nonNegativeInt(v, fallback = 0) {
  const n = parseInt(v);
  return Number.isFinite(n) ? Math.max(0, n) : fallback;
}

export function nonNegativeNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, n) : fallback;
}

// ── Đọc/ghi một dòng app_settings ───────────────────────────────────────────
/** Đọc JSON của một nhóm cấu hình. Thiếu dòng HOẶC JSON hỏng đều rơi về
 *  `fallback` — cấu hình sai định dạng không được phép làm sập màn Cài đặt. */
export function readJsonSetting(branch_id, key, sanitize = (x) => x, fallback = {}) {
  const row = db.prepare(`SELECT value FROM app_settings WHERE branch_id=? AND key=?`)
    .get(branch_id, key);
  if (!row?.value) return sanitize(fallback);
  try { return sanitize(JSON.parse(row.value)); }
  catch { return sanitize(fallback); }
}

export function writeJsonSetting(branch_id, key, value) {
  db.prepare(`INSERT OR REPLACE INTO app_settings (branch_id,key,value,updated_at) VALUES (?,?,?,?)`)
    .run(branch_id, key, JSON.stringify(value), now());
}
