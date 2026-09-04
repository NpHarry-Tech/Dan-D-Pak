// Hằng số HÌNH HỌC SƠ ĐỒ BÀN — dùng CHUNG cho:
//   • Trình thiết kế (management/floor_plan_editor.dart) — có kẻ lưới "+".
//   • Màn POS (pos_floor_widgets.dart) — KHÔNG kẻ lưới, chỉ hiển thị.
//
// Đặt ở một nơi để hai bên vẽ CÙNG một lưới → khoảng cách/vị trí bàn ở POS
// GIỐNG HỆT lúc thiết kế (trước đây POS tự tính số cột động + ô chữ nhật nên
// lệch hẳn so với Cài đặt).
library;

import 'dart:math' as math;

/// Số cột lưới mô phỏng bề ngang màn POS. Ô = bề rộng khả dụng / kFloorCols,
/// và Ô VUÔNG (cao = rộng). Bàn đặt tại (pos_x, pos_y) theo đơn vị ô.
const int kFloorCols = 16;

/// Bề ngang một thẻ bàn theo số ô (cao = 1 ô).
const double kTableCells = 1.4;

/// KÍCH THƯỚC Ô để sơ đồ bàn VỪA CẢ HAI CHIỀU mà không cắt bàn (Gate-7). Ô vuông
/// nên tỉ lệ luôn giữ nguyên; chọn cạnh nhỏ hơn giữa (rộng/cột) và (cao/hàng) để
/// không tràn theo bất kỳ chiều nào. KHÔNG nhỏ hơn [minCell] (nhỏ quá thì bóp chữ)
/// — khi đó UI dùng CUỘN thay vì cắt. [maxHeight] vô hạn (đang nằm trong vùng cuộn
/// dọc) hoặc [rows] <= 0 → chỉ theo bề rộng như trước.
///
/// Trước đây POS chỉ tính theo bề rộng (cellW = maxWidth/cols) nên màn RỘNG làm ô
/// cao vống, tổng chiều cao vượt khung → hàng bàn dưới bị CẮT/THIẾU, và tỉ lệ đổi
/// theo màn hình. Hàm này sửa đúng điểm đó.
double floorCellSize({
  required double maxWidth,
  required double maxHeight,
  required int rows,
  int cols = kFloorCols,
  double minCell = 60.0,
}) {
  final safeCols = cols < 1 ? 1 : cols;
  final byWidth = maxWidth / safeCols;
  final byHeight =
      (maxHeight.isFinite && rows > 0) ? maxHeight / rows : double.infinity;
  final fit = math.min(byWidth, byHeight);
  final chosen = fit.isFinite ? fit : byWidth;
  return math.max(chosen, minCell);
}
