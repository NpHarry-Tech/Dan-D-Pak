part of '../api_service.dart';

extension ApiServicePosApi on ApiService {
  Future<List<dynamic>> getTables() async {
    return listFrom(
        await getJson('/api/tables', errorMessage: 'Failed to load tables'));
  }

  Future<List<dynamic>> getMenu() async {
    final decoded =
        await getJson('/api/menu', errorMessage: 'Failed to load menu');
    if (decoded is List) return decoded;
    if (decoded is Map && decoded['items'] is List) {
      return decoded['items'] as List;
    }
    return <dynamic>[];
  }

  Future<Map<String, dynamic>> getMenuFull() async {
    final decoded =
        await getJson('/api/menu', errorMessage: 'Không tải được thực đơn');
    if (decoded is Map) return Map<String, dynamic>.from(decoded);
    if (decoded is List) return {'categories': [], 'items': decoded};
    return {'categories': [], 'items': []};
  }

  Future<Map<String, dynamic>> getMenuPaginated({
    required int page,
    int limit = 40,
    String q = '',
    String categoryId = '',
  }) async {
    final query =
        'page=$page&limit=$limit&q=${Uri.encodeComponent(q)}&category_id=$categoryId';
    final decoded = await getJson('/api/menu?$query',
        errorMessage: 'Không tải được trang thực đơn $page');
    return Map<String, dynamic>.from(decoded as Map);
  }

  Future<List<dynamic>> getCategories() async {
    return listFrom(await getJson('/api/categories',
        errorMessage: 'Failed to load categories'));
  }

  Future<Map<String, dynamic>> createOrUpdateOrder(
      Map<String, dynamic> payload) async {
    return mapFrom(await postJson(
      '/api/orders',
      body: payload,
      errorMessage: 'Failed to save order',
    ));
  }

  Future<Map<String, dynamic>> getOrder(String orderId) async {
    return mapFrom(await getJson('/api/orders/$orderId',
        errorMessage: 'Failed to load order'));
  }

  Future<Map<String, dynamic>> payOrder(
      String orderId, Map<String, dynamic> payload) async {
    return mapFrom(await postJson(
      '/api/orders/$orderId/pay',
      body: payload,
      timeout: const Duration(seconds: 45),
      errorMessage: 'Không thanh toán được hóa đơn',
    ));
  }

  Future<Map<String, dynamic>> moveTable(
      String fromTableId, String toTableId) async {
    return mapFrom(await postJson(
      '/api/tables/$fromTableId/move',
      body: {'to_table_id': toTableId},
      errorMessage: 'Không chuyển được bàn',
    ));
  }

  Future<Map<String, dynamic>> mergeTable(
      String fromTableId, String targetTableId) async {
    return mapFrom(await postJson(
      '/api/tables/$fromTableId/merge',
      body: {'target_table_id': targetTableId},
      errorMessage: 'Không gộp được bàn',
    ));
  }

  Future<Map<String, dynamic>> splitOrder(
      String orderId, List<String> itemIds) async {
    return mapFrom(await postJson(
      '/api/orders/$orderId/split',
      body: {'item_ids': itemIds},
      errorMessage: 'Không tách được bill',
    ));
  }

  Future<Map<String, dynamic>> confirmOrderItems(
      String orderId, List<String> itemIds) async {
    return mapFrom(await postJson(
      '/api/orders/$orderId/confirm',
      body: {'item_ids': itemIds},
      errorMessage: 'Không gửi món vào bếp',
    ));
  }

  Future<List<dynamic>> getOrderHistory({
    int limit = 80,
    String q = '',
    String channel = '',
    String from = '',
    String to = '',
  }) async {
    final params = <String, String>{
      'limit': '$limit',
      if (q.trim().isNotEmpty) 'q': q.trim(),
      if (channel.isNotEmpty) 'channel': channel,
      if (from.isNotEmpty) 'from': from,
      if (to.isNotEmpty) 'to': to,
    };
    final qs = Uri(queryParameters: params).query;
    return listFrom(await getJson('/api/orders/history?$qs',
        errorMessage: 'Không tải được lịch sử bán hàng'));
  }

  Future<Map<String, dynamic>> getOrderReceipt(String orderId) async {
    return mapFrom(await getJson('/api/orders/$orderId/receipt',
        errorMessage: 'Không tải được chi tiết hóa đơn'));
  }

  /// Nội dung bill render bằng đúng engine + mẫu in đã cấu hình trong Cài đặt

  Future<String> getOrderReceiptText(String orderId,
      {bool reprint = false}) async {
    final suffix = reprint ? '?reprint=1' : '';
    final res = await getJson('/api/orders/$orderId/receipt/text$suffix',
        errorMessage: 'Không tải được nội dung bill');
    return res is Map ? '${res['text'] ?? ''}' : '';
  }

  Future<List<dynamic>> printOrderReceipt(String orderId) async {
    return listFrom(await postJson('/api/orders/$orderId/receipt/print',
        errorMessage: 'Không gửi được lệnh in lại hóa đơn'));
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
    final body = await getJson('/api/shifts/current',
        errorMessage: 'Failed to load shift');
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

  // ── Full shift + cash-drawer flow (mirrors web /shifts/*, /cash-drawer/*) ──
  // All of these are branch-scoped on the server, so F&B POS and Retail POS
  // share one shift + one drawer per branch automatically.

  /// Whole shift snapshot: { shift, config, report, day_report, drawer,
  /// opening_suggestion }.
  Future<Map<String, dynamic>> getShiftState() async {
    return mapFrom(await getJson('/api/shifts/current',
        errorMessage: 'Không tải được ca làm việc'));
  }

  Future<Map<String, dynamic>> openShiftCounts({
    required String shiftKey,
    required Map<String, int> counts,
    required int openingCash,
    required bool cashManual,
  }) async {
    return mapFrom(await postJson('/api/shifts/open',
        body: {
          'shift_key': shiftKey,
          'counts': counts,
          'opening_cash': openingCash,
          'cash_manual': cashManual,
        },
        errorMessage: 'Không mở được ca làm việc'));
  }

  Future<Map<String, dynamic>> closeShiftCounts({
    required String shiftKey,
    required Map<String, int> counts,
    required int closingCash,
    String? managerOverridePin,
  }) async {
    return mapFrom(await postJson('/api/shifts/close',
        body: {
          'shift_key': shiftKey,
          'counts': counts,
          'closing_cash': closingCash,
          if (managerOverridePin != null)
            'manager_override_pin': managerOverridePin,
        },
        errorMessage: 'Không kết được ca làm việc'));
  }

  Future<Map<String, dynamic>> getCashDrawer() async {
    return mapFrom(await getJson('/api/cash-drawer/current',
        errorMessage: 'Không tải được két tiền'));
  }

  Future<Map<String, dynamic>> createCashExpense(
      Map<String, dynamic> body) async {
    return mapFrom(await postJson('/api/cash-drawer/expense',
        body: body, errorMessage: 'Không ghi được chi từ két'));
  }

  Future<Map<String, dynamic>> createCashReimbursement(
      Map<String, dynamic> body) async {
    return mapFrom(await postJson('/api/cash-drawer/reimbursement',
        body: body, errorMessage: 'Không ghi được hoàn chi'));
  }

  Future<void> resolveStaffCall(String tableId) async {
    await postJson('/api/calls/$tableId/resolve',
        errorMessage: 'Failed to resolve staff call');
  }

  /// Bàn + đơn đang mở của bàn (field `order` = đơn hiện tại).
  Future<Map<String, dynamic>> getTable(String tableId) async {
    return mapFrom(await getJson('/api/tables/$tableId',
        errorMessage: 'Không tải được bàn'));
  }

  /// Khách gọi nhân viên.
  Future<void> callStaff(String tableId, String reason) async {
    await postJson('/api/calls',
        body: {'table_id': tableId, 'reason': reason},
        errorMessage: 'Không gọi được nhân viên');
  }

  /// Nhân viên mở khóa chọn bàn cho iPad bằng PIN.
  Future<Map<String, dynamic>> ipadUnlock(String pin) async {
    return mapFrom(await postJson('/api/device/ipad/unlock',
        body: {'pin': pin}, errorMessage: 'PIN không đúng'));
  }

  /// Đăng ký token FCM của thiết bị này — cho phép server đẩy thông báo
  /// (bản cập nhật app…) KỂ CẢ KHI APP ĐÃ TẮT. Gọi lại mỗi khi Firebase phát
  /// token mới (onTokenRefresh) — server tự UPSERT theo device_id.
  Future<void> registerPushToken({
    required String deviceId,
    required String fcmToken,
    required String platform,
  }) async {
    await postJson('/api/device/push-token',
        body: {
          'device_id': deviceId,
          'fcm_token': fcmToken,
          'platform': platform,
        },
        errorMessage: 'Không đăng ký được thông báo đẩy');
  }

  /// Danh sách POS/máy in để liên kết cho iPad.
  Future<Map<String, dynamic>> ipadSetupOptions() async {
    return mapFrom(await getJson('/api/device/ipad/setup-options',
        errorMessage: 'Không tải được thiết bị'));
  }

  /// Cấu hình vận hành (phương thức thanh toán…).
  Future<Map<String, dynamic>> operationsConfig() async {
    return mapFrom(await getJson('/api/operations/config',
        errorMessage: 'Không tải được cấu hình vận hành'));
  }

  Future<void> setItemStatus(String itemId, String status) async {
    await postJson(
      '/api/orders/items/$itemId/status',
      body: {'status': status},
      errorMessage: 'Failed to update item status',
    );
  }

  Future<void> cancelItem(String itemId, String reason,
      {String? managerPin}) async {
    await postJson(
      '/api/orders/items/$itemId/cancel',
      body: {
        'reason': reason,
        if (managerPin != null) 'pin': managerPin,
      },
      errorMessage: 'Failed to cancel item',
    );
  }

  // ── KDS (Kitchen Display) ──────────────────────────────────────────────
  Future<List<dynamic>> getKdsTickets([String station = 'all']) async {
    return listFrom(await getJson('/api/kds/$station',
        errorMessage: 'Không tải được phiếu bếp'));
  }

  Future<void> kdsDismiss(String itemId) async {
    await postJson('/api/orders/items/$itemId/kds-dismiss',
        errorMessage: 'Không xác nhận được');
  }
}
