import 'dart:convert';

import 'package:http/http.dart' as http;

class DanDpakApiClient {
  static const defaultBaseUrl = 'http://127.0.0.1:3000';
  static const defaultTimeout = Duration(seconds: 10);

  String baseUrl;
  String? token;
  String? branchId;

  DanDpakApiClient({
    String baseUrl = defaultBaseUrl,
    this.token,
    this.branchId,
  }) : baseUrl = normalizeBaseUrl(baseUrl);

  static String normalizeBaseUrl(String url) {
    final trimmed = url.trim();
    if (trimmed.isEmpty) return defaultBaseUrl;
    return trimmed.replaceFirst(RegExp(r'/$'), '');
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
  }) async {
    final response = await http.get(uri(path), headers: headers()).timeout(timeout);
    return decodeResponse(response, errorMessage: errorMessage);
  }

  Future<dynamic> postJson(
    String path, {
    Object? body,
    Duration timeout = defaultTimeout,
    String? errorMessage,
  }) async {
    final response = await http
        .post(
          uri(path),
          headers: headers(),
          body: body == null ? null : jsonEncode(body),
        )
        .timeout(timeout);
    return decodeResponse(response, errorMessage: errorMessage);
  }

  dynamic decodeResponse(http.Response response, {String? errorMessage}) {
    final decoded = decodeBody(response.body);
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

  dynamic decodeBody(String body) {
    if (body.trim().isEmpty) return null;
    try {
      return jsonDecode(body);
    } on FormatException {
      return body;
    }
  }

  List<dynamic> listFrom(dynamic value) {
    return value is List ? value : <dynamic>[];
  }

  Map<String, dynamic> mapFrom(dynamic value) {
    return value is Map ? Map<String, dynamic>.from(value) : <String, dynamic>{};
  }
}
