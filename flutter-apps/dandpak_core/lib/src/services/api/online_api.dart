part of '../api_service.dart';

String _qs(Map<String, dynamic> params) {
  final parts = <String>[];
  params.forEach((k, v) {
    if (v == null) return;
    final s = v.toString();
    if (s.isEmpty) return;
    parts.add('${Uri.encodeQueryComponent(k)}=${Uri.encodeQueryComponent(s)}');
  });
  return parts.isEmpty ? '' : '?${parts.join('&')}';
}

extension ApiServiceOnlineApi on ApiService {
  // ── Legacy FnB channel view (GrabFood/ShopeeFood/Web) ────────────────────
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

  // ── Retail Online operations (KiotViet-style multi-channel order desk) ────
  Future<Map<String, dynamic>> getOnlineOperationsSummary() async {
    return mapFrom(await getJson('/api/online/operations/summary',
        errorMessage: 'Không tải được tổng quan đơn'));
  }

  Future<Map<String, dynamic>> getOnlineOperations({
    String status = '',
    String provider = '',
    String shopDomain = '',
    String q = '',
    int limit = 50,
    int offset = 0,
  }) async {
    final query = _qs({
      'status': status,
      'provider': provider,
      'shop_domain': shopDomain,
      'q': q,
      'limit': limit,
      'offset': offset,
    });
    return mapFrom(await getJson('/api/online/operations/orders$query',
        errorMessage: 'Không tải được danh sách đơn'));
  }

  Future<Map<String, dynamic>> getOnlineOperation(String id) async {
    return mapFrom(await getJson('/api/online/operations/orders/$id',
        errorMessage: 'Không tải được chi tiết đơn'));
  }

  Future<Map<String, dynamic>> assignOnlineOperation(
      String id, String userId) async {
    return mapFrom(await postJson('/api/online/operations/orders/$id/assign',
        body: {'user_id': userId},
        errorMessage: 'Không phân công được đơn'));
  }

  Future<Map<String, dynamic>> transitionOnlineOperation(
      String id, String action,
      {Map<String, dynamic> body = const {}}) async {
    return mapFrom(await postJson('/api/online/operations/orders/$id/transition',
        body: {'action': action, ...body},
        errorMessage: 'Không cập nhật được trạng thái đơn'));
  }

  Future<Map<String, dynamic>> cancelOnlineOperation(String id,
      {Map<String, dynamic> body = const {}}) async {
    return mapFrom(await postJson('/api/online/operations/orders/$id/cancel',
        body: body, errorMessage: 'Không hủy được đơn'));
  }

  Future<Map<String, dynamic>> refundOnlineOperation(String id,
      {Map<String, dynamic> body = const {}}) async {
    return mapFrom(await postJson('/api/online/operations/orders/$id/refund',
        body: body, errorMessage: 'Không hoàn tiền được đơn'));
  }

  // ── Product mapping (Hàng hóa) ───────────────────────────────────────────
  Future<Map<String, dynamic>> getOnlineProductMappings({
    String status = '',
    String provider = '',
    String q = '',
    int limit = 50,
    int offset = 0,
  }) async {
    final query = _qs({
      'status': status,
      'provider': provider,
      'q': q,
      'limit': limit,
      'offset': offset,
    });
    return mapFrom(await getJson('/api/online/operations/product-mappings$query',
        errorMessage: 'Không tải được liên kết hàng hóa'));
  }

  Future<Map<String, dynamic>> linkOnlineProduct({
    required String shopDomain,
    required String externalProductId,
    String externalVariantId = '',
    required String skuId,
  }) async {
    return mapFrom(await postJson(
        '/api/online/operations/product-mappings/link',
        body: {
          'shop_domain': shopDomain,
          'external_product_id': externalProductId,
          'external_variant_id': externalVariantId,
          'sku_id': skuId,
        },
        errorMessage: 'Không liên kết được hàng hóa'));
  }

  // ── Reconciliation (Đối soát) ────────────────────────────────────────────
  Future<Map<String, dynamic>> getOnlineReconciliationSummary(
      {String provider = ''}) async {
    return mapFrom(await getJson(
        '/api/online/operations/reconciliation/summary${_qs({'provider': provider})}',
        errorMessage: 'Không tải được đối soát'));
  }

  Future<Map<String, dynamic>> getOnlineReconciliationOrders({
    String provider = '',
    String settled = '',
    int limit = 50,
    int offset = 0,
  }) async {
    final query = _qs({
      'provider': provider,
      'settled': settled,
      'limit': limit,
      'offset': offset,
    });
    return mapFrom(await getJson(
        '/api/online/operations/reconciliation/orders$query',
        errorMessage: 'Không tải được đối soát'));
  }

  Future<Map<String, dynamic>> getOnlineInventoryReconciliation(
      {String provider = ''}) async {
    return mapFrom(await getJson(
        '/api/online/operations/reconciliation/inventory${_qs({'provider': provider})}',
        errorMessage: 'Không tải được đối soát tồn kho'));
  }

  // ── Shipping label (tem vận đơn 100×150 / 76×130) ────────────────────────
  Future<Map<String, dynamic>> printShippingLabel(String orderId,
      {String size = '100x150', int copies = 1}) async {
    return mapFrom(await postJson('/api/print/shipping-label',
        body: {'order_id': orderId, 'size': size, 'copies': copies},
        errorMessage: 'Không in được tem vận đơn'));
  }
}
