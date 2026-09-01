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

  Future<List<int>> downloadDocument(String id) async {
    return getBytes('/api/documents/files/$id/download',
        errorMessage: 'Không tải được file');
  }

  Future<void> deleteDocument(String id, String pin) async {
    await deleteJson('/api/documents/files/$id',
        body: {'pin': pin}, errorMessage: 'Không xóa được tài liệu');
  }
}
