import 'package:dandpak_core/dandpak_core.dart';

class ApiService extends DanDpakApiClient {
  Future<List<dynamic>> getBranches() async {
    return listFrom(await getJson('/api/branches', errorMessage: 'Failed to load branches'));
  }

  Future<Map<String, dynamic>> login(
    String username,
    String pin,
    String branchId,
  ) async {
    return mapFrom(await postJson(
      '/api/login',
      body: {
        'username': username,
        'pin': pin,
        'branch_id': branchId,
      },
      errorMessage: 'Login failed',
    ));
  }

  Future<Map<String, dynamic>> getMe() async {
    return mapFrom(await getJson('/api/me', errorMessage: 'Failed to load user'));
  }

  Future<void> logout() async {
    await postJson('/api/logout', errorMessage: 'Logout failed');
  }

  Future<List<dynamic>> getTables() async {
    return listFrom(await getJson('/api/tables', errorMessage: 'Failed to load tables'));
  }

  Future<List<dynamic>> getMenu() async {
    final decoded = await getJson('/api/menu', errorMessage: 'Failed to load menu');
    if (decoded is List) return decoded;
    if (decoded is Map && decoded['items'] is List) return decoded['items'] as List;
    return <dynamic>[];
  }

  Future<List<dynamic>> getCategories() async {
    return listFrom(await getJson('/api/categories', errorMessage: 'Failed to load categories'));
  }

  Future<Map<String, dynamic>> createOrUpdateOrder(Map<String, dynamic> payload) async {
    return mapFrom(await postJson(
      '/api/orders',
      body: payload,
      errorMessage: 'Failed to save order',
    ));
  }

  Future<Map<String, dynamic>> getOrder(String orderId) async {
    return mapFrom(await getJson('/api/orders/$orderId', errorMessage: 'Failed to load order'));
  }

  Future<Map<String, dynamic>> payOrder(String orderId, Map<String, dynamic> payload) async {
    return mapFrom(await postJson(
      '/api/orders/$orderId/pay',
      body: payload,
      errorMessage: 'Failed to pay order',
    ));
  }

  Future<Map<String, dynamic>> getOperationsConfig() async {
    return mapFrom(await getJson(
      '/api/operations/config',
      errorMessage: 'Failed to load operations config',
    ));
  }

  Future<Map<String, dynamic>> openCashDrawer({String printerId = ''}) async {
    return mapFrom(await postJson(
      '/api/print/cash-drawer/open',
      body: {'printer': printerId},
      errorMessage: 'Failed to open cash drawer',
    ));
  }

  Future<Map<String, dynamic>?> getCurrentShift() async {
    final body = await getJson('/api/shifts/current', errorMessage: 'Failed to load shift');
    if (body is! Map) return null;

    final shift = body['shift'];
    if (shift is! Map) return null;

    final merged = Map<String, dynamic>.from(shift);
    final report = body['report'];
    if (report is Map && report['expected_cash'] != null) {
      merged['expected_cash'] = report['expected_cash'];
    }
    return merged;
  }

  Future<Map<String, dynamic>> openShift(double openingBalance) async {
    final body = await postJson(
      '/api/shifts/open',
      body: {
        'opening_cash': openingBalance.round(),
        'cash_manual': true,
      },
      errorMessage: 'Failed to open shift',
    );
    final shift = body is Map && body['shift'] is Map ? body['shift'] : body;
    return mapFrom(shift);
  }

  Future<Map<String, dynamic>> closeShift(double closingBalance) async {
    return mapFrom(await postJson(
      '/api/shifts/close',
      body: {
        'closing_cash': closingBalance.round(),
        'cash_manual': true,
      },
      errorMessage: 'Failed to close shift',
    ));
  }

  Future<void> resolveStaffCall(String tableId) async {
    await postJson('/api/calls/$tableId/resolve', errorMessage: 'Failed to resolve staff call');
  }

  Future<void> setItemStatus(String itemId, String status) async {
    await postJson(
      '/api/orders/items/$itemId/status',
      body: {'status': status},
      errorMessage: 'Failed to update item status',
    );
  }

  Future<void> cancelItem(String itemId, String reason, {String? managerPin}) async {
    await postJson(
      '/api/orders/items/$itemId/cancel',
      body: {
        'reason': reason,
        if (managerPin != null) 'pin': managerPin,
      },
      errorMessage: 'Failed to cancel item',
    );
  }
}
