part of '../api_service.dart';

extension ApiServiceRetailApi on ApiService {
  Future<List<dynamic>> getSkus({String channel = 'retail'}) async {
    return listFrom(await getJson('/api/skus?channel=$channel',
        errorMessage: 'Không tải được sản phẩm'));
  }

  Future<Map<String, dynamic>> getSkusPaginated({
    required int page,
    int limit = 40,
    String q = '',
    String channel = 'retail',
    bool inStockOnly = false,
    String sort = '',
  }) async {
    var query =
        'page=$page&limit=$limit&q=${Uri.encodeComponent(q)}&channel=$channel';
    if (inStockOnly) query += '&in_stock=1';
    if (sort.isNotEmpty) query += '&sort=${Uri.encodeComponent(sort)}';
    final decoded = await getJson('/api/skus?$query',
        errorMessage: 'Không tải được trang sản phẩm $page');
    return Map<String, dynamic>.from(decoded as Map);
  }

  /// [channel]: 'retail' (POS bán lẻ) | 'fnb_retail' (thêm retail trong POS
  /// F&B) — server áp kho + bảng giá theo retail_config của kênh.
  Future<Map<String, dynamic>?> getSkuByBarcode(String code,
      {String channel = 'retail'}) async {
    final decoded = await getJson(
        '/api/skus/barcode/${Uri.encodeComponent(code)}?channel=$channel',
        errorMessage: 'Không tìm thấy mã vạch');
    return decoded is Map ? Map<String, dynamic>.from(decoded) : null;
  }

  Future<List<dynamic>> getRetailLots({String? warehouseId}) async {
    final q = <String>['item_type=sku'];
    if (warehouseId != null && warehouseId.isNotEmpty) {
      q.add('warehouse_id=${Uri.encodeComponent(warehouseId)}');
    }
    return listFrom(await getJson('/api/warehouse/lots?${q.join('&')}',
        errorMessage: 'Không tải được lô hàng retail'));
  }

  Future<List<dynamic>> getActiveVouchers() async {
    return listFrom(await getJson('/api/vouchers/active',
        errorMessage: 'Không tải được voucher đang chạy'));
  }

  Future<List<dynamic>> getVouchers() async {
    return listFrom(await getJson('/api/vouchers',
        errorMessage: 'Không tải được danh sách voucher'));
  }

  Future<Map<String, dynamic>> createVoucher(Map<String, dynamic> body) async {
    return mapFrom(await postJson('/api/vouchers',
        body: body, errorMessage: 'Không tạo được voucher'));
  }

  Future<Map<String, dynamic>> updateVoucher(
      String id, Map<String, dynamic> body) async {
    return mapFrom(await postJson('/api/vouchers/$id/update',
        body: body, errorMessage: 'Không cập nhật được voucher'));
  }

  Future<Map<String, dynamic>> toggleVoucher(String id, bool active,
      {String? pin}) async {
    return mapFrom(await postJson('/api/vouchers/$id/toggle',
        body: {
          'active': active,
          if (pin != null) 'security_pin': pin,
        },
        errorMessage: 'Không bật/tắt được voucher'));
  }

  Future<List<dynamic>> getCustomers({String q = ''}) async {
    final qs = q.trim().isEmpty ? '' : '?q=${Uri.encodeComponent(q.trim())}';
    return listFrom(await getJson('/api/customers$qs',
        errorMessage: 'Không tải được khách hàng'));
  }

  Future<Map<String, dynamic>> upsertCustomer(Map<String, dynamic> body) async {
    return mapFrom(await postJson('/api/customers',
        body: body, errorMessage: 'Không lưu được khách hàng'));
  }

  Future<Map<String, dynamic>> buildPaymentQr(Map<String, dynamic> body) async {
    return mapFrom(await postJson('/api/payment-qr',
        body: body, errorMessage: 'Không tạo được QR thanh toán'));
  }

  Future<Map<String, dynamic>> getPayosPaymentStatus(String orderCode) async {
    return mapFrom(await getJson(
        '/api/payos/payment-status/${Uri.encodeComponent(orderCode)}',
        errorMessage: 'Không kiểm tra được trạng thái payOS'));
  }

  Future<Map<String, dynamic>> retailCheckout(Map<String, dynamic> body) async {
    return mapFrom(await postJson('/api/retail/checkout',
        body: body, errorMessage: 'Thanh toán thất bại'));
  }

  /// Tạo đơn NHÁP thật trên server ngay khi thu ngân chọn "Chuyển khoản" (trước
  /// khi bấm Xác nhận) — để webhook SePay/Casso/payOS có "đơn đang mở" để khớp
  /// nội dung chuyển khoản và tự đóng bill NGAY khi tiền về, thay vì phải đợi
  /// thu ngân xác nhận tay. Xem thêm services/retail.js: createDraftOrder.
  Future<Map<String, dynamic>> createRetailDraft(
      Map<String, dynamic> body) async {
    return mapFrom(await postJson('/api/retail/draft',
        body: body, errorMessage: 'Không tạo được đơn nháp'));
  }

  /// Hủy đơn nháp khi thu ngân đóng dialog thanh toán mà chưa có tiền về.
  Future<void> voidRetailDraft(String orderId) async {
    await postJson('/api/retail/draft/${Uri.encodeComponent(orderId)}/void',
        body: const {}, errorMessage: 'Không hủy được đơn nháp');
  }

  // --- Giỏ hàng bán lẻ CHIA SẺ (sync đa thiết bị) ---
  /// Tải danh sách giỏ đang mở của chi nhánh (mở màn retail thì dựng lại các tab).
  Future<List<dynamic>> getRetailCarts() async {
    final res = await getJson('/api/retail/carts',
        errorMessage: 'Không tải được giỏ hàng chia sẻ');
    return listFrom(mapFrom(res)['carts']);
  }

  /// Lưu snapshot giỏ [slot] lên server → server phát realtime cho máy khác.
  /// [device] = client-id của máy này (để tự lọc bỏ event do CHÍNH MÌNH gây ra).
  Future<Map<String, dynamic>> saveRetailCart(
      int slot, Map<String, dynamic> snapshot,
      {String device = ''}) async {
    return mapFrom(await postJson('/api/retail/cart/$slot',
        body: {'snapshot': snapshot, 'device': device},
        errorMessage: 'Không lưu được giỏ hàng chia sẻ'));
  }

  /// Xóa (giải phóng) giỏ [slot] — phát realtime để máy khác cũng dọn giỏ.
  Future<void> clearRetailCart(int slot, {String device = ''}) async {
    await deleteJson('/api/retail/cart/$slot',
        body: {'device': device},
        errorMessage: 'Không xóa được giỏ hàng chia sẻ');
  }

  Future<List<dynamic>> getRetailSales() async {
    return listFrom(await getJson('/api/retail/sales',
        errorMessage: 'Không tải được lịch sử bán lẻ'));
  }

  Future<Map<String, dynamic>> retailRefund(
      String saleId, Map<String, dynamic> body) async {
    return mapFrom(await postJson('/api/retail/$saleId/refund',
        body: body, errorMessage: 'Hoàn trả thất bại'));
  }
}
