import 'dart:async';
import 'dart:io' show Platform;

import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:local_notifier/local_notifier.dart';

// Màu khớp DanColors (không import app_theme để app_theme có thể export lại file này
// mà không tạo vòng import): late = đỏ lỗi, text = nền tối thông tin thường.
const Color _kErrorColor = Color(0xFFFF6B6B);
const Color _kInfoColor = Color(0xFF1A2230);

/// Messenger TOÀN CỤC để hiện banner thông báo trong-app trên MỌI nền tảng
/// (desktop/tablet/phone), đăng ký ở `MaterialApp.scaffoldMessengerKey`.
final GlobalKey<ScaffoldMessengerState> appMessengerKey =
    GlobalKey<ScaffoldMessengerState>();

/// Navigator TOÀN CỤC (root) — đăng ký ở `MaterialApp.navigatorKey`. Dùng cho các
/// hộp thoại phải LUÔN mở được bất kể BuildContext của nơi gọi còn sống hay không
/// (vd modal xác nhận quyền Quản lý/Admin). Sửa lỗi modal "thỉnh thoảng không hiện"
/// do context bị dispose/nằm sau await (§16). currentContext null nếu app chưa mount.
final GlobalKey<NavigatorState> appNavigatorKey = GlobalKey<NavigatorState>();

/// MỘT nơi DUY NHẤT phát thông báo cho người dùng (root/DRY) — thay cho việc mỗi
/// màn tự SnackBar / native-notif một kiểu, gây bất đồng bộ UI. Kết hợp:
///  • Native OS notification trên desktop qua local_notifier và Android qua MethodChannel —
///    hiện cả khi app chạy nền (đúng ảnh thông báo desktop khách gửi).
///  • Banner trong-app (SnackBar toàn cục) trên mọi nền tảng — tablet/phone thấy ngay.
class AppNotifier {
  const AppNotifier._();

  static const _androidChannel = MethodChannel('com.dandpak.pos/notifications');
  static final _logo = rootBundle.load('assets/brand/DanOnLogo.png');

  /// Hàm MỞ MỤC THÔNG BÁO — màn đang hiển thị (POS/phone) tự đăng ký ở initState.
  /// Banner thông báo khách (gọi món/gọi nhân viên) hiện nút "Xem" gọi hàm này để
  /// NHẢY THẲNG vào mục xử lý, khỏi tự đi tìm.
  static VoidCallback? onOpenRequested;

  static void show({
    required String title,
    String body = '',
    bool isError = false,
    bool inApp = true,
    bool osNotify = true,
    bool androidNotify = false,
    Duration? duration,
    // true = banner có nút "Xem" bấm để nhảy vào mục thông báo (onOpenRequested).
    bool showViewAction = false,
  }) {
    if (osNotify) _osNotification(title, body, androidNotify);
    if (inApp) _inAppBanner(title, body, isError, showViewAction, duration);
  }

  static void _osNotification(String title, String body, bool androidNotify) {
    try {
      if (kIsWeb) return;
      if (Platform.isAndroid) {
        if (!androidNotify) return;
        unawaited(_showAndroidNotification(title, body));
        return;
      }
      if (!Platform.isWindows && !Platform.isMacOS && !Platform.isLinux) return;
      // show() là BẤT ĐỒNG BỘ: try/catch đồng bộ ở đây KHÔNG bắt được lỗi của
      // nó, lỗi sẽ nổi lên thành unhandled async error và có thể quật ngược vào
      // luồng đang chạy (bắt được lần đầu khi màn bán hàng trên điện thoại văng
      // lúc báo "chưa in được"). Nuốt lỗi ngay trên chính future đó.
      unawaited(
        LocalNotification(title: title, body: body.isEmpty ? title : body)
            .show()
            .catchError((_) {/* thông báo KHÔNG được phá luồng chính */}),
      );
    } catch (_) {/* thông báo KHÔNG được phá luồng chính */}
  }

  static Future<void> _showAndroidNotification(
      String title, String body) async {
    try {
      final logo = await _logo;
      await _androidChannel.invokeMethod('showNotification', {
        'title': title,
        'body': body,
        'logo': logo.buffer.asUint8List(logo.offsetInBytes, logo.lengthInBytes),
      });
    } catch (_) {/* thông báo không được phá luồng chính */}
  }

  static void _inAppBanner(String title, String body, bool isError,
      bool showViewAction, Duration? duration) {
    try {
      final messenger = appMessengerKey.currentState;
      if (messenger == null) return;
      final canOpen = showViewAction && onOpenRequested != null;
      messenger.clearSnackBars();
      messenger.showSnackBar(SnackBar(
        duration:
            duration ?? Duration(seconds: isError ? 5 : (canOpen ? 6 : 3)),
        behavior: SnackBarBehavior.floating,
        backgroundColor: isError ? _kErrorColor : _kInfoColor,
        action: canOpen
            ? SnackBarAction(
                label: 'Xem',
                textColor: Colors.white,
                onPressed: () => onOpenRequested?.call(),
              )
            : null,
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title,
                style: const TextStyle(
                    fontWeight: FontWeight.w800, color: Colors.white)),
            if (body.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 2),
                child: Text(body,
                    style:
                        const TextStyle(color: Colors.white70, fontSize: 12.5)),
              ),
          ],
        ),
      ));
    } catch (_) {}
  }
}

/// Toast/thông báo DÙNG CHUNG cho toàn app — thay 23 bản `_toast` rời rạc (mỗi màn
/// tự SnackBar `DanColors.late` một kiểu, chính là "label đỏ" cũ). Từ nay:
///  • Lỗi (isError) → hiện THÔNG BÁO: banner đỏ toàn cục + native OS notif (desktop).
///  • Thông tin thường → banner tối gọn (không kêu OS).
/// `context` giữ lại để KHÔNG phải sửa nơi gọi (`_toast(msg, error: x)`), dù thực tế
/// dùng messenger toàn cục nên hiện được ở mọi màn/nền tảng.
void appToast(BuildContext context, String message, {bool isError = false}) {
  AppNotifier.show(title: message, isError: isError, osNotify: isError);
}
