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
        body: {'user_id': userId}, errorMessage: 'Không phân công được đơn'));
  }

  Future<Map<String, dynamic>> transitionOnlineOperation(
      String id, String action,
      {Map<String, dynamic> body = const {}}) async {
    return mapFrom(await postJson(
        '/api/online/operations/orders/$id/transition',
        body: {'action': action, ...body},
        errorMessage: 'Không cập nhật được trạng thái đơn'));
  }

  /// Xác nhận / chuyển trạng thái NHIỀU đơn cùng lúc (chọn tất cả).
  /// Trả {ok_count, fail_count, results:[{id, ok, error}]}.
  Future<Map<String, dynamic>> bulkTransitionOnlineOperations(
      List<String> ids, String action) async {
    return mapFrom(await postJson(
        '/api/online/operations/orders/bulk-transition',
        body: {'ids': ids, 'action': action},
        errorMessage: 'Không xử lý được hàng loạt'));
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
    return mapFrom(await getJson(
        '/api/online/operations/product-mappings$query',
        errorMessage: 'Không tải được liên kết hàng hóa'));
  }

  Future<Map<String, dynamic>> linkOnlineProduct({
    String provider = '',
    required String shopDomain,
    required String externalProductId,
    String externalVariantId = '',
    required String skuId,
  }) async {
    return mapFrom(
        await postJson('/api/online/operations/product-mappings/link',
            body: {
              'provider': provider,
              'shop_domain': shopDomain,
              'external_product_id': externalProductId,
              'external_variant_id': externalVariantId,
              'sku_id': skuId,
            },
            errorMessage: 'Không liên kết được hàng hóa'));
  }

  /// "Sao chép": server tự đối chiếu SKU/ID listing sàn với kho. Khớp →
  /// matched:true (đã liên kết). Không khớp → matched:false + reason để app
  /// cho chọn tay.
  Future<Map<String, dynamic>> autoLinkOnlineProduct({
    String provider = '',
    required String shopDomain,
    required String externalProductId,
    String externalVariantId = '',
  }) async {
    return mapFrom(
        await postJson('/api/online/operations/product-mappings/auto-link',
            body: {
              'provider': provider,
              'shop_domain': shopDomain,
              'external_product_id': externalProductId,
              'external_variant_id': externalVariantId,
            },
            errorMessage: 'Không sao chép được hàng hóa'));
  }

  Future<Map<String, dynamic>> unlinkOnlineProduct({
    String provider = '',
    required String shopDomain,
    required String externalProductId,
    String externalVariantId = '',
  }) async {
    return mapFrom(
        await postJson('/api/online/operations/product-mappings/unlink',
            body: {
              'provider': provider,
              'shop_domain': shopDomain,
              'external_product_id': externalProductId,
              'external_variant_id': externalVariantId,
            },
            errorMessage: 'Không hủy liên kết được hàng hóa'));
  }

  // ── Kết nối sàn "1 chạm" (Connection Platform — token backend-only, đa sàn) ─
  // Dùng module /api/marketplace/* (guard marketplace.view/marketplace.connect).
  // Route /api/integrations/* cũ vẫn còn ở server cho bản app đã phát hành trước.
  /// Bắt đầu kết nối: trả {url, attempt_id} — mở url ở trình duyệt, poll attempt.
  Future<Map<String, dynamic>> startMarketplaceConnect(String provider) async {
    return mapFrom(await postJson('/api/marketplace/$provider/connect',
        body: const {}, errorMessage: 'Không bắt đầu được kết nối'));
  }

  Future<Map<String, dynamic>> getMarketplaceAttempt(
      String provider, String id) async {
    return mapFrom(await getJson('/api/marketplace/connect-attempts/$id',
        errorMessage: 'Không kiểm tra được trạng thái kết nối'));
  }

  Future<Map<String, dynamic>> getMarketplaceConnections(
      String provider) async {
    return mapFrom(await getJson(
        '/api/marketplace/connections${_qs({'provider': provider})}',
        errorMessage: 'Không tải được kết nối'));
  }

  Future<Map<String, dynamic>> updateMarketplaceConnectionSettings(
      String provider, String id, Map<String, dynamic> settings) async {
    return mapFrom(await patchJson('/api/marketplace/connections/$id',
        body: settings, errorMessage: 'Không lưu được thiết lập'));
  }

  Future<void> disconnectMarketplace(String provider, String id) async {
    await deleteJson('/api/marketplace/connections/$id',
        errorMessage: 'Không ngắt kết nối được');
  }

  /// Kéo listing sản phẩm từ sàn về để liên kết (Shopee/Lazada/TikTok).
  Future<Map<String, dynamic>> syncOnlineProducts(String provider) async {
    final path = switch (provider) {
      'shopee' => '/api/online/connectors/shopee/sync-products',
      'lazada' => '/api/online/connectors/lazada/sync-products',
      'tiktokshop' => '/api/online/connectors/tiktok/sync-products',
      _ => '',
    };
    if (path.isEmpty) {
      throw Exception('Kênh $provider chưa hỗ trợ đồng bộ sản phẩm');
    }
    return mapFrom(await postJson(path,
        body: const {}, errorMessage: 'Không đồng bộ được sản phẩm sàn'));
  }

  // ── Reconciliation (Đối soát) ────────────────────────────────────────────
  Future<Map<String, dynamic>> getOnlineReconciliationSummary(
      {String provider = ''}) async {
    return mapFrom(await getJson(
        '/api/online/operations/reconciliation/summary${_qs({
              'provider': provider
            })}',
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
        '/api/online/operations/reconciliation/inventory${_qs({
              'provider': provider
            })}',
        errorMessage: 'Không tải được đối soát tồn kho'));
  }

  // ── Shipping label (tem vận đơn 100×150 / 76×130) ────────────────────────
  Future<Map<String, dynamic>> printShippingLabel(String orderId,
      {String size = '100x150', int copies = 1}) async {
    return mapFrom(await postJson('/api/print/shipping-label',
        body: {'order_id': orderId, 'size': size, 'copies': copies},
        errorMessage: 'Không in được tem vận đơn'));
  }

  /// Tải WAYBILL PDF CHÍNH THỨC của sàn (Shopee/Lazada/TikTok) — dùng đúng mẫu
  /// tem của sàn, không tự thiết kế. Trả về bytes PDF để mở/in.
  Future<List<int>> getConnectorWaybill(String provider, String ref) async {
    final path = switch (provider) {
      'shopee' =>
        '/api/online/connectors/shopee/waybill/${Uri.encodeComponent(ref)}',
      'tiktokshop' =>
        '/api/online/connectors/tiktok/waybill/${Uri.encodeComponent(ref)}',
      'lazada' =>
        '/api/online/connectors/lazada/waybill?order_id=${Uri.encodeComponent(ref)}',
      _ => '',
    };
    if (path.isEmpty) {
      throw ApiException('Kênh $provider chưa hỗ trợ tải tem vận đơn.');
    }
    return getBytes(path, errorMessage: 'Không tải được tem vận đơn từ sàn');
  }
}
