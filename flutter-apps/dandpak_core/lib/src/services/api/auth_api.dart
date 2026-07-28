part of '../api_service.dart';

extension ApiServiceAuthApi on ApiService {
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

  Future<Map<String, dynamic>> updateMyLanguage(String lang) async {
    return mapFrom(await postJson('/api/me/lang',
        body: {'lang': lang}, errorMessage: 'Không lưu được ngôn ngữ'));
  }

  /// Đổi PIN của chính mình (tự xác thực bằng PIN hiện tại). Dùng cho luồng
  /// ép-đổi PIN mặc định lần đầu.
  Future<Map<String, dynamic>> changeMyPin(
      String currentPin, String newPin) async {
    return mapFrom(await postJson('/api/me/pin',
        body: {'current_pin': currentPin, 'new_pin': newPin},
        errorMessage: 'Không đổi được mã PIN'));
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
}
