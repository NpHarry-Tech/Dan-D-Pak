
import 'package:flutter/foundation.dart';

import '../app_version.dart';
import 'api_service.dart';
import 'app_log.dart';
import 'black_box.dart';
import 'system_log.dart';

/// Ships client-side runtime errors to the local engine
/// (`POST /api/client-log`) so every error on a POS terminal lands in ONE
/// place — the server log stream — next to request logs and the audit trail.
///
/// Design constraints:
/// - The reporter must NEVER throw or recurse (its own HTTP failures are
///   swallowed, not re-reported).
/// - Throttled (max 20/min) and de-duplicated per run so a render loop can't
///   flood the network or the server disk.
class ClientLog {
  ClientLog._();

  static ApiService? _api;
  static final Set<String> _sentThisRun = {};
  static DateTime _windowStart = DateTime.fromMillisecondsSinceEpoch(0);
  static int _windowCount = 0;

  static void attach(ApiService api) => _api = api;

  /// Install the global Flutter + async error hooks. Call once from main().
  static void installGlobalHooks() {
    final previous = FlutterError.onError;
    FlutterError.onError = (details) {
      previous?.call(details);
      report(details.exception, details.stack,
          context: details.context?.toString() ?? 'flutter');
    };
    PlatformDispatcher.instance.onError = (error, stack) {
      dlog('Uncaught async error: $error');
      report(error, stack, context: 'async');
      return true;
    };
  }

  static void report(Object error, StackTrace? stack, {String context = ''}) {
    try {
      final api = _api;
      if (api == null) return;
      final message = error.toString();
      final now = DateTime.now();
      if (now.difference(_windowStart).inSeconds > 60) {
        _windowStart = now;
        _windowCount = 0;
      }
      if (_windowCount >= 20) return;
      final key =
          message.length > 200 ? message.substring(0, 200) : message;
      if (!_sentThisRun.add(key)) return;
      _windowCount++;
      // Lỗi Dart cũng vào hộp đen — nếu sau đó app chết native thì vệt này
      // nằm ngay trước điểm chết trong hồ sơ.
      BlackBox.add('error', message);
      // Và vào nhật ký hệ thống hợp nhất (system_logs) — queue fail-safe,
      // sống sót qua restart, hiển thị trong màn Nhật ký hoạt động.
      SystemLog.log(
        level: 'error',
        source: 'flutter_app',
        eventType: 'uncaught_exception',
        title: 'Lỗi runtime chưa được bắt ($context)',
        message: message,
        exceptionType: error.runtimeType.toString(),
        stackTrace: (stack ?? StackTrace.current).toString(),
      );
      api.postClientLog({
        'app': 'dandpak_pos',
        'version': '$kAppVersionName+$kAppBuildNumber',
        'screen': '${BlackBox.screen}|$context',
        // Bản này đã tự ghi system_logs (SystemLog.log ở trên) → server đừng
        // mirror thêm lần nữa kẻo 1 lỗi thành 2 dòng nhật ký.
        'mirrored': true,
        'message': message,
        'stack': (stack ?? StackTrace.current).toString(),
        // ~40 thao tác gần nhất (chạm, API, socket, đổi màn) dẫn tới lỗi này.
        'breadcrumbs': BlackBox.recentTrace(),
      }).catchError((_) {});
    } catch (_) {
      // Reporting must never break the app.
    }
  }
}
