part of '../api_service.dart';

extension ApiServiceSettingsApi on ApiService {
  Future<List<dynamic>> getHaravanSyncSessions({int limit = 50}) async =>
      listFrom(await getJson(
          '/api/v1/integrations/haravan/sync-sessions?limit=$limit',
          errorMessage: 'Không tải được các phiên đồng bộ Haravan'));

  Future<List<dynamic>> getHaravanSyncSessionDetails(String id) async =>
      listFrom(await getJson(
          '/api/v1/integrations/haravan/sync-sessions/${Uri.encodeComponent(id)}',
          errorMessage: 'Không tải được chi tiết phiên Haravan'));

  Future<Map<String, dynamic>> syncHaravanNow() async =>
      mapFrom(await postJson('/api/v1/integrations/haravan/sync-all',
          body: const {'delta': true},
          timeout: const Duration(minutes: 2),
          errorMessage: 'Không đồng bộ được Haravan'));

  Future<Map<String, dynamic>> uploadCustomerDisplayImage({
    required String data,
    required String mimeType,
    required String originalName,
  }) async {
    return mapFrom(await postJson('/api/settings/customer-display/image-upload',
        body: {
          'data': data,
          'mime_type': mimeType,
          'original_name': originalName,
        },
        errorMessage: 'Không tải được ảnh màn hình phụ'));
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
        errorMessage: 'Không tải được ảnh nhân viên'));
  }

  Future<Map<String, dynamic>> getPermissions() async {
    return mapFrom(await getJson('/api/settings/permissions',
        errorMessage: 'Không tải được phân quyền'));
  }

  /// Tạo vai trò tùy chỉnh (cần PIN Manager/Admin).
  Future<Map<String, dynamic>> createRole({
    required String key,
    required String label,
    String note = '',
    required String securityPin,
  }) async {
    return mapFrom(await postJson('/api/settings/roles',
        body: {
          'key': key,
          'label': label,
          'note': note,
          'security_pin': securityPin
        },
        errorMessage: 'Không tạo được vai trò'));
  }

  /// Xóa vai trò tùy chỉnh (cần PIN Manager/Admin).
  Future<Map<String, dynamic>> deleteRole(
      String role, String securityPin) async {
    return mapFrom(await deleteJson(
        '/api/settings/roles/${Uri.encodeComponent(role)}',
        body: {'security_pin': securityPin},
        errorMessage: 'Không xóa được vai trò'));
  }

  Future<void> setRolePermissions(
    String role,
    List<String> perms, {
    String? securityPin,
  }) async {
    await postJson('/api/settings/roles/$role/permissions',
        body: {'perms': perms}, errorMessage: 'Không lưu được phân quyền');
  }

  // Settings: Branches
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
      errorMessage: 'Không lưu được phân quyền',
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

  // ── Sơ đồ bàn: khu vực (zones) + vị trí lưới ──────────────────────────────
  Future<Map<String, dynamic>> getFloorPlan() async {
    return mapFrom(await getJson('/api/settings/floor-plan',
        errorMessage: 'Không tải được sơ đồ bàn'));
  }

  Future<Map<String, dynamic>> createZone(
      String name, String securityPin) async {
    return mapFrom(await postJson('/api/settings/zones',
        body: {'name': name, 'security_pin': securityPin},
        errorMessage: 'Không tạo được khu vực'));
  }

  Future<Map<String, dynamic>> updateZone(
      String id, Map<String, dynamic> body, String securityPin) async {
    return mapFrom(await postJson('/api/settings/zones/$id/update',
        body: {...body, 'security_pin': securityPin},
        errorMessage: 'Không cập nhật được khu vực'));
  }

  Future<void> deleteZone(String id, String securityPin) async {
    await postJson('/api/settings/zones/$id/delete',
        body: {'security_pin': securityPin},
        errorMessage: 'Không xóa được khu vực');
  }

  /// Lưu HÀNG LOẠT vị trí bàn sau khi kéo-thả sơ đồ.
  Future<void> saveTablePositions(
      List<Map<String, dynamic>> positions, String securityPin) async {
    await postJson('/api/settings/tables/positions',
        body: {'positions': positions, 'security_pin': securityPin},
        errorMessage: 'Không lưu được vị trí bàn');
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

  /// Máy in nhóm theo TỪNG MÁY đang chạy Hardware Agent, kèm last_seen_at.
  /// Dùng cho ô "Máy chủ trì" và để biết máy in đang cắm ở máy nào.
  Future<List<dynamic>> getAgentDevices() async {
    final res = await getJson('/api/agent/devices',
        errorMessage: 'Không tải được danh sách máy chạy agent');
    return listFrom(mapFrom(res)['devices']);
  }

  Future<Map<String, dynamic>> getSystemPrinters({bool force = false}) async {
    return mapFrom(await getJson(
        '/api/settings/system/printers${force ? '?force=1' : ''}',
        errorMessage: 'Không tải được danh sách máy in hệ điều hành'));
  }

  // Settings: Integrations
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

  // ── ERP — Business Central (mission #27 control center) ──
  Future<Map<String, dynamic>> getErpConfig() async {
    return mapFrom(await getJson('/api/erp/config',
        errorMessage: 'Không đọc được cấu hình ERP'));
  }

  Future<Map<String, dynamic>> saveErpConfig(Map<String, dynamic> body) async {
    return mapFrom(await postJson('/api/erp/config',
        body: body, errorMessage: 'Không lưu được cấu hình ERP'));
  }

  Future<Map<String, dynamic>> testErpConnection() async {
    return mapFrom(await postJson('/api/erp/test-connection',
        body: {}, errorMessage: 'Không kiểm tra được kết nối ERP'));
  }

  Future<Map<String, dynamic>> erpStatus() async {
    return mapFrom(await getJson('/api/erp/status',
        errorMessage: 'Không đọc được trạng thái ERP'));
  }

  Future<Map<String, dynamic>> erpQueue({String status = ''}) async {
    final q = status.isEmpty ? '' : '?status=$status';
    return mapFrom(await getJson('/api/erp/queue$q',
        errorMessage: 'Không đọc được hàng đợi ERP'));
  }

  Future<Map<String, dynamic>> erpProcessNow() async {
    return mapFrom(await postJson('/api/erp/process-now',
        body: {}, errorMessage: 'Không đẩy được hàng đợi ERP'));
  }

  Future<Map<String, dynamic>> erpRetry(String id) async {
    return mapFrom(await postJson('/api/erp/retry/$id',
        body: {}, errorMessage: 'Không in lại được sự kiện ERP'));
  }

  Future<Map<String, dynamic>> erpReconcile(
      {String from = '', String to = ''}) async {
    final params = <String>[];
    if (from.isNotEmpty) params.add('from=$from');
    if (to.isNotEmpty) params.add('to=$to');
    final q = params.isEmpty ? '' : '?${params.join('&')}';
    return mapFrom(await getJson('/api/erp/reconcile$q',
        errorMessage: 'Không đối soát được ERP'));
  }
}
