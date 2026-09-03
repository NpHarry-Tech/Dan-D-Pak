part of '../api_service.dart';

/// Dan-D Pak Omni — hộp thư hội thoại đa kênh (Chat đa kênh).
///
/// Chưa có route gửi tin ra ngoài: gửi outbound cần connector sống (Meta/Zalo/
/// Shopee đang chờ cấp quyền). Vì vậy tầng này chỉ đọc hội thoại/tin nhắn và
/// thao tác NỘI BỘ (phân công, nhãn, ghi chú, mẫu trả lời, liên kết khách/đơn,
/// đánh dấu đã đọc) — đúng bằng những gì backend đang hỗ trợ, không giả vờ gửi.
extension ApiServiceOmniApi on ApiService {
  Future<Map<String, dynamic>> getOmniCapabilities() async {
    return mapFrom(await getJson('/api/omni/capabilities',
        errorMessage: 'Không tải được năng lực Omni'));
  }

  Future<Map<String, dynamic>> getOmniConversations({
    String status = '',
    String provider = '',
    bool unread = false,
    String assigneeUserId = '',
    String q = '',
    int limit = 30,
    int offset = 0,
  }) async {
    final query = _qs({
      'status': status,
      'provider': provider,
      if (unread) 'unread': 'true',
      'assignee_user_id': assigneeUserId,
      'q': q,
      'limit': limit,
      'offset': offset,
    });
    return mapFrom(await getJson('/api/omni/conversations$query',
        errorMessage: 'Không tải được hội thoại'));
  }

  Future<Map<String, dynamic>> getOmniConversation(String id) async {
    return mapFrom(await getJson('/api/omni/conversations/$id',
        errorMessage: 'Không tải được hội thoại'));
  }

  Future<List<dynamic>> getOmniMessages(String id,
      {String before = '', int limit = 50}) async {
    final query = _qs({'before': before, 'limit': limit});
    return listFrom(await getJson('/api/omni/conversations/$id/messages$query',
        errorMessage: 'Không tải được tin nhắn'));
  }

  Future<Map<String, dynamic>> updateOmniConversation(
      String id, Map<String, dynamic> changes) async {
    return mapFrom(await patchJson('/api/omni/conversations/$id',
        body: changes, errorMessage: 'Không cập nhật được hội thoại'));
  }

  Future<Map<String, dynamic>> linkOmniCustomer(
      String id, String customerId) async {
    return mapFrom(await postJson('/api/omni/conversations/$id/customer',
        body: {'customer_id': customerId},
        errorMessage: 'Không liên kết được khách hàng'));
  }

  Future<Map<String, dynamic>> linkOmniOrder(String id, String orderId) async {
    return mapFrom(await postJson('/api/omni/conversations/$id/orders',
        body: {'order_id': orderId},
        errorMessage: 'Không liên kết được đơn hàng'));
  }

  Future<List<dynamic>> getOmniCannedReplies(
      {bool includeInactive = false}) async {
    final query = includeInactive ? '?include_inactive=true' : '';
    return listFrom(await getJson('/api/omni/canned-replies$query',
        errorMessage: 'Không tải được mẫu trả lời'));
  }

  Future<Map<String, dynamic>> saveOmniCannedReply(
      Map<String, dynamic> body) async {
    return mapFrom(await postJson('/api/omni/canned-replies',
        body: body, errorMessage: 'Không lưu được mẫu trả lời'));
  }

  Future<List<dynamic>> getOmniTags() async {
    return listFrom(
        await getJson('/api/omni/tags', errorMessage: 'Không tải được nhãn'));
  }

  Future<Map<String, dynamic>> saveOmniTag(Map<String, dynamic> body) async {
    return mapFrom(await postJson('/api/omni/tags',
        body: body, errorMessage: 'Không lưu được nhãn'));
  }

  Future<Map<String, dynamic>> setOmniConversationTags(
      String id, List<String> tagIds) async {
    return mapFrom(await putJson('/api/omni/conversations/$id/tags',
        body: {'tag_ids': tagIds}, errorMessage: 'Không cập nhật được nhãn'));
  }
}
