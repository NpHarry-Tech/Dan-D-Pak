part of '../api_service.dart';

extension ApiServiceDocumentsApi on ApiService {
  Future<Map<String, dynamic>> getDocuments(
      {String q = '', String category = ''}) async {
    final params = <String>[];
    if (q.isNotEmpty) params.add('q=${Uri.encodeComponent(q)}');
    if (category.isNotEmpty) params.add('category=$category');
    final qs = params.isEmpty ? '' : '?${params.join('&')}';
    return mapFrom(await getJson('/api/documents/files$qs',
        errorMessage: 'Không tải được tài liệu'));
  }

  /// Lưu một file gốc (base64) vào kho Tài liệu (DMS). Idempotent theo nội dung:
  /// gửi lại đúng file trả về bản ghi cũ (duplicate=true) — dùng cho retry.
  Future<Map<String, dynamic>> uploadDocument({
    required String dataBase64,
    required String originalName,
    required String mimeType,
    String source = 'manual',
    String sourceScreen = '',
    String category = 'other',
    String description = '',
  }) async {
    return mapFrom(await postJson('/api/documents/upload', body: {
      'data': dataBase64,
      'original_name': originalName,
      'mime_type': mimeType,
      'source': source,
      'source_screen': sourceScreen,
      'category': category,
      'description': description,
    }, errorMessage: 'Không lưu được file vào Tài liệu'));
  }

  /// Lưu file IMPORT gốc của Kho vào Tài liệu bằng quyền TỐI THIỂU của nhân viên
  /// Kho (không cần module.documents). Idempotent theo nội dung. Dùng cho luồng
  /// nhập hàng/kiểm kho/xuất kho — bắt buộc lưu file trước khi nhập nghiệp vụ.
  Future<Map<String, dynamic>> importUploadDocument({
    required String dataBase64,
    required String originalName,
    required String mimeType,
    String sourceScreen = 'Kho — Nhập dữ liệu',
  }) async {
    return mapFrom(await postJson('/api/documents/import-upload', body: {
      'data': dataBase64,
      'original_name': originalName,
      'mime_type': mimeType,
      'source_screen': sourceScreen,
    }, errorMessage: 'Không lưu được file import vào Tài liệu'));
  }

  Future<List<int>> downloadDocument(String id) async {
    return getBytes('/api/documents/files/$id/download',
        errorMessage: 'Không tải được file');
  }

  Future<void> deleteDocument(String id, String pin) async {
    await deleteJson('/api/documents/files/$id',
        body: {'pin': pin}, errorMessage: 'Không xóa được tài liệu');
  }
}
