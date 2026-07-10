import 'package:flutter/material.dart';

import '../services/black_box.dart';
import '../services/system_log.dart';
import '../ui/app_theme.dart';

/// Chuẩn chung cho MỌI thao tác người dùng chạm-để-làm (thanh toán, gửi bếp,
/// chuyển bàn, in bill…) — "safeAction" của crash hardening:
///
///  • CHỐNG DOUBLE-TAP: cùng một [key] đang chạy thì lần bấm sau bị nuốt.
///  • TRY/CATCH TRỌN GÓI: lỗi được hiện SnackBar + ghi nhật ký hệ thống
///    (screen/action/correlationId đầy đủ) — không bao giờ nổ lên tới zone.
///  • LOADING LOCK: [isActionRunning] để disable nút / hiện spinner.
///  • KHÔNG ĐỘNG UI SAU DISPOSE: mọi setState/SnackBar đều qua kiểm tra
///    `mounted` — màn bị đóng giữa chừng thì kết quả bị bỏ lặng lẽ.
///
/// Dùng:
/// ```dart
/// class _MyScreenState extends State<MyScreen> with SafeActionMixin {
///   Widget build(_) => FilledButton(
///     onPressed: isActionRunning('pay') ? null : () => runSafe('pay', () async {
///       await api.payOrder(...);
///     }),
///   );
/// }
/// ```
mixin SafeActionMixin<T extends StatefulWidget> on State<T> {
  final Set<String> _runningActions = <String>{};

  /// Nút đang chạy thao tác này? — dùng để disable/spinner.
  bool isActionRunning(String key) => _runningActions.contains(key);

  /// true nếu BẤT KỲ thao tác safe nào đang chạy (khóa cả form).
  bool get anyActionRunning => _runningActions.isNotEmpty;

  /// Chạy [body] an toàn dưới khóa [key]. Trả về true nếu body chạy xong không
  /// lỗi. [flow] (nếu truyền) mở một correlationId xuyên suốt mọi request bên
  /// trong (truy vết Flutter → API → server → máy in).
  Future<bool> runSafe(
    String key,
    Future<void> Function() body, {
    String? flow,
    String? errorPrefix,
    bool showError = true,
    VoidCallback? onError,
  }) async {
    if (_runningActions.contains(key)) return false; // double-tap → nuốt
    _runningActions.add(key);
    if (mounted) setState(() {});
    BlackBox.add('action', key);
    try {
      if (flow != null) {
        await SystemLog.runFlow(flow, body);
      } else {
        await body();
      }
      return true;
    } catch (e, st) {
      final message = e.toString().replaceFirst('Exception: ', '');
      SystemLog.log(
        level: 'error',
        source: 'flutter_app',
        eventType: 'action_failed',
        title: 'Thao tác "$key" thất bại',
        message: message,
        action: key,
        exceptionType: e.runtimeType.toString(),
        stackTrace: st.toString(),
      );
      if (mounted && showError) {
        ScaffoldMessenger.maybeOf(context)?.showSnackBar(SnackBar(
          content: Text(
              errorPrefix == null ? message : '$errorPrefix: $message'),
          backgroundColor: DanColors.late,
        ));
      }
      onError?.call();
      return false;
    } finally {
      _runningActions.remove(key);
      if (mounted) setState(() {});
    }
  }
}

/// Bản hàm rời cho chỗ không tiện dùng mixin (dialog/sheet builder…):
/// chống lỗi nổ + ghi nhật ký, nhưng KHÔNG có khóa double-tap theo key
/// (caller tự quản cờ busy nếu cần).
Future<bool> safeCall(
  BuildContext? context,
  String action,
  Future<void> Function() body, {
  bool showError = true,
}) async {
  BlackBox.add('action', action);
  try {
    await body();
    return true;
  } catch (e, st) {
    final message = e.toString().replaceFirst('Exception: ', '');
    SystemLog.log(
      level: 'error',
      source: 'flutter_app',
      eventType: 'action_failed',
      title: 'Thao tác "$action" thất bại',
      message: message,
      action: action,
      exceptionType: e.runtimeType.toString(),
      stackTrace: st.toString(),
    );
    if (showError && context != null && context.mounted) {
      ScaffoldMessenger.maybeOf(context)?.showSnackBar(SnackBar(
        content: Text(message),
        backgroundColor: DanColors.late,
      ));
    }
    return false;
  }
}
