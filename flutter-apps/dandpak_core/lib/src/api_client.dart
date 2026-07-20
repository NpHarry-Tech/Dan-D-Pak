import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:isolate';

import 'package:http/http.dart' as http;

import 'utils/translation.dart';

/// Lỗi API có PHÂN LOẠI — nền tảng của crash hardening phía mạng:
///  • [offline]  = không chạm được server (SocketException/ClientException).
///  • [timedOut] = server không trả lời kịp.
///  • Còn lại    = server ĐÃ trả lời với [statusCode] (400/401/403/404/500…)
///    — đây là lỗi NGHIỆP VỤ, TUYỆT ĐỐI không được coi là "mất mạng".
/// toString() trả về đúng [message] (không có tiền tố "Exception: ") nên mọi
/// chỗ hiển thị lỗi hiện tại vẫn chạy nguyên.
class ApiException implements Exception {
  final String message;
  final int statusCode; // 0 khi không có phản hồi HTTP (offline/timeout)
  final String method;
  final String endpoint;
  final bool offline;
  final bool timedOut;
  final Object? cause;

  const ApiException(
    this.message, {
    this.statusCode = 0,
    this.method = '',
    this.endpoint = '',
    this.offline = false,
    this.timedOut = false,
    this.cause,
  });

  /// true = sự cố đường truyền (đáng retry); false = server đã từ chối có chủ đích.
  bool get isNetworkIssue => offline || timedOut;

  @override
  String toString() => message;
}

/// Kết quả đo của MỘT request — client báo cho app qua [DanDpakApiClient.onApiResult]
/// để app ghi nhật ký hệ thống (api_error/slow_request) và cập nhật trạng thái mạng.
class ApiTrace {
  final String method;
  final String path;
  final int statusCode; // 0 nếu không có phản hồi
  final int durationMs;
  final String? correlationId;
  final String? error; // null = thành công
  final String? exceptionType; // TimeoutException/SocketException/null

  const ApiTrace({
    required this.method,
    required this.path,
    required this.statusCode,
    required this.durationMs,
    this.correlationId,
    this.error,
    this.exceptionType,
  });

  bool get ok => statusCode >= 200 && statusCode < 300;
  bool get networkIssue => statusCode == 0;
}

class DanDpakApiClient {
  static const defaultBaseUrl = 'http://127.0.0.1:3000';
  static const defaultTimeout = Duration(seconds: 10);

  /// Hook tự cứu khi request bị CONNECTION REFUSED (engine local chưa chạy /
  /// vừa bị tắt). App gắn hàm khởi động lại Node engine vào đây; trả về true
  /// nếu engine đã sống lại → request được RETRY trong suốt, người dùng không
  /// thấy lỗi "remote computer refused the network connection" nữa.
  ///
  /// An toàn cho cả POST: connect bị refused nghĩa là request CHƯA HỀ tới
  /// server (không có nguy cơ double-submit).
  static Future<bool> Function()? onConnectionRefused;

  /// Quan sát mọi request đã có phản hồi ("hộp đen" của app gắn vào đây để ghi
  /// vệt API trước crash). Nhận 1 dòng gọn: "GET /api/menu → 200". Callback
  /// không được ném lỗi; client tự nuốt mọi lỗi từ hook này.
  static void Function(String line)? onRequestTrace;

  /// Quan sát KẾT QUẢ ĐO của mọi request (kể cả lỗi mạng — khác onRequestTrace
  /// chỉ thấy request có phản hồi). App gắn SystemLog/ConnectivityStatus vào
  /// đây. Callback được bọc try/catch — không bao giờ phá request.
  static void Function(ApiTrace trace)? onApiResult;

  /// App cung cấp correlationId của flow hiện tại (Zone-based). Mỗi request sẽ
  /// mang header `x-correlation-id` để truy vết Flutter → API → DB → máy in.
  static String? Function()? correlationIdProvider;

  static void _trace(http.Response response) {
    final cb = onRequestTrace;
    if (cb == null) return;
    try {
      final req = response.request;
      cb('${req?.method ?? '?'} ${req?.url.path ?? '?'} → ${response.statusCode}');
    } catch (_) {}
  }

  static void _report(ApiTrace trace) {
    final cb = onApiResult;
    if (cb == null) return;
    try {
      cb(trace);
    } catch (_) {/* hook của app không được phá request */}
  }

  static bool _isRefused(Object e) {
    final cause = e is ApiException ? (e.cause ?? e) : e;
    if (cause is SocketException) return true;
    final s = cause.toString();
    return s.contains('refused') ||
        s.contains('errno = 1225') ||
        s.contains('SocketException');
  }

  Future<T> _withEngineRetry<T>(Future<T> Function() run) async {
    try {
      return await run();
    } catch (e) {
      final recover = onConnectionRefused;
      if (recover == null || !_isRefused(e)) rethrow;
      final ok = await recover();
      if (!ok) rethrow;
      return await run();
    }
  }

  String baseUrl;
  String? token;
  String? branchId;

  DanDpakApiClient({String baseUrl = defaultBaseUrl, this.token, this.branchId})
      : baseUrl = normalizeBaseUrl(baseUrl);

  static String normalizeBaseUrl(String url) {
    var trimmed = url.trim();
    if (trimmed.isEmpty) return defaultBaseUrl;

    // Remove trailing slash
    trimmed = trimmed.replaceFirst(RegExp(r'/$'), '');

    // Add protocol if missing
    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
      trimmed = 'http://$trimmed';
    }

    try {
      final uri = Uri.parse(trimmed);
      final host = uri.host;
      final isIpOrLocalhost = RegExp(
        r'^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost)$',
      ).hasMatch(host);

      if (isIpOrLocalhost) {
        // Force http for raw IP / localhost because SSL is not used on LAN/localhost.
        // Dart Uri XÓA cổng mặc định khi parse ("http://ip:80" → hasPort=false),
        // nên phải nhìn chuỗi gốc: người dùng đã gõ cổng thì tôn trọng cổng đó
        // (VD server công ty sau Caddy :80); chỉ khi hoàn toàn không gõ cổng
        // mới áp mặc định 3000 của máy chủ LAN.
        final explicitPort = RegExp(r'^https?://[^/]+:\d+').hasMatch(trimmed);
        final port = (uri.hasPort || explicitPort) ? uri.port : 3000;
        trimmed = 'http://$host:$port${uri.path}';
        trimmed = trimmed.replaceFirst(RegExp(r'/$'), '');
      }
    } catch (_) {}

    return trimmed;
  }

  void setBaseUrl(String url) {
    baseUrl = normalizeBaseUrl(url);
  }

  void setToken(String? userToken) {
    token = userToken;
  }

  void setBranchId(String? id) {
    branchId = id;
  }

  Uri uri(String path) {
    final normalizedPath = path.startsWith('/') ? path : '/$path';
    return Uri.parse('$baseUrl$normalizedPath');
  }

  /// Tên máy gửi kèm mọi request (x-device-name) để Nhật ký hoạt động trên
  /// server ghi rõ "ai làm gì ở THIẾT BỊ NÀO" — kể cả log phía backend.
  static final String _deviceName = () {
    try {
      // Header HTTP chỉ an toàn với ASCII — lọc ký tự lạ khỏi tên máy.
      return Platform.localHostname
          .replaceAll(RegExp(r'[^\x20-\x7E]'), '?')
          .trim();
    } catch (_) {
      return '';
    }
  }();

  Map<String, String> headers([Map<String, String>? extra]) {
    final result = <String, String>{
      'Content-Type': 'application/json; charset=utf-8',
      if (token != null && token!.isNotEmpty) ...{
        'x-auth-token': token!,
        'Authorization': 'Bearer $token',
      },
      if (branchId != null && branchId!.isNotEmpty) 'x-branch-id': branchId!,
      if (_deviceName.isNotEmpty) 'x-device-name': _deviceName,
    };
    if (extra != null) result.addAll(extra);
    return result;
  }

  // ── Lõi gửi request: MỘT đường duy nhất cho GET/POST/DELETE/BYTES ─────────
  // Mọi request đi qua đây để được: đo thời gian, gắn correlationId, phân loại
  // lỗi (offline/timeout/HTTP) thành ApiException, và báo về onApiResult.
  Future<http.Response> _send(
    String method,
    String path, {
    Object? body,
    required Duration timeout,
    String? errorMessage,
  }) async {
    final sw = Stopwatch()..start();
    final cid = _safeCorrelationId();
    final hdrs = headers(cid == null ? null : {'x-correlation-id': cid});
    final target = uri(path);
    try {
      final http.Response response;
      switch (method) {
        case 'POST':
          response = await http
              .post(target,
                  headers: hdrs, body: body == null ? null : jsonEncode(body))
              .timeout(timeout);
        case 'DELETE':
          response = await http
              .delete(target,
                  headers: hdrs, body: body == null ? null : jsonEncode(body))
              .timeout(timeout);
        default:
          response = await http.get(target, headers: hdrs).timeout(timeout);
      }
      sw.stop();
      _report(ApiTrace(
        method: method,
        path: path,
        statusCode: response.statusCode,
        durationMs: sw.elapsedMilliseconds,
        correlationId: cid,
        error:
            response.statusCode >= 400 ? 'HTTP ${response.statusCode}' : null,
      ));
      return response;
    } on TimeoutException catch (e) {
      sw.stop();
      _report(ApiTrace(
        method: method,
        path: path,
        statusCode: 0,
        durationMs: sw.elapsedMilliseconds,
        correlationId: cid,
        error: 'timeout sau ${timeout.inSeconds}s',
        exceptionType: 'TimeoutException',
      ));
      throw ApiException(
        _timeoutMessage(timeout, errorMessage),
        method: method,
        endpoint: path,
        timedOut: true,
        cause: e,
      );
    } on SocketException catch (e) {
      sw.stop();
      _report(ApiTrace(
        method: method,
        path: path,
        statusCode: 0,
        durationMs: sw.elapsedMilliseconds,
        correlationId: cid,
        error: e.message,
        exceptionType: 'SocketException',
      ));
      throw ApiException(
        _offlineMessage(errorMessage),
        method: method,
        endpoint: path,
        offline: true,
        cause: e,
      );
    } on http.ClientException catch (e) {
      // http package gói nhiều lỗi tầng thấp (kể cả mất kết nối giữa chừng)
      // vào ClientException — vẫn là sự cố đường truyền, không phải nghiệp vụ.
      sw.stop();
      _report(ApiTrace(
        method: method,
        path: path,
        statusCode: 0,
        durationMs: sw.elapsedMilliseconds,
        correlationId: cid,
        error: e.message,
        exceptionType: 'ClientException',
      ));
      throw ApiException(
        _offlineMessage(errorMessage),
        method: method,
        endpoint: path,
        offline: true,
        cause: e,
      );
    }
  }

  static String? _safeCorrelationId() {
    try {
      return correlationIdProvider?.call();
    } catch (_) {
      return null;
    }
  }

  Future<dynamic> getJson(
    String path, {
    Duration timeout = defaultTimeout,
    String? errorMessage,
  }) {
    return _withEngineRetry(() async {
      ApiException? lastNetworkError;
      for (var attempt = 1; attempt <= 3; attempt++) {
        try {
          final response = await _send('GET', path,
              timeout: timeout, errorMessage: errorMessage);
          return decodeResponseAsync(response,
              errorMessage: errorMessage, method: 'GET', path: path);
        } on ApiException catch (e) {
          if (!e.isNetworkIssue) rethrow;
          lastNetworkError = e;
          if (attempt == 3) break;
          await Future.delayed(Duration(milliseconds: 250 * attempt));
        }
      }
      throw lastNetworkError!;
    });
  }

  Future<dynamic> postJson(
    String path, {
    Object? body,
    Duration timeout = defaultTimeout,
    String? errorMessage,
  }) {
    return _withEngineRetry(() async {
      final response = await _send('POST', path,
          body: body, timeout: timeout, errorMessage: errorMessage);
      return decodeResponseAsync(response,
          errorMessage: errorMessage, method: 'POST', path: path);
    });
  }

  /// Probe MỘT endpoint và trả về kết quả CÓ CẤU TRÚC cho màn "Mạng & kết nối".
  /// Mục tiêu: phân biệt rạch ròi ba trạng thái, KHÔNG gộp lẫn:
  ///  - server sống  : HTTP 2xx (ok=true)
  ///  - route sai/thiếu: HTTP 404… (ok=false NHƯNG statusCode>0 → server VẪN
  ///    trả lời, KHÔNG phải mất mạng)
  ///  - mất mạng     : SocketException/timeout (statusCode=0 + exceptionType)
  /// Đây là phép đo trực tiếp từ THIẾT BỊ (không phải server tự đo), nên phản
  /// ánh đúng độ trễ thật client↔server. Không dùng _withEngineRetry để số đo
  /// là một lần gọi sạch.
  Future<Map<String, dynamic>> probe(
    String path, {
    Duration timeout = const Duration(seconds: 5),
  }) async {
    final sw = Stopwatch()..start();
    final url = uri(path);
    try {
      final res = await http.get(url, headers: headers()).timeout(timeout);
      sw.stop();
      return {
        'ok': res.statusCode >= 200 && res.statusCode < 300,
        'target': '${url.host}:${url.port}',
        'endpoint': path,
        'statusCode': res.statusCode,
        'durationMs': sw.elapsedMilliseconds,
        'exceptionType': '',
      };
    } on TimeoutException {
      sw.stop();
      return {
        'ok': false,
        'target': '${url.host}:${url.port}',
        'endpoint': path,
        'statusCode': 0,
        'durationMs': sw.elapsedMilliseconds,
        'exceptionType': 'TimeoutException',
      };
    } catch (e) {
      sw.stop();
      return {
        'ok': false,
        'target': '${url.host}:${url.port}',
        'endpoint': path,
        'statusCode': 0,
        'durationMs': sw.elapsedMilliseconds,
        'exceptionType': e.runtimeType.toString(),
      };
    }
  }

  /// Fetch raw bytes for a path (e.g. report/document exports), authenticated.
  Future<List<int>> getBytes(
    String path, {
    Duration timeout = const Duration(seconds: 30),
    String? errorMessage,
  }) {
    return _withEngineRetry(() async {
      final response = await _send('GET', path,
          timeout: timeout, errorMessage: errorMessage);
      if (response.statusCode >= 200 && response.statusCode < 300) {
        return response.bodyBytes;
      }
      throw ApiException(
        errorMessage ?? 'Request failed (HTTP ${response.statusCode})',
        statusCode: response.statusCode,
        method: 'GET',
        endpoint: path,
      );
    });
  }

  Future<dynamic> deleteJson(
    String path, {
    Object? body,
    Duration timeout = defaultTimeout,
    String? errorMessage,
  }) {
    return _withEngineRetry(() async {
      final response = await _send('DELETE', path,
          body: body, timeout: timeout, errorMessage: errorMessage);
      return decodeResponseAsync(response,
          errorMessage: errorMessage, method: 'DELETE', path: path);
    });
  }

  /// Bodies above this size are parsed in a background isolate so a large
  /// menu / SKU / report payload never blocks a UI frame on weak hardware.
  static const int isolateDecodeThreshold = 64 * 1024;

  Future<dynamic> decodeResponseAsync(
    http.Response response, {
    String? errorMessage,
    String method = '',
    String path = '',
  }) async {
    final body = response.body;
    final decoded = body.length >= isolateDecodeThreshold
        ? await _decodeInIsolate(body)
        : decodeBody(body);
    return _checkStatus(response, decoded,
        errorMessage: errorMessage, method: method, path: path);
  }

  dynamic decodeResponse(http.Response response, {String? errorMessage}) {
    return _checkStatus(
      response,
      decodeBody(response.body),
      errorMessage: errorMessage,
    );
  }

  dynamic _checkStatus(
    http.Response response,
    dynamic decoded, {
    String? errorMessage,
    String method = '',
    String path = '',
  }) {
    _trace(response);
    if (response.statusCode >= 200 && response.statusCode < 300) {
      return decoded;
    }

    final serverMessage =
        decoded is Map ? decoded['error'] ?? decoded['message'] : null;
    // HTTP lỗi = server ĐÃ trả lời → ApiException nghiệp vụ có statusCode,
    // KHÔNG phải offline. UI hiện message; ai cần status thì đọc được.
    throw ApiException(
      serverMessage?.toString() ??
          errorMessage ??
          'Request failed (HTTP ${response.statusCode})',
      statusCode: response.statusCode,
      method: method,
      endpoint: path,
    );
  }

  dynamic decodeBody(String body) => _tryJsonDecode(body);

  List<dynamic> listFrom(dynamic value) {
    return value is List ? value : <dynamic>[];
  }

  Map<String, dynamic> mapFrom(dynamic value) {
    return value is Map
        ? Map<String, dynamic>.from(value)
        : <String, dynamic>{};
  }
}

// The Isolate.run closure MUST be created in a top-level SYNC function: when
// it is created inside an async method (as decodeResponseAsync used to do),
// the AOT compiler keeps the whole async frame in the closure context —
// _AsyncCompleter, http.Response, `this` — and the completer's awaiter chain
// reaches into the widget tree, none of which can cross an isolate boundary →
// "Illegal argument in isolate message: object is unsendable". Here the scope
// holds only the `body` string. If spawning still fails for any reason, fall
// back to decoding on the main isolate (slower but always correct).
Future<dynamic> _decodeInIsolate(String body) {
  return Isolate.run(() => _tryJsonDecode(body))
      .catchError((_) => _tryJsonDecode(body));
}

// Top-level so Isolate.run only captures the body string, not the client.
dynamic _tryJsonDecode(String body) {
  if (body.trim().isEmpty) return null;
  try {
    return jsonDecode(body);
  } on FormatException {
    return body;
  }
}

String _timeoutMessage(Duration timeout, String? errorMessage) {
  final action = errorMessage?.trim().isNotEmpty == true
      ? t(errorMessage!.trim())
      : t('Yêu cầu');
  return '$action ${t('quá thời gian chờ')} ${timeout.inSeconds} ${t('giây')}. ${t('Vui lòng kiểm tra server/máy in rồi thử lại')}.';
}

String _offlineMessage(String? errorMessage) {
  final action = errorMessage?.trim().isNotEmpty == true
      ? t(errorMessage!.trim())
      : t('Yêu cầu');
  return '$action: ${t('không kết nối được máy chủ')}. ${t('Kiểm tra mạng/WiFi rồi thử lại')} — ${t('thao tác CHƯA được ghi nhận')}.';
}
