import 'dart:io' show Platform;

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';

import 'api_service.dart';
import 'local_store.dart';

/// Nhận thông báo đẩy KỂ CẢ KHI APP ĐÃ TẮT (Firebase Cloud Messaging) —
/// trước đây app THỤ ĐỘNG, chỉ biết có bản cập nhật mới khi tự mở app lên
/// (AppUpdater.checkForUpdate chỉ chạy khi app đang sống). Khác hẳn
/// local_notifier (chỉ hiện được lúc app đang chạy).
///
/// CHỈ hoạt động thật trên Android — cần google-services.json (đã đặt ở
/// app tablet). Windows/khác: mọi hàm ở đây tự thoát sớm, không làm gì.
/// Nguyên tắc sắt: không bao giờ được làm hỏng luồng khởi động chính — mọi
/// lỗi ở đây chỉ nuốt, không throw ra ngoài.
class PushNotifications {
  PushNotifications._();

  static bool _registered = false;

  /// Gọi 1 lần sau khi có ApiService còn hiệu lực (đã đăng nhập) — xin quyền
  /// thông báo (Android 13+), lấy token FCM, đăng ký với server, và tự đăng
  /// ký lại mỗi khi token đổi.
  static Future<void> register(ApiService api) async {
    if (!Platform.isAndroid || _registered) return;
    _registered = true;
    try {
      await Firebase.initializeApp();
      FirebaseMessaging.onBackgroundMessage(_backgroundHandler);

      final messaging = FirebaseMessaging.instance;
      await messaging.requestPermission(alert: true, badge: true, sound: true);

      final deviceId = await LocalStore.instance.getString('device_id') ?? '';
      if (deviceId.isEmpty) return; // SystemLog.attach() chưa chạy xong — bỏ qua, thử lại lần sau

      Future<void> sendToken(String? token) async {
        if (token == null || token.isEmpty) return;
        try {
          await api.registerPushToken(
              deviceId: deviceId, fcmToken: token, platform: 'android');
        } catch (_) {/* mất mạng lúc đăng ký → lần mở app sau thử lại */}
      }

      await sendToken(await messaging.getToken());
      // Firebase tự phát token mới khi app cài lại/xoá dữ liệu/hết hạn token cũ.
      messaging.onTokenRefresh.listen(sendToken);

      // App đang MỞ SẴN lúc thông báo tới — không có banner hệ thống tự động
      // (đó là hành vi chuẩn của FCM), nên không cần xử lý gì thêm ở đây; các
      // luồng trong-app (SnackBar cập nhật ở LauncherScreen) đã lo phần này.
      FirebaseMessaging.onMessage.listen((_) {});
    } catch (_) {/* thiết bị/Google Play Services lỗi → app vẫn chạy bình thường */}
  }
}

/// Chạy trong ISOLATE RIÊNG khi app đã tắt hẳn — Android tự khởi FirebaseApp
/// ở isolate này trước khi gọi, không cần Firebase.initializeApp() lại.
/// Không hiển thị gì thêm: FCM tự vẽ notification hệ thống theo trường
/// "notification" của message (đã gửi từ server) — handler này chỉ cần tồn
/// tại để Android không huỷ tiến trình trước khi kịp hiện thông báo.
@pragma('vm:entry-point')
Future<void> _backgroundHandler(RemoteMessage message) async {}
