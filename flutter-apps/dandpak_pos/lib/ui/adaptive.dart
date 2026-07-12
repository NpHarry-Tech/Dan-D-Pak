import 'package:flutter/widgets.dart';

/// Chuẩn responsive DUY NHẤT cho cả 3 bản app (desktop / tablet / phone).
///
/// Quy ước (theo Material 3 window size classes, đơn vị dp logic):
///  • compact  (<600)      — điện thoại dọc
///  • medium   (600–1023)  — điện thoại ngang / tablet dọc / cửa sổ hẹp
///  • expanded (≥1024)     — tablet ngang / desktop
///
/// CÁCH DÙNG khi viết/sửa màn hình:
///  • Bố cục 2 cột (menu + giỏ hàng...) chỉ giữ ở [isExpanded]; medium trở
///    xuống chuyển cột phụ thành bottom sheet / trang riêng.
///  • KHÔNG hard-code số cột — dùng [gridCount] hoặc
///    SliverGridDelegateWithMaxCrossAxisExtent.
///  • Máy có tai thỏ/notch: builder gốc của MaterialApp đã SafeArea
///    trái/phải/đáy; màn fullscreen tự thêm SafeArea đỉnh.
///  • Cỡ chữ hệ điều hành đã bị khóa 1.0 ở builder gốc — layout không bao
///    giờ vỡ vì user chỉnh font to.
enum ScreenClass { compact, medium, expanded }

extension AdaptiveContext on BuildContext {
  double get screenWidth => MediaQuery.sizeOf(this).width;
  double get screenHeight => MediaQuery.sizeOf(this).height;

  ScreenClass get screenClass {
    final w = screenWidth;
    if (w < 600) return ScreenClass.compact;
    if (w < 1024) return ScreenClass.medium;
    return ScreenClass.expanded;
  }

  bool get isCompact => screenClass == ScreenClass.compact;
  bool get isMedium => screenClass == ScreenClass.medium;
  bool get isExpanded => screenClass == ScreenClass.expanded;

  /// Chọn giá trị theo cỡ màn: `context.byScreen(compact: 1, medium: 2,
  /// expanded: 4)` — thiếu bậc nào thì rơi về bậc nhỏ hơn gần nhất.
  T byScreen<T>({required T compact, T? medium, T? expanded}) {
    switch (screenClass) {
      case ScreenClass.compact:
        return compact;
      case ScreenClass.medium:
        return medium ?? compact;
      case ScreenClass.expanded:
        return expanded ?? medium ?? compact;
    }
  }

  /// Số cột lưới hợp lý theo bề rộng thật (ưu tiên hơn hard-code):
  /// mỗi ô rộng ~[minTileWidth] dp, kẹp trong [min]..[max].
  int gridCount({double minTileWidth = 180, int min = 1, int max = 8}) {
    final n = (screenWidth / minTileWidth).floor();
    return n.clamp(min, max);
  }
}
