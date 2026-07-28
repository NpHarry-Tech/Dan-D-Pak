part of '../api_service.dart';

extension ApiServiceDatabaseApi on ApiService {
  Future<Map<String, dynamic>> getDatabaseStatus() async {
    return mapFrom(await getJson('/api/database/status',
        errorMessage: 'Không tải được trạng thái CSDL'));
  }

  Future<List<dynamic>> getAuditLogs({
    int limit = 50,
    String before = '',
    String period = '',
    String search = '',
    String from = '',
    String to = '',
  }) async {
    final params = <String>['limit=$limit'];
    if (before.isNotEmpty) params.add('before=${Uri.encodeComponent(before)}');
    if (period.isNotEmpty) params.add('period=${Uri.encodeComponent(period)}');
    if (search.isNotEmpty) params.add('search=${Uri.encodeComponent(search)}');
    if (from.isNotEmpty) params.add('from=${Uri.encodeComponent(from)}');
    if (to.isNotEmpty) params.add('to=${Uri.encodeComponent(to)}');
    return listFrom(await getJson('/api/audit?${params.join('&')}',
        errorMessage: 'Không tải được nhật ký hoạt động'));
  }

  Future<Map<String, dynamic>> decryptAuditLog(String id) async {
    return mapFrom(await postJson('/api/database/decrypt-audit',
        body: {'id': id}, errorMessage: 'Không giải mã được nhật ký'));
  }

  /// bảng system_logs, hiển thị chung trong màn "Nhật ký hoạt động".
  Future<List<dynamic>> getSystemLogs({
    int limit = 50,
    String before = '',
    String levels = '',
    String sources = '',
    String eventTypes = '',
    String q = '',
    String from = '',
    String to = '',
  }) async {
    final params = <String>['limit=$limit'];
    if (before.isNotEmpty) params.add('before=${Uri.encodeComponent(before)}');
    if (levels.isNotEmpty) params.add('levels=${Uri.encodeComponent(levels)}');
    if (sources.isNotEmpty) {
      params.add('sources=${Uri.encodeComponent(sources)}');
    }
    if (eventTypes.isNotEmpty) {
      params.add('event_types=${Uri.encodeComponent(eventTypes)}');
    }
    if (q.isNotEmpty) params.add('q=${Uri.encodeComponent(q)}');
    if (from.isNotEmpty) params.add('from=${Uri.encodeComponent(from)}');
    if (to.isNotEmpty) params.add('to=${Uri.encodeComponent(to)}');
    final res = await getJson('/api/system-logs?${params.join('&')}',
        errorMessage: 'Không tải được nhật ký hệ thống');
    if (res is Map && res['logs'] is List) return res['logs'] as List;
    return <dynamic>[];
  }

  Future<Map<String, dynamic>> resolveSystemLog(String id) async {
    return mapFrom(await postJson('/api/system-logs/$id/resolve',
        errorMessage: 'Không đánh dấu được đã xử lý'));
  }

  // (exportConfig/importConfig JSON đã gỡ — cơ chế backup cấu hình thời
  //  server free không có disk; giờ dùng backup SQLite thật.)

  Future<Map<String, dynamic>> databaseIntegrityCheck() async {
    return mapFrom(await postJson('/api/database/integrity-check',
        errorMessage: 'Không kiểm tra được CSDL'));
  }

  Future<Map<String, dynamic>> databaseResetTransactions(String pin) async {
    return mapFrom(await postJson('/api/database/reset-transactions',
        body: {'pin': pin}, errorMessage: 'Không reset được giao dịch'));
  }

  // ── Client log sink ────────────────────────────────────────────────────
  /// Ship a client-side error to the local engine so it lands in the same
  /// log stream as the server's request logs (one place to look).
  Future<void> postClientLog(Map<String, dynamic> body) async {
    await postJson('/api/client-log',
        body: body,
        timeout: const Duration(seconds: 5),
        errorMessage: 'client-log failed');
  }
}
