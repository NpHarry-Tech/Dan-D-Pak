// Cấu hình MÀN HÌNH PHỤ (màn hướng về khách) — màn "Cài đặt → Màn hình phụ".
//
// Ảnh quảng cáo lưu inline dạng data URL — cùng cách làm với logo hóa đơn, nên
// không cần pipeline upload. Giới hạn số ảnh để dòng settings không phình to.
import { CUSTOMER_DISPLAY_KEY, bool, readJsonSetting } from './shared.js';

const DEFAULT_CUSTOMER_DISPLAY = {
  enabled: false,
  secondsPerImage: 20,
  images: [], // list of 'data:image/...' (or http) URLs
};
const CUSTOMER_DISPLAY_MAX_IMAGES = 12;

export function sanitizeCustomerDisplay(input = {}) {
  const src = input && typeof input === 'object' ? input : {};
  const images = Array.isArray(src.images)
    ? src.images
        .map(x => String(x || ''))
        .filter(x => x.startsWith('data:image/') || x.startsWith('http'))
        .slice(0, CUSTOMER_DISPLAY_MAX_IMAGES)
    : [];
  return {
    enabled: bool(src.enabled, false),
    secondsPerImage: Math.max(5, Math.min(120,
      parseInt(src.secondsPerImage) || DEFAULT_CUSTOMER_DISPLAY.secondsPerImage)),
    images,
  };
}

export function getCustomerDisplayConfig(branch_id = 'sala') {
  return readJsonSetting(branch_id, CUSTOMER_DISPLAY_KEY, sanitizeCustomerDisplay, DEFAULT_CUSTOMER_DISPLAY);
}
