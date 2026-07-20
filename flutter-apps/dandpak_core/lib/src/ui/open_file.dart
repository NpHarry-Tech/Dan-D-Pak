import 'dart:io';

import 'package:share_plus/share_plus.dart';

import '../services/system_log.dart';

/// Writes [bytes] to a temp file and opens it with the OS default app.
/// Used for report/document exports (HTML opens in browser → print to PDF,
/// XLS in Excel, etc.). Returns the file path.
///
/// Plugin/OS mở file lỗi → ném lỗi NGHIỆP VỤ tiếng Việt (caller hiện toast)
/// và ghi nhật ký hệ thống — không bao giờ để lỗi native nổ chết app.
Future<String> openBytes(List<int> bytes, String filename) async {
  final dir = await Directory.systemTemp.createTemp('dandpak_');
  // filename can come from user-uploaded document names — keep only a plain
  // base name so it can never traverse out of the temp dir (e.g. "..\..\x").
  var safe = filename
      .replaceAll(RegExp(r'[/\\]'), '_')
      .replaceAll(RegExp(r'[<>:"|?*\x00-\x1F]'), '_')
      .replaceAll(RegExp(r'^\.+'), '');
  if (safe.isEmpty) safe = 'document';
  final file = File('${dir.path}${Platform.pathSeparator}$safe');
  await file.writeAsBytes(bytes, flush: true);
  final path = file.path;
  try {
    if (Platform.isWindows) {
      await Process.start('explorer.exe', [path]);
    } else if (Platform.isMacOS) {
      await Process.start('open', [path]);
    } else if (Platform.isAndroid || Platform.isIOS) {
      // Tablet/điện thoại: mở khay chia sẻ để xem/lưu file (không có xdg-open).
      await Share.shareXFiles([XFile(path)], subject: safe);
    } else {
      await Process.start('xdg-open', [path]);
    }
  } catch (e) {
    SystemLog.log(
      level: 'error',
      source: 'flutter_app',
      eventType: 'plugin_error',
      title: 'Mở/chia sẻ file xuất thất bại',
      message: '$e',
      action: 'open_export',
      exceptionType: e.runtimeType.toString(),
      extra: {'file': safe},
    );
    throw Exception('Đã lưu file nhưng không mở được ($safe). File nằm ở: $path');
  }
  return path;
}
