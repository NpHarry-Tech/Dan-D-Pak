// Cấu hình BÁN HÀNG — màn "Cài đặt → Thiết lập bán hàng" của bản điện thoại.
//
// TỪNG KHÔNG ĐƯỢC LƯU: màn Cài đặt gửi `sell_config` lên /api/settings/app,
// nhưng `updateSettings` chỉ ghi những khoá nằm trong danh sách của nó và khoá
// này không hề tồn tại phía server — cả repo không có một chỗ nào nhắc tới
// `sell_config`. Request trả 200, người dùng bấm công tắc thấy nó gạt sang,
// thoát ra vào lại là về mặc định. Đọc cũng hỏng theo cùng một lý do như
// notification_routing_config: giá trị thô trong app_settings là CHUỖI JSON nên
// client kiểm `is Map` luôn trượt.
//
// Giữ nguyên tên khoá mà client đang gửi (auto_complete_on_bank,
// merge_same_items, share_after_done, default_method) — đổi tên ở đây là làm
// hỏng các bản app đã phát hành.
import { canonicalMethodKey } from './operations.js';
import { SELL_CONFIG_KEY, bool, readJsonSetting } from './shared.js';

const DEFAULT_SELL_CONFIG = {
  // Ngân hàng báo về là tự chốt bill, thu ngân không phải bấm xác nhận.
  auto_complete_on_bank: false,
  // Gộp các dòng cùng một mặt hàng khi in bill.
  merge_same_items: true,
  // Mở bảng chia sẻ bill ngay sau khi thu tiền xong.
  share_after_done: false,
  // Tab thanh toán mở sẵn khi vào màn thu tiền.
  default_method: 'cash',
};

/// Chỉ nhận 4 phương thức chuẩn. Bản app cũ gửi 'transfer'/'qr'/'card' —
/// canonicalMethodKey quy hết về cash/bank/visa/voucher nên số liệu không vỡ
/// khi máy cũ và máy mới cùng ghi.
function sanitizeMethod(v) {
  const key = canonicalMethodKey(v);
  return ['cash', 'bank', 'visa', 'voucher'].includes(key)
    ? key
    : DEFAULT_SELL_CONFIG.default_method;
}

export function sanitizeSellConfig(raw = {}) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    auto_complete_on_bank: bool(src.auto_complete_on_bank, DEFAULT_SELL_CONFIG.auto_complete_on_bank),
    merge_same_items: bool(src.merge_same_items, DEFAULT_SELL_CONFIG.merge_same_items),
    share_after_done: bool(src.share_after_done, DEFAULT_SELL_CONFIG.share_after_done),
    default_method: sanitizeMethod(src.default_method),
  };
}

export function getSellConfig(branch_id = 'sala') {
  return readJsonSetting(
    branch_id,
    SELL_CONFIG_KEY,
    (parsed) => sanitizeSellConfig({ ...DEFAULT_SELL_CONFIG, ...parsed }),
    DEFAULT_SELL_CONFIG,
  );
}
