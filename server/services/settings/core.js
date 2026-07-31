// Điểm gom của module Cài đặt: đọc/ghi TOÀN BỘ nhóm cấu hình trong một lần
// gọi (API GET/POST /settings/app), cộng thêm mật khẩu thiết bị khách (iPad).
//
// Mỗi nhóm cấu hình tự lo schema + chuẩn hoá trong file riêng của nó; file này
// chỉ điều phối: gọi đúng hàm sanitize, ghi xuống DB, audit và bắn realtime.
import { db, now, audit } from '../../db.js';
import { emit } from '../../realtime.js';
import { FIREBASE_SERVICE_ACCOUNT_KEY } from './shared.js';
import { getPrintConfig, sanitizePrintConfig } from './print.js';
import { getOperationsConfig, sanitizeOperationsConfig } from './operations.js';
import { getRetailConfig, sanitizeRetailConfig } from './retail.js';
import { getSalesModules, sanitizeSalesModules } from './salesModules.js';
import { getLoyaltyConfig, sanitizeLoyaltyConfig } from './loyalty.js';
import { getCustomerDisplayConfig, sanitizeCustomerDisplay } from './customerDisplay.js';
import { getNotificationSoundConfig } from './notifications.js';
import { getTaxFilingProfile, sanitizeTaxFilingProfile } from './taxProfile.js';
import { firebaseConfigured, setFirebaseServiceAccount } from './firebase.js';

const DEFAULTS = {
  ipad_staff_pin: '0000',
};

function storedFourDigitPin(value, fallback = DEFAULTS.ipad_staff_pin) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(0, 4) : fallback;
}

// Mật khẩu 4 số dễ đoán — cấm dùng cho thiết bị khách (kiosk đặt tại bàn, ai
// cũng chạm được nên PIN yếu = mở toang màn nhân viên).
const WEAK_IPAD_PINS = new Set([
  '0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999',
  '1234', '4321', '2345', '3456', '4567', '5678', '6789', '0123', '1212', '2580',
]);

export function getSettings(branch_id = 'sala') {
  const rows = db.prepare(`SELECT key,value FROM app_settings WHERE branch_id=?`).all(branch_id);
  const out = { ...DEFAULTS, ...Object.fromEntries(rows.map(r => [r.key, r.value])) };
  out.ipad_staff_pin = storedFourDigitPin(out.ipad_staff_pin);
  // Cờ để Cài đặt cảnh báo/ép đổi: thiết bị khách còn dùng mật khẩu mặc định 0000.
  out.ipad_pin_is_default = WEAK_IPAD_PINS.has(out.ipad_staff_pin);
  out.print_config = getPrintConfig(branch_id);
  out.operations_config = getOperationsConfig(branch_id);
  out.notification_sound_config = getNotificationSoundConfig(branch_id);
  out.tax_filing_profile = getTaxFilingProfile(branch_id);
  out.customer_display = getCustomerDisplayConfig(branch_id);
  out.loyalty_config = getLoyaltyConfig(branch_id);
  out.retail_config = getRetailConfig(branch_id);
  out.sales_modules = getSalesModules(branch_id);
  // Khoá dịch vụ Firebase (đẩy thông báo) — MÃ HOÁ trong DB, không bao giờ trả
  // nguyên văn qua API. Chỉ báo đã cấu hình hay chưa (xem setFirebaseServiceAccount).
  delete out[FIREBASE_SERVICE_ACCOUNT_KEY];
  out.firebase_configured = firebaseConfigured(branch_id);
  return out;
}

export function updateSettings(body = {}, branch_id = 'sala') {
  const current = getSettings(branch_id);
  const next = {};
  if (body.ipad_staff_pin !== undefined) {
    const pin = String(body.ipad_staff_pin || '').trim();
    if (!/^\d{4}$/.test(pin)) throw new Error('Mật khẩu iPad phải đúng 4 chữ số');
    // Ép đặt mật khẩu MẠNH khi thiết lập: không cho lưu dãy mặc định/dễ đoán
    // (0000/1111/1234…) — chống việc đổi từ mặc định này sang mặc định khác.
    if (WEAK_IPAD_PINS.has(pin)) throw new Error('Mật khẩu iPad quá dễ đoán (0000/1111/1234…). Hãy chọn 4 số khác.');
    next.ipad_staff_pin = pin;
  }
  if (body.print_config !== undefined) {
    next.print_config = sanitizePrintConfig({ ...body.print_config, updated_at: now() });
  }
  if (body.operations_config !== undefined) {
    next.operations_config = sanitizeOperationsConfig({ ...body.operations_config, updated_at: now() });
  }
  if (body.notification_sound_config !== undefined) {
    next.notification_sound_config = body.notification_sound_config;
  }
  if (body.tax_filing_profile !== undefined) {
    next.tax_filing_profile = sanitizeTaxFilingProfile(body.tax_filing_profile);
  }
  if (body.customer_display !== undefined) {
    next.customer_display = sanitizeCustomerDisplay(body.customer_display);
  }
  if (body.loyalty_config !== undefined) {
    next.loyalty_config = sanitizeLoyaltyConfig(body.loyalty_config);
  }
  if (body.retail_config !== undefined) {
    next.retail_config = sanitizeRetailConfig(body.retail_config);
  }
  if (body.sales_modules !== undefined) {
    next.sales_modules = sanitizeSalesModules(body.sales_modules);
  }
  // Mã hoá + lưu riêng qua setFirebaseServiceAccount (không đi qua vòng lặp
  // ins bên dưới) — key này PHẢI luôn ở dạng enc:v1:..., không bao giờ JSON thô.
  if (body.firebase_service_account !== undefined) {
    setFirebaseServiceAccount(body.firebase_service_account, branch_id);
  }
  const ins = db.prepare(`INSERT OR REPLACE INTO app_settings (branch_id,key,value,updated_at) VALUES (?,?,?,?)`);
  for (const [key, value] of Object.entries(next)) {
    ins.run(branch_id, key, typeof value === 'object' ? JSON.stringify(value) : value, now());
  }
  audit('settings.update', { keys: Object.keys(next) }, branch_id);
  // Đồng bộ đa thiết bị: mọi máy đang mở (POS/tablet/KDS) tự tải lại config
  // (phương thức thanh toán, âm báo, màn khách...) ngay khi settings đổi.
  emit('settings:updated', { keys: Object.keys(next) }, branch_id);
  // firebase_configured PHẢI đọc lại SAU khi setFirebaseServiceAccount() đã
  // lưu xong — `current` chụp TRƯỚC dòng đó nên vẫn mang giá trị cũ (đúng lỗi
  // "server không xác nhận firebase_configured=true" dù khoá đã lưu thành công).
  return { ...current, ...next, firebase_configured: firebaseConfigured(branch_id) };
}

export function verifyIpadStaffPin(pin, branch_id = 'sala') {
  return String(pin || '') === getSettings(branch_id).ipad_staff_pin;
}
