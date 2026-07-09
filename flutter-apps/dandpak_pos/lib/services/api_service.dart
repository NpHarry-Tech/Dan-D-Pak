import 'package:dandpak_core/dandpak_core.dart';
import '../models/app_models.dart';
import '../screens/self_order/self_order_models.dart';

class ApiService extends DanDpakApiClient {
  ApiService({super.baseUrl, super.token, super.branchId});

  Future<List<dynamic>> getBranches() async {
    return listFrom(await getJson('/api/branches',
        errorMessage: 'Failed to load branches'));
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
    return mapFrom(
        await getJson('/api/me', errorMessage: 'Failed to load user'));
  }

  Future<List<dynamic>> getUsers() async {
    return listFrom(
        await getJson('/api/users', errorMessage: 'Failed to load users'));
  }

  Future<ModuleCatalog> getModules() async {
    return ModuleCatalog.fromJson(mapFrom(await getJson(
      '/api/modules',
      errorMessage: 'Failed to load modules',
    )));
  }

  Future<void> logout() async {
    await postJson('/api/logout', errorMessage: 'Logout failed');
  }

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

  /// Thực đơn ĐẦY ĐỦ {categories, items} — dùng cho màn khách tự gọi món.
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
    final query = 'page=$page&limit=$limit&q=${Uri.encodeComponent(q)}&category_id=$categoryId';
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
  /// — dùng làm preview khớp 100% tờ in.
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

  // ─── iPad Self-order (khách tự gọi món) — CÙNG backend với web /ipad ───
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

  /// Nhân viên mở khoá chọn bàn cho iPad bằng PIN.
  Future<Map<String, dynamic>> ipadUnlock(String pin) async {
    return mapFrom(await postJson('/api/device/ipad/unlock',
        body: {'pin': pin}, errorMessage: 'PIN không đúng'));
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

  // ── Management / Quản lý ──────────────────────────────────────────────

  /// Realtime KPIs for the management dashboard.
  Future<Map<String, dynamic>> getDashboard() async {
    return mapFrom(await getJson('/api/dashboard',
        errorMessage: 'Không tải được số liệu'));
  }

  /// Revenue trends bucketed by day/week/month/quarter/year.
  Future<Map<String, dynamic>> getDashboardTrends() async {
    return mapFrom(await getJson('/api/dashboard/trends',
        errorMessage: 'Không tải được xu hướng doanh thu'));
  }

  /// Report center catalog (list of available reports).
  Future<Map<String, dynamic>> getReportsCatalog() async {
    return mapFrom(await getJson('/api/reports/catalog',
        errorMessage: 'Không tải được danh mục báo cáo'));
  }

  /// Preview a single report by key, with an optional period / date range.
  Future<Map<String, dynamic>> getReportPreview(
    String type, {
    String? period,
    String? from,
    String? to,
    String? branchIds,
  }) async {
    final qs = Uri(queryParameters: {
      'type': type,
      if (period != null && period.isNotEmpty) 'period': period,
      if (from != null && from.isNotEmpty) 'from': from,
      if (to != null && to.isNotEmpty) 'to': to,
      if (branchIds != null && branchIds.isNotEmpty) 'branch_ids': branchIds,
    }).query;
    return mapFrom(await getJson('/api/reports/preview?$qs',
        errorMessage: 'Không tải được báo cáo'));
  }

  /// Raw export bytes for a report (format: html | pdf | xls | doc).
  Future<List<int>> exportReport(
    String type,
    String format, {
    String? period,
    String? from,
    String? to,
    String? branchIds,
  }) async {
    final qs = Uri(queryParameters: {
      'type': type,
      'format': format,
      if (period != null && period.isNotEmpty) 'period': period,
      if (from != null && from.isNotEmpty) 'from': from,
      if (to != null && to.isNotEmpty) 'to': to,
      if (branchIds != null && branchIds.isNotEmpty) 'branch_ids': branchIds,
    }).query;
    return getBytes('/api/reports/export?$qs',
        errorMessage: 'Không xuất được báo cáo');
  }

  /// Full menu (categories + items) for management.
  Future<Map<String, dynamic>> getMenuManage() async {
    return mapFrom(await getJson('/api/menu/manage',
        errorMessage: 'Không tải được thực đơn'));
  }

  Future<Map<String, dynamic>> uploadMenuImage({
    required String originalName,
    required String mimeType,
    required String data,
  }) async {
    return mapFrom(await postJson('/api/menu/image-upload',
        body: {
          'original_name': originalName,
          'mime_type': mimeType,
          'data': data,
        },
        timeout: const Duration(seconds: 30),
        errorMessage: 'Khong tai duoc anh mon'));
  }

  Future<Map<String, dynamic>> getBookMenuConfig() async {
    return mapFrom(await getJson('/api/settings/book-menu',
        errorMessage: 'Khong tai duoc menu quyen'));
  }

  Future<Map<String, dynamic>> saveBookMenuConfig(
      Map<String, dynamic> body) async {
    return mapFrom(await postJson('/api/settings/book-menu',
        body: body, errorMessage: 'Khong luu duoc menu quyen'));
  }

  Future<Map<String, dynamic>> importBookMenuPubhtml5(
      String url, String title) async {
    return mapFrom(await postJson('/api/settings/book-menu/import-pubhtml5',
        body: {'url': url, 'title': title},
        timeout: const Duration(seconds: 60),
        errorMessage: 'Khong import duoc menu quyen'));
  }

  Future<void> setMenuAvailability(String itemId, bool available) async {
    await postJson('/api/menu/$itemId/availability',
        body: {'available': available},
        errorMessage: 'Không cập nhật được trạng thái món');
  }

  Future<void> setMenuHidden(String itemId, bool hidden) async {
    await postJson('/api/menu/$itemId/hide',
        body: {'hidden': hidden}, errorMessage: 'Không cập nhật được ẩn/hiện');
  }

  Future<Map<String, dynamic>> createMenuItem(Map<String, dynamic> body) async {
    return mapFrom(await postJson('/api/menu',
        body: body, errorMessage: 'Không tạo được món'));
  }

  Future<Map<String, dynamic>> updateMenuItem(
      String itemId, Map<String, dynamic> body) async {
    return mapFrom(await postJson('/api/menu/$itemId/update',
        body: body, errorMessage: 'Không cập nhật được món'));
  }

  Future<Map<String, dynamic>> deleteMenuItem(
      String itemId, String securityPin) async {
    return mapFrom(await postJson('/api/menu/$itemId/delete',
        body: {'security_pin': securityPin},
        errorMessage: 'Không xóa được món'));
  }

  Future<List<dynamic>> getIngredients() async {
    return listFrom(await getJson('/api/inventory?item_type=ingredient',
        errorMessage: 'Không tải được nguyên liệu'));
  }

  Future<Map<String, dynamic>> createCategory(
      String name, String icon, String securityPin) async {
    return mapFrom(await postJson('/api/categories',
        body: {'name': name, 'icon': icon, 'security_pin': securityPin},
        errorMessage: 'Không tạo được nhóm'));
  }

  Future<void> updateCategory(String id, Map<String, dynamic> body) async {
    await postJson('/api/categories/$id/update',
        body: body, errorMessage: 'Không cập nhật được nhóm');
  }

  Future<void> deleteCategory(String id, String securityPin) async {
    await postJson('/api/categories/$id/delete',
        body: {'security_pin': securityPin},
        errorMessage: 'Không xóa được nhóm');
  }

  // ── Settings: Users & permissions ──────────────────────────────────────
  Future<List<dynamic>> getSettingsUsers() async {
    return listFrom(await getJson('/api/settings/users',
        errorMessage: 'Không tải được danh sách nhân viên'));
  }

  Future<Map<String, dynamic>> createSettingsUser(
      Map<String, dynamic> body) async {
    return mapFrom(await postJson('/api/settings/users',
        body: body, errorMessage: 'Không tạo được tài khoản'));
  }

  Future<Map<String, dynamic>> updateSettingsUser(
      String id, Map<String, dynamic> body) async {
    return mapFrom(await postJson('/api/settings/users/$id/update',
        body: body, errorMessage: 'Không cập nhật được tài khoản'));
  }

  Future<void> deleteSettingsUser(String id, String securityPin) async {
    await postJson('/api/settings/users/$id/delete',
        body: {'security_pin': securityPin},
        errorMessage: 'Không xóa được tài khoản');
  }

  Future<Map<String, dynamic>> uploadUserAvatar({
    required String originalName,
    required String mimeType,
    required String data,
  }) async {
    return mapFrom(await postJson('/api/settings/users/avatar-upload',
        body: {
          'original_name': originalName,
          'mime_type': mimeType,
          'data': data,
        },
        timeout: const Duration(seconds: 30),
        errorMessage: 'Khong tai duoc anh nhan vien'));
  }

  Future<Map<String, dynamic>> getPermissions() async {
    return mapFrom(await getJson('/api/settings/permissions',
        errorMessage: 'Không tải được phân quyền'));
  }

  Future<void> setRolePermissions(
    String role,
    List<String> perms, {
    String? securityPin,
  }) async {
    await postJson('/api/settings/roles/$role/permissions',
        body: {'perms': perms}, errorMessage: 'Không lưu được phân quyền');
  }

  // ── Settings: Branches ─────────────────────────────────────────────────
  Future<void> setRolePermissionsWithPin(
    String role,
    List<String> perms,
    String securityPin,
  ) async {
    await postJson(
      '/api/settings/roles/$role/permissions',
      body: {
        'perms': perms,
        'security_pin': securityPin,
      },
      errorMessage: 'Khong luu duoc phan quyen',
    );
  }

  Future<List<dynamic>> getSettingsBranches() async {
    return listFrom(await getJson('/api/settings/branches',
        errorMessage: 'Không tải được chi nhánh'));
  }

  Future<Map<String, dynamic>> createBranch(Map<String, dynamic> body) async {
    return mapFrom(await postJson('/api/settings/branches',
        body: body, errorMessage: 'Không tạo được chi nhánh'));
  }

  Future<Map<String, dynamic>> updateBranch(
      String id, Map<String, dynamic> body) async {
    return mapFrom(await postJson('/api/settings/branches/$id/update',
        body: body, errorMessage: 'Không cập nhật được chi nhánh'));
  }

  // ── Settings: Tables ───────────────────────────────────────────────────
  Future<Map<String, dynamic>> createTable(Map<String, dynamic> body) async {
    return mapFrom(await postJson('/api/settings/tables',
        body: body, errorMessage: 'Không tạo được bàn'));
  }

  Future<Map<String, dynamic>> updateTable(
      String id, Map<String, dynamic> body) async {
    return mapFrom(await postJson('/api/settings/tables/$id/update',
        body: body, errorMessage: 'Không cập nhật được bàn'));
  }

  Future<void> deleteTable(String id, String securityPin) async {
    await postJson('/api/settings/tables/$id/delete',
        body: {'security_pin': securityPin},
        errorMessage: 'Không xóa được bàn');
  }

  // ── Settings: App config (operations / payment / shift) ────────────────
  Future<Map<String, dynamic>> getAppSettings() async {
    return mapFrom(await getJson('/api/settings/app',
        errorMessage: 'Không tải được cấu hình'));
  }

  Future<Map<String, dynamic>> getCustomerDisplaySettings() async {
    return mapFrom(await getJson('/api/settings/customer-display',
        errorMessage: 'Không tải được cấu hình màn hình phụ'));
  }

  Future<Map<String, dynamic>> saveAppSettings(
      Map<String, dynamic> body) async {
    return mapFrom(await postJson('/api/settings/app',
        body: body, errorMessage: 'Không lưu được cấu hình'));
  }

  Future<Map<String, dynamic>> autoSavePrintTemplate(
      Map<String, dynamic> body) async {
    return mapFrom(await postJson('/api/templates/auto-save',
        body: body,
        timeout: const Duration(seconds: 20),
        errorMessage: 'Không lưu được mẫu in'));
  }

  Future<Map<String, dynamic>> getConnectionsStatus(
      {bool force = false}) async {
    return mapFrom(await getJson(
        '/api/settings/connections/status${force ? '?force=1' : ''}',
        errorMessage: 'Không tải được trạng thái kết nối'));
  }

  Future<Map<String, dynamic>> getSystemPrinters({bool force = false}) async {
    return mapFrom(await getJson(
        '/api/settings/system/printers${force ? '?force=1' : ''}',
        errorMessage: 'Không tải được danh sách máy in hệ điều hành'));
  }

  // ── Settings: Integrations ─────────────────────────────────────────────
  Future<Map<String, dynamic>> getIntegrations() async {
    return mapFrom(await getJson('/api/settings/integrations',
        errorMessage: 'Không tải được liên kết'));
  }

  Future<Map<String, dynamic>> testIntegration(
      String channel, Map<String, dynamic> config) async {
    return mapFrom(await postJson('/api/settings/integrations/$channel/test',
        body: {'config': config}, errorMessage: 'Không kiểm tra được kết nối'));
  }

  Future<Map<String, dynamic>> saveIntegrations(
      Map<String, dynamic> body) async {
    return mapFrom(await postJson('/api/settings/integrations',
        body: body, errorMessage: 'Không lưu được liên kết'));
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

  // ── Retail (bán lẻ) ────────────────────────────────────────────────────
  Future<List<dynamic>> getSkus({String channel = 'retail'}) async {
    return listFrom(await getJson('/api/skus?channel=$channel',
        errorMessage: 'Không tải được sản phẩm'));
  }

  Future<Map<String, dynamic>> getSkusPaginated({
    required int page,
    int limit = 40,
    String q = '',
    String channel = 'retail',
  }) async {
    final query = 'page=$page&limit=$limit&q=${Uri.encodeComponent(q)}&channel=$channel';
    final decoded = await getJson('/api/skus?$query',
        errorMessage: 'Không tải được trang sản phẩm $page');
    return Map<String, dynamic>.from(decoded as Map);
  }

  Future<Map<String, dynamic>?> getSkuByBarcode(String code) async {
    final decoded = await getJson(
        '/api/skus/barcode/${Uri.encodeComponent(code)}?channel=retail',
        errorMessage: 'Không tìm thấy mã vạch');
    return decoded is Map ? Map<String, dynamic>.from(decoded) : null;
  }

  Future<List<dynamic>> getRetailLots({String? warehouseId}) async {
    final q = <String>['item_type=sku'];
    if (warehouseId != null && warehouseId.isNotEmpty) {
      q.add('warehouse_id=${Uri.encodeComponent(warehouseId)}');
    }
    return listFrom(await getJson('/api/warehouse/lots?${q.join('&')}',
        errorMessage: 'Không tải được lô hàng retail'));
  }

  Future<List<dynamic>> getActiveVouchers() async {
    return listFrom(await getJson('/api/vouchers/active',
        errorMessage: 'Không tải được voucher đang chạy'));
  }

  Future<List<dynamic>> getVouchers() async {
    return listFrom(await getJson('/api/vouchers',
        errorMessage: 'Không tải được danh sách voucher'));
  }

  Future<Map<String, dynamic>> createVoucher(Map<String, dynamic> body) async {
    return mapFrom(await postJson('/api/vouchers',
        body: body, errorMessage: 'Không tạo được voucher'));
  }

  Future<Map<String, dynamic>> updateVoucher(
      String id, Map<String, dynamic> body) async {
    return mapFrom(await postJson('/api/vouchers/$id/update',
        body: body, errorMessage: 'Không cập nhật được voucher'));
  }

  Future<Map<String, dynamic>> toggleVoucher(String id, bool active,
      {String? pin}) async {
    return mapFrom(await postJson('/api/vouchers/$id/toggle',
        body: {
          'active': active,
          if (pin != null) 'security_pin': pin,
        },
        errorMessage: 'Không bật/tắt được voucher'));
  }

  Future<List<dynamic>> getCustomers({String q = ''}) async {
    final qs = q.trim().isEmpty ? '' : '?q=${Uri.encodeComponent(q.trim())}';
    return listFrom(await getJson('/api/customers$qs',
        errorMessage: 'Không tải được khách hàng'));
  }

  Future<Map<String, dynamic>> upsertCustomer(Map<String, dynamic> body) async {
    return mapFrom(await postJson('/api/customers',
        body: body, errorMessage: 'Không lưu được khách hàng'));
  }

  Future<Map<String, dynamic>> buildPaymentQr(Map<String, dynamic> body) async {
    return mapFrom(await postJson('/api/payment-qr',
        body: body, errorMessage: 'Không tạo được QR thanh toán'));
  }

  Future<Map<String, dynamic>> getPayosPaymentStatus(String orderCode) async {
    return mapFrom(await getJson(
        '/api/payos/payment-status/${Uri.encodeComponent(orderCode)}',
        errorMessage: 'Không kiểm tra được trạng thái payOS'));
  }

  Future<Map<String, dynamic>> retailCheckout(Map<String, dynamic> body) async {
    return mapFrom(await postJson('/api/retail/checkout',
        body: body, errorMessage: 'Thanh toán thất bại'));
  }

  Future<List<dynamic>> getRetailSales() async {
    return listFrom(await getJson('/api/retail/sales',
        errorMessage: 'Không tải được lịch sử bán lẻ'));
  }

  Future<Map<String, dynamic>> retailRefund(
      String saleId, Map<String, dynamic> body) async {
    return mapFrom(await postJson('/api/retail/$saleId/refund',
        body: body, errorMessage: 'Hoàn trả thất bại'));
  }

  // ── Warehouse (Kho) ────────────────────────────────────────────────────
  Future<List<dynamic>> getWarehouses() async {
    return listFrom(await getJson('/api/warehouses',
        errorMessage: 'Không tải được danh sách kho'));
  }

  Future<Map<String, dynamic>> createWarehouse(
      Map<String, dynamic> body) async {
    return mapFrom(await postJson('/api/warehouses',
        body: body, errorMessage: 'Không tạo được kho'));
  }

  Future<Map<String, dynamic>> updateWarehouse(
      String id, Map<String, dynamic> body) async {
    return mapFrom(await postJson('/api/warehouses/$id/update',
        body: body, errorMessage: 'Không cập nhật được kho'));
  }

  Future<List<dynamic>> getInventory({String? warehouseId}) async {
    final q = warehouseId != null && warehouseId.isNotEmpty
        ? '?warehouse_id=${Uri.encodeComponent(warehouseId)}'
        : '';
    return listFrom(await getJson('/api/inventory$q',
        errorMessage: 'Không tải được tồn kho'));
  }

  Future<List<dynamic>> getWarehouseSkus(String warehouseId) async {
    return listFrom(await getJson(
        '/api/skus?warehouse_id=${Uri.encodeComponent(warehouseId)}',
        errorMessage: 'Không tải được tồn kho'));
  }

  Future<List<dynamic>> getLots({String? warehouseId}) async {
    final q = warehouseId != null && warehouseId.isNotEmpty
        ? '?warehouse_id=${Uri.encodeComponent(warehouseId)}'
        : '';
    return listFrom(await getJson('/api/warehouse/lots$q',
        errorMessage: 'Không tải được lô hàng'));
  }

  Future<List<dynamic>> getMovements(
      {int limit = 80, String? warehouseId}) async {
    final q = <String>['limit=$limit'];
    if (warehouseId != null && warehouseId.isNotEmpty) {
      q.add('warehouse_id=${Uri.encodeComponent(warehouseId)}');
    }
    return listFrom(await getJson('/api/movements?${q.join('&')}',
        errorMessage: 'Không tải được lịch sử kho'));
  }

  Future<List<dynamic>> getWarehouseDocuments({String? warehouseId}) async {
    final q = warehouseId != null && warehouseId.isNotEmpty
        ? '?warehouse_id=${Uri.encodeComponent(warehouseId)}'
        : '';
    return listFrom(await getJson('/api/warehouse/documents$q',
        errorMessage: 'Không tải được phiếu kho'));
  }

  Future<void> receiveStock(Map<String, dynamic> body) async {
    await postJson('/api/warehouse/receive',
        body: body, errorMessage: 'Nhập kho thất bại');
  }

  Future<void> issueStock(Map<String, dynamic> body) async {
    await postJson('/api/warehouse/issue',
        body: body, errorMessage: 'Xuất kho thất bại');
  }

  Future<Map<String, dynamic>> createInventoryItem(
      Map<String, dynamic> body) async {
    return mapFrom(await postJson('/api/inventory',
        body: body, errorMessage: 'Không tạo được mặt hàng'));
  }

  // ── Contacts (Liên hệ / partners) ──────────────────────────────────────
  Future<Map<String, dynamic>> getPartners(
      {String type = 'all',
      String q = '',
      bool includeInactive = false}) async {
    return mapFrom(await getJson(
        '/api/partners?type=$type&q=${Uri.encodeComponent(q)}${includeInactive ? '&include_inactive=1' : ''}',
        errorMessage: 'Không tải được danh bạ'));
  }

  Future<Map<String, dynamic>> upsertPartner(Map<String, dynamic> body) async {
    return mapFrom(await postJson('/api/partners',
        body: body, errorMessage: 'Không lưu được liên hệ'));
  }

  Future<Map<String, dynamic>> uploadPartnerAvatar({
    required String originalName,
    required String mimeType,
    required String data,
  }) async {
    return mapFrom(await postJson('/api/partners/avatar-upload',
        body: {
          'original_name': originalName,
          'mime_type': mimeType,
          'data': data,
        },
        timeout: const Duration(seconds: 30),
        errorMessage: 'Khong tai duoc anh dai dien'));
  }

  Future<void> deletePartner(String id) async {
    await postJson('/api/partners/$id/delete',
        errorMessage: 'Không xóa được liên hệ');
  }

  /// Tra cứu thông tin doanh nghiệp theo MST (server gọi danh bạ công khai
  /// VietQR/Cục Thuế). Trả về { ok, company, name, address, tax_code }.
  Future<Map<String, dynamic>> lookupTaxCode(String taxCode) async {
    return mapFrom(await getJson(
        '/api/customers/lookup/tax/${Uri.encodeComponent(taxCode)}',
        // server chờ danh bạ công khai tới 8s → client phải chờ lâu hơn thế.
        timeout: const Duration(seconds: 15),
        errorMessage: 'Không tra cứu được MST'));
  }

  // ── Purchase (Mua hàng) ────────────────────────────────────────────────
  Future<Map<String, dynamic>> getPurchaseOrders(
      {String status = '', String q = ''}) async {
    return mapFrom(await getJson(
        '/api/purchase?status=$status&q=${Uri.encodeComponent(q)}',
        errorMessage: 'Không tải được đơn mua'));
  }

  Future<Map<String, dynamic>> getPurchaseOrder(String id) async {
    return mapFrom(await getJson('/api/purchase/$id',
        errorMessage: 'Không tải được đơn mua'));
  }

  Future<Map<String, dynamic>> savePurchaseOrder(
      Map<String, dynamic> body) async {
    return mapFrom(await postJson('/api/purchase',
        body: body, errorMessage: 'Không lưu được đơn mua'));
  }

  Future<void> confirmPurchase(String id) async {
    await postJson('/api/purchase/$id/confirm',
        errorMessage: 'Không xác nhận được đơn');
  }

  Future<void> receivePurchase(String id, Map<String, dynamic> body) async {
    await postJson('/api/purchase/$id/receive',
        body: body, errorMessage: 'Không nhận được hàng');
  }

  Future<void> payPurchase(String id, Map<String, dynamic> body) async {
    await postJson('/api/purchase/$id/pay',
        body: body, errorMessage: 'Không ghi được thanh toán');
  }

  Future<void> cancelPurchase(String id) async {
    await postJson('/api/purchase/$id/cancel',
        errorMessage: 'Không hủy được đơn');
  }

  Future<void> deletePurchase(String id) async {
    await postJson('/api/purchase/$id/delete',
        errorMessage: 'Không xóa được đơn');
  }

  // ── Expenses (Chi phí) ─────────────────────────────────────────────────
  Future<Map<String, dynamic>> getExpenses({
    String from = '',
    String to = '',
    String source = '',
    String categoryId = '',
  }) async {
    final q = <String>[];
    if (from.isNotEmpty) q.add('from=$from');
    if (to.isNotEmpty) q.add('to=$to');
    if (source.isNotEmpty) q.add('source=$source');
    if (categoryId.isNotEmpty) q.add('category_id=$categoryId');
    return mapFrom(await getJson('/api/expenses?${q.join('&')}',
        errorMessage: 'Không tải được chi phí'));
  }

  Future<List<dynamic>> getExpenseCategories() async {
    return listFrom(await getJson('/api/expenses/categories',
        errorMessage: 'Không tải được danh mục chi phí'));
  }

  Future<Map<String, dynamic>> upsertExpenseCategory(
      Map<String, dynamic> body) async {
    return mapFrom(await postJson('/api/expenses/categories',
        body: body, errorMessage: 'Không lưu được danh mục'));
  }

  Future<Map<String, dynamic>> createExpense(Map<String, dynamic> body) async {
    return mapFrom(await postJson('/api/expenses',
        body: body, errorMessage: 'Không ghi được chi phí'));
  }

  Future<Map<String, dynamic>> updateExpense(
      String id, Map<String, dynamic> body) async {
    return mapFrom(await postJson('/api/expenses/$id',
        body: body, errorMessage: 'Không cập nhật được chi phí'));
  }

  Future<void> deleteExpense(String id) async {
    await postJson('/api/expenses/$id/delete',
        errorMessage: 'Không xóa được chi phí');
  }

  // ── Online (kênh online) ───────────────────────────────────────────────
  Future<List<dynamic>> getOnlineOrders() async {
    return listFrom(await getJson('/api/online/orders',
        errorMessage: 'Không tải được đơn online'));
  }

  Future<Map<String, dynamic>> getOnlineChannels() async {
    return mapFrom(await getJson('/api/online/channels',
        errorMessage: 'Không tải được kênh bán'));
  }

  Future<void> onlineConfirmPayment(String id) async {
    await postJson('/api/online/orders/$id/confirm-payment',
        errorMessage: 'Không xác nhận được thanh toán');
  }

  Future<void> onlineConfirmDelivery(String id) async {
    await postJson('/api/online/orders/$id/confirm-delivery',
        errorMessage: 'Không xác nhận được giao hàng');
  }

  Future<void> onlineReturn(String id) async {
    await postJson('/api/online/orders/$id/return',
        errorMessage: 'Không trả được đơn');
  }

  // ── Invoices (Hóa đơn) ─────────────────────────────────────────────────
  Future<List<dynamic>> getInvoices() async {
    return listFrom(
        await getJson('/api/invoices', errorMessage: 'Không tải được hóa đơn'));
  }

  Future<void> cancelInvoice(String id, {String reason = ''}) async {
    await postJson('/api/invoices/$id/cancel',
        body: {'reason': reason}, errorMessage: 'Không hủy được hóa đơn');
  }

  /// Issue a VAT invoice for a paid order (from the sales-history dialog).
  Future<Map<String, dynamic>> issueInvoice(Map<String, dynamic> body) async {
    return mapFrom(await postJson('/api/invoices/issue',
        body: body, errorMessage: 'Không xuất được hóa đơn VAT'));
  }

  // ── Documents (Tài liệu) ───────────────────────────────────────────────
  Future<Map<String, dynamic>> getDocuments(
      {String q = '', String category = ''}) async {
    final params = <String>[];
    if (q.isNotEmpty) params.add('q=${Uri.encodeComponent(q)}');
    if (category.isNotEmpty) params.add('category=$category');
    final qs = params.isEmpty ? '' : '?${params.join('&')}';
    return mapFrom(await getJson('/api/documents/files$qs',
        errorMessage: 'Không tải được tài liệu'));
  }

  Future<List<int>> downloadDocument(String id) async {
    return getBytes('/api/documents/files/$id/download',
        errorMessage: 'Không tải được file');
  }

  Future<void> deleteDocument(String id) async {
    await deleteJson('/api/documents/files/$id',
        errorMessage: 'Không xóa được tài liệu');
  }

  // ── Database (Cơ sở dữ liệu) ───────────────────────────────────────────
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

  Future<Map<String, dynamic>> exportConfig() async {
    return mapFrom(await getJson('/api/config/export',
        errorMessage: 'Không xuất được cấu hình'));
  }

  Future<Map<String, dynamic>> importConfig(Map<String, dynamic> body) async {
    return mapFrom(await postJson('/api/config/import',
        body: body,
        timeout: const Duration(seconds: 30),
        errorMessage: 'Không phục hồi được cấu hình'));
  }

  Future<Map<String, dynamic>> databaseIntegrityCheck() async {
    return mapFrom(await postJson('/api/database/integrity-check',
        errorMessage: 'Không kiểm tra được CSDL'));
  }

  Future<Map<String, dynamic>> databaseResetTransactions(String pin) async {
    return mapFrom(await postJson('/api/database/reset-transactions',
        body: {'pin': pin}, errorMessage: 'Không reset được giao dịch'));
  }

  Future<Map<String, dynamic>> databaseCloneToStaging(String pin) async {
    return mapFrom(await postJson('/api/database/clone-to-staging',
        body: {'pin': pin}, errorMessage: 'Không clone được staging'));
  }

  // ── Printers (Máy in) ──────────────────────────────────────────────────
  Future<List<dynamic>> getPrinters() async {
    return listFrom(await getJson('/api/print/printers',
        errorMessage: 'Không tải được máy in'));
  }

  Future<void> testPrinter(String id) async {
    await postJson('/api/print/printers/$id/test',
        errorMessage: 'Không in thử được');
  }

  Future<List<dynamic>> getPrintJobs() async {
    final decoded = await getJson('/api/print/jobs',
        errorMessage: 'Không tải được lệnh in');
    if (decoded is List) return decoded;
    if (decoded is Map && decoded['jobs'] is List) {
      return decoded['jobs'] as List;
    }
    return <dynamic>[];
  }

  Future<void> reprintJob(String id) async {
    await postJson('/api/print/jobs/$id/reprint',
        errorMessage: 'Không in lại được');
  }

  /// Đẩy NGAY một job đang queued ra máy in (force-dispatch server-side) —
  /// dùng để in bill tự động sau thanh toán kể cả khi tuyến in chưa bật auto.
  Future<Map<String, dynamic>> printJobNow(String id) async {
    return mapFrom(await postJson('/api/print/jobs/$id/print',
        timeout: const Duration(seconds: 20),
        errorMessage: 'Không gửi được lệnh in'));
  }

  Future<String?> forcePrintReceiptJob({
    String orderId = '',
    String billNo = '',
    Duration wait = const Duration(milliseconds: 500),
  }) async {
    final order = orderId.trim();
    final bill = billNo.trim();
    if (order.isEmpty && bill.isEmpty) return 'Thiếu mã bill để tìm lệnh in';
    if (wait > Duration.zero) await Future.delayed(wait);

    final jobs = await getPrintJobs();
    Map<String, dynamic>? found;
    for (final raw in jobs.whereType<Map>()) {
      final job = Map<String, dynamic>.from(raw);
      if ('${job['type']}' != 'receipt') continue;
      final payload = job['payload'] is Map
          ? Map<String, dynamic>.from(job['payload'] as Map)
          : <String, dynamic>{};
      final jobBill = '${payload['bill_no'] ?? payload['number'] ?? ''}';
      final jobOrder = '${payload['order_id'] ?? payload['id'] ?? ''}';
      final title = '${job['title'] ?? ''}';
      final billMatch =
          bill.isNotEmpty && (jobBill == bill || title.contains(bill));
      final orderMatch =
          order.isNotEmpty && (jobOrder == order || title.contains(order));
      if (billMatch || orderMatch) {
        found = job;
        break;
      }
    }

    if (found == null) return 'Không thấy lệnh in bill vừa thanh toán';
    final status = '${found['status']}';
    if (status == 'printed' || status == 'printing') return null;
    final id = '${found['id'] ?? ''}';
    if (id.isEmpty) return 'Lệnh in thiếu ID';

    try {
      final job = await printJobNow(id);
      final nextStatus = '${job['status']}';
      if (nextStatus == 'printed' || nextStatus == 'printing') return null;
      return '${job['error'] ?? 'Chưa in được bill'}';
    } catch (e) {
      return e.toString().replaceFirst('Exception: ', '');
    }
  }

  Future<void> markJobPrinted(String id) async {
    await postJson('/api/print/jobs/$id/printed',
        errorMessage: 'Không cập nhật được lệnh in');
  }

  // ── E-Invoices (Hóa đơn điện tử theo NĐ 70/2025/NĐ-CP) ─────────────────
  Future<Map<String, dynamic>?> getOrderEInvoice(String orderId) async {
    try {
      final res = await getJson('/api/orders/$orderId/einvoice',
          errorMessage: 'Không tải được thông tin HĐĐT');
      if (res is Map) return Map<String, dynamic>.from(res);
    } catch (_) {}
    return null;
  }

  Future<Map<String, dynamic>> retryEInvoice(
      String eInvoiceId, String securityPin) async {
    return mapFrom(await postJson(
      '/api/orders/dummy/einvoice/retry',
      body: {
        'e_invoice_id': eInvoiceId,
        'security_pin': securityPin,
      },
      errorMessage: 'Không thể phát hành lại hóa đơn',
    ));
  }

  Future<Map<String, dynamic>> syncEInvoice(String eInvoiceId) async {
    return mapFrom(await postJson(
      '/api/einvoice/$eInvoiceId/sync',
      errorMessage: 'Không thể đồng bộ trạng thái hóa đơn',
    ));
  }

  Future<Map<String, dynamic>> cancelEInvoice(
      String eInvoiceId, String reason, String securityPin) async {
    return mapFrom(await postJson(
      '/api/einvoice/$eInvoiceId/cancel',
      body: {
        'reason': reason,
        'security_pin': securityPin,
      },
      errorMessage: 'Không thể hủy hóa đơn điện tử',
    ));
  }

  Future<Map<String, dynamic>> getShiftInvoiceSummary(String shiftId) async {
    return mapFrom(await getJson(
      '/api/einvoice/shift-summary?shift_id=$shiftId',
      errorMessage: 'Không thể tải tổng hợp HĐĐT của ca',
    ));
  }

  Future<List<dynamic>> getPendingConfirmations() async {
    return listFrom(await getJson(
      '/api/orders/pending-confirmation',
      errorMessage: 'Không thể tải danh sách món chờ xác nhận',
    ));
  }

  Future<void> confirmPendingOrder(String orderId, List<String> itemIds) async {
    await postJson(
      '/api/orders/$orderId/confirm',
      body: {'item_ids': itemIds},
      errorMessage: 'Không thể xác nhận món ăn',
    );
  }

  Future<void> rejectPendingOrder(
      String orderId, List<String> itemIds, String reason) async {
    await postJson(
      '/api/orders/$orderId/reject',
      body: {'item_ids': itemIds, 'reason': reason},
      errorMessage: 'Không thể từ chối món ăn',
    );
  }

  // ── Đối soát ngân hàng (manual confirm) ────────────────────────────────
  /// Giao dịch tiền-về webhook gần đây; lọc status (unmatched,underpaid) và
  /// khoảng thời gian để thu ngân đối chiếu khi khách báo "đã chuyển rồi".
  Future<List<dynamic>> getBankTransactions({
    String status = 'unmatched,underpaid',
    int minutes = 240,
  }) async {
    final res = await getJson(
        '/api/payments/bank-transactions?status=${Uri.encodeComponent(status)}&minutes=$minutes',
        errorMessage: 'Không tải được giao dịch ngân hàng');
    if (res is Map && res['transactions'] is List) {
      return res['transactions'] as List;
    }
    return <dynamic>[];
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

  // ── iPad Self-Order ────────────────────────────────────────────────────────

  /// Khách check-in bằng SĐT: server tự tạo khách mới nếu chưa có, trả về
  /// điểm tích lũy + món hay gọi (từ lần ăn thứ 3).
  Future<Map<String, dynamic>> selfOrderCheckin(String phone) async {
    return mapFrom(await postJson(
      '/api/self-order/checkin',
      body: {'phone': phone},
      errorMessage: 'Check-in failed',
    ));
  }

  /// Lấy đơn theo ID (dùng cho màn thanh toán — poll trạng thái).
  Future<Map<String, dynamic>> getOrderById(String orderId) async {
    return mapFrom(await getJson('/api/orders/$orderId',
        errorMessage: 'Failed to load order'));
  }

  /// Sinh mã QR chuyển khoản theo đúng hóa đơn.
  Future<Map<String, dynamic>> paymentQr(String orderId) async {
    return mapFrom(await postJson('/api/orders/$orderId/payment-qr',
        body: const {}, errorMessage: 'Failed to build payment QR'));
  }

  /// Tra cứu MST doanh nghiệp (route công khai cho màn khách).
  Future<Map<String, dynamic>> taxLookup(String mst) async {
    return mapFrom(await getJson('/api/public/tax-lookup/$mst',
        errorMessage: 'Tax lookup failed'));
  }

  /// Khách chọn xuất/không xuất hóa đơn công ty sau khi thanh toán QR.
  Future<Map<String, dynamic>> customerInvoice(
    String orderId, {
    required bool issue,
    Map<String, dynamic>? customer,
  }) async {
    return mapFrom(await postJson(
      '/api/orders/$orderId/customer-invoice',
      body: {
        'decision': issue ? 'issue' : 'decline',
        if (customer != null) 'customer': customer,
      },
      errorMessage: 'Failed to submit invoice request',
    ));
  }

  /// Tạo đơn mới (dùng cho self-order kiosk).
  Future<Map<String, dynamic>> createOrder({
    required String? tableId,
    required String? orderType,
    required List<Map<String, dynamic>> items,
    Map<String, dynamic>? customer,
    String source = 'staff_pos',
  }) async {
    return mapFrom(await postJson(
      '/api/orders',
      body: {
        'table_id': tableId,
        'channel': orderType ?? 'dine_in',
        // 'customer_ipad' → server đánh dấu chờ nhân viên xác nhận + phát
        // order:pending để POS (mọi máy TRỪ máy khách) hiện đơn cần duyệt.
        'source': source,
        'items': items,
        if (customer != null) 'customer': customer,
      },
      errorMessage: 'Failed to create order',
    ));
  }

  /// Danh sách khu (zone) cho màn chọn bàn self-order. Server KHÔNG có route
  /// /api/zones riêng — mỗi bàn trong /api/tables mang tên khu ở cột `zone`,
  /// nên suy ra danh sách khu từ chính danh sách bàn (giữ thứ tự xuất hiện).
  Future<List<SoZone>> fetchSoZones() async {
    final data = listFrom(
        await getJson('/api/tables', errorMessage: 'Failed to load zones'));
    final seen = <String>{};
    final zones = <SoZone>[];
    for (final e in data.whereType<Map>()) {
      final z = (e['zone_id'] ?? e['zone'] ?? '').toString();
      if (z.isEmpty || !seen.add(z)) continue;
      zones.add(SoZone(id: z, name: z));
    }
    return zones;
  }

  /// Lấy danh sách bàn cho màn chọn bàn self-order.
  Future<List<SoTableModel>> fetchSoTables() async {
    final data = listFrom(
        await getJson('/api/tables', errorMessage: 'Failed to load tables'));
    return data
        .whereType<Map>()
        .map((e) => SoTableModel(
              id: (e['id'] ?? '').toString(),
              code: (e['code'] ?? '').toString(),
              // Server chỉ có `code` (VD "A01") — dùng làm tên hiển thị.
              name: (e['name'] ?? e['code'] ?? '').toString(),
              zoneId: (e['zone_id'] ?? e['zone'] ?? '').toString(),
              status: (e['status'] ?? 'empty').toString(),
            ))
        .toList();
  }

  /// Lấy menu đầy đủ và trả về dạng SoMenuItem list cho self-order.
  Future<List<SoMenuItem>> fetchMenuRaw() async {
    final decoded =
        await getJson('/api/menu', errorMessage: 'Failed to load menu');
    final List<dynamic> data = decoded is List
        ? decoded
        : (decoded is Map && decoded['items'] is List
            ? decoded['items'] as List
            : <dynamic>[]);

    final catNames = <String, String>{};
    if (decoded is Map && decoded['categories'] is List) {
      for (final category in decoded['categories'] as List) {
        if (category is Map && category['id'] != null) {
          catNames[category['id'].toString()] =
              (category['name'] ?? '').toString();
        }
      }
    }

    int intVal(dynamic v) {
      if (v is int) return v;
      if (v is num) return v.toInt();
      return int.tryParse(v?.toString() ?? '') ?? 0;
    }

    return data.whereType<Map>().map((item) {
      final categoryId = item['category_id']?.toString();
      final hasCategory = (item['category'] ?? '').toString().isNotEmpty;
      final category = hasCategory
          ? item['category'].toString()
          : (categoryId != null
              ? (catNames[categoryId] ?? categoryId)
              : null);
      // Ảnh món trên server là đường dẫn tương đối (/uploads/menu/...) —
      // ghép baseUrl để Image.network hiển thị được trên thiết bị.
      String? img = item['image']?.toString();
      if (img != null && img.startsWith('/')) img = '$baseUrl$img';
      return SoMenuItem(
        id: (item['id'] ?? '').toString(),
        name: (item['name'] ?? '').toString(),
        price: intVal(item['price']),
        category: category,
        image: img,
        emoji: item['emoji']?.toString(),
        description: item['description']?.toString(),
        modifiers: item['modifiers'] is List ? item['modifiers'] as List : [],
      );
    }).toList();
  }
}
