part of '../api_service.dart';

extension ApiServiceSettingsApi on ApiService {
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
}
