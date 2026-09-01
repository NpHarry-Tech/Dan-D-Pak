import 'dart:io';

import 'package:flutter/foundation.dart';

/// Mở URL bằng trình duyệt hệ thống. DÙNG CHUNG (tránh mỗi màn tự Process.run).
/// Desktop: cmd/open/xdg-open. Mobile: chưa có url_launcher trong deps → trả
/// false để UI cho người dùng copy link mở tay.
Future<bool> openExternalUrl(String url) async {
  if (url.isEmpty) return false;
  try {
    if (Platform.isWindows) {
      await Process.run('cmd', ['/c', 'start', '', url]);
      return true;
    }
    if (Platform.isMacOS) {
      await Process.run('open', [url]);
      return true;
    }
    if (Platform.isLinux) {
      await Process.run('xdg-open', [url]);
      return true;
    }
  } catch (e) {
    debugPrint('openExternalUrl failed: $e');
  }
  return false; // Android/iOS: chưa hỗ trợ mở trực tiếp.
}
