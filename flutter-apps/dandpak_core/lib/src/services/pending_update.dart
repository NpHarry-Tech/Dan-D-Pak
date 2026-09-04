import 'dart:convert';

import '../app_flavor.dart';
import 'local_store.dart';
import 'system_log.dart';
import 'api_service.dart';

/// §2 — Ghi nhận CẬP NHẬT THÀNH CÔNG một cách CHẮC CHẮN.
///
/// Vấn đề cũ: chỉ ghi "Đã mở trình cài đặt"; nếu người dùng mở installer nhưng
/// máy chưa thật sự lên build mới thì không thể biết, và dòng cập nhật không hiện
/// trong Nhật ký hoạt động.
///
/// Cách làm:
///  1. TRƯỚC khi chạy installer → lưu MARKER bền vững {oldBuild, expectedBuild,
///     version, ts, deviceId, key(idempotency)} vào LocalStore.
///  2. Lần khởi động đầu sau cập nhật, SAU KHI đăng nhập (đủ user/branch để server
///     gán đúng actor/branch) → so build thực tế với marker. Chỉ khi build thực tế
///     == expectedBuild và > oldBuild mới POST /app/update-event → server ghi
///     audit('app.update_success') + phát 'activity:new' realtime, rồi xoá marker.
///  3. Nếu mở installer nhưng KHÔNG lên build mới (build == oldBuild) → KHÔNG ghi
///     "thành công"; marker được giữ tới khi cập nhật thật hoặc quá hạn thì bỏ.
///  4. Idempotent theo `key`: gửi lại khi reconnect/retry không tạo dòng trùng
///     (server dedupe theo key; client chỉ xoá marker khi server xác nhận).
class PendingUpdate {
  static const _key = 'pending_update_marker';
  static const _staleAfter = Duration(days: 7);

  /// Lưu marker NGAY TRƯỚC khi khởi chạy trình cài đặt. Không ném lỗi để không
  /// chặn luồng cập nhật.
  static Future<void> mark({
    required int oldBuild,
    required int expectedBuild,
    required String version,
  }) async {
    try {
      if (expectedBuild <= oldBuild) return; // không phải nâng cấp thì không đánh dấu
      final marker = {
        'oldBuild': oldBuild,
        'expectedBuild': expectedBuild,
        'version': version,
        'ts': DateTime.now().toIso8601String(),
        'deviceId': SystemLog.deviceId,
        'appId': AppFlavor.current.appId,
        // Khoá idempotency: duy nhất theo lần cập nhật, chỉ ký tự an toàn.
        'key': '${oldBuild}_${expectedBuild}_${DateTime.now().millisecondsSinceEpoch}',
      };
      await LocalStore.instance.setString(_key, jsonEncode(marker));
    } catch (_) {/* không chặn cập nhật */}
  }

  /// FALLBACK cho lần nâng cấp mà bản CŨ chưa có [mark] (ví dụ b169 → b170: b169
  /// không hề gọi mark trước khi cài). Suy ra từ FIRST-BOOT BASELINE bền vững
  /// (last_run_build): nếu build thực tế cao hơn build đã chạy lần trước thì đó là
  /// một lần cập nhật thật → ghi pending event để [flushAfterAuth] báo lên server.
  /// KHÔNG ghi đè nếu đã có marker (đường installer ưu tiên). Gọi ở bootstrap TRƯỚC
  /// khi cập nhật baseline.
  static Future<void> recordBaselineUpgrade({
    required int oldBuild,
    required int currentBuild,
    required String version,
  }) async {
    try {
      if (currentBuild <= oldBuild) return;
      final existing = await LocalStore.instance.getString(_key);
      if (existing != null && existing.isNotEmpty) return; // marker đã có → không đụng
      final marker = {
        'oldBuild': oldBuild,
        'expectedBuild': currentBuild,
        'version': version,
        'ts': DateTime.now().toIso8601String(),
        'deviceId': SystemLog.deviceId,
        'appId': AppFlavor.current.appId,
        'key': 'boot_${oldBuild}_$currentBuild',
      };
      await LocalStore.instance.setString(_key, jsonEncode(marker));
    } catch (_) {/* không chặn boot */}
  }

  /// Gọi SAU KHI đăng nhập thành công (đủ token + branch). Flush ngay, không chờ
  /// timer. Không ném lỗi.
  static Future<void> flushAfterAuth(ApiService api) async {
    try {
      final raw = await LocalStore.instance.getString(_key);
      if (raw == null || raw.isEmpty) return;
      Map<String, dynamic> m;
      try {
        m = Map<String, dynamic>.from(jsonDecode(raw) as Map);
      } catch (_) {
        await LocalStore.instance.remove(_key);
        return;
      }
      final oldBuild = (m['oldBuild'] as num?)?.toInt() ?? 0;
      final expectedBuild = (m['expectedBuild'] as num?)?.toInt() ?? 0;
      final version = (m['version'] as String?) ?? AppFlavor.current.versionName;
      final key = (m['key'] as String?) ?? '';
      final current = AppFlavor.current.buildNumber;

      // Marker của một app khác (điện thoại vs desktop dùng chung máy hiếm gặp) → bỏ qua.
      if ((m['appId'] as String?) != null &&
          m['appId'] != AppFlavor.current.appId) {
        return;
      }

      // Cập nhật thật sự đã lên đúng build kỳ vọng và cao hơn build cũ.
      if (key.isNotEmpty && current == expectedBuild && current > oldBuild) {
        await api.postJson('/api/app/update-event', body: {
          'fromBuild': oldBuild,
          'toBuild': current,
          'version': version,
          'key': key,
        });
        // Chỉ xoá marker khi server đã nhận (không ném) — nếu mạng lỗi, giữ marker
        // để lần đăng nhập/khởi động sau flush lại (idempotent theo key).
        await LocalStore.instance.remove(_key);
        return;
      }

      // Mở installer nhưng chưa lên build mới: giữ marker, chỉ bỏ khi quá hạn.
      final ts = DateTime.tryParse((m['ts'] as String?) ?? '');
      if (ts == null || DateTime.now().difference(ts) > _staleAfter) {
        await LocalStore.instance.remove(_key);
      }
    } catch (_) {/* mạng/timeout: giữ marker, thử lại lần sau */}
  }
}
