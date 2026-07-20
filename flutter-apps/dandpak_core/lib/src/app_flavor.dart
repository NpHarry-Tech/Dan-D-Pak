/// Cấu hình theo từng "vị" ứng dụng (desktop / tablet / phone).
///
/// Đây là ĐIỂM PHÂN HOÁ DUY NHẤT giữa 3 app: toàn bộ code lõi (models, providers,
/// screens, services, ui, widgets) sống chung MỘT nơi trong `dandpak_core`. Mỗi app
/// chỉ khai báo:
///   - [appId]      : định danh máy (đi vào hộp đen / nhật ký để biết lỗi ở app nào)
///   - [versionName]/[buildNumber] : lấy từ app_version.dart của CHÍNH app đó
///   - [enabledModuleKeys] : BỘ MODULE hiển thị trên thiết bị này (khác số lượng module)
///   - [layout]     : tinh chỉnh cách sắp xếp UX (cùng ngôn ngữ thiết kế, khác bố cục)
///
/// Nhờ vậy 3 app "giống nhau về module/tính năng nhưng khác số lượng module, có vài
/// tính năng đặc thù và cách sắp xếp UX riêng" — mà không nhân bản code.
class AppFlavor {
  const AppFlavor({
    required this.appId,
    required this.versionName,
    required this.buildNumber,
    this.enabledModuleKeys,
    this.layout = AppLayout.station,
  });

  /// 'dandpak_desktop' | 'dandpak_tablet' | 'dandpak_phone'
  final String appId;
  final String versionName;
  final int buildNumber;

  /// Bộ key module được phép hiện trên thiết bị này (khớp `key` trong
  /// server/services/modules.js). `null` = hiện tất cả theo quyền (hành vi cũ,
  /// tương thích ngược 100%).
  final Set<String>? enabledModuleKeys;

  /// Gợi ý bố cục cho từng lớp thiết bị (giữ chung ngôn ngữ thiết kế).
  final AppLayout layout;

  /// Thiết bị này có được phép mở module [key] không.
  bool showsModule(String key) =>
      enabledModuleKeys == null || enabledModuleKeys!.contains(key);

  bool get isStation => layout == AppLayout.station;
  bool get isTablet => layout == AppLayout.tablet;
  bool get isHandset => layout == AppLayout.handset;

  // --- Vị hiện tại của tiến trình (đặt 1 lần trong runDandpakApp) -----------
  static AppFlavor _current = const AppFlavor(
    appId: 'dandpak',
    versionName: '0',
    buildNumber: 0,
  );

  /// Vị đang chạy. Được `runDandpakApp` gán ngay đầu tiến trình; hộp đen / nhật
  /// ký đọc [appId]/[versionName]/[buildNumber] từ đây thay cho hằng số cứng.
  static AppFlavor get current => _current;
  static set current(AppFlavor flavor) => _current = flavor;
}

/// Lớp bố cục theo thiết bị — dùng để mỗi app tự sắp xếp UX riêng mà vẫn giữ
/// chung bộ màu/typography/spacing (design tokens ở `ui/app_theme.dart`).
enum AppLayout {
  /// Quầy desktop: nhiều cột, thao tác chuột + phím, cửa sổ phụ màn khách.
  station,

  /// Máy tính bảng cầm tay tại bàn: cảm ứng, lưới lớn, ít cột.
  tablet,

  /// Điện thoại: một cột, thao tác duyệt/xem nhanh.
  handset,
}
