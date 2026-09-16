// Banner quảng cáo đầu màn Menu của BYOD (khách tự gọi món bằng điện thoại) —
// màn "Cài đặt → Hiển thị khách hàng → BYOD". Cùng khuôn với customer_display
// (services/settings/customerDisplay.js): ảnh lưu thành file, settings chỉ
// giữ URL.
import { BYOD_BANNER_KEY, bool, readJsonSetting } from './shared.js';

const DEFAULT_BYOD_BANNER = { enabled: false, secondsPerImage: 5, images: [] };
const BYOD_BANNER_MAX_IMAGES = 8;

export function sanitizeByodBanner(input = {}) {
  const src = input && typeof input === 'object' ? input : {};
  const images = Array.isArray(src.images)
    ? src.images
        .map(x => String(x || ''))
        .filter(x => x.startsWith('http') || x.startsWith('/uploads/byod-banner/'))
        .slice(0, BYOD_BANNER_MAX_IMAGES)
    : [];
  return {
    enabled: bool(src.enabled, false),
    secondsPerImage: Math.max(3, Math.min(30,
      parseInt(src.secondsPerImage) || DEFAULT_BYOD_BANNER.secondsPerImage)),
    images,
  };
}

export function getByodBannerConfig(branch_id = 'sala') {
  return readJsonSetting(branch_id, BYOD_BANNER_KEY, sanitizeByodBanner, DEFAULT_BYOD_BANNER);
}
