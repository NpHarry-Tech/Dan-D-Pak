import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:flutter/foundation.dart';

import '../app_version.dart';
import 'api_service.dart';
import 'app_log.dart';
import 'black_box.dart';
import 'local_store.dart';

/// Nhật ký HỆ THỐNG phía app — đổ mọi lỗi/sự kiện kỹ thuật (crash, api_error,
/// socket rớt, in lỗi, thanh toán lỗi, update app…) về bảng `system_logs`
/// trên server để màn "Nhật ký hoạt động" đọc được.
///
/// Nguyên tắc sắt (fail-safe):
/// - [log] KHÔNG BAO GIỜ ném lỗi và không chặn UI (fire-and-forget).
/// - Gửi server lỗi → giữ trong queue, retry theo nhịp; app tắt → queue được
///   ghi ra đĩa và nạp lại lần mở sau (crash cũng không mất log).
/// - Queue có TRẦN (300 dòng / ~256KB đĩa) — máy yếu không bao giờ bị log
///   ăn hết RAM/đĩa; tràn thì bỏ dòng cũ nhất và đếm số dòng đã bỏ.
/// - Tự che dữ liệu nhạy cảm (PIN/password/token/số thẻ) TRƯỚC khi rời máy;
///   server còn một lớp che nữa (defense in depth).
class SystemLog {
  SystemLog._();

  static ApiService? _api;
  static Timer? _flushTimer;
  static bool _flushing = false;
  static int _consecutiveFailures = 0;
  static int _dropped = 0;
  static DateTime _rateWindowStart = DateTime.fromMillisecondsSinceEpoch(0);
  static int _rateCount = 0;

  static const int _maxQueue = 300;
  static const int _rateLimitPerMinute = 60;
  static const int _batchSize = 40;
  static final List<Map<String, dynamic>> _queue = [];

  // Ngữ cảnh hiện tại — AuthProvider cập nhật khi đăng nhập/đăng xuất.
  static String username = '';
  static String userId = '';
  static String branchId = '';
  static String branchName = '';
  static String _deviceId = '';
  static String _deviceName = '';

  /// Gọi 1 lần từ main() sau khi có ApiService. Nạp queue tồn từ đĩa (log của
  /// lần chạy trước chưa kịp gửi) và bật nhịp flush 15s.
  static void attach(ApiService api) {
    _api = api;
    _initDeviceIdentity();
    _restoreQueueFromDisk();
    _flushTimer?.cancel();
    _flushTimer = Timer.periodic(const Duration(seconds: 15), (_) => _flush());
  }

  static void setContext({
    String? user,
    String? uid,
    String? branch,
    String? branchLabel,
  }) {
    if (user != null) username = user;
    if (uid != null) userId = uid;
    if (branch != null) branchId = branch;
    if (branchLabel != null) branchName = branchLabel;
  }

  /// Ghi 1 dòng nhật ký hệ thống. An toàn gọi từ bất cứ đâu, kể cả trong
  /// error handler — nuốt mọi lỗi nội bộ, không bao giờ ném ra ngoài.
  static void log({
    String level = 'error', // debug/info/warn/error/fatal
    required String source, // flutter_app/socket/printer/payment/updater/...
    required String eventType,
    required String title,
    String message = '',
    String? screen,
    String? action,
    String? endpoint,
    String? method,
    int? statusCode,
    int? durationMs,
    String? requestId,
    String? correlationId,
    String? orderId,
    String? tableId,
    String? paymentId,
    String? exceptionType,
    String? stackTrace,
    Map<String, dynamic>? extra,
  }) {
    try {
      // Trần tốc độ: một vòng lặp lỗi không được spam đầy queue/mạng.
      final nowTs = DateTime.now();
      if (nowTs.difference(_rateWindowStart).inSeconds > 60) {
        if (_dropped > 0) {
          _enqueue(_entry(
            level: 'warn',
            source: 'flutter_app',
            eventType: 'log_dropped',
            title: 'Đã bỏ $_dropped dòng log do vượt trần tốc độ',
          ));
          _dropped = 0;
        }
        _rateWindowStart = nowTs;
        _rateCount = 0;
      }
      if (++_rateCount > _rateLimitPerMinute) {
        _dropped++;
        return;
      }

      final entry = _entry(
        level: level,
        source: source,
        eventType: eventType,
        title: title,
        message: message,
        screen: screen,
        action: action,
        endpoint: endpoint,
        method: method,
        statusCode: statusCode,
        durationMs: durationMs,
        requestId: requestId,
        correlationId: correlationId ?? currentCorrelationId(),
        orderId: orderId,
        tableId: tableId,
        paymentId: paymentId,
        exceptionType: exceptionType,
        stackTrace: stackTrace,
        extra: extra,
      );
      _enqueue(entry);
      // Lỗi nặng gửi ngay (không đợi nhịp 15s) — crash tiếp theo có thể tới
      // trước nhịp flush kế.
      if (level == 'error' || level == 'fatal') _flush();
    } catch (e) {
      dlog('SystemLog.log swallowed: $e'); // logger không được phá app
    }
  }

  // ── Correlation id: xuyên suốt 1 flow nghiệp vụ (thanh toán, gửi bếp…) ────
  static const Symbol _zoneKey = #dandpakCorrelationId;
  static final Random _rand = Random();

  static String newCorrelationId(String flow) =>
      'co_${flow}_${DateTime.now().millisecondsSinceEpoch.toRadixString(36)}'
      '${_rand.nextInt(0xFFFFF).toRadixString(36)}';

  /// Chạy [body] trong một "flow" có correlationId riêng — mọi request API và
  /// log phát sinh bên trong (kể cả qua await) tự mang id này, giúp truy vết
  /// trọn vẹn: Flutter → API → server → DB → máy in.
  static Future<R> runFlow<R>(String flow, Future<R> Function() body) {
    final id = newCorrelationId(flow);
    BlackBox.add('flow', '$flow start ($id)');
    return runZoned(body, zoneValues: {_zoneKey: id});
  }

  static String? currentCorrelationId() =>
      Zone.current[_zoneKey] as String?;

  // ── Nội bộ ────────────────────────────────────────────────────────────────
  static Map<String, dynamic> _entry({
    required String level,
    required String source,
    required String eventType,
    required String title,
    String message = '',
    String? screen,
    String? action,
    String? endpoint,
    String? method,
    int? statusCode,
    int? durationMs,
    String? requestId,
    String? correlationId,
    String? orderId,
    String? tableId,
    String? paymentId,
    String? exceptionType,
    String? stackTrace,
    Map<String, dynamic>? extra,
  }) {
    return <String, dynamic>{
      'timestamp': DateTime.now().toUtc().toIso8601String(),
      'level': level,
      'source': source,
      'eventType': eventType,
      'title': sanitize(title, 300),
      'message': sanitize(message, 3000),
      'username': username,
      'userId': userId,
      'branchId': branchId,
      'branchName': branchName,
      'deviceId': _deviceId,
      'deviceName': _deviceName,
      'appVersion': kAppVersionName,
      'buildNumber': '$kAppBuildNumber',
      'platform': Platform.operatingSystem,
      'osVersion': Platform.operatingSystemVersion,
      'screen': screen ?? BlackBox.screen,
      if (action != null) 'action': action,
      if (endpoint != null) 'endpoint': endpoint,
      if (method != null) 'method': method,
      if (statusCode != null) 'statusCode': statusCode,
      if (durationMs != null) 'durationMs': durationMs,
      if (requestId != null) 'requestId': requestId,
      if (correlationId != null) 'correlationId': correlationId,
      if (orderId != null) 'orderId': orderId,
      if (tableId != null) 'tableId': tableId,
      if (paymentId != null) 'paymentId': paymentId,
      if (exceptionType != null) 'exceptionType': exceptionType,
      if (stackTrace != null) 'stackTrace': sanitize(stackTrace, 6000),
      if (extra != null) 'extra': extra,
    };
  }

  static void _enqueue(Map<String, dynamic> entry) {
    _queue.add(entry);
    while (_queue.length > _maxQueue) {
      _queue.removeAt(0);
    }
    _persistQueueSoon();
  }

  static int _skipTicks = 0;

  static Future<void> _flush() async {
    final api = _api;
    if (api == null || _flushing || _queue.isEmpty) return;
    // Backoff sau chuỗi thất bại (server chết / chưa đăng nhập): thất bại N
    // lần liên tiếp → bỏ qua N nhịp 15s kế (tối đa ~2 phút giữa 2 lần thử).
    if (_skipTicks > 0) {
      _skipTicks--;
      return;
    }
    _flushing = true;
    try {
      while (_queue.isNotEmpty) {
        final batch = _queue.take(_batchSize).toList();
        await api.postJson('/api/system-logs',
            body: {'entries': batch},
            timeout: const Duration(seconds: 8),
            errorMessage: 'system-log gửi thất bại');
        _queue.removeRange(0, batch.length);
        _consecutiveFailures = 0;
      }
      _persistQueueSoon();
    } catch (e) {
      _consecutiveFailures++;
      _skipTicks = _consecutiveFailures.clamp(1, 8);
      dlog('SystemLog flush failed (${_queue.length} dòng chờ): $e');
    } finally {
      _flushing = false;
    }
  }

  // ── Bền qua restart: queue ghi ra file JSON trong thư mục hỗ trợ app ─────
  static Timer? _persistTimer;
  static File? _queueFile;

  static Future<File?> _resolveQueueFile() async {
    if (_queueFile != null) return _queueFile;
    try {
      String base;
      if (Platform.isAndroid || Platform.isIOS) {
        // Queue chỉ là log chờ gửi — mất khi update app là chấp nhận được,
        // nên dùng systemTemp cho nhẹ (khác LocalStore: config PHẢI bền).
        base = Directory.systemTemp.path;
      } else {
        base = Platform.environment['APPDATA'] ??
            Platform.environment['LOCALAPPDATA'] ??
            Directory.systemTemp.path;
        base = '$base${Platform.pathSeparator}Dan D Pak POS ERP';
      }
      final f = File('$base${Platform.pathSeparator}syslog_queue.json');
      return _queueFile = f;
    } catch (_) {
      return null;
    }
  }

  static void _persistQueueSoon() {
    _persistTimer?.cancel();
    _persistTimer = Timer(const Duration(seconds: 2), () async {
      try {
        final f = await _resolveQueueFile();
        if (f == null) return;
        await f.parent.create(recursive: true);
        var payload = jsonEncode(_queue);
        // Trần dung lượng đĩa ~256KB: quá to thì chỉ giữ nửa đuôi (mới nhất).
        while (payload.length > 256 * 1024 && _queue.length > 10) {
          _queue.removeRange(0, _queue.length ~/ 2);
          payload = jsonEncode(_queue);
        }
        await f.writeAsString(payload, flush: true);
      } catch (_) {/* ghi đĩa lỗi (đĩa đầy) → thôi, còn queue RAM */}
    });
  }

  static Future<void> _restoreQueueFromDisk() async {
    try {
      final f = await _resolveQueueFile();
      if (f == null || !await f.exists()) return;
      final decoded = jsonDecode(await f.readAsString());
      if (decoded is List) {
        _queue.insertAll(
            0,
            decoded
                .whereType<Map>()
                .map((e) => Map<String, dynamic>.from(e))
                .take(_maxQueue));
      }
    } catch (_) {/* file hỏng → bỏ */}
  }

  static Future<void> _initDeviceIdentity() async {
    try {
      var id = await LocalStore.instance.getString('device_id');
      if (id == null || id.isEmpty) {
        id = 'dev_${DateTime.now().millisecondsSinceEpoch.toRadixString(36)}'
            '${_rand.nextInt(0xFFFFFF).toRadixString(36)}';
        await LocalStore.instance.setString('device_id', id);
      }
      _deviceId = id;
      _deviceName = Platform.localHostname;
    } catch (_) {
      _deviceId = 'dev_unknown';
    }
  }

  // ── Che dữ liệu nhạy cảm (PIN/password/token/số thẻ) ─────────────────────
  static final RegExp _sensitiveField = RegExp(
      r'''("?(?:pin|password|passwd|security_pin|old_pin|new_pin|otp|cvv|secret)"?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;}&]+)''',
      caseSensitive: false);
  static final RegExp _tokenField = RegExp(
      r'''("?(?:token|authorization|api[_-]?key|access[_-]?token)"?\s*[:=]\s*"?)([A-Za-z0-9._\-]{12,})("?)''',
      caseSensitive: false);
  static final RegExp _cardNumber = RegExp(r'\b(\d{2})\d{9,13}(\d{4})\b');

  @visibleForTesting
  static String sanitize(String text, [int max = 4000]) {
    var out = text;
    try {
      out = out
          .replaceAllMapped(_sensitiveField, (m) => '${m[1]}"***"')
          .replaceAllMapped(
              _tokenField,
              (m) =>
                  '${m[1]}${m[2]!.substring(0, 6)}…${m[2]!.substring(m[2]!.length - 4)}${m[3]}')
          .replaceAllMapped(_cardNumber, (m) => '${m[1]}***********${m[2]}');
    } catch (_) {}
    return out.length > max ? '${out.substring(0, max)}…' : out;
  }
}
