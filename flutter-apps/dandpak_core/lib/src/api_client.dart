import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:isolate';

import 'package:http/http.dart' as http;

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

  static bool _isRefused(Object e) {
    if (e is SocketException) return true;
    final s = e.toString();
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
        // Force http for raw IP / localhost because SSL is not used on LAN/localhost
        final port = uri.hasPort ? uri.port : 3000;
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

  Map<String, String> headers([Map<String, String>? extra]) {
    final result = <String, String>{
      'Content-Type': 'application/json; charset=utf-8',
      if (token != null && token!.isNotEmpty) ...{
        'x-auth-token': token!,
        'Authorization': 'Bearer $token',
      },
      if (branchId != null && branchId!.isNotEmpty) 'x-branch-id': branchId!,
    };
    if (extra != null) result.addAll(extra);
    return result;
  }

  Future<dynamic> getJson(
    String path, {
    Duration timeout = defaultTimeout,
    String? errorMessage,
  }) {
    return _withEngineRetry(() async {
      try {
        final response = await http
            .get(uri(path), headers: headers())
            .timeout(timeout);
        return decodeResponseAsync(response, errorMessage: errorMessage);
      } on TimeoutException {
        throw _timeoutError(timeout, errorMessage);
      }
    });
  }

  Future<dynamic> postJson(
    String path, {
    Object? body,
    Duration timeout = defaultTimeout,
    String? errorMessage,
  }) {
    return _withEngineRetry(() async {
      try {
        final response = await http
            .post(
              uri(path),
              headers: headers(),
              body: body == null ? null : jsonEncode(body),
            )
            .timeout(timeout);
        return decodeResponseAsync(response, errorMessage: errorMessage);
      } on TimeoutException {
        throw _timeoutError(timeout, errorMessage);
      }
    });
  }

  /// Fetch raw bytes for a path (e.g. report/document exports), authenticated.
  Future<List<int>> getBytes(
    String path, {
    Duration timeout = const Duration(seconds: 30),
    String? errorMessage,
  }) {
    return _withEngineRetry(() async {
      try {
        final response = await http
            .get(uri(path), headers: headers())
            .timeout(timeout);
        if (response.statusCode >= 200 && response.statusCode < 300) {
          return response.bodyBytes;
        }
        throw Exception(
          errorMessage ?? 'Request failed (HTTP ${response.statusCode})',
        );
      } on TimeoutException {
        throw _timeoutError(timeout, errorMessage);
      }
    });
  }

  Future<dynamic> deleteJson(
    String path, {
    Duration timeout = defaultTimeout,
    String? errorMessage,
  }) {
    return _withEngineRetry(() async {
      try {
        final response = await http
            .delete(uri(path), headers: headers())
            .timeout(timeout);
        return decodeResponseAsync(response, errorMessage: errorMessage);
      } on TimeoutException {
        throw _timeoutError(timeout, errorMessage);
      }
    });
  }

  /// Bodies above this size are parsed in a background isolate so a large
  /// menu / SKU / report payload never blocks a UI frame on weak hardware.
  static const int isolateDecodeThreshold = 64 * 1024;

  Future<dynamic> decodeResponseAsync(
    http.Response response, {
    String? errorMessage,
  }) async {
    final body = response.body;
    final decoded = body.length >= isolateDecodeThreshold
        ? await Isolate.run(() => _tryJsonDecode(body))
        : decodeBody(body);
    return _checkStatus(response, decoded, errorMessage: errorMessage);
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
  }) {
    if (response.statusCode >= 200 && response.statusCode < 300) {
      return decoded;
    }

    final serverMessage = decoded is Map
        ? decoded['error'] ?? decoded['message']
        : null;
    throw Exception(
      serverMessage?.toString() ??
          errorMessage ??
          'Request failed (HTTP ${response.statusCode})',
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

// Top-level so Isolate.run only captures the body string, not the client.
dynamic _tryJsonDecode(String body) {
  if (body.trim().isEmpty) return null;
  try {
    return jsonDecode(body);
  } on FormatException {
    return body;
  }
}

Exception _timeoutError(Duration timeout, String? errorMessage) {
  final action = errorMessage?.trim().isNotEmpty == true
      ? errorMessage!.trim()
      : 'Yêu cầu';
  return Exception(
    '$action quá thời gian chờ ${timeout.inSeconds} giây. Vui lòng kiểm tra server/máy in rồi thử lại.',
  );
}
