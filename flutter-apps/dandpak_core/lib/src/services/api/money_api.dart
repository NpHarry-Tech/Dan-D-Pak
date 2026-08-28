part of '../api_service.dart';

/// API lớp Cash Automation — dòng tiền trung tâm, dashboard, exception queue,
/// rule engine. Backend: services/moneyLedger.js.
extension ApiServiceMoneyApi on ApiService {
  Future<Map<String, dynamic>> getCashFlow(
      {String from = '', String to = ''}) async {
    final q = <String>[];
    if (from.isNotEmpty) q.add('from=$from');
    if (to.isNotEmpty) q.add('to=$to');
    final qs = q.isEmpty ? '' : '?${q.join('&')}';
    return mapFrom(await getJson('/api/money/cashflow$qs',
        errorMessage: 'Không tải được dòng tiền'));
  }

  Future<Map<String, dynamic>> getMoneyTransactions({
    String direction = '',
    String from = '',
    String to = '',
    String account = '',
    int limit = 100,
  }) async {
    final q = <String>['limit=$limit'];
    if (direction.isNotEmpty) q.add('direction=$direction');
    if (from.isNotEmpty) q.add('from=$from');
    if (to.isNotEmpty) q.add('to=$to');
    if (account.isNotEmpty) q.add('account=$account');
    return mapFrom(await getJson('/api/money/transactions?${q.join('&')}',
        errorMessage: 'Không tải được giao dịch'));
  }

  Future<Map<String, dynamic>> getMoneyExceptions() async {
    return mapFrom(await getJson('/api/money/exceptions',
        errorMessage: 'Không tải được đối soát'));
  }

  Future<Map<String, dynamic>> resolveMoneyException(String id, String action,
      {String orderId = ''}) async {
    return mapFrom(await postJson('/api/money/exceptions/$id/resolve',
        body: {'action': action, if (orderId.isNotEmpty) 'order_id': orderId},
        errorMessage: 'Không xử lý được giao dịch'));
  }

  Future<List<dynamic>> getMoneyRules() async {
    return listFrom(await getJson('/api/money/rules',
        errorMessage: 'Không tải được quy tắc'));
  }

  Future<Map<String, dynamic>> saveMoneyRule(Map<String, dynamic> body) async {
    return mapFrom(await postJson('/api/money/rules',
        body: body, errorMessage: 'Không lưu được quy tắc'));
  }

  Future<void> deleteMoneyRule(String id) async {
    await postJson('/api/money/rules/$id/delete',
        body: const {}, errorMessage: 'Không xóa được quy tắc');
  }

  Future<Map<String, dynamic>> reclassifyMoney() async {
    return mapFrom(await postJson('/api/money/reclassify',
        body: const {}, errorMessage: 'Không phân loại lại được'));
  }

  // ── Phase 3: dự báo dòng tiền + nghĩa vụ định kỳ ─────────────────────────
  Future<Map<String, dynamic>> getCashForecast() async {
    return mapFrom(await getJson('/api/money/forecast',
        errorMessage: 'Không tải được dự báo dòng tiền'));
  }

  Future<List<dynamic>> getObligations() async {
    return listFrom(await getJson('/api/money/obligations',
        errorMessage: 'Không tải được nghĩa vụ định kỳ'));
  }

  Future<Map<String, dynamic>> saveObligation(Map<String, dynamic> body) async {
    return mapFrom(await postJson('/api/money/obligations',
        body: body, errorMessage: 'Không lưu được nghĩa vụ'));
  }

  Future<void> deleteObligation(String id) async {
    await postJson('/api/money/obligations/$id/delete',
        body: const {}, errorMessage: 'Không xóa được nghĩa vụ');
  }
}
