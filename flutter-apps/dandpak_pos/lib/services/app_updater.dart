import 'dart:io';

import 'package:flutter/services.dart';
import 'package:path_provider/path_provider.dart';

import '../app_version.dart';
import 'api_service.dart';
import 'app_log.dart';
import 'black_box.dart';
import 'system_log.dart';

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
/// - Windows (desktop): tải setup.exe → chạy IM LẶNG → thoát app để installer
///   cài đè (cùng AppId nên NÂNG CẤP TẠI CHỖ, giữ dữ liệu, xong tự mở lại app).
/// - Android: tải apk → FileProvider → mở trình cài đặt hệ thống; lần đầu có
///   thể phải cấp quyền "Cài ứng dụng từ nguồn này" (app tự dẫn tới màn đó).
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
      // Android: PHẢI nằm trong getCacheDir() (path_provider) vì FileProvider
      // chỉ chia sẻ được cache-path (systemTemp trỏ vào code_cache — không share
      // được). Dùng thư mục cố định để bản sau ghi đè bản trước, không rác máy.
      final base = platform == 'android'
          ? (await getTemporaryDirectory()).path
          : Directory.systemTemp.path;
      final dir = Directory('$base/dandpak_update')..createSync(recursive: true);
      final file = File('${dir.path}/dan-d-pak-update.$ext');
      await file.writeAsBytes(bytes, flush: true);

      if (platform == 'windows') {
        // Cài IM LẶNG: không wizard, tự dùng lại thư mục cài cũ
        // (UsePreviousAppDir=yes), cài xong tự mở lại app ([Run] postinstall).
        // Thoát app NGAY sau khi khởi chạy để không khoá file .exe đang chạy.
        SystemLog.log(
          level: 'info',
          source: 'updater',
          eventType: 'update_started',
          title: 'Bắt đầu cài bản cập nhật ${info.version} (build ${info.buildNumber})',
          action: 'app_update',
        );
        await Process.start(file.path, [
          '/VERYSILENT',
          '/SUPPRESSMSGBOXES',
          '/NORESTART',
          '/SP-',
          '/FORCECLOSEAPPLICATIONS',
        ], mode: ProcessStartMode.detached);
        BlackBox.markCleanExit(); // thoát chủ động để cập nhật — không phải crash
        await Future.delayed(const Duration(milliseconds: 400));
        exit(0);
      }

      // Android: mở trình cài đặt hệ thống qua kênh native (FileProvider).
      const ch = MethodChannel('com.dandpak.pos/updater');
      final res = await ch.invokeMethod<String>('installApk', {'path': file.path});
      if (res == 'NEEDS_PERMISSION') {
        return 'Hãy bật "Cho phép từ nguồn này" cho Dan D Pak POS ở màn cài đặt '
            'vừa mở, rồi quay lại bấm Cập nhật ngay lần nữa.';
      }
      if (res != null && res.isNotEmpty) {
        _logUpdateFailed(info, res);
        return res; // lỗi từ phía native
      }
      SystemLog.log(
        level: 'info',
        source: 'updater',
        eventType: 'update_started',
        title: 'Đã mở trình cài đặt bản ${info.version} (build ${info.buildNumber})',
        action: 'app_update',
      );
      return null; // trình cài đặt đã mở — bấm Cài đặt là xong
    } catch (e) {
      dlog('downloadAndInstall failed: $e');
      final message = e.toString().replaceFirst('Exception: ', '');
      _logUpdateFailed(info, message);
      return message;
    }
  }

  static void _logUpdateFailed(UpdateInfo info, String message) {
    SystemLog.log(
      level: 'error',
      source: 'updater',
      eventType: 'update_failed',
      title: 'Cập nhật bản ${info.version} (build ${info.buildNumber}) thất bại',
      message: message,
      action: 'app_update',
    );
  }
}
