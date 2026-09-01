// Cấu hình bán RETAIL — màn "Cài đặt → Kho & kênh bán".
//
// Hai "mặt trận" bán retail: POS bán lẻ độc lập (standalone) và mục "Thêm
// retail" trong POS F&B (fnb). Mỗi bên chọn KHO lấy hàng + BẢNG GIÁ riêng;
// sync=true → fnb dùng y cấu hình standalone (tick "đồng bộ cả 2").
import { RETAIL_CONFIG_KEY, readJsonSetting } from './shared.js';

const DEFAULT_RETAIL_CONFIG = {
  sync: true,
  standalone: { warehouse_id: '', price_book_id: 'default' },
  fnb: { warehouse_id: '', price_book_id: 'default' },
};

function sanitizeRetailSection(raw = {}) {
  return {
    // '' = theo liên kết kênh bán của kho (hành vi cũ, không ép kho cụ thể).
    warehouse_id: String(raw?.warehouse_id || '').slice(0, 80),
    price_book_id: String(raw?.price_book_id || 'default').slice(0, 80) || 'default',
  };
}

export function sanitizeRetailConfig(raw = {}) {
  const standalone = sanitizeRetailSection(raw.standalone);
  const sync = raw.sync !== false;
  return {
    sync,
    standalone,
    fnb: sync ? { ...standalone } : sanitizeRetailSection(raw.fnb),
  };
}

export function getRetailConfig(branch_id = 'sala') {
  return readJsonSetting(
    branch_id,
    RETAIL_CONFIG_KEY,
    (parsed) => sanitizeRetailConfig({ ...DEFAULT_RETAIL_CONFIG, ...parsed }),
    DEFAULT_RETAIL_CONFIG,
  );
}
