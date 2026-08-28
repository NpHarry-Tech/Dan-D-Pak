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
    String category = '',
  }) async {
    var query =
        'page=$page&limit=$limit&q=${Uri.encodeComponent(q)}&channel=$channel';
    if (inStockOnly) query += '&in_stock=1';
    if (sort.isNotEmpty) query += '&sort=${Uri.encodeComponent(sort)}';
    if (category.isNotEmpty) {
      query += '&category=${Uri.encodeComponent(category)}';
    }
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

  Future<Map<String, dynamic>> deleteVoucher(String id, {String? pin}) async {
    return mapFrom(await postJson('/api/vouchers/$id/delete',
        body: {if (pin != null) 'security_pin': pin},
        errorMessage: 'Không xóa được voucher'));
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

  /// QR cho MỘT ĐƠN CÓ THẬT trên server.
  ///
  /// PHẢI dùng đường này bất cứ khi nào đã có đơn (kể cả đơn nháp). Server tự
  /// tính nội dung chuyển khoản bằng `paymentReferenceForOrder` — CHÍNH hàm mà
  /// `findOpenOrderByContent` dùng để khớp webhook ngân hàng, nên tiền về là
  /// khớp đúng bill, không phụ thuộc client đoán đúng công thức.
  ///
  /// Client tự ghép mã (tiền tố + số bill) là nguồn của lỗi "tự động xác nhận
  /// lúc được lúc không": chỉ cần cửa hàng đổi "Tiền tố nội dung CK" trong Kế
  /// toán, hoặc đơn nháp chưa kịp tạo, là mã trên QR không còn khớp với thứ
  /// server chờ và tiền về thành 'unmatched'.
  Future<Map<String, dynamic>> orderPaymentQr(String orderId,
      {String method = 'qrcode'}) async {
    return mapFrom(await postJson(
        '/api/orders/${Uri.encodeComponent(orderId)}/payment-qr',
        body: {'method': method},
        errorMessage: 'Không tạo được QR cho hóa đơn'));
  }

  Future<Map<String, dynamic>> orderPaymentIntent(String orderId) async {
    return mapFrom(await getJson(
        '/api/orders/${Uri.encodeComponent(orderId)}/payment-intent',
        errorMessage: 'Khong kiem tra duoc trang thai chuyen khoan'));
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

  Future<void> printRetailPreview(Map<String, dynamic> body) async {
    await postJson('/api/retail/receipt/preview/print',
        body: body, errorMessage: 'Không in được hóa đơn tạm tính');
  }

  /// Xem trước giảm giá của giỏ theo ĐÚNG engine server (gồm CTKM tự động: combo,
  /// mua-X-tặng-1). Giỏ Retail POS gọi khi giỏ đổi để hiện + thu đúng tiền.
  Future<Map<String, dynamic>> retailDiscountPreview(
      Map<String, dynamic> body) async {
    return mapFrom(await postJson('/api/retail/discount-preview',
        body: body, errorMessage: 'Không tính được giảm giá'));
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
      {String device = '', int? expectedVersion}) async {
    return mapFrom(await postJson('/api/retail/cart/$slot',
        body: {
          'snapshot': snapshot,
          'device': device,
          if (expectedVersion != null) 'expected_version': expectedVersion,
        },
        errorMessage: 'Không lưu được giỏ hàng chia sẻ'));
  }

  /// Xóa (giải phóng) giỏ [slot] — phát realtime để máy khác cũng dọn giỏ.
  Future<Map<String, dynamic>> touchRetailCartPresence(int slot,
      {required String device}) async {
    return mapFrom(await postJson('/api/retail/cart/$slot/presence',
        body: {'device': device},
        errorMessage: 'Không báo được trạng thái giỏ'));
  }

  Future<void> leaveRetailCartPresence(int slot,
      {required String device}) async {
    await deleteJson('/api/retail/cart/$slot/presence',
        body: {'device': device},
        errorMessage: 'Không rời được trạng thái giỏ');
  }

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

  /// TRẢ HÀNG (return) — bill đã thanh toán GIỮ NGUYÊN, tạo giao dịch trả riêng.
  /// body rỗng items ⇒ trả toàn bộ; có items ⇒ trả một phần. Xem services/returns.js.
  Future<Map<String, dynamic>> retailReturn(
      String saleId, Map<String, dynamic> body) async {
    return mapFrom(await postJson('/api/retail/$saleId/return',
        body: body, errorMessage: 'Trả hàng thất bại'));
  }

  /// Lịch sử trả hàng của một bill (để tính SL đã trả / còn lại khi trả một phần).
  Future<List<dynamic>> retailReturns(String saleId) async {
    return listFrom(await getJson('/api/retail/$saleId/returns',
        errorMessage: 'Không tải được lịch sử trả hàng'));
  }

  /// In "Phiếu trả hàng" cho một return (giống bill, tiêu đề PHIẾU TRẢ HÀNG).
  Future<void> printReturnVoucher(String returnId) async {
    await postJson('/api/print/return-voucher',
        body: {'return_id': returnId},
        errorMessage: 'Không in được phiếu trả hàng');
  }

  /// Xin uỷ quyền Quản lý/Admin ONE-SHOT (ManagerApprovalService). Trả {token,...}.
  /// PIN chỉ gửi để backend xác thực; KHÔNG lưu/không log ở client.
  Future<Map<String, dynamic>> grantApproval({
    required String action,
    String targetId = '',
    required String requiredPerm,
    required String pin,
  }) async {
    return mapFrom(await postJson('/api/approvals/grant',
        body: {
          'action': action,
          'target_id': targetId,
          'required_perm': requiredPerm,
          'pin': pin,
        },
        errorMessage: 'Uỷ quyền thất bại'));
  }

  // ── Step 2 multi-device: canonical order + lease + command + checkout lock ──
  // Client KHÔNG tự đánh số "Hóa đơn N": server cấp display_sequence + order_id.

  /// Tạo draft mới trên server (cấp display_sequence ATOMIC + order_id + lease).
  Future<Map<String, dynamic>> createRetailOrder(
      {required String device,
      String registerId = '',
      String sessionId = ''}) async {
    return mapFrom(await postJson('/api/retail/orders',
        body: {
          'device': device,
          'register_id': registerId,
          'session_id': sessionId,
        },
        errorMessage: 'Không tạo được hóa đơn mới'));
  }

  /// Trạng thái canonical (dùng khi conflict/reconnect — KHÔNG replay local).
  Future<Map<String, dynamic>> getRetailOrder(String orderId) async {
    return mapFrom(await getJson('/api/retail/orders/$orderId',
        errorMessage: 'Không tải được hóa đơn'));
  }

  /// Áp một lệnh mutation theo hợp đồng canonical. Ném lỗi có code:
  /// EDIT_LEASE_LOST / ORDER_VERSION_CONFLICT / ORDER_FINALIZED / ORDER_ALREADY_CHECKING_OUT.
  Future<Map<String, dynamic>> retailOrderCommand(
    String orderId, {
    required String commandId,
    required int expectedRevision,
    required String leaseToken,
    required String device,
    required String command,
    Map<String, dynamic> payload = const {},
  }) async {
    return mapFrom(await postJson('/api/retail/orders/$orderId/command',
        body: {
          'command_id': commandId,
          'expected_revision': expectedRevision,
          'lease_token': leaseToken,
          'device': device,
          'command': command,
          'payload': payload,
        },
        errorMessage: 'Không áp được thay đổi'));
  }

  Future<Map<String, dynamic>> acquireOrderLease(String orderId,
      {required String device}) async {
    return mapFrom(await postJson('/api/retail/orders/$orderId/lease',
        body: {'device': device}, errorMessage: 'Không giữ được quyền sửa'));
  }

  Future<Map<String, dynamic>> heartbeatOrderLease(String orderId,
      {required String device, required String leaseToken}) async {
    return mapFrom(await postJson('/api/retail/orders/$orderId/lease/heartbeat',
        body: {'device': device, 'lease_token': leaseToken},
        errorMessage: 'Mất quyền sửa'));
  }

  Future<void> releaseOrderLease(String orderId,
      {required String device, required String leaseToken}) async {
    await postJson('/api/retail/orders/$orderId/lease/release',
        body: {'device': device, 'lease_token': leaseToken},
        errorMessage: 'Không nhả được quyền sửa');
  }

  Future<Map<String, dynamic>> takeoverOrderLease(String orderId,
      {required String device, String approvalToken = ''}) async {
    return mapFrom(await postJson('/api/retail/orders/$orderId/lease/takeover',
        body: {'device': device, 'approval_token': approvalToken},
        errorMessage: 'Không tiếp quản được quyền sửa'));
  }

  Future<Map<String, dynamic>> acquireOrderCheckoutLock(String orderId,
      {required String device, required String idempotencyKey}) async {
    return mapFrom(await postJson('/api/retail/orders/$orderId/checkout/lock',
        body: {'device': device, 'idempotency_key': idempotencyKey},
        errorMessage: 'Không giành được lượt thanh toán'));
  }
}
