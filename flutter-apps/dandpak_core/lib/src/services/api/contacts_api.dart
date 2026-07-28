part of '../api_service.dart';

extension ApiServiceContactsApi on ApiService {
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
        errorMessage: 'Không tải được ảnh đại diện'));
  }

  Future<void> deletePartner(String id) async {
    await postJson('/api/partners/$id/delete',
        errorMessage: 'Không xóa được liên hệ');
  }

  Future<Map<String, dynamic>> lookupTaxCode(String taxCode) async {
    return mapFrom(await getJson(
        '/api/customers/lookup/tax/${Uri.encodeComponent(taxCode)}',
        timeout: const Duration(seconds: 15),
        errorMessage: 'Không tra cứu được MST'));
  }
}
