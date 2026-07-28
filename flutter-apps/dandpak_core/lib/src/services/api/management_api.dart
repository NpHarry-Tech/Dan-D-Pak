part of '../api_service.dart';

extension ApiServiceManagementApi on ApiService {
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
        errorMessage: 'Không tải được ảnh món'));
  }

  Future<Map<String, dynamic>> getBookMenuConfig() async {
    return mapFrom(await getJson('/api/settings/book-menu',
        errorMessage: 'Không tải được menu quyền'));
  }

  Future<Map<String, dynamic>> getPublicBookMenuConfig() async {
    return mapFrom(await getJson('/api/book-menu',
        errorMessage: 'Khong tai duoc menu quyen'));
  }

  Future<Map<String, dynamic>> saveBookMenuConfig(
      Map<String, dynamic> body) async {
    return mapFrom(await postJson('/api/settings/book-menu',
        body: body, errorMessage: 'Không lưu được menu quyền'));
  }

  Future<Map<String, dynamic>> importBookMenuPubhtml5(
      String url, String title) async {
    return mapFrom(await postJson('/api/settings/book-menu/import-pubhtml5',
        body: {'url': url, 'title': title},
        timeout: const Duration(seconds: 60),
        errorMessage: 'Không import được menu quyền'));
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

  Future<Map<String, dynamic>> translateMenuItem(
      Map<String, dynamic> body) async {
    return mapFrom(await postJson('/api/menu/translate',
        body: body, errorMessage: 'Không tự dịch được món'));
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
}
