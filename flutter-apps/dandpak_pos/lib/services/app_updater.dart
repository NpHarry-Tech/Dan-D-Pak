import 'dart:io';

import '../app_version.dart';
import 'api_service.dart';
import 'app_log.dart';

/// Thông tin một bản cập nhật khả dụng trên server.
class UpdateInfo {
  final int buildNumber;
  final String version;
  final String notes;
  final String url; // đường dẫn tương đối, vd /api/app/download/windows
  final bool mandatory;
  const UpdateInfo({
    required this.buildNumber,
    required this.version,
    required this.notes,
    required this.url,
    required this.mandatory,
  });
}

/// Auto-update: hỏi server có bản mới hơn bản đang chạy không, tải về và cài.
///
/// - Windows (desktop): tải setup.exe → chạy → thoát app để installer cài đè
///   (installer dùng cùng AppId nên NÂNG CẤP TẠI CHỖ, giữ nguyên dữ liệu).
/// - Android: tải apk rồi mở trình cài đặt hệ thống (làm sau khi có bản APK).
class AppUpdater {
  /// Nền tảng gửi cho server. iOS/khác → null (chưa hỗ trợ tự cập nhật).
  static String? get _platform {
    if (Platform.isWindows) return 'windows';
    if (Platform.isAndroid) return 'android';
    return null;
  }

  /// Trả về bản cập nhật nếu server có build MỚI HƠN bản đang chạy, else null.
  static Future<UpdateInfo?> checkForUpdate(ApiService api) async {
    final platform = _platform;
    if (platform == null) return null;
    try {
      final decoded = await api.getJson(
        '/api/app/version?platform=$platform',
        errorMessage: 'Không kiểm tra được cập nhật',
      );
      if (decoded is! Map) return null;
      final build = (decoded['buildNumber'] as num?)?.toInt() ?? 0;
      final available = decoded['available'] == true;
      final url = (decoded['url'] ?? '').toString();
      if (!available || url.isEmpty || build <= kAppBuildNumber) return null;
      return UpdateInfo(
        buildNumber: build,
        version: (decoded['version'] ?? '').toString(),
        notes: (decoded['notes'] ?? '').toString(),
        url: url,
        mandatory: decoded['mandatory'] == true,
      );
    } catch (e) {
      dlog('checkForUpdate failed: $e');
      return null; // im lặng — cập nhật không bao giờ được cản trở bán hàng
    }
  }

  /// Tải bản cài về rồi khởi chạy. Trả lỗi (String) nếu thất bại, null nếu OK
  /// (khi OK, với Windows app sẽ tự thoát để installer cài đè).
  static Future<String?> downloadAndInstall(ApiService api, UpdateInfo info) async {
    final platform = _platform;
    if (platform == null) return 'Nền tảng này chưa hỗ trợ tự cập nhật';
    try {
      final bytes = await api.getBytes(
        info.url,
        timeout: const Duration(minutes: 8),
        errorMessage: 'Tải bản cập nhật thất bại',
      );
      if (bytes.isEmpty) return 'Bản cập nhật tải về rỗng';

      final ext = platform == 'android' ? 'apk' : 'exe';
      final dir = Directory.systemTemp.createTempSync('dandpak_update_');
      final file = File('${dir.path}/dan-d-pak-update.$ext');
      await file.writeAsBytes(bytes, flush: true);

      if (platform == 'windows') {
        // Chạy installer rồi thoát app NGAY để không khoá file .exe đang chạy.
        // Installer (Inno, cùng AppId) sẽ cài đè và tự mở lại app khi xong.
        await Process.start(file.path, [], mode: ProcessStartMode.detached);
        await Future.delayed(const Duration(milliseconds: 400));
        exit(0);
      }

      // Android: mở apk bằng trình cài đặt hệ thống. Cần plugin/intent — sẽ bổ
      // sung khi bản APK sẵn sàng. Tạm thời báo đường dẫn đã tải.
      return 'Đã tải bản cập nhật về ${file.path}. Mở file này để cài (Android).';
    } catch (e) {
      dlog('downloadAndInstall failed: $e');
      return e.toString().replaceFirst('Exception: ', '');
    }
  }
}
