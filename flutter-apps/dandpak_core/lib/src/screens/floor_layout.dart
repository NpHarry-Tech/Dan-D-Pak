// Hằng số HÌNH HỌC SƠ ĐỒ BÀN — dùng CHUNG cho:
//   • Trình thiết kế (management/floor_plan_editor.dart) — có kẻ lưới "+".
//   • Màn POS (pos_floor_widgets.dart) — KHÔNG kẻ lưới, chỉ hiển thị.
//
// Đặt ở một nơi để hai bên vẽ CÙNG một lưới → khoảng cách/vị trí bàn ở POS
// GIỐNG HỆT lúc thiết kế (trước đây POS tự tính số cột động + ô chữ nhật nên
// lệch hẳn so với Cài đặt).
library;

/// Số cột lưới mô phỏng bề ngang màn POS. Ô = bề rộng khả dụng / kFloorCols,
/// và Ô VUÔNG (cao = rộng). Bàn đặt tại (pos_x, pos_y) theo đơn vị ô.
const int kFloorCols = 16;

/// Bề ngang một thẻ bàn theo số ô (cao = 1 ô).
const double kTableCells = 1.4;
