import '../primitives.dart';
import 'package:flutter/foundation.dart';

import 'system_log.dart';

/// Trạng thái kết nối TÁCH BIỆT — không bao giờ gộp thành một cờ "offline"
/// toàn cục, vì mỗi trạng thái có nguyên nhân và cách xử lý khác nhau:
///  • [internetReachable] — có chạm được server không (đường truyền).
///  • [apiHealthOk]       — server có đang trả lời tử tế không (5xx liên tục = ốm).
///  • [socketConnected]   — kênh realtime (SocketService cập nhật).
///  • [authValid]         — phiên đăng nhập còn hạn không (401 = hết phiên).
///  • [lastApiError]      — lỗi API gần nhất, kèm endpoint, để hiển thị/chẩn đoán.
///
/// QUY TẮC (P2.5): MỘT endpoint lỗi HTTP không được kéo cả app về "offline".
/// Chỉ sự cố đường truyền lặp lại (≥2 request liên tiếp không chạm được server)
/// mới hạ [internetReachable]; bất kỳ phản hồi HTTP nào — kể cả 500 — chứng tỏ
/// đường truyền SỐNG và lập tức khôi phục cờ này.
class ConnectivityStatus {
  ConnectivityStatus._();
  static final ConnectivityStatus instance = ConnectivityStatus._();

  @visibleForTesting
  static ConnectivityStatus createForTesting() => ConnectivityStatus._();

  static const int _offlineFailureThreshold = 2;

  final ValueNotifier<bool> internetReachable = ValueNotifier(true);
  final ValueNotifier<bool> apiHealthOk = ValueNotifier(true);
  final ValueNotifier<bool> socketConnected = ValueNotifier(true);
  final ValueNotifier<bool> authValid = ValueNotifier(true);
  final ValueNotifier<String?> lastApiError = ValueNotifier(null);

  int _consecutiveNetworkFailures = 0;
  int _consecutive5xx = 0;
  DateTime _lastOfflineLog = DateTime.fromMillisecondsSinceEpoch(0);

  /// Gắn vào DanDpakApiClient.onApiResult từ main(). Không bao giờ ném lỗi
  /// (client đã bọc, nhưng tự phòng thêm).
  void onApiTrace(ApiTrace t) {
    try {
      if (t.networkIssue) {
        _consecutiveNetworkFailures++;
        _consecutive5xx = 0;
        lastApiError.value = '${t.method} ${t.path}: ${t.error ?? 'lỗi mạng'}';
        // 1 request rớt có thể là nhiễu; từ request thứ 2 liên tiếp mới coi là
        // mất đường truyền thật.
        if (_consecutiveNetworkFailures >= _offlineFailureThreshold &&
            internetReachable.value) {
          internetReachable.value = false;
          _logTransition('network_offline', 'Mất kết nối tới máy chủ',
              'Sau $_consecutiveNetworkFailures request liên tiếp không chạm được server (${t.exceptionType ?? '?'})');
        }
        return;
      }

      // Có phản hồi HTTP (bất kể status) → đường truyền sống.
      if (!internetReachable.value) {
        _logTransition('network_online', 'Đã kết nối lại máy chủ',
            'Request ${t.method} ${t.path} nhận phản hồi HTTP ${t.statusCode}');
      }
      _consecutiveNetworkFailures = 0;
      internetReachable.value = true;

      if (t.statusCode == 401) {
        authValid.value = false;
      } else if (t.statusCode > 0 && t.statusCode < 500) {
        authValid.value = true;
      }

      if (t.statusCode >= 500) {
        _consecutive5xx++;
        lastApiError.value = '${t.method} ${t.path}: HTTP ${t.statusCode}';
        if (_consecutive5xx >= 3) apiHealthOk.value = false;
      } else {
        _consecutive5xx = 0;
        apiHealthOk.value = true;
        if (t.statusCode >= 400) {
          lastApiError.value = '${t.method} ${t.path}: HTTP ${t.statusCode}';
        }
      }
    } catch (_) {/* đo trạng thái không được phá request */}
  }

  void setSocketConnected(bool value) {
    socketConnected.value = value;
  }

  /// ONLINE-ONLY (owner 2026-08-26): có được phép GHI tiền/hàng không.
  /// Server là nguồn dữ liệu duy nhất; mọi mutation (bán/thanh toán/trả/kho) đi
  /// qua HTTP nên yêu cầu: chạm được server + server khỏe + phiên còn hạn.
  /// KHÔNG yêu cầu [socketConnected] — một blip realtime không được chặn bán
  /// hàng khi HTTP vẫn sống. Mất kết nối ⇒ UI phải chặn thao tác, KHÔNG chốt
  /// bill/queue local.
  bool get canMutate =>
      internetReachable.value && apiHealthOk.value && authValid.value;

  /// Lý do chặn (để hiển thị rõ), null nếu đang cho phép.
  String? get writeBlockReason {
    if (!internetReachable.value) return 'Mất kết nối máy chủ';
    if (!apiHealthOk.value) return 'Máy chủ đang gặp sự cố';
    if (!authValid.value) return 'Phiên đăng nhập đã hết hạn';
    return null;
  }

  /// Listenable gộp để widget bật/tắt nút thao tác theo cổng ghi.
  Listenable get writeGate =>
      Listenable.merge([internetReachable, apiHealthOk, authValid]);

  void _logTransition(String eventType, String title, String message) {
    // Chống spam: chuyển trạng thái mạng ghi tối đa 1 lần / 30s.
    final now = DateTime.now();
    if (now.difference(_lastOfflineLog).inSeconds < 30) return;
    _lastOfflineLog = now;
    SystemLog.log(
      level: eventType == 'network_offline' ? 'warn' : 'info',
      source: 'flutter_app',
      eventType: eventType,
      title: title,
      message: message,
    );
  }
}
