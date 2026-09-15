import 'dart:io';

import 'package:flutter/foundation.dart';

/// Đối số cho rundll32 để mở [url] trên Windows — TÁCH RIÊNG khỏi Process.start
/// để test được việc URL (nhiều query param, %-encode, state/redirect_uri lồng
/// nhau) không bị cắt/biến dạng, mà không cần bật trình duyệt thật trong test.
///
/// rundll32 gọi thẳng Win32 (không qua cmd.exe), nên toàn bộ URL được truyền
/// nguyên vẹn cho FileProtocolHandler bất kể có chứa & — khác với
/// `cmd /c start "" url` (bug cũ): cmd.exe tự parse dòng lệnh và coi & là toán
/// tử nối lệnh, cắt URL tại ký tự & đầu tiên (OAuth query string luôn có nhiều &).
List<String> windowsOpenUrlArgs(String url) => ['url.dll,FileProtocolHandler', url];

/// Mở URL bằng trình duyệt hệ thống. DÙNG CHUNG (tránh mỗi màn tự Process.run).
/// Desktop: rundll32/open/xdg-open. Mobile: chưa có url_launcher trong deps →
/// trả false để UI cho người dùng copy link mở tay.
Future<bool> openExternalUrl(String url) async {
  if (url.isEmpty) return false;
  try {
    if (Platform.isWindows) {
      await Process.start('rundll32', windowsOpenUrlArgs(url));
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
